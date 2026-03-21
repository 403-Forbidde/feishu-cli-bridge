"""项目数据模型"""

import os
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


@dataclass
class Project:
    """项目元数据"""

    name: str               # URL安全英文标识（命令使用）
    display_name: str       # 展示名，可中文
    path: Path              # 项目绝对路径
    created_at: datetime
    last_active: datetime
    description: str = ""
    session_ids: List[str] = field(default_factory=list)

    def exists(self) -> bool:
        return self.path.exists()

    def has_permission(self) -> Tuple[bool, str]:
        if not self.path.exists():
            return False, f"目录不存在: {self.path}"
        if not self.path.is_dir():
            return False, f"路径不是目录: {self.path}"
        if not os.access(self.path, os.R_OK):
            return False, f"没有读权限: {self.path}"
        if not os.access(self.path, os.W_OK):
            return False, f"没有写权限: {self.path}"
        if not os.access(self.path, os.X_OK):
            return False, f"没有执行权限: {self.path}"
        return True, "权限正常"

    def add_session(self, session_id: str) -> None:
        if session_id not in self.session_ids:
            self.session_ids.append(session_id)

    def touch(self) -> None:
        self.last_active = datetime.now()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "display_name": self.display_name,
            "path": str(self.path),
            "created_at": self.created_at.isoformat(),
            "last_active": self.last_active.isoformat(),
            "description": self.description,
            "session_ids": self.session_ids,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Project":
        return cls(
            name=data["name"],
            display_name=data.get("display_name", data["name"]),
            path=Path(data["path"]),
            created_at=datetime.fromisoformat(data["created_at"]),
            last_active=datetime.fromisoformat(data["last_active"]),
            description=data.get("description", ""),
            session_ids=data.get("session_ids", []),
        )


@dataclass
class ProjectsConfig:
    """全部项目配置存储结构"""

    version: str = "1.0"
    projects: Dict[str, Project] = field(default_factory=dict)
    current_project: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "version": self.version,
            "projects": {k: v.to_dict() for k, v in self.projects.items()},
            "current_project": self.current_project,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ProjectsConfig":
        cfg = cls(
            version=data.get("version", "1.0"),
            current_project=data.get("current_project"),
        )
        cfg.projects = {
            k: Project.from_dict(v)
            for k, v in data.get("projects", {}).items()
        }
        return cfg


class ProjectErrorCode:
    PROJECT_EXISTS = "PROJECT_EXISTS"
    PATH_EXISTS = "PATH_EXISTS"
    PATH_NOT_EXISTS = "PATH_NOT_EXISTS"
    PERMISSION_DENIED = "PERMISSION_DENIED"
    NOT_A_DIRECTORY = "NOT_A_DIRECTORY"
    PROJECT_NOT_FOUND = "PROJECT_NOT_FOUND"
    INVALID_NAME = "INVALID_NAME"
    PARENT_NOT_EXISTS = "PARENT_NOT_EXISTS"


class ProjectError(Exception):
    def __init__(self, code: str, message: str, details: Optional[Dict] = None):
        self.code = code
        self.message = message
        self.details = details or {}
        super().__init__(f"[{code}] {message}")
