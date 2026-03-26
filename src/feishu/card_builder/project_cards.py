"""项目相关卡片构建模块

包含与项目管理相关的所有卡片构建函数：
- 项目列表卡片
- 项目信息卡片
"""

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


def build_project_list_card(
    projects: list,
    current_project_name: Optional[str] = None,
    confirming_project: Optional[str] = None,
) -> Dict[str, Any]:
    """
    构建带「切换」「删除」按钮的项目列表卡片（Schema 2.0 格式）

    当前项目用绿色高亮标识，非当前项目显示详情 + 切换按钮。
    点击按钮后飞书推送 im.card.action.trigger_v1 事件，handler 处理。

    Args:
        projects:             Project 对象列表
        current_project_name: 当前激活项目名（用于标记 ⭐）
        confirming_project:   处于二次确认删除状态的项目名

    Returns:
        飞书卡片 JSON（Schema 2.0，含 config/header/body/elements）
    """
    elements: List[Dict[str, Any]] = []

    if not projects:
        elements.append(
            {
                "tag": "markdown",
                "content": "📭 **暂无项目**\n\n使用 `/pa <路径>` 添加项目，或 `/pc <路径>` 创建新项目。",
            }
        )
    else:
        # ── 当前激活区块（绿色高亮）────────────────────────────────────────
        current_project = next(
            (p for p in projects if p.name == current_project_name), None
        )
        if current_project:
            p = current_project
            path = str(p.path)
            exists = p.exists()
            last_active = (
                p.last_active.strftime("%m-%d %H:%M")
                if isinstance(p.last_active, datetime)
                else str(p.last_active)[:16]
            )
            exists_hint = "✅ 目录存在" if exists else "⚠️ 目录不存在"

            elements.append(
                {
                    "tag": "markdown",
                    "content": "<font color='grey'>当前激活</font>",
                }
            )
            elements.append(
                {
                    "tag": "markdown",
                    "content": (
                        f"<font color='green'>🟢 **{p.display_name}**</font>\n"
                        f"标识: `{p.name}` · 活跃: {last_active}\n"
                        f"路径: `{path}`\n"
                        f"<font color='grey'>{exists_hint}</font>"
                    ),
                }
            )
            elements.append({"tag": "hr"})

        # ── 非激活项目：详情 + 操作按钮 ─────────────────────────────────────
        inactive_projects = [p for p in projects if p.name != current_project_name]
        for i, p in enumerate(inactive_projects, 1):
            name = p.name
            display_name = p.display_name
            path = str(p.path)
            exists = p.exists()
            is_confirming = name == confirming_project

            last_active = (
                p.last_active.strftime("%m-%d %H:%M")
                if isinstance(p.last_active, datetime)
                else str(p.last_active)[:16]
            )

            inactive_icon = "🟡" if exists else "🔴"
            not_exists_hint = (
                "\n<font color='red'>⚠️ 目录不存在</font>" if not exists else ""
            )
            elements.append(
                {
                    "tag": "markdown",
                    "content": (
                        f"{inactive_icon} **{display_name}**{not_exists_hint}\n"
                        f"标识: `{name}` · 活跃: {last_active}\n"
                        f"路径: `{path}`"
                    ),
                }
            )

            # 操作按钮
            if is_confirming:
                elements.append(
                    {
                        "tag": "button",
                        "text": {"tag": "plain_text", "content": "⚠️ 确认删除"},
                        "type": "danger",
                        "value": {
                            "action": "delete_project_confirmed",
                            "project_name": name,
                        },
                    }
                )
                elements.append(
                    {
                        "tag": "button",
                        "text": {"tag": "plain_text", "content": "取消"},
                        "type": "default",
                        "value": {
                            "action": "delete_project_cancel",
                            "project_name": name,
                        },
                    }
                )
            elif not exists:
                # 目录不存在：仅删除
                elements.append(
                    {
                        "tag": "button",
                        "text": {"tag": "plain_text", "content": "🗑️ 删除"},
                        "type": "danger",
                        "value": {
                            "action": "delete_project_confirm",
                            "project_name": name,
                        },
                    }
                )
            else:
                # 正常项目：切换 + 删除
                elements.append(
                    {
                        "tag": "button",
                        "text": {"tag": "plain_text", "content": "▶ 切换至此"},
                        "type": "primary",
                        "value": {
                            "action": "switch_project",
                            "project_name": name,
                        },
                    }
                )
                elements.append(
                    {
                        "tag": "button",
                        "text": {"tag": "plain_text", "content": "🗑️ 删除"},
                        "type": "danger",
                        "value": {
                            "action": "delete_project_confirm",
                            "project_name": name,
                        },
                    }
                )

            if i < len(inactive_projects):
                elements.append({"tag": "hr"})

    # ── 底部说明 ───────────────────────────────────────────────────────
    elements.append({"tag": "hr"})
    elements.append(
        {
            "tag": "markdown",
            "content": "📌 **命令说明**\n\n`/pa <路径>` — 添加已有目录为项目\n`/pc <路径>` — 创建新目录并添加项目",
        }
    )
    elements.append(
        {
            "tag": "markdown",
            "content": "<font color='grey'>💡 点击「🗑️ 删除」仅从列表移除，不会删除磁盘上的目录</font>",
        }
    )

    title_text = f"📁 项目列表（共 {len(projects)} 个）" if projects else "📁 项目列表"
    return {
        "schema": "2.0",
        "config": {"wide_screen_mode": True, "update_multi": True},
        "header": {
            "title": {"tag": "plain_text", "content": title_text},
            "template": "blue",
        },
        "body": {"elements": elements},
    }


def build_project_info_card(
    project: Any,
    is_current: bool = False,
) -> Dict[str, Any]:
    """
    构建项目信息详情卡片（Schema 2.0 格式）

    Args:
        project: Project 对象
        is_current: 是否为当前激活项目

    Returns:
        飞书卡片 JSON（Schema 2.0）
    """
    elements: List[Dict[str, Any]] = []

    # 当前项目标记
    active_marker = "🟢 **当前项目**\n\n" if is_current else ""
    status_icon = "✅" if project.exists() else "⚠️"
    status_text = "目录存在" if project.exists() else "目录不存在"

    # 项目基本信息
    elements.append(
        {
            "tag": "markdown",
            "content": (
                f"{active_marker}"
                f"**{project.display_name}**\n"
                f"<font color='grey'>标识: `{project.name}`</font>"
            ),
        }
    )
    elements.append({"tag": "hr"})

    # 详细信息
    created_at = (
        project.created_at.strftime("%Y-%m-%d %H:%M")
        if isinstance(project.created_at, datetime)
        else str(project.created_at)[:16]
    )
    last_active = (
        project.last_active.strftime("%Y-%m-%d %H:%M")
        if isinstance(project.last_active, datetime)
        else str(project.last_active)[:16]
    )

    info_lines = [
        f"**路径**: `{project.path}`",
        f"**状态**: {status_icon} {status_text}",
        f"**创建时间**: {created_at}",
        f"**最后活跃**: {last_active}",
        f"**关联会话**: {len(project.session_ids)} 个",
    ]
    if project.description:
        info_lines.append(f"**描述**: {project.description}")

    elements.append(
        {
            "tag": "markdown",
            "content": "\n".join(info_lines),
        }
    )

    # 操作按钮
    elements.append({"tag": "hr"})
    if not is_current and project.exists():
        elements.append(
            {
                "tag": "button",
                "text": {"tag": "plain_text", "content": "▶ 切换到此项目"},
                "type": "primary",
                "value": {
                    "action": "switch_project",
                    "project_name": project.name,
                },
            }
        )
    elements.append(
        {
            "tag": "button",
            "text": {"tag": "plain_text", "content": "📋 查看项目列表"},
            "type": "default",
            "value": {"action": "show_project_list"},
        }
    )

    return {
        "schema": "2.0",
        "config": {"wide_screen_mode": True, "update_multi": True},
        "header": {
            "title": {"tag": "plain_text", "content": "📁 项目信息"},
            "template": "blue",
        },
        "body": {"elements": elements},
    }
