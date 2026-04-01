/**
 * Message Router
 * 消息路由模块
 *
 * 根据消息内容判断消息类型，决定路由到哪个处理器
 * 处理命令解析和消息分类
 */

import { logger } from '../../core/logger.js';

/**
 * 消息路由类型
 */
export type RouteType =
  | 'AI_MESSAGE'      // 普通 AI 对话消息
  | 'TUI_COMMAND'     // TUI 命令（如 /new, /session）
  | 'PROJECT_COMMAND' // 项目相关命令（如 /pa, /pc）
  | 'STOP_COMMAND'    // 停止生成命令（/stop）
  | 'HELP_COMMAND'    // 帮助命令（/help）
  | 'UNKNOWN';        // 未知类型

/**
 * 路由结果
 */
export interface RouteResult {
  /** 路由类型 */
  type: RouteType;
  /** 额外数据 */
  extra: Record<string, unknown>;
}

/**
 * TUI 命令定义
 */
const TUI_COMMANDS = [
  '/new',      // 创建新会话
  '/session',  // 会话管理
  '/model',    // 模型管理
  '/mode',     // 模式切换（Agent）
  '/reset',    // 重置会话
  '/clear',    // 清空历史
  '/rename',   // 重命名会话
  '/delete',   // 删除会话
] as const;

/**
 * 项目命令定义
 */
const PROJECT_COMMANDS = [
  '/pa',       // 添加项目
  '/pc',       // 创建项目
  '/pl',       // 列出项目
  '/ps',       // 切换项目
  '/pi',       // 项目信息
  '/pd',       // 删除项目
] as const;

/**
 * 消息路由器
 *
 * 负责解析用户输入，判断消息类型并路由到相应处理器
 */
export class MessageRouter {
  /**
   * 路由消息
   * @param content - 消息内容
   * @returns 路由结果
   */
  route(content: string): RouteResult {
    const trimmed = content.trim();

    // 空消息
    if (!trimmed) {
      return { type: 'UNKNOWN', extra: { reason: 'empty_message' } };
    }

    // 停止命令（特殊处理，因为可能在生成过程中使用）
    if (trimmed === '/stop') {
      return { type: 'STOP_COMMAND', extra: {} };
    }

    // 帮助命令
    if (trimmed === '/help' || trimmed === '/h') {
      return { type: 'HELP_COMMAND', extra: {} };
    }

    // TUI 命令
    const tuiCommand = this.parseTUICommand(trimmed);
    if (tuiCommand) {
      return {
        type: 'TUI_COMMAND',
        extra: {
          command: tuiCommand.command,
          args: tuiCommand.args,
          raw: trimmed,
        },
      };
    }

    // 项目命令
    const projectCommand = this.parseProjectCommand(trimmed);
    if (projectCommand) {
      return {
        type: 'PROJECT_COMMAND',
        extra: {
          subcommand: projectCommand.subcommand,
          args: projectCommand.args,
          raw: trimmed,
        },
      };
    }

    // 默认：AI 消息
    return {
      type: 'AI_MESSAGE',
      extra: {
        content: trimmed,
      },
    };
  }

  /**
   * 解析 TUI 命令
   * @param content - 消息内容
   * @returns 命令信息或 null
   */
  private parseTUICommand(content: string): { command: string; args: string[] } | null {
    const parts = content.split(/\s+/);
    const cmd = parts[0].toLowerCase();

    if ((TUI_COMMANDS as readonly string[]).includes(cmd)) {
      return {
        command: cmd,
        args: parts.slice(1),
      };
    }

    return null;
  }

  /**
   * 解析项目命令
   * @param content - 消息内容
   * @returns 命令信息或 null
   */
  private parseProjectCommand(content: string): { subcommand: string; args: string[] } | null {
    const parts = content.split(/\s+/);
    const cmd = parts[0].toLowerCase();

    if ((PROJECT_COMMANDS as readonly string[]).includes(cmd)) {
      return {
        subcommand: cmd,
        args: parts.slice(1),
      };
    }

    return null;
  }

  /**
   * 提取回复中的引用内容
   * @param content - 消息内容
   * @returns 清理后的内容和引用信息
   */
  parseReplyContent(content: string): {
    cleanContent: string;
    hasQuote: boolean;
    quotedText?: string;
  } {
    // 匹配飞书引用格式：> 引用内容
    const quoteMatch = content.match(/^(>[^\n]*\n)?\s*/);
    const hasQuote = !!quoteMatch && quoteMatch[0].includes('>');

    // 移除引用行
    const cleanContent = content.replace(/^>[^\n]*\n?/gm, '').trim();

    // 提取被引用的文本（如果有）
    let quotedText: string | undefined;
    if (hasQuote) {
      const quotedLines: string[] = [];
      const lines = content.split('\n');
      for (const line of lines) {
        if (line.trim().startsWith('>')) {
          quotedLines.push(line.trim().substring(1).trim());
        }
      }
      quotedText = quotedLines.join('\n');
    }

    return {
      cleanContent,
      hasQuote,
      quotedText,
    };
  }

  /**
   * 检查是否为纯命令（无额外参数）
   * @param content - 消息内容
   * @param command - 命令前缀
   */
  isBareCommand(content: string, command: string): boolean {
    const trimmed = content.trim();
    return trimmed === command || trimmed.startsWith(command + ' ');
  }

  /**
   * 提取命令参数
   * @param content - 消息内容
   * @returns 参数数组
   */
  extractArgs(content: string): string[] {
    const parts = content.trim().split(/\s+/);
    return parts.slice(1);
  }
}

/**
 * 创建默认路由器实例
 */
export function createMessageRouter(): MessageRouter {
  return new MessageRouter();
}
