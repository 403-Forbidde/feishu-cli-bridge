/**
 * Complete card builder
 * 完成结果卡片构建器
 *
 * 构建 AI 生成完成后的最终展示卡片
 */

import { CardColors, createCardConfig, createMarkdownBlock, createNoteBlock, createDivider, buildTokenStatsText, buildFooterText } from './utils.js';
import type { TokenStats } from '../../core/types/stream.js';

/**
 * 构建完成卡片
 *
 * @param content - 完整回复内容
 * @param reasoning - 推理内容（如果有）
 * @param stats - Token 统计信息
 * @param model - 使用的模型名称
 * @param elapsedMs - 生成耗时（毫秒）
 * @param sessionName - 会话名称（可选）
 */
export function buildCompleteCard(
  content: string,
  reasoning: string,
  stats: TokenStats,
  model: string,
  elapsedMs: number,
  sessionName?: string
): object {
  const elements: object[] = [];

  // 推理过程（如果有）- 默认折叠
  if (reasoning) {
    elements.push({
      tag: 'collapse',
      header: {
        tag: 'plain_text',
        content: '🔍 推理过程',
      },
      elements: [
        createMarkdownBlock(formatReasoningContent(reasoning)),
      ],
    });
    elements.push(createDivider());
  }

  // 主内容
  elements.push(createMarkdownBlock(content));
  elements.push(createDivider());

  // 页脚元信息
  const footerParts: string[] = [];
  footerParts.push(buildTokenStatsText(stats));
  footerParts.push(`🤖 ${model}`);
  if (sessionName) {
    footerParts.push(`💬 ${sessionName}`);
  }
  footerParts.push(buildFooterText(elapsedMs));

  elements.push(createNoteBlock(footerParts.join(' · ')));

  return {
    schema: '2.0',
    config: createCardConfig(),
    card_link: undefined,
    header: {
      title: {
        tag: 'plain_text',
        content: 'AI 助手',
      },
      subtitle: sessionName
        ? {
            tag: 'plain_text',
            content: sessionName,
          }
        : undefined,
      template: CardColors.SUCCESS,
    },
    body: {
      elements,
    },
  };
}

/**
 * 格式化推理内容
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
    schema: '2.0',
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
    body: {
      elements: [
        createMarkdownBlock(preview),
        createNoteBlock(`🤖 ${model} · ${timeStr}`),
      ],
    },
  };
}
