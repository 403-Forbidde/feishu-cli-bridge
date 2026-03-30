/**
 * Streaming card builder
 * 流式思考中卡片构建器
 *
 * 构建 AI 生成过程中的实时状态卡片
 */

import { createCardConfig, createMarkdownBlock, createNoteBlock, createDivider, formatReasoningDuration, formatElapsed, optimizeMarkdownStyle } from './utils.js';
import type { TokenStats } from '../../core/types/stream.js';

/**
 * 思考状态类型
 */
export type ThinkingStatus = 'thinking' | 'generating' | 'reasoning';

/**
 * 状态配置
 */
const STATUS_CONFIG: Record<ThinkingStatus, { icon: string; text: string; color: string }> = {
  thinking: {
    icon: '💭',
    text: '正在思考',
    color: 'blue',
  },
  generating: {
    icon: '✨',
    text: '生成中',
    color: 'blue',
  },
  reasoning: {
    icon: '🔍',
    text: '推理中',
    color: 'purple',
  },
};

/**
 * 构建流式思考卡片
 *
 * @param content - 当前已生成的内容
 * @param reasoning - 推理内容（如果有）
 * @param reasoningElapsedMs - 推理耗时（毫秒，可选）
 * @param status - 当前状态
 * @param progress - 进度文本（可选）
 */
export function buildStreamingCard(
  content: string,
  reasoning: string,
  reasoningElapsedMs?: number,
  status: ThinkingStatus = 'generating',
  progress?: string
): object {
  const statusConfig = STATUS_CONFIG[status];
  const elements: object[] = [];

  // 头部 - 状态指示
  elements.push({
    tag: 'markdown',
    content: `${statusConfig.icon} **${statusConfig.text}**`,
  });

  // 进度（如果有）
  if (progress) {
    elements.push(createNoteBlock(progress));
  }

  elements.push(createDivider());

  // 推理内容（如果有）- 使用 collapsible_panel 折叠显示
  if (reasoning) {
    const durationLabel = reasoningElapsedMs && reasoningElapsedMs > 0
      ? formatReasoningDuration(reasoningElapsedMs)
      : 'Thinking...';
    elements.push({
      tag: 'collapsible_panel',
      expanded: false,
      header: {
        title: {
          tag: 'markdown',
          content: `💭 ${durationLabel}`,
        },
        vertical_align: 'center',
        icon: {
          tag: 'standard_icon',
          token: 'down-small-ccm_outlined',
          size: '16px 16px',
        },
        icon_position: 'follow_text',
        icon_expanded_angle: -180,
      },
      border: { color: 'grey', corner_radius: '5px' },
      vertical_spacing: '8px',
      padding: '8px 8px 8px 8px',
      elements: [
        {
          tag: 'markdown',
          content: formatReasoningContent(reasoning),
          text_size: 'notation',
        },
      ],
    });
    elements.push(createDivider());
  }

  // 主内容
  if (content) {
    elements.push(createMarkdownBlock(content));
  } else {
    // 等待动画
    elements.push({
      tag: 'markdown',
      content: generateWaitingAnimation(),
    });
  }

  return {
    config: createCardConfig(),
    elements,
  };
}

/**
 * 格式化推理内容（添加引用标记）
 * 注意：推理内容不经过 optimizeMarkdownStyle，保持原始格式
 */
function formatReasoningContent(reasoning: string): string {
  return reasoning
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

/**
 * 生成等待动画
 */
let animationFrame = 0;
const ANIMATION_FRAMES = ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'];

function generateWaitingAnimation(): string {
  animationFrame = (animationFrame + 1) % ANIMATION_FRAMES.length;
  return `${ANIMATION_FRAMES[animationFrame]} 正在生成回复...`;
}

/**
 * 构建带有统计信息的完成卡片（流式结束后的最终展示）
 *
 * @param content - 完整内容
 * @param reasoning - 推理内容
 * @param reasoningElapsedMs - 推理耗时（毫秒）
 * @param elapsedMs - 总耗时（毫秒）
 * @param stats - Token 统计信息
 * @param model - 模型名称
 * @param footerConfig - 页脚配置（可选）
 */
export function buildStreamingCompleteCard(
  content: string,
  reasoning: string,
  reasoningElapsedMs: number,
  elapsedMs: number,
  stats: TokenStats,
  model: string,
  footerConfig?: { status?: boolean; elapsed?: boolean; tokens?: boolean; model?: boolean }
): object {
  const elements: object[] = [];

  // 去重：如果 content 以 reasoning 内容开头，则移除重复部分
  const deduplicatedContent = deduplicateReasoning(content, reasoning);

  // Collapsible reasoning panel (before main content)
  if (reasoning) {
    const durationLabel = reasoningElapsedMs > 0
      ? formatReasoningDuration(reasoningElapsedMs)
      : 'Thought';
    elements.push({
      tag: 'collapsible_panel',
      expanded: false,
      header: {
        title: {
          tag: 'markdown',
          content: `💭 ${durationLabel}`,
        },
        vertical_align: 'center',
        icon: {
          tag: 'standard_icon',
          token: 'down-small-ccm_outlined',
          size: '16px 16px',
        },
        icon_position: 'follow_text',
        icon_expanded_angle: -180,
      },
      border: { color: 'grey', corner_radius: '5px' },
      vertical_spacing: '8px',
      padding: '8px 8px 8px 8px',
      elements: [
        {
          tag: 'markdown',
          content: formatReasoningContent(reasoning),
          text_size: 'notation',
        },
      ],
    });
    elements.push(createDivider());
  }

  // 主内容（已去重）
  elements.push(createMarkdownBlock(deduplicatedContent));
  elements.push(createDivider());

  // Footer meta-info: 已完成 · ⏱️ 11.8s · 📊 19.4K (7.4%) · 🤖 Kimi
  const parts: string[] = [];
  if (footerConfig?.status !== false) {
    parts.push('✅ 已完成');
  }
  if (footerConfig?.elapsed !== false && elapsedMs != null) {
    parts.push(`⏱️ ${formatElapsed(elapsedMs)}`);
  }
  if (footerConfig?.tokens !== false && stats) {
    const totalK = (stats.totalTokens / 1000).toFixed(1);
    // 百分比显示1位小数
    const percent = stats.contextPercent.toFixed(1);
    parts.push(`📊 ${totalK}K (${percent}%)`);
  }
  if (footerConfig?.model !== false && model) {
    // 提取模型短名称（去掉 provider 前缀）
    const shortModel = model.includes('/') ? model.split('/').pop() : model;
    parts.push(`🤖 ${shortModel}`);
  }
  if (parts.length > 0) {
    // 右对齐：使用 text_align 属性
    elements.push({
      tag: 'markdown',
      content: `<font color='grey'>${parts.join(' · ')}</font>`,
      text_align: 'right',
      text_size: 'notation',
    });
  }

  // CardKit 2.0 格式
  return {
    schema: '2.0',
    config: {
      ...createCardConfig(),
      summary: { content: '已完成' },
    },
    body: {
      elements,
    },
  };
}

/**
 * 构建停止生成卡片（用户点击 /stop 后）
 *
 * @param content - 已生成的内容
 * @param reasoning - 推理内容
 * @param reasoningElapsedMs - 推理耗时（毫秒，可选）
 * @param elapsedMs - 总耗时（毫秒，可选）
 * @param stats - Token 统计信息（可选）
 * @param model - 模型名称（可选）
 * @param footerConfig - 页脚配置（可选）
 */
export function buildStoppedCard(
  content: string,
  reasoning: string,
  reasoningElapsedMs?: number,
  elapsedMs?: number,
  stats?: TokenStats,
  model?: string,
  footerConfig?: { status?: boolean; elapsed?: boolean; tokens?: boolean; model?: boolean }
): object {
  const elements: object[] = [];

  // 去重：如果 content 以 reasoning 内容开头，则移除重复部分
  const deduplicatedContent = deduplicateReasoning(content, reasoning);

  // 停止提示
  elements.push({
    tag: 'markdown',
    content: '🛑 **生成已停止**',
  });

  if (reasoning) {
    elements.push(createDivider());
    const durationLabel = reasoningElapsedMs && reasoningElapsedMs > 0
      ? formatReasoningDuration(reasoningElapsedMs)
      : 'Thought';
    elements.push({
      tag: 'collapsible_panel',
      expanded: false,
      header: {
        title: {
          tag: 'markdown',
          content: `💭 ${durationLabel}`,
        },
        vertical_align: 'center',
        icon: {
          tag: 'standard_icon',
          token: 'down-small-ccm_outlined',
          size: '16px 16px',
        },
        icon_position: 'follow_text',
        icon_expanded_angle: -180,
      },
      border: { color: 'grey', corner_radius: '5px' },
      vertical_spacing: '8px',
      padding: '8px 8px 8px 8px',
      elements: [
        {
          tag: 'markdown',
          content: formatReasoningContent(reasoning),
          text_size: 'notation',
        },
      ],
    });
  }

  if (deduplicatedContent) {
    elements.push(createDivider());
    elements.push(createMarkdownBlock(deduplicatedContent));
  }

  elements.push(createDivider());

  // Footer meta-info: 已停止 · ⏱️ 5.8s · 📊 8.2K (3.2%) · 🤖 Kimi
  const parts: string[] = [];
  if (footerConfig?.status !== false) {
    parts.push('🛑 已停止');
  }
  if (footerConfig?.elapsed !== false && elapsedMs != null) {
    parts.push(`⏱️ ${formatElapsed(elapsedMs)}`);
  }
  if (footerConfig?.tokens !== false && stats) {
    const totalK = (stats.totalTokens / 1000).toFixed(1);
    // 百分比显示1位小数
    const percent = stats.contextPercent.toFixed(1);
    parts.push(`📊 ${totalK}K (${percent}%)`);
  }
  if (footerConfig?.model !== false && model) {
    const shortModel = model.includes('/') ? model.split('/').pop() : model;
    parts.push(`🤖 ${shortModel}`);
  }
  if (parts.length > 0) {
    // 右对齐：使用 text_align 属性
    elements.push({
      tag: 'markdown',
      content: `<font color='grey'>${parts.join(' · ')}</font>`,
      text_align: 'right',
      text_size: 'notation',
    });
  }

  // CardKit 2.0 格式
  return {
    schema: '2.0',
    config: {
      ...createCardConfig(),
      summary: { content: '已停止' },
    },
    body: {
      elements,
    },
  };
}

/**
 * 去重：如果 content 包含 reasoning 的内容，则移除重复部分
 * 这是为了处理 OpenCode 在某些情况下会将 reasoning 内容也作为 text 发送的问题
 *
 * 增强版：使用多种策略去重
 * 1. 如果 content 以 reasoning 开头（忽略空白差异），移除 reasoning 部分
 * 2. 如果 content 包含 reasoning 作为子串，替换为空
 */
function deduplicateReasoning(content: string, reasoning: string): string {
  if (!reasoning || !content) {
    return content;
  }

  // 策略1: 标准化后检查是否以 reasoning 开头
  const normalizedContent = content.replace(/\s+/g, ' ').trim();
  const normalizedReasoning = reasoning.replace(/\s+/g, ' ').trim();

  // 如果 content 以 reasoning 开头（忽略空白差异）
  if (normalizedContent.startsWith(normalizedReasoning)) {
    // 找到原始 content 中 reasoning 结束的位置
    let pos = 0;
    let reasoningPos = 0;

    while (pos < content.length && reasoningPos < reasoning.length) {
      // 跳过 content 中的空白
      while (pos < content.length && /\s/.test(content[pos])) {
        pos++;
      }
      // 跳过 reasoning 中的空白
      while (reasoningPos < reasoning.length && /\s/.test(reasoning[reasoningPos])) {
        reasoningPos++;
      }
      // 比较当前字符
      if (pos < content.length && reasoningPos < reasoning.length) {
        if (content[pos] === reasoning[reasoningPos]) {
          pos++;
          reasoningPos++;
        } else {
          // 不匹配，可能是部分匹配或格式差异，保留原始内容
          return content;
        }
      }
    }

    // 返回 reasoning 之后的部分（跳过前导空白）
    let result = content.slice(pos);
    return result.trimStart();
  }

  // 策略2: 如果 content 包含 reasoning 但不以它开头（可能中间有重复）
  // 使用正则表达式进行更灵活的去重（处理空白差异）
  if (normalizedContent.includes(normalizedReasoning)) {
    // 尝试替换原始 reasoning 文本
    const result = content.replace(reasoning, '');
    if (result !== content) {
      return result.trim();
    }
  }

  return content;
}
