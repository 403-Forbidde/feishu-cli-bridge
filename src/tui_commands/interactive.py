"""交互式消息管理器

管理交互式消息的生命周期和回复处理。
"""

import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Callable, Awaitable
import logging

from .base import TUIResult, CommandContext

logger = logging.getLogger(__name__)


@dataclass
class InteractiveMessage:
    """交互式消息记录"""

    message_id: str  # 飞书消息 ID
    interactive_id: str  # 交互式消息类型 ID
    user_id: str  # 用户 ID
    chat_id: str  # 聊天 ID
    cli_type: str  # CLI 工具类型
    created_at: float = field(default_factory=time.time)
    metadata: Dict[str, Any] = field(default_factory=dict)
    expires_at: Optional[float] = None  # 过期时间

    def __post_init__(self):
        # 默认 10 分钟后过期
        if self.expires_at is None:
            self.expires_at = self.created_at + 600

    def is_expired(self) -> bool:
        """检查是否已过期"""
        return time.time() > self.expires_at


class InteractiveMessageManager:
    """交互式消息管理器

    管理所有交互式消息，处理用户回复匹配。
    """

    def __init__(self, max_messages: int = 100):
        self._messages: Dict[
            str, InteractiveMessage
        ] = {}  # message_id -> InteractiveMessage
        self._max_messages = max_messages

    def register(
        self,
        message_id: str,
        interactive_id: str,
        user_id: str,
        chat_id: str,
        cli_type: str,
        metadata: Optional[Dict[str, Any]] = None,
        ttl: int = 600,  # 过期时间（秒）
    ) -> None:
        """注册交互式消息

        Args:
            message_id: 飞书消息 ID
            interactive_id: 交互式消息类型 ID
            user_id: 用户 ID
            chat_id: 聊天 ID
            cli_type: CLI 工具类型
            metadata: 附加元数据
            ttl: 过期时间（秒）
        """
        # 清理过期消息
        self._cleanup_expired()

        # 限制最大数量
        if len(self._messages) >= self._max_messages:
            # 移除最旧的消息
            oldest = min(self._messages.items(), key=lambda x: x[1].created_at)
            del self._messages[oldest[0]]

        self._messages[message_id] = InteractiveMessage(
            message_id=message_id,
            interactive_id=interactive_id,
            user_id=user_id,
            chat_id=chat_id,
            cli_type=cli_type,
            metadata=metadata or {},
            expires_at=time.time() + ttl,
        )

        logger.debug(f"注册交互式消息: {message_id} ({interactive_id})")

    def find_reply_target(
        self, user_id: str, chat_id: str, reply_to_message_id: Optional[str] = None
    ) -> Optional[InteractiveMessage]:
        """查找用户回复的目标交互式消息

        Args:
            user_id: 用户 ID
            chat_id: 聊天 ID
            reply_to_message_id: 回复的消息 ID（如果有）

        Returns:
            InteractiveMessage 或 None
        """
        self._cleanup_expired()

        logger.debug(
            f"查找交互式回复目标: user_id={user_id}, chat_id={chat_id}, reply_to={reply_to_message_id}"
        )
        logger.debug(f"当前注册的交互式消息: {list(self._messages.keys())}")

        # 如果指定了回复的消息 ID，直接查找
        if reply_to_message_id and reply_to_message_id in self._messages:
            msg = self._messages[reply_to_message_id]
            if msg.user_id == user_id and msg.chat_id == chat_id:
                logger.debug(f"找到匹配的交互式消息: {reply_to_message_id}")
                return msg
            else:
                logger.debug(
                    f"消息存在但用户/聊天不匹配: {msg.user_id} vs {user_id}, {msg.chat_id} vs {chat_id}"
                )

        # 否则查找该用户在该聊天中最近的交互式消息
        candidates = [
            msg
            for msg in self._messages.values()
            if msg.user_id == user_id
            and msg.chat_id == chat_id
            and not msg.is_expired()
        ]

        if candidates:
            # 返回最近的消息
            result = max(candidates, key=lambda x: x.created_at)
            logger.debug(f"使用最近的交互式消息作为候选: {result.message_id}")
            return result

        logger.debug("未找到交互式回复目标")
        return None

    def remove(self, message_id: str) -> bool:
        """移除交互式消息

        Args:
            message_id: 消息 ID

        Returns:
            是否成功移除
        """
        if message_id in self._messages:
            del self._messages[message_id]
            return True
        return False

    def _cleanup_expired(self) -> None:
        """清理过期消息"""
        expired = [msg_id for msg_id, msg in self._messages.items() if msg.is_expired()]
        for msg_id in expired:
            del self._messages[msg_id]
            logger.debug(f"清理过期交互式消息: {msg_id}")

    def get_stats(self) -> Dict[str, int]:
        """获取统计信息"""
        self._cleanup_expired()
        return {
            "total": len(self._messages),
            "by_cli": {},
        }


class InteractiveReplyHandler:
    """交互式回复处理器

    处理用户对交互式消息的回复。
    """

    def __init__(
        self,
        message_manager: InteractiveMessageManager,
        command_router: Any,  # TUICommandRouter
    ):
        self.message_manager = message_manager
        self.command_router = command_router

    async def handle_reply(
        self,
        reply_content: str,
        user_id: str,
        chat_id: str,
        reply_to_message_id: Optional[str] = None,
    ) -> Optional[TUIResult]:
        """处理用户回复

        Args:
            reply_content: 回复内容
            user_id: 用户 ID
            chat_id: 聊天 ID
            reply_to_message_id: 回复的消息 ID

        Returns:
            TUIResult 或 None（如果不是回复交互式消息）
        """
        # 查找目标交互式消息
        target = self.message_manager.find_reply_target(
            user_id, chat_id, reply_to_message_id
        )

        if not target:
            return None

        logger.debug(
            f"处理交互式回复: target={target.interactive_id}, reply={reply_content}"
        )

        # 创建命令上下文
        context = CommandContext(
            user_id=user_id,
            chat_id=chat_id,
            cli_type=target.cli_type,
            working_dir="",  # 从 session manager 获取
            session_id=None,
        )

        # 路由到对应的 TUI 命令处理器
        result = await self.command_router.handle_interactive_reply(
            cli_type=target.cli_type,
            interactive_id=target.interactive_id,
            reply=reply_content.strip(),
            metadata=target.metadata,
            context=context,
        )

        # 处理成功后移除该交互式消息
        if result:
            self.message_manager.remove(target.message_id)

        return result
