"""消息去重模块 - 参考 KimiBridge"""
import time
import logging
from typing import Optional
from collections import OrderedDict

logger = logging.getLogger(__name__)


class MessageDeduplicator:
    """
    消息去重器
    
    基于 FIFO 的 Map 实现，防止 WebSocket 重连导致重复处理消息
    参考 KimiBridge 实现
    """
    
    def __init__(self, ttl_ms: int = 12 * 60 * 60 * 1000, max_entries: int = 5000):
        """
        Args:
            ttl_ms: 消息 TTL（毫秒），默认 12 小时
            max_entries: 最大缓存条目数，默认 5000
        """
        self.ttl_ms = ttl_ms
        self.max_entries = max_entries
        self._store: OrderedDict[str, int] = OrderedDict()
    
    def try_record(self, message_id: str, scope: Optional[str] = None) -> bool:
        """
        尝试记录消息，返回是否是新消息
        
        Args:
            message_id: 消息 ID
            scope: 作用域（可选，用于区分不同上下文）
            
        Returns:
            True - 新消息
            False - 重复消息
        """
        key = f"{scope}:{message_id}" if scope else message_id
        now = int(time.time() * 1000)  # 当前时间毫秒
        
        # 检查是否已存在
        existing = self._store.get(key)
        if existing is not None:
            if now - existing < self.ttl_ms:
                logger.debug(f"消息去重: 重复消息 {key}")
                return False
            # 已过期，删除旧记录
            self._store.pop(key, None)
        
        # FIFO 容量控制
        if len(self._store) >= self.max_entries:
            # 删除最旧的条目
            oldest = next(iter(self._store))
            self._store.pop(oldest)
            logger.debug(f"消息去重: 淘汰旧记录 {oldest}")
        
        # 记录新消息
        self._store[key] = now
        return True
    
    def is_duplicate(self, message_id: str, scope: Optional[str] = None) -> bool:
        """检查是否是重复消息"""
        return not self.try_record(message_id, scope)
    
    def clear(self):
        """清空所有记录"""
        self._store.clear()
        logger.info("消息去重器已清空")
    
    def get_stats(self) -> dict:
        """获取统计信息"""
        return {
            "total_entries": len(self._store),
            "max_entries": self.max_entries,
            "ttl_ms": self.ttl_ms
        }
