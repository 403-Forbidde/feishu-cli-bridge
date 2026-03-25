"""命令路由器

负责识别和路由各种命令类型（项目命令、TUI命令、AI消息等）。
"""

import logging
from typing import Optional, Dict, Any
from enum import Enum

logger = logging.getLogger(__name__)


class CommandType(Enum):
    """命令类型枚举"""
    UNKNOWN = "unknown"
    INTERACTIVE_REPLY = "interactive_reply"
    PROJECT_COMMAND = "project_command"
    TUI_COMMAND = "tui_command"
    AI_MESSAGE = "ai_message"


class CommandRouter:
    """命令路由器"""

    def __init__(self, tui_router, project_manager=None):
        """
        初始化命令路由器

        Args:
            tui_router: TUI 命令路由器实例
            project_manager: 项目管理器实例（可选）
        """
        self.tui_router = tui_router
        self.project_manager = project_manager

    def detect_cli_type(self, content: str, available_adapters: Dict[str, Any]) -> Optional[str]:
        """
        检测用户想要使用的 CLI 类型

        Args:
            content: 消息内容
            available_adapters: 可用的适配器字典

        Returns:
            CLI 类型字符串或 None
        """
        content_lower = content.lower()

        # 检查是否明确指定
        if "@opencode" in content_lower or "使用opencode" in content_lower:
            return "opencode" if "opencode" in available_adapters else None

        if "@codex" in content_lower or "使用codex" in content_lower:
            return "codex" if "codex" in available_adapters else None

        # 默认使用第一个启用的适配器
        if "opencode" in available_adapters:
            return "opencode"
        if "codex" in available_adapters:
            return "codex"

        return None

    def is_project_command(self, content: str) -> bool:
        """
        检测是否是项目管理命令

        Args:
            content: 消息内容

        Returns:
            是否是项目命令
        """
        project_prefixes = (
            "/pa ",
            "/pc ",
            "/pl",
            "/ps ",
            "/prm ",
            "/pi",
            "/project",
        )
        content_lower = content.lower().strip()
        return any(
            content_lower.startswith(prefix) for prefix in project_prefixes
        )

    def is_tui_command(self, content: str) -> bool:
        """
        检测是否是 TUI 命令（斜杠命令）

        Args:
            content: 消息内容

        Returns:
            是否是 TUI 命令
        """
        return self.tui_router.is_tui_command(content)

    def check_interactive_reply(
        self,
        sender_id: str,
        chat_id: str,
        parent_id: Optional[str],
        content: str,
    ) -> tuple[CommandType, Optional[Dict]]:
        """
        检查是否是交互式回复

        Args:
            sender_id: 发送者 ID
            chat_id: 聊天 ID
            parent_id: 父消息 ID
            content: 消息内容

        Returns:
            (命令类型, 额外数据字典)
        """
        # 方式1：通过 parent_id 匹配（用户点击"回复"）
        if parent_id:
            is_interactive = self.tui_router.is_interactive_reply(
                user_id=sender_id,
                chat_id=chat_id,
                reply_to_message_id=parent_id,
            )
            logger.debug(f"🔍 通过 parent_id 匹配: {is_interactive}")
            if is_interactive:
                return CommandType.INTERACTIVE_REPLY, None

        # 方式2：如果没有 parent_id，尝试匹配最近的交互式消息
        target = self.tui_router.get_interactive_target(
            user_id=sender_id,
            chat_id=chat_id,
        )
        if target and target.interactive_id == "rename_session":
            logger.debug(f"🔍 匹配到 rename_session 交互，接受内容: {content[:50]}")
            return CommandType.INTERACTIVE_REPLY, {"interactive_target": target}

        # 对于其他交互类型，使用内容启发式匹配
        content_stripped = content.strip()
        is_digit = content_stripped.isdigit() and 1 <= int(content_stripped) <= 10
        is_model_id = "/" in content_stripped and not content_stripped.startswith("/")

        if is_digit or is_model_id:
            logger.debug(
                f"🔍 检测到可能的交互式回复: {content_stripped}，尝试匹配最近交互式消息"
            )
            is_interactive = self.tui_router.is_interactive_reply(
                user_id=sender_id,
                chat_id=chat_id,
                reply_to_message_id=None,
            )
            logger.debug(f"🔍 通过最近消息匹配: {is_interactive}")
            if is_interactive:
                return CommandType.INTERACTIVE_REPLY, None

        return CommandType.UNKNOWN, None

    def route(
        self,
        content: str,
        sender_id: str,
        chat_id: str,
        parent_id: Optional[str],
        available_adapters: Dict[str, Any],
    ) -> tuple[CommandType, Optional[Dict]]:
        """
        路由命令到对应类型

        Args:
            content: 消息内容
            sender_id: 发送者 ID
            chat_id: 聊天 ID
            parent_id: 父消息 ID
            available_adapters: 可用的适配器字典

        Returns:
            (命令类型, 额外数据字典)
        """
        content = content.strip()

        # 1. 检查交互式回复
        cmd_type, extra = self.check_interactive_reply(
            sender_id, chat_id, parent_id, content
        )
        if cmd_type == CommandType.INTERACTIVE_REPLY:
            return cmd_type, extra

        # 2. 检查项目命令
        if self.is_project_command(content):
            return CommandType.PROJECT_COMMAND, None

        # 3. 检查 TUI 命令
        if self.is_tui_command(content):
            return CommandType.TUI_COMMAND, None

        # 4. 检查是否为空内容
        if not content:
            return CommandType.UNKNOWN, None

        # 5. 检测 CLI 类型（AI 消息）
        cli_type = self.detect_cli_type(content, available_adapters)
        if cli_type:
            return CommandType.AI_MESSAGE, {"cli_type": cli_type}

        return CommandType.UNKNOWN, None

    def clean_cli_prefix(self, content: str) -> str:
        """
        清理 CLI 命令前缀

        Args:
            content: 原始消息内容

        Returns:
            清理后的内容
        """
        prefixes = [
            "@opencode",
            "@codex",
            "使用opencode",
            "使用codex",
        ]
        for prefix in prefixes:
            if content.lower().startswith(prefix.lower()):
                return content[len(prefix):].strip()
        return content
