"""交互式卡片构建模块

包含交互式工具卡片：
- 模式选择卡片
- 模型选择卡片
- 帮助卡片
- 重置成功卡片
- 测试卡片 v2 系列
"""

import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


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
        "body": {"elements": elements},
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
            "cmd": "/stop",
            "desc": "停止生成",
            "detail": "中断当前正在进行的 AI 回复生成",
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
