"""OpenCode CLI 适配器 - 使用 HTTP Server API"""

import asyncio
import json
import os
import time
from typing import Optional, List, AsyncIterator, Dict, Any
from dataclasses import dataclass, field

import httpx

from .base import BaseCLIAdapter, StreamChunk, StreamChunkType, Message, TokenStats


@dataclass
class OpenCodeSession:
    """OpenCode 会话信息"""

    id: str
    title: str
    created_at: float = field(default_factory=time.time)


class OpenCodeServerManager:
    """OpenCode Server 进程管理器"""

    def __init__(self, port: int = 4096, hostname: str = "127.0.0.1"):
        self.port = port
        self.hostname = hostname
        self.base_url = f"http://{hostname}:{port}"
        self.process: Optional[asyncio.subprocess.Process] = None
        self._lock = asyncio.Lock()
        self._is_running = False

    async def start(self) -> bool:
        """启动 OpenCode Server"""
        async with self._lock:
            if self._is_running:
                return True

            # 检查是否已有实例在运行
            if await self._check_health():
                self._is_running = True
                return True

            # 启动新实例
            cmd = [
                "opencode",
                "serve",
                "--port",
                str(self.port),
                "--hostname",
                self.hostname,
            ]

            try:
                self.process = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    start_new_session=True,  # 避免继承父进程的信号
                )

                # 等待服务启动
                for _ in range(30):  # 最多等待 3 秒
                    await asyncio.sleep(0.1)
                    if await self._check_health():
                        self._is_running = True
                        return True

                return False
            except Exception:
                return False

    async def stop(self):
        """停止 OpenCode Server"""
        async with self._lock:
            if self.process and self.process.returncode is None:
                self.process.terminate()
                try:
                    await asyncio.wait_for(self.process.wait(), timeout=5.0)
                except asyncio.TimeoutError:
                    self.process.kill()
            self._is_running = False

    async def _check_health(self) -> bool:
        """检查服务健康状态"""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.base_url}/global/health", timeout=1.0
                )
                return response.status_code == 200
        except Exception:
            return False


class OpenCodeAdapter(BaseCLIAdapter):
    """OpenCode CLI 适配器 - 使用 HTTP Server API

    通过 opencode serve 启动 HTTP 服务，使用 SSE 接收真正的流式输出
    """

    def __init__(self, config: dict):
        super().__init__(config)
        self._current_stats: Optional[TokenStats] = None
        self._server_manager: Optional[OpenCodeServerManager] = None
        self._client: Optional[httpx.AsyncClient] = None
        self._active_session: Optional[OpenCodeSession] = None
        self._session_context: Dict[str, Any] = {}
        self._seen_assistant_message = (
            False  # 标记是否已看到 AI 回复（用于过滤用户输入）
        )

    @property
    def name(self) -> str:
        return "opencode"

    @property
    def default_model(self) -> str:
        return self.config.get("default_model", "opencode/mimo-v2-pro-free")

    @property
    def context_window(self) -> int:
        model = self.default_model.lower()
        if "kimi" in model or "claude" in model:
            return 200000
        elif "gpt-4" in model or "gpt4" in model:
            return 8192
        else:
            return 128000

    async def _ensure_server(self) -> bool:
        """确保 OpenCode Server 正在运行"""
        if self._server_manager is None:
            port = self.config.get("server_port", 4096)
            hostname = self.config.get("server_hostname", "127.0.0.1")
            self._server_manager = OpenCodeServerManager(port, hostname)

        if self._client is None:
            timeout = httpx.Timeout(300.0, connect=10.0)
            self._client = httpx.AsyncClient(
                base_url=self._server_manager.base_url,
                timeout=timeout,
                headers={"Content-Type": "application/json"},
            )

        return await self._server_manager.start()

    def build_command(self, prompt: str, working_dir: str) -> List[str]:
        """构建命令（保留兼容性，实际不使用）"""
        return ["opencode", "run", prompt, "--format", "json", "--dir", working_dir]

    def parse_chunk(self, raw_line: bytes) -> Optional[StreamChunk]:
        """解析 SSE 事件数据"""
        try:
            data = json.loads(raw_line.decode("utf-8"))
            event_type = data.get("type", "")
            properties = data.get("properties", {})

            # OpenCode 真正的流式事件：message.part.delta
            if event_type == "message.part.delta":
                # message.part.delta 结构：properties.field="text", properties.delta="内容"
                field = properties.get("field", "")
                delta_text = properties.get("delta", "")

                if field == "text" and delta_text:
                    self._seen_assistant_message = True
                    return StreamChunk(type=StreamChunkType.CONTENT, data=delta_text)

            # message.part.updated 包含完整块（可能重复）
            elif event_type == "message.part.updated":
                part = properties.get("part", {})
                part_type = part.get("type", "")

                # 跳过用户输入（第一个 text part）
                if part_type == "text" and not self._seen_assistant_message:
                    return None

                # 处理思考过程
                if part_type == "reasoning":
                    text = part.get("text", "")
                    if text:
                        return StreamChunk(type=StreamChunkType.REASONING, data=text)

                # 处理完成（step-finish）
                elif part_type == "step-finish":
                    tokens = part.get("tokens", {})
                    self._current_stats = TokenStats(
                        prompt_tokens=tokens.get("input", 0),
                        completion_tokens=tokens.get("output", 0),
                        total_tokens=tokens.get("total", 0),
                        context_window=self.context_window,
                        context_used=tokens.get("input", 0),
                        model=self.default_model,
                    )
                    return StreamChunk(type=StreamChunkType.DONE, data="")

            # 处理错误
            elif event_type == "error":
                error_msg = properties.get("message", "Unknown error")
                return StreamChunk(type=StreamChunkType.ERROR, data=error_msg)

        except (json.JSONDecodeError, Exception):
            pass

        return None

    async def _create_session(
        self, title: str = "Feishu Bridge Session"
    ) -> Optional[OpenCodeSession]:
        """创建新的 OpenCode 会话"""
        try:
            import uuid
            import time

            # 生成唯一的 client_session_id 避免服务端复用
            client_session_id = str(uuid.uuid4())[:8]

            # 添加更多唯一标识确保创建新会话
            body = {
                "title": title,
                "client_session_id": client_session_id,
                "force_new": True,
                "timestamp": time.time(),
            }

            if self.logger:
                self.logger.debug(f"Creating session with body: {body}")

            response = await self._client.post("/session", json=body)
            if response.status_code == 200:
                data = response.json()
                session_id = data.get("id")
                if self.logger:
                    self.logger.info(f"Session created: {session_id}")
                return OpenCodeSession(id=session_id, title=data.get("title", title))
            else:
                if self.logger:
                    self.logger.error(
                        f"Failed to create session: {response.status_code} - {response.text}"
                    )
        except Exception as e:
            if self.logger:
                self.logger.error(f"Failed to create session: {e}")
        return None

    async def _send_message(
        self, session_id: str, prompt: str, context: List[Message]
    ) -> bool:
        """发送消息到会话"""
        try:
            # 构建消息内容
            parts = [{"type": "text", "text": prompt}]

            # 解析模型字符串 (格式: provider/model)
            model_parts = self.default_model.split("/", 1)
            if len(model_parts) == 2:
                provider_id, model_id = model_parts
            else:
                provider_id = "opencode"
                model_id = self.default_model

            # 构建请求体 - model 必须是对象格式
            body = {
                "parts": parts,
                "model": {"providerID": provider_id, "modelID": model_id},
            }

            if self.logger:
                self.logger.debug(f"Sending message: {body}")

            response = await self._client.post(
                f"/session/{session_id}/message", json=body
            )

            if response.status_code not in [200, 201]:
                if self.logger:
                    self.logger.error(
                        f"Failed to send message: {response.status_code} - {response.text}"
                    )
                return False

            return True

        except Exception as e:
            if self.logger:
                self.logger.error(f"Failed to send message: {e}")
            return False

    async def _listen_events(self, session_id: str) -> AsyncIterator[StreamChunk]:
        """
        监听 SSE 事件流，对不同类型事件分别处理：

        - CONTENT (message.part.delta): 增量 delta，缓冲后批量发送
            * 第一批 ≥10 字符快速发出（建立响应感）
            * 后续批次累积 ≥30 字符 或 超过 0.4s 发出
        - REASONING (message.part.updated): 全量文本，去重后直接发送
            * 只在文本实际变化时才 yield，避免重复刺激 CardKit
        - DONE / ERROR: 先刷出缓冲区，再发出终止事件
        """
        try:
            content_buffer = ""
            last_content_flush = asyncio.get_event_loop().time()
            has_sent_first_content = False

            # REASONING 去重：只在文本实际新增内容时才 yield
            last_reasoning_text = ""

            async with self._client.stream("GET", "/event") as response:
                async for line in response.aiter_lines():
                    if not line.startswith("data: "):
                        continue

                    chunk = self.parse_chunk(line[6:].encode("utf-8"))
                    if not chunk:
                        continue

                    if chunk.type == StreamChunkType.CONTENT:
                        # 累积 delta 内容
                        content_buffer += chunk.data
                        now = asyncio.get_event_loop().time()
                        elapsed = now - last_content_flush

                        if not has_sent_first_content and len(content_buffer) >= 10:
                            # 第一批：≥10 字符快速发出（建立响应感）
                            yield StreamChunk(
                                type=StreamChunkType.CONTENT, data=content_buffer
                            )
                            content_buffer = ""
                            last_content_flush = now
                            has_sent_first_content = True
                        elif has_sent_first_content and (
                            len(content_buffer) >= 30 or elapsed >= 0.4
                        ):
                            # 后续批次：≥30 字符 或 超过 0.4s
                            yield StreamChunk(
                                type=StreamChunkType.CONTENT, data=content_buffer
                            )
                            content_buffer = ""
                            last_content_flush = now

                    elif chunk.type == StreamChunkType.REASONING:
                        # REASONING 是全量文本，只在有新增内容时 yield
                        new_text = chunk.data
                        if new_text and new_text != last_reasoning_text:
                            last_reasoning_text = new_text
                            yield chunk

                    else:
                        # DONE / ERROR：先刷出 content 缓冲区
                        if content_buffer:
                            yield StreamChunk(
                                type=StreamChunkType.CONTENT, data=content_buffer
                            )
                            content_buffer = ""

                        yield chunk

                        if chunk.type in (StreamChunkType.DONE, StreamChunkType.ERROR):
                            return

            # 流结束时发送剩余内容
            if content_buffer:
                yield StreamChunk(type=StreamChunkType.CONTENT, data=content_buffer)

        except Exception as e:
            if self.logger:
                self.logger.error(f"Event stream error: {e}")
            yield StreamChunk(
                type=StreamChunkType.ERROR, data=f"Event stream error: {str(e)}"
            )

    async def execute_stream(
        self, prompt: str, context: List[Message], working_dir: str
    ) -> AsyncIterator[StreamChunk]:
        """执行 OpenCode 并流式返回输出"""

        # 确保 Server 运行
        if not await self._ensure_server():
            yield StreamChunk(
                type=StreamChunkType.ERROR, data="Failed to start OpenCode Server"
            )
            return

        # 创建或复用会话
        if self._active_session is None:
            self._active_session = await self._create_session()
            if self._active_session is None:
                yield StreamChunk(
                    type=StreamChunkType.ERROR, data="Failed to create session"
                )
                return

        session_id = self._active_session.id

        # 重置状态
        self._seen_assistant_message = False

        if self.logger:
            self.logger.info(
                f"Sending prompt to session {session_id}: {prompt[:50]}..."
            )

        # 发送消息（异步，不等待响应）
        # 实际的消息通过 SSE 接收
        asyncio.create_task(self._send_message(session_id, prompt, context))

        # 等待一小段时间让消息开始处理
        await asyncio.sleep(0.5)

        # 监听流式事件
        async for chunk in self._listen_events(session_id):
            yield chunk

    def get_stats(self, context: List[Message], completion_text: str) -> TokenStats:
        """获取 Token 统计"""
        if self._current_stats:
            context_used = self._current_stats.prompt_tokens
            self._current_stats.context_percent = min(
                100.0, round(context_used / self.context_window * 100, 1)
            )
            return self._current_stats

        return super().get_stats(context, completion_text)

    async def close(self):
        """关闭适配器，清理资源"""
        if self._client:
            await self._client.aclose()
        if self._server_manager:
            await self._server_manager.stop()

    # ==================== TUI 命令支持 ====================

    @property
    def supported_tui_commands(self) -> List[str]:
        """返回支持的 TUI 命令列表"""
        return ["new", "session", "model", "reset"]

    async def create_new_session(self) -> Optional[Dict[str, Any]]:
        """创建新会话"""
        if not await self._ensure_server():
            return None

        try:
            import time
            import random
            import uuid

            # 生成唯一标题
            timestamp = time.strftime("%m%d_%H%M%S")
            random_suffix = random.randint(1000, 9999)
            title = f"Feishu Bridge {timestamp}_{random_suffix}"

            # 记录旧会话
            old_session_id = self._active_session.id if self._active_session else None
            if self.logger:
                self.logger.info(f"准备创建新会话，当前会话: {old_session_id}")
                # 先列出所有会话，看当前有几个
                existing_sessions = await self.list_sessions(limit=20)
                self.logger.info(f"当前已有 {len(existing_sessions)} 个会话")

            # 创建新会话
            session = await self._create_session(title=title)

            if self.logger and session:
                self.logger.info(f"_create_session 返回: {session.id}")
                # 再次列出会话，看是否增加了
                new_sessions = await self.list_sessions(limit=20)
                self.logger.info(f"创建后共有 {len(new_sessions)} 个会话")

                # 检查是否真的创建了新会话
                if session.id == old_session_id:
                    self.logger.error(
                        f"错误：返回的会话 ID ({session.id}) 与旧会话相同！"
                    )

            if session:
                self._active_session = session
                return {
                    "id": session.id,
                    "title": session.title,
                    "created_at": session.created_at,
                }
        except Exception as e:
            if self.logger:
                self.logger.error(f"创建会话失败: {e}")
        return None

    async def list_sessions(self, limit: int = 10) -> List[Dict[str, Any]]:
        """列出会话"""
        if not await self._ensure_server():
            return []

        try:
            response = await self._client.get("/session")
            if response.status_code == 200:
                data = response.json()
                # API 可能直接返回列表或包含 items 的字典
                if isinstance(data, list):
                    sessions = data
                elif isinstance(data, dict):
                    sessions = data.get("items", [])
                else:
                    sessions = []

                # 格式化为统一格式
                return [
                    {
                        "id": s.get("id"),
                        "title": s.get("title", "未命名会话"),
                        "created_at": s.get("createdAt", time.time()),
                    }
                    for s in sessions[:limit]
                ]
        except Exception as e:
            if self.logger:
                self.logger.error(f"列出会话失败: {e}")
        return []

    async def switch_session(self, session_id: str) -> bool:
        """切换到指定会话"""
        if not await self._ensure_server():
            return False

        try:
            # 验证会话是否存在
            response = await self._client.get(f"/session/{session_id}")
            if response.status_code == 200:
                data = response.json()
                self._active_session = OpenCodeSession(
                    id=data.get("id"),
                    title=data.get("title", "已恢复会话"),
                )
                return True
        except Exception as e:
            if self.logger:
                self.logger.error(f"切换会话失败: {e}")
        return False

    async def reset_session(self) -> bool:
        """重置当前会话（清空对话历史）"""
        if self._active_session:
            # 创建新会话替换当前会话
            new_session = await self._create_session()
            if new_session:
                self._active_session = new_session
                return True
        return False

    async def list_models(self, provider: Optional[str] = None) -> List[Dict[str, Any]]:
        """列出可用模型 - 只显示已配置 API key 的主要模型"""
        # 返回常用且已配置的模型列表
        # 这些应该是用户实际有 API key 的模型
        return [
            # OpenCode 官方模型（免费）
            {
                "provider": "opencode",
                "model": "mimo-v2",
                "name": "Mimo V2",
                "full_id": "opencode/mimo-v2",
            },
            {
                "provider": "opencode",
                "model": "mimo-v2-pro-free",
                "name": "Mimo V2 Pro Free",
                "full_id": "opencode/mimo-v2-pro-free",
            },
            {
                "provider": "opencode",
                "model": "mimo-v2-omni-free",
                "name": "Mimo V2 Omni Free",
                "full_id": "opencode/mimo-v2-omni-free",
            },
            # Anthropic Claude 系列（需要 ANTHROPIC_API_KEY）
            {
                "provider": "anthropic",
                "model": "claude-sonnet-4-20250514",
                "name": "Claude Sonnet 4",
                "full_id": "anthropic/claude-sonnet-4-20250514",
            },
            {
                "provider": "anthropic",
                "model": "claude-opus-4-20250514",
                "name": "Claude Opus 4",
                "full_id": "anthropic/claude-opus-4-20250514",
            },
            {
                "provider": "anthropic",
                "model": "claude-3-5-sonnet-20241022",
                "name": "Claude 3.5 Sonnet",
                "full_id": "anthropic/claude-3-5-sonnet-20241022",
            },
            # Kimi 系列（需要 MOONSHOT_API_KEY）
            {
                "provider": "moonshotai",
                "model": "kimi-k2.5",
                "name": "Kimi K2.5",
                "full_id": "moonshotai/kimi-k2.5",
            },
            {
                "provider": "moonshotai",
                "model": "kimi-k2-thinking",
                "name": "Kimi K2 Thinking",
                "full_id": "moonshotai/kimi-k2-thinking",
            },
            # GPT 系列（需要 OPENAI_API_KEY）
            {
                "provider": "opencode",
                "model": "gpt-5-nano",
                "name": "GPT-5 Nano",
                "full_id": "opencode/gpt-5-nano",
            },
        ]

    async def switch_model(self, model_id: str) -> bool:
        """切换当前会话使用的模型"""
        # 验证模型格式
        if "/" not in model_id:
            return False

        # 更新配置中的默认模型
        # 注意：这只会影响新消息，当前正在进行的对话不会改变
        self.config["default_model"] = model_id

        if self.logger:
            self.logger.info(f"切换到模型: {model_id}")

        return True

    def get_current_model(self) -> str:
        """获取当前使用的模型"""
        return self.default_model
