/**
 * Core card builder module
 * 核心流式卡片构建模块
 *
 * 流式输出相关的核心卡片构建函数，包括 thinking、streaming、complete 三种状态
 */

import type { TokenStats } from '../core/types/stream.js';
import {
  optimizeMarkdownStyle,
  formatReasoningDuration,
  formatElapsed,
  simplifyModelName,
} from './utils.js';

/** 卡片数据类型 */
export interface CardData {
  text?: string;
  reasoningText?: string;
  reasoningElapsedMs?: number;
  elapsedMs?: number;
  isError?: boolean;
  tokenStats?: TokenStats;
  model?: string;
}

/** 卡片元素 */
export interface CardElement {
  tag: string;
  [key: string]: unknown;
}

/** 飞书卡片对象 */
export interface FeishuCard {
  schema?: string;
  config?: Record<string, unknown>;
  header?: Record<string, unknown>;
  body?: {
    elements?: CardElement[];
  };
  elements?: CardElement[];
}

/**
 * 构建飞书交互式卡片内容
 *
 * @param state - 卡片状态 —— 'thinking' | 'streaming' | 'complete'
 * @param data - 卡片数据字典
 * @returns 飞书卡片 JSON 对象（Schema 2.0）
 */
export function buildCardContent(state: string, data: CardData = {}): FeishuCard {
  switch (state) {
    case 'thinking':
      return buildThinkingCard();
    case 'streaming':
      return buildStreamingCard(data.text || '', data.reasoningText);
    case 'complete':
      return buildCompleteCard(
        data.text || '',
        data.elapsedMs,
        data.isError || false,
        data.reasoningText,
        data.reasoningElapsedMs,
        data.tokenStats,
        data.model || ''
      );
    default:
      throw new Error(`未知的卡片状态: ${state}`);
  }
}

/**
 * 思考中卡片（CardKit 失败时的 IM 回退）
 *
 * 仅在 CardKit 流程失败时发送，作为等待动画的替代。
 */
function buildThinkingCard(): FeishuCard {
  return {
    config: { wide_screen_mode: true, update_multi: true },
    elements: [
      {
        tag: 'markdown',
        content: '思考中...',
      },
    ],
  };
}

/**
 * 流式输出卡片（IM Patch 回退时使用）
 *
 * CardKit 正常工作时不会调用此函数，CardKit 通过 cardElement.content
 * 直接更新元素内容，无需重建整张卡片。
 *
 * @param text - 当前已生成的回答文本
 * @param reasoningText - 思考过程文本
 */
function buildStreamingCard(text: string, reasoningText?: string): FeishuCard {
  const elements: CardElement[] = [];

  if (!text && reasoningText) {
    // 思考阶段：显示思考内容（notation 字号，较小）
    elements.push({
      tag: 'markdown',
      content: `💭 **Thinking...**\n\n${reasoningText}`,
      text_size: 'notation',
    });
  } else if (text) {
    // 回答阶段：显示回答内容
    elements.push({
      tag: 'markdown',
      content: optimizeMarkdownStyle(text),
    });
  }

  return {
    schema: '2.0',
    config: { wide_screen_mode: true, update_multi: true },
    body: { elements },
  };
}

/**
 * 从文本中移除与 reasoningText 重复的部分
 *
 * 某些 OpenCode 模型会将推理内容同时作为 CONTENT 发送，导致重复显示。
 * 此函数检测并移除 text 开头与 reasoningText 重复的内容。
 *
 * @param text - 主回答文本
 * @param reasoningText - 思考过程文本
 * @returns 移除重复内容后的文本
 */
function deduplicateReasoning(text: string, reasoningText?: string): string {
  if (!reasoningText || !text) {
    return text;
  }

  const reasoningNormalized = reasoningText.trim();
  const textNormalized = text.trim();

  // 情况1: 文本以推理内容开头（完全包含）
  if (textNormalized.startsWith(reasoningNormalized)) {
    const remaining = textNormalized.slice(reasoningNormalized.length).trim();
    return remaining;
  }

  // 情况2: 文本包含推理内容（可能是中间或结尾）
  // 使用滑动窗口找最长公共子串
  if (reasoningNormalized.length > 50) {
    // 取推理文本的前80%进行匹配（避免末尾的差异）
    const reasoningPrefix = reasoningNormalized.slice(0, Math.floor(reasoningNormalized.length * 0.8));

    if (textNormalized.includes(reasoningPrefix)) {
      // 找到重复位置，移除重复部分
      const idx = textNormalized.indexOf(reasoningPrefix);
      if (idx >= 0) {
        // 计算需要移除的范围（从重复开始到推理文本结束）
        const endIdx = idx + reasoningNormalized.length;
        if (endIdx <= textNormalized.length) {
          const remaining = textNormalized.slice(0, idx) + textNormalized.slice(endIdx);
          return remaining.trim();
        }
      }
    }
  }

  return text;
}

/**
 * 将 token 统计信息追加到 parts 列表（紧凑格式）
 *
 * 格式: 📊 1.2K (5%) - 更简洁的显示
 */
function appendTokenStatsCompact(parts: string[], tokenStats: TokenStats): void {
  const formatNum = (n: number): string => {
    if (n >= 1000) {
      return `${(n / 1000).toFixed(1)}K`;
    }
    return String(n);
  };

  // 使用 contextPercent 计算百分比
  const contextPercent = tokenStats.contextPercent ?? 0;
  const totalTokens = tokenStats.totalTokens ?? 0;
  parts.push(`📊 ${formatNum(totalTokens)} (${contextPercent.toFixed(1)}%)`);
}

/**
 * 完成状态卡片
 *
 * 结构（从上到下）：
 * 1. 可折叠思考面板 collapsible_panel（有 reasoning 时）- 更美观的样式
 * 2. 主回答内容 markdown（normal_v2 字号）- 带 emoji 分类和美化
 * 3. 底部元信息 markdown（notation 字号，右对齐）- 单行紧凑显示
 *    格式: ✅ 已完成 · ⏱️ 3.2s · 📊 1,234 tokens (5.2%) · 🤖 claude-sonnet
 *
 * @param text - 完整回答文本
 * @param elapsedMs - 总耗时（毫秒）
 * @param isError - 是否出错
 * @param reasoningText - 思考过程文本
 * @param reasoningElapsedMs - 思考耗时（毫秒）
 * @param tokenStats - Token 统计信息
 * @param model - 模型名称
 */
function buildCompleteCard(
  text: string,
  elapsedMs?: number,
  isError: boolean = false,
  reasoningText?: string,
  reasoningElapsedMs?: number,
  tokenStats?: TokenStats,
  model: string = ''
): FeishuCard {
  const elements: CardElement[] = [];

  // ── 0. 去重处理 ───────────────────────────────────────────────────────
  // 某些模型会将推理内容重复输出到正式回答中，需要提前移除
  text = deduplicateReasoning(text, reasoningText);

  // ── 1. 可折叠思考面板（更美观的样式）────────────────────────────────
  if (reasoningText) {
    const durationLabel = formatReasoningDuration(reasoningElapsedMs);
    elements.push({
      tag: 'collapsible_panel',
      expanded: false,
      header: {
        title: { tag: 'markdown', content: `💭 ${durationLabel}` },
        vertical_align: 'center',
        icon: {
          tag: 'standard_icon',
          token: 'down-small-ccm_outlined',
          size: '16px 16px',
        },
        icon_position: 'follow_text',
        icon_expanded_angle: -180,
      },
      border: { color: 'blue', corner_radius: '6px' },
      vertical_spacing: '6px',
      padding: '10px 12px 10px 12px',
      elements: [
        {
          tag: 'markdown',
          content: reasoningText,
          text_size: 'notation',
        },
      ],
    });
  }

  // ── 2. 主回答内容（带 emoji 分类和美化）──────────────────────────────
  const optimizedText = text ? optimizeMarkdownStyle(text) : '';
  elements.push({
    tag: 'markdown',
    content: optimizedText,
  });

  // ── 3. 底部元信息（单行紧凑显示，右对齐）────────────────────────────
  const footerParts: string[] = [];

  // 状态
  if (isError) {
    footerParts.push('❌ 出错');
  } else {
    footerParts.push('✅ 已完成');
  }

  // 耗时
  if (elapsedMs !== undefined) {
    footerParts.push(`⏱️ ${formatElapsed(elapsedMs)}`);
  }

  // Token 统计
  if (tokenStats) {
    appendTokenStatsCompact(footerParts, tokenStats);
  }

  // 模型
  if (model) {
    footerParts.push(`🤖 ${simplifyModelName(model)}`);
  }

  // 构建单行 Footer
  if (footerParts.length > 0) {
    const footerText = footerParts.join(' · ');
    const footerContent = isError
      ? `<font color='red'>${footerText}</font>`
      : `<font color='grey'>${footerText}</font>`;
    elements.push({
      tag: 'markdown',
      content: footerContent,
      text_align: 'right',
      text_size: 'notation',
    });
  }

  // ── 摘要（消息列表预览）──────────────────────────────────────────────
  const summaryText = text.replace(/[*_`#>\[\]()~]/g, '').trim();
  const summary = summaryText ? { content: summaryText.slice(0, 120) } : undefined;

  return {
    schema: '2.0',
    config: { wide_screen_mode: true, update_multi: true, summary },
    body: { elements },
  };
}
