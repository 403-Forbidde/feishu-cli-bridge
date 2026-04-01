/**
 * Card builder utilities
 * 卡片构建工具函数
 *
 * 共享的工具函数，用于构建飞书卡片消息
 */

import type { TokenStats } from '../../core/types/stream.js';

/**
 * 格式化毫秒为易读时长
 * e.g. "3.2s" or "1m 15s"
 */
export function formatElapsed(ms: number): string {
  const seconds = ms / 1000;
  return seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

/**
 * 构建推理时长文本
 * e.g. "Thought for 3.2s"
 */
export function formatReasoningDuration(ms: number): string {
  return `Thought for ${formatElapsed(ms)}`;
}
export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * 截断文本，超出长度显示省略号
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * 优化 Markdown 样式以适应飞书卡片渲染
 * 完全参考 OpenClaw 插件的实现
 *
 * - 标题降级：H1 → H4，H2~H6 → H5（避免卡片中标题过大）
 * - 表格前后增加段落间距（使用 <br>）
 * - 代码块前后追加 <br>
 * - 压缩多余空行（3 个以上连续换行 → 2 个）
 * - 代码块内容不受影响
 *
 * @param text - 原始 Markdown 文本
 * @param cardVersion - 卡片版本，默认为 2
 * @returns 优化后的 Markdown 文本
 */
export function optimizeMarkdownStyle(text: string, cardVersion: number = 2): string {
  try {
    let r = _optimizeMarkdownStyle(text, cardVersion);
    r = stripInvalidImageKeys(r);
    return r;
  } catch {
    return text;
  }
}

function _optimizeMarkdownStyle(text: string, cardVersion: number = 2): string {
  // ── 1. 提取代码块，用占位符保护，处理后再还原 ─────────────────────
  const MARK = '___CB_';
  const codeBlocks: string[] = [];
  let r = text.replace(/```[\s\S]*?```/g, (m) => {
    return `${MARK}${codeBlocks.push(m) - 1}___`;
  });

  // ── 2. 标题降级 ────────────────────────────────────────────────────
  // 只有当原文档包含 h1~h3 标题时才执行降级
  // 先处理 H2~H6 → H5，再处理 H1 → H4
  // 顺序不能颠倒：若先 H1→H4，H4（####）会被后面的 #{2,6} 再次匹配成 H5
  const hasH1toH3 = /^#{1,3} /m.test(text);
  if (hasH1toH3) {
    r = r.replace(/^#{2,6} (.+)$/gm, '##### $1'); // H2~H6 → H5
    r = r.replace(/^# (.+)$/gm, '#### $1'); // H1 → H4
  }

  if (cardVersion >= 2) {
    // ── 3. 连续标题间增加段落间距 ───────────────────────────────────────
    r = r.replace(/^(#{4,5} .+)\n{1,2}(#{4,5} )/gm, '$1\n<br>\n$2');

    // ── 3b. 加粗标题（独立成行）后如果紧跟列表，增加段落间距 ─────────────
    // **标题**\n- item → **标题**\n\n- item
    r = r.replace(/^(\*\*[^*]+\*\*)\n([\-\*•] )/gm, '$1\n\n$2');
    // **标题**\n\n<br>\n\n- item → **标题**\n\n- item（去掉多余的 <br>）
    r = r.replace(/^(\*\*[^*]+\*\*)\n\n(<br>)\n\n([\-\*•] )/gm, '$1\n\n$3');

    // ── 4. 表格前后增加段落间距 ─────────────────────────────────────────
    // 4a. 非表格行直接跟表格行时，先补一个空行
    r = r.replace(/^([^|\n].*)\n(\|.+\|)/gm, '$1\n\n$2');
    // 4b. 表格前：在空行之前插入 <br>（即 \n\n| → \n<br>\n\n| ）
    r = r.replace(/\n\n((?:\|.+\|[^\S\n]*\n?)+)/g, '\n\n<br>\n\n$1');
    // 4c. 表格后：在表格块末尾追加 <br>（跳过后接分隔线/标题/加粗/文末的情况）
    r = r.replace(/((?:^\|.+\|[^\S\n]*\n?)+)/gm, (m, _table, offset) => {
      const after = r.slice(offset + m.length).replace(/^\n+/, '');
      if (!after || /^(---|#{4,5} |\*\*)/.test(after)) return m;
      return m + '\n<br>\n';
    });
    // 4d. 表格前是普通文本（非标题、非加粗行）时，只需 <br>，去掉多余空行
    //     "text\n\n<br>\n\n|" → "text\n<br>\n|"
    r = r.replace(/^((?!#{4,5} )(?!\*\*).+)\n\n(<br>)\n\n(\|)/gm, '$1\n$2\n$3');
    // 4d2. 表格前是加粗行时，<br> 紧贴加粗行，空行保留在后面
    //     "**bold**\n\n<br>\n\n|" → "**bold**\n<br>\n\n|"
    r = r.replace(/^(\*\*.+)\n\n(<br>)\n\n(\|)/gm, '$1\n$2\n\n$3');
    // 4e. 表格后是普通文本（非标题、非加粗行）时，只需 <br>，去掉多余空行
    //     "| row |\n\n<br>\ntext" → "| row |\n<br>\ntext"
    r = r.replace(/(\|[^\n]*\n)\n(<br>\n)((?!#{4,5} )(?!\*\*))/gm, '$1$2$3');

    // ── 5. 还原代码块，并在前后追加 <br> ──────────────────────────────
    codeBlocks.forEach((block, i) => {
      r = r.replace(`${MARK}${i}___`, `\n<br>\n${block}\n<br>\n`);
    });
  } else {
    // ── 5. 还原代码块（无 <br>）───────────────────────────────────────
    codeBlocks.forEach((block, i) => {
      r = r.replace(`${MARK}${i}___`, block);
    });
  }

  // ── 6. 压缩多余空行（3 个以上连续换行 → 2 个）────────────────────
  r = r.replace(/\n{3,}/g, '\n\n');

  return r;
}

// ---------------------------------------------------------------------------
// stripInvalidImageKeys
// ---------------------------------------------------------------------------
/** Matches complete markdown image syntax: `![alt](value)` */
const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g;

/**
 * Strip `![alt](value)` where value is not a valid Feishu image key
 * (`img_xxx`). Prevents CardKit error 200570.
 *
 * HTTP URLs are stripped as well — ImageResolver should have already
 * replaced them with `img_xxx` keys before this point. This serves
 * as a safety net for any unresolved URLs.
 */
function stripInvalidImageKeys(text: string): string {
  if (!text.includes('!['))
    return text;
  return text.replace(IMAGE_RE, (fullMatch, _alt, value) => {
    if (value.startsWith('img_'))
      return fullMatch;
    return ''; // strip all non-img_ image references (URLs, local paths, etc.)
  });
}

/**
 * Strip reasoning blocks — both XML tags with their content.
 * 参考 OpenClaw 插件实现: builder.js stripReasoningTags
 *
 * 注意：此函数只处理 XML 标签，不处理 "Reasoning:\n" 前缀。
 * "Reasoning:\n" 前缀的处理应该在调用方判断（如果以此开头，则整个内容是 reasoning）
 *
 * 处理以下标签: <thinking>, <thought>, <antthinking>, etc.
 */
export function stripReasoningTags(text: string): string {
  if (!text) return '';

  // Strip complete XML blocks (think, thinking, thought, antthinking)
  let result = text.replace(/<\s*(?:think(?:ing)?|thought|antthinking)\s*>[\s\S]*?<\s*\/\s*(?:think(?:ing)?|thought|antthinking)\s*>/gi, '');
  // Strip unclosed tag at end (streaming)
  result = result.replace(/<\s*(?:think(?:ing)?|thought|antthinking)\s*>[\s\S]*$/gi, '');
  // Strip orphaned closing tags
  result = result.replace(/<\s*\/\s*(?:think(?:ing)?|thought|antthinking)\s*>/gi, '');
  return result.trim();
}

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

/**
 * 构建 Token 统计文本
 */
export function buildTokenStatsText(stats: TokenStats): string {
  const { promptTokens, completionTokens, totalTokens, contextPercent } = stats;
  return `Tokens: ${promptTokens}↑ ${completionTokens}↓ ${totalTokens}∑ (${contextPercent.toFixed(1)}% 上下文)`;
}

/**
 * 构建页脚时间信息
 */
export function buildFooterText(elapsedMs: number): string {
  const elapsed = formatDuration(elapsedMs / 1000);
  const now = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  return `⏱️ ${elapsed} · ${now}`;
}

/**
 * 飞书卡片颜色常量
 */
export const CardColors = {
  /** 思考中 - 蓝色 */
  THINKING: 'blue',
  /** 完成 - 绿色 */
  SUCCESS: 'green',
  /** 错误 - 红色 */
  ERROR: 'red',
  /** 警告 - 橙色 */
  WARNING: 'orange',
  /** 默认 - 灰色 */
  DEFAULT: 'default',
} as const;

/**
 * 创建卡片头部（简化版，使用 markdown）
 */
export function createCardHeader(title: string, icon?: string): object {
  return {
    tag: 'markdown',
    content: icon ? `${icon} **${title}**` : `**${title}**`,
  };
}

/**
 * 创建 Markdown 内容块
 * 使用 optimizeMarkdownStyle 预处理内容以确保飞书卡片正确渲染
 */
export function createMarkdownBlock(content: string): object {
  return {
    tag: 'markdown',
    content: optimizeMarkdownStyle(content),
  };
}

/**
 * 创建备注块（小字灰色）
 * Schema V2 使用 markdown 标签配合 <font color='grey'> 实现灰色小字
 */
export function createNoteBlock(content: string): object {
  return {
    tag: 'markdown',
    content: `<font color='grey'>${content}</font>`,
    text_size: 'notation',
  };
}

/**
 * 创建分割线
 */
export function createDivider(): object {
  return {
    tag: 'hr',
  };
}

/**
 * 创建按钮
 */
export function createButton(
  text: string,
  action: string,
  type: 'primary' | 'default' | 'danger' = 'default'
): object {
  const tokenMap = {
    primary: 'button_primary',
    default: 'button_default',
    danger: 'button_danger',
  };

  return {
    tag: 'button',
    text: {
      tag: 'plain_text',
      content: text,
    },
    type: tokenMap[type],
    value: {
      action,
    },
  };
}

/**
 * 创建卡片配置（整体样式）
 */
export function createCardConfig(
  wideScreenMode: boolean = true,
  enableForward: boolean = true
): object {
  return {
    wide_screen_mode: wideScreenMode,
    enable_forward: enableForward,
  };
}
