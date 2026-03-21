"""CLI 适配器模块"""
from .base import BaseCLIAdapter, StreamChunk, StreamChunkType, Message, TokenStats
from .opencode import OpenCodeAdapter
from .codex import CodexAdapter

__all__ = [
    "BaseCLIAdapter",
    "StreamChunk",
    "StreamChunkType",
    "Message",
    "TokenStats",
    "OpenCodeAdapter",
    "CodexAdapter",
    "create_adapter",
]

# 适配器注册表
_ADAPTER_REGISTRY = {
    "opencode": OpenCodeAdapter,
    "codex": CodexAdapter,
}


def create_adapter(cli_type: str, config: dict) -> BaseCLIAdapter:
    """
    创建适配器实例

    Args:
        cli_type: CLI 类型 (opencode/codex)
        config: 配置字典
        
    Returns:
        BaseCLIAdapter 实例
        
    Raises:
        ValueError: 如果 cli_type 不支持
    """
    cli_type = cli_type.lower()
    
    if cli_type not in _ADAPTER_REGISTRY:
        raise ValueError(f"Unsupported CLI type: {cli_type}. "
                        f"Supported: {list(_ADAPTER_REGISTRY.keys())}")
    
    adapter_class = _ADAPTER_REGISTRY[cli_type]
    return adapter_class(config)


def list_supported_adapters() -> list:
    """获取支持的适配器列表"""
    return list(_ADAPTER_REGISTRY.keys())
