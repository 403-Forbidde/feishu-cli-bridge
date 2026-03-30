/**
 * Complete card builder
 * 完成结果卡片构建器
 *
 * 构建 AI 生成完成后的最终展示卡片
 */

import { CardColors, createCardConfig, createMarkdownBlock, createNoteBlock, createDivider, formatReasoningDuration, formatElapsed, optimizeMarkdownStyle } from './utils.js';

/**
 * 构建完成卡片
 *
 * @param content - 完整回复内容
 * @param reasoning - 推理内容（如果有）
 * @param reasoningElapsedMs - 推理耗时（毫秒）
 * @param elapsedMs - 生成耗时（毫秒）
 * @param footerConfig - 页脚配置（可选）
 */
export function buildCompleteCard(
  content: string,
  reasoning: string,
  reasoningElapsedMs: number,
  elapsedMs: number,
  footerConfig?: { status?: boolean; elapsed?: boolean }
): object {
  const elements: object[] = [];

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

  // 主内容
  elements.push(createMarkdownBlock(content));
  elements.push(createDivider());

  // Footer meta-info: only status and elapsed (not token stats)
  const parts: string[] = [];
  if (footerConfig?.status) {
    parts.push('已完成');
  }
  if (footerConfig?.elapsed && elapsedMs != null) {
    parts.push(`耗时 ${formatElapsed(elapsedMs)}`);
  }
  if (parts.length > 0) {
    elements.push(createNoteBlock(parts.join(' · ')));
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
 * 构建精简版完成卡片（用于会话历史预览）
 *
 * @param content - 内容摘要
 * @param model - 模型名称
 * @param timestamp - 时间戳
 */
export function buildCompactCard(
  content: string,
  model: string,
  timestamp: number
): object {
  const timeStr = new Date(timestamp).toLocaleString('zh-CN');
  const preview = content.length > 200 ? content.slice(0, 200) + '...' : content;

  return {
    config: createCardConfig(),
    header: {
      title: {
        tag: 'plain_text',
        content: 'AI 助手',
      },
      subtitle: {
        tag: 'plain_text',
        content: timeStr,
      },
      template: CardColors.DEFAULT,
    },
    elements: [
      createMarkdownBlock(preview),
      createNoteBlock(`🤖 ${model} · ${timeStr}`),
    ],
  };
}
