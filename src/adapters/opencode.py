"""OpenCode CLI 适配器 - 使用 HTTP Server API"""

import asyncio
import base64
import json
import os
import shutil
import time
from pathlib import Path
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
    slug: str = ""  # OpenCode 提供的可读会话标识


@dataclass
class StreamState:
    """流式处理状态（每轮对话独立）"""

    seen_assistant_message: bool = False
    user_text_skipped: bool = False
    emitted_text_length: int = 0
    prompt_hash: Optional[int] = None
    current_stats: Optional[TokenStats] = None


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
                    self._logger.error(
                        "找不到 opencode 可执行文件，请确认已安装并加入 PATH"
                    )
                return False

            cmd = [opencode_bin, "serve", "--port", str(self.port)]

            # 注入 OPENCODE_PERMISSION 环境变量，预授权所有外部目录访问。
            # 全局配置文件 (~/.config/opencode/opencode.json) 可能被项目级配置覆盖，
            # 或在 opencode serve 已启动后写入（对已运行进程无效），而环境变量在进程
            # 启动时即生效，是无头模式下最可靠的方式（Issue #27）。
            env = os.environ.copy()
            env["OPENCODE_PERMISSION"] = json.dumps({"external_directory": "allow"})

            try:
                self.process = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    start_new_session=True,
                    env=env,
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
        self._server_lock: Optional[asyncio.Lock] = (
            None  # 懒初始化，避免绑定到错误的事件循环
        )
        # 每个工作目录对应一个 OpenCode 会话（key = working_dir）
        self._sessions: Dict[str, OpenCodeSession] = {}
        # 在 __init__ 中初始化锁，避免懒初始化导致的并发问题（Issue #38）
        # 注意：asyncio.Lock() 需在事件循环中创建，但此处创建后会在第一个 await 前绑定到当前循环
        self._sessions_lock: Optional[asyncio.Lock] = asyncio.Lock()
        # 当前活跃工作目录（TUI 命令使用）
        self._active_working_dir: str = ""

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

    def _ensure_opencode_permissions(self) -> None:
        """确保 ~/.config/opencode/opencode.json 已预设 external_directory 权限。

        OpenCode 对工作目录以外的路径默认弹出交互式权限确认对话框（external_directory
        默认值为 "ask"）。Bridge 以无头模式运行，对话框无法响应，导致工具调用永久阻塞。

        在全局配置中预设 permission.external_directory: {"**": "allow"} 后，
        所有外部目录访问均自动批准，无需人工确认。该写入为幂等操作，不覆盖其他配置项。
        """
        config_dir = Path.home() / ".config" / "opencode"
        config_path = config_dir / "opencode.json"

        try:
            config_dir.mkdir(parents=True, exist_ok=True)

            # 读取现有配置（容忍文件不存在或格式损坏）
            existing: Dict[str, Any] = {}
            if config_path.exists():
                try:
                    with open(config_path, "r", encoding="utf-8") as f:
                        existing = json.load(f)
                except (json.JSONDecodeError, OSError):
                    existing = {}

            # 已正确设置则跳过，避免不必要的磁盘写入
            permission = existing.get("permission", {})
            if permission.get("external_directory", {}).get("**") == "allow":
                return

            # 仅合并 external_directory，保留其余所有配置
            existing.setdefault("permission", {})
            existing["permission"].setdefault("external_directory", {})
            existing["permission"]["external_directory"]["**"] = "allow"

            # 原子写入（先写 .tmp 再 rename，防止中途崩溃导致配置损坏）
            tmp_path = config_path.with_suffix(".tmp")
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(existing, f, indent=2, ensure_ascii=False)
            tmp_path.replace(config_path)

            if self.logger:
                self.logger.info(
                    f"已写入 OpenCode 全局权限配置 {config_path}: "
                    f"permission.external_directory['**'] = 'allow'"
                )
        except Exception as e:
            if self.logger:
                self.logger.warning(
                    f"写入 OpenCode 权限配置失败（工具调用可能仍需手动授权）: {e}"
                )

    async def _ensure_server(self) -> bool:
        """确保单一 OpenCode Server 正在运行"""
        if self._server_lock is None:
            self._server_lock = asyncio.Lock()
        async with self._server_lock:
            # 检查已有实例是否健康
            if (
                self._server_manager is not None
                and await self._server_manager._check_health()
            ):
                return True

            # 预设外部目录权限，防止无头模式下 TUI 对话框永久阻塞工具调用（Issue #27）
            self._ensure_opencode_permissions()

            # 启动新实例
            port = self.config.get("server_port", 4096)
            hostname = self.config.get("server_hostname", "127.0.0.1")
            self._server_manager = OpenCodeServerManager(
                port, hostname, logger=self.logger
            )

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

    async def _get_or_create_session(
        self, working_dir: str
    ) -> Optional[OpenCodeSession]:
        """获取或创建指定工作目录的 OpenCode 会话（加锁防并发重复创建）

        内存 miss 时先查服务器已有会话（支持 bridge 重启后恢复上下文），
        找不到才创建新会话。
        """
        async with self._sessions_lock:
            if working_dir in self._sessions:
                return self._sessions[working_dir]

            if self._client is None:
                return None

            # 重启恢复：从服务器查找该目录最近使用的会话
            try:
                response = await self._client.get("/session")
                if response.status_code == 200:
                    all_sessions = response.json()
                    if isinstance(all_sessions, list):
                        matching = [
                            s for s in all_sessions
                            if s.get("directory") == working_dir
                        ]
                        if matching:
                            latest = max(
                                matching,
                                key=lambda s: s.get("time", {}).get("updated", 0),
                            )
                            session = OpenCodeSession(
                                id=latest["id"],
                                title=latest.get("title", ""),
                                working_dir=working_dir,
                                slug=latest.get("slug", ""),
                            )
                            self._sessions[working_dir] = session
                            if self.logger:
                                self.logger.info(
                                    f"已从服务器恢复会话 {latest['id'][:8]}... "
                                    f"for {working_dir}"
                                )
                            return session
            except Exception as e:
                if self.logger:
                    self.logger.warning(f"查询服务器会话失败，将创建新会话: {e}")

            session = await self._create_session(self._client, working_dir=working_dir)
            if session:
                self._sessions[working_dir] = session
            return session

    def build_command(self, prompt: str, working_dir: str) -> List[str]:
        """构建命令（保留兼容性，实际不使用）"""
        return ["opencode", "run", prompt, "--format", "json", "--dir", working_dir]

    def parse_chunk(self, raw_line: bytes) -> Optional[StreamChunk]:
        """基类接口 stub — OpenCode 内部通过 _parse_event(raw_line, state) 调用"""
        return None

    def _parse_event(
        self, raw_line: bytes, state: StreamState
    ) -> Optional[StreamChunk]:
        """解析 SSE 事件数据（使用局部状态，避免多轮对话并发冲突）"""
        try:
            data = json.loads(raw_line.decode("utf-8"))
            event_type = data.get("type", "")
            properties = data.get("properties", {})

            # OpenCode 真正的流式事件：message.part.delta
            if event_type == "message.part.delta":
                field = properties.get("field", "")
                delta_text = properties.get("delta", "")

                if field == "text" and delta_text:
                    state.seen_assistant_message = True
                    state.emitted_text_length += len(delta_text)
                    return StreamChunk(type=StreamChunkType.CONTENT, data=delta_text)

            # message.part.updated 包含完整块（可能重复）
            elif event_type == "message.part.updated":
                part = properties.get("part", {})
                part_type = part.get("type", "")

                if part_type == "text":
                    text = part.get("text", "")
                    # 通过内容匹配识别用户输入：与当前 prompt 的 hash 比较
                    if not state.user_text_skipped and state.prompt_hash is not None:
                        text_hash = hash(text.strip()) if text else None
                        if text_hash == state.prompt_hash:
                            state.user_text_skipped = True
                            return None
                    # AI 回复处理
                    if text and len(text) > state.emitted_text_length:
                        new_content = text[state.emitted_text_length :]
                        state.emitted_text_length = len(text)
                        state.seen_assistant_message = True
                        return StreamChunk(
                            type=StreamChunkType.CONTENT, data=new_content
                        )
                    return None

                # 处理思考过程
                if part_type == "reasoning":
                    text = part.get("text", "")
                    if text:
                        return StreamChunk(type=StreamChunkType.REASONING, data=text)

                # 处理步骤完成（step-finish）：仅记录 token 统计，不发出 DONE
                elif part_type == "step-finish":
                    tokens = part.get("tokens", {})
                    state.current_stats = TokenStats(
                        prompt_tokens=tokens.get("input", 0),
                        completion_tokens=tokens.get("output", 0),
                        total_tokens=tokens.get("total", 0),
                        context_window=self.context_window,
                        context_used=tokens.get("input", 0),
                        model=self.default_model,
                    )
                    return None

            # session.idle：只有已经看到文字回复时才发出 DONE
            elif event_type == "session.idle":
                if state.seen_assistant_message:
                    return StreamChunk(type=StreamChunkType.DONE, data="")
                return None

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
        """创建新的 OpenCode 会话"""
        try:
            body: Dict[str, Any] = {"title": title}
            params = {"directory": working_dir} if working_dir else {}

            response = await client.post("/session", json=body, params=params)
            if response.status_code == 200:
                data = response.json()
                session_id = data.get("id")
                return OpenCodeSession(
                    id=session_id,
                    title=data.get("title", title),
                    working_dir=working_dir,
                    slug=data.get("slug", ""),
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
        """发送消息到会话"""
        try:
            parts: List[Dict[str, Any]] = [{"type": "text", "text": prompt}]

            if attachments:
                for att in attachments:
                    try:
                        with open(att["path"], "rb") as f:
                            raw = f.read()
                        b64 = base64.b64encode(raw).decode()
                        data_url = f"data:{att['mime_type']};base64,{b64}"
                        parts.append(
                            {
                                "type": "file",
                                "mime": att["mime_type"],
                                "url": data_url,
                                "filename": att["filename"],
                            }
                        )
                    except Exception as e:
                        if self.logger:
                            self.logger.warning(
                                f"Failed to encode attachment {att['path']}: {e}"
                            )

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

            params = {"directory": working_dir} if working_dir else {}

            response = await client.post(
                f"/session/{session_id}/prompt_async", json=body, params=params
            )

            return response.status_code in [200, 201, 204]

        except Exception as e:
            if self.logger:
                self.logger.error(f"Failed to send message: {e}")
            return False

    async def _listen_events(
        self,
        client: httpx.AsyncClient,
        session_id: str,
        working_dir: str,
        state: StreamState,
    ) -> AsyncIterator[StreamChunk]:
        """监听 SSE 事件流（使用局部状态）"""
        try:
            content_buffer = ""
            last_content_flush = time.monotonic()
            has_sent_first_content = False
            last_reasoning_text = ""

            params = {"directory": working_dir} if working_dir else {}
            async with client.stream("GET", "/event", params=params) as response:
                async for line in response.aiter_lines():
                    if not line.startswith("data: "):
                        continue

                    chunk = self._parse_event(line[6:].encode("utf-8"), state)
                    if not chunk:
                        continue

                    if chunk.type == StreamChunkType.CONTENT:
                        content_buffer += chunk.data
                        now = time.monotonic()
                        elapsed = now - last_content_flush

                        if not has_sent_first_content and len(content_buffer) >= 10:
                            yield StreamChunk(
                                type=StreamChunkType.CONTENT, data=content_buffer
                            )
                            content_buffer = ""
                            last_content_flush = now
                            has_sent_first_content = True
                        elif has_sent_first_content and (
                            len(content_buffer) >= 30 or elapsed >= 0.4
                        ):
                            yield StreamChunk(
                                type=StreamChunkType.CONTENT, data=content_buffer
                            )
                            content_buffer = ""
                            last_content_flush = now

                    elif chunk.type == StreamChunkType.REASONING:
                        if chunk.data and chunk.data != last_reasoning_text:
                            last_reasoning_text = chunk.data
                            yield chunk

                    else:
                        if content_buffer:
                            yield StreamChunk(
                                type=StreamChunkType.CONTENT, data=content_buffer
                            )
                            content_buffer = ""
                        yield chunk
                        if chunk.type in (StreamChunkType.DONE, StreamChunkType.ERROR):
                            return

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

        self._active_working_dir = working_dir

        session = await self._get_or_create_session(working_dir)
        if session is None:
            yield StreamChunk(
                type=StreamChunkType.ERROR, data="Failed to create session"
            )
            return

        # 创建本轮对话的独立状态（避免多轮对话并发冲突）
        state = StreamState(prompt_hash=hash(prompt.strip()))

        # 发送消息（prompt_async 返回 204 后立即监听 SSE 事件流）
        sent = await self._send_message(
            self._client, session.id, prompt, context, working_dir, attachments
        )
        if not sent:
            yield StreamChunk(
                type=StreamChunkType.ERROR, data="Failed to send message to OpenCode"
            )
            return

        # 监听流式事件（传递局部状态）
        async for chunk in self._listen_events(
            self._client, session.id, working_dir, state
        ):
            yield chunk

        # 将本轮的 token 统计保存到实例变量（供 get_stats 使用）
        if state.current_stats:
            self._current_stats = state.current_stats

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
        return ["new", "session", "model", "reset"]

    def _get_active_client_session(
        self,
    ) -> Tuple[Optional[httpx.AsyncClient], Optional[OpenCodeSession]]:
        return self._client, self._sessions.get(self._active_working_dir)

    def get_session_id(self, working_dir: str) -> Optional[str]:
        """获取指定工作目录的 OpenCode session ID

        Args:
            working_dir: 工作目录路径

        Returns:
            OpenCode session ID，如果不存在返回 None
        """
        session = self._sessions.get(working_dir)
        return session.id if session else None

    async def create_new_session(
        self, working_dir: str = ""
    ) -> Optional[Dict[str, Any]]:
        """创建新会话

        Args:
            working_dir: 工作目录，用于会话隔离。如果为空，使用当前活跃工作目录

        Returns:
            新会话信息字典，包含 id, title 等字段
            或 None（如果不支持）
        """
        started = await self._ensure_server()
        if not started or self._client is None:
            return None

        try:
            import random

            # 使用传入的 working_dir，若为空则回退到实例变量
            target_dir = working_dir if working_dir else self._active_working_dir
            if not target_dir:
                if self.logger:
                    self.logger.error("创建会话失败: 未指定工作目录")
                return None

            timestamp = time.strftime("%m%d_%H%M%S")
            random_suffix = random.randint(1000, 9999)
            title = f"Feishu Bridge {timestamp}_{random_suffix}"

            session = await self._create_session(
                self._client, title=title, working_dir=target_dir
            )

            if session:
                self._sessions[target_dir] = session
                return {
                    "id": session.id,
                    "title": session.title,
                    "created_at": session.created_at,
                    "slug": session.slug,
                }
        except Exception as e:
            if self.logger:
                self.logger.error(f"创建会话失败: {e}")
        return None

    async def list_sessions(self, limit: int = 10) -> List[Dict[str, Any]]:
        started = await self._ensure_server()
        if not started or self._client is None:
            return []

        try:
            response = await self._client.get("/session")
            if response.status_code == 200:
                data = response.json()
                sessions = data if isinstance(data, list) else data.get("items", [])
                return [
                    {
                        "id": s.get("id"),
                        "slug": s.get("slug", ""),
                        "title": s.get("title", "未命名会话"),
                        "created_at": s.get("time", {}).get("created", 0) / 1000,
                        "updated_at": s.get("time", {}).get("updated", 0) / 1000,
                        "directory": s.get("directory", ""),
                    }
                    for s in sessions[:limit]
                ]
        except Exception as e:
            if self.logger:
                self.logger.error(f"列出会话失败: {e}")
        return []

    async def switch_session(self, session_id: str, working_dir: str = "") -> bool:
        started = await self._ensure_server()
        if not started or self._client is None:
            return False

        # 使用传入的 working_dir，若为空则回退到实例变量
        target_dir = working_dir if working_dir else self._active_working_dir
        if not target_dir:
            if self.logger:
                self.logger.error("切换会话失败: 未指定工作目录")
            return False

        try:
            response = await self._client.get(f"/session/{session_id}")
            if response.status_code == 200:
                data = response.json()

                # 清理：移除其他 working_dir 指向同一 session 的映射
                # 确保一个 session 只绑定到一个 working_dir
                dirs_to_remove = [
                    wd for wd, sess in self._sessions.items()
                    if sess.id == session_id and wd != target_dir
                ]
                for wd in dirs_to_remove:
                    del self._sessions[wd]
                    if self.logger:
                        self.logger.info(f"切换会话: 移除 {session_id[:8]}... 与 {wd} 的旧绑定")

                self._sessions[target_dir] = OpenCodeSession(
                    id=data.get("id"),
                    title=data.get("title", "已恢复会话"),
                    working_dir=target_dir,
                    slug=data.get("slug", ""),
                )
                # 更新当前活跃工作目录为切换后的会话目录
                self._active_working_dir = target_dir
                if self.logger:
                    self.logger.info(
                        f"切换会话成功: {session_id} 绑定到工作目录 {target_dir}，已更新活跃工作目录"
                    )
                return True
        except Exception as e:
            if self.logger:
                self.logger.error(f"切换会话失败: {e}")
        return False

    async def reset_session(self, working_dir: str = "") -> bool:
        """重置当前会话

        Args:
            working_dir: 工作目录，如果为空则使用实例变量 _active_working_dir

        Returns:
            是否重置成功
        """
        if self._client is None:
            return False

        # 确定目标工作目录
        target_dir = working_dir or self._active_working_dir
        if not target_dir:
            # 工作目录为空，无法确定会话上下文
            if self.logger:
                self.logger.warning("重置会话失败: 工作目录为空，请先执行普通对话建立会话上下文")
            return False

        new_session = await self._create_session(
            self._client, working_dir=target_dir
        )
        if new_session:
            self._sessions[target_dir] = new_session
            if self.logger:
                self.logger.info(f"已重置会话: {new_session.id[:8]}... 绑定到 {target_dir}")
            return True
        return False

    async def rename_session(self, session_id: str, title: str) -> bool:
        """重命名会话 - PATCH /session/{id}

        Args:
            session_id: OpenCode session ID
            title: 新标题

        Returns:
            是否重命名成功
        """
        started = await self._ensure_server()
        if not started or self._client is None:
            return False

        try:
            response = await self._client.patch(
                f"/session/{session_id}", json={"title": title}
            )
            if response.status_code == 200:
                if self.logger:
                    self.logger.info(f"Renamed session {session_id[:8]}... to: {title}")
                return True
            else:
                if self.logger:
                    self.logger.error(f"Rename session failed: {response.status_code}")
        except Exception as e:
            if self.logger:
                self.logger.error(f"Rename session error: {e}")
        return False

    async def delete_session(self, session_id: str) -> bool:
        """删除会话 - DELETE /session/{id}

        Args:
            session_id: OpenCode session ID

        Returns:
            是否删除成功
        """
        started = await self._ensure_server()
        if not started or self._client is None:
            return False

        try:
            response = await self._client.delete(f"/session/{session_id}")
            if response.status_code == 200:
                # 清理本地 _sessions 中的引用
                for dir_path, session in list(self._sessions.items()):
                    if session.id == session_id:
                        del self._sessions[dir_path]
                        if self.logger:
                            self.logger.info(
                                f"Removed session {session_id[:8]}... from {dir_path}"
                            )
                        break
                return True
            else:
                if self.logger:
                    self.logger.error(f"Delete session failed: {response.status_code}")
        except Exception as e:
            if self.logger:
                self.logger.error(f"Delete session error: {e}")
        return False

    async def get_session_detail(self, session_id: str) -> Optional[Dict[str, Any]]:
        """获取会话详情（GET /session/{id}）

        Args:
            session_id: OpenCode session ID

        Returns:
            会话详情字典，失败返回 None
        """
        started = await self._ensure_server()
        if not started or self._client is None:
            return None

        try:
            response = await self._client.get(f"/session/{session_id}")
            if response.status_code == 200:
                return response.json()
        except Exception as e:
            if self.logger:
                self.logger.error(f"获取会话详情失败: {e}")
        return None

    async def get_session_messages(self, session_id: str) -> List[Message]:
        """获取会话的消息历史 - GET /session/{id}/message

        Args:
            session_id: OpenCode session ID

        Returns:
            消息列表，包含 role, content, timestamp
        """
        started = await self._ensure_server()
        if not started or self._client is None:
            return []

        try:
            response = await self._client.get(f"/session/{session_id}/message")
            if response.status_code == 200:
                data = response.json()
                messages = []
                # OpenCode 返回格式: [{ info: {...}, parts: [...] }, ...]
                for item in data:
                    info = item.get("info", {})
                    parts = item.get("parts", [])

                    role = info.get("role", "user")
                    # 合并所有 parts 的 content
                    content_parts = []
                    for part in parts:
                        if isinstance(part, dict):
                            part_content = part.get("content", "")
                            if part_content:
                                content_parts.append(part_content)

                    content = "\n".join(content_parts) if content_parts else ""
                    timestamp = info.get("createdAt", time.time())

                    if content:  # 只添加有内容的消息
                        messages.append(
                            Message(role=role, content=content, timestamp=timestamp)
                        )

                return messages
            else:
                if self.logger:
                    self.logger.error(
                        f"Get session messages failed: {response.status_code}"
                    )
        except Exception as e:
            if self.logger:
                self.logger.error(f"Get session messages error: {e}")
        return []

    async def list_models(self, provider: Optional[str] = None) -> List[Dict[str, Any]]:
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

            models.append(
                {
                    "provider": prov_id,
                    "model": model_id,
                    "name": name,
                    "full_id": full_id,
                }
            )

        return models

    async def switch_model(self, model_id: str) -> bool:
        if "/" not in model_id:
            return False
        self.config["default_model"] = model_id
        if self.logger:
            self.logger.info(f"切换到模型: {model_id}")
        return True

    def get_current_model(self) -> str:
        return self.default_model

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

    _OHM_SIGNATURE = {"sisyphus", "hephaestus", "prometheus"}

    def _builtin_agents(self) -> List[Dict[str, Any]]:
        return [{**{"name": k}, **v} for k, v in self._BUILTIN_DISPLAY.items()]

    async def list_agents(self) -> List[Dict[str, Any]]:
        started = await self._ensure_server()
        if not started or self._client is None:
            return self._builtin_agents()
        try:
            response = await self._client.get("/agent")
            if response.status_code != 200:
                return self._builtin_agents()
            all_agents = response.json()
            names_lower = {a.get("name", "").lower() for a in all_agents}
            if names_lower & self._OHM_SIGNATURE:
                result = []
                for a in all_agents:
                    key = a.get("name", "").lower()
                    if key in self._OHM_DISPLAY:
                        display = self._OHM_DISPLAY[key]
                        result.append(
                            {
                                "name": a["name"],
                                "display_name": display["display_name"],
                                "description": display["description"],
                            }
                        )
                return result
            else:
                return self._builtin_agents()
        except Exception as e:
            if self.logger:
                self.logger.warning(f"list_agents 失败: {e}")
            return self._builtin_agents()

    async def switch_agent(self, agent_id: str) -> bool:
        self.config["default_agent"] = agent_id
        if self.logger:
            self.logger.info(f"切换到 agent: {agent_id}")
        return True

    def get_current_agent(self) -> str:
        return self.default_agent

    def generate_fallback_title(self, user_msg: str) -> str:
        """根据用户首条消息生成会话标题（本地截断，无需 API 调用）

        Args:
            user_msg: 用户第一条消息

        Returns:
            str: 会话标题
        """
        if not user_msg:
            return f"新会话_{time.strftime('%m%d_%H%M')}"

        import re

        clean_msg = re.sub(r'[，。！？.,!?;:：；"\'\s]', "", user_msg)

        if len(clean_msg) > 20:
            return clean_msg[:20] + "..."
        return clean_msg if clean_msg else f"新会话_{time.strftime('%m%d_%H%M')}"
