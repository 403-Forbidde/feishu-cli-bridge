"""会话相关卡片构建模块

包含与会话管理相关的所有卡片构建函数：
- 新建会话成功卡片
- 会话列表卡片
- 会话详情卡片
"""

import logging
import os
import subprocess
from datetime import datetime
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


def build_new_session_card(
    session_id: str,
    session_title: str,
    working_dir: str,
    model: Optional[str] = None,
    cli_type: str = "",
    project_name: Optional[str] = None,
    project_display_name: Optional[str] = None,
    slug: Optional[str] = None,
) -> Dict[str, Any]:
    """
    构建「新建会话成功」卡片（Schema 2.0，与项目列表卡片风格一致）

    Args:
        session_id:           新会话原始 ID
        session_title:        新会话标题
        working_dir:          当前工作目录
        model:                当前模型 ID（可选）
        cli_type:             CLI 工具类型（如 opencode / codex）
        project_name:         当前项目标识（可选）
        project_display_name: 当前项目显示名（可选）
        slug:                 OpenCode 会话 slug（可选）

    Returns:
        飞书卡片 JSON（Schema 2.0，含 config/header/elements）
    """
    # 显示用的短 ID：优先使用 slug，否则取后 8 位
    display_id = slug if slug else (session_id[-8:] if len(session_id) > 8 else session_id)

    # 工作目录美化：home 目录替换为 ~
    home = os.path.expanduser("~")
    display_dir = (
        working_dir.replace(home, "~") if working_dir.startswith(home) else working_dir
    )

    cli_label = {"opencode": "OpenCode", "codex": "Codex"}.get(
        cli_type.lower(), cli_type or "AI"
    )

    def _kv(key: str, value: str) -> Dict[str, Any]:
        """Schema 2.0 两列行：左侧灰色标签，右侧内容"""
        return {
            "tag": "column_set",
            "flex_mode": "none",
            "columns": [
                {
                    "tag": "column",
                    "width": "auto",
                    "vertical_align": "top",
                    "elements": [
                        {
                            "tag": "markdown",
                            "content": f"<font color='grey'>{key}</font>",
                            "text_size": "normal",
                        }
                    ],
                },
                {
                    "tag": "column",
                    "width": "weighted",
                    "weight": 4,
                    "vertical_align": "top",
                    "elements": [
                        {
                            "tag": "markdown",
                            "content": value,
                            "text_size": "normal",
                        }
                    ],
                },
            ],
        }

    rows = [_kv("📋 会话", f"**{session_title or '新会话'}**  `{display_id}`")]

    if project_display_name or project_name:
        label = project_display_name or project_name
        name_suffix = (
            f"  `{project_name}`" if project_name and project_display_name else ""
        )
        rows.append(_kv("💼 项目", f"{label}{name_suffix}"))

    rows.append(_kv("📂 目录", f"`{display_dir}`"))

    if model:
        rows.append(_kv("🤖 模型", f"`{model}`"))

    elements: List[Dict[str, Any]] = [
        *rows,
        {"tag": "hr"},
        {
            "tag": "markdown",
            "content": f"<font color='grey'>💡 新消息将在此会话中与 {cli_label} 对话</font>",
            "text_size": "notation",
        },
    ]

    return {
        "schema": "2.0",
        "config": {"wide_screen_mode": True},
        "header": {
            "title": {"tag": "plain_text", "content": "✅ 已创建新会话"},
            "template": "green",
        },
        "body": {"elements": elements},
    }


def build_session_list_card(
    sessions: List[Dict[str, Any]],
    current_session_id: Optional[str] = None,
    cli_type: str = "opencode",
    deleting_session_id: Optional[str] = None,
    working_dir: str = "",
    total_count: Optional[int] = None,
) -> Dict[str, Any]:
    """构建会话列表卡片（Schema 2.0）

    Args:
        sessions: 会话列表，每个会话含 session_id, title, is_current, created_at, updated_at
        current_session_id: 当前活跃会话ID（绿色标记）
        cli_type: CLI类型，用于按钮 value
        deleting_session_id: 处于"确认删除"状态的会话ID（显示确认/取消按钮）
        working_dir: 当前工作目录路径
        total_count: 总会话数（用于显示"还有N条未显示"），None则使用len(sessions)

    Returns:
        飞书卡片 JSON（Schema 2.0）
    """
    elements: List[Dict[str, Any]] = []

    # ── 项目信息头部 ────────────────────────────────────────────────────────
    # 解析项目信息
    project_name = os.path.basename(working_dir) if working_dir else "未知项目"
    display_dir = working_dir
    home = os.path.expanduser("~")
    if display_dir.startswith(home):
        display_dir = display_dir.replace(home, "~", 1)

    # 获取 Git 分支
    git_branch = ""
    if working_dir and os.path.isdir(os.path.join(working_dir, ".git")):
        try:
            result = subprocess.run(
                ["git", "-C", working_dir, "branch", "--show-current"],
                capture_output=True,
                text=True,
                timeout=2,
            )
            if result.returncode == 0:
                git_branch = result.stdout.strip()
        except Exception:
            pass

    # 构建项目信息区域
    project_info_lines = [f"**📂 目录**: `{display_dir}`"]
    if git_branch:
        project_info_lines.append(f"**🌿 分支**: `{git_branch}`")
    project_info_lines.append(f"**💬 会话**: {len(sessions)} 个")

    elements.append({
        "tag": "markdown",
        "content": f"📁 **{project_name}**\n\n" + "\n".join(project_info_lines),
    })
    elements.append({"tag": "hr"})

    # ── 顶部标题行 + 新建按钮 ─────────────────────────────────────────────
    elements.append({
        "tag": "column_set",
        "flex_mode": "none",
        "columns": [
            {
                "tag": "column",
                "width": "weighted",
                "weight": 3,
                "elements": [{"tag": "markdown", "content": "💬 **会话列表**"}],
            },
            {
                "tag": "column",
                "width": "auto",
                "elements": [{
                    "tag": "button",
                    "text": {"tag": "plain_text", "content": "🆕 新建"},
                    "type": "primary",
                    "value": {"action": "create_new_session", "cli_type": cli_type, "working_dir": working_dir},
                }],
            },
        ],
    })
    elements.append({"tag": "hr"})

    # ── 会话列表 ──────────────────────────────────────────────────────────
    if not sessions:
        elements.append({
            "tag": "markdown",
            "content": "ℹ️ **暂无历史会话**\n\n发送消息开始对话，或点击「🆕 新建」",
        })
    else:
        session_list = sessions[:10]
        for i, session in enumerate(session_list, 1):
            session_id = session.get("session_id", "")
            title = session.get("title", "未命名会话")
            display_id = session.get("display_id", session_id[-8:] if len(session_id) >= 8 else session_id)
            is_current = session_id == current_session_id
            is_deleting = session_id == deleting_session_id

            # 格式化时间（优先 updated_at）
            time_str = ""
            timestamp = session.get("updated_at") or session.get("created_at", 0)
            if timestamp:
                try:
                    time_str = datetime.fromtimestamp(float(timestamp)).strftime("%m-%d %H:%M")
                except Exception:
                    time_str = ""

            # 第一行：状态图标 + ID + 时间
            status_icon = "🟢" if is_current else "🔴" if is_deleting else "⚪"
            first_line = f"{status_icon} **{display_id}**"
            if time_str:
                first_line += f"  ·  {time_str}"
            elements.append({"tag": "markdown", "content": first_line})

            # 第二行：标题 + 操作按钮
            if is_deleting:
                # 删除确认态：警告文字 + 确认/取消按钮
                elements.append({
                    "tag": "column_set",
                    "flex_mode": "none",
                    "columns": [
                        {
                            "tag": "column",
                            "width": "weighted",
                            "weight": 3,
                            "elements": [{
                                "tag": "markdown",
                                "content": f"📋 {title}\n<font color='red'>⚠️ 确认永久删除？</font>",
                            }],
                        },
                        {
                            "tag": "column",
                            "width": "auto",
                            "elements": [
                                {
                                    "tag": "button",
                                    "text": {"tag": "plain_text", "content": "✅ 确认"},
                                    "type": "danger",
                                    "value": {
                                        "action": "delete_session_confirmed",
                                        "session_id": session_id,
                                        "cli_type": cli_type,
                                    },
                                },
                                {
                                    "tag": "button",
                                    "text": {"tag": "plain_text", "content": "取消"},
                                    "type": "default",
                                    "value": {
                                        "action": "delete_session_cancel",
                                        "cli_type": cli_type,
                                    },
                                },
                            ],
                        },
                    ],
                })
            elif is_current:
                # 当前会话：标题 + 当前标记 + 改名按钮（无删除）
                elements.append({
                    "tag": "column_set",
                    "flex_mode": "none",
                    "columns": [
                        {
                            "tag": "column",
                            "width": "weighted",
                            "weight": 3,
                            "elements": [{
                                "tag": "markdown",
                                "content": f"📋 {title}\n<font color='green'>✓ 当前会话</font>",
                            }],
                        },
                        {
                            "tag": "column",
                            "width": "auto",
                            "elements": [
                                {
                    "tag": "button",
                    "text": {"tag": "plain_text", "content": "📝 改名"},
                    "type": "default",
                    "value": {
                        "action": "rename_session_prompt",
                        "session_id": session_id,
                        "session_title": title,
                        "cli_type": cli_type,
                        "working_dir": working_dir,
                    },
                },
                            ],
                        },
                    ],
                })
            else:
                # 非当前会话：标题 + 切换/改名/删除按钮
                elements.append({
                    "tag": "column_set",
                    "flex_mode": "none",
                    "columns": [
                        {
                            "tag": "column",
                            "width": "weighted",
                            "weight": 3,
                            "elements": [{"tag": "markdown", "content": f"📋 {title}"}],
                        },
                        {
                            "tag": "column",
                            "width": "auto",
                            "elements": [
                                {
                                    "tag": "button",
                                    "text": {"tag": "plain_text", "content": "▶ 切换"},
                                    "type": "primary",
                                    "value": {
                                        "action": "switch_session",
                                        "session_id": session_id,
                                        "cli_type": cli_type,
                                        "working_dir": working_dir,
                                    },
                                },
                                {
                    "tag": "button",
                    "text": {"tag": "plain_text", "content": "📝 改名"},
                    "type": "default",
                    "value": {
                        "action": "rename_session_prompt",
                        "session_id": session_id,
                        "session_title": title,
                        "cli_type": cli_type,
                        "working_dir": working_dir,
                    },
                },
                                {
                                    "tag": "button",
                                    "text": {"tag": "plain_text", "content": "🗑️ 删除"},
                                    "type": "danger",
                                    "value": {
                                        "action": "delete_session_confirm",
                                        "session_id": session_id,
                                        "session_title": title,
                                        "cli_type": cli_type,
                                        "working_dir": working_dir,
                                    },
                                },
                            ],
                        },
                    ],
                })

            if i < len(session_list):
                elements.append({"tag": "hr"})

    # ── 底部提示 ──────────────────────────────────────────────────────────
    elements.append({"tag": "hr"})

    # 显示超出提示（如果有超过10条会话未显示）
    actual_total = total_count if total_count is not None else len(sessions)
    if actual_total > 10:
        hidden_count = actual_total - 10
        elements.append({
            "tag": "markdown",
            "content": f"<font color='grey'>ℹ️ 还有 {hidden_count} 条历史会话未显示</font>",
            "text_size": "notation",
        })

    elements.append({
        "tag": "markdown",
        "content": "<font color='grey'>💡 点击「📝 改名」后直接回复新名称即可完成重命名</font>",
        "text_size": "notation",
    })

    return {
        "schema": "2.0",
        "header": {
            "title": {"tag": "plain_text", "content": "会话管理"},
            "template": "blue",
        },
        "body": {"elements": elements},
    }


def build_session_info_card(
    session_info: Dict[str, Any], cli_type: str = "opencode"
) -> Dict[str, Any]:
    """构建单个会话详情卡片

    Args:
        session_info: 会话信息，包含 session_id, title, messages_count 等
        cli_type: CLI类型

    Returns:
        飞书卡片 JSON（Schema 2.0）
    """
    session_id = session_info.get("session_id", "")
    title = session_info.get("title", "未命名会话")
    display_id = session_info.get("display_id", session_id[-8:] if len(session_id) >= 8 else session_id)
    created_at = session_info.get("created_at", "")
    updated_at = session_info.get("updated_at", "")
    messages_count = session_info.get("messages_count", 0)
    is_current = session_info.get("is_current", False)
    working_dir = session_info.get("working_dir", "")

    # 格式化时间
    def format_time(ts):
        if not ts:
            return "未知"
        try:
            dt = datetime.fromtimestamp(ts)
            return dt.strftime("%Y-%m-%d %H:%M:%S")
        except (ValueError, TypeError, OSError):
            return str(ts)

    elements = []

    # 状态标识
    if is_current:
        elements.append({"tag": "markdown", "content": "🟢 **当前激活会话**"})

    # 基本信息 - 使用 column_set 两列布局
    elements.append(
        {
            "tag": "column_set",
            "flex_mode": "none",
            "background_style": "default",
            "columns": [
                {
                    "tag": "column",
                    "width": "auto",
                    "elements": [
                        {
                            "tag": "markdown",
                            "content": "🆔",
                        }
                    ],
                },
                {
                    "tag": "column",
                    "weight": 4,
                    "elements": [
                        {
                            "tag": "markdown",
                            "content": f"`{display_id}`",
                        }
                    ],
                },
            ],
        }
    )

    elements.append(
        {
            "tag": "column_set",
            "flex_mode": "none",
            "background_style": "default",
            "columns": [
                {
                    "tag": "column",
                    "width": "auto",
                    "elements": [
                        {
                            "tag": "markdown",
                            "content": "📋",
                        }
                    ],
                },
                {
                    "tag": "column",
                    "weight": 4,
                    "elements": [{"tag": "markdown", "content": title}],
                },
            ],
        }
    )

    elements.append(
        {
            "tag": "column_set",
            "flex_mode": "none",
            "background_style": "default",
            "columns": [
                {
                    "tag": "column",
                    "width": "auto",
                    "elements": [
                        {
                            "tag": "markdown",
                            "content": "💬",
                        }
                    ],
                },
                {
                    "tag": "column",
                    "weight": 4,
                    "elements": [
                        {
                            "tag": "markdown",
                            "content": str(messages_count),
                        }
                    ],
                },
            ],
        }
    )

    elements.append(
        {
            "tag": "column_set",
            "flex_mode": "none",
            "background_style": "default",
            "columns": [
                {
                    "tag": "column",
                    "width": "auto",
                    "elements": [
                        {
                            "tag": "markdown",
                            "content": "🕐",
                        }
                    ],
                },
                {
                    "tag": "column",
                    "weight": 4,
                    "elements": [
                        {
                            "tag": "markdown",
                            "content": format_time(updated_at),
                        }
                    ],
                },
            ],
        }
    )

    # 操作按钮 - Schema 2.0 直接使用 button 标签，不用 action 包裹
    elements.append({"tag": "hr"})

    if not is_current:
        elements.append(
            {
                "tag": "button",
                "text": {"tag": "plain_text", "content": "▶ 切换到此会话"},
                "type": "primary",
                "value": {
                    "action": "switch_session",
                    "session_id": session_id,
                    "cli_type": cli_type,
                },
            }
        )

    elements.append(
        {
            "tag": "button",
            "text": {"tag": "plain_text", "content": "📝 重命名"},
            "type": "default",
            "value": {
                "action": "rename_session_prompt",
                "session_id": session_id,
                "cli_type": cli_type,
            },
        }
    )

    elements.append(
        {
            "tag": "button",
            "text": {"tag": "plain_text", "content": "📋 查看列表"},
            "type": "default",
            "value": {"action": "list_sessions", "cli_type": cli_type},
        }
    )

    return {
        "schema": "2.0",
        "header": {
            "title": {"tag": "plain_text", "content": "会话详情"},
            "template": "blue",
        },
        "body": {"elements": elements},
    }
