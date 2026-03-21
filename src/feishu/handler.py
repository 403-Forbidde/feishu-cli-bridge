"""飞书消息处理器"""

import json
import logging
import mimetypes
from typing import Optional, List, Dict
from pathlib import Path

from .client import FeishuMessage, FeishuClient
from .api import FeishuAPI
from .formatter import parse_mention
from .dedup import MessageDeduplicator
from ..adapters import create_adapter, BaseCLIAdapter, StreamChunkType
from ..adapters.base import Message, TokenStats
from ..session import SessionManager
from ..config import Config
from ..tui_commands import create_router, TUIResultType
from ..tui_commands.base import CommandContext
from ..tui_commands.project import is_project_command, execute_project_command
from ..project.manager import ProjectManager

logger = logging.getLogger(__name__)


class MessageHandler:
    """飞书消息处理器"""

    def __init__(self, config: Config, feishu_api: FeishuAPI, project_manager: Optional[ProjectManager] = None):
        self.config = config
        self.api = feishu_api
        self.project_manager = project_manager
        self.session_mgr = SessionManager(
            storage_dir=config.session.storage_dir,
            max_sessions=config.session.max_sessions,
        )
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
        优先级：opencode > claudecode > codex
        """
        content_lower = content.lower()

        # 检查是否明确指定
        if "@opencode" in content_lower or "使用opencode" in content_lower:
            return "opencode" if "opencode" in self.adapters else None

        if "@claude" in content_lower or "使用claude" in content_lower:
            return "claudecode" if "claudecode" in self.adapters else None

        if "@codex" in content_lower or "使用codex" in content_lower:
            return "codex" if "codex" in self.adapters else None

        # 默认使用第一个启用的适配器
        if "opencode" in self.adapters:
            return "opencode"
        if "claudecode" in self.adapters:
            return "claudecode"
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

        # 2. 检查是否是 @ 机器人（群聊需要）
        if message.chat_type == "group":
            # 检查内容中是否包含 @
            if "@_user_" not in message.content:
                logger.debug("⏭️ 群聊消息没有 @，忽略")
                return
            # 注意：这里简单处理，只要群聊中有 @ 就响应
            # 实际应该检查是否是 @ 当前机器人

        # 下载附件（图片/文件）
        if message.attachments:
            resolved = await self._download_attachments(
                message.message_id, message.attachments
            )
            message.attachments = resolved if resolved else None

        # 解析命令
        content = message.content.strip()

        # 移除 @ 标记（先处理，以便正确识别命令）
        if message.chat_type == "group":
            # 移除 @_user_xxx 格式的 @
            import re

            content = re.sub(r"@_user_\w+\s*", "", content).strip()

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

        # 方式2：如果没有 parent_id 但内容是简单数字（1-10）或模型ID格式，尝试匹配最近的交互式消息
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

        # 移除 @ 标记
        if message.chat_type == "group":
            # 移除 @_user_xxx 格式的 @
            import re

            content = re.sub(r"@_user_\w+\s*", "", content).strip()

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
                "⚠️ 没有可用的 CLI 工具。请确保已安装 opencode、claudecode 或 codex。",
            )
            return

        # 清理命令前缀
        for prefix in [
            "@opencode",
            "@claude",
            "@codex",
            "使用opencode",
            "使用claude",
            "使用codex",
        ]:
            if content.lower().startswith(prefix.lower()):
                content = content[len(prefix) :].strip()

        # 获取工作目录
        working_dir = await self._get_working_dir()

        # 获取或创建会话
        session = self.session_mgr.get_or_create(
            user_id=message.sender_id, cli_type=cli_type, working_dir=working_dir
        )

        # 关联会话到当前项目并更新活跃时间
        if self.project_manager and session:
            current_project = await self.project_manager.get_current_project()
            if current_project:
                await self.project_manager.add_session_to_project(
                    current_project.name, session.session_id
                )

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
            # 添加用户消息到会话
            self.session_mgr.add_message(session.session_id, "user", content)

            # 获取对话历史
            history = self.session_mgr.get_messages(
                session.session_id, limit=self.config.session.max_history * 2
            )

            # 执行 CLI 命令
            stream = adapter.execute_stream(
                prompt=content,
                context=history[:-1],  # 排除刚添加的用户消息
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

            # 添加助手回复到会话
            if full_response:
                self.session_mgr.add_message(
                    session.session_id, "assistant", full_response
                )

            # 更新统计信息
            stats = adapter.get_stats(history, full_response or "")
            self.session_mgr.update_stats(session.session_id, stats)

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
                    pending_attachments = [{
                        "file_key": image_key,
                        "resource_type": "image",
                        "filename": f"{image_key}.jpg",
                        "mime_type": "image/jpeg",
                    }]
            elif msg_type == "file":
                file_key = content_obj.get("file_key", "")
                file_name = content_obj.get("file_name", "attachment")
                if file_key:
                    mime_type, _ = mimetypes.guess_type(file_name)
                    mime_type = mime_type or "application/octet-stream"
                    text = f"[文件: {file_name}]"
                    pending_attachments = [{
                        "file_key": file_key,
                        "resource_type": "file",
                        "filename": file_name,
                        "mime_type": mime_type,
                    }]

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
                            attachments.append({
                                "file_key": image_key,
                                "resource_type": "image",
                                "filename": f"{image_key}.jpg",
                                "mime_type": "image/jpeg",
                            })
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
                result.append({
                    "path": path,
                    "mime_type": att["mime_type"],
                    "filename": att["filename"],
                })
            else:
                logger.warning(f"Failed to download attachment: {att['file_key']}")
        return result

    async def _handle_reset(self, message: FeishuMessage):
        """处理重置命令"""
        working_dir = await self._get_working_dir()

        # 尝试重置所有可能的 CLI 类型会话
        cleared = []
        for cli_type in self.adapters.keys():
            session_id = self.session_mgr._generate_session_id(
                message.sender_id, cli_type, working_dir
            )
            if self.session_mgr.clear_session(session_id):
                cleared.append(cli_type)

        if cleared:
            await self.api.send_text(
                message.chat_id, f"✅ 已清空上下文: {', '.join(cleared)}"
            )
        else:
            await self.api.send_text(message.chat_id, "ℹ️ 没有找到活动的会话")

    async def _handle_help(self, message: FeishuMessage):
        """处理帮助命令"""
        help_text = """🤖 **飞书 CLI Bridge 使用指南**

**基本用法：**
• 私聊：直接发送消息
• 群聊：@机器人 + 消息

**支持的 CLI 工具：**
• **OpenCode** - 默认使用
• **Claude Code** - @claude 使用
• **Codex** - @codex 使用

**命令：**
• `/reset` 或 `/clear` - 清空当前会话上下文
• `/help` - 显示帮助

**提示：**
• 每个工作目录有独立的会话
• 最多保留 15 个最近会话
• 消息右下角显示 Token 使用情况

**示例：**
• "帮我写一个 Python 脚本"
• "@claude 解释一下这段代码"
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
                    return {"toast": {"type": "error", "content": "项目管理功能未启用",
                                      "i18n": {"zh_cn": "项目管理功能未启用"}}}
                project_name = button_value.get("project_name")
                if not project_name:
                    return {"toast": {"type": "error", "content": "未指定项目",
                                      "i18n": {"zh_cn": "未指定项目"}}}

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
                    return {"toast": {"type": "error", "content": e.message,
                                      "i18n": {"zh_cn": e.message}}}

            else:
                logger.warning(f"未知卡片回调 action: {action_type}")
                return {"toast": {"type": "error", "content": "未知操作",
                                  "i18n": {"zh_cn": "未知操作"}}}

        except Exception as e:
            logger.exception("处理卡片回调异常")
            return {"toast": {"type": "error", "content": f"处理失败: {e}",
                              "i18n": {"zh_cn": f"处理失败: {e}"}}}

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
                "⚠️ 没有可用的 CLI 工具。请确保已安装 opencode、claudecode 或 codex。",
            )
            return

        # 清理命令前缀
        for prefix in [
            "@opencode",
            "@claude",
            "@codex",
            "使用opencode",
            "使用claude",
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

        # 获取工作目录和会话
        working_dir = await self._get_working_dir()
        session = self.session_mgr.get_or_create(
            user_id=message.sender_id, cli_type=cli_type, working_dir=working_dir
        )

        # 创建命令上下文
        context = CommandContext(
            user_id=message.sender_id,
            chat_id=message.chat_id,
            cli_type=cli_type,
            working_dir=working_dir,
            session_id=session.session_id if session else None,
            current_model=adapter.get_current_model(),
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
                # 发送卡片消息
                from .card_builder import build_card_content

                card_data = build_card_content(
                    "complete",
                    {
                        "text": result.content,
                        "metadata": {},
                    },
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
