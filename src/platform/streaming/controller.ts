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
 *
 * 参考 OpenClaw 实现，支持 CardKit 2.0 流式 API
 */

import { FlushController, THROTTLE_CONSTANTS } from './flush-controller.js';
import type { StreamingPhase, StreamingConfig } from './types.js';
import type { TokenStats } from '../../core/types/stream.js';
import { buildStreamingCompleteCard, buildStoppedCard } from '../cards/streaming.js';
import { buildErrorCard } from '../cards/error.js';
import { optimizeMarkdownStyle, stripReasoningTags } from '../cards/utils.js';
import { logger } from '../../core/logger.js';

/**
 * CardKit 2.0 流式卡片初始结构
 * 配置打字机效果参数以获得最佳流式体验
 * 注意: print_frequency_ms 和 print_step 必须是对象格式，支持分端配置
 */
const STREAMING_THINKING_CARD = {
  schema: '2.0',
  config: {
    streaming_mode: true,
    streaming_config: {
      print_frequency_ms: {
        default: 70,  // 默认打字机速度 70ms/字符
        android: 70,
        ios: 70,
        pc: 70,
      },
      print_step: {
        default: 3,  // 每次显示 3 个字符（更流畅）
        android: 3,
        ios: 3,
        pc: 3,
      },
      print_strategy: 'fast',  // 未完成的内容立即上屏
    },
    summary: { content: '思考中...' },
  },
  body: {
    elements: [
      {
        tag: 'markdown',
        content: '',
        text_align: 'left',
        text_size: 'normal_v2',
        margin: '0px 0px 0px 0px',
        element_id: 'streaming_content',
      },
      {
        tag: 'markdown',
        content: ' ',
        icon: {
          tag: 'custom_icon',
          img_key: 'img_v3_02vb_496bec09-4b43-4773-ad6b-0cdd103cd2bg',
          size: '16px 16px',
        },
        element_id: 'loading_icon',
      },
    ],
  },
};

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
  /** 创建 CardKit 卡片实体 */
  createCardEntity(card: unknown): Promise<string | null>;
  /** 通过 card_id 发送卡片消息 */
  sendCardByCardId(chatId: string, cardId: string, replyTo?: string): Promise<{ messageId: string }>;
  /** 流式更新卡片内容（CardKit API） */
  streamCardContent(cardId: string, elementId: string, content: string, sequence: number): Promise<boolean>;
  /** 更新 CardKit 卡片（终态） */
  updateCardKitCard(cardId: string, card: unknown, sequence: number): Promise<boolean>;
  /** 关闭卡片流式模式 */
  setCardStreamingMode(cardId: string, streamingMode: boolean, sequence: number): Promise<boolean>;
  /** IM Patch 方式更新卡片（降级方案） */
  updateCardMessage(messageId: string, card: unknown): Promise<boolean>;
  /** IM 方式发送卡片（降级方案） */
  sendCardMessage(chatId: string, card: unknown, replyTo?: string): Promise<string>;
}

/**
 * 文本状态
 */
interface TextState {
  /** 累积的流式文本 */
  accumulatedText: string;
  /** 最终完成的文本（包含多轮） */
  completedText: string;
  /** 历史回复前缀（用于多轮对话） */
  streamingPrefix: string;
  /** 上一帧的部分文本（用于检测新回复开始） */
  lastPartialText: string;
}

/**
 * 推理状态
 */
interface ReasoningState {
  /** 累积的推理文本 */
  accumulatedText: string;
  /** 推理开始时间 */
  startTime: number | null;
  /** 推理耗时（毫秒） */
  elapsedMs: number;
  /** 是否处于推理阶段 */
  isReasoningPhase: boolean;
}

/**
 * CardKit 状态
 */
interface CardKitState {
  /** CardKit 卡片 ID */
  cardId: string | null;
  /** 原始 CardKit 卡片 ID（用于终态更新） */
  originalCardId: string | null;
  /** 序列号（用于 CardKit API） */
  sequence: number;
  /** IM 消息 ID */
  messageId: string | null;
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
  private dispatchFullyComplete = false;

  constructor(options: StreamingCardControllerOptions) {
    this.api = options.feishuAPI;
    this.chatId = options.chatId;
    this.replyToMessageId = options.replyToMessageId;
    this.config = options.config;
    this.useCardKit = options.useCardKit;
    this.startTime = options.startTime || Date.now();

    // 初始化状态
    this.textState = {
      accumulatedText: '',
      completedText: '',
      streamingPrefix: '',
      lastPartialText: '',
    };

    this.reasoningState = {
      accumulatedText: '',
      startTime: null,
      elapsedMs: 0,
      isReasoningPhase: false,
    };

    this.cardKitState = {
      cardId: null,
      originalCardId: null,
      sequence: 0,
      messageId: null,
    };

    // 初始化 FlushController
    this.flushController = new FlushController(() => this.performFlush());
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
   * 接收内容块（来自 AI 生成的增量文本）
   */
  async onContent(text: string): Promise<void> {
    if (!this.shouldProceed()) return;

    // 确保卡片已创建
    await this.ensureCardCreated();
    if (!this.shouldProceed()) return;

    // 累积文本（增量追加）
    // 注意：这里接收的是 SSE 解析器返回的增量内容，不是完整内容
    // 关键修复：剥离可能嵌入的推理标签，避免推理内容泄漏到主输出
    this.textState.accumulatedText += stripReasoningTags(text);
    this.textState.lastPartialText = text;

    // 退出推理阶段（如果有内容生成）
    if (this.reasoningState.isReasoningPhase) {
      this.reasoningState.isReasoningPhase = false;
      if (this.reasoningState.startTime) {
        this.reasoningState.elapsedMs = Date.now() - this.reasoningState.startTime;
      }
    }

    await this.throttledCardUpdate();
  }

  /**
   * 接收推理内容
   */
  async onReasoning(text: string): Promise<void> {
    if (!this.shouldProceed()) return;

    // 确保卡片已创建
    await this.ensureCardCreated();
    if (!this.shouldProceed()) return;

    if (!this.reasoningState.startTime) {
      this.reasoningState.startTime = Date.now();
    }

    this.reasoningState.isReasoningPhase = true;
    this.reasoningState.accumulatedText += text;

    await this.throttledCardUpdate();
  }

  /**
   * 接收 deliver 回调文本（来自 SDK 的完整文本）
   * 用于构建权威的 completedText
   */
  async onDeliver(text: string): Promise<void> {
    if (!this.shouldProceed()) return;
    if (!text.trim()) return;

    await this.ensureCardCreated();
    if (!this.shouldProceed()) return;

    // 纯推理内容（没有答案文本）
    if (this.reasoningState.isReasoningPhase && !this.textState.accumulatedText) {
      this.reasoningState.elapsedMs = this.reasoningState.startTime
        ? Date.now() - this.reasoningState.startTime
        : 0;
      await this.throttledCardUpdate();
      return;
    }

    // 答案内容（可能包含内联推理标签）
    this.reasoningState.isReasoningPhase = false;

    // 累积 deliver 文本用于最终卡片（同样需要剥离推理标签）
    this.textState.completedText += (this.textState.completedText ? '\n\n' : '') + stripReasoningTags(text);

    // 没有流式数据时，用 deliver 文本显示在卡片上
    if (!this.textState.lastPartialText && !this.textState.streamingPrefix) {
      this.textState.accumulatedText += (this.textState.accumulatedText ? '\n\n' : '') + text;
      this.textState.streamingPrefix = this.textState.accumulatedText;
      await this.throttledCardUpdate();
    }
  }

  /**
   * 标记正常完成
   */
  async onComplete(stats: TokenStats, model: string): Promise<void> {
    if (this.phase === 'completed' || this.phase === 'aborted') {
      return;
    }

    this.model = model;
    this.dispatchFullyComplete = true;

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

    // 等待当前刷新完成
    await this.flushController.waitForFlush();

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
    this.dispatchFullyComplete = true;

    // 等待所有待刷新内容
    await this.flushController.waitForFlush();
    this.flushController.complete();

    // 发送停止卡片
    await this.sendStoppedCard();

    await this.transition('aborted');
  }

  /**
   * 标记完全完成（由外部调用，表示生成任务结束）
   */
  markFullyComplete(): void {
    this.dispatchFullyComplete = true;
  }

  /**
   * 强制刷新（用于长间隔检测）
   */
  async forceFlush(): Promise<void> {
    if (this.phase === 'streaming') {
      await this.flushController.waitForFlush();
    }
  }

  // ==================== Internal Helpers ====================

  /**
   * 检查是否应该继续处理
   */
  private shouldProceed(): boolean {
    return !this.isFinished();
  }

  /**
   * 节流卡片更新
   */
  private async throttledCardUpdate(): Promise<void> {
    if (!this.cardKitState.messageId) return;

    const throttleMs = this.cardKitState.cardId
      ? THROTTLE_CONSTANTS.CARDKIT_MS
      : THROTTLE_CONSTANTS.PATCH_MS;

    await this.flushController.throttledUpdate(throttleMs);
  }

  // ==================== State Machine ====================

  /**
   * 状态转换
   */
  private async transition(to: StreamingPhase): Promise<boolean> {
    const from = this.phase;

    if (from === to) return false;

    // 验证转换是否有效
    const validTransitions: Record<StreamingPhase, StreamingPhase[]> = {
      idle: ['creating', 'completed', 'aborted'],
      creating: ['streaming', 'completed', 'aborted', 'creation_failed'],
      streaming: ['completed', 'aborted'],
      completed: [],
      aborted: [],
      creation_failed: [],
    };

    if (!validTransitions[from].includes(to)) {
      console.warn(`Invalid state transition: ${from} -> ${to}`);
      return false;
    }

    this.phase = to;

    // 进入终态时的清理工作
    if (to === 'completed' || to === 'aborted' || to === 'creation_failed') {
      this.flushController.cancelPendingFlush();
      this.flushController.complete();
    }

    return true;
  }

  // ==================== Card Operations ====================

  /**
   * 确保卡片已创建
   */
  private async ensureCardCreated(): Promise<void> {
    if (this.cardKitState.messageId || this.phase === 'creation_failed' || this.isFinished()) {
      return;
    }

    if (!await this.transition('creating')) {
      return;
    }

    try {
      if (this.useCardKit) {
        // CardKit 2.0 流程
        // Step 1: 创建卡片实体
        const cardId = await this.api.createCardEntity(STREAMING_THINKING_CARD);

        if (cardId) {
          this.cardKitState.cardId = cardId;
          this.cardKitState.originalCardId = cardId;
          this.cardKitState.sequence = 1;

          // Step 2: 通过 card_id 发送消息
          const result = await this.api.sendCardByCardId(this.chatId, cardId, this.replyToMessageId);
          this.cardKitState.messageId = result.messageId;

          // 标记卡片已准备好接收更新
          this.flushController.setCardMessageReady(true);

          await this.transition('streaming');
        } else {
          throw new Error('Failed to create CardKit entity');
        }
      } else {
        // IM Patch 降级流程
        const { buildStreamingCard } = await import('../cards/streaming.js');
        const card = buildStreamingCard('', '', 0, 'generating');
        const messageId = await this.api.sendCardMessage(this.chatId, card, this.replyToMessageId);

        this.cardKitState.messageId = messageId;
        this.flushController.setCardMessageReady(true);

        await this.transition('streaming');
      }
    } catch (error) {
      console.warn('Failed to create streaming card, falling back to IM:', error);

      // 降级到 IM Patch
      try {
        const { buildStreamingCard } = await import('../cards/streaming.js');
        const card = buildStreamingCard('', '', 0, 'generating');
        const messageId = await this.api.sendCardMessage(this.chatId, card, this.replyToMessageId);

        this.cardKitState.messageId = messageId;
        this.flushController.setCardMessageReady(true);

        await this.transition('streaming');
      } catch (fallbackError) {
        console.error('IM fallback also failed:', fallbackError);
        await this.transition('creation_failed');
      }
    }
  }

  /**
   * 执行刷新（由 FlushController 调用）
   */
  private async performFlush(): Promise<void> {
    if (!this.cardKitState.messageId || this.isFinished()) {
      return;
    }

    // CardKit 流式模式已禁用但原始卡片 ID 仍在，跳过中间态更新
    if (!this.cardKitState.cardId && this.cardKitState.originalCardId) {
      return;
    }

    try {
      const displayText = this.buildDisplayText();

      // 如果内容为空，跳过本次更新
      if (!displayText || displayText.trim().length === 0) {
        return;
      }

      if (this.cardKitState.cardId) {
        // CardKit 流式更新（真正的打字机效果）
        // 注意：sequence 在调用成功后递增，避免失败时跳过编号
        const nextSequence = this.cardKitState.sequence + 1;
        const success = await this.api.streamCardContent(
          this.cardKitState.cardId,
          'streaming_content',
          displayText,
          nextSequence
        );

        if (success) {
          this.cardKitState.sequence = nextSequence;
        } else {
          // API 调用失败，记录错误但不立即降级（可能是限流）
          console.warn(`CardKit stream update failed, sequence: ${nextSequence}`);
        }
      } else {
        // IM Patch 降级方案
        const { buildStreamingCard } = await import('../cards/streaming.js');
        const card = buildStreamingCard(
          this.reasoningState.isReasoningPhase ? '' : displayText,
          this.reasoningState.isReasoningPhase ? this.reasoningState.accumulatedText : '',
          this.reasoningState.elapsedMs,
          'generating'
        );
        await this.api.updateCardMessage(this.cardKitState.messageId, card);
      }
    } catch (error) {
      // 处理限流错误
      const errorStr = String(error);
      if (errorStr.includes('230020')) {
        console.info('Rate limited (230020), skipping this update');
        return;
      }

      // body is nil 错误通常是内容为空导致
      if (errorStr.includes('body is nil')) {
        console.warn('CardKit update failed: content is empty or invalid');
        return;
      }

      console.error('Card stream update failed:', error);

      // 禁用 CardKit 流式模式，降级到 IM Patch
      if (this.cardKitState.cardId) {
        console.warn('Disabling CardKit streaming, falling back to IM patch');
        this.cardKitState.cardId = null;
      }
    }
  }

  /**
   * 构建显示文本
   * 参考 OpenClaw 实现：
   * - 推理阶段：只显示推理内容，不应用 optimizeMarkdownStyle
   * - 答案阶段：只显示答案内容，应用 optimizeMarkdownStyle
   */
  private buildDisplayText(): string {
    if (this.reasoningState.isReasoningPhase && this.reasoningState.accumulatedText) {
      // 推理阶段：直接返回原始格式，不对推理内容应用 optimizeMarkdownStyle
      // 这与 OpenClaw 的 buildStreamingCard 中推理阶段处理方式一致
      return `💭 **Thinking...**\n\n${this.reasoningState.accumulatedText}`;
    }
    // 答案阶段：应用 optimizeMarkdownStyle 优化 Markdown 渲染
    return optimizeMarkdownStyle(this.textState.accumulatedText);
  }

  /**
   * 发送完成卡片
   */
  private async sendCompleteCard(stats: TokenStats): Promise<void> {
    const elapsedMs = Date.now() - this.startTime;

    // 关闭 CardKit 流式模式
    if (this.cardKitState.originalCardId) {
      this.cardKitState.sequence += 1;
      await this.api.setCardStreamingMode(
        this.cardKitState.originalCardId,
        false,
        this.cardKitState.sequence
      );
    }

    const displayText = this.textState.completedText || this.textState.accumulatedText;

    // 诊断日志：检查内容是否正确（debug级别）
    logger.debug({
      completedTextLength: this.textState.completedText.length,
      accumulatedTextLength: this.textState.accumulatedText.length,
      reasoningTextLength: this.reasoningState.accumulatedText.length,
      displayTextPreview: displayText.substring(0, 200),
      reasoningPreview: this.reasoningState.accumulatedText.substring(0, 200),
    }, '[sendCompleteCard] 内容诊断');

    const card = buildStreamingCompleteCard(
      displayText,
      this.reasoningState.accumulatedText,
      this.reasoningState.elapsedMs,
      elapsedMs,
      stats,
      this.model,
      { status: true, elapsed: true, tokens: true, model: true }
    );

    if (this.cardKitState.originalCardId) {
      // CardKit 终态更新
      this.cardKitState.sequence += 1;
      await this.api.updateCardKitCard(
        this.cardKitState.originalCardId,
        card,
        this.cardKitState.sequence
      );
    } else if (this.cardKitState.messageId) {
      // IM Patch 更新
      await this.api.updateCardMessage(this.cardKitState.messageId, card);
    }
  }

  /**
   * 发送停止卡片
   */
  private async sendStoppedCard(): Promise<void> {
    const elapsedMs = Date.now() - this.startTime;

    // 关闭 CardKit 流式模式
    if (this.cardKitState.originalCardId) {
      this.cardKitState.sequence += 1;
      await this.api.setCardStreamingMode(
        this.cardKitState.originalCardId,
        false,
        this.cardKitState.sequence
      );
    }

    const card = buildStoppedCard(
      this.textState.accumulatedText,
      this.reasoningState.accumulatedText,
      this.reasoningState.elapsedMs,
      elapsedMs,
      undefined, // 停止时没有完整 stats
      this.model || undefined,
      { status: true, elapsed: true, tokens: false, model: true }
    );

    if (this.cardKitState.originalCardId) {
      // CardKit 终态更新
      this.cardKitState.sequence += 1;
      await this.api.updateCardKitCard(
        this.cardKitState.originalCardId,
        card,
        this.cardKitState.sequence
      );
    } else if (this.cardKitState.messageId) {
      // IM Patch 更新
      await this.api.updateCardMessage(this.cardKitState.messageId, card);
    }
  }

  /**
   * 发送错误卡片
   */
  private async sendErrorCard(message: string): Promise<void> {
    // 关闭 CardKit 流式模式
    if (this.cardKitState.originalCardId) {
      try {
        this.cardKitState.sequence += 1;
        await this.api.setCardStreamingMode(
          this.cardKitState.originalCardId,
          false,
          this.cardKitState.sequence
        );
      } catch {
        // 忽略关闭流式模式的错误
      }
    }

    const card = buildErrorCard(message, 'default');

    if (this.cardKitState.originalCardId) {
      try {
        this.cardKitState.sequence += 1;
        await this.api.updateCardKitCard(
          this.cardKitState.originalCardId,
          card,
          this.cardKitState.sequence
        );
      } catch {
        // 忽略更新失败
      }
    } else if (this.cardKitState.messageId) {
      try {
        await this.api.updateCardMessage(this.cardKitState.messageId, card);
      } catch {
        // 忽略更新失败
      }
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
    hasCardId: boolean;
    elapsedMs: number;
  } {
    return {
      phase: this.phase,
      contentLength: this.textState.accumulatedText.length,
      reasoningLength: this.reasoningState.accumulatedText.length,
      hasMessageId: !!this.cardKitState.messageId,
      hasCardId: !!this.cardKitState.cardId,
      elapsedMs: Date.now() - this.startTime,
    };
  }
}
