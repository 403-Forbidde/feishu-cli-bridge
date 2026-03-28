/**
 * Streaming card builder
 * 流式思考中卡片构建器
 *
 * 构建 AI 生成过程中的实时状态卡片
 */

import { CardColors, createCardConfig, createMarkdownBlock, createNoteBlock, createDivider, buildTokenStatsText, buildFooterText } from './utils.js';
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
 * @param status - 当前状态
 * @param progress - 进度文本（可选）
 */
export function buildStreamingCard(
  content: string,
  reasoning: string,
  status: ThinkingStatus = 'generating',
  progress?: string
): object {
  const statusConfig = STATUS_CONFIG[status];
  const elements: object[] = [];

  // 头部 - 状态指示
  elements.push({
    tag: 'div',
    text: {
      tag: 'plain_text',
      content: `${statusConfig.icon} ${statusConfig.text}`,
    },
  });

  // 进度（如果有）
  if (progress) {
    elements.push(createNoteBlock(progress));
  }

  elements.push(createDivider());

  // 推理内容（如果有）- 折叠显示
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
  if (content) {
    elements.push(createMarkdownBlock(content));
  } else {
    // 等待动画
    elements.push({
      tag: 'div',
      text: {
        tag: 'plain_text',
        content: generateWaitingAnimation(),
      },
    });
  }

  return {
    schema: '2.0',
    config: createCardConfig(),
    card_link: undefined,
    header: {
      title: {
        tag: 'plain_text',
        content: 'AI 助手',
      },
      subtitle: {
        tag: 'plain_text',
        content: progress || statusConfig.text,
      },
      template: statusConfig.color,
    },
    body: {
      elements,
    },
  };
}

/**
 * 格式化推理内容（添加引用标记）
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
 * @param stats - Token 统计
 * @param model - 模型名称
 * @param elapsedMs - 耗时（毫秒）
 */
export function buildStreamingCompleteCard(
  content: string,
  reasoning: string,
  stats: TokenStats,
  model: string,
  elapsedMs: number
): object {
  const elements: object[] = [];

  // 推理内容（如果有）- 折叠显示
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

  // 页脚信息
  const footerText = `${buildTokenStatsText(stats)} · ${model} · ${buildFooterText(elapsedMs)}`;
  elements.push(createNoteBlock(footerText));

  return {
    schema: '2.0',
    config: createCardConfig(),
    card_link: undefined,
    header: {
      title: {
        tag: 'plain_text',
        content: 'AI 助手',
      },
      template: CardColors.SUCCESS,
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
 */
export function buildStoppedCard(content: string, reasoning: string): object {
  const elements: object[] = [];

  // 停止提示
  elements.push({
    tag: 'div',
    text: {
      tag: 'plain_text',
      content: '🛑 生成已停止',
    },
  });

  if (reasoning) {
    elements.push(createDivider());
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
  }

  if (content) {
    elements.push(createDivider());
    elements.push(createMarkdownBlock(content));
  }

  elements.push(createDivider());
  elements.push(createNoteBlock('用户手动停止了生成'));

  return {
    schema: '2.0',
    config: createCardConfig(),
    card_link: undefined,
    header: {
      title: {
        tag: 'plain_text',
        content: 'AI 助手',
      },
      template: CardColors.WARNING,
    },
    body: {
      elements,
    },
  };
}
