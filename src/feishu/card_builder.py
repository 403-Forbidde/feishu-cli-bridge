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
# 私有卡片构建函数
# ---------------------------------------------------------------------------


def _build_thinking_card() -> Dict[str, Any]:
    """
    思考中卡片（CardKit 失败时的 IM 回退）

    仅在 CardKit 流程失败时发送，作为等待动画的替代。
    使用 Schema 2.0 格式，保证后续可以用 IM Patch 正常更新。
    """
    return {
        "schema": "2.0",
        "config": {"wide_screen_mode": True, "update_multi": True},
        "body": {
            "elements": [
                {
                    "tag": "markdown",
                    "content": "思考中...",
                    "text_align": "left",
                    "text_size": "normal_v2",
                },
            ]
        },
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
    1. 可折叠思考面板 collapsible_panel（有 reasoning 时）
    2. 主回答内容 markdown（normal_v2 字号）
    3. 底部元信息 markdown（notation 字号，右对齐）
       格式: ✅ 已完成 · 耗时 3.2s · 📊 1,234 tokens (5.2%) · 🤖 claude-sonnet

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

    # ── 1. 可折叠思考面板 ───────────────────────────────────────────────
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
                "border": {"color": "grey", "corner_radius": "5px"},
                "vertical_spacing": "8px",
                "padding": "8px 8px 8px 8px",
                "elements": [
                    {
                        "tag": "markdown",
                        "content": reasoning_text,
                        "text_align": "left",
                        "text_size": "notation",
                    }
                ],
            }
        )

    # ── 2. 主回答内容 ───────────────────────────────────────────────────
    optimized_text = optimize_markdown_style(text) if text else ""
    elements.append(
        {
            "tag": "markdown",
            "content": optimized_text,
            "text_align": "left",
            "text_size": "normal_v2",
        }
    )

    # ── 3. 底部元信息（两行显示，右对齐，notation 字号）──────────────────────────
    # 第一行：状态 + 耗时
    first_line_parts: List[str] = []
    if is_error:
        first_line_parts.append("❌ 出错")
    else:
        first_line_parts.append("✅ 已完成")
    if elapsed_ms is not None:
        first_line_parts.append(f"⏱️ 耗时 {_format_elapsed(elapsed_ms)}")

    # 第二行：Token 统计 + 模型
    second_line_parts: List[str] = []
    if token_stats:
        _append_token_stats(second_line_parts, token_stats)
    if model:
        second_line_parts.append(f"🤖 {_simplify_model_name(model)}")

    # 添加第一行
    if first_line_parts:
        footer_text = " · ".join(first_line_parts)
        footer_content = (
            f"<font color='red'>{footer_text}</font>" if is_error else footer_text
        )
        elements.append(
            {
                "tag": "markdown",
                "content": footer_content,
                "text_align": "right",
                "text_size": "notation",
            }
        )

    # 添加第二行
    if second_line_parts:
        second_footer_text = " · ".join(second_line_parts)
        second_footer_content = (
            f"<font color='red'>{second_footer_text}</font>"
            if is_error
            else second_footer_text
        )
        elements.append(
            {
                "tag": "markdown",
                "content": second_footer_content,
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
    # 格式 A: OpenCode 格式 (total_tokens, context_used, context_window)
    if "total_tokens" in token_stats:
        total_tokens = token_stats.get("total_tokens", 0)
        context_used = token_stats.get("context_used", 0)
        context_window = token_stats.get("context_window", 128000)

        usage_percent = (
            (context_used / context_window * 100) if context_window > 0 else 0
        )
        parts.append(f"📊 {total_tokens:,} tokens ({usage_percent:.1f}%)")
        parts.append(f"Context: {context_window // 1000}K")
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

        parts.append(f"📊 {total_tokens:,} tokens ({usage_percent:.1f}%)")
        parts.append(f"Context: {max_context_tokens // 1000}K")


# ---------------------------------------------------------------------------
# Markdown 样式优化
# ---------------------------------------------------------------------------


def optimize_markdown_style(text: str, card_version: int = 2) -> str:
    """
    优化 Markdown 样式以适配飞书卡片显示

    优化项（对齐 OpenClaw-Lark markdown-style.js）：
    - 标题降级：H1 → H4，H2~H6 → H5（有 H1~H3 时才降级）
    - 连续标题间增加 <br> 段落间距
    - 表格前后增加 <br> 段落间距（Schema 2.0）
    - 代码块前后添加 <br>（Schema 2.0）
    - 压缩多余空行（3+ 个换行 → 2 个）
    - 移除无效飞书图片 key（防止 CardKit 200570 错误）

    Args:
        text:         原始 Markdown 文本
        card_version: 卡片版本（2 = Schema 2.0，1 = 旧格式）

    Returns:
        优化后的 Markdown 文本
    """
    try:
        result = _optimize_markdown_impl(text, card_version)
        result = _strip_invalid_image_keys(result)
        return result
    except Exception:
        return text


def _optimize_markdown_impl(text: str, card_version: int = 2) -> str:
    """optimize_markdown_style 的内部实现。"""

    # ── 1. 提取代码块，占位符保护，处理后还原 ──────────────────────────
    MARK = "___CB_"
    code_blocks: List[str] = []

    def save_code_block(match: re.Match) -> str:
        idx = len(code_blocks)
        code_blocks.append(match.group(0))
        return f"{MARK}{idx}___"

    r = re.sub(r"```[\s\S]*?```", save_code_block, text)

    # ── 2. 标题降级 ─────────────────────────────────────────────────────
    # 仅当原文包含 H1~H3 时才降级，避免误处理已经是 H4/H5 的内容
    # 先处理 H2~H6 → H5，再处理 H1 → H4（顺序不能颠倒）
    has_h1_to_h3 = bool(re.search(r"^#{1,3} ", text, re.MULTILINE))
    if has_h1_to_h3:
        r = re.sub(r"^#{2,6} (.+)$", r"##### \1", r, flags=re.MULTILINE)  # H2~H6 → H5
        r = re.sub(r"^# (.+)$", r"#### \1", r, flags=re.MULTILINE)  # H1 → H4

    if card_version >= 2:
        # ── 3. 连续标题间增加段落间距 ─────────────────────────────────────
        r = re.sub(
            r"^(#{4,5} .+)\n{1,2}(#{4,5} )",
            r"\1\n<br>\n\2",
            r,
            flags=re.MULTILINE,
        )

        # ── 4. 表格前后增加段落间距 ───────────────────────────────────────
        # 4a. 非表格行直接跟表格行时，先补一个空行
        r = re.sub(r"^([^|\n].*)\n(\|.+\|)", r"\1\n\n\2", r, flags=re.MULTILINE)
        # 4b. 表格前：在空行之前插入 <br>
        r = re.sub(r"\n\n((?:\|.+\|[^\S\n]*\n?)+)", r"\n\n<br>\n\n\1", r)
        # 4c. 表格后：在表格块末尾追加 <br>
        r = re.sub(r"((?:^\|.+\|[^\S\n]*\n?)+)", r"\1\n<br>\n", r, flags=re.MULTILINE)
        # 4d. 表格前是普通文本时，只保留一个 <br>，去掉多余空行
        r = re.sub(
            r"^((?!#{4,5} )(?!\*\*).+)\n\n(<br>)\n\n(\|)",
            r"\1\n\2\n\3",
            r,
            flags=re.MULTILINE,
        )
        # 4d2. 表格前是加粗行时，<br> 紧贴加粗行，空行保留在后面
        r = re.sub(
            r"^(\*\*.+)\n\n(<br>)\n\n(\|)",
            r"\1\n\2\n\n\3",
            r,
            flags=re.MULTILINE,
        )
        # 4e. 表格后是普通文本时，只保留一个 <br>
        r = re.sub(
            r"(\|[^\n]*\n)\n(<br>\n)((?!#{4,5} )(?!\*\*))",
            r"\1\2\3",
            r,
        )

        # ── 5. 还原代码块，前后追加 <br> ─────────────────────────────────
        for i, block in enumerate(code_blocks):
            r = r.replace(f"{MARK}{i}___", f"\n<br>\n{block}\n<br>\n")

    else:
        # Schema 1.0：还原代码块，不加 <br>
        for i, block in enumerate(code_blocks):
            r = r.replace(f"{MARK}{i}___", block)

    # ── 6. 压缩多余空行 ───────────────────────────────────────────────
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
