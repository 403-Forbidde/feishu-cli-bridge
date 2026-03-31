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

  // 待处理的重命名会话（用户点击改名按钮后等待输入新名称）
  private pendingRenameSession: { userId: string; sessionId: string; currentTitle?: string } | null = null;

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

    // 2. 检查是否有待处理的重命名操作
    if (this.pendingRenameSession && this.pendingRenameSession.userId === message.senderId) {
      const newTitle = message.content.trim();
      if (newTitle) {
        await this.handleRenameInput(message);
        return;
      }
    }

    // 3. 日志记录
    logger.info(
      {
        messageId: message.messageId,
        sender: message.senderName,
        chatType: message.chatType,
        contentPreview: message.content.substring(0, 100),
      },
      '收到消息'
    );

    // 4. 路由消息
    const route = this.router.route(message.content);

    // 5. 根据路由结果分发处理
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
    // 从 raw 中获取完整的 action value（包含按钮点击的所有数据）
    const rawEvent = event.raw as {
      action?: { value?: Record<string, unknown> };
    } | undefined;
    const actionValue = rawEvent?.action?.value || {};
    const action = event.data.action as string | undefined;

    logger.info(
      {
        userId: event.openId,
        action,
        actionValue,
        rawKeys: Object.keys(event.raw || {}),
      },
      '收到卡片回调'
    );

    switch (action) {
      case 'switch_session':
        return this.handleSwitchSessionCallback(event, actionValue);

      case 'rename_session':
      case 'rename_session_prompt':
        return this.handleRenameSessionCallback(event, actionValue);

      case 'delete_session':
      case 'delete_session_confirmed':
        return this.handleDeleteSessionCallback(event, actionValue);

      case 'delete_session_confirm':
        // 进入删除确认状态 - 刷新卡片显示确认按钮
        return this.handleDeleteSessionConfirmCallback(event, actionValue);

      case 'delete_session_cancel':
        // 取消删除 - 刷新卡片
        return this.handleSessionPageCallback(event, { page: 1 });

      case 'create_new_session':
        return this.handleCreateNewSessionCallback(event, actionValue);

      case 'session_page':
        return this.handleSessionPageCallback(event, actionValue);

      case 'switch_project':
        return this.handleSwitchProjectCallback(event);

      case 'delete_project':
        return this.handleDeleteProjectCallback(event);

      default:
        logger.warn({ action }, '未知的卡片回调动作');
        return {};
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
   * 处理重命名输入
   */
  private async handleRenameInput(message: FeishuMessage): Promise<void> {
    if (!this.pendingRenameSession) return;

    const { sessionId } = this.pendingRenameSession;
    const newTitle = message.content.trim();

    // 清除待处理状态
    this.pendingRenameSession = null;

    if (!newTitle) {
      await this.feishuAPI.sendText(message.chatId, '❌ 名称不能为空');
      return;
    }

    // 获取适配器并执行重命名
    const workingDir = await this.projectManager.getCurrentWorkingDir();
    const adapter = this.getAdapter(this.defaultAdapterType);
    if (!adapter) {
      await this.feishuAPI.sendText(message.chatId, '❌ 适配器不可用');
      return;
    }

    const success = await adapter.renameSession(sessionId, newTitle);
    if (success) {
      // 1. 切换到该会话
      const switchSuccess = await adapter.switchSession(sessionId, workingDir);
      if (switchSuccess) {
        this.sessionManager.clearHistory(message.senderId);
      }

      // 2. 发送成功提示（使用卡片格式）
      const { buildSessionSwitchedCard } = await import('../cards/index.js');
      const successCard = {
        schema: '2.0',
        header: {
          title: { tag: 'plain_text', content: '✅ 重命名成功' },
          template: 'green',
        },
        body: {
          elements: [
            {
              tag: 'markdown',
              content: `**会话已重命名**\n\n📋 新名称: **${newTitle}**\n🆔 会话ID: \`${sessionId.slice(-8)}\``
            }
          ]
        }
      };
      await this.feishuAPI.sendCardMessage(message.chatId, successCard);

      // 3. 显示更新后的会话列表卡片
      const cardResponse = await this.buildSessionListCardResponse(message.chatId, 1);
      if (cardResponse.card) {
        await this.feishuAPI.sendCardMessage(message.chatId, cardResponse.card);
      }
    } else {
      await this.feishuAPI.sendText(message.chatId, '❌ 重命名失败');
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
    event: CardCallbackEvent,
    actionValue: Record<string, unknown>
  ): Promise<CardCallbackResponse> {
    // 支持 sessionId (旧) 和 session_id (新卡片格式)
    const sessionId = (actionValue.sessionId ?? actionValue.session_id) as string | undefined;
    if (!sessionId) {
      logger.warn('切换会话失败: 缺少 sessionId');
      return {};
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
        // 返回刷新后的会话列表卡片
        return await this.buildSessionListCardResponse(event.chatId, 1);
      }
    }

    return {};
  }

  /**
   * 处理重命名会话回调
   */
  private async handleRenameSessionCallback(
    event: CardCallbackEvent,
    actionValue: Record<string, unknown>
  ): Promise<CardCallbackResponse> {
    const sessionId = (actionValue.session_id ?? actionValue.sessionId) as string | undefined;
    const currentTitle = (actionValue.session_title ?? actionValue.title) as string | undefined;

    if (!sessionId) {
      logger.warn('重命名会话失败: 缺少 session_id');
      return {};
    }

    // 获取适配器
    const workingDir = await this.projectManager.getCurrentWorkingDir();
    const adapter = this.getAdapter(this.defaultAdapterType);
    if (!adapter) {
      return {};
    }

    // 获取会话信息
    const allSessions = await adapter.listSessions(10, workingDir);
    const targetSession = allSessions.find(s => s.id === sessionId);

    if (!targetSession) {
      await this.feishuAPI.sendText(event.chatId, '❌ 会话不存在或已删除');
      return {};
    }

    // 使用新的改名提示卡片
    const { buildRenamePromptCard } = await import('../cards/index.js');
    const card = buildRenamePromptCard(targetSession, this.defaultAdapterType, workingDir);

    // 存储待重命名会话状态
    this.pendingRenameSession = {
      userId: event.openId,
      sessionId,
      currentTitle: targetSession.title
    };

    return { card };
  }

  /**
   * 处理删除会话回调
   */
  private async handleDeleteSessionCallback(
    event: CardCallbackEvent,
    actionValue: Record<string, unknown>
  ): Promise<CardCallbackResponse> {
    // 支持 sessionId (旧) 和 session_id (新卡片格式)
    const sessionId = (actionValue.sessionId ?? actionValue.session_id) as string | undefined;
    if (!sessionId) {
      logger.warn('删除会话失败: 缺少 sessionId');
      return {};
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
      const success = await adapter.deleteSession(sessionId);
      if (success) {
        // 返回刷新后的会话列表卡片
        return await this.buildSessionListCardResponse(event.chatId, 1);
      }
    }

    return {};
  }

  /**
   * 处理删除会话确认回调（进入确认状态）
   */
  private async handleDeleteSessionConfirmCallback(
    event: CardCallbackEvent,
    actionValue: Record<string, unknown>
  ): Promise<CardCallbackResponse> {
    const sessionId = (actionValue.session_id) as string | undefined;
    if (!sessionId) {
      logger.warn('删除会话确认失败: 缺少 session_id');
      return {};
    }

    // 返回进入删除确认状态的会话列表卡片
    return await this.buildSessionListCardResponse(event.chatId, 1, sessionId);
  }

  /**
   * 处理新建会话回调
   */
  private async handleCreateNewSessionCallback(
    event: CardCallbackEvent,
    actionValue: Record<string, unknown>
  ): Promise<CardCallbackResponse> {
    const workingDir = (actionValue.working_dir ?? await this.projectManager.getCurrentWorkingDir()) as string;
    const adapter = this.getAdapter(this.defaultAdapterType);

    if (adapter) {
      const sessionInfo = await adapter.createNewSession(workingDir);
      if (sessionInfo) {
        // 清空本地会话历史
        this.sessionManager.clearHistory(event.openId);
        // 返回刷新后的会话列表卡片
        return await this.buildSessionListCardResponse(event.chatId, 1);
      }
    }

    return {};
  }

  /**
   * 处理会话分页回调
   */
  private async handleSessionPageCallback(
    event: CardCallbackEvent,
    actionValue: Record<string, unknown>
  ): Promise<CardCallbackResponse> {
    const page = (actionValue.page as number) || 1;

    // 返回刷新后的会话列表卡片
    return await this.buildSessionListCardResponse(event.chatId, page);
  }

  /**
   * 构建会话列表卡片响应（用于回调返回）
   */
  private async buildSessionListCardResponse(
    chatId: string,
    page: number,
    deletingSessionId?: string
  ): Promise<CardCallbackResponse> {
    try {
      logger.info({ chatId, page }, '构建会话列表卡片响应');

      const workingDir = await this.projectManager.getCurrentWorkingDir();
      const adapter = this.getAdapter(this.defaultAdapterType);
      if (!adapter) {
        return {};
      }

      // 获取当前会话 ID（适配器可能未实现此方法）
      const currentSessionId = adapter.getSessionId?.(workingDir) ?? undefined;

      // 获取当前工作目录的会话（最多10条）
      const allSessions = await adapter.listSessions(10, workingDir);

      // 分页：每页5条
      const pageSize = 5;
      const totalPages = Math.ceil(allSessions.length / pageSize) || 1;
      const currentPage = Math.max(1, Math.min(page, totalPages));
      const startIndex = (currentPage - 1) * pageSize;
      const sessions = allSessions.slice(startIndex, startIndex + pageSize);

      // 构建新卡片
      const { buildSessionListCard } = await import('../cards/index.js');
      const card = buildSessionListCard(
        sessions,
        currentSessionId,
        currentPage,
        totalPages,
        this.defaultAdapterType,
        workingDir,
        deletingSessionId,
        allSessions.length
      );

      // 返回卡片数据作为回调响应
      return { card };
    } catch (error) {
      logger.error({ error, chatId, page }, '构建会话列表卡片响应失败');
      return {};
    }
  }

  /**
   * 刷新会话列表卡片
   */
  private async refreshSessionListCard(
    chatId: string,
    messageId: string,
    page: number,
    deletingSessionId?: string
  ): Promise<void> {
    try {
      logger.info({ chatId, messageId: messageId.slice(0, 8), page }, '刷新会话列表卡片');

      const workingDir = await this.projectManager.getCurrentWorkingDir();
      const adapter = this.getAdapter(this.defaultAdapterType);
      if (!adapter) return;

      // 获取当前会话 ID（适配器可能未实现此方法）
      const currentSessionId = adapter.getSessionId?.(workingDir) ?? undefined;

      // 获取当前工作目录的会话（最多10条）
      const allSessions = await adapter.listSessions(10, workingDir);

      // 分页：每页5条
      const pageSize = 5;
      const totalPages = Math.ceil(allSessions.length / pageSize) || 1;
      const currentPage = Math.max(1, Math.min(page, totalPages));
      const startIndex = (currentPage - 1) * pageSize;
      const sessions = allSessions.slice(startIndex, startIndex + pageSize);

      // 构建新卡片
      const { buildSessionListCard } = await import('../cards/index.js');
      const card = buildSessionListCard(
        sessions,
        currentSessionId,
        currentPage,
        totalPages,
        this.defaultAdapterType,
        workingDir,
        deletingSessionId,
        allSessions.length
      );

      // 更新卡片
      const success = await this.feishuAPI.updateCardMessage(messageId, card);
      logger.info({ success }, '卡片更新结果');
    } catch (error) {
      logger.error({ error, messageId: messageId.slice(0, 8) }, '刷新会话列表卡片失败');
      throw error;
    }
  }

  /**
   * 处理切换项目回调
   */
  private async handleSwitchProjectCallback(
    event: CardCallbackEvent
  ): Promise<CardCallbackResponse> {
    const projectId = event.data.selected?.[0];
    if (!projectId) {
      return {};
    }

    await this.projectManager.switchProject(projectId);

    return {};
  }

  /**
   * 处理删除项目回调
   */
  private async handleDeleteProjectCallback(
    _event: CardCallbackEvent
  ): Promise<CardCallbackResponse> {
    return {};
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
