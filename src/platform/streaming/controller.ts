/**
 * StreamingCardController - 流式卡片状态机
 *
 * 管理流式消息卡片的完整生命周期：
 * idle → creating → streaming → completed
 *                    ↓
 *               aborted (on /stop or error)
 *
 * 职责：
 * 1. 状态机管理 - 维护当前阶段，执行状态转换
 * 2. 卡片协调 - 创建、更新、完成卡片
 * 3. 内容聚合 - 管理文本和推理内容的累积
 * 4. 刷新调度 - 通过 FlushController 控制更新频率
 */

import { FlushController } from './flush-controller.js';
import type { StreamingPhase, StreamingConfig } from './types.js';
import type { TokenStats } from '../../core/types/stream.js';
import { buildStreamingCard, buildStreamingCompleteCard, buildStoppedCard } from '../cards/streaming.js';
import { buildErrorCard } from '../cards/error.js';

/**
 * 流式卡片控制器选项
 */
export interface StreamingCardControllerOptions {
  /** 飞书 API 实例 */
  feishuAPI: FeishuAPICardMethods;
  /** 聊天 ID */
  chatId: string;
  /** 回复的消息 ID（可选） */
  replyToMessageId?: string;
  /** 卡片配置 */
  config: StreamingConfig;
  /** 是否使用 CardKit（true）或 IM Patch（false） */
  useCardKit: boolean;
  /** 开始时间戳 */
  startTime?: number;
}

/**
 * Feishu API 卡片方法接口（最小化依赖）
 */
export interface FeishuAPICardMethods {
  sendCard: (chatId: string, card: object, replyTo?: string) => Promise<{ message_id: string }>;
  updateCard: (messageId: string, card: object) => Promise<void>;
}

/**
 * 文本状态
 */
interface TextState {
  content: string;
  length: number;
  lastUpdateLength: number;
}

/**
 * 推理状态
 */
interface ReasoningState {
  content: string;
  length: number;
}

/**
 * CardKit 状态
 */
interface CardKitState {
  messageId: string | null;
  cardId: string | null;
}

/**
 * 流式卡片控制器
 */
export class StreamingCardController {
  // 当前阶段
  private phase: StreamingPhase = 'idle';

  // 依赖
  private readonly api: FeishuAPICardMethods;
  private readonly chatId: string;
  private readonly replyToMessageId?: string;
  private readonly config: StreamingConfig;
  private readonly useCardKit: boolean;
  private readonly startTime: number;

  // 状态
  private textState: TextState;
  private reasoningState: ReasoningState;
  private cardKitState: CardKitState;

  // 控制器
  private flushController: FlushController;

  // 元数据
  private model: string = '';
  private error: string | null = null;
  private abortReason: 'user' | 'error' | null = null;

  constructor(options: StreamingCardControllerOptions) {
    this.api = options.feishuAPI;
    this.chatId = options.chatId;
    this.replyToMessageId = options.replyToMessageId;
    this.config = options.config;
    this.useCardKit = options.useCardKit;
    this.startTime = options.startTime || Date.now();

    // 初始化状态
    this.textState = {
      content: '',
      length: 0,
      lastUpdateLength: 0,
    };

    this.reasoningState = {
      content: '',
      length: 0,
    };

    this.cardKitState = {
      messageId: null,
      cardId: null,
    };

    // 初始化 FlushController
    this.flushController = new FlushController(
      () => this.performFlush(),
      this.config.longGapThreshold
    );
  }

  // ==================== Public API ====================

  /**
   * 获取当前阶段
   */
  getPhase(): StreamingPhase {
    return this.phase;
  }

  /**
   * 是否已完成（正常完成或中断）
   */
  isFinished(): boolean {
    return this.phase === 'completed' || this.phase === 'aborted';
  }

  /**
   * 接收内容块
   */
  async onContent(text: string): Promise<void> {
    if (this.phase === 'idle') {
      await this.transition('creating');
    }

    if (this.phase !== 'creating' && this.phase !== 'streaming') {
      return;
    }

    if (this.phase === 'creating') {
      await this.transition('streaming');
    }

    // 追加内容
    this.textState.content += text;
    this.textState.length += text.length;

    // 触发节流更新
    const interval = this.useCardKit
      ? this.config.cardKitInterval
      : this.config.imPatchInterval;

    await this.flushController.throttledUpdate(interval);
  }

  /**
   * 接收推理内容
   */
  async onReasoning(text: string): Promise<void> {
    if (this.phase === 'idle') {
      await this.transition('creating');
    }

    if (this.phase !== 'creating' && this.phase !== 'streaming') {
      return;
    }

    if (this.phase === 'creating') {
      await this.transition('streaming');
    }

    // 追加推理内容
    this.reasoningState.content += text;
    this.reasoningState.length += text.length;

    // 触发节流更新
    const interval = this.useCardKit
      ? this.config.cardKitInterval
      : this.config.imPatchInterval;

    await this.flushController.throttledUpdate(interval);
  }

  /**
   * 标记正常完成
   */
  async onComplete(stats: TokenStats, model: string): Promise<void> {
    if (this.phase === 'completed' || this.phase === 'aborted') {
      return;
    }

    this.model = model;

    // 等待所有待刷新内容
    await this.flushController.waitForFlush();
    this.flushController.complete();

    // 发送最终卡片
    await this.sendCompleteCard(stats);

    await this.transition('completed');
  }

  /**
   * 标记错误完成
   */
  async onError(errorMessage: string): Promise<void> {
    if (this.phase === 'completed' || this.phase === 'aborted') {
      return;
    }

    this.error = errorMessage;
    this.abortReason = 'error';

    // 取消待刷新内容
    this.flushController.cancelPendingFlush();
    this.flushController.complete();

    // 发送错误卡片
    await this.sendErrorCard(errorMessage);

    await this.transition('aborted');
  }

  /**
   * 用户停止生成
   */
  async markStopped(): Promise<void> {
    if (this.phase === 'completed' || this.phase === 'aborted') {
      return;
    }

    this.abortReason = 'user';

    // 等待所有待刷新内容
    await this.flushController.waitForFlush();
    this.flushController.complete();

    // 发送停止卡片
    await this.sendStoppedCard();

    await this.transition('aborted');
  }

  /**
   * 强制刷新（用于长间隔检测）
   */
  async forceFlush(): Promise<void> {
    if (this.phase === 'streaming') {
      await this.flushController.waitForFlush();
    }
  }

  // ==================== State Machine ====================

  /**
   * 状态转换
   */
  private async transition(to: StreamingPhase): Promise<void> {
    const from = this.phase;

    // 验证转换是否有效
    if (!this.isValidTransition(from, to)) {
      throw new Error(`Invalid state transition: ${from} -> ${to}`);
    }

    this.phase = to;

    // 执行进入状态的动作
    switch (to) {
      case 'creating':
        await this.ensureCardCreated();
        break;
      case 'streaming':
        // 已在 onContent/onReasoning 中处理
        break;
      case 'completed':
      case 'aborted':
        // 清理工作
        break;
    }
  }

  /**
   * 验证状态转换
   */
  private isValidTransition(from: StreamingPhase, to: StreamingPhase): boolean {
    const validTransitions: Record<StreamingPhase, StreamingPhase[]> = {
      idle: ['creating', 'aborted'],
      creating: ['streaming', 'completed', 'aborted'],
      streaming: ['completed', 'aborted'],
      completed: [],
      aborted: [],
    };

    return validTransitions[from].includes(to);
  }

  // ==================== Card Operations ====================

  /**
   * 确保卡片已创建
   */
  private async ensureCardCreated(): Promise<void> {
    if (this.cardKitState.messageId) {
      return;
    }

    try {
      const card = buildStreamingCard('', '', 'generating');
      const result = await this.api.sendCard(this.chatId, card, this.replyToMessageId);
      this.cardKitState.messageId = result.message_id;
    } catch (error) {
      throw new Error(`Failed to create card: ${error}`);
    }
  }

  /**
   * 执行刷新（由 FlushController 调用）
   */
  private async performFlush(): Promise<void> {
    if (!this.cardKitState.messageId) {
      return;
    }

    // 检查是否有新内容需要更新
    if (this.textState.length === this.textState.lastUpdateLength &&
        this.phase !== 'creating') {
      return;
    }

    const card = buildStreamingCard(
      this.textState.content,
      this.reasoningState.content,
      'generating'
    );

    try {
      await this.api.updateCard(this.cardKitState.messageId, card);
      this.textState.lastUpdateLength = this.textState.length;
    } catch (error) {
      // 更新失败，下次重试
      throw error;
    }
  }

  /**
   * 发送完成卡片
   */
  private async sendCompleteCard(stats: TokenStats): Promise<void> {
    const elapsedMs = Date.now() - this.startTime;
    const card = buildStreamingCompleteCard(
      this.textState.content,
      this.reasoningState.content,
      stats,
      this.model,
      elapsedMs
    );

    if (this.cardKitState.messageId) {
      await this.api.updateCard(this.cardKitState.messageId, card);
    } else {
      // 如果没有卡片（快速完成），新建一个
      await this.api.sendCard(this.chatId, card, this.replyToMessageId);
    }
  }

  /**
   * 发送停止卡片
   */
  private async sendStoppedCard(): Promise<void> {
    const card = buildStoppedCard(
      this.textState.content,
      this.reasoningState.content
    );

    if (this.cardKitState.messageId) {
      await this.api.updateCard(this.cardKitState.messageId, card);
    } else {
      await this.api.sendCard(this.chatId, card, this.replyToMessageId);
    }
  }

  /**
   * 发送错误卡片
   */
  private async sendErrorCard(message: string): Promise<void> {
    const card = buildErrorCard(message, 'default');

    if (this.cardKitState.messageId) {
      await this.api.updateCard(this.cardKitState.messageId, card);
    } else {
      await this.api.sendCard(this.chatId, card, this.replyToMessageId);
    }
  }

  // ==================== Debug/Info ====================

  /**
   * 获取当前状态摘要（用于调试）
   */
  getStatus(): {
    phase: StreamingPhase;
    contentLength: number;
    reasoningLength: number;
    hasMessageId: boolean;
    elapsedMs: number;
  } {
    return {
      phase: this.phase,
      contentLength: this.textState.length,
      reasoningLength: this.reasoningState.length,
      hasMessageId: !!this.cardKitState.messageId,
      elapsedMs: Date.now() - this.startTime,
    };
  }
}
