/**
 * AI Processor
 * AI 消息处理器
 *
 * 处理 AI 对话消息，包括：
 * 1. 流式响应处理
 * 2. 停止信号控制（Issue #52）
 * 3. 附件处理集成
 * 4. 会话历史管理
 * 5. 错误处理和降级
 */

import { logger } from '../../core/logger.js';
import type { FeishuAPI } from '../feishu-api.js';
import type { FeishuMessage, Attachment } from '../types.js';
import type { ICLIAdapter } from '../../adapters/interface/types.js';
import type { SessionManager } from '../../session/manager.js';
import type { ProjectManager } from '../../project/manager.js';
import type { StreamingCardController } from '../streaming/controller.js';
import { StreamingCardController as StreamingControllerImpl } from '../streaming/controller.js';
import type { ProcessedAttachment, AttachmentProcessor } from './attachment-processor.js';
import type { StreamChunk } from '../../core/types/stream.js';
import { buildErrorCard } from '../cards/error.js';
import { StreamChunkType } from '../../core/types/stream.js';

/**
 * AI 处理器选项
 */
export interface AIProcessorOptions {
  /** 飞书 API 实例 */
  feishuAPI: FeishuAPI;
  /** 会话管理器 */
  sessionManager: SessionManager;
  /** 项目管理器 */
  projectManager: ProjectManager;
  /** 附件处理器（可选） */
  attachmentProcessor?: AttachmentProcessor;
  /** 最大提示词长度 */
  maxPromptLength?: number;
  /** 是否使用 CardKit */
  useCardKit?: boolean;
}

/**
 * 生成任务上下文
 */
interface GenerationContext {
  /** 用户 ID */
  userId: string;
  /** 聊天 ID */
  chatId: string;
  /** 消息 ID */
  messageId: string;
  /** 适配器类型 */
  adapterType: string;
  /** 工作目录 */
  workingDir: string;
  /** 提示词内容 */
  prompt: string;
  /** 会话历史 */
  history: import('../../adapters/interface/types.js').Message[];
  /** 处理后的附件 */
  attachments: ProcessedAttachment[];
}

/**
 * AI 处理器
 *
 * 处理 AI 对话消息，协调流式响应和停止控制
 */
export class AIProcessor {
  private feishuAPI: FeishuAPI;
  private sessionManager: SessionManager;
  private projectManager: ProjectManager;
  private attachmentProcessor?: AttachmentProcessor;
  private maxPromptLength: number;
  private useCardKit: boolean;

  // 停止信号控制（Issue #52）
  private abortControllers: Map<string, AbortController> = new Map();

  constructor(options: AIProcessorOptions) {
    this.feishuAPI = options.feishuAPI;
    this.sessionManager = options.sessionManager;
    this.projectManager = options.projectManager;
    this.attachmentProcessor = options.attachmentProcessor;
    this.maxPromptLength = options.maxPromptLength ?? 100_000;
    this.useCardKit = options.useCardKit ?? true;
  }

  /**
   * 处理 AI 消息
   * @param message - 飞书消息
   * @param adapter - CLI 适配器
   * @param adapterType - 适配器类型
   */
  async process(
    message: FeishuMessage,
    adapter: ICLIAdapter,
    adapterType: string
  ): Promise<void> {
    const startTime = Date.now();
    let typingReactionId: string | null = null;

    try {
      // 1. 验证输入长度
      if (message.content.length > this.maxPromptLength) {
        await this.sendLengthError(message.chatId, message.content.length);
        return;
      }

      // 2. 获取或创建会话
      const workingDir = await this.projectManager.getCurrentWorkingDir();
      const session = this.sessionManager.getOrCreate(
        message.senderId,
        adapterType,
        workingDir
      );

      // 3. 处理附件（如果有）
      let processedAttachments: ProcessedAttachment[] = [];
      if (message.attachments && message.attachments.length > 0 && this.attachmentProcessor) {
        processedAttachments = await this.attachmentProcessor.processAttachments(
          message.messageId,
          message.attachments
        );
      }

      // 4. 构建提示词（包含附件描述）
      const prompt = this.buildPrompt(message.content, processedAttachments);

      // 5. 添加"正在输入"表情
      typingReactionId = await this.feishuAPI.addTypingReaction(message.messageId);

      // 6. 创建生成上下文
      const generationContext: GenerationContext = {
        userId: message.senderId,
        chatId: message.chatId,
        messageId: message.messageId,
        adapterType,
        workingDir: session.workingDir,
        prompt,
        history: session.history,
        attachments: processedAttachments,
      };

      // 7. 创建停止信号控制器
      const abortController = new AbortController();
      this.abortControllers.set(message.senderId, abortController);

      // 8. 执行流式生成
      await this.executeStreaming(
        generationContext,
        adapter,
        abortController,
        startTime
      );

    } catch (error) {
      logger.error({ error, messageId: message.messageId }, '处理 AI 消息时出错');
      await this.handleError(message.chatId, error);
    } finally {
      // 清理
      this.abortControllers.delete(message.senderId);
      if (typingReactionId) {
        await this.feishuAPI.removeTypingReaction(message.messageId, typingReactionId);
      }
    }
  }

  /**
   * 执行流式生成
   */
  private async executeStreaming(
    context: GenerationContext,
    adapter: ICLIAdapter,
    abortController: AbortController,
    startTime: number
  ): Promise<void> {
    // 创建流式卡片控制器
    const streamingController = new StreamingControllerImpl({
      feishuAPI: {
        // CardKit 2.0 API
        createCardEntity: async (card: unknown) => {
          return await this.feishuAPI.createCardEntity(card);
        },
        sendCardByCardId: async (chatId: string, cardId: string, replyTo?: string) => {
          const result = await this.feishuAPI.sendCardByCardId(chatId, cardId, replyTo);
          return { messageId: result.messageId };
        },
        streamCardContent: async (cardId: string, elementId: string, content: string, sequence: number) => {
          return await this.feishuAPI.streamCardContent(cardId, elementId, content, sequence);
        },
        updateCardKitCard: async (cardId: string, card: unknown, sequence: number) => {
          return await this.feishuAPI.updateCardKitCard(cardId, card, sequence);
        },
        setCardStreamingMode: async (cardId: string, streamingMode: boolean, sequence: number) => {
          return await this.feishuAPI.setCardStreamingMode(cardId, streamingMode, sequence);
        },
        // IM Patch 降级 API
        updateCardMessage: async (messageId: string, card: unknown) => {
          return await this.feishuAPI.updateCardMessage(messageId, card);
        },
        sendCardMessage: async (chatId: string, card: unknown, replyTo?: string) => {
          return await this.feishuAPI.sendCardMessage(chatId, card, replyTo);
        },
      },
      chatId: context.chatId,
      replyToMessageId: context.messageId,
      config: {
        cardKitInterval: this.useCardKit ? 100 : 1500,
        imPatchInterval: this.useCardKit ? 100 : 1500,
        longGapThreshold: 2000,
        maxMessageLength: 8000,
      },
      useCardKit: this.useCardKit,
      startTime,
    });

    let fullContent = '';
    let isStopped = false;

    try {
      // 执行流式调用
      const stream = adapter.executeStream(
        context.prompt,
        context.history,
        context.workingDir,
        context.attachments
      );

      for await (const chunk of stream) {
        // 检查停止信号
        if (abortController.signal.aborted) {
          isStopped = true;
          logger.info({ userId: context.userId }, '生成被用户停止');

          // 通知适配器停止生成
          await adapter.stopGeneration();
          break;
        }

        // 处理流块
        await this.processStreamChunk(chunk, streamingController);

        // 累积内容
        if (chunk.type === StreamChunkType.CONTENT) {
          fullContent += chunk.data;
        }
      }

      // 标记流已完全完成
      streamingController.markFullyComplete();

      // 诊断日志：记录最终的 fullContent
      logger.debug({
        fullContentLength: fullContent.length,
        fullContentPreview: fullContent.substring(0, 200).replace(/\n/g, '\\n'),
      }, 'Stream ended, fullContent captured');

      // 标记完成
      if (isStopped) {
        await streamingController.markStopped();
      } else {
        // 正常完成 - 使用 fullContent 作为最终文本（清理推理标签）
        const { stripReasoningTags } = await import('../cards/utils.js');
        const cleanedContent = stripReasoningTags(fullContent);

        // 先调用 onDeliver 设置 completedText
        await streamingController.onDeliver(cleanedContent);

        // 然后调用 onComplete
        await streamingController.onComplete(
          adapter.getStats(context.history, fullContent),
          adapter.getCurrentModel()
        );

        // 保存到会话历史
        this.sessionManager.addMessage(context.userId, 'user', context.prompt);
        this.sessionManager.addMessage(context.userId, 'assistant', cleanedContent);
      }

    } catch (error) {
      logger.error({ error, userId: context.userId }, '流式生成出错');

      // 通知控制器出错（将状态从 idle/creating/streaming 转为 aborted）
      await streamingController.onError(
        error instanceof Error ? error.message : '生成过程中发生错误'
      );

      throw error;
    }
  }

  /**
   * 处理单个流块
   */
  private async processStreamChunk(
    chunk: StreamChunk,
    controller: StreamingCardController
  ): Promise<void> {
    // 诊断日志：记录每个 chunk 的类型和内容预览
    if (chunk.type === StreamChunkType.CONTENT || chunk.type === StreamChunkType.REASONING || chunk.type === StreamChunkType.DELIVER) {
      const preview = chunk.data.substring(0, 100).replace(/\n/g, '\\n');
      logger.debug({ type: chunk.type, preview, length: chunk.data.length }, 'Processing stream chunk');
    }

    switch (chunk.type) {
      case StreamChunkType.CONTENT:
        await controller.onContent(chunk.data);
        break;

      case StreamChunkType.REASONING:
        await controller.onReasoning(chunk.data);
        break;

      case StreamChunkType.DELIVER:
        // 完整内容传递，用于构建最终卡片
        await controller.onDeliver(chunk.data);
        break;

      case StreamChunkType.ERROR:
        logger.error({ error: chunk.data }, '流式响应错误');
        await controller.onError(chunk.data);
        break;

      case StreamChunkType.DONE:
        // 流结束，无需处理
        break;

      default:
        logger.warn({ chunk }, '未知的流块类型');
    }
  }

  /**
   * 停止指定用户的生成
   * @param userId - 用户 ID
   * @returns 是否成功发送停止信号
   */
  stopGeneration(userId: string): boolean {
    const controller = this.abortControllers.get(userId);
    if (controller) {
      controller.abort();
      logger.info({ userId }, '已发送停止信号');
      return true;
    }
    return false;
  }

  /**
   * 检查用户是否有正在进行的生成
   * @param userId - 用户 ID
   */
  hasActiveGeneration(userId: string): boolean {
    return this.abortControllers.has(userId);
  }

  /**
   * 构建提示词（包含附件描述）
   */
  private buildPrompt(content: string, attachments: ProcessedAttachment[]): string {
    if (attachments.length === 0) {
      return content;
    }

    const parts: string[] = [content];

    // 添加图片数据
    for (const att of attachments) {
      if (att.dataUrl) {
        parts.push(`\n\n[图片: ${att.filename}]\n${att.dataUrl}`);
      }
    }

    return parts.join('');
  }

  /**
   * 发送长度错误提示
   */
  private async sendLengthError(chatId: string, length: number): Promise<void> {
    await this.feishuAPI.sendText(
      chatId,
      `⚠️ 消息过长（${length} 字符），最大支持 ${this.maxPromptLength} 字符`
    );
  }

  /**
   * 处理错误
   */
  private async handleError(chatId: string, error: unknown): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : '未知错误';

    const errorCard = buildErrorCard(errorMessage, 'processing_error');
    await this.feishuAPI.sendCardMessage(chatId, errorCard);
  }
}

/**
 * 创建 AI 处理器实例
 */
export function createAIProcessor(options: AIProcessorOptions): AIProcessor {
  return new AIProcessor(options);
}
