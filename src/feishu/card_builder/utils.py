"""Card Builder 工具函数模块

Markdown 优化和格式化工具函数集合。
"""

import logging
import re
from typing import Optional

logger = logging.getLogger(__name__)

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
