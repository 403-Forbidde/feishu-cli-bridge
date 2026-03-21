"""CLI 适配器基类"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional, List, Dict, Any, AsyncIterator
from enum import Enum
import logging


class StreamChunkType(Enum):
    CONTENT = "content"
    REASONING = "reasoning"  # 思考过程
    TOOL_USE = "tool_use"
    TOOL_RESULT = "tool_result"
    ERROR = "error"
    DONE = "done"


@dataclass
class StreamChunk:
    """流式输出块"""

    type: StreamChunkType
    data: str
    metadata: Optional[Dict[str, Any]] = None


@dataclass
class Message:
    """对话消息"""

    role: str  # "user" | "assistant" | "system"
    content: str
    timestamp: Optional[float] = None


@dataclass
class TokenStats:
    """Token 统计信息"""

    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    context_window: int = 0
    context_used: int = 0
    context_percent: float = 0.0
    model: str = ""


class BaseCLIAdapter(ABC):
    """CLI 适配器抽象基类"""

    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.logger: Optional[logging.Logger] = None

    @property
    @abstractmethod
    def name(self) -> str:
        """适配器名称"""
        pass

    @property
    @abstractmethod
    def default_model(self) -> str:
        """默认模型"""
        pass

    @property
    @abstractmethod
    def context_window(self) -> int:
        """上下文窗口大小"""
        pass

    @abstractmethod
    async def execute_stream(
        self,
        prompt: str,
        context: List[Message],
        working_dir: str,
        attachments: Optional[List[Dict]] = None,
    ) -> AsyncIterator[StreamChunk]:
        """
        执行 CLI 命令并返回流式输出

        Args:
            prompt: 用户输入
            context: 对话历史
            working_dir: 工作目录

        Yields:
            StreamChunk: 流式输出块
        """
        pass

    @abstractmethod
    def parse_chunk(self, raw_line: bytes) -> Optional[StreamChunk]:
        """
        解析 CLI 输出的一行数据

        Args:
            raw_line: 原始字节数据

        Returns:
            StreamChunk 或 None（如果无法解析）
        """
        pass

    @abstractmethod
    def build_command(self, prompt: str, working_dir: str) -> List[str]:
        """
        构建 CLI 命令

        Args:
            prompt: 用户输入
            working_dir: 工作目录

        Returns:
            命令参数列表
        """
        pass

    def estimate_tokens(self, text: str) -> int:
        """
        估算文本的 token 数
        简化的估算：中文字符 1:1.5，英文单词 1:0.25
        """
        import re

        cn_chars = len(re.findall(r"[\u4e00-\u9fff]", text))
        en_words = len(re.findall(r"[a-zA-Z]+", text))
        return int(cn_chars * 1.5 + en_words * 0.6)

    def format_context(self, context: List[Message]) -> str:
        """
        将对话历史格式化为 CLI 可用的格式
        默认格式：简单的对话格式
        """
        lines = []
        for msg in context:
            if msg.role == "user":
                lines.append(f"User: {msg.content}")
            elif msg.role == "assistant":
                lines.append(f"Assistant: {msg.content}")
        return "\n\n".join(lines)

    def get_stats(self, context: List[Message], completion_text: str) -> TokenStats:
        """
        计算 Token 统计信息
        """
        context_text = self.format_context(context)
        context_tokens = self.estimate_tokens(context_text)
        completion_tokens = self.estimate_tokens(completion_text)

        return TokenStats(
            prompt_tokens=context_tokens,
            completion_tokens=completion_tokens,
            total_tokens=context_tokens + completion_tokens,
            context_window=self.context_window,
            context_used=context_tokens,
            context_percent=min(
                100.0, round(context_tokens / self.context_window * 100, 1)
            ),
            model=self.default_model,
        )

    # ==================== TUI 命令支持 ====================

    @property
    def supported_tui_commands(self) -> List[str]:
        """返回支持的 TUI 命令列表

        子类应覆盖此方法返回支持的命令列表。
        默认返回空列表表示不支持 TUI 命令。

        Returns:
            命令名称列表，如 ["new", "session", "model", "reset"]
        """
        return []

    async def create_new_session(self) -> Optional[Dict[str, Any]]:
        """创建新会话

        Returns:
            新会话信息字典，包含 id, title 等字段
            或 None（如果不支持）
        """
        return None

    async def list_sessions(self, limit: int = 10) -> List[Dict[str, Any]]:
        """列出会话

        Args:
            limit: 最大返回数量

        Returns:
            会话列表，每个会话包含 id, title, created_at 等
        """
        return []

    async def switch_session(self, session_id: str) -> bool:
        """切换到指定会话

        Args:
            session_id: 会话 ID

        Returns:
            是否切换成功
        """
        return False

    async def reset_session(self) -> bool:
        """重置当前会话

        Returns:
            是否重置成功
        """
        return False

    async def list_models(self, provider: Optional[str] = None) -> List[Dict[str, Any]]:
        """列出可用模型

        Args:
            provider: 提供商筛选（可选）

        Returns:
            模型列表，每个模型包含 provider, model, name 等
        """
        return []

    async def switch_model(self, model_id: str) -> bool:
        """切换当前会话使用的模型

        Args:
            model_id: 模型完整 ID（如 "opencode/mimo-v2"）

        Returns:
            是否切换成功
        """
        return False

    def get_current_model(self) -> str:
        """获取当前使用的模型

        Returns:
            模型完整 ID
        """
        return self.default_model
