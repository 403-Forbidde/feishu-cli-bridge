"""飞书消息格式化模块"""

import re
from typing import Optional
from ..adapters.base import TokenStats


def format_with_metadata(content: str, stats: TokenStats) -> str:
    """
    格式化消息内容，添加右下角元数据（参考 KimiBridge 风格）

    格式：
    内容...
    ────────────────────────────────
    📊 model/name | 14.1K/128.0K (11.0%) | 💰 16.3K tokens
    """
    # 清理和优化内容
    content = content.strip()
    if not content:
        content = "（无内容）"

    # 优化 Markdown 样式
    content = optimize_markdown_style(content)

    # 格式化数字（K 格式）
    def format_num(n: int) -> str:
        if n >= 1000:
            return f"{n / 1000:.1f}K"
        return str(n)

    # 简化模型名称
    model_short = _simplify_model_name(stats.model)

    # 构建元数据行（参考 KimiBridge 风格）
    context_str = f"{format_num(stats.context_used)}/{format_num(stats.context_window)}"
    metadata = f"📊 {model_short} | {context_str} ({stats.context_percent:.1f}%) | 💰 {format_num(stats.total_tokens)} tokens"

    # 组合最终消息
    lines = content.split("\n")

    # 如果内容太长，截断
    max_lines = 100
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        lines.append("\n... (内容已截断)")

    # 添加分隔线和元数据（更简洁的分隔线）
    lines.append("")
    lines.append("─" * 32)  # 固定长度的分隔线
    lines.append(metadata)

    return "\n".join(lines)


def optimize_markdown_style(text: str) -> str:
    """
    优化 Markdown 样式以适配飞书显示（参考 KimiBridge）

    优化项：
    - 标题降级：H1→H3, H2→H4，避免过大
    - 代码块保护处理
    - 列表格式化
    """
    try:
        # 保存代码块
        code_blocks = []
        MARK = "___CB_"

        def save_code_block(match):
            code_blocks.append(match.group(0))
            return f"{MARK}{len(code_blocks) - 1}___"

        # 保护代码块
        pattern = r"```[\s\S]*?```"
        result = re.sub(pattern, save_code_block, text)

        # 标题降级（避免在飞书中显示过大）
        # H1→H3, H2→H4
        result = re.sub(r"^# (.+)$", r"### \1", result, flags=re.MULTILINE)
        result = re.sub(r"^## (.+)$", r"#### \1", result, flags=re.MULTILINE)

        # 有序列表项之间添加空行
        result = re.sub(
            r"^(\d+\.\s+.+?)\n(\d+\.\s+)", r"\1\n\n\2", result, flags=re.MULTILINE
        )

        # 无序列表项之间添加空行
        result = re.sub(
            r"^([-\*]\s+.+?)\n([-\*]\s+)", r"\1\n\n\2", result, flags=re.MULTILINE
        )

        # 还原代码块
        for i, block in enumerate(code_blocks):
            result = result.replace(f"{MARK}{i}___", block)

        # 压缩多余空行
        result = re.sub(r"\n{4,}", "\n\n\n", result)

        return result
    except Exception:
        return text


def _simplify_model_name(model: str) -> str:
    """简化模型名称显示"""
    if not model:
        return "Unknown"

    model_lower = model.lower()

    # Claude 模型
    if "claude" in model_lower:
        if "opus" in model_lower:
            return "Claude-Opus"
        elif "sonnet" in model_lower:
            return "Claude-Sonnet"
        elif "haiku" in model_lower:
            return "Claude-Haiku"
        return "Claude"

    # GPT/OpenAI 模型
    if "gpt-4" in model_lower or "gpt4" in model_lower:
        if "32k" in model_lower:
            return "GPT-4-32K"
        elif "turbo" in model_lower:
            return "GPT-4-Turbo"
        return "GPT-4"

    if "gpt-3.5" in model_lower or "gpt3.5" in model_lower:
        return "GPT-3.5"

    # Codex 模型
    if "codex" in model_lower:
        return "Codex"

    # Kimi 模型
    if "kimi" in model_lower:
        return "Kimi"

    # OpenCode 模型
    if "opencode" in model_lower or "mimo" in model_lower:
        # 提取模型名部分
        parts = model.split("/")
        if len(parts) > 1:
            return parts[-1][:20]  # 限制长度
        return model[:20]

    # 通用截断
    if len(model) > 20:
        return model[:17] + "..."

    return model


def parse_mention(content: str, bot_user_id: str) -> tuple[bool, str]:
    """
    解析 @ 提及

    Returns:
        (is_mentioned, clean_content)
    """
    # 飞书 @ 用户格式: @_user_xxx
    mention_pattern = r"@_user_\w+"

    # 查找所有 @
    mentions = re.findall(mention_pattern, content)
    is_mentioned = any(bot_user_id in m for m in mentions)

    # 移除所有 @ 标记
    clean_content = re.sub(mention_pattern, "", content).strip()

    return is_mentioned, clean_content


def escape_markdown(text: str) -> str:
    """转义飞书 Markdown 特殊字符"""
    chars_to_escape = ["*", "`", "[", "]"]
    for char in chars_to_escape:
        text = text.replace(char, f"\\{char}")
    return text


def truncate_for_display(text: str, max_length: int = 2000) -> str:
    """截断文本用于显示"""
    if len(text) <= max_length:
        return text

    # 尝试在句子边界截断
    truncated = text[:max_length]
    last_period = truncated.rfind("。")
    last_newline = truncated.rfind("\n")
    last_space = truncated.rfind(" ")

    cut_point = max(last_period, last_newline, last_space)
    if cut_point > max_length * 0.8:
        return truncated[:cut_point] + "\n\n... (内容已截断)"

    return truncated + "\n\n... (内容已截断)"


def format_elapsed(seconds: float) -> str:
    """
    格式化耗时为可读格式

    Args:
        seconds: 秒数

    Returns:
        格式化后的字符串，如 "3.2s" 或 "1m 15s"
    """
    if seconds < 60:
        return f"{seconds:.1f}s"
    else:
        return f"{int(seconds // 60)}m {int(seconds % 60)}s"
