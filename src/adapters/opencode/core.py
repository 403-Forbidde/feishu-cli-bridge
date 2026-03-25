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

from ..base import BaseCLIAdapter, StreamChunk, StreamChunkType, Message, TokenStats


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
    """OpenCode Server 进程管理器（单实例，工作目录隔离通过 session directory 参数实现）

    Note: 此类不管理自己的并发锁，调用者（OpenCodeAdapter）负责并发控制。
    Issue #45: 移除内部锁避免嵌套锁绑定到不同事件循环的问题。
    """

    def __init__(self, port: int = 4096, hostname: str = "127.0.0.1", logger=None):
        self.port = port
        self.hostname = hostname
        self.base_url = f"http://{hostname}:{port}"
        self.process: Optional[asyncio.subprocess.Process] = None
        self._is_running = False
        self._logger = logger

    async def start(self) -> bool:
        """启动 OpenCode Server（调用者负责并发控制）"""
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

            # 等待服务启动，使用指数退避策略（100ms -> 200ms -> 400ms ... 最大1s）
            start_time = time.time()
            delay = 0.1  # 初始延迟 100ms
            timeout = 10.0  # 总超时 10 秒

            while time.time() - start_time < timeout:
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

                # 检查服务健康状态
                if await self._check_health():
                    self._is_running = True
                    if self._logger:
                        self._logger.info(
                            f"opencode serve 启动成功，耗时 {(time.time() - start_time)*1000:.0f}ms"
                        )
                    return True

                # 指数退避等待
                await asyncio.sleep(delay)
                delay = min(delay * 2, 1.0)  # 翻倍，但不超过 1 秒

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
        """停止 OpenCode Server（调用者负责并发控制）"""
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
        # 懒初始化锁，避免在 __init__ 中绑定到错误的事件循环（Issue #45）
        self._sessions_lock: Optional[asyncio.Lock] = None
        # 当前活跃工作目录（TUI 命令使用）
        self._active_working_dir: str = ""
        # Context window 缓存（Issue #40: 从 API 动态获取）
        self._context_window_cache: Dict[str, Tuple[int, float]] = {}
        # 缓存格式: {model_id: (context_window, timestamp)}
        # 缓存 TTL: 10 分钟
        self._context_window_cache_ttl: float = 600.0

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
        """获取模型的 context window 大小

        优先从 API 缓存获取，如果缓存不存在或过期则使用硬编码默认值。
        这是同步属性，异步更新缓存需调用 refresh_context_window_cache()。

        Issue #40: 从硬编码改为优先使用 API 动态获取的值，解决百分比计算不准确问题。
        """
        model = self.default_model

        # 1. 先检查缓存（同步，无需等待）
        cached = self._context_window_cache.get(model)
        if cached:
            window, timestamp = cached
            if time.time() - timestamp < self._context_window_cache_ttl:
                return window

        # 2. 缓存未命中或已过期，使用硬编码默认值
        model_lower = model.lower()
        if "kimi" in model_lower or "claude" in model_lower:
            return 200000
        elif "gpt-4" in model_lower or "gpt4" in model_lower:
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
        # 尝试获取锁，如果绑定到不同事件循环则重新创建（Issue #45）
        for attempt in range(3):  # 增加到3次尝试
            try:
                # 每次尝试都检查并创建锁，确保绑定到当前事件循环
                if attempt > 0 or self._server_lock is None:
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
            except RuntimeError as e:
                if "bound to a different event loop" in str(e):
                    if self.logger:
                        self.logger.warning(
                            f"_ensure_server: 锁绑定到不同事件循环，"
                            f"尝试 {attempt + 1}/3，重新创建锁和 client"
                        )
                    self._server_lock = None  # 强制重新创建锁
                    # 同时关闭并重置 client，确保它在下次重新创建时绑定到新循环
                    if self._client:
                        try:
                            await self._client.aclose()
                        except Exception:
                            pass
                        self._client = None
                    continue
                raise
        return False

    async def _get_or_create_session(
        self, working_dir: str
    ) -> Optional[OpenCodeSession]:
        """获取或创建指定工作目录的 OpenCode 会话（加锁防并发重复创建）

        内存 miss 时先查服务器已有会话（支持 bridge 重启后恢复上下文），
        找不到才创建新会话。
        """
        # 尝试获取锁，如果绑定到不同事件循环则重新创建（Issue #45）
        for attempt in range(3):  # 增加到3次尝试
            try:
                # 每次尝试都检查并创建锁，确保绑定到当前事件循环
                if attempt > 0 or self._sessions_lock is None:
                    self._sessions_lock = asyncio.Lock()

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
                                    s for s in all_sessions if s.get("directory") == working_dir
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
            except RuntimeError as e:
                if "bound to a different event loop" in str(e):
                    if self.logger:
                        self.logger.warning(
                            f"_get_or_create_session: 锁绑定到不同事件循环，"
                            f"尝试 {attempt + 1}/3，重新创建锁和 client"
                        )
                    self._sessions_lock = None  # 强制重新创建锁
                    # 同时关闭并重置 client，确保它在下次重新创建时绑定到新循环
                    if self._client:
                        try:
                            await self._client.aclose()
                        except Exception:
                            pass
                        self._client = None
                    continue
                raise
        return None

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

            # 记录所有事件类型以便诊断（使用info级别以便用户能看到）
            if self.logger and event_type not in ("message.part.delta",):
                self.logger.info(f"SSE event: type={event_type}")

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

                # 诊断：记录所有 part 类型
                if self.logger:
                    self.logger.info(
                        f"DEBUG: message.part.updated with part_type={part_type}"
                    )

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
                    if self.logger:
                        self.logger.info(
                            f"step-finish (nested) received: tokens={tokens}"
                        )
                    # OpenCode API 可能返回不同格式的 token 字段
                    total_tokens = tokens.get("total") or tokens.get("total_tokens", 0)
                    input_tokens = (
                        tokens.get("input")
                        or tokens.get("input_tokens")
                        or tokens.get("prompt_tokens", 0)
                    )
                    output_tokens = (
                        tokens.get("output")
                        or tokens.get("output_tokens")
                        or tokens.get("completion_tokens", 0)
                    )
                    context_window = self.context_window
                    context_percent = (
                        min(100.0, round(total_tokens / context_window * 100, 1))
                        if context_window > 0
                        else 0.0
                    )
                    if self.logger:
                        self.logger.info(
                            f"step-finish: total={total_tokens}, input={input_tokens}, output={output_tokens}, percent={context_percent}%"
                        )
                    state.current_stats = TokenStats(
                        prompt_tokens=input_tokens,
                        completion_tokens=output_tokens,
                        total_tokens=total_tokens,
                        context_window=context_window,
                        context_used=total_tokens,
                        context_percent=context_percent,
                        model=self.default_model,
                    )
                    return None

            # 处理独立的 step-finish 事件（不在 message.part.updated 中嵌套）
            elif event_type == "step-finish":
                tokens = properties.get("tokens", {})
                if self.logger:
                    self.logger.info(
                        f"step-finish (standalone) received: tokens={tokens}"
                    )
                # OpenCode API 可能返回不同格式的 token 字段
                total_tokens = tokens.get("total") or tokens.get("total_tokens", 0)
                input_tokens = (
                    tokens.get("input")
                    or tokens.get("input_tokens")
                    or tokens.get("prompt_tokens", 0)
                )
                output_tokens = (
                    tokens.get("output")
                    or tokens.get("output_tokens")
                    or tokens.get("completion_tokens", 0)
                )
                context_window = self.context_window
                context_percent = (
                    min(100.0, round(total_tokens / context_window * 100, 1))
                    if context_window > 0
                    else 0.0
                )
                if self.logger:
                    self.logger.info(
                        f"step-finish (standalone): total={total_tokens}, input={input_tokens}, output={output_tokens}, percent={context_percent}%"
                    )
                state.current_stats = TokenStats(
                    prompt_tokens=input_tokens,
                    completion_tokens=output_tokens,
                    total_tokens=total_tokens,
                    context_window=context_window,
                    context_used=total_tokens,
                    context_percent=context_percent,
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

        except (json.JSONDecodeError, Exception) as e:
            if self.logger:
                self.logger.debug(f"Failed to parse SSE event: {e}")
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

                    # 诊断：记录所有非内容事件的原始数据
                    raw_data = line[6:]
                    if self.logger:
                        # 记录所有事件，帮助诊断
                        event_preview = (
                            raw_data[:150] if len(raw_data) > 150 else raw_data
                        )
                        self.logger.info(f"DEBUG SSE RAW: {event_preview}")

                    chunk = self._parse_event(raw_data.encode("utf-8"), state)
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

        # Issue #40: 预加载 context window 缓存，确保后续使用准确的值
        # 如果缓存不存在或已过期，异步刷新缓存
        cached = self._context_window_cache.get(self.default_model)
        if not cached or time.time() - cached[1] >= self._context_window_cache_ttl:
            await self.refresh_context_window_cache()

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
            # ✅ Issue #40 修复：SSE 返回的是累计值，直接替换而不是累加
            self._current_stats = state.current_stats
            # 使用从 API 获取的准确 context_window 重新计算百分比
            self._current_stats.context_window = self.context_window
            self._current_stats.context_used = self._current_stats.total_tokens
            if self.context_window > 0:
                self._current_stats.context_percent = min(
                    100.0,
                    round(self._current_stats.total_tokens / self.context_window * 100, 1)
                )
            if self.logger:
                self.logger.info(
                    f"execute_stream: using SSE stats (cumulative) - "
                    f"total={self._current_stats.total_tokens}, "
                    f"percent={self._current_stats.context_percent}%"
                )
        else:
            if self.logger:
                self.logger.warning(
                    "execute_stream: no stats from SSE (step-finish not received), "
                    "fetching from API..."
                )
            await asyncio.sleep(0.3)
            stats_from_api = await self._fetch_stats_from_api(session.id)
            if stats_from_api:
                # API 返回的是会话所有历史消息的 token 总和，直接替换而不是累加
                # 因为 _fetch_stats_from_api 已经累加了会话中所有 assistant 消息的 tokens
                self._current_stats = stats_from_api
                if self.logger:
                    self.logger.info(
                        f"execute_stream: using API stats (total of all history) - "
                        f"total={self._current_stats.total_tokens}, "
                        f"percent={self._current_stats.context_percent}%"
                    )
            else:
                if self.logger:
                    self.logger.warning(
                        "execute_stream: failed to fetch stats from API, will use fallback estimation"
                    )

    def get_stats(self, context: List[Message], completion_text: str) -> TokenStats:
        """获取 Token 统计"""
        # 如果已经有统计，直接返回
        if self._current_stats:
            if self.logger:
                self.logger.info(
                    f"get_stats: returning cached stats - context_percent={self._current_stats.context_percent}%"
                )
            return self._current_stats

        # 尝试从 API 获取真实统计
        # 注意：必须在同步的 get_stats 中启动异步任务来获取 API 统计
        # 由于 get_stats 是同步方法，我们通过检查 _active_working_dir 和 _sessions 来获取当前会话
        if self.logger:
            self.logger.info("get_stats: no cached stats, will try API or fallback")

        # 兜底：基于完整对话历史 + 当前回复估算
        context_text = self.format_context(context)
        context_tokens = self.estimate_tokens(context_text) if context else 0

        # 当前回复的 token 估算
        completion_tokens = (
            self.estimate_tokens(completion_text) if completion_text else 0
        )

        # 总 token = 历史上下文 + 当前回复
        total_tokens = context_tokens + completion_tokens
        context_window = self.context_window
        context_percent = (
            min(100.0, round(total_tokens / context_window * 100, 1))
            if context_window > 0
            else 0.0
        )

        fallback_stats = TokenStats(
            prompt_tokens=context_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            context_window=context_window,
            context_used=total_tokens,
            context_percent=context_percent,
            model=self.default_model,
        )
        if self.logger:
            self.logger.info(
                f"get_stats: fallback stats - context={context_tokens}, completion={completion_tokens}, total={total_tokens}, percent={context_percent}%"
            )
        return fallback_stats

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
                # 重置 token 统计，新会话从 0 开始累积
                self._current_stats = None
                if self.logger:
                    self.logger.info(f"create_new_session: reset token stats for new session")
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
                    wd
                    for wd, sess in self._sessions.items()
                    if sess.id == session_id and wd != target_dir
                ]
                for wd in dirs_to_remove:
                    del self._sessions[wd]
                    if self.logger:
                        self.logger.info(
                            f"切换会话: 移除 {session_id[:8]}... 与 {wd} 的旧绑定"
                        )

                self._sessions[target_dir] = OpenCodeSession(
                    id=data.get("id"),
                    title=data.get("title", "已恢复会话"),
                    working_dir=target_dir,
                    slug=data.get("slug", ""),
                )
                # 重置 token 统计，切换会话后的新统计从 0 开始累积
                self._current_stats = None
                if self.logger:
                    self.logger.info(f"switch_session: reset token stats for switched session")
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
                self.logger.warning(
                    "重置会话失败: 工作目录为空，请先执行普通对话建立会话上下文"
                )
            return False

        new_session = await self._create_session(self._client, working_dir=target_dir)
        if new_session:
            self._sessions[target_dir] = new_session
            # 重置 token 统计，新会话从 0 开始累积
            self._current_stats = None
            if self.logger:
                self.logger.info(f"reset_session: reset token stats for new session")
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

    async def _fetch_stats_from_api(self, session_id: str) -> Optional[TokenStats]:
        """从 OpenCode API 获取 token 统计（SSE 未发送 step-finish 时的备用方案）

        OpenCode CLI 显示 token 统计，但可能不通过 SSE 发送 step-finish 事件。
        根据 OpenCode API 文档，token 统计在 GET /session/{id}/message 的响应中，
        每条 AssistantMessage 包含 tokens 和 cost 字段。

        Args:
            session_id: OpenCode session ID

        Returns:
            TokenStats 对象，失败返回 None
        """
        # 使用 Message API 获取 token 统计（GET /session/{id}/message）
        started = await self._ensure_server()
        if not started or self._client is None:
            return None

        try:
            response = await self._client.get(f"/session/{session_id}/message")
            if response.status_code != 200:
                if self.logger:
                    self.logger.warning(f"_fetch_stats_from_api: failed to get messages, status={response.status_code}")
                return None

            data = response.json()
            if self.logger:
                self.logger.info(f"_fetch_stats_from_api: got {len(data)} messages")
                # 调试：打印第一条消息的原始结构
                if data:
                    self.logger.info(f"_fetch_stats_from_api: first message structure keys={list(data[0].keys())}")
                    if "info" in data[0]:
                        self.logger.info(f"_fetch_stats_from_api: first message info={data[0]['info']}")
                    if "tokens" in data[0]:
                        self.logger.info(f"_fetch_stats_from_api: first message tokens={data[0]['tokens']}")

            total_input = 0
            total_output = 0
            total_tokens = 0
            found_tokens = False

            # 遍历消息，累加 assistant 消息的 token
            for item in data:
                info = item.get("info", {})
                role = info.get("role", "")
                msg_id = info.get("id", "unknown")

                # 调试：打印每条消息的基本信息
                if self.logger:
                    self.logger.debug(f"_fetch_stats_from_api: message id={msg_id}, role={role}, has_tokens={"tokens" in item}")

                # 只统计 assistant 消息的 token
                if role == "assistant":
                    # tokens 可能在 item 根级别或 info 中
                    tokens = item.get("tokens") or info.get("tokens", {})
                    if self.logger and tokens:
                        self.logger.debug(f"_fetch_stats_from_api: found tokens for assistant msg {msg_id}: {tokens}")
                    if tokens:
                        found_tokens = True
                        input_tok = tokens.get("input", 0) or tokens.get("prompt", 0)
                        output_tok = tokens.get("output", 0) or tokens.get("completion", 0)
                        total_tok = tokens.get("total", 0)

                        # 如果没有 total，使用 input + output
                        if total_tok == 0 and (input_tok > 0 or output_tok > 0):
                            total_tok = input_tok + output_tok

                        total_input += input_tok
                        total_output += output_tok
                        total_tokens += total_tok

                        if self.logger:
                            self.logger.debug(f"_fetch_stats_from_api: assistant msg tokens: input={input_tok}, output={output_tok}, total={total_tok}")

            if not found_tokens:
                if self.logger:
                    self.logger.warning("_fetch_stats_from_api: no token data found in any assistant messages")
                return None

            if total_tokens == 0:
                if self.logger:
                    self.logger.warning("_fetch_stats_from_api: total_tokens is 0 after summing")
                return None

            # Issue #40: 尝试从 API 刷新 context window 缓存
            # 如果缓存不存在或过期，会尝试从 API 获取
            cached = self._context_window_cache.get(self.default_model)
            if not cached or time.time() - cached[1] >= self._context_window_cache_ttl:
                await self.refresh_context_window_cache()

            context_window = self.context_window
            context_percent = (
                min(100.0, round(total_tokens / context_window * 100, 1))
                if context_window > 0
                else 0.0
            )

            stats = TokenStats(
                prompt_tokens=total_input,
                completion_tokens=total_output,
                total_tokens=total_tokens,
                context_window=context_window,
                context_used=total_tokens,
                context_percent=context_percent,
                model=self.default_model,
            )

            if self.logger:
                self.logger.info(
                    f"_fetch_stats_from_api: success - total={total_tokens}, "
                    f"input={total_input}, output={total_output}, percent={context_percent}%"
                )

            return stats

        except Exception as e:
            if self.logger:
                self.logger.error(f"_fetch_stats_from_api: error fetching messages: {e}")
            return None

    async def _fetch_context_window_from_api(self, provider_id: str, model_id: str) -> Optional[int]:
        """从 OpenCode API 获取指定模型的 context window（Issue #40）

        调用 GET /provider API 获取所有 provider 配置，从中提取指定模型的 limit.context。
        API 响应结构: provider.models[model_id].limit.context

        Args:
            provider_id: Provider ID (如 "kimi-for-coding")
            model_id: Model ID (如 "k2p5")

        Returns:
            Context window 大小，失败返回 None
        """
        started = await self._ensure_server()
        if not started or self._client is None:
            return None

        try:
            response = await self._client.get("/provider")
            if response.status_code != 200:
                if self.logger:
                    self.logger.warning(f"_fetch_context_window_from_api: failed to get providers, status={response.status_code}")
                return None

            data = response.json()

            # 处理 {"all": [...]} 或 [...] 两种格式
            providers = data.get("all", []) if isinstance(data, dict) else data

            # 找到指定的 provider
            for provider in providers:
                if provider.get("id") == provider_id:
                    models = provider.get("models", {})
                    model_info = models.get(model_id)
                    if model_info:
                        limit = model_info.get("limit", {})
                        context = limit.get("context")
                        if context and context > 0:
                            if self.logger:
                                self.logger.info(
                                    f"_fetch_context_window_from_api: {provider_id}/{model_id} = {context}"
                                )
                            return context

            if self.logger:
                self.logger.warning(
                    f"_fetch_context_window_from_api: context not found for {provider_id}/{model_id}"
                )
            return None

        except Exception as e:
            if self.logger:
                self.logger.error(f"_fetch_context_window_from_api: error: {e}")
            return None

    async def refresh_context_window_cache(self, model: Optional[str] = None) -> bool:
        """刷新指定模型或当前模型的 context window 缓存（Issue #40）

        从 OpenCode API 获取准确的 context window 并缓存，供同步的 context_window 属性使用。

        Args:
            model: 模型 ID (格式: provider/model)，None 则使用当前 default_model

        Returns:
            成功刷新缓存返回 True，失败返回 False
        """
        target_model = model or self.default_model

        if "/" not in target_model:
            if self.logger:
                self.logger.warning(f"refresh_context_window_cache: invalid model format: {target_model}")
            return False

        provider_id, model_id = target_model.split("/", 1)

        # 尝试从 API 获取
        context_window = await self._fetch_context_window_from_api(provider_id, model_id)

        if context_window and context_window > 0:
            # 更新缓存
            self._context_window_cache[target_model] = (context_window, time.time())
            if self.logger:
                self.logger.info(
                    f"refresh_context_window_cache: cached {target_model} = {context_window}"
                )
            return True

        # API 获取失败，使用硬编码值作为缓存（避免反复请求）
        model_lower = target_model.lower()
        if "kimi" in model_lower or "claude" in model_lower:
            fallback = 200000
        elif "gpt-4" in model_lower or "gpt4" in model_lower:
            fallback = 8192
        else:
            fallback = 128000

        self._context_window_cache[target_model] = (fallback, time.time())
        if self.logger:
            self.logger.info(
                f"refresh_context_window_cache: using fallback for {target_model} = {fallback}"
            )
        return False

    def clear_context_window_cache(self, model: Optional[str] = None) -> None:
        """清除 context window 缓存

        Args:
            model: 要清除的模型 ID，None 则清除所有缓存
        """
        if model:
            self._context_window_cache.pop(model, None)
            if self.logger:
                self.logger.info(f"clear_context_window_cache: cleared {model}")
        else:
            self._context_window_cache.clear()
            if self.logger:
                self.logger.info("clear_context_window_cache: cleared all")

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
