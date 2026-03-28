/**
 * Card builder utilities
 * 卡片构建工具函数
 *
 * 共享的工具函数，用于构建飞书卡片消息
 */

import type { TokenStats } from '../../core/types/stream.js';

/**
 * 格式化时间（秒 -> mm:ss）
 */
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
 * 创建卡片头部
 */
export function createCardHeader(title: string, icon?: string): object {
  return {
    tag: 'div',
    text: {
      tag: 'plain_text',
      content: icon ? `${icon} ${title}` : title,
    },
    icon: icon
      ? {
          tag: 'standard_icon',
          token: icon,
        }
      : undefined,
  };
}

/**
 * 创建 Markdown 内容块
 */
export function createMarkdownBlock(content: string): object {
  return {
    tag: 'markdown',
    content: content,
  };
}

/**
 * 创建备注块（小字灰色）
 */
export function createNoteBlock(content: string): object {
  return {
    tag: 'note',
    elements: [
      {
        tag: 'plain_text',
        content: content,
      },
    ],
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
