"""OpenCode CLI 适配器 - 使用 HTTP Server API"""

import asyncio
import base64
import json
import os
import shutil
import time
from typing import Optional, List, AsyncIterator, Dict, Any, Tuple
from dataclasses import dataclass, field

import httpx

from .base import BaseCLIAdapter, StreamChunk, StreamChunkType, Message, TokenStats


@dataclass
class OpenCodeSession:
    """OpenCode 会话信息"""

    id: str
    title: str
    created_at: float = field(default_factory=time.time)
    working_dir: str = ""  # 此会话绑定的工作目录


class OpenCodeServerManager:
    """OpenCode Server 进程管理器（单实例，工作目录隔离通过 session directory 参数实现）"""

    def __init__(self, port: int = 4096, hostname: str = "127.0.0.1", logger=None):
        self.port = port
        self.hostname = hostname
        self.base_url = f"http://{hostname}:{port}"
        self.process: Optional[asyncio.subprocess.Process] = None
        self._lock = asyncio.Lock()
        self._is_running = False
        self._logger = logger

    async def start(self) -> bool:
        """启动 OpenCode Server"""
        async with self._lock:
            if self._is_running:
                return True

            # 检查是否已有实例在运行
            if await self._check_health():
                self._is_running = True
                return True

            # 用 shutil.which 拿到完整路径，避免 Windows 子进程不走 shell PATH
            opencode_bin = shutil.which("opencode")
            if not opencode_bin:
                if self._logger:
                    self._logger.error("找不到 opencode 可执行文件，请确认已安装并加入 PATH")
                return False

            cmd = [opencode_bin, "serve", "--port", str(self.port)]

            try:
                self.process = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    start_new_session=True,
                )

                # 等待服务启动，最多 10 秒（Windows 冷启动更慢）
                for i in range(100):
                    await asyncio.sleep(0.1)

                    # 进程已退出 → 立即读取 stderr 并报错
                    if self.process.returncode is not None:
                        stderr_bytes = b""
                        if self.process.stderr:
                            try:
                                stderr_bytes = await asyncio.wait_for(
                                    self.process.stderr.read(), timeout=1.0
                                )
                            except Exception:
                                pass
                        if self._logger:
                            self._logger.error(
                                f"opencode serve 进程意外退出 (code={self.process.returncode}): "
                                f"{stderr_bytes.decode(errors='replace').strip()}"
                            )
                        return False

                    if await self._check_health():
                        self._is_running = True
                        return True

                # 超时：读取 stderr 帮助诊断
                stderr_bytes = b""
                if self.process.stderr:
                    try:
                        stderr_bytes = await asyncio.wait_for(
                            self.process.stderr.read(4096), timeout=1.0
                        )
                    except Exception:
                        pass
                if self._logger:
                    self._logger.error(
                        f"opencode serve 启动超时（10s）。stderr: "
                        f"{stderr_bytes.decode(errors='replace').strip() or '(无输出)'}"
                    )
                return False

            except Exception as e:
                if self._logger:
                    self._logger.error(f"启动 opencode serve 失败: {e}")
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
        """检查服务健康状态（兼容不同 opencode 版本的 health 路径）"""
        endpoints = ["/global/health", "/health", "/api/health"]
        try:
            async with httpx.AsyncClient() as client:
                for path in endpoints:
                    try:
                        response = await client.get(
                            f"{self.base_url}{path}", timeout=1.0
                        )
                        if response.status_code == 200:
                            return True
                    except Exception:
                        continue
        except Exception:
            pass
        return False


class OpenCodeAdapter(BaseCLIAdapter):
    """OpenCode CLI 适配器 - 使用 HTTP Server API

    通过 opencode serve 启动 HTTP 服务，使用 SSE 接收真正的流式输出。
    单一 Server 实例，工作目录隔离通过创建 session 时传 directory 参数实现。
    每个 working_dir 对应独立的 OpenCode session，保证工具调用 CWD 隔离。
    """

    def __init__(self, config: dict):
        super().__init__(config)
        self._current_stats: Optional[TokenStats] = None
        # 单一服务器实例
        self._server_manager: Optional[OpenCodeServerManager] = None
        self._client: Optional[httpx.AsyncClient] = None
        self._server_lock: Optional[asyncio.Lock] = None  # 懒初始化，避免绑定到错误的事件循环
        # 每个工作目录对应一个 OpenCode 会话（key = working_dir）
        self._sessions: Dict[str, OpenCodeSession] = {}
        # 当前活跃工作目录（TUI 命令使用）
        self._active_working_dir: str = ""
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
    def default_agent(self) -> str:
        return self.config.get("default_agent", "build")

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
        """确保单一 OpenCode Server 正在运行"""
        if self._server_lock is None:
            self._server_lock = asyncio.Lock()
        async with self._server_lock:
            # 检查已有实例是否健康
            if self._server_manager is not None and await self._server_manager._check_health():
                return True

            # 启动新实例
            port = self.config.get("server_port", 4096)
            hostname = self.config.get("server_hostname", "127.0.0.1")
            self._server_manager = OpenCodeServerManager(port, hostname, logger=self.logger)

            timeout = httpx.Timeout(300.0, connect=10.0)
            if self._client:
                try:
                    await self._client.aclose()
                except Exception:
                    pass
            self._client = httpx.AsyncClient(
                base_url=self._server_manager.base_url,
                timeout=timeout,
                headers={"Content-Type": "application/json"},
            )

            started = await self._server_manager.start()
            if started and self.logger:
                self.logger.info(f"OpenCode server started: port={port}")
            return started

    async def _get_or_create_session(self, working_dir: str) -> Optional[OpenCodeSession]:
        """获取或创建指定工作目录的 OpenCode 会话"""
        if working_dir in self._sessions:
            return self._sessions[working_dir]

        if self._client is None:
            return None

        session = await self._create_session(self._client, working_dir=working_dir)
        if session:
            self._sessions[working_dir] = session
        return session

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
        self,
        client: httpx.AsyncClient,
        title: str = "Feishu Bridge Session",
        working_dir: str = "",
    ) -> Optional[OpenCodeSession]:
        """创建新的 OpenCode 会话。

        directory 通过 query 参数传递（服务端全局中间件读取），
        决定该请求所属的工作目录实例，session 将在此目录上下文中创建。
        """
        try:
            body: Dict[str, Any] = {"title": title}

            # directory 作为 query 参数，由服务端中间件处理：
            # c.req.query("directory") || c.req.header("x-opencode-directory") || process.cwd()
            params = {"directory": working_dir} if working_dir else {}

            if self.logger:
                self.logger.debug(f"Creating session: dir={working_dir!r}")

            response = await client.post("/session", json=body, params=params)
            if response.status_code == 200:
                data = response.json()
                session_id = data.get("id")
                if self.logger:
                    self.logger.info(
                        f"Session created: {session_id} dir={working_dir!r}"
                    )
                return OpenCodeSession(
                    id=session_id, title=data.get("title", title), working_dir=working_dir
                )
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
        self,
        client: httpx.AsyncClient,
        session_id: str,
        prompt: str,
        context: List[Message],
        working_dir: str = "",
        attachments: Optional[List[Dict[str, Any]]] = None,
    ) -> bool:
        """发送消息到会话。directory 通过 query 参数传递，确保工具调用在正确目录执行"""
        try:
            parts: List[Dict[str, Any]] = [{"type": "text", "text": prompt}]

            # 添加图片/文件 parts（读取文件转 base64 data URL，确保模型可直接读取）
            if attachments:
                for att in attachments:
                    try:
                        with open(att["path"], "rb") as f:
                            raw = f.read()
                        b64 = base64.b64encode(raw).decode()
                        data_url = f"data:{att['mime_type']};base64,{b64}"
                        parts.append({
                            "type": "file",
                            "mime": att["mime_type"],
                            "url": data_url,
                            "filename": att["filename"],
                        })
                    except Exception as e:
                        if self.logger:
                            self.logger.warning(f"Failed to encode attachment {att['path']}: {e}")

            # 解析模型字符串 (格式: provider/model)
            model_parts = self.default_model.split("/", 1)
            if len(model_parts) == 2:
                provider_id, model_id = model_parts
            else:
                provider_id = "opencode"
                model_id = self.default_model

            body: Dict[str, Any] = {
                "parts": parts,
                "model": {"providerID": provider_id, "modelID": model_id},
                "agent": self.default_agent,
            }

            # directory 作为 query 参数，服务端中间件决定此 prompt 的工作目录上下文
            params = {"directory": working_dir} if working_dir else {}

            if self.logger:
                self.logger.debug(
                    f"Sending message: parts={len(parts)} dir={working_dir!r}"
                )

            # 使用 prompt_async 端点：立即返回 204，响应通过 SSE /event 推送
            response = await client.post(
                f"/session/{session_id}/prompt_async", json=body, params=params
            )

            if response.status_code not in [200, 201, 204]:
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

    async def _listen_events(
        self,
        client: httpx.AsyncClient,
        session_id: str,
        working_dir: str = "",
    ) -> AsyncIterator[StreamChunk]:
        """
        监听 SSE 事件流，对不同类型事件分别处理。

        directory 作为 query 参数传递，确保收到的事件属于正确的目录实例：
          GET /event?directory=/code/myproject

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

            params = {"directory": working_dir} if working_dir else {}
            async with client.stream("GET", "/event", params=params) as response:
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
        self,
        prompt: str,
        context: List[Message],
        working_dir: str,
        attachments: Optional[List[Dict[str, Any]]] = None,
    ) -> AsyncIterator[StreamChunk]:
        """执行 OpenCode 并流式返回输出"""

        # 确保 Server 正在运行
        started = await self._ensure_server()
        if not started or self._client is None:
            yield StreamChunk(
                type=StreamChunkType.ERROR, data="Failed to start OpenCode Server"
            )
            return

        # 更新活跃工作目录（TUI 命令依赖此字段）
        self._active_working_dir = working_dir

        # 获取或创建该工作目录的会话（传 directory 参数保证 CWD 隔离）
        session = await self._get_or_create_session(working_dir)
        if session is None:
            yield StreamChunk(
                type=StreamChunkType.ERROR, data="Failed to create session"
            )
            return

        # 重置状态
        self._seen_assistant_message = False

        if self.logger:
            att_info = f", attachments={len(attachments)}" if attachments else ""
            self.logger.info(
                f"Sending prompt to session {session.id} (dir={working_dir!r}): {prompt[:50]}...{att_info}"
            )

        # 发送消息（异步，不等待响应）；实际响应通过 SSE 接收
        asyncio.create_task(
            self._send_message(
                self._client, session.id, prompt, context, working_dir, attachments
            )
        )

        # 等待一小段时间让消息开始处理
        await asyncio.sleep(0.5)

        # 监听流式事件（带 directory 参数，确保收到正确目录实例的事件）
        async for chunk in self._listen_events(self._client, session.id, working_dir):
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
        """关闭适配器，清理服务器资源"""
        if self._client:
            try:
                await self._client.aclose()
            except Exception:
                pass
        if self._server_manager:
            try:
                await self._server_manager.stop()
            except Exception:
                pass
        self._sessions.clear()

    # ==================== TUI 命令支持 ====================

    @property
    def supported_tui_commands(self) -> List[str]:
        """返回支持的 TUI 命令列表"""
        return ["new", "session", "model", "reset"]

    def _get_active_client_session(self) -> Tuple[Optional[httpx.AsyncClient], Optional[OpenCodeSession]]:
        """获取当前活跃工作目录的客户端和会话（供 TUI 命令使用）"""
        return self._client, self._sessions.get(self._active_working_dir)

    async def create_new_session(self) -> Optional[Dict[str, Any]]:
        """创建新会话（在当前活跃工作目录下）"""
        started = await self._ensure_server()
        if not started or self._client is None:
            return None

        try:
            import random

            timestamp = time.strftime("%m%d_%H%M%S")
            random_suffix = random.randint(1000, 9999)
            title = f"Feishu Bridge {timestamp}_{random_suffix}"

            client, old_session = self._get_active_client_session()
            old_session_id = old_session.id if old_session else None
            if self.logger:
                self.logger.info(f"准备创建新会话，当前会话: {old_session_id}")
                existing_sessions = await self.list_sessions(limit=20)
                self.logger.info(f"当前已有 {len(existing_sessions)} 个会话")

            session = await self._create_session(
                self._client, title=title, working_dir=self._active_working_dir
            )

            if self.logger and session:
                self.logger.info(f"_create_session 返回: {session.id}")
                new_sessions = await self.list_sessions(limit=20)
                self.logger.info(f"创建后共有 {len(new_sessions)} 个会话")
                if session.id == old_session_id:
                    self.logger.error(
                        f"错误：返回的会话 ID ({session.id}) 与旧会话相同！"
                    )

            if session:
                self._sessions[self._active_working_dir] = session
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
        """列出当前活跃目录服务器上的会话"""
        started = await self._ensure_server()
        if not started or self._client is None:
            return []

        try:
            response = await self._client.get("/session")
            if response.status_code == 200:
                data = response.json()
                if isinstance(data, list):
                    sessions = data
                elif isinstance(data, dict):
                    sessions = data.get("items", [])
                else:
                    sessions = []

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
        started = await self._ensure_server()
        if not started or self._client is None:
            return False

        try:
            response = await self._client.get(f"/session/{session_id}")
            if response.status_code == 200:
                data = response.json()
                self._sessions[self._active_working_dir] = OpenCodeSession(
                    id=data.get("id"),
                    title=data.get("title", "已恢复会话"),
                    working_dir=self._active_working_dir,
                )
                return True
        except Exception as e:
            if self.logger:
                self.logger.error(f"切换会话失败: {e}")
        return False

    async def reset_session(self) -> bool:
        """重置当前会话（清空对话历史，保留工作目录）"""
        if self._client is None:
            return False
        new_session = await self._create_session(
            self._client, working_dir=self._active_working_dir
        )
        if new_session:
            self._sessions[self._active_working_dir] = new_session
            return True
        return False

    async def list_models(self, provider: Optional[str] = None) -> List[Dict[str, Any]]:
        """列出可用模型 - 直接从 config.yaml 的 models 列表读取"""
        raw_models: list = self.config.get("models", [])
        models: List[Dict[str, Any]] = []

        for item in raw_models:
            if isinstance(item, str):
                full_id = item
                name = item
            elif isinstance(item, dict):
                full_id = item.get("id", "")
                name = item.get("name", full_id)
            else:
                continue

            if "/" not in full_id:
                continue

            prov_id, model_id = full_id.split("/", 1)
            if provider and prov_id != provider:
                continue

            models.append({
                "provider": prov_id,
                "model": model_id,
                "name": name,
                "full_id": full_id,
            })

        return models

    async def switch_model(self, model_id: str) -> bool:
        """切换当前会话使用的模型"""
        if "/" not in model_id:
            return False

        # 更新配置中的默认模型（影响新消息）
        self.config["default_model"] = model_id

        if self.logger:
            self.logger.info(f"切换到模型: {model_id}")

        return True

    def get_current_model(self) -> str:
        """获取当前使用的模型"""
        return self.default_model

    # OpenCode 内置 agent 的中文展示信息
    _BUILTIN_DISPLAY: Dict[str, Dict[str, str]] = {
        "build": {
            "display_name": "Build · 构建",
            "description": "默认模式，全工具权限，可读写文件、执行命令",
        },
        "plan": {
            "display_name": "Plan · 规划",
            "description": "只读模式，用于分析代码和制定方案，不会修改文件",
        },
    }

    # oh-my-openagent 各 agent 的中文展示信息（key 为小写 agent 名）
    _OHM_DISPLAY: Dict[str, Dict[str, str]] = {
        "sisyphus": {
            "display_name": "Sisyphus · 总协调",
            "description": "主协调者，并行调度其他 agent，驱动任务完成",
        },
        "hephaestus": {
            "display_name": "Hephaestus · 深度工作",
            "description": "自主深度工作者，端到端探索和执行代码任务",
        },
        "prometheus": {
            "display_name": "Prometheus · 战略规划",
            "description": "动手前先与你确认任务范围和策略",
        },
        "oracle": {
            "display_name": "Oracle · 架构调试",
            "description": "架构设计与调试专家",
        },
        "librarian": {
            "display_name": "Librarian · 文档搜索",
            "description": "文档查找与代码搜索专家",
        },
        "explore": {
            "display_name": "Explore · 快速探索",
            "description": "快速代码库 grep 与文件浏览",
        },
        "multimodal looker": {
            "display_name": "Multimodal Looker · 视觉分析",
            "description": "图片与多模态内容分析",
        },
        "multimodal_looker": {
            "display_name": "Multimodal Looker · 视觉分析",
            "description": "图片与多模态内容分析",
        },
    }

    # 用于检测 oh-my-openagent 是否已安装的特征 agent 名（小写）
    _OHM_SIGNATURE = {"sisyphus", "hephaestus", "prometheus"}

    def _builtin_agents(self) -> List[Dict[str, Any]]:
        """返回 OpenCode 内置 agent 列表（附中文展示信息）"""
        return [
            {**{"name": k}, **v}
            for k, v in self._BUILTIN_DISPLAY.items()
        ]

    async def list_agents(self) -> List[Dict[str, Any]]:
        """列出用户可见的 agent。

        - 未安装 oh-my-openagent：仅返回 build / plan（附中文描述）
        - 已安装 oh-my-openagent：仅返回 oh-my-openagent 的 agent（附中文描述）
        """
        started = await self._ensure_server()
        if not started or self._client is None:
            return self._builtin_agents()
        try:
            response = await self._client.get("/agent")
            if response.status_code != 200:
                return self._builtin_agents()
            all_agents = response.json()

            # 检测 oh-my-openagent 是否已安装
            names_lower = {a.get("name", "").lower() for a in all_agents}
            if names_lower & self._OHM_SIGNATURE:
                # 仅展示 oh-my-openagent 的 agent
                result = []
                for a in all_agents:
                    key = a.get("name", "").lower()
                    if key in self._OHM_DISPLAY:
                        display = self._OHM_DISPLAY[key]
                        result.append({
                            "name": a["name"],
                            "display_name": display["display_name"],
                            "description": display["description"],
                        })
                return result
            else:
                return self._builtin_agents()
        except Exception as e:
            if self.logger:
                self.logger.warning(f"list_agents 失败: {e}")
            return self._builtin_agents()

    async def switch_agent(self, agent_id: str) -> bool:
        """切换当前使用的 agent"""
        self.config["default_agent"] = agent_id
        if self.logger:
            self.logger.info(f"切换到 agent: {agent_id}")
        return True

    def get_current_agent(self) -> str:
        """获取当前使用的 agent"""
        return self.default_agent
