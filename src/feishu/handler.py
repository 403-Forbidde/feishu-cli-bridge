"""飞书消息处理器"""

import asyncio
import json
import logging
import mimetypes
import time
from typing import Optional, List, Dict, Any, Tuple
from pathlib import Path

from .client import FeishuMessage, FeishuClient
from .api import FeishuAPI
from .formatter import parse_mention
from .dedup import MessageDeduplicator
from ..adapters import create_adapter, BaseCLIAdapter, StreamChunkType
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
            all_sessions = await adapter.list_sessions(limit=20)
            for session in [s for s in all_sessions if s.get("directory") == working_dir]:
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
        message = self._parse_event_data(event_data)
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

        # 解析命令
        content = message.content.strip()

        # 检测是否是回复交互式消息
        logger.debug(
            f"🔍 检查交互式回复: parent_id={message.parent_id}, content={content[:50]}"
        )

        # 方式1：通过 parent_id 匹配（用户点击"回复"）
        if message.parent_id:
            is_interactive = self.tui_router.is_interactive_reply(
                user_id=message.sender_id,
                chat_id=message.chat_id,
                reply_to_message_id=message.parent_id,
            )
            logger.debug(f"🔍 通过 parent_id 匹配: {is_interactive}")
            if is_interactive:
                await self._handle_interactive_reply(message)
                return

        # 方式2：如果没有 parent_id，尝试匹配最近的交互式消息
        # 对于某些交互类型（如 rename_session），接受任何非命令内容
        if not message.parent_id:
            # 先检查是否有等待中的 rename_session 交互
            target = self.tui_router.get_interactive_target(
                user_id=message.sender_id,
                chat_id=message.chat_id,
            )
            if target and target.interactive_id == "rename_session":
                logger.debug(f"🔍 匹配到 rename_session 交互，接受内容: {content[:50]}")
                await self._handle_interactive_reply(message)
                return

            # 对于其他交互类型，使用内容启发式匹配
            content_stripped = content.strip()
            is_digit = content_stripped.isdigit() and 1 <= int(content_stripped) <= 10
            is_model_id = "/" in content_stripped and not content_stripped.startswith("/")

            if is_digit or is_model_id:
                logger.debug(
                    f"🔍 检测到可能的交互式回复: {content_stripped}，尝试匹配最近交互式消息"
                )
                is_interactive = self.tui_router.is_interactive_reply(
                    user_id=message.sender_id,
                    chat_id=message.chat_id,
                    reply_to_message_id=None,
                )
                logger.debug(f"🔍 通过最近消息匹配: {is_interactive}")
                if is_interactive:
                    await self._handle_interactive_reply(message)
                    return

        # 优先检测项目管理命令（/pa /pc /pl /ps /prm /pi /project）
        if is_project_command(content):
            await self._handle_project_command(content, message)
            return

        # 检测是否是 TUI 命令（斜杠命令）
        if self.tui_router.is_tui_command(content):
            await self._handle_tui_command(content, message)
            return

        if not content:
            return

        # 检测是否是 TUI 命令（斜杠命令）
        if self.tui_router.is_tui_command(content):
            await self._handle_tui_command(content, message)
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

        # 获取工作目录
        working_dir = await self._get_working_dir()

        # 获取适配器
        adapter = self.adapters.get(cli_type)
        if not adapter:
            await self.api.send_text(
                message.chat_id, f"⚠️ CLI 工具 {cli_type} 未启用或加载失败。"
            )
            return

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

            # 执行 CLI 命令
            stream = adapter.execute_stream(
                prompt=content,
                context=history,  # 使用从 OpenCode 获取的历史
                working_dir=working_dir,
                attachments=message.attachments,
            )

            # 统计信息提供者
            def get_stats(full_content: str) -> TokenStats:
                stats = adapter.get_stats(history, full_content)
                return stats

            # 流式处理并发送回复（reply_to_message_id 让飞书显示原生引用气泡）
            full_response = await self.api.stream_reply(
                chat_id=message.chat_id,
                stream=stream,
                stats_provider=get_stats,
                model=adapter.default_model,
                reply_to_message_id=message.message_id,
            )

            # 流完成后，从适配器获取当前实际使用的 session_id（可能是新建的）
            current_session_id = (
                adapter.get_session_id(working_dir)
                if hasattr(adapter, "get_session_id")
                else session_id
            ) or session_id

            # 检测是否需要自动生成会话标题（标题还是临时生成名时替换）
            should_generate_title = False
            if current_session_id and hasattr(adapter, "list_sessions"):
                sessions = await adapter.list_sessions(limit=20)
                for s in sessions:
                    if s.get("id") == current_session_id:
                        title = s.get("title", "")
                        if title.startswith("Feishu Bridge "):
                            should_generate_title = True
                        break

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

    def _parse_event_data(self, event_data: dict) -> Optional[FeishuMessage]:
        """
        解析飞书事件数据为 FeishuMessage 对象

        Args:
            event_data: 飞书事件数据字典

        Returns:
            FeishuMessage 对象，解析失败返回 None
        """
        try:
            header = event_data.get("header", {})
            event = event_data.get("event", {})

            # 检查事件类型
            event_type = header.get("event_type", "")
            if event_type != "im.message.receive_v1":
                logger.debug(f"⏭️ 忽略非消息事件: {event_type}")
                return None

            sender = event.get("sender", {})
            message_data = event.get("message", {})

            # 获取发送者信息
            sender_id_obj = sender.get("sender_id", {})
            sender_id = sender_id_obj.get("open_id", "")

            # 获取消息内容
            msg_type = message_data.get("message_type", "")
            content_str = message_data.get("content", "{}")

            # 解析 content JSON
            try:
                content_obj = json.loads(content_str)
            except:
                content_obj = {"text": content_str}

            # 提取文本内容和附件元数据
            text = ""
            pending_attachments: List[Dict] = []

            if msg_type == "text":
                text = (
                    content_obj.get("text", "")
                    if isinstance(content_obj, dict)
                    else str(content_obj)
                )
            elif msg_type == "post":
                text = self._extract_text_from_post(content_obj)
                pending_attachments = self._extract_images_from_post(content_obj)
            elif msg_type == "image":
                image_key = content_obj.get("image_key", "")
                if image_key:
                    text = "[图片]"
                    pending_attachments = [
                        {
                            "file_key": image_key,
                            "resource_type": "image",
                            "filename": f"{image_key}.jpg",
                            "mime_type": "image/jpeg",
                        }
                    ]
            elif msg_type == "file":
                file_key = content_obj.get("file_key", "")
                file_name = content_obj.get("file_name", "attachment")
                if file_key:
                    mime_type, _ = mimetypes.guess_type(file_name)
                    mime_type = mime_type or "application/octet-stream"
                    text = f"[文件: {file_name}]"
                    pending_attachments = [
                        {
                            "file_key": file_key,
                            "resource_type": "file",
                            "filename": file_name,
                            "mime_type": mime_type,
                        }
                    ]

            # 获取回复的消息 ID
            parent_id = message_data.get("parent_id") or message_data.get("root_id")

            logger.debug(
                f"📄 解析消息: type={msg_type}, chat_type={message_data.get('chat_type', '')}, parent_id={parent_id}, attachments={len(pending_attachments)}"
            )

            return FeishuMessage(
                message_id=message_data.get("message_id", ""),
                chat_id=message_data.get("chat_id", ""),
                chat_type=message_data.get("chat_type", ""),
                sender_id=sender_id,
                sender_name=sender_id,  # 暂时用 ID 代替
                content=text,
                msg_type=msg_type,
                thread_id=message_data.get("thread_id"),
                mention_users=[],
                parent_id=parent_id,
                attachments=pending_attachments if pending_attachments else None,
            )

        except Exception as e:
            logger.exception(f"❌ 解析事件数据失败: {e}")
            return None

    def _extract_text_from_post(self, content: dict) -> str:
        """从富文本消息中提取文本"""
        texts = []
        content_list = content.get("content", [])
        for item in content_list:
            if isinstance(item, list):
                for sub_item in item:
                    if isinstance(sub_item, dict):
                        tag = sub_item.get("tag", "")
                        if tag == "text":
                            texts.append(sub_item.get("text", ""))
                        elif tag == "at":
                            texts.append(f"@{sub_item.get('user_name', 'user')}")
        return " ".join(texts)

    def _extract_images_from_post(self, content: dict) -> List[Dict]:
        """从富文本消息中提取嵌入图片"""
        attachments = []
        content_list = content.get("content", [])
        for item in content_list:
            if isinstance(item, list):
                for sub_item in item:
                    if isinstance(sub_item, dict) and sub_item.get("tag") == "img":
                        image_key = sub_item.get("image_key", "")
                        if image_key:
                            attachments.append(
                                {
                                    "file_key": image_key,
                                    "resource_type": "image",
                                    "filename": f"{image_key}.jpg",
                                    "mime_type": "image/jpeg",
                                }
                            )
        return attachments

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
        try:
            action = event_data.get("action", {})
            button_value = action.get("value", {})
            action_type = button_value.get("action")
            message_id = event_data.get("context", {}).get("open_message_id")

            logger.info(f"卡片回调: action={action_type}, message_id={message_id}")

            if action_type == "switch_project":
                if not self.project_manager:
                    return {
                        "toast": {
                            "type": "error",
                            "content": "项目管理功能未启用",
                            "i18n": {"zh_cn": "项目管理功能未启用"},
                        }
                    }
                project_name = button_value.get("project_name")
                if not project_name:
                    return {
                        "toast": {
                            "type": "error",
                            "content": "未指定项目",
                            "i18n": {"zh_cn": "未指定项目"},
                        }
                    }

                from ..project.models import ProjectError

                try:
                    project = await self.project_manager.switch_project(project_name)
                    logger.info(f"卡片回调切换项目成功: {project_name}")

                    # 构建更新后的项目列表卡片
                    from .card_builder import build_project_list_card

                    projects = await self.project_manager.list_projects()
                    updated_card = build_project_list_card(projects, project.name)

                    return {
                        "toast": {
                            "type": "success",
                            "content": f"✅ 已切换到: {project.display_name}",
                            "i18n": {"zh_cn": f"✅ 已切换到: {project.display_name}"},
                        },
                        "update_card": {
                            "message_id": message_id,
                            "card": updated_card,
                        },
                    }
                except ProjectError as e:
                    return {
                        "toast": {
                            "type": "error",
                            "content": e.message,
                            "i18n": {"zh_cn": e.message},
                        }
                    }

            elif action_type in (
                "delete_project_confirm",
                "delete_project_cancel",
                "delete_project_confirmed",
            ):
                if not self.project_manager:
                    return {
                        "toast": {
                            "type": "error",
                            "content": "项目管理功能未启用",
                            "i18n": {"zh_cn": "项目管理功能未启用"},
                        }
                    }
                project_name = button_value.get("project_name")
                if not project_name:
                    return {
                        "toast": {
                            "type": "error",
                            "content": "未指定项目",
                            "i18n": {"zh_cn": "未指定项目"},
                        }
                    }

                from ..project.models import ProjectError
                from .card_builder import build_project_list_card

                if action_type == "delete_project_confirm":
                    # 第一次点击：更新卡片为二次确认状态
                    projects = await self.project_manager.list_projects()
                    current = await self.project_manager.get_current_project()
                    current_name = current.name if current else None
                    updated_card = build_project_list_card(
                        projects, current_name, confirming_project=project_name
                    )
                    return {
                        "toast": {
                            "type": "warning",
                            "content": f"⚠️ 确认删除项目 {project_name}？",
                            "i18n": {"zh_cn": f"⚠️ 确认删除项目 {project_name}？"},
                        },
                        "update_card": {"message_id": message_id, "card": updated_card},
                    }

                elif action_type == "delete_project_cancel":
                    # 取消：恢复正常卡片
                    projects = await self.project_manager.list_projects()
                    current = await self.project_manager.get_current_project()
                    current_name = current.name if current else None
                    updated_card = build_project_list_card(projects, current_name)
                    return {
                        "toast": {
                            "type": "info",
                            "content": "已取消删除",
                            "i18n": {"zh_cn": "已取消删除"},
                        },
                        "update_card": {"message_id": message_id, "card": updated_card},
                    }

                else:  # delete_project_confirmed
                    # 确认删除
                    try:
                        project = await self.project_manager.get_project(project_name)
                        display_name = project.display_name if project else project_name
                        await self.project_manager.remove_project(project_name)
                        logger.info(f"卡片回调删除项目成功: {project_name}")

                        projects = await self.project_manager.list_projects()
                        current = await self.project_manager.get_current_project()
                        current_name = current.name if current else None
                        updated_card = build_project_list_card(projects, current_name)
                        return {
                            "toast": {
                                "type": "success",
                                "content": f"✅ 已删除项目: {display_name}",
                                "i18n": {"zh_cn": f"✅ 已删除项目: {display_name}"},
                            },
                            "update_card": {
                                "message_id": message_id,
                                "card": updated_card,
                            },
                        }
                    except ProjectError as e:
                        return {
                            "toast": {
                                "type": "error",
                                "content": e.message,
                                "i18n": {"zh_cn": e.message},
                            }
                        }

            elif action_type == "switch_model":
                model_id = button_value.get("model_id")
                cli_type = button_value.get("cli_type", "opencode")
                if not model_id:
                    return {
                        "toast": {
                            "type": "error",
                            "content": "未指定模型",
                            "i18n": {"zh_cn": "未指定模型"},
                        }
                    }

                adapter = self.adapters.get(cli_type)
                if not adapter or not hasattr(adapter, "switch_model"):
                    return {
                        "toast": {
                            "type": "error",
                            "content": "适配器不支持模型切换",
                            "i18n": {"zh_cn": "适配器不支持模型切换"},
                        }
                    }

                await adapter.switch_model(model_id)
                logger.info(f"卡片回调切换模型成功: {model_id}")

                # 重绘卡片，高亮新选中的模型
                models = await adapter.list_models()
                from .card_builder import build_model_select_card

                updated_card = build_model_select_card(
                    models, model_id, cli_type=cli_type
                )
                model_name = next(
                    (
                        m.get("name", model_id)
                        for m in models
                        if m.get("full_id") == model_id
                    ),
                    model_id,
                )
                return {
                    "toast": {
                        "type": "success",
                        "content": f"✅ 已切换到: {model_name}",
                        "i18n": {"zh_cn": f"✅ 已切换到: {model_name}"},
                    },
                    "update_card": {
                        "message_id": message_id,
                        "card": updated_card,
                    },
                }

            elif action_type == "switch_mode":
                agent_id = button_value.get("agent_id")
                cli_type = button_value.get("cli_type", "opencode")
                if not agent_id:
                    return {
                        "toast": {
                            "type": "error",
                            "content": "未指定 agent",
                            "i18n": {"zh_cn": "未指定 agent"},
                        }
                    }

                adapter = self.adapters.get(cli_type)
                if not adapter or not hasattr(adapter, "switch_agent"):
                    return {
                        "toast": {
                            "type": "error",
                            "content": "适配器不支持模式切换",
                            "i18n": {"zh_cn": "适配器不支持模式切换"},
                        }
                    }

                await adapter.switch_agent(agent_id)
                logger.info(f"卡片回调切换 agent 成功: {agent_id}")

                # 重绘卡片，高亮新选中的 agent
                agents = await adapter.list_agents()
                from .card_builder import build_mode_select_card

                updated_card = build_mode_select_card(
                    agents, agent_id, cli_type=cli_type
                )
                return {
                    "toast": {
                        "type": "success",
                        "content": f"✅ 已切换到: {agent_id}",
                        "i18n": {"zh_cn": f"✅ 已切换到: {agent_id}"},
                    },
                    "update_card": {
                        "message_id": message_id,
                        "card": updated_card,
                    },
                }

            elif action_type == "test_card_action":
                # Schema 2.0 测试卡片交互
                sub_action = button_value.get("sub_action")
                message_id = event_data.get("context", {}).get("open_message_id")

                logger.info(
                    f"测试卡片回调: sub_action={sub_action}, message_id={message_id}"
                )

                from .card_builder import (
                    build_test_card_v2_details,
                    build_test_card_v2_data,
                    build_test_card_v2_closed,
                )

                if sub_action == "show_details":
                    updated_card = build_test_card_v2_details()
                    return {
                        "toast": {
                            "type": "success",
                            "content": "✅ 已切换到详情视图",
                            "i18n": {"zh_cn": "✅ 已切换到详情视图"},
                        },
                        "update_card": {
                            "message_id": message_id,
                            "card": updated_card,
                        },
                    }

                elif sub_action == "show_data":
                    updated_card = build_test_card_v2_data()
                    return {
                        "toast": {
                            "type": "success",
                            "content": "✅ 已切换到数据视图",
                            "i18n": {"zh_cn": "✅ 已切换到数据视图"},
                        },
                        "update_card": {
                            "message_id": message_id,
                            "card": updated_card,
                        },
                    }

                elif sub_action == "close_test":
                    updated_card = build_test_card_v2_closed()
                    return {
                        "toast": {
                            "type": "success",
                            "content": "✅ 测试已完成",
                            "i18n": {"zh_cn": "✅ 测试已完成"},
                        },
                        "update_card": {
                            "message_id": message_id,
                            "card": updated_card,
                        },
                    }

                else:
                    return {
                        "toast": {
                            "type": "error",
                            "content": "未知操作",
                            "i18n": {"zh_cn": "未知操作"},
                        }
                    }

            elif action_type == "create_new_session":
                # 创建新会话
                cli_type = button_value.get("cli_type", "opencode")
                adapter = self.adapters.get(cli_type)
                if not adapter or not hasattr(adapter, "create_new_session"):
                    return {
                        "toast": {
                            "type": "error",
                            "content": "适配器不支持创建新会话",
                            "i18n": {"zh_cn": "适配器不支持创建新会话"},
                        }
                    }

                try:
                    # 优先使用按钮中传递的 working_dir，其次从当前项目获取
                    working_dir = button_value.get("working_dir", "")
                    if not working_dir and self.project_manager:
                        current_project = (
                            await self.project_manager.get_current_project()
                        )
                        working_dir = current_project.path if current_project else ""

                    new_session = await adapter.create_new_session(
                        working_dir=working_dir
                    )
                    new_session_id = new_session.get("id", "") if new_session else ""
                    logger.info(f"卡片回调创建新会话成功: {new_session_id}")

                    # 刷新会话列表卡片（按当前项目目录过滤）
                    session_data_list = []
                    if hasattr(adapter, "list_sessions"):
                        all_sessions = await adapter.list_sessions(limit=20)
                        for session in [s for s in all_sessions if s.get("directory") == str(working_dir)]:
                            sid = session.get("id", "")
                            slug = session.get("slug", "")
                            display_id = slug if slug else sid[-8:] if len(sid) >= 8 else sid
                            session_data_list.append({
                                "session_id": sid,
                                "display_id": display_id,
                                "title": session.get("title", "未命名会话"),
                                "created_at": session.get("created_at", 0),
                                "updated_at": session.get("updated_at", 0),
                                "is_current": sid == new_session_id,
                            })

                    from .card_builder import build_session_list_card

                    updated_card = build_session_list_card(
                        sessions=session_data_list,
                        current_session_id=new_session_id,
                        cli_type=cli_type,
                        working_dir=working_dir,
                    )

                    return {
                        "toast": {
                            "type": "success",
                            "content": "✅ 已创建新会话",
                            "i18n": {"zh_cn": "✅ 已创建新会话"},
                        },
                        "update_card": {
                            "message_id": message_id,
                            "card": updated_card,
                        },
                    }
                except Exception as e:
                    logger.exception("创建新会话失败")
                    return {
                        "toast": {
                            "type": "error",
                            "content": f"创建失败: {str(e)}",
                            "i18n": {"zh_cn": f"创建失败: {str(e)}"},
                        }
                    }

            elif action_type == "switch_session":
                # 切换会话 - 使用简化的映射架构（符合实施计划 Phase 1）
                session_id = button_value.get("session_id")
                cli_type = button_value.get("cli_type", "opencode")
                working_dir = button_value.get("working_dir", "")

                if not session_id:
                    return {
                        "toast": {
                            "type": "error",
                            "content": "未指定会话ID",
                            "i18n": {"zh_cn": "未指定会话ID"},
                        }
                    }

                adapter = self.adapters.get(cli_type)
                if not adapter or not hasattr(adapter, "switch_session"):
                    return {
                        "toast": {
                            "type": "error",
                            "content": "适配器不支持切换会话",
                            "i18n": {"zh_cn": "适配器不支持切换会话"},
                        }
                    }

                try:
                    # 使用按钮中传递的 working_dir，或从当前项目获取
                    if not working_dir:
                        current_project = (
                            await self.project_manager.get_current_project()
                        )
                        working_dir = current_project.path if current_project else ""

                    # 直接使用 session_id（就是 OpenCode 真实 ID）进行切换
                    success = await adapter.switch_session(session_id, working_dir)
                    if success:
                        logger.info(f"卡片回调切换会话成功: {session_id}")

                        # 刷新会话列表卡片（按当前项目目录过滤）
                        session_data_list = []
                        if hasattr(adapter, "list_sessions"):
                            all_sessions = await adapter.list_sessions(limit=20)
                            for session in [s for s in all_sessions if s.get("directory") == str(working_dir)]:
                                sid = session.get("id", "")
                                slug = session.get("slug", "")
                                display_id = slug if slug else sid[-8:] if len(sid) >= 8 else sid
                                session_data_list.append({
                                    "session_id": sid,
                                    "display_id": display_id,
                                    "title": session.get("title", "未命名会话"),
                                    "created_at": session.get("created_at", 0),
                                    "updated_at": session.get("updated_at", 0),
                                    "is_current": sid == session_id,
                                })

                        from .card_builder import build_session_list_card

                        updated_card = build_session_list_card(
                            sessions=session_data_list,
                            current_session_id=session_id,
                            cli_type=cli_type,
                            working_dir=working_dir,
                        )

                        return {
                            "toast": {
                                "type": "success",
                                "content": "✅ 已切换会话",
                                "i18n": {"zh_cn": "✅ 已切换会话"},
                            },
                            "update_card": {
                                "message_id": message_id,
                                "card": updated_card,
                            },
                        }
                    else:
                        return {
                            "toast": {
                                "type": "error",
                                "content": "切换会话失败",
                                "i18n": {"zh_cn": "切换会话失败"},
                            }
                        }
                except Exception as e:
                    logger.exception("切换会话失败")
                    return {
                        "toast": {
                            "type": "error",
                            "content": f"切换失败: {str(e)}",
                            "i18n": {"zh_cn": f"切换失败: {str(e)}"},
                        }
                    }

            elif action_type == "list_sessions":
                # 刷新会话列表（按当前项目目录过滤）
                cli_type = button_value.get("cli_type", "opencode")

                try:
                    adapter = self.adapters.get(cli_type)
                    working_dir, current_session_id = await self._get_session_context(adapter)
                    session_data_list = await self._build_session_data_list(
                        adapter, working_dir, current_session_id
                    ) if adapter else []

                    from .card_builder import build_session_list_card

                    updated_card = build_session_list_card(
                        sessions=session_data_list,
                        current_session_id=current_session_id,
                        cli_type=cli_type,
                        working_dir=working_dir,
                    )

                    return {
                        "toast": {
                            "type": "success",
                            "content": "✅ 已刷新会话列表",
                            "i18n": {"zh_cn": "✅ 已刷新会话列表"},
                        },
                        "update_card": {
                            "message_id": message_id,
                            "card": updated_card,
                        },
                    }
                except Exception as e:
                    logger.exception("刷新会话列表失败")
                    return {
                        "toast": {
                            "type": "error",
                            "content": f"刷新失败: {str(e)}",
                            "i18n": {"zh_cn": f"刷新失败: {str(e)}"},
                        }
                    }

            elif action_type == "rename_session_prompt":
                # 改名：发送提示消息，让用户回复新名称
                session_id = button_value.get("session_id", "")
                session_title = button_value.get("session_title", "")
                cli_type = button_value.get("cli_type", "opencode")
                working_dir = button_value.get("working_dir", "")

                # 从 event_data 提取 chat_id 和 user_id
                chat_id = event_data.get("context", {}).get("open_chat_id", "")
                user_id = event_data.get("open_id", "")

                if not session_id:
                    return {"toast": {"type": "error", "content": "未指定会话ID", "i18n": {"zh_cn": "未指定会话ID"}}}

                if not chat_id:
                    return {"toast": {"type": "error", "content": "无法获取聊天ID", "i18n": {"zh_cn": "无法获取聊天ID"}}}

                # 发送提示消息，并注册为交互式消息
                display_id = session_id[-8:] if len(session_id) >= 8 else session_id
                prompt_text = (
                    f"📝 **重命名会话**\n\n"
                    f"会话ID：`{display_id}`\n"
                    f"当前名称：{session_title or '未命名会话'}\n\n"
                    f"请直接回复新的会话名称（不超过50字）："
                )

                # 使用 TUI router 发送交互式消息
                from ..tui_commands import TUIResultType
                from .card_builder import build_card_content

                card_data = build_card_content(
                    "complete",
                    {"text": prompt_text, "metadata": {}},
                )
                msg_id = await self.api.send_card_message(chat_id, card_data)

                if msg_id:
                    self.tui_router.register_interactive(
                        message_id=msg_id,
                        interactive_id="rename_session",
                        user_id=user_id,
                        chat_id=chat_id,
                        cli_type=cli_type,
                        metadata={
                            "session_id": session_id,
                            "working_dir": working_dir,
                            "cli_type": cli_type,
                        },
                    )

                return {
                    "toast": {"type": "info", "content": "请回复新名称", "i18n": {"zh_cn": "请回复新名称"}}
                }

            elif action_type == "delete_session_confirm":
                # 删除第一步：更新卡片为确认态
                session_id = button_value.get("session_id", "")
                session_title = button_value.get("session_title", "")
                cli_type = button_value.get("cli_type", "opencode")

                if not session_id:
                    return {"toast": {"type": "error", "content": "未指定会话ID", "i18n": {"zh_cn": "未指定会话ID"}}}

                adapter = self.adapters.get(cli_type)
                # 优先使用按钮中传递的 working_dir，其次从当前项目获取
                working_dir_override = button_value.get("working_dir", "")
                working_dir, current_session_id = await self._get_session_context(adapter, working_dir_override)
                session_data_list = await self._build_session_data_list(
                    adapter, working_dir, current_session_id
                ) if adapter else []

                from .card_builder import build_session_list_card
                updated_card = build_session_list_card(
                    sessions=session_data_list,
                    current_session_id=current_session_id,
                    cli_type=cli_type,
                    deleting_session_id=session_id,
                    working_dir=working_dir,
                )
                return {
                    "toast": {"type": "warning", "content": f"⚠️ 确认删除会话？", "i18n": {"zh_cn": "⚠️ 确认删除会话？"}},
                    "update_card": {"message_id": message_id, "card": updated_card},
                }

            elif action_type == "delete_session_cancel":
                # 取消删除：恢复正常列表卡片
                cli_type = button_value.get("cli_type", "opencode")
                adapter = self.adapters.get(cli_type)
                working_dir, current_session_id = await self._get_session_context(adapter)
                session_data_list = await self._build_session_data_list(
                    adapter, working_dir, current_session_id
                ) if adapter else []

                from .card_builder import build_session_list_card
                updated_card = build_session_list_card(
                    sessions=session_data_list,
                    current_session_id=current_session_id,
                    cli_type=cli_type,
                    working_dir=working_dir,
                )
                return {
                    "toast": {"type": "info", "content": "已取消删除", "i18n": {"zh_cn": "已取消删除"}},
                    "update_card": {"message_id": message_id, "card": updated_card},
                }

            elif action_type == "delete_session_confirmed":
                # 确认删除
                session_id = button_value.get("session_id", "")
                cli_type = button_value.get("cli_type", "opencode")

                if not session_id:
                    return {"toast": {"type": "error", "content": "未指定会话ID", "i18n": {"zh_cn": "未指定会话ID"}}}

                adapter = self.adapters.get(cli_type)
                if not adapter or not hasattr(adapter, "delete_session"):
                    return {"toast": {"type": "error", "content": "适配器不支持删除会话", "i18n": {"zh_cn": "适配器不支持删除会话"}}}

                working_dir, _ = await self._get_session_context(adapter)

                success = await adapter.delete_session(session_id)
                if not success:
                    return {"toast": {"type": "error", "content": "删除会话失败", "i18n": {"zh_cn": "删除会话失败"}}}

                current_session_id = adapter.get_session_id(working_dir) if hasattr(adapter, "get_session_id") else ""
                session_data_list = await self._build_session_data_list(
                    adapter, working_dir, current_session_id
                )

                from .card_builder import build_session_list_card
                updated_card = build_session_list_card(
                    sessions=session_data_list,
                    current_session_id=current_session_id,
                    cli_type=cli_type,
                    working_dir=working_dir,
                )
                return {
                    "toast": {"type": "success", "content": "✅ 已删除会话", "i18n": {"zh_cn": "✅ 已删除会话"}},
                    "update_card": {"message_id": message_id, "card": updated_card},
                }

            else:
                logger.warning(f"未知卡片回调 action: {action_type}")
                return {
                    "toast": {
                        "type": "error",
                        "content": "未知操作",
                        "i18n": {"zh_cn": "未知操作"},
                    }
                }

        except Exception as e:
            logger.exception("处理卡片回调异常")
            return {
                "toast": {
                    "type": "error",
                    "content": f"处理失败: {e}",
                    "i18n": {"zh_cn": f"处理失败: {e}"},
                }
            }

    async def _handle_tui_command(self, content: str, message: FeishuMessage):
        """处理 TUI 命令

        Args:
            content: 命令内容
            message: 飞书消息对象
        """
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

        使用 OpenCode API PATCH /session/{id} 来设置标题。
        当前实现：基于首条用户消息前 30 字符生成标题（简单截断）。

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

            # 生成标题（基于首条用户消息和助手回复）
            # 简单规则：取用户消息前 30 字作为标题
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
