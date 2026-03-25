"""OpenCode 适配器模块

提供与 OpenCode CLI 工具的集成功能，包括：
- HTTP/SSE 流式通信
- 会话管理
- 模型/Agent 切换
"""

from .core import (
    OpenCodeAdapter,
    OpenCodeServerManager,
    OpenCodeSession,
    StreamState,
)

__all__ = [
    "OpenCodeAdapter",
    "OpenCodeServerManager",
    "OpenCodeSession",
    "StreamState",
]
