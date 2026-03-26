"""核心流式卡片构建模块

流式输出相关的核心卡片构建函数，包括 thinking、streaming、complete 三种状态。
"""

import logging
import re
from typing import Dict, Any, List, Optional

from .constants import STREAMING_ELEMENT_ID, REASONING_ELEMENT_ID
from .utils import optimize_markdown_style, _format_reasoning_duration, _simplify_model_name, _format_elapsed

logger = logging.getLogger(__name__)


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
