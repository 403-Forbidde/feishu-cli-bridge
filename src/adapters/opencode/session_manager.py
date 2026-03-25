"""OpenCode 会话管理模块

提供会话数据类和流式处理状态管理。
"""

import time
from dataclasses import dataclass, field
from typing import Optional

from ..base import TokenStats


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
