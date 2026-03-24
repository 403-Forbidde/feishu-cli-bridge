"""
飞书卡片构建工具

构建用于不同状态的飞书交互式卡片消息：
- thinking:  思考中（CardKit 创建失败时的 IM 回退卡片）
- streaming: 流式输出中（IM Patch 回退时使用）
- complete:  完成（带可折叠思考面板 + 元信息 footer）

卡片格式：飞书交互式卡片 Schema 2.0（body.elements 结构）
流式打字机：通过 CardKit card.create + cardElement.content 实现

参考：
- OpenClaw-Lark builder.js + markdown-style.js (MIT License, Copyright 2026 ByteDance)
- kimibridge card_builder.py + markdown_formatter.py
"""

import logging
import re
from datetime import datetime
from typing import Dict, Any, List, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# 元素 ID 常量
# ---------------------------------------------------------------------------

# CardKit cardElement.content() API 的目标元素 ID
STREAMING_ELEMENT_ID = "streaming_content"
REASONING_ELEMENT_ID = "reasoning_content"


# ---------------------------------------------------------------------------
# 主入口
# ---------------------------------------------------------------------------


def build_card_content(
    state: str, data: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    构建飞书交互式卡片内容

    Args:
        state: 卡片状态 —— 'thinking' | 'streaming' | 'complete'
        data:  卡片数据字典

    Returns:
        飞书卡片 JSON 对象（Schema 2.0）
    """
    data = data or {}

    if state == "thinking":
        return _build_thinking_card()
    elif state == "streaming":
        return _build_streaming_card(
            text=data.get("text", ""),
            reasoning_text=data.get("reasoning_text"),
        )
    elif state == "complete":
        return _build_complete_card(
            text=data.get("text", ""),
            elapsed_ms=data.get("elapsed_ms"),
            is_error=data.get("is_error", False),
            reasoning_text=data.get("reasoning_text"),
            reasoning_elapsed_ms=data.get("reasoning_elapsed_ms"),
            token_stats=data.get("token_stats"),
            model=data.get("model", ""),
        )
    else:
        raise ValueError(f"未知的卡片状态: {state}")


# ---------------------------------------------------------------------------
# 新建会话卡片（Schema 2.0，与项目管理风格统一）
# ---------------------------------------------------------------------------


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
    import os

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


# ---------------------------------------------------------------------------
# 项目列表交互式卡片（Schema 2.0 + action/button，支持点击回调）
# ---------------------------------------------------------------------------


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


def build_mode_select_card(
    agents: List[Dict[str, Any]],
    current_agent: str,
    cli_type: str = "opencode",
) -> Dict[str, Any]:
    """
    构建 agent 模式切换卡片（Schema 2.0 格式）

    当前 agent 用绿色 primary 按钮标识，其余为 default 按钮。
    点击后推送 im.card.action.trigger_v1，handler 处理 switch_mode 动作。

    Args:
        agents:        用户可见的 agent 列表，每项含 name / description
        current_agent: 当前激活的 agent 名称
        cli_type:      CLI 工具类型（写入按钮 value，供 handler 路由）
    """
    elements: List[Dict[str, Any]] = []

    def _label(a: Dict[str, Any]) -> str:
        return a.get("display_name") or a["name"]

    current_info = next((a for a in agents if a["name"] == current_agent), None)
    current_label = _label(current_info) if current_info else current_agent
    current_desc = current_info.get("description", "") if current_info else ""

    # ── 当前激活区块（绿色高亮，无切换按钮）─────────────────────────────
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
                f"<font color='green'>🟢 **{current_label}**</font>\n{current_desc}"
            ),
        }
    )
    elements.append({"tag": "hr"})

    # ── 其余 agent：名称 + 描述 + 醒目蓝色切换按钮 ───────────────────────
    for agent in agents:
        name = agent["name"]
        label = _label(agent)
        desc = agent.get("description", "")
        if name == current_agent:
            continue

        elements.append(
            {
                "tag": "markdown",
                "content": f"**{label}**\n<font color='grey'>{desc}</font>",
            }
        )
        elements.append(
            {
                "tag": "button",
                "text": {"tag": "plain_text", "content": "▶ 切换至此"},
                "type": "primary",
                "value": {
                    "action": "switch_mode",
                    "agent_id": name,
                    "cli_type": cli_type,
                },
            }
        )

    return {
        "schema": "2.0",
        "config": {"wide_screen_mode": True, "update_multi": True},
        "header": {
            "title": {"tag": "plain_text", "content": "🔄 切换 Agent 模式"},
            "template": "blue",
        },
        "body": {"elements": elements},
    }


def build_model_select_card(
    models: List[Dict[str, Any]],
    current_model: str,
    cli_type: str = "opencode",
) -> Dict[str, Any]:
    """
    构建模型切换卡片（与 Agent 模式卡片风格一致）

    当前模型用绿色高亮标识，其余模型显示名称 + ID + 切换按钮。
    底部附 config.yaml 模型列表管理说明。

    Args:
        models:        可用模型列表，每项含 provider / model / name / full_id
        current_model: 当前激活的模型 full_id（如 kimi-for-coding/k2p5）
        cli_type:      CLI 工具类型（写入按钮 value，供 handler 路由）
    """
    elements: List[Dict[str, Any]] = []

    current_info = next((m for m in models if m.get("full_id") == current_model), None)
    current_name = (
        current_info.get("name", current_model) if current_info else current_model
    )

    # ── 当前激活模型（绿色高亮，无切换按钮）──────────────────────────────
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
                f"<font color='green'>🟢 **{current_name}**</font>\n"
                f"<font color='grey'>`{current_model}`</font>"
            ),
        }
    )
    elements.append({"tag": "hr"})

    # ── 其余模型：名称 + ID + 切换按钮 ──────────────────────────────────
    for model in models:
        full_id = model.get("full_id", "")
        if full_id == current_model:
            continue

        name = model.get("name", full_id)
        elements.append(
            {
                "tag": "markdown",
                "content": f"**{name}**\n<font color='grey'>`{full_id}`</font>",
            }
        )
        elements.append(
            {
                "tag": "button",
                "text": {"tag": "plain_text", "content": "▶ 切换至此"},
                "type": "primary",
                "value": {
                    "action": "switch_model",
                    "model_id": full_id,
                    "cli_type": cli_type,
                },
            }
        )

    # ── 底部：模型列表管理说明 ────────────────────────────────────────────
    elements.append({"tag": "hr"})
    elements.append(
        {
            "tag": "markdown",
            "content": "💡 <font color='grey'>在 `config.yaml` 中管理模型列表，格式参考 `config.example.yaml`</font>",
        }
    )

    return {
        "schema": "2.0",
        "config": {"wide_screen_mode": True},
        "header": {
            "title": {"tag": "plain_text", "content": "🤖 切换模型"},
            "template": "turquoise",
        },
        "elements": elements,
    }


def build_help_card(
    cli_type: str = "opencode",
    working_dir: str = "",
    project_name: Optional[str] = None,
) -> Dict[str, Any]:
    """
    构建 TUI 命令帮助卡片（Schema 2.0 格式）

    展示当前 CLI 工具支持的所有 TUI 命令及其说明。

    Args:
        cli_type: CLI 工具类型（如 opencode）
        working_dir: 当前工作目录
        project_name: 当前项目名称

    Returns:
        飞书卡片 JSON（Schema 2.0）
    """
    elements: List[Dict[str, Any]] = []

    # ── 头部信息 ─────────────────────────────────────────────────────────────
    header_text = f"🟢 **{cli_type.upper()}**"
    if project_name:
        header_text += f" · 项目: `{project_name}`"

    elements.append(
        {
            "tag": "markdown",
            "content": header_text,
        }
    )
    if working_dir:
        elements.append(
            {
                "tag": "markdown",
                "content": f"<font color='grey'>工作目录: `{working_dir}`</font>",
            }
        )
    elements.append({"tag": "hr"})

    # ── 命令列表 ─────────────────────────────────────────────────────────────
    commands = [
        {
            "cmd": "/new",
            "desc": "创建新会话",
            "detail": "在 OpenCode 中创建一个新的对话会话",
        },
        {
            "cmd": "/session",
            "desc": "管理会话",
            "detail": "列出当前项目的所有会话",
        },
        {
            "cmd": "/model",
            "desc": "切换模型",
            "detail": "查看可用模型列表并切换当前使用的 AI 模型",
        },
        {
            "cmd": "/mode",
            "desc": "切换模式",
            "detail": "切换 Agent 工作模式（如 build、debug、review）",
        },
        {
            "cmd": "/reset",
            "desc": "重置会话",
            "detail": "清空当前会话的对话历史，重新开始",
        },
        {
            "cmd": "/help",
            "desc": "显示帮助",
            "detail": "显示此帮助信息",
        },
    ]

    for item in commands:
        elements.append(
            {
                "tag": "markdown",
                "content": (
                    f"**{item['cmd']}** "
                    f"<font color='grey'>{item['desc']}</font>\n"
                    f"{item['detail']}"
                ),
            }
        )
        elements.append({"tag": "hr"})

    # ── 底部提示 ─────────────────────────────────────────────────────────────
    elements.append(
        {
            "tag": "markdown",
            "content": "💡 <font color='grey'>命令可随时输入，不受流式输出影响</font>",
        }
    )

    return {
        "schema": "2.0",
        "config": {"wide_screen_mode": True},
        "header": {
            "title": {"tag": "plain_text", "content": "📖 命令帮助"},
            "template": "blue",
        },
        "body": {"elements": elements},
    }


def build_reset_success_card() -> Dict[str, Any]:
    """
    构建重置成功提示卡片（Schema 2.0 格式）

    Returns:
        飞书卡片 JSON（Schema 2.0）
    """
    elements: List[Dict[str, Any]] = [
        {
            "tag": "markdown",
            "content": "🗑️ 对话历史已清空",
        },
        {
            "tag": "markdown",
            "content": "💡 可以开始新的对话了",
        },
    ]

    return {
        "schema": "2.0",
        "config": {"wide_screen_mode": True},
        "header": {
            "title": {"tag": "plain_text", "content": "✅ 已重置当前会话"},
            "template": "green",
        },
        "body": {"elements": elements},
    }


# ---------------------------------------------------------------------------
# Schema 2.0 测试卡片（交互式）
# ---------------------------------------------------------------------------


def build_test_card_v2_initial() -> Dict[str, Any]:
    """
    构建 Schema 2.0 测试卡片 - 初始状态

    展示 Schema 2.0 的现代化布局和交互按钮。
    """
    from datetime import datetime

    current_time = datetime.now().strftime("%H:%M:%S")

    return {
        "schema": "2.0",
        "config": {"wide_screen_mode": True},
        "header": {
            "title": {"tag": "plain_text", "content": "🧪 Schema 2.0 交互测试"},
            "template": "blue",
        },
        "body": {
            "elements": [
                {
                    "tag": "markdown",
                    "content": "<font color='grey'>💡 点击下方按钮测试卡片更新功能</font>",
                },
                {"tag": "hr"},
                {
                    "tag": "column_set",
                    "flex_mode": "none",
                    "columns": [
                        {
                            "tag": "column",
                            "width": "auto",
                            "elements": [
                                {
                                    "tag": "markdown",
                                    "content": "<font color='grey'>当前状态</font>",
                                }
                            ],
                        },
                        {
                            "tag": "column",
                            "width": "weighted",
                            "weight": 3,
                            "elements": [
                                {
                                    "tag": "markdown",
                                    "content": "🟢 **初始状态**",
                                }
                            ],
                        },
                    ],
                },
                {
                    "tag": "column_set",
                    "flex_mode": "none",
                    "columns": [
                        {
                            "tag": "column",
                            "width": "auto",
                            "elements": [
                                {
                                    "tag": "markdown",
                                    "content": "<font color='grey'>创建时间</font>",
                                }
                            ],
                        },
                        {
                            "tag": "column",
                            "width": "weighted",
                            "weight": 3,
                            "elements": [
                                {
                                    "tag": "markdown",
                                    "content": f"`{current_time}`",
                                }
                            ],
                        },
                    ],
                },
                {"tag": "hr"},
                {
                    "tag": "button",
                    "text": {"tag": "plain_text", "content": "📊 显示详情"},
                    "type": "primary",
                    "value": {
                        "action": "test_card_action",
                        "sub_action": "show_details",
                    },
                },
                {
                    "tag": "button",
                    "text": {"tag": "plain_text", "content": "📈 数据展示"},
                    "type": "default",
                    "value": {
                        "action": "test_card_action",
                        "sub_action": "show_data",
                    },
                },
                {
                    "tag": "button",
                    "text": {"tag": "plain_text", "content": "❌ 结束测试"},
                    "type": "danger",
                    "value": {
                        "action": "test_card_action",
                        "sub_action": "close_test",
                    },
                },
            ]
        },
    }


def build_test_card_v2_details() -> Dict[str, Any]:
    """
    构建 Schema 2.0 测试卡片 - 详情状态

    展示可折叠面板（Schema 2.0 独有特性）。
    """
    return {
        "schema": "2.0",
        "config": {"wide_screen_mode": True},
        "header": {
            "title": {"tag": "plain_text", "content": "🧪 Schema 2.0 交互测试"},
            "template": "green",
        },
        "body": {
            "elements": [
                {
                    "tag": "markdown",
                    "content": "<font color='green'>✅ 已切换到详情视图</font>",
                },
                {"tag": "hr"},
                {
                    "tag": "column_set",
                    "flex_mode": "none",
                    "columns": [
                        {
                            "tag": "column",
                            "width": "auto",
                            "elements": [
                                {
                                    "tag": "markdown",
                                    "content": "<font color='grey'>当前状态</font>",
                                }
                            ],
                        },
                        {
                            "tag": "column",
                            "width": "weighted",
                            "weight": 3,
                            "elements": [
                                {
                                    "tag": "markdown",
                                    "content": "🔵 **详情展示**",
                                }
                            ],
                        },
                    ],
                },
                {
                    "tag": "collapsible_panel",
                    "expanded": True,
                    "header": {
                        "title": {
                            "tag": "markdown",
                            "content": "📋 Schema 2.0 特性说明",
                        },
                        "icon": {
                            "tag": "standard_icon",
                            "token": "down-small-ccm_outlined",
                            "size": "16px 16px",
                        },
                        "icon_position": "follow_text",
                        "icon_expanded_angle": -180,
                    },
                    "border": {"color": "blue", "corner_radius": "6px"},
                    "padding": "12px",
                    "elements": [
                        {
                            "tag": "markdown",
                            "content": (
                                "**Schema 2.0 优势：**\n"
                                "• 🎨 **现代化布局** - column_set 两列排版\n"
                                "• 📦 **可折叠面板** - collapsible_panel 交互\n"
                                "• 🎯 **彩色标签** - header template 主题色\n"
                                "• ⚡ **流畅更新** - CardKit API 实时刷新"
                            ),
                        }
                    ],
                },
                {"tag": "hr"},
                {
                    "tag": "button",
                    "text": {"tag": "plain_text", "content": "📈 数据展示"},
                    "type": "default",
                    "value": {
                        "action": "test_card_action",
                        "sub_action": "show_data",
                    },
                },
                {
                    "tag": "button",
                    "text": {"tag": "plain_text", "content": "❌ 结束测试"},
                    "type": "danger",
                    "value": {
                        "action": "test_card_action",
                        "sub_action": "close_test",
                    },
                },
            ]
        },
    }


def build_test_card_v2_data() -> Dict[str, Any]:
    """
    构建 Schema 2.0 测试卡片 - 数据展示状态

    展示两列数据布局。
    """
    return {
        "schema": "2.0",
        "config": {"wide_screen_mode": True},
        "header": {
            "title": {"tag": "plain_text", "content": "🧪 Schema 2.0 交互测试"},
            "template": "turquoise",
        },
        "body": {
            "elements": [
                {
                    "tag": "markdown",
                    "content": "<font color='turquoise'>📊 已切换到数据视图</font>",
                },
                {"tag": "hr"},
                {
                    "tag": "markdown",
                    "content": "**性能指标**",
                },
                {
                    "tag": "column_set",
                    "flex_mode": "none",
                    "columns": [
                        {
                            "tag": "column",
                            "width": "weighted",
                            "weight": 1,
                            "elements": [
                                {
                                    "tag": "markdown",
                                    "content": "<font color='grey'>卡片渲染</font>\n**<font color='green'>12ms</font>**",
                                }
                            ],
                        },
                        {
                            "tag": "column",
                            "width": "weighted",
                            "weight": 1,
                            "elements": [
                                {
                                    "tag": "markdown",
                                    "content": "<font color='grey'>API 延迟</font>\n**<font color='green'>85ms</font>**",
                                }
                            ],
                        },
                        {
                            "tag": "column",
                            "width": "weighted",
                            "weight": 1,
                            "elements": [
                                {
                                    "tag": "markdown",
                                    "content": "<font color='grey'>更新速度</font>\n**<font color='green'>100ms</font>**",
                                }
                            ],
                        },
                    ],
                },
                {"tag": "hr"},
                {
                    "tag": "column_set",
                    "flex_mode": "none",
                    "columns": [
                        {
                            "tag": "column",
                            "width": "auto",
                            "elements": [
                                {
                                    "tag": "markdown",
                                    "content": "<font color='grey'>当前状态</font>",
                                }
                            ],
                        },
                        {
                            "tag": "column",
                            "width": "weighted",
                            "weight": 3,
                            "elements": [
                                {
                                    "tag": "markdown",
                                    "content": "🟣 **数据展示**",
                                }
                            ],
                        },
                    ],
                },
                {"tag": "hr"},
                {
                    "tag": "button",
                    "text": {"tag": "plain_text", "content": "📊 显示详情"},
                    "type": "default",
                    "value": {
                        "action": "test_card_action",
                        "sub_action": "show_details",
                    },
                },
                {
                    "tag": "button",
                    "text": {"tag": "plain_text", "content": "❌ 结束测试"},
                    "type": "danger",
                    "value": {
                        "action": "test_card_action",
                        "sub_action": "close_test",
                    },
                },
            ]
        },
    }


def build_test_card_v2_closed() -> Dict[str, Any]:
    """
    构建 Schema 2.0 测试卡片 - 结束状态

    测试完成后的最终状态。
    """
    return {
        "schema": "2.0",
        "config": {"wide_screen_mode": True},
        "header": {
            "title": {"tag": "plain_text", "content": "🧪 Schema 2.0 交互测试"},
            "template": "grey",
        },
        "body": {
            "elements": [
                {
                    "tag": "markdown",
                    "content": (
                        "<font color='grey'>✅ **测试已完成**</font>\n\n"
                        "感谢体验 Schema 2.0 交互卡片！\n\n"
                        "**测试总结：**\n"
                        "• 卡片创建成功 ✅\n"
                        "• 按钮交互正常 ✅\n"
                        "• 动态更新流畅 ✅\n"
                        "• Schema 2.0 特性完整 ✅"
                    ),
                },
                {"tag": "hr"},
                {
                    "tag": "markdown",
                    "content": "<font color='grey'>再次测试请发送 `/testcard2`</font>",
                    "text_size": "notation",
                },
            ]
        },
    }


# ---------------------------------------------------------------------------
# 私有卡片构建函数
# ---------------------------------------------------------------------------


def _build_thinking_card() -> Dict[str, Any]:
    """
    思考中卡片（CardKit 失败时的 IM 回退）

    仅在 CardKit 流程失败时发送，作为等待动画的替代。
    """
    return {
        "config": {"wide_screen_mode": True, "update_multi": True},
        "elements": [
            {
                "tag": "markdown",
                "content": "思考中...",
            },
        ],
    }


def _build_streaming_card(
    text: str,
    reasoning_text: Optional[str] = None,
) -> Dict[str, Any]:
    """
    流式输出卡片（IM Patch 回退时使用）

    CardKit 正常工作时不会调用此函数，CardKit 通过 cardElement.content
    直接更新元素内容，无需重建整张卡片。

    Args:
        text:           当前已生成的回答文本
        reasoning_text: 思考过程文本
    """
    elements: List[Dict[str, Any]] = []

    if not text and reasoning_text:
        # 思考阶段：显示思考内容（notation 字号，较小）
        elements.append(
            {
                "tag": "markdown",
                "content": f"💭 **Thinking...**\n\n{reasoning_text}",
                "text_size": "notation",
            }
        )
    elif text:
        # 回答阶段：显示回答内容
        elements.append(
            {
                "tag": "markdown",
                "content": optimize_markdown_style(text),
            }
        )

    return {
        "schema": "2.0",
        "config": {"wide_screen_mode": True, "update_multi": True},
        "body": {"elements": elements},
    }


def _deduplicate_reasoning(text: str, reasoning_text: Optional[str]) -> str:
    """
    从文本中移除与 reasoning_text 重复的部分。

    某些 OpenCode 模型会将推理内容同时作为 CONTENT 发送，导致重复显示。
    此函数检测并移除 text 开头与 reasoning_text 重复的内容。

    Args:
        text: 主回答文本
        reasoning_text: 思考过程文本

    Returns:
        移除重复内容后的文本
    """
    if not reasoning_text or not text:
        return text

    reasoning_normalized = reasoning_text.strip()
    text_normalized = text.strip()

    # 情况1: 文本以推理内容开头（完全包含）
    if text_normalized.startswith(reasoning_normalized):
        remaining = text_normalized[len(reasoning_normalized) :].strip()
        logger.debug(f"移除开头的推理内容，剩余 {len(remaining)} 字符")
        return remaining

    # 情况2: 文本包含推理内容（可能是中间或结尾）
    # 使用滑动窗口找最长公共子串
    if len(reasoning_normalized) > 50:  # 只对较长的推理内容做此检测
        # 取推理文本的前80%进行匹配（避免末尾的差异）
        reasoning_prefix = reasoning_normalized[: int(len(reasoning_normalized) * 0.8)]

        if reasoning_prefix in text_normalized:
            # 找到重复位置，移除重复部分
            idx = text_normalized.find(reasoning_prefix)
            if idx >= 0:
                # 计算需要移除的范围（从重复开始到推理文本结束）
                end_idx = idx + len(reasoning_normalized)
                if end_idx <= len(text_normalized):
                    remaining = text_normalized[:idx] + text_normalized[end_idx:]
                    remaining = remaining.strip()
                    logger.debug(f"移除包含的推理内容，剩余 {len(remaining)} 字符")
                    return remaining

    return text


def _build_complete_card(
    text: str,
    elapsed_ms: Optional[int] = None,
    is_error: bool = False,
    reasoning_text: Optional[str] = None,
    reasoning_elapsed_ms: Optional[int] = None,
    token_stats: Optional[Dict] = None,
    model: str = "",
) -> Dict[str, Any]:
    """
    完成状态卡片

    结构（从上到下）：
    1. 可折叠思考面板 collapsible_panel（有 reasoning 时）- 更美观的样式
    2. 主回答内容 markdown（normal_v2 字号）- 带 emoji 分类和美化
    3. 底部元信息 markdown（notation 字号，右对齐）- 单行紧凑显示
       格式: ✅ 已完成 · ⏱️ 3.2s · 📊 1,234 tokens (5.2%) · 🤖 claude-sonnet

    Args:
        text:                  完整回答文本
        elapsed_ms:            总耗时（毫秒）
        is_error:              是否出错
        reasoning_text:        思考过程文本
        reasoning_elapsed_ms:  思考耗时（毫秒）
        token_stats:           Token 统计信息字典
        model:                 模型名称
    """
    elements: List[Dict[str, Any]] = []

    # ── 0. 去重处理 ───────────────────────────────────────────────────────
    # 某些模型会将推理内容重复输出到正式回答中，需要提前移除
    text = _deduplicate_reasoning(text, reasoning_text)

    # ── 1. 可折叠思考面板（更美观的样式）────────────────────────────────
    if reasoning_text:
        duration_label = _format_reasoning_duration(reasoning_elapsed_ms)
        elements.append(
            {
                "tag": "collapsible_panel",
                "expanded": False,
                "header": {
                    "title": {"tag": "markdown", "content": f"💭 {duration_label}"},
                    "vertical_align": "center",
                    "icon": {
                        "tag": "standard_icon",
                        "token": "down-small-ccm_outlined",
                        "size": "16px 16px",
                    },
                    "icon_position": "follow_text",
                    "icon_expanded_angle": -180,
                },
                "border": {"color": "blue", "corner_radius": "6px"},
                "vertical_spacing": "6px",
                "padding": "10px 12px 10px 12px",
                "elements": [
                    {
                        "tag": "markdown",
                        "content": reasoning_text,
                        "text_size": "notation",
                    }
                ],
            }
        )

    # ── 2. 主回答内容（带 emoji 分类和美化）──────────────────────────────
    optimized_text = optimize_markdown_style(text) if text else ""
    elements.append(
        {
            "tag": "markdown",
            "content": optimized_text,
        }
    )

    # ── 3. 底部元信息（单行紧凑显示，右对齐）────────────────────────────
    footer_parts: List[str] = []

    # 状态
    if is_error:
        footer_parts.append("❌ 出错")
    else:
        footer_parts.append("✅ 已完成")

    # 耗时
    if elapsed_ms is not None:
        footer_parts.append(f"⏱️ {_format_elapsed(elapsed_ms)}")

    # Token 统计
    if token_stats:
        _append_token_stats_compact(footer_parts, token_stats)

    # 模型
    if model:
        footer_parts.append(f"🤖 {_simplify_model_name(model)}")

    # 构建单行 Footer
    if footer_parts:
        footer_text = " · ".join(footer_parts)
        footer_content = (
            f"<font color='red'>{footer_text}</font>"
            if is_error
            else f"<font color='grey'>{footer_text}</font>"
        )
        elements.append(
            {
                "tag": "markdown",
                "content": footer_content,
                "text_align": "right",
                "text_size": "notation",
            }
        )

    # ── 摘要（消息列表预览）──────────────────────────────────────────────
    summary_text = re.sub(r"[*_`#>\[\]()~]", "", text).strip()
    summary = {"content": summary_text[:120]} if summary_text else None

    return {
        "schema": "2.0",
        "config": {"wide_screen_mode": True, "update_multi": True, "summary": summary},
        "body": {"elements": elements},
    }


def _append_token_stats(parts: List[str], token_stats: Dict) -> None:
    """将 token 统计信息追加到 parts 列表。支持两种格式。"""
    # 优先使用已计算的 context_percent（如果可用且大于0）
    context_percent = token_stats.get("context_percent", 0)

    # 格式 A: OpenCode 格式 (total_tokens, context_used, context_window)
    if "total_tokens" in token_stats:
        total_tokens = token_stats.get("total_tokens", 0)
        context_used = token_stats.get("context_used", 0)
        context_window = token_stats.get("context_window", 128000)

        # 如果没有预先计算的百分比，则自己计算
        if not context_percent and context_window > 0:
            context_percent = (context_used / context_window * 100)

        # 合并为单个字符串，与 OpenClaw 一致
        parts.append(
            f"📊 {total_tokens:,} tokens ({context_percent:.1f}%) · Context: {context_window // 1000}K"
        )
        return

    # 格式 B: kimibridge/Kimi 格式 (token_usage, context_usage, max_context_tokens)
    if "token_usage" in token_stats or "context_usage" in token_stats:
        token_usage = token_stats.get("token_usage") or {}
        input_other = token_usage.get("input_other", 0)
        input_cache_read = token_usage.get("input_cache_read", 0)
        input_cache_creation = token_usage.get("input_cache_creation", 0)
        output_tokens = token_usage.get("output", 0)

        total_input = input_other + input_cache_read + input_cache_creation
        total_tokens = total_input + output_tokens

        context_usage = token_stats.get("context_usage")
        max_context_tokens = token_stats.get("max_context_tokens", 128000)

        if context_usage is not None:
            usage_percent = context_usage * 100
        elif max_context_tokens > 0:
            usage_percent = (total_tokens / max_context_tokens) * 100
        else:
            usage_percent = 0

        # 合并为单个字符串，与 OpenClaw 一致
        parts.append(
            f"📊 {total_tokens:,} tokens ({usage_percent:.1f}%) · Context: {max_context_tokens // 1000}K"
        )


def _append_token_stats_compact(parts: List[str], token_stats: Dict) -> None:
    """将紧凑格式的 token 统计信息追加到 parts 列表。

    格式: 📊 1.2K tokens (5%) - 更简洁的显示
    """
    def format_num(n: int) -> str:
        if n >= 1000:
            return f"{n / 1000:.1f}K"
        return str(n)

    # 优先使用已计算的 context_percent（如果存在且大于等于0）
    # 使用 'in' 检查而非 falsy 检查，避免 0 被误判为缺失
    if "context_percent" in token_stats and token_stats["context_percent"] is not None:
        context_percent = float(token_stats["context_percent"])
        total_tokens = token_stats.get("total_tokens", 0)
        # 使用 .1f 保留一位小数，避免小于 0.5% 显示为 0%
        parts.append(f"📊 {format_num(total_tokens)} ({context_percent:.1f}%)")
        return

    # 如果没有 context_percent 但有 total_tokens，尝试计算
    if "total_tokens" in token_stats:
        total_tokens = token_stats.get("total_tokens", 0)
        context_used = token_stats.get("context_used", 0)
        context_window = token_stats.get("context_window", 128000)

        context_percent = (
            (context_used / context_window * 100) if context_window > 0 else 0
        )
        parts.append(f"📊 {format_num(total_tokens)} ({context_percent:.1f}%)")
        return

    # 格式 B: Kimi 格式
    if "token_usage" in token_stats or "context_usage" in token_stats:
        token_usage = token_stats.get("token_usage") or {}
        total_tokens = (
            token_usage.get("input_other", 0)
            + token_usage.get("input_cache_read", 0)
            + token_usage.get("input_cache_creation", 0)
            + token_usage.get("output", 0)
        )

        context_usage = token_stats.get("context_usage")
        max_context_tokens = token_stats.get("max_context_tokens", 128000)

        if context_usage is not None:
            usage_percent = context_usage * 100
        elif max_context_tokens > 0:
            usage_percent = (total_tokens / max_context_tokens) * 100
        else:
            usage_percent = 0

        parts.append(f"📊 {format_num(total_tokens)} ({usage_percent:.1f}%)")


# ---------------------------------------------------------------------------
# Emoji 分类与内容美化
# ---------------------------------------------------------------------------

# 分类关键词到 emoji 的映射
CATEGORY_EMOJI_MAP = {
    # 信息与搜索
    "信息与搜索": "📚",
    "全网搜": "🔍",
    "扒网页": "🌐",
    "翻译": "🌐",
    "追踪AI": "🤖",
    "GitHub": "🐙",
    "游戏新闻": "🎮",
    # 飞书生态
    "飞书生态": "🎨",
    "管理文档": "📄",
    "多维表格": "📊",
    "日程": "📅",
    "任务": "✅",
    "群聊": "💬",
    # 技术开发
    "技术开发": "🛠️",
    "写代码": "💻",
    "改Bug": "🐛",
    "Review": "👀",
    "代码": "📝",
    "API": "🔌",
    "ESP32": "🔧",
    # 日常工具
    "日常工具": "🔧",
    "天气": "🌤️",
    "文件": "📁",
    "学习笔记": "📒",
    "GitHub Issue": "🐛",
    # 特别擅长
    "特别擅长": "💡",
    "擅长": "⭐",
    "信息聚合": "📰",
    "自动化": "🤖",
    "技术调研": "📖",
    # UI/UX
    "UI/UX": "🎨",
    "界面开发": "🖥️",
    "设计审查": "✨",
    "组件开发": "🧩",
    "网站": "🌐",
    "仪表盘": "📊",
    "落地页": "🎯",
    # 软件开发
    "软件开发": "💻",
    "代码编写": "⌨️",
    "代码审查": "🔍",
    "调试排错": "🐛",
    "重构优化": "⚡",
    "测试开发": "🧪",
    # 项目管理
    "项目管理": "📋",
    "Git": "🌿",
    "文件操作": "📂",
    "命令执行": "⚙️",
    "环境诊断": "🔧",
    # 信息获取
    "信息获取": "📡",
    "网页抓取": "🕷️",
    "技术研究": "🔬",
    # 特定领域
    "特定领域": "🎯",
    "ESP32": "🔌",
    "Zabbix": "📈",
    "Markdown": "📝",
}


def _add_category_emojis(text: str) -> str:
    """
    为分类标题自动添加 emoji 图标

    检测常见的分类标题（如"**信息与搜索**"、"软件开发"等），
    自动在开头添加对应的 emoji 图标。
    """
    lines = text.split("\n")
    result_lines = []

    for line in lines:
        original_line = line
        # 移除 Markdown 粗体标记进行检查
        check_line = line.replace("**", "").replace("__", "").strip()

        # 检查是否匹配分类关键词
        added_emoji = False
        for keyword, emoji in CATEGORY_EMOJI_MAP.items():
            if check_line.startswith(keyword) and emoji not in line:
                # 找到匹配，添加 emoji
                if line.startswith("**") and line.endswith("**"):
                    # 保持粗体格式: **emoji 内容**
                    inner = line[2:-2].strip()
                    line = f"**{emoji} {inner}**"
                elif line.startswith("**"):
                    # 粗体开始但没有结束
                    inner = line[2:].strip()
                    line = f"**{emoji} {inner}"
                else:
                    # 普通文本，直接添加 emoji
                    line = f"{emoji} {line}"
                added_emoji = True
                break

        result_lines.append(line)

    return "\n".join(result_lines)


def _beautify_list_items(text: str) -> str:
    """
    美化列表项显示

    - 为列表项添加适当的缩进和格式
    - 确保列表项之间有适当的间距
    """
    lines = text.split("\n")
    result_lines = []
    prev_was_list = False

    for i, line in enumerate(lines):
        stripped = line.strip()

        # 检测是否是列表项
        is_bullet = stripped.startswith(("- ", "* ", "• "))
        is_numbered = re.match(r"^\d+\.", stripped)

        if is_bullet or is_numbered:
            prev_was_list = True
        else:
            prev_was_list = False

        result_lines.append(line)

    return "\n".join(result_lines)


# ---------------------------------------------------------------------------
# Markdown 样式优化
# ---------------------------------------------------------------------------


def optimize_markdown_style(text: str, card_version: int = 2) -> str:
    """
    优化 Markdown 样式以适配飞书卡片显示

    - 标题降级：H1 → H4，H2~H6 → H5（有 H1~H3 时才降级）
    - 连续标题间增加 <br> 段落间距
    - 表格前后增加 <br> 段落间距（4a-4e 规则）
    - 代码块前后追加 <br>
    - 压缩多余空行（3+ 个换行 → 2 个）
    - 移除无效飞书图片 key（防止 CardKit 200570 错误）
    - 自动添加分类 emoji 图标
    - 美化列表项显示

    Args:
        text:         原始 Markdown 文本
        card_version: 卡片版本（2 = Schema 2.0，1 = 旧格式）

    Returns:
        优化后的 Markdown 文本
    """
    try:
        result = _optimize_markdown_style(text, card_version)
        result = _strip_invalid_image_keys(result)
        result = _add_category_emojis(result)
        result = _beautify_list_items(result)
        return result
    except Exception:
        return text


def _optimize_markdown_style(text: str, card_version: int = 2) -> str:
    """
    OpenClaw-Lark markdown-style.js 的 Python 实现。

    优化项：
    - 标题降级：H1 → H4，H2~H6 → H5
    - 表格前后增加段落间距
    - 代码块内容不受影响
    """
    # ── 1. 提取代码块，用占位符保护，处理后再还原 ─────────────────────
    MARK = "___CB_"
    code_blocks = []

    def save_code_block(match):
        code_blocks.append(match.group(0))
        return f"{MARK}{len(code_blocks) - 1}___"

    r = re.sub(r"```[\s\S]*?```", save_code_block, text)

    # ── 2. 标题降级 ────────────────────────────────────────────────────
    # 只有当原文档包含 h1~h3 标题时才执行降级
    # 先处理 H2~H6 → H5，再处理 H1 → H4
    # 顺序不能颠倒：若先 H1→H4，H4（####）会被后面的 #{2,6} 再次匹配成 H5
    has_h1_to_h3 = bool(re.search(r"^#{1,3} ", text, re.MULTILINE))
    if has_h1_to_h3:
        r = re.sub(r"^#{2,6} (.+)$", r"##### \1", r, flags=re.MULTILINE)  # H2~H6 → H5
        r = re.sub(r"^# (.+)$", r"#### \1", r, flags=re.MULTILINE)  # H1 → H4

    if card_version >= 2:
        # ── 3. 连续标题间增加段落间距 ───────────────────────────────────────
        r = re.sub(
            r"^(#{4,5} .+)\n{1,2}(#{4,5} )", r"\1\n<br>\n\2", r, flags=re.MULTILINE
        )

        # ── 4. 表格前后增加段落间距 ─────────────────────────────────────────
        # 4a. 非表格行直接跟表格行时，先补一个空行
        r = re.sub(r"^([^|\n].*)\n(\|.+\|)", r"\1\n\n\2", r, flags=re.MULTILINE)
        # 4b. 表格前：在空行之前插入 <br>（即 \n\n| → \n<br>\n\n| ）
        r = re.sub(r"\n\n((?:\|.+\|[^\S\n]*\n?)+)", r"\n\n<br>\n\n\1", r)
        # 4c. 表格后：在表格块末尾追加 <br>
        r = re.sub(r"((?:^\|.+\|[^\S\n]*\n?)+)", r"\1\n<br>\n", r, flags=re.MULTILINE)
        # 4d. 表格前是普通文本（非标题、非加粗行）时，只需 <br>，去掉多余空行
        #     "text\n\n<br>\n\n|" → "text\n<br>\n|"
        r = re.sub(
            r"^((?!#{4,5} )(?!\*\*).+)\n\n(<br>)\n\n(\|)",
            r"\1\n\2\n\3",
            r,
            flags=re.MULTILINE,
        )
        # 4d2. 表格前是加粗行时，<br> 紧贴加粗行，空行保留在后面
        #     "**bold**\n\n<br>\n\n|" → "**bold**\n<br>\n\n|"
        r = re.sub(
            r"^(\*\*.+)\n\n(<br>)\n\n(\|)", r"\1\n\2\n\n\3", r, flags=re.MULTILINE
        )
        # 4e. 表格后是普通文本（非标题、非加粗行）时，只需 <br>，去掉多余空行
        #     "| row |\n\n<br>\ntext" → "| row |\n<br>\ntext"
        r = re.sub(r"(\|[^\n]*\n)\n(<br>\n)((?!#{4,5} )(?!\*\*))", r"\1\2\3", r)

        # ── 5. 还原代码块，并在前后追加 <br> ──────────────────────────────
        for i, block in enumerate(code_blocks):
            r = r.replace(f"{MARK}{i}___", f"\n<br>\n{block}\n<br>\n")
    else:
        # ── 5. 还原代码块（无 <br>）───────────────────────────────────────
        for i, block in enumerate(code_blocks):
            r = r.replace(f"{MARK}{i}___", block)

    # ── 6. 压缩多余空行（3 个以上连续换行 → 2 个）────────────────────
    r = re.sub(r"\n{3,}", "\n\n", r)

    return r


# 匹配 Markdown 图片语法：![alt](value)
_IMAGE_RE = re.compile(r"!\[([^\]]*)\]\(([^)\s]+)\)")


def _strip_invalid_image_keys(text: str) -> str:
    """
    移除无效的飞书图片 key。

    飞书 CardKit 只接受 img_xxx 格式的图片 key 或远程 HTTP(S) URL，
    其他格式会导致 CardKit 错误 200570。
    """
    if "![" not in text:
        return text

    def replace_image(match: re.Match) -> str:
        value = match.group(2)
        # 保留有效格式
        if value.startswith("img_"):
            return match.group(0)
        if value.startswith("http://") or value.startswith("https://"):
            return match.group(0)
        # 无效格式：只保留 value（去掉图片语法）
        return value

    return _IMAGE_RE.sub(replace_image, text)


# ---------------------------------------------------------------------------
# 格式化辅助函数
# ---------------------------------------------------------------------------


def _format_reasoning_duration(ms: Optional[int]) -> str:
    """格式化思考耗时：'Thought for 3.2s' 或 'Thought'"""
    if not ms:
        return "Thought"
    return f"Thought for {_format_elapsed(ms)}"


def _format_elapsed(ms: int) -> str:
    """格式化毫秒为可读时间：'3.2s' 或 '1m 15s'"""
    seconds = ms / 1000
    if seconds < 60:
        return f"{seconds:.1f}s"
    return f"{int(seconds // 60)}m {int(seconds % 60)}s"


def _simplify_model_name(model: str) -> str:
    """简化模型名称显示"""
    if not model:
        return "Unknown"

    m = model.lower()

    if "claude" in m:
        if "opus" in m:
            return "Claude-Opus"
        if "sonnet" in m:
            return "Claude-Sonnet"
        if "haiku" in m:
            return "Claude-Haiku"
        return "Claude"

    if "gpt-4" in m or "gpt4" in m:
        return "GPT-4"

    if "gpt-3.5" in m or "gpt3.5" in m:
        return "GPT-3.5"

    if "kimi" in m:
        return "Kimi"

    # OpenCode / mimo 等，取路径最后一段
    if "opencode" in m or "mimo" in m:
        parts = model.split("/")
        name = parts[-1] if len(parts) > 1 else model
        return name[:24]

    if len(model) > 24:
        return model[:21] + "..."

    return model


def build_session_list_card(
    sessions: List[Dict[str, Any]],
    current_session_id: Optional[str] = None,
    cli_type: str = "opencode",
    deleting_session_id: Optional[str] = None,
    working_dir: str = "",
) -> Dict[str, Any]:
    """构建会话列表卡片（Schema 2.0）

    Args:
        sessions: 会话列表，每个会话含 session_id, title, is_current, created_at, updated_at
        current_session_id: 当前活跃会话ID（绿色标记）
        cli_type: CLI类型，用于按钮 value
        deleting_session_id: 处于"确认删除"状态的会话ID（显示确认/取消按钮）

    Returns:
        飞书卡片 JSON（Schema 2.0）
    """
    elements: List[Dict[str, Any]] = []

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
                    from datetime import datetime
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
            from datetime import datetime

            dt = datetime.fromtimestamp(ts)
            return dt.strftime("%Y-%m-%d %H:%M:%S")
        except:
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
