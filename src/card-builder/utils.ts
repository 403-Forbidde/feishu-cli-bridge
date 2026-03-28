/**
 * Card builder utilities
 * 卡片构建工具函数
 *
 * Markdown 优化和格式化工具函数集合
 */

// ---------------------------------------------------------------------------
// Emoji 分类与内容美化
// ---------------------------------------------------------------------------

/** 分类关键词到 emoji 的映射 */
const CATEGORY_EMOJI_MAP: Record<string, string> = {
  // 信息与搜索
  '信息与搜索': '📚',
  '全网搜': '🔍',
  '扒网页': '🌐',
  '翻译': '🌐',
  '追踪AI': '🤖',
  'GitHub': '🐙',
  '游戏新闻': '🎮',
  // 飞书生态
  '飞书生态': '🎨',
  '管理文档': '📄',
  '多维表格': '📊',
  '日程': '📅',
  '任务': '✅',
  '群聊': '💬',
  // 技术开发
  '技术开发': '🛠️',
  '写代码': '💻',
  '改Bug': '🐛',
  'Review': '👀',
  '代码': '📝',
  'API': '🔌',
  'ESP32': '🔧',
  // 日常工具
  '日常工具': '🔧',
  '天气': '🌤️',
  '文件': '📁',
  '学习笔记': '📒',
  'GitHub Issue': '🐛',
  // 特别擅长
  '特别擅长': '💡',
  '擅长': '⭐',
  '信息聚合': '📰',
  '自动化': '🤖',
  '技术调研': '📖',
  // UI/UX
  'UI/UX': '🎨',
  '界面开发': '🖥️',
  '设计审查': '✨',
  '组件开发': '🧩',
  '网站': '🌐',
  '仪表盘': '📊',
  '落地页': '🎯',
  // 软件开发
  '软件开发': '💻',
  '代码编写': '⌨️',
  '代码审查': '🔍',
  '调试排错': '🐛',
  '重构优化': '⚡',
  '测试开发': '🧪',
  // 项目管理
  '项目管理': '📋',
  'Git': '🌿',
  '文件操作': '📂',
  '命令执行': '⚙️',
  '环境诊断': '🔧',
  // 信息获取
  '信息获取': '📡',
  '网页抓取': '🕷️',
  '技术研究': '🔬',
  // 特定领域
  '特定领域': '🎯',
  'Zabbix': '📈',
  'Markdown': '📝',
};

/**
 * 为分类标题自动添加 emoji 图标
 */
function addCategoryEmojis(text: string): string {
  const lines = text.split('\n');
  const resultLines: string[] = [];

  for (const originalLine of lines) {
    let line = originalLine;
    // 移除 Markdown 粗体标记进行检查
    const checkLine = line.replace(/\*\*/g, '').replace(/__/g, '').trim();

    // 检查是否匹配分类关键词
    let addedEmoji = false;
    for (const [keyword, emoji] of Object.entries(CATEGORY_EMOJI_MAP)) {
      if (checkLine.startsWith(keyword) && !line.includes(emoji)) {
        // 找到匹配，添加 emoji
        if (line.startsWith('**') && line.endsWith('**')) {
          // 保持粗体格式: **emoji 内容**
          const inner = line.slice(2, -2).trim();
          line = `**${emoji} ${inner}**`;
        } else if (line.startsWith('**')) {
          // 粗体开始但没有结束
          const inner = line.slice(2).trim();
          line = `**${emoji} ${inner}`;
        } else {
          // 普通文本，直接添加 emoji
          line = `${emoji} ${line}`;
        }
        addedEmoji = true;
        break;
      }
    }

    resultLines.push(line);
  }

  return resultLines.join('\n');
}

// ---------------------------------------------------------------------------
// Markdown 样式优化
// ---------------------------------------------------------------------------

/**
 * 内部 Markdown 样式优化实现
 */
function optimizeMarkdownStyleInternal(text: string, cardVersion: number = 2): string {
  // ── 1. 提取代码块，用占位符保护，处理后再还原 ─────────────────────
  const MARK = '___CB_';
  const codeBlocks: string[] = [];

  const saveCodeBlock = (match: string): string => {
    codeBlocks.push(match);
    return `${MARK}${codeBlocks.length - 1}___`;
  };

  let r = text.replace(/```[\s\S]*?```/g, saveCodeBlock);

  // ── 2. 标题降级 ────────────────────────────────────────────────────
  // 只有当原文档包含 h1~h3 标题时才执行降级
  // 先处理 H2~H6 → H5，再处理 H1 → H4
  // 顺序不能颠倒：若先 H1→H4，H4（####）会被后面的 #{2,6} 再次匹配成 H5
  const hasH1ToH3 = /^#{1,3} /m.test(text);
  if (hasH1ToH3) {
    r = r.replace(/^#{2,6} (.+)$/gm, '##### $1'); // H2~H6 → H5
    r = r.replace(/^# (.+)$/gm, '#### $1'); // H1 → H4
  }

  if (cardVersion >= 2) {
    // ── 3. 连续标题间增加段落间距 ───────────────────────────────────────
    r = r.replace(/^(#{4,5} .+)\n{1,2}(#{4,5} )/gm, '$1\n<br>\n$2');

    // ── 4. 表格前后增加段落间距 ─────────────────────────────────────────
    // 4a. 非表格行直接跟表格行时，先补一个空行
    r = r.replace(/^([^|\n].*)\n(\|.+\|)/gm, '$1\n\n$2');
    // 4b. 表格前：在空行之前插入 <br>（即 \n\n| → \n<br>\n\n| ）
    r = r.replace(/\n\n((?:\|.+\|[^\S\n]*\n?)+)/g, '\n\n<br>\n\n$1');
    // 4c. 表格后：在表格块末尾追加 <br>
    r = r.replace(/((?:^\|.+\|[^\S\n]*\n?)+)/gm, '$1\n<br>\n');
    // 4d. 表格前是普通文本（非标题、非加粗行）时，只需 <br>，去掉多余空行
    //     "text\n\n<br>\n\n|" → "text\n<br>\n|"
    r = r.replace(/^((?!#{4,5} )(?!\*\*).+)\n\n(<br>)\n\n(\|)/gm, '$1\n$2\n$3');
    // 4d2. 表格前是加粗行时，<br> 紧贴加粗行，空行保留在后面
    //     "**bold**\n\n<br>\n\n|" → "**bold**\n<br>\n\n|"
    r = r.replace(/^(\*\*.+)\n\n(<br>)\n\n(\|)/gm, '$1\n$2\n\n$3');
    // 4e. 表格后是普通文本（非标题、非加粗行）时，只需 <br>，去掉多余空行
    //     "| row |\n\n<br>\ntext" → "| row |\n<br>\ntext"
    r = r.replace(/(\|[^\n]*\n)\n(<br>\n)((?!#{4,5} )(?!\*\*))/g, '$1$2$3');

    // ── 5. 还原代码块，并在前后追加 <br> ──────────────────────────────
    for (let i = 0; i < codeBlocks.length; i++) {
      r = r.replace(`${MARK}${i}___`, `\n<br>\n${codeBlocks[i]}\n<br>\n`);
    }
  } else {
    // ── 5. 还原代码块（无 <br>）───────────────────────────────────────
    for (let i = 0; i < codeBlocks.length; i++) {
      r = r.replace(`${MARK}${i}___`, codeBlocks[i]);
    }
  }

  // ── 6. 压缩多余空行（3 个以上连续换行 → 2 个）────────────────────
  r = r.replace(/\n{3,}/g, '\n\n');

  return r;
}

// 匹配 Markdown 图片语法：![alt](value)
const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g;

/**
 * 移除无效的飞书图片 key
 *
 * 飞书 CardKit 只接受 img_xxx 格式的图片 key 或远程 HTTP(S) URL，
 * 其他格式会导致 CardKit 错误 200570。
 */
function stripInvalidImageKeys(text: string): string {
  if (!text.includes('![')) {
    return text;
  }

  return text.replace(IMAGE_RE, (match, alt, value) => {
    // 保留有效格式
    if (value.startsWith('img_')) {
      return match;
    }
    if (value.startsWith('http://') || value.startsWith('https://')) {
      return match;
    }
    // 无效格式：只保留 value（去掉图片语法）
    return value;
  });
}

/**
 * 优化 Markdown 样式以适配飞书卡片显示
 *
 * - 标题降级：H1 → H4，H2~H6 → H5（有 H1~H3 时才降级）
 * - 连续标题间增加 <br> 段落间距
 * - 表格前后增加 <br> 段落间距（4a-4e 规则）
 * - 代码块前后追加 <br>
 * - 压缩多余空行（3+ 个换行 → 2 个）
 * - 移除无效飞书图片 key（防止 CardKit 200570 错误）
 * - 自动添加分类 emoji 图标
 *
 * @param text - 原始 Markdown 文本
 * @param cardVersion - 卡片版本（2 = Schema 2.0，1 = 旧格式）
 * @returns 优化后的 Markdown 文本
 */
export function optimizeMarkdownStyle(text: string, cardVersion: number = 2): string {
  try {
    let result = optimizeMarkdownStyleInternal(text, cardVersion);
    result = stripInvalidImageKeys(result);
    result = addCategoryEmojis(result);
    return result;
  } catch {
    return text;
  }
}

// ---------------------------------------------------------------------------
// 格式化辅助函数
// ---------------------------------------------------------------------------

/**
 * 格式化思考耗时：'Thought for 3.2s' 或 'Thought'
 */
export function formatReasoningDuration(ms: number | undefined): string {
  if (!ms) {
    return 'Thought';
  }
  return `Thought for ${formatElapsed(ms)}`;
}

/**
 * 格式化毫秒为可读时间：'3.2s' 或 '1m 15s'
 */
export function formatElapsed(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
}

/**
 * 简化模型名称显示
 */
export function simplifyModelName(model: string): string {
  if (!model) {
    return 'Unknown';
  }

  const m = model.toLowerCase();

  if (m.includes('claude')) {
    if (m.includes('opus')) {
      return 'Claude-Opus';
    }
    if (m.includes('sonnet')) {
      return 'Claude-Sonnet';
    }
    if (m.includes('haiku')) {
      return 'Claude-Haiku';
    }
    return 'Claude';
  }

  if (m.includes('gpt-4') || m.includes('gpt4')) {
    return 'GPT-4';
  }

  if (m.includes('gpt-3.5') || m.includes('gpt3.5')) {
    return 'GPT-3.5';
  }

  if (m.includes('kimi')) {
    return 'Kimi';
  }

  // OpenCode / mimo 等，取路径最后一段
  if (m.includes('opencode') || m.includes('mimo')) {
    const parts = model.split('/');
    const name = parts.length > 1 ? parts[parts.length - 1] : model;
    return name.slice(0, 24);
  }

  if (model.length > 24) {
    return model.slice(0, 21) + '...';
  }

  return model;
}

/**
 * 截断文本，超出长度显示省略号
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * 转义 Markdown 特殊字符
 */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/`/g, '\\`');
}
