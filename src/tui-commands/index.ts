/**
 * TUI Commands - Main module
 * TUI 命令主模块
 *
 * 提供统一的 TUI 命令解析、路由和分发
 */

import type { TUIResult, CommandContext } from './base.js';
import { TUIResultType, createErrorResult } from './base.js';
import { logger } from '../core/logger.js';

/** 交互式消息记录 */
interface InteractiveMessage {
  messageId: string;
  interactiveId: string;
  userId: string;
  chatId: string;
  cliType: string;
  createdAt: number;
  metadata: Record<string, unknown>;
  expiresAt: number;
}

/** 交互式消息管理器 */
class InteractiveMessageManager {
  private messages: Map<string, InteractiveMessage> = new Map();
  private maxMessages: number;

  constructor(maxMessages: number = 100) {
    this.maxMessages = maxMessages;
  }

  register(
    messageId: string,
    interactiveId: string,
    userId: string,
    chatId: string,
    cliType: string,
    metadata: Record<string, unknown> = {},
    ttl: number = 600
  ): void {
    this.cleanupExpired();

    // 限制最大数量
    if (this.messages.size >= this.maxMessages) {
      // 移除最旧的消息
      let oldest: [string, InteractiveMessage] | null = null;
      for (const entry of this.messages.entries()) {
        if (!oldest || entry[1].createdAt < oldest[1].createdAt) {
          oldest = entry;
        }
      }
      if (oldest) {
        this.messages.delete(oldest[0]);
      }
    }

    const now = Date.now();
    this.messages.set(messageId, {
      messageId,
      interactiveId,
      userId,
      chatId,
      cliType,
      metadata,
      createdAt: now,
      expiresAt: now + ttl * 1000,
    });
  }

  findReplyTarget(
    userId: string,
    chatId: string,
    replyToMessageId?: string
  ): InteractiveMessage | null {
    this.cleanupExpired();

    // 如果指定了回复的消息 ID，直接查找
    if (replyToMessageId) {
      const msg = this.messages.get(replyToMessageId);
      if (msg && msg.userId === userId && msg.chatId === chatId) {
        return msg;
      }
    }

    // 否则查找该用户在该聊天中最近的交互式消息
    const candidates: InteractiveMessage[] = [];
    for (const msg of this.messages.values()) {
      if (msg.userId === userId && msg.chatId === chatId && !this.isExpired(msg)) {
        candidates.push(msg);
      }
    }

    if (candidates.length > 0) {
      // 返回最近的消息
      return candidates.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
    }

    return null;
  }

  remove(messageId: string): boolean {
    return this.messages.delete(messageId);
  }

  private isExpired(msg: InteractiveMessage): boolean {
    return Date.now() > msg.expiresAt;
  }

  private cleanupExpired(): void {
    for (const [msgId, msg] of this.messages.entries()) {
      if (this.isExpired(msg)) {
        this.messages.delete(msgId);
      }
    }
  }
}

/** TUI 命令处理器接口 */
interface TUICommandHandler {
  supportedCommands: string[];
  execute(command: string, args: string | undefined, context: CommandContext): Promise<TUIResult>;
  handleInteractiveReply?(
    interactiveId: string,
    reply: string,
    metadata: Record<string, unknown>,
    context: CommandContext
  ): Promise<TUIResult>;
}

/** TUI 命令路由器 */
export class TUICommandRouter {
  private commandHandlers: Map<string, TUICommandHandler> = new Map();
  private interactiveManager: InteractiveMessageManager;

  // 所有支持的 TUI 命令
  static SUPPORTED_COMMANDS = [
    'new',
    'session',
    'model',
    'mode',
    'reset',
    'clear',
    'help',
    'stop',
  ];

  constructor() {
    this.interactiveManager = new InteractiveMessageManager();
  }

  /** 注册 CLI 工具适配器 */
  registerAdapter(cliType: string, handler: TUICommandHandler): void {
    this.commandHandlers.set(cliType, handler);
    logger.debug(`[TUI] Registered handler for: ${cliType}`);
  }

  /** 检查内容是否是 TUI 命令 */
  isTUICommand(content: string): boolean {
    if (!content.startsWith('/')) {
      return false;
    }

    // 提取命令名
    const parts = content.slice(1).split(/\s+/, 1);
    const command = parts[0]?.toLowerCase() || '';

    return TUICommandRouter.SUPPORTED_COMMANDS.includes(command);
  }

  /** 解析 TUI 命令 */
  parseCommand(content: string): { command: string; args: string | undefined } {
    // 移除前导斜杠
    const trimmed = content.slice(1).trim();

    // 分割命令和参数
    const spaceIndex = trimmed.search(/\s/);
    let command: string;
    let args: string | undefined;

    if (spaceIndex === -1) {
      command = trimmed.toLowerCase();
      args = undefined;
    } else {
      command = trimmed.slice(0, spaceIndex).toLowerCase();
      args = trimmed.slice(spaceIndex + 1).trim() || undefined;
    }

    // 规范化命令名
    if (command === 'clear') {
      command = 'reset';
    }

    return { command, args };
  }

  /** 执行 TUI 命令 */
  async execute(
    content: string,
    cliType: string,
    context: CommandContext
  ): Promise<TUIResult | null> {
    if (!this.isTUICommand(content)) {
      return null;
    }

    const { command, args } = this.parseCommand(content);

    // 查找对应的命令处理器
    const handler = this.commandHandlers.get(cliType);
    if (!handler) {
      return createErrorResult(`CLI 工具 ${cliType} 不支持 TUI 命令`);
    }

    // 检查命令是否被支持
    if (!handler.supportedCommands.includes(command)) {
      const supported = handler.supportedCommands.map((cmd) => `/${cmd}`).join(', ');
      return createErrorResult(
        `命令 /${command} 不被 ${cliType} 支持\n支持的命令: ${supported}`
      );
    }

    logger.debug(`[TUI] Executing: ${cliType} /${command} (args=${args})`);

    // 执行命令
    return await handler.execute(command, args, context);
  }

  /** 注册交互式消息 */
  registerInteractive(
    messageId: string,
    interactiveId: string,
    userId: string,
    chatId: string,
    cliType: string,
    metadata: Record<string, unknown> = {}
  ): void {
    this.interactiveManager.register(
      messageId,
      interactiveId,
      userId,
      chatId,
      cliType,
      metadata
    );
  }

  /** 处理用户回复 */
  async handleReply(
    replyContent: string,
    userId: string,
    chatId: string,
    replyToMessageId?: string
  ): Promise<TUIResult | null> {
    const target = this.interactiveManager.findReplyTarget(
      userId,
      chatId,
      replyToMessageId
    );

    if (!target) {
      return null;
    }

    logger.debug(
      `[TUI] Handling interactive reply: target=${target.interactiveId}, reply=${replyContent}`
    );

    const handler = this.commandHandlers.get(target.cliType);
    if (!handler || !handler.handleInteractiveReply) {
      return null;
    }

    const context: CommandContext = {
      userId,
      chatId,
      cliType: target.cliType,
      workingDir: '',
      timestamp: Date.now(),
    };

    const result = await handler.handleInteractiveReply(
      target.interactiveId,
      replyContent.trim(),
      target.metadata,
      context
    );

    // 处理成功后移除该交互式消息
    if (result) {
      this.interactiveManager.remove(target.messageId);
    }

    return result;
  }

  /** 检查是否是回复交互式消息 */
  isInteractiveReply(
    userId: string,
    chatId: string,
    replyToMessageId?: string
  ): boolean {
    const target = this.interactiveManager.findReplyTarget(
      userId,
      chatId,
      replyToMessageId
    );
    return target !== null;
  }
}

/** 创建 TUI 命令路由器实例 */
export function createTUIRouter(): TUICommandRouter {
  return new TUICommandRouter();
}

// 导出所有类型
export * from './base.js';
