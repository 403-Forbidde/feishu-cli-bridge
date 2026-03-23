"""TUI 命令路由模块

提供统一的 TUI 命令解析、路由和分发。
"""

import logging
from typing import Any, Dict, List, Optional, Tuple

from .base import TUIBaseCommand, TUIResult, CommandContext, TUIResultType
from .interactive import InteractiveMessageManager, InteractiveReplyHandler, InteractiveMessage
from .opencode import OpenCodeTUICommands
from .testcard import TestCardCommand

logger = logging.getLogger(__name__)


class TUICommandRouter:
    """TUI 命令路由器

    负责解析命令、路由到对应的 CLI 工具命令处理器。
    """

    # 所有支持的 TUI 命令
    SUPPORTED_COMMANDS = [
        "new",
        "session",
        "model",
        "mode",
        "reset",
        "clear",
        "help",
        "testcard2",
    ]

    def __init__(self):
        self._command_handlers: Dict[str, TUIBaseCommand] = {}
        self._interactive_manager = InteractiveMessageManager()
        self._interactive_handler: Optional[InteractiveReplyHandler] = None

    def register_adapter(self, cli_type: str, adapter: Any) -> None:
        """注册 CLI 工具适配器

        根据适配器类型自动创建对应的 TUI 命令处理器。

        Args:
            cli_type: CLI 工具类型（如 "opencode"）
            adapter: 适配器实例
        """
        if cli_type == "opencode":
            handler = OpenCodeTUICommands(adapter, logger)
            self._command_handlers[cli_type] = handler
            logger.info(f"注册 TUI 命令处理器: {cli_type}")
        else:
            # 其他 CLI 工具可以在这里扩展
            logger.warning(f"暂不支持的 CLI 工具 TUI 命令: {cli_type}")

        # 初始化交互式回复处理器
        if not self._interactive_handler:
            self._interactive_handler = InteractiveReplyHandler(
                self._interactive_manager, self
            )

    def is_tui_command(self, content: str) -> bool:
        """检查内容是否是 TUI 命令

        Args:
            content: 消息内容

        Returns:
            是否是 TUI 命令
        """
        if not content.startswith("/"):
            return False

        # 提取命令名
        parts = content[1:].split(maxsplit=1)
        command = parts[0].lower() if parts else ""

        return command in self.SUPPORTED_COMMANDS

    def parse_command(self, content: str) -> Tuple[str, Optional[str]]:
        """解析 TUI 命令

        Args:
            content: 消息内容（如 "/session" 或 "/model opencode/mimo-v2"）

        Returns:
            (命令名, 参数) 元组
        """
        # 移除前导斜杠
        content = content[1:].strip()

        # 分割命令和参数
        parts = content.split(maxsplit=1)
        command = parts[0].lower() if parts else ""
        args = parts[1] if len(parts) > 1 else None

        # 规范化命令名
        if command == "clear":
            command = "reset"

        return command, args

    async def execute(
        self,
        content: str,
        cli_type: str,
        context: CommandContext,
    ) -> Optional[TUIResult]:
        """执行 TUI 命令

        Args:
            content: 完整命令内容（如 "/session"）
            cli_type: CLI 工具类型
            context: 命令上下文

        Returns:
            TUIResult 或 None（如果命令未找到）
        """
        if not self.is_tui_command(content):
            return None

        command, args = self.parse_command(content)

        # 处理 testcard2 命令（独立命令，不需要适配器）
        if command == "testcard2":
            handler = TestCardCommand(logger)
            return await handler.execute(command, args, context)

        # 查找对应的命令处理器
        handler = self._command_handlers.get(cli_type)
        if not handler:
            return TUIResult.error(f"CLI 工具 {cli_type} 不支持 TUI 命令")

        # 检查命令是否被支持
        if command not in handler.supported_commands:
            supported = ", ".join(f"/{cmd}" for cmd in handler.supported_commands)
            return TUIResult.error(
                f"命令 /{command} 不被 {cli_type} 支持\n支持的命令: {supported}"
            )

        logger.debug(f"执行 TUI 命令: {cli_type} /{command} (args={args})")

        # 执行命令
        result = await handler.execute(command, args, context)

        # 如果是交互式消息，注册到管理器
        if result.type == TUIResultType.INTERACTIVE and result.interactive_id:
            # 注意：message_id 需要在发送消息后由调用方提供
            # 这里先返回结果，调用方需要在发送后调用 register_interactive
            pass

        return result

    def register_interactive(
        self,
        message_id: str,
        interactive_id: str,
        user_id: str,
        chat_id: str,
        cli_type: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        """注册交互式消息

        在发送交互式消息后调用，用于后续回复匹配。

        Args:
            message_id: 飞书消息 ID
            interactive_id: 交互式消息类型 ID
            user_id: 用户 ID
            chat_id: 聊天 ID
            cli_type: CLI 工具类型
            metadata: 附加元数据
        """
        self._interactive_manager.register(
            message_id=message_id,
            interactive_id=interactive_id,
            user_id=user_id,
            chat_id=chat_id,
            cli_type=cli_type,
            metadata=metadata,
        )

    async def handle_reply(
        self,
        reply_content: str,
        user_id: str,
        chat_id: str,
        reply_to_message_id: Optional[str] = None,
    ) -> Optional[TUIResult]:
        """处理用户回复

        检查是否是回复交互式消息，如果是则路由到对应的处理器。

        Args:
            reply_content: 回复内容
            user_id: 用户 ID
            chat_id: 聊天 ID
            reply_to_message_id: 回复的消息 ID（如果有）

        Returns:
            TUIResult 或 None（如果不是回复交互式消息）
        """
        if not self._interactive_handler:
            return None

        return await self._interactive_handler.handle_reply(
            reply_content=reply_content,
            user_id=user_id,
            chat_id=chat_id,
            reply_to_message_id=reply_to_message_id,
        )

    def get_interactive_target(
        self,
        user_id: str,
        chat_id: str,
    ) -> Optional[Any]:
        """获取用户当前的交互式消息目标

        Args:
            user_id: 用户 ID
            chat_id: 聊天 ID

        Returns:
            InteractiveMessage 或 None
        """
        return self._interactive_manager.find_reply_target(user_id, chat_id, None)

    def is_interactive_reply(
        self,
        user_id: str,
        chat_id: str,
        reply_to_message_id: Optional[str] = None,
    ) -> bool:
        """检查是否是回复交互式消息

        Args:
            user_id: 用户 ID
            chat_id: 聊天 ID
            reply_to_message_id: 回复的消息 ID

        Returns:
            是否是交互式回复
        """
        target = self._interactive_manager.find_reply_target(
            user_id, chat_id, reply_to_message_id
        )
        return target is not None

    async def handle_interactive_reply(
        self,
        cli_type: str,
        interactive_id: str,
        reply: str,
        metadata: Dict[str, Any],
        context: CommandContext,
    ) -> Optional[TUIResult]:
        """处理交互式消息回复（内部方法）

        由 InteractiveReplyHandler 调用。

        Args:
            cli_type: CLI 工具类型
            interactive_id: 交互式消息类型 ID
            reply: 用户回复内容
            metadata: 原始消息的元数据
            context: 命令上下文

        Returns:
            TUIResult 或 None
        """
        handler = self._command_handlers.get(cli_type)
        if not handler:
            return None

        # 检查处理器是否支持处理交互式回复
        if hasattr(handler, "handle_interactive_reply"):
            return await handler.handle_interactive_reply(
                interactive_id=interactive_id,
                reply=reply,
                metadata=metadata,
                context=context,
            )

        return None


def create_router() -> TUICommandRouter:
    """创建 TUI 命令路由器实例"""
    return TUICommandRouter()
