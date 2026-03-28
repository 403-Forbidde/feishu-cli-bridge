/**
 * Message Processor
 * 消息处理器主模块
 *
 * 作为消息处理的统一入口，协调各个子处理器：
 * - Router: 消息路由
 * - AIProcessor: AI 消息处理
 * - CommandProcessor: TUI 命令处理
 * - AttachmentProcessor: 附件处理
 *
 * 基于 REVIEW.md 架构改进，将原来的 MessageHandler 拆分为多个专注的处理器
 */

import { logger } from '../../core/logger.js';
import type { FeishuAPI } from '../feishu-api.js';
import type { FeishuMessage, CardCallbackEvent, CardCallbackResponse } from '../types.js';
import type { ICLIAdapter } from '../../adapters/interface/types.js';
import type { SessionManager } from '../../session/manager.js';
import type { ProjectManager } from '../../project/manager.js';
import { MessageRouter, type RouteResult } from './router.js';
import { AIProcessor } from './ai-processor.js';
import { CommandProcessor } from './command-processor.js';
import { AttachmentProcessor } from './attachment-processor.js';

/**
 * 消息处理器选项
 */
export interface MessageProcessorOptions {
  /** 飞书 API 实例 */
  feishuAPI: FeishuAPI;
  /** 会话管理器 */
  sessionManager: SessionManager;
  /** 项目管理器 */
  projectManager: ProjectManager;
  /** 适配器映射表 */
  adapters: Map<string, ICLIAdapter>;
  /** 默认适配器类型 */
  defaultAdapterType: string;
  /** 最大提示词长度 */
  maxPromptLength?: number;
  /** 最大附件大小 */
  maxAttachmentSize?: number;
  /** 是否使用 CardKit */
  useCardKit?: boolean;
}

/**
 * 消息处理器
 *
 * 统一入口，负责：
 * 1. 消息路由分发
 * 2. 去重处理
 * 3. 处理器协调
 * 4. 错误处理
 */
export class MessageProcessor {
  private feishuAPI: FeishuAPI;
  private sessionManager: SessionManager;
  private projectManager: ProjectManager;
  private adapters: Map<string, ICLIAdapter>;
  private defaultAdapterType: string;

  // 子处理器
  private router: MessageRouter;
  private aiProcessor: AIProcessor;
  private commandProcessor: CommandProcessor;
  private attachmentProcessor: AttachmentProcessor;

  // 去重
  private processedMessages: Set<string> = new Set();
  private readonly maxDedupSize = 1000;

  constructor(options: MessageProcessorOptions) {
    this.feishuAPI = options.feishuAPI;
    this.sessionManager = options.sessionManager;
    this.projectManager = options.projectManager;
    this.adapters = options.adapters;
    this.defaultAdapterType = options.defaultAdapterType;

    // 初始化子处理器
    this.router = new MessageRouter();
    this.attachmentProcessor = new AttachmentProcessor({
      feishuAPI: options.feishuAPI,
      maxFileSize: options.maxAttachmentSize,
    });
    this.aiProcessor = new AIProcessor({
      feishuAPI: options.feishuAPI,
      sessionManager: options.sessionManager,
      projectManager: options.projectManager,
      attachmentProcessor: this.attachmentProcessor,
      maxPromptLength: options.maxPromptLength,
      useCardKit: options.useCardKit,
    });
    this.commandProcessor = new CommandProcessor({
      feishuAPI: options.feishuAPI,
      sessionManager: options.sessionManager,
      projectManager: options.projectManager,
      adapters: options.adapters,
      defaultAdapterType: options.defaultAdapterType,
    });

    logger.info('消息处理器初始化完成');
  }

  /**
   * 处理飞书消息事件
   * @param message - 飞书消息
   */
  async process(message: FeishuMessage): Promise<void> {
    // 1. 消息去重
    if (this.isDuplicate(message.messageId)) {
      logger.debug({ messageId: message.messageId }, '跳过重复消息');
      return;
    }
    this.markProcessed(message.messageId);

    // 2. 日志记录
    logger.info(
      {
        messageId: message.messageId,
        sender: message.senderName,
        chatType: message.chatType,
        contentPreview: message.content.substring(0, 100),
      },
      '收到消息'
    );

    // 3. 路由消息
    const route = this.router.route(message.content);

    // 4. 根据路由结果分发处理
    try {
      await this.dispatch(message, route);
    } catch (error) {
      logger.error({ error, messageId: message.messageId }, '消息处理失败');
      await this.handleError(message, error);
    }
  }

  /**
   * 处理卡片回调事件
   * @param event - 卡片回调事件
   */
  async processCardCallback(event: CardCallbackEvent): Promise<CardCallbackResponse> {
    logger.info(
      {
        userId: event.openId,
        action: event.data.action,
        targetElementId: event.data.targetElementId,
      },
      '收到卡片回调'
    );

    // 处理卡片交互（会话选择、项目切换等）
    const action = event.data.action;

    switch (action) {
      case 'switch_session':
        return this.handleSwitchSessionCallback(event);

      case 'switch_project':
        return this.handleSwitchProjectCallback(event);

      case 'delete_session':
        return this.handleDeleteSessionCallback(event);

      case 'delete_project':
        return this.handleDeleteProjectCallback(event);

      default:
        logger.warn({ action }, '未知的卡片回调动作');
        return {
          config: {
            disable_quick_action: false,
            update_multi: true,
          },
        };
    }
  }

  /**
   * 处理停止命令
   * @param userId - 用户 ID
   * @returns 是否成功停止
   */
  handleStop(userId: string): boolean {
    return this.aiProcessor.stopGeneration(userId);
  }

  /**
   * 检查是否有活跃生成
   * @param userId - 用户 ID
   */
  hasActiveGeneration(userId: string): boolean {
    return this.aiProcessor.hasActiveGeneration(userId);
  }

  /**
   * 获取适配器
   * @param type - 适配器类型
   */
  private getAdapter(type: string): ICLIAdapter | null {
    return this.adapters.get(type) || null;
  }

  /**
   * 分发消息到相应处理器
   */
  private async dispatch(message: FeishuMessage, route: RouteResult): Promise<void> {
    switch (route.type) {
      case 'AI_MESSAGE':
        await this.handleAIMessage(message);
        break;

      case 'TUI_COMMAND':
        await this.handleTUICommand(
          message,
          route.extra.command as string,
          (route.extra.args as string[]) || []
        );
        break;

      case 'PROJECT_COMMAND':
        await this.handleProjectCommand(
          message,
          route.extra.subcommand as string,
          (route.extra.args as string[]) || []
        );
        break;

      case 'STOP_COMMAND':
        await this.handleStopCommand(message);
        break;

      case 'HELP_COMMAND':
        await this.handleHelpCommand(message);
        break;

      case 'UNKNOWN':
        logger.warn({ content: message.content }, '无法识别的消息类型');
        await this.feishuAPI.sendText(
          message.chatId,
          '❓ 无法理解您的消息，发送 `/help` 查看可用命令'
        );
        break;

      default:
        logger.error({ route }, '未知的路由类型');
    }
  }

  /**
   * 处理 AI 消息
   */
  private async handleAIMessage(message: FeishuMessage): Promise<void> {
    // 获取当前会话以确定适配器类型
    const workingDir = await this.projectManager.getCurrentWorkingDir();
    const session = this.sessionManager.getOrCreate(
      message.senderId,
      this.defaultAdapterType,
      workingDir
    );

    const adapter = this.getAdapter(session.cliType);
    if (!adapter) {
      await this.feishuAPI.sendText(
        message.chatId,
        `❌ 适配器 ${session.cliType} 不可用，请联系管理员`
      );
      return;
    }

    await this.aiProcessor.process(message, adapter, session.cliType);
  }

  /**
   * 处理 TUI 命令
   */
  private async handleTUICommand(
    message: FeishuMessage,
    command: string,
    args: string[]
  ): Promise<void> {
    await this.commandProcessor.processTUICommand(message, command, args);
  }

  /**
   * 处理项目命令
   */
  private async handleProjectCommand(
    message: FeishuMessage,
    subcommand: string,
    args: string[]
  ): Promise<void> {
    await this.commandProcessor.processProjectCommand(message, subcommand, args);
  }

  /**
   * 处理停止命令
   */
  private async handleStopCommand(message: FeishuMessage): Promise<void> {
    const stopped = this.handleStop(message.senderId);

    if (stopped) {
      await this.feishuAPI.addTypingReaction(message.messageId);
    } else {
      await this.feishuAPI.sendText(
        message.chatId,
        'ℹ️ 没有正在进行的生成'
      );
    }
  }

  /**
   * 处理帮助命令
   */
  private async handleHelpCommand(message: FeishuMessage): Promise<void> {
    await this.commandProcessor.processHelp(message);
  }

  /**
   * 处理错误
   */
  private async handleError(message: FeishuMessage, error: unknown): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : '未知错误';

    try {
      await this.feishuAPI.sendText(
        message.chatId,
        `❌ 处理消息时出错: ${errorMessage}`
      );
    } catch (sendError) {
      logger.error({ sendError, originalError: error }, '发送错误消息失败');
    }
  }

  /**
   * 检查消息是否重复
   */
  private isDuplicate(messageId: string): boolean {
    return this.processedMessages.has(messageId);
  }

  /**
   * 标记消息已处理
   */
  private markProcessed(messageId: string): void {
    this.processedMessages.add(messageId);

    // 限制去重集合大小
    if (this.processedMessages.size > this.maxDedupSize) {
      const iterator = this.processedMessages.values();
      const first = iterator.next().value;
      if (first) {
        this.processedMessages.delete(first);
      }
    }
  }

  // ============ 卡片回调处理 ============

  /**
   * 处理切换会话回调
   */
  private async handleSwitchSessionCallback(
    event: CardCallbackEvent
  ): Promise<CardCallbackResponse> {
    const sessionId = event.data.selected?.[0];
    if (!sessionId) {
      return { config: { disable_quick_action: false } };
    }

    // 获取适配器
    const workingDir = await this.projectManager.getCurrentWorkingDir();
    const session = this.sessionManager.getOrCreate(
      event.openId,
      this.defaultAdapterType,
      workingDir
    );

    const adapter = this.getAdapter(session.cliType);
    if (adapter) {
      const success = await adapter.switchSession(sessionId, workingDir);
      if (success) {
        this.sessionManager.clearHistory(event.openId);
      }
    }

    return {
      config: {
        disable_quick_action: false,
        update_multi: true,
      },
      response: {
        toast: {
          type: 'success',
          content: '会话已切换',
        },
      },
    };
  }

  /**
   * 处理切换项目回调
   */
  private async handleSwitchProjectCallback(
    event: CardCallbackEvent
  ): Promise<CardCallbackResponse> {
    const projectId = event.data.selected?.[0];
    if (!projectId) {
      return { config: { disable_quick_action: false } };
    }

    await this.projectManager.switchProject(projectId);

    return {
      config: {
        disable_quick_action: false,
        update_multi: true,
      },
      response: {
        toast: {
          type: 'success',
          content: '项目已切换',
        },
      },
    };
  }

  /**
   * 处理删除会话回调
   */
  private async handleDeleteSessionCallback(
    event: CardCallbackEvent
  ): Promise<CardCallbackResponse> {
    // TODO: 实现删除会话逻辑
    return {
      config: { disable_quick_action: false },
      response: {
        toast: {
          type: 'info',
          content: '删除会话功能开发中',
        },
      },
    };
  }

  /**
   * 处理删除项目回调
   */
  private async handleDeleteProjectCallback(
    event: CardCallbackEvent
  ): Promise<CardCallbackResponse> {
    // TODO: 实现删除项目逻辑
    return {
      config: { disable_quick_action: false },
      response: {
        toast: {
          type: 'info',
          content: '删除项目功能开发中',
        },
      },
    };
  }
}

/**
 * 创建消息处理器实例
 */
export function createMessageProcessor(
  options: MessageProcessorOptions
): MessageProcessor {
  return new MessageProcessor(options);
}

// 导出子模块
export { MessageRouter } from './router.js';
export { AIProcessor } from './ai-processor.js';
export { CommandProcessor } from './command-processor.js';
export { AttachmentProcessor } from './attachment-processor.js';
export type { RouteResult, RouteType } from './router.js';
export type { ProcessedAttachment } from './attachment-processor.js';
