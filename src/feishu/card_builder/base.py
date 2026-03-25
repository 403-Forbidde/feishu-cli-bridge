"""基础卡片构建模块

提供核心卡片构建功能，包括 thinking、streaming、complete 三种状态的卡片。
"""

import logging
from typing import Dict, Any, List, Optional

from .utils import (
    optimize_markdown_style,
    _format_reasoning_duration,
    _format_elapsed,
    _simplify_model_name,
)

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

    # 如果主文本以 reasoning_text 开头，则移除重复部分
    if text_normalized.startswith(reasoning_normalized):
        # 获取 reasoning_text 之后的内容
        remaining = text_normalized[len(reasoning_normalized):].strip()
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
    完成状态卡片（带元信息 footer）

    Args:
        text:               最终回答文本（Markdown 格式）
        elapsed_ms:         总耗时（毫秒）
        is_error:           是否为错误消息
        reasoning_text:     思考过程文本
        reasoning_elapsed_ms: 思考耗时（毫秒）
        token_stats:        Token 统计信息字典
        model:              使用的模型名称
    """
    elements: List[Dict[str, Any]] = []

    # ── 1. 思考面板（如果有）───────────────────────────────────────────────
    if reasoning_text:
        # 从主文本中移除可能重复的思考内容
        cleaned_text = _deduplicate_reasoning(text, reasoning_text)

        # 如果清理后文本为空，说明主文本就是思考内容，不显示折叠面板
        if cleaned_text.strip():
            # 思考过程折叠面板（使用折叠容器）
            thinking_content = reasoning_text.strip()

            elements.append(
                {
                    "tag": "collapsible_panel",
                    "expanded": False,  # 默认折叠
                    "header": {
                        "title": {
                            "tag": "markdown",
                            "content": f"💭 {_format_reasoning_duration(reasoning_elapsed_ms)}",
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
                            "content": thinking_content,
                            "text_size": "notation",
                        }
                    ],
                }
            )
            # 思考面板和回答之间增加一点间距
            elements.append({"tag": "div"})

            # 使用清理后的文本
            text = cleaned_text

    # ── 2. 主内容区域 ────────────────────────────────────────────────────
    if text:
        elements.append(
            {
                "tag": "markdown",
                "content": optimize_markdown_style(text),
            }
        )

    # ── 3. 分隔线 ──────────────────────────────────────────────────────────
    elements.append({"tag": "hr"})

    # ── 4. Footer 元信息 ───────────────────────────────────────────────────
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

    # 构建 footer（始终显示，即使内容为空也保留结构）
    footer_text = " · ".join(footer_parts) if footer_parts else ""

    if footer_text:
        elements.append(
            {
                "tag": "markdown",
                "content": f"<font color='grey'>{footer_text}</font>",
                "text_align": "right",
                "text_size": "notation",
            }
        )

    return {
        "schema": "2.0",
        "config": {"wide_screen_mode": True, "update_multi": True},
        "body": {"elements": elements},
    }


def _append_token_stats(parts: List[str], token_stats: Dict) -> None:
    """
    将 Token 统计信息追加到 parts 列表（详细格式）

    Args:
        parts: 待追加的字符串列表
        token_stats: Token 统计信息字典，包含 input_tokens, output_tokens 等
    """
    if not token_stats:
        return

    # 输入 tokens
    input_tokens = token_stats.get("input_tokens") or token_stats.get("prompt_tokens", 0)
    if input_tokens:
        parts.append(f"📥 {input_tokens:,}")

    # 输出 tokens
    output_tokens = token_stats.get("output_tokens") or token_stats.get("completion_tokens", 0)
    if output_tokens:
        parts.append(f"📤 {output_tokens:,}")

    # 总 tokens
    total_tokens = token_stats.get("total_tokens", 0)
    if total_tokens:
        parts.append(f"📊 {total_tokens:,}")

    # 缓存命中信息
    cache_hits = token_stats.get("cache_read_tokens") or token_stats.get("cache_hits")
    if cache_hits:
        parts.append(f"💾 {cache_hits:,}")


def _append_token_stats_compact(parts: List[str], token_stats: Dict) -> None:
    """
    将 Token 统计信息追加到 parts 列表（紧凑格式）

    显示格式: 📊 63.7K (6.1%)
    - 📊 图标 + 总 token 数（带单位 K/M）
    - 括号内显示上下文占用百分比

    Args:
        parts: 待追加的字符串列表
        token_stats: Token 统计信息字典，包含 total_tokens, context_percent 等
    """
    if not token_stats:
        return

    # 获取总 token 数和上下文百分比
    total_tokens = token_stats.get("total_tokens", 0)
    context_percent = token_stats.get("context_percent", 0)

    # 构建 token 统计字符串，格式: 📊 63.7K (6.1%)
    if total_tokens:
        # 格式化总 token 数（使用 K/M 单位）
        if total_tokens >= 1000000:
            token_str = f"{total_tokens / 1000000:.1f}M"
        elif total_tokens >= 1000:
            token_str = f"{total_tokens / 1000:.1f}K"
        else:
            token_str = f"{total_tokens}"

        # 构建完整字符串：📊 63.7K (6.1%)
        if context_percent:
            parts.append(f"📊 {token_str} ({context_percent:.1f}%)")
        else:
            parts.append(f"📊 {token_str}")
