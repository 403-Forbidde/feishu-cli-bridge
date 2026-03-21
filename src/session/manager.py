"""会话管理模块"""
import json
import time
from pathlib import Path
from dataclasses import dataclass, field, asdict
from typing import Dict, List, Optional
from collections import OrderedDict
import logging

from ..adapters.base import Message, TokenStats

logger = logging.getLogger(__name__)


@dataclass
class Session:
    """会话对象"""
    session_id: str
    user_id: str
    cli_type: str
    working_dir: str
    messages: List[Message] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    total_tokens: int = 0
    
    def add_message(self, role: str, content: str):
        """添加消息"""
        self.messages.append(Message(
            role=role,
            content=content,
            timestamp=time.time()
        ))
        self.updated_at = time.time()
    
    def to_dict(self) -> dict:
        """序列化为字典"""
        return {
            "session_id": self.session_id,
            "user_id": self.user_id,
            "cli_type": self.cli_type,
            "working_dir": self.working_dir,
            "messages": [
                {"role": m.role, "content": m.content, "timestamp": m.timestamp}
                for m in self.messages
            ],
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "total_tokens": self.total_tokens
        }
    
    @classmethod
    def from_dict(cls, data: dict) -> "Session":
        """从字典反序列化"""
        session = cls(
            session_id=data["session_id"],
            user_id=data["user_id"],
            cli_type=data["cli_type"],
            working_dir=data["working_dir"],
            created_at=data.get("created_at", time.time()),
            updated_at=data.get("updated_at", time.time()),
            total_tokens=data.get("total_tokens", 0)
        )
        session.messages = [
            Message(role=m["role"], content=m["content"], timestamp=m.get("timestamp"))
            for m in data.get("messages", [])
        ]
        return session


class SessionManager:
    """会话管理器 - LRU 淘汰策略"""
    
    def __init__(self, storage_dir: str = ".sessions", max_sessions: int = 15):
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(exist_ok=True)
        self.max_sessions = max_sessions
        # 使用 OrderedDict 实现 LRU
        self._sessions: OrderedDict[str, Session] = OrderedDict()
        self._load_all_sessions()
    
    def _load_all_sessions(self):
        """加载所有会话"""
        if not self.storage_dir.exists():
            return
        
        for file_path in self.storage_dir.glob("*.json"):
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    session = Session.from_dict(data)
                    self._sessions[session.session_id] = session
            except Exception as e:
                logger.warning(f"Failed to load session from {file_path}: {e}")
        
        # 按更新时间排序，最新的在后面
        self._sessions = OrderedDict(
            sorted(self._sessions.items(), key=lambda x: x[1].updated_at)
        )
        
        # 清理超出限制的会话
        self._cleanup_lru()
        
        logger.info(f"Loaded {len(self._sessions)} sessions")
    
    def _save_session(self, session: Session):
        """保存单个会话"""
        file_path = self.storage_dir / f"{session.session_id}.json"
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(session.to_dict(), f, ensure_ascii=False, indent=2)
    
    def _cleanup_lru(self):
        """LRU 淘汰：移除最久未使用的会话"""
        while len(self._sessions) > self.max_sessions:
            oldest_key, oldest_session = self._sessions.popitem(last=False)
            file_path = self.storage_dir / f"{oldest_key}.json"
            if file_path.exists():
                file_path.unlink()
            logger.info(f"Removed oldest session: {oldest_key}")
    
    def _generate_session_id(self, user_id: str, cli_type: str, working_dir: str) -> str:
        """生成会话 ID"""
        import hashlib
        key = f"{user_id}:{cli_type}:{working_dir}"
        return hashlib.md5(key.encode()).hexdigest()[:16]
    
    def get_or_create(
        self,
        user_id: str,
        cli_type: str,
        working_dir: str
    ) -> Session:
        """
        获取或创建会话
        
        Args:
            user_id: 用户 ID
            cli_type: CLI 类型 (opencode/codex)
            working_dir: 工作目录
            
        Returns:
            Session 对象
        """
        session_id = self._generate_session_id(user_id, cli_type, working_dir)
        
        if session_id in self._sessions:
            # 移动到最新（LRU）
            session = self._sessions.pop(session_id)
            self._sessions[session_id] = session
            logger.debug(f"Reusing session: {session_id}")
            return session
        
        # 创建新会话
        session = Session(
            session_id=session_id,
            user_id=user_id,
            cli_type=cli_type,
            working_dir=working_dir
        )
        self._sessions[session_id] = session
        self._cleanup_lru()
        self._save_session(session)
        logger.info(f"Created new session: {session_id}")
        return session
    
    def add_message(self, session_id: str, role: str, content: str):
        """添加消息到会话"""
        if session_id not in self._sessions:
            logger.warning(f"Session not found: {session_id}")
            return
        
        session = self._sessions[session_id]
        session.add_message(role, content)
        
        # 移动到最新
        self._sessions.move_to_end(session_id)
        
        # 保存
        self._save_session(session)
    
    def get_messages(self, session_id: str, limit: Optional[int] = None) -> List[Message]:
        """获取会话消息历史"""
        if session_id not in self._sessions:
            return []
        
        messages = self._sessions[session_id].messages
        if limit:
            messages = messages[-limit:]
        return messages
    
    def clear_session(self, session_id: str) -> bool:
        """清空会话历史"""
        if session_id not in self._sessions:
            return False
        
        session = self._sessions[session_id]
        session.messages = []
        session.total_tokens = 0
        session.updated_at = time.time()
        
        self._save_session(session)
        logger.info(f"Cleared session: {session_id}")
        return True
    
    def delete_session(self, session_id: str) -> bool:
        """删除会话"""
        if session_id not in self._sessions:
            return False
        
        del self._sessions[session_id]
        file_path = self.storage_dir / f"{session_id}.json"
        if file_path.exists():
            file_path.unlink()
        
        logger.info(f"Deleted session: {session_id}")
        return True
    
    def list_sessions(self, user_id: Optional[str] = None) -> List[Session]:
        """列出会话"""
        sessions = list(self._sessions.values())
        if user_id:
            sessions = [s for s in sessions if s.user_id == user_id]
        # 按更新时间倒序
        return sorted(sessions, key=lambda s: s.updated_at, reverse=True)
    
    def update_stats(self, session_id: str, stats: TokenStats):
        """更新会话统计信息"""
        if session_id not in self._sessions:
            return
        
        session = self._sessions[session_id]
        session.total_tokens = stats.total_tokens
        session.updated_at = time.time()
        self._save_session(session)
