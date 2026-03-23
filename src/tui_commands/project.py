"""项目管理命令处理器

处理 /pa /pc /pl /ps /prm /pi 等项目命令
"""

import logging
import re
from datetime import datetime
from typing import Optional, Tuple

from .base import TUIResult
from ..project.manager import ProjectManager
from ..project.models import ProjectError

logger = logging.getLogger(__name__)

# 支持的命令前缀（完整命令和快捷命令）
_PROJECT_PREFIXES = (
    "/project",
    "/pa",
    "/pc",
    "/pl",
    "/ps",
    "/prm",
    "/pi",
)


def is_project_command(content: str) -> bool:
    """检查是否是项目管理命令"""
    for prefix in _PROJECT_PREFIXES:
        if content == prefix or content.startswith(prefix + " "):
            return True
    return False


def _smart_split(text: str) -> list:
    """支持引号的参数分割"""
    result = []
    current = ""
    in_quote = False
    quote_char = None
    for char in text:
        if char in ('"', "'") and not in_quote:
            in_quote = True
            quote_char = char
        elif char == quote_char and in_quote:
            in_quote = False
            quote_char = None
        elif char.isspace() and not in_quote:
            if current:
                result.append(current)
                current = ""
        else:
            current += char
    if current:
        result.append(current)
    return result


def _parse_add_args(args: str) -> Tuple[str, Optional[str], Optional[str]]:
    """解析 add/create 参数: <路径> [名称] [显示名]

    返回 (路径, 名称, 显示名)
    名称必须是英文标识符；显示名可中文。
    """
    parts = _smart_split(args)
    if not parts:
        return "", None, None

    path = parts[0]
    name: Optional[str] = None
    display_name: Optional[str] = None

    def _is_valid_name(s: str) -> bool:
        return bool(re.match(r"^[a-zA-Z][a-zA-Z0-9_-]*$", s))

    def _has_chinese(s: str) -> bool:
        return any("\u4e00" <= c <= "\u9fff" for c in s)

    if len(parts) >= 2:
        second = parts[1]
        if _has_chinese(second):
            display_name = second
        elif _is_valid_name(second):
            name = second
            if len(parts) >= 3:
                display_name = parts[2]
        else:
            display_name = second

    return path, name, display_name


def _format_time(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d %H:%M")


def _format_project_list(projects: list, current_name: Optional[str]) -> str:
    if not projects:
        return "📁 **项目列表**\n\n暂无项目，使用 `/pa <路径>` 添加已有项目，或 `/pc <路径>` 创建新项目。"

    lines = ["📁 **项目列表**", ""]
    for i, p in enumerate(projects, 1):
        marker = " ★" if p.name == current_name else ""
        status = "✅" if p.exists() else "❌"
        lines.append(f"**{i}.** {status} **{p.display_name}**{marker}")
        lines.append(f"   标识: `{p.name}`")
        lines.append(f"   路径: `{p.path}`")
        lines.append(f"   活跃: {_format_time(p.last_active)}")
        if p.description:
            lines.append(f"   描述: {p.description}")
        lines.append("")

    lines.append("━━━━━━━━━━━━━━")
    lines.append("💡 `/ps <标识>` 切换项目 · `/pi <标识>` 查看详情")
    return "\n".join(lines)


async def execute_project_command(
    content: str,
    project_manager: ProjectManager,
) -> TUIResult:
    """解析并执行项目命令，返回 TUIResult"""
    content = content.strip()

    # 展开快捷命令 → 标准子命令
    cmd_map = {
        "/pa": "add",
        "/pc": "create",
        "/pl": "list",
        "/ps": "switch",
        "/prm": "remove",
        "/pi": "info",
    }
    sub_cmd = ""
    args = ""

    matched_shortcut = False
    for shortcut, sub in cmd_map.items():
        if content == shortcut or content.startswith(shortcut + " "):
            sub_cmd = sub
            args = content[len(shortcut) :].strip()
            matched_shortcut = True
            break

    if not matched_shortcut:
        # /project <sub> <args>
        rest = content[len("/project") :].strip()
        parts = rest.split(maxsplit=1)
        if not parts:
            return TUIResult.text(_get_help_text())
        sub_cmd_aliases = {
            "add": "add",
            "a": "add",
            "create": "create",
            "c": "create",
            "new": "create",
            "list": "list",
            "l": "list",
            "ls": "list",
            "switch": "switch",
            "s": "switch",
            "sw": "switch",
            "remove": "remove",
            "rm": "remove",
            "info": "info",
            "i": "info",
            "help": "help",
            "h": "help",
        }
        sub_cmd = sub_cmd_aliases.get(parts[0].lower(), "unknown")
        args = parts[1] if len(parts) > 1 else ""

    try:
        if sub_cmd == "list":
            projects = await project_manager.list_projects()
            current = project_manager.current_project_name
            from ..feishu.card_builder import build_project_list_card

            card = build_project_list_card(projects, current)
            return TUIResult.card("", metadata={"card_json": card})

        elif sub_cmd in ("add", "create"):
            if not args:
                hint = (
                    "/pa <路径> <项目名称>"
                    if sub_cmd == "add"
                    else "/pc <路径> <项目名称>"
                )
                return TUIResult.error(f"请提供路径。用法: `{hint}`")
            path, name, display_name = _parse_add_args(args)
            if not path:
                return TUIResult.error("路径不能为空")

            if sub_cmd == "add":
                await project_manager.add_project(
                    path, name=name, display_name=display_name
                )
            else:
                await project_manager.create_project(
                    path, name=name, display_name=display_name
                )

            projects = await project_manager.list_projects()
            current = project_manager.current_project_name
            from ..feishu.card_builder import build_project_list_card

            card = build_project_list_card(projects, current)
            return TUIResult.card("", metadata={"card_json": card})

        elif sub_cmd == "switch":
            if not args:
                return TUIResult.error("请提供项目名称。用法: `/ps <标识>`")
            name = args.split()[0]
            project = await project_manager.switch_project(name)
            return TUIResult.text(
                f"✅ 已切换到项目 **{project.display_name}**\n\n"
                f"**标识**: `{project.name}`\n"
                f"**路径**: `{project.path}`\n\n"
                f"后续对话将在此目录下执行。"
            )

        elif sub_cmd == "remove":
            if not args:
                return TUIResult.error("请提供项目名称。用法: `/prm <标识>`")
            name = args.split()[0]
            project = await project_manager.get_project(name)
            if not project:
                return TUIResult.error(
                    f"项目 '{name}' 不存在。使用 `/pl` 查看所有项目。"
                )
            removed = await project_manager.remove_project(name)
            if removed:
                return TUIResult.text(
                    f"✅ 已移除项目 `{name}`（目录未删除）\n\n使用 `/pl` 查看剩余项目。"
                )
            return TUIResult.error(f"移除项目 '{name}' 失败")

        elif sub_cmd == "info":
            if args:
                name = args.split()[0]
                project = await project_manager.get_project(name)
                if not project:
                    return TUIResult.error(
                        f"项目 '{name}' 不存在。使用 `/pl` 查看所有项目。"
                    )
            else:
                project = await project_manager.get_current_project()
                if not project:
                    return TUIResult.text(
                        "当前没有激活的项目。使用 `/pa <路径>` 添加项目。"
                    )

            current = project_manager.current_project_name
            is_current = project.name == current

            from ..feishu.card_builder import build_project_info_card

            card = build_project_info_card(project, is_current)
            return TUIResult.card(card)

        elif sub_cmd in ("help", "unknown"):
            return TUIResult.text(_get_help_text())

        else:
            return TUIResult.error(f"未知子命令: {sub_cmd}。使用 `/pi help` 查看帮助。")

    except ProjectError as e:
        return TUIResult.error(e.message)
    except Exception as e:
        logger.exception(f"执行项目命令失败: {content}")
        return TUIResult.error(f"命令执行失败: {e}")


def _get_help_text() -> str:
    return """📁 **项目管理命令**

**快捷命令:**
`/pa <路径> <项目名称>` — 添加已有目录为项目
`/pc <路径> <项目名称>` — 创建新目录并添加为项目
`/pl` — 列出所有项目
`/ps <标识>` — 切换到指定项目
`/prm <标识>` — 从列表移除项目（不删除目录）
`/pi [标识]` — 查看项目信息（省略标识则查看当前项目）

**示例:**
```
/pa ~/code/my-app myapp
/pc ~/code/new-project myproject
/pl
/ps myapp
/prm myapp
```

**说明:**
• 标识：英文字母/数字/下划线/连字符，用于命令参数
• 显示名：可以是中文，用于展示（第二参数为中文时自动识别）
• 切换项目后，AI 对话将在对应目录下执行
"""
