"""项目管理器"""

import asyncio
import json
import logging
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .models import Project, ProjectError, ProjectErrorCode, ProjectsConfig

logger = logging.getLogger(__name__)


class ProjectManager:
    """项目管理器：增删改查、持久化、asyncio.Lock 并发保护"""

    def __init__(self, config_path: Optional[Path] = None, max_projects: int = 50):
        if config_path is None:
            config_path = Path.home() / ".config" / "cli-feishu-bridge" / "projects.json"
        self.config_path = config_path
        self.max_projects = max_projects
        self._config: ProjectsConfig = ProjectsConfig()
        self._lock = asyncio.Lock()
        self._load_config()

    # ------------------------------------------------------------------
    # 内部：加载/保存
    # ------------------------------------------------------------------

    def _load_config(self) -> None:
        if not self.config_path.exists():
            logger.info("项目配置文件不存在，初始化空配置")
            return
        try:
            with open(self.config_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            self._config = ProjectsConfig.from_dict(data)
            logger.info(f"已加载 {len(self._config.projects)} 个项目")
        except Exception as e:
            logger.error(f"加载项目配置失败: {e}")
            self._config = ProjectsConfig()

    async def _save_config(self) -> None:
        try:
            self.config_path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.config_path.with_suffix(".tmp")
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self._config.to_dict(), f, ensure_ascii=False, indent=2)
            tmp.rename(self.config_path)
            logger.debug("项目配置已保存")
        except Exception as e:
            logger.error(f"保存项目配置失败: {e}")
            raise ProjectError("SAVE_ERROR", f"保存配置失败: {e}")

    # ------------------------------------------------------------------
    # 内部：路径/名称工具
    # ------------------------------------------------------------------

    def _resolve_path(self, path: str) -> Path:
        return Path(os.path.expanduser(path)).resolve()

    def _validate_name(self, name: str) -> Tuple[bool, str]:
        if not name:
            return False, "项目名称不能为空"
        if len(name) > 50:
            return False, "项目名称不能超过 50 个字符"
        if not re.match(r'^[a-zA-Z][a-zA-Z0-9_-]*$', name):
            return False, "项目名称只能包含字母、数字、下划线、连字符，且必须以字母开头"
        return True, ""

    def _generate_name(self, path: Path) -> str:
        name = re.sub(r'[^a-zA-Z0-9_-]', '_', path.name)
        if name and name[0].isdigit():
            name = "proj_" + name
        if not name:
            name = "project"
        base = name
        i = 1
        while name in self._config.projects:
            name = f"{base}_{i}"
            i += 1
        return name

    def validate_path(self, path: Path, for_create: bool = False) -> Tuple[bool, str]:
        if not path.exists():
            if not for_create:
                return False, f"目录不存在: {path}"
            parent = path.parent
            if not parent.exists():
                return False, f"父目录不存在: {parent}"
            if not os.access(parent, os.W_OK | os.X_OK):
                return False, f"没有权限在父目录创建文件夹: {parent}"
            return True, "可以创建"
        if not path.is_dir():
            return False, f"路径不是目录: {path}"
        for pname, proj in self._config.projects.items():
            if proj.path.resolve() == path.resolve():
                return False, f"该目录已被项目 '{pname}' 使用"
        if not os.access(path, os.R_OK):
            return False, f"没有读权限: {path}"
        if not os.access(path, os.W_OK):
            return False, f"没有写权限: {path}"
        if not os.access(path, os.X_OK):
            return False, f"没有执行权限: {path}"
        return True, "权限正常"

    # ------------------------------------------------------------------
    # 公开 API
    # ------------------------------------------------------------------

    async def add_project(
        self,
        path: str,
        name: Optional[str] = None,
        display_name: Optional[str] = None,
        description: str = "",
    ) -> Project:
        """添加已有目录为项目"""
        async with self._lock:
            resolved = self._resolve_path(path)
            ok, msg = self.validate_path(resolved, for_create=False)
            if not ok:
                code = (
                    ProjectErrorCode.PATH_NOT_EXISTS if "不存在" in msg
                    else ProjectErrorCode.PERMISSION_DENIED if "权限" in msg
                    else ProjectErrorCode.PATH_EXISTS if "已被项目" in msg
                    else "VALIDATION_ERROR"
                )
                raise ProjectError(code, msg)

            if name is None:
                name = self._generate_name(resolved)
            else:
                ok, msg = self._validate_name(name)
                if not ok:
                    raise ProjectError(ProjectErrorCode.INVALID_NAME, msg)

            if name in self._config.projects:
                raise ProjectError(ProjectErrorCode.PROJECT_EXISTS, f"项目名称 '{name}' 已存在")
            if len(self._config.projects) >= self.max_projects:
                raise ProjectError("LIMIT_EXCEEDED", f"项目数量已达上限 ({self.max_projects})")

            project = Project(
                name=name,
                display_name=display_name or name,
                path=resolved,
                created_at=datetime.now(),
                last_active=datetime.now(),
                description=description,
            )
            self._config.projects[name] = project
            if self._config.current_project is None:
                self._config.current_project = name
            await self._save_config()
            logger.info(f"添加项目: {name} -> {resolved}")
            return project

    async def create_project(
        self,
        path: str,
        name: Optional[str] = None,
        display_name: Optional[str] = None,
        description: str = "",
    ) -> Project:
        """创建新目录并添加为项目"""
        async with self._lock:
            resolved = self._resolve_path(path)
            ok, msg = self.validate_path(resolved, for_create=True)
            if not ok:
                code = (
                    ProjectErrorCode.PARENT_NOT_EXISTS if "父目录不存在" in msg
                    else ProjectErrorCode.PERMISSION_DENIED if "权限" in msg
                    else ProjectErrorCode.PATH_EXISTS if "已被项目" in msg
                    else "VALIDATION_ERROR"
                )
                raise ProjectError(code, msg)

            if not resolved.exists():
                try:
                    resolved.mkdir(parents=True, exist_ok=True)
                except Exception as e:
                    raise ProjectError("CREATE_DIR_ERROR", f"创建目录失败: {e}")

            if name is None:
                name = self._generate_name(resolved)
            else:
                ok, msg = self._validate_name(name)
                if not ok:
                    raise ProjectError(ProjectErrorCode.INVALID_NAME, msg)

            if name in self._config.projects:
                raise ProjectError(ProjectErrorCode.PROJECT_EXISTS, f"项目名称 '{name}' 已存在")
            if len(self._config.projects) >= self.max_projects:
                raise ProjectError("LIMIT_EXCEEDED", f"项目数量已达上限 ({self.max_projects})")

            project = Project(
                name=name,
                display_name=display_name or name,
                path=resolved,
                created_at=datetime.now(),
                last_active=datetime.now(),
                description=description,
            )
            self._config.projects[name] = project
            self._config.current_project = name
            await self._save_config()
            logger.info(f"创建项目: {name} -> {resolved}")
            return project

    async def switch_project(self, name: str) -> Project:
        """切换到指定项目"""
        async with self._lock:
            if name not in self._config.projects:
                raise ProjectError(
                    ProjectErrorCode.PROJECT_NOT_FOUND,
                    f"项目 '{name}' 不存在，使用 /pl 查看所有项目",
                )
            project = self._config.projects[name]
            if not project.exists():
                raise ProjectError(
                    ProjectErrorCode.PATH_NOT_EXISTS,
                    f"项目目录不存在: {project.path}",
                )
            ok, msg = project.has_permission()
            if not ok:
                raise ProjectError(ProjectErrorCode.PERMISSION_DENIED, msg)

            self._config.current_project = name
            project.touch()
            await self._save_config()
            logger.info(f"切换项目: {name}")
            return project

    async def remove_project(self, name: str) -> bool:
        """从列表移除项目（不删除目录）"""
        async with self._lock:
            if name not in self._config.projects:
                return False
            del self._config.projects[name]
            if self._config.current_project == name:
                if self._config.projects:
                    self._config.current_project = max(
                        self._config.projects.items(),
                        key=lambda x: x[1].last_active,
                    )[0]
                else:
                    self._config.current_project = None
            await self._save_config()
            logger.info(f"移除项目: {name}")
            return True

    async def list_projects(self) -> List[Project]:
        """按最后活跃时间降序列出所有项目"""
        projects = list(self._config.projects.values())
        projects.sort(key=lambda p: p.last_active, reverse=True)
        return projects

    async def get_project(self, name: str) -> Optional[Project]:
        return self._config.projects.get(name)

    async def get_current_project(self) -> Optional[Project]:
        if self._config.current_project:
            return self._config.projects.get(self._config.current_project)
        return None

    async def add_session_to_project(self, project_name: str, session_id: str) -> None:
        async with self._lock:
            if project_name in self._config.projects:
                self._config.projects[project_name].add_session(session_id)
                await self._save_config()

    async def update_project_activity(self, project_name: str) -> None:
        async with self._lock:
            if project_name in self._config.projects:
                self._config.projects[project_name].touch()
                await self._save_config()

    @property
    def current_project_name(self) -> Optional[str]:
        return self._config.current_project

    def get_stats(self) -> Dict[str, Any]:
        return {
            "total_projects": len(self._config.projects),
            "max_projects": self.max_projects,
            "current_project": self._config.current_project,
        }
