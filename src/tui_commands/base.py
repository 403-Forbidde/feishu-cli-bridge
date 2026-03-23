"""TUI 命令基础模块

提供 TUI 命令的抽象基类、数据结构和类型定义。
支持跨 CLI 工具的 TUI 命令实现。
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Literal
import time


class TUIResultType(Enum):
    """TUI 命令结果类型"""

    TEXT = "text"  # 纯文本回复
    CARD = "card"  # 卡片消息
    INTERACTIVE = "interactive"  # 交互式消息（需要用户回复）
    ERROR = "error"  # 错误信息


@dataclass
class TUIResult:
    """TUI 命令执行结果"""

    type: TUIResultType
    content: str
    metadata: Dict[str, Any] = field(default_factory=dict)
    interactive_id: Optional[str] = None  # 交互式消息 ID，用于回复匹配
    options: Optional[List[Dict[str, str]]] = None  # 交互选项

    @classmethod
    def text(cls, content: str) -> "TUIResult":
        """创建文本结果"""
        return cls(type=TUIResultType.TEXT, content=content)

    @classmethod
    def card(
        cls, content: str, metadata: Optional[Dict[str, Any]] = None
    ) -> "TUIResult":
        """创建卡片结果"""
        return cls(type=TUIResultType.CARD, content=content, metadata=metadata or {})

    @classmethod
    def interactive(
        cls,
        content: str,
        interactive_id: str,
        options: List[Dict[str, str]],
        metadata: Optional[Dict[str, Any]] = None,
    ) -> "TUIResult":
        """创建交互式结果"""
        return cls(
            type=TUIResultType.INTERACTIVE,
            content=content,
            interactive_id=interactive_id,
            options=options,
            metadata=metadata or {},
        )

    @classmethod
    def error(cls, content: str) -> "TUIResult":
        """创建错误结果"""
        return cls(type=TUIResultType.ERROR, content=content)


@dataclass
class CommandContext:
    """命令执行上下文"""

    user_id: str
    chat_id: str
    cli_type: str
    working_dir: str
    session_id: Optional[str] = None
    current_model: Optional[str] = None
    project_name: Optional[str] = None           # 当前项目标识（英文）
    project_display_name: Optional[str] = None   # 当前项目显示名
    timestamp: float = field(default_factory=time.time)


class TUIBaseCommand(ABC):
    """TUI 命令基类

    所有 CLI 工具的 TUI 命令实现都应继承此类。
    提供统一的命令接口和辅助方法。
    """

    def __init__(self, adapter: Any, logger: Optional[Any] = None):
        self.adapter = adapter
        self.logger = logger

    @property
    @abstractmethod
    def supported_commands(self) -> List[str]:
        """返回支持的命令列表

        Returns:
            命令名称列表，如 ["new", "session", "model", "reset"]
        """
        pass

    @abstractmethod
    async def execute(
        self, command: str, args: Optional[str], context: CommandContext
    ) -> TUIResult:
        """执行 TUI 命令

        Args:
            command: 命令名称（如 "session", "model"）
            args: 命令参数（可能为 None）
            context: 执行上下文

        Returns:
            TUIResult: 命令执行结果
        """
        pass

    def _generate_session_display_id(self, session_id: str, slug: Optional[str] = None) -> str:
        """生成会话显示 ID

        Args:
            session_id: 原始会话 ID
            slug: OpenCode 提供的可读会话标识（可选）

        Returns:
            简短显示 ID，优先使用 slug，否则使用短 ID
        """
        if slug:
            return slug
        # 取后 8 个字符作为唯一标识
        if len(session_id) > 8:
            return session_id[-8:]
        return session_id

    def _format_session_list(
        self, sessions: List[Dict[str, Any]], current_session_id: Optional[str] = None
    ) -> str:
        """格式化会话列表为卡片文本

        Args:
            sessions: 会话列表，每个会话包含 id, title, created_at 等
            current_session_id: 当前会话 ID

        Returns:
            格式化的卡片文本
        """
        lines = ["📋 **会话列表**", ""]

        for i, session in enumerate(sessions[:10], 1):  # 最多显示 10 个
            session_id = session.get("id", "")
            title = session.get("title", "未命名会话")
            slug = session.get("slug", "")
            display_id = self._generate_session_display_id(session_id, slug)

            # 标记当前会话
            marker = " ★" if session_id == current_session_id else ""

            # 优化格式：标题加粗，ID用代码格式
            lines.append(f"**{i}.** {title}{marker}")
            lines.append(f"   `{display_id}`")
            lines.append("")

        if len(sessions) > 10:
            lines.append(f"*... 还有 {len(sessions) - 10} 个更早的会话*")
            lines.append("")

        lines.append("━━━━━━━━━━━━━━")
        lines.append("💡 **点击回复**并发送 **数字 1-10** 切换会话")

        return "\n".join(lines)

    def _format_model_list(
        self, models: List[Dict[str, Any]], current_model: Optional[str] = None
    ) -> str:
        """格式化模型列表为卡片文本

        Args:
            models: 模型列表，每个模型包含 provider, model, name 等
            current_model: 当前使用的模型

        Returns:
            格式化的卡片文本
        """
        lines = ["🤖 可用模型", "━━━━━━━━━━━━━━"]

        # 按 provider 分组
        providers: Dict[str, List[Dict[str, Any]]] = {}
        for model in models:
            provider = model.get("provider", "unknown")
            if provider not in providers:
                providers[provider] = []
            providers[provider].append(model)

        # 限制显示的模型数量，避免消息过长
        total_models = sum(len(models) for models in providers.values())
        max_display = 20
        displayed = 0

        for provider, provider_models in sorted(providers.items()):
            if displayed >= max_display:
                break

            lines.append("")
            lines.append(f"📦 **{provider.upper()}**")
            lines.append("")

            for i, model in enumerate(provider_models, 1):
                if displayed >= max_display:
                    break

                full_id = model.get("full_id", "")
                name = model.get("name", model.get("model", ""))

                # 当前模型标记
                marker = " ★" if full_id == current_model else ""

                # 美化格式：名称加粗，ID用代码格式
                lines.append(f"**{i}.** {name}{marker}")
                lines.append(f"   `{full_id}`")
                lines.append("")
                displayed += 1

        if total_models > max_display:
            lines.append(f"*... 还有 {total_models - max_display} 个模型未显示*")
            lines.append("")

        lines.append("━━━━━━━━━━━━━━")
        lines.append("💡 **点击回复**并发送模型完整 ID 切换")

        return "\n".join(lines)
