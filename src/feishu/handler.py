"""飞书消息处理器"""

import asyncio
import logging
import os
import time
from typing import Optional, List, Dict, Tuple, Any

from .client import FeishuMessage, FeishuClient
from .api import FeishuAPI
from .formatter import parse_mention
from .dedup import MessageDeduplicator
from .message_parser import MessageParser
from .command_router import CommandRouter, CommandType
from .card_callback_handler import CardCallbackHandler
from ..adapters import create_adapter, BaseCLIAdapter
from ..adapters.base import Message, TokenStats
from ..config import Config
from ..tui_commands import create_router, TUIResultType
from ..tui_commands.base import CommandContext
from ..tui_commands.project import is_project_command, execute_project_command
from ..project.manager import ProjectManager

logger = logging.getLogger(__name__)


class MessageHandler:
    """飞书消息处理器"""

    def __init__(
        self,
        config: Config,
        feishu_api: FeishuAPI,
        project_manager: Optional[ProjectManager] = None,
    ):
        self.config = config
        self.api = feishu_api
        self.project_manager = project_manager
        self.bot_user_id: Optional[str] = None
        self.adapters: dict = {}
        self.dedup = MessageDeduplicator()  # 消息去重
        self.tui_router = create_router()  # TUI 命令路由器

        # Issue #52: 用于跟踪当前正在进行的 AI 生成任务
        self._current_generation_lock = asyncio.Lock()
        self._current_generation_task: Optional[asyncio.Task] = None
        self._stop_event: Optional[asyncio.Event] = None

        # 初始化新组件
        self.message_parser = MessageParser()
        self.command_router = CommandRouter(self.tui_router, project_manager)
        self.card_handler = CardCallbackHandler(
            project_manager=project_manager,
            adapters=self.adapters,
            api=feishu_api,
            tui_router=self.tui_router,
        )

        # 初始化启用的适配器
        for cli_type, cli_config in config.cli.items():
            if cli_config.enabled:
                try:
                    adapter = create_adapter(
                        cli_type,
                        {
                            "command": cli_config.command,
                            "default_model": cli_config.default_model,
                            "timeout": cli_config.timeout,
                            "models": cli_config.models,
                        },
                    )
                    adapter.logger = logger
                    self.adapters[cli_type] = adapter
                    # 注册适配器到 TUI 路由器
                    self.tui_router.register_adapter(cli_type, adapter)
                    logger.info(f"Loaded adapter: {cli_type}")
                except Exception as e:
                    logger.error(f"Failed to load adapter {cli_type}: {e}")

        # 更新 card_handler 的 adapters 引用
        self.card_handler.adapters = self.adapters

    def _detect_cli_type(self, content: str) -> Optional[str]:
        """
        检测用户想要使用的 CLI 类型
        优先级：opencode > codex
        """
        content_lower = content.lower()

        # 检查是否明确指定
        if "@opencode" in content_lower or "使用opencode" in content_lower:
            return "opencode" if "opencode" in self.adapters else None

        if "@codex" in content_lower or "使用codex" in content_lower:
            return "codex" if "codex" in self.adapters else None

        # 默认使用第一个启用的适配器
        if "opencode" in self.adapters:
            return "opencode"
        if "codex" in self.adapters:
            return "codex"

        return None

    async def _get_working_dir(self) -> str:
        """获取工作目录：优先使用当前激活项目路径，否则使用进程工作目录"""
        if self.project_manager:
            project = await self.project_manager.get_current_project()
            if project and project.exists():
                return str(project.path)
        import os

        return os.getcwd()

    async def _get_session_context(
        self, adapter: Optional[BaseCLIAdapter] = None, working_dir: str = ""
    ) -> Tuple[str, str]:
        """获取会话上下文（工作目录和当前会话ID）

        Args:
            adapter: CLI适配器，如果提供则用于获取当前会话ID
            working_dir: 可选的工作目录，如果为空则从项目获取

        Returns:
            (working_dir, current_session_id) 元组
        """
        # 确定工作目录
        if not working_dir and self.project_manager:
            current_project = await self.project_manager.get_current_project()
            working_dir = str(current_project.path) if current_project else ""

        # 获取当前会话ID
        current_session_id = ""
        if adapter and hasattr(adapter, "get_session_id"):
            current_session_id = adapter.get_session_id(working_dir) or ""

        return working_dir, current_session_id

    async def _build_session_data_list(
        self,
        adapter: BaseCLIAdapter,
        working_dir: str,
        current_session_id: str,
    ) -> List[Dict[str, Any]]:
        """构建会话数据列表（用于会话列表卡片）

        Args:
            adapter: CLI适配器
            working_dir: 工作目录，用于过滤会话
            current_session_id: 当前会话ID，用于标记当前会话

        Returns:
            会话数据字典列表
        """
        session_data_list: List[Dict[str, Any]] = []

        if not hasattr(adapter, "list_sessions"):
            return session_data_list

        try:
            # 使用 directory 参数进行规范化路径匹配
            filtered_sessions = await adapter.list_sessions(limit=20, directory=working_dir)
            for session in filtered_sessions:
                sid = session.get("id", "")
                slug = session.get("slug", "")
                display_id = slug if slug else sid[-8:] if len(sid) >= 8 else sid
                session_data_list.append({
                    "session_id": sid,
                    "display_id": display_id,
                    "title": session.get("title", "未命名会话"),
                    "created_at": session.get("created_at", 0),
                    "updated_at": session.get("updated_at", 0),
                    "is_current": sid == current_session_id,
                })
        except Exception as e:
            logger.warning(f"构建会话列表失败: {e}")

        return session_data_list

    async def handle_message(self, event_data: dict):
        """
        处理飞书消息事件

        Args:
            event_data: 飞书事件数据字典
        """
        # 解析事件数据
        message = self.message_parser.parse_event_data(event_data)
        if not message:
            logger.warning("⚠️ 无法解析事件数据")
            return

        logger.info(
            f"📨 处理消息 from {message.sender_name}: {message.content[:50]}..."
        )

        # 1. 消息去重检查
        if self.dedup.is_duplicate(message.message_id):
            logger.debug(f"⏭️ 消息 {message.message_id} 已处理过，跳过")
            return

        # 下载附件（图片/文件）
        if message.attachments:
            resolved = await self._download_attachments(
                message.message_id, message.attachments
            )
            message.attachments = resolved if resolved else None

        # 路由命令
        content = message.content.strip()
        cmd_type, extra = self.command_router.route(
            content=content,
            sender_id=message.sender_id,
            chat_id=message.chat_id,
            parent_id=message.parent_id,
            available_adapters=self.adapters,
        )

        # 根据命令类型分发处理
        if cmd_type == CommandType.INTERACTIVE_REPLY:
            await self._handle_interactive_reply(message)
            return

        if cmd_type == CommandType.PROJECT_COMMAND:
            await self._handle_project_command(content, message)
            return

        if cmd_type == CommandType.TUI_COMMAND:
            await self._handle_tui_command(content, message)
            return

        if cmd_type == CommandType.UNKNOWN:
            if not content:
                return
            await self.api.send_text(
                message.chat_id,
                "⚠️ 没有可用的 CLI 工具。请确保已安装 opencode 或 codex。",
            )
            return

        # AI 消息处理
        await self._handle_ai_message(content, message, extra.get("cli_type"))

    async def _handle_ai_message(self, content: str, message, cli_type: str):
        """处理 AI 消息（非命令类消息）"""
        # 清理命令前缀
        content = self.command_router.clean_cli_prefix(content)

        # 获取工作目录
        working_dir = await self._get_working_dir()

        # 获取适配器
        adapter = self.adapters.get(cli_type)
        if not adapter:
            await self.api.send_text(
                message.chat_id, f"⚠️ CLI 工具 {cli_type} 未启用或加载失败。"
            )
            return

        # Issue #52: 初始化停止事件
        self._stop_event = asyncio.Event()

        # 给用户消息添加"打字中"表情反应
        typing_reaction_id = await self.api.add_typing_reaction(message.message_id)

        try:
            # 获取当前会话 ID（_get_or_create_session 会自动从服务器恢复或创建）
            session_id = adapter.get_session_id(working_dir) if hasattr(adapter, "get_session_id") else None

            # 从 OpenCode 获取消息历史作为上下文
            history: List[Message] = []
            if session_id and hasattr(adapter, "get_session_messages"):
                history = await adapter.get_session_messages(session_id)
                if len(history) > self.config.session.max_history * 2:
                    history = history[-self.config.session.max_history * 2 :]

            # Issue #52: 使用 stop_event 包装 stream 以支持中断
            async def tracked_stream():
                """包装 stream 以支持停止检测"""
                raw_stream = adapter.execute_stream(
                    prompt=content,
                    context=history,
                    working_dir=working_dir,
                    attachments=message.attachments,
                )
                async for chunk in raw_stream:
                    # 检查是否收到停止信号
                    if self._stop_event and self._stop_event.is_set():
                        logger.info("AI 流式输出被用户停止")
                        break
                    yield chunk

            # 执行 CLI 命令（使用包装后的 stream）
            stream = tracked_stream()

            # 统计信息提供者
            def get_stats(full_content: str) -> TokenStats:
                stats = adapter.get_stats(history, full_content)
                return stats

            # Issue #52: 创建并跟踪生成任务
            generation_task = asyncio.create_task(
                self.api.stream_reply(
                    chat_id=message.chat_id,
                    stream=stream,
                    stats_provider=get_stats,
                    model=adapter.default_model,
                    reply_to_message_id=message.message_id,
                )
            )

            async with self._current_generation_lock:
                self._current_generation_task = generation_task

            try:
                # 等待生成完成或取消
                full_response = await generation_task
            except asyncio.CancelledError:
                logger.info("生成任务被取消")
                full_response = ""
            finally:
                async with self._current_generation_lock:
                    self._current_generation_task = None

            # 流完成后，从适配器获取当前实际使用的 session_id（可能是新建的）
            current_session_id = (
                adapter.get_session_id(working_dir)
                if hasattr(adapter, "get_session_id")
                else session_id
            ) or session_id

            # Issue #54: 添加日志以便调试标题生成问题
            logger.debug(f"Issue #54: current_session_id={current_session_id[:8] if current_session_id else None}, working_dir={working_dir}")

            # 检测是否需要自动生成会话标题（标题还是临时生成名时替换）
            should_generate_title = False
            if current_session_id:
                # Issue #54 Fix: 直接从适配器的本地缓存获取会话标题
                # 避免依赖 list_sessions 返回的数据（可能不包含 title 字段）
                current_title = None
                if hasattr(adapter, "_sessions"):
                    session_obj = adapter._sessions.get(working_dir)
                    if session_obj:
                        current_title = getattr(session_obj, "title", None)
                        logger.debug(f"Issue #54: Got title from adapter._sessions cache: '{current_title}'")

                # 如果本地缓存没有，尝试从 list_sessions 获取（备用）
                if not current_title and hasattr(adapter, "list_sessions"):
                    sessions = await adapter.list_sessions(limit=20)
                    logger.debug(f"Issue #54: list_sessions returned {len(sessions)} sessions")
                    for s in sessions:
                        if s.get("id") == current_session_id:
                            current_title = s.get("title", "")
                            logger.debug(f"Issue #54: Got title from list_sessions: '{current_title}'")
                            break
                    else:
                        logger.warning(f"Issue #54: current_session_id {current_session_id[:8]}... not found in {len(sessions)} sessions")

                # 检查标题是否需要更新
                if current_title and current_title.startswith("Feishu Bridge "):
                    should_generate_title = True
                    logger.info(f"Issue #54: Will auto-generate title for session {current_session_id[:8]}... (current title='{current_title}')")
                elif current_title:
                    logger.debug(f"Issue #54: Session {current_session_id[:8]}... title '{current_title}' does not start with 'Feishu Bridge ', skipping")
                else:
                    logger.warning(f"Issue #54: Could not get title for session {current_session_id[:8]}..., skipping auto-title")
            else:
                logger.debug(f"Issue #54: Skip title generation - current_session_id is None")

            if should_generate_title and full_response:
                # 异步生成标题（不阻塞主流程）
                asyncio.create_task(
                    self._auto_generate_session_title(
                        current_session_id,
                        content,
                        full_response,
                        working_dir,
                        adapter,
                        message.chat_id,
                    )
                )

        except Exception as e:
            logger.exception("Error processing message")
            await self.api.send_text(message.chat_id, f"❌ 处理失败: {str(e)}")
        finally:
            # 移除"打字中"表情反应
            await self.api.remove_typing_reaction(
                message.message_id, typing_reaction_id
            )
            # Issue #52: 重置停止事件
            self._stop_event = None

    async def _download_attachments(
        self, message_id: str, pending: List[Dict]
    ) -> List[Dict]:
        """下载待处理附件，返回带 path 字段的附件列表"""
        result = []
        for att in pending:
            path = await self.api.download_message_resource(
                message_id=message_id,
                file_key=att["file_key"],
                resource_type=att["resource_type"],
                filename=att["filename"],
            )
            if path:
                result.append(
                    {
                        "path": path,
                        "mime_type": att["mime_type"],
                        "filename": att["filename"],
                    }
                )
            else:
                logger.warning(f"Failed to download attachment: {att['file_key']}")
        return result

    async def _handle_reset(self, message: FeishuMessage):
        """处理重置命令 - 在 OpenCode 中重置当前会话"""
        working_dir = await self._get_working_dir()

        # 获取当前适配器
        cli_type = self._detect_cli_type("")
        if not cli_type:
            await self.api.send_text(message.chat_id, "⚠️ 没有可用的 CLI 工具")
            return

        adapter = self.adapters.get(cli_type)
        if not adapter:
            await self.api.send_text(message.chat_id, f"⚠️ CLI 工具 {cli_type} 未启用")
            return

        # 调用适配器重置会话
        if hasattr(adapter, "reset_session"):
            success = await adapter.reset_session()
            if success:
                await self.api.send_text(
                    message.chat_id,
                    f"✅ 已重置当前会话\n\n🗑️ 对话历史已清空\n💡 可以开始新的对话了",
                )
            else:
                await self.api.send_text(message.chat_id, "❌ 重置会话失败")
        else:
            await self.api.send_text(message.chat_id, "⚠️ 当前适配器不支持重置会话")

    async def _handle_help(self, message: FeishuMessage):
        """处理帮助命令"""
        help_text = """🤖 **飞书 CLI Bridge 使用指南**

**基本用法：**
直接发送消息即可，支持文本、图片、文件

**支持的 CLI 工具：**
• **OpenCode** — 默认使用
• **Codex** — `@codex` 指定

**会话 & 模型命令：**
• `/new` — 创建新会话
• `/session` — 列出会话，回复数字切换
• `/model` — 列出模型，回复 ID 切换
• `/reset` 或 `/clear` — 清空当前会话上下文
• `/stop` — 停止当前正在进行的 AI 生成

**项目管理命令：**
• `/pa <路径> [名称]` — 添加项目
• `/pc <路径> [名称]` — 创建并添加项目
• `/pl` — 项目列表（点击切换按钮）
• `/ps <标识>` — 切换项目
• `/pi` — 查看当前项目信息

**提示：**
• 每个项目目录对应独立 AI 会话
• 切换项目后工具调用自动在对应目录执行
"""
        await self.api.send_text(message.chat_id, help_text)

    async def _handle_stop(self, message: FeishuMessage):
        """处理停止命令 - 停止当前正在进行的 AI 生成

        Issue #52: 实现 /stop 命令强制停止模型输出
        """
        async with self._current_generation_lock:
            # 检查是否有正在进行的生成任务
            if self._current_generation_task is None or self._current_generation_task.done():
                await self.api.send_text(
                    message.chat_id,
                    "ℹ️ 当前没有正在进行的 AI 生成",
                )
                return

            # 设置停止事件，通知流式输出停止
            if self._stop_event is not None:
                self._stop_event.set()
                logger.info("用户触发 /stop 命令，停止 AI 生成")

            # 同时尝试调用适配器的 stop_generation 方法（针对 OpenCode SSE 流）
            cli_type = self._detect_cli_type("")
            if cli_type:
                adapter = self.adapters.get(cli_type)
                if adapter and hasattr(adapter, "stop_generation"):
                    try:
                        await adapter.stop_generation()
                    except Exception as e:
                        logger.warning(f"调用适配器 stop_generation 失败: {e}")

            # 取消当前任务
            self._current_generation_task.cancel()

        # 发送确认消息
        await self.api.send_text(
            message.chat_id,
            "🛑 已停止 AI 生成",
        )

    async def _handle_interactive_reply(self, message: FeishuMessage):
        """处理交互式消息的回复

        Args:
            message: 飞书消息对象
        """
        try:
            # 处理回复（CLI 类型由交互式消息管理器自动识别）
            result = await self.tui_router.handle_reply(
                reply_content=message.content,
                user_id=message.sender_id,
                chat_id=message.chat_id,
                reply_to_message_id=message.parent_id,
            )

            if result:
                if result.type == TUIResultType.TEXT:
                    await self.api.send_text(message.chat_id, result.content)
                elif result.type == TUIResultType.ERROR:
                    await self.api.send_text(message.chat_id, f"❌ {result.content}")
                elif result.type in (TUIResultType.CARD, TUIResultType.INTERACTIVE):
                    # 如果 metadata 中包含 card_json，直接使用
                    if result.metadata and "card_json" in result.metadata:
                        card_data = result.metadata["card_json"]
                        await self.api.send_card_message(message.chat_id, card_data)
                    else:
                        from .card_builder import build_card_content

                        card_data = build_card_content(
                            "complete", {"text": result.content, "metadata": {}}
                        )
                        await self.api.send_card_message(message.chat_id, card_data)

        except Exception as e:
            logger.exception("Error processing interactive reply")
            await self.api.send_text(message.chat_id, f"❌ 处理失败: {str(e)}")

    async def _handle_project_command(self, content: str, message: FeishuMessage):
        """处理项目管理命令 (/pa /pc /pl /ps /prm /pi)"""
        if not self.project_manager:
            await self.api.send_text(message.chat_id, "⚠️ 项目管理功能未启用")
            return
        try:
            result = await execute_project_command(content, self.project_manager)
            if result.type == TUIResultType.ERROR:
                await self.api.send_text(message.chat_id, f"❌ {result.content}")
            elif result.type == TUIResultType.CARD:
                card = result.metadata.get("card_json")
                if card:
                    await self.api.send_card_message(message.chat_id, card)
                else:
                    await self.api.send_text(message.chat_id, result.content)
            else:
                await self.api.send_text(message.chat_id, result.content)
        except Exception as e:
            logger.exception("处理项目命令失败")
            await self.api.send_text(message.chat_id, f"❌ 项目命令执行失败: {e}")

    async def handle_card_callback(self, event_data: dict) -> dict:
        """处理卡片按钮点击回调（im.card.action.trigger_v1）

        Args:
            event_data: 卡片回调事件数据（由 FeishuClient._on_card_action_trigger 构建）

        Returns:
            响应字典，可含 toast / update_card 字段
        """
        # 委托给 CardCallbackHandler
        return await self.card_handler.handle(event_data)

    async def _handle_tui_command(self, content: str, message: FeishuMessage):
        """处理 TUI 命令

        Args:
            content: 命令内容
            message: 飞书消息对象
        """
        # Issue #52: 优先处理 /stop 命令（不依赖 CLI 类型）
        content_stripped = content.strip().lower()
        if content_stripped == "/stop":
            await self._handle_stop(message)
            return

        # 检测 CLI 类型
        cli_type = self._detect_cli_type(content)
        if not cli_type:
            await self.api.send_text(
                message.chat_id,
                "⚠️ 没有可用的 CLI 工具。请确保已安装 opencode 或 codex。",
            )
            return

        # 清理命令前缀
        for prefix in [
            "@opencode",
            "@codex",
            "使用opencode",
            "使用codex",
        ]:
            if content.lower().startswith(prefix.lower()):
                content = content[len(prefix) :].strip()

        # 获取适配器
        adapter = self.adapters.get(cli_type)
        if not adapter:
            await self.api.send_text(
                message.chat_id, f"⚠️ CLI 工具 {cli_type} 未启用或加载失败。"
            )
            return

        # 获取工作目录和会话 ID（从适配器内存缓存获取，无则为 None）
        working_dir = await self._get_working_dir()
        session_id = (
            adapter.get_session_id(working_dir)
            if hasattr(adapter, "get_session_id")
            else None
        )

        # 获取当前项目信息
        current_project = (
            await self.project_manager.get_current_project()
            if self.project_manager
            else None
        )

        # 创建命令上下文
        context = CommandContext(
            user_id=message.sender_id,
            chat_id=message.chat_id,
            cli_type=cli_type,
            working_dir=working_dir,
            session_id=session_id,
            current_model=adapter.get_current_model(),
            project_name=current_project.name if current_project else None,
            project_display_name=current_project.display_name
            if current_project
            else None,
        )

        try:
            # 执行 TUI 命令
            result = await self.tui_router.execute(content, cli_type, context)

            if not result:
                await self.api.send_text(message.chat_id, f"❌ 无法执行命令: {content}")
                return

            # 根据结果类型发送回复
            if result.type == TUIResultType.ERROR:
                await self.api.send_text(message.chat_id, f"❌ {result.content}")

            elif result.type == TUIResultType.TEXT:
                await self.api.send_text(message.chat_id, result.content)

            elif result.type == TUIResultType.CARD:
                # 发送卡片消息：优先使用 metadata 中的预构建卡片
                card_json = result.metadata.get("card_json")
                if card_json:
                    await self.api.send_card_message(message.chat_id, card_json)
                else:
                    from .card_builder import build_card_content

                    card_data = build_card_content(
                        "complete", {"text": result.content, "metadata": {}}
                    )
                    await self.api.send_card_message(message.chat_id, card_data)

            elif result.type == TUIResultType.INTERACTIVE:
                # 发送交互式消息
                from .card_builder import build_card_content

                card_data = build_card_content(
                    "complete",
                    {
                        "text": result.content,
                        "metadata": {},
                    },
                )
                # 发送并获取消息 ID
                msg_id = await self.api.send_card_message(message.chat_id, card_data)

                # 注册交互式消息
                if msg_id and result.interactive_id:
                    self.tui_router.register_interactive(
                        message_id=msg_id,
                        interactive_id=result.interactive_id,
                        user_id=message.sender_id,
                        chat_id=message.chat_id,
                        cli_type=cli_type,
                        metadata=result.metadata,
                    )
        except Exception as e:
            logger.exception("Error processing TUI command")
            await self.api.send_text(message.chat_id, f"❌ 命令执行失败: {str(e)}")

    async def _auto_generate_session_title(
        self,
        session_id: str,
        user_msg: str,
        assistant_msg: str,
        working_dir: str,
        adapter: BaseCLIAdapter,
        chat_id: str,
    ):
        """自动生成会话标题（异步后台执行）

        Issue #54: Session 名称自动更新为首次对话内容
        使用 OpenCode API PATCH /session/{id} 来设置标题。
        基于首条用户消息生成标题，去除标点，截取前20个字符。

        Args:
            session_id: 会话ID
            user_msg: 用户消息
            assistant_msg: AI回复内容（预留，当前未使用）
            working_dir: 工作目录
            adapter: CLI适配器
            chat_id: 飞书聊天ID（用于发送toast）
        """
        try:
            # 检查适配器是否支持重命名
            if not hasattr(adapter, "rename_session"):
                logger.debug(f"Adapter {adapter.name} does not support rename_session")
                return

            # Issue #54: 使用适配器的 generate_fallback_title 方法生成更干净的标题
            if hasattr(adapter, "generate_fallback_title"):
                title = adapter.generate_fallback_title(user_msg)
            else:
                # 兑底：简单截断前30字符
                title = user_msg[:30] + "..." if len(user_msg) > 30 else user_msg
            if not title:
                title = f"会话_{time.strftime('%m%d_%H%M')}"

            # 调用 OpenCode API 重命名会话
            success = await adapter.rename_session(session_id, title)
            if success:
                logger.info(f"Session {session_id[:8]}... auto-titled: '{title}'")
                # 可选：发送通知给用户
                # try:
                #     await self.api.send_text(
                # #         chat_id, f"✅ 会话已自动命名：**{title}**"
                # #     )
                # except Exception as e:
                #     logger.warning(f"Failed to send title notification: {e}")
            else:
                logger.warning(f"Failed to rename session {session_id[:8]}...")

        except Exception as e:
            logger.error(f"Error in auto-generating session title: {e}")
