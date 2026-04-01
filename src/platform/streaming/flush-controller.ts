/**
 * FlushController - 节流刷新控制器
 *
 * 纯调度原语，负责：
 * 1. 节流控制 - 限制卡片更新频率（CardKit 100ms / IM Patch 1500ms）
 * 2. 互斥锁 - 防止并发刷新冲突
 * 3. 刷新冲突处理 - 刷新期间有新内容时自动重新刷新
 * 4. 长间隔检测 - 超过阈值无更新时批量刷新
 *
 * 注意：此类不包含业务逻辑，只负责调度时机控制
 */

/** 节流常量 */
const THROTTLE_CONSTANTS = {
  /** CardKit 流式模式节流间隔 - 每次更新包含更多字符以获得更流畅的打字机效果 */
  CARDKIT_MS: 300,
  /** IM Patch 模式节流间隔 */
  PATCH_MS: 1500,
  /** 长间隔阈值 - 超过此时间后的首次更新会先批量缓冲 */
  LONG_GAP_THRESHOLD_MS: 2000,
  /** 长间隔后的批量缓冲时间 - 避免长间隔后立刻刷新导致内容断断续续 */
  BATCH_AFTER_GAP_MS: 200,
};

export { THROTTLE_CONSTANTS };

export class FlushController {
  /** 实际执行刷新的回调函数 */
  private readonly doFlush: () => Promise<void>;

  /** 是否正在刷新中 */
  private isFlushing = false;

  /** 等待刷新完成的 Promise 解析器列表 */
  private flushResolvers: Array<() => void> = [];

  /** 是否需要重新刷新（在刷新期间有新内容时） */
  private needsReflush = false;

  /** 挂起的刷新定时器 */
  private pendingFlushTimer: NodeJS.Timeout | null = null;

  /** 上次刷新时间 */
  private lastUpdateTime = 0;

  /** 是否已完成 */
  private isCompleted = false;

  /** 卡片消息是否已准备好接收更新 */
  private _cardMessageReady = false;

  /**
   * 创建 FlushController 实例
   * @param doFlush 实际执行刷新的回调函数
   */
  constructor(doFlush: () => Promise<void>) {
    this.doFlush = doFlush;
  }

  /**
   * 标记控制器为完成状态
   * 当前刷新完成后不再接受新的刷新请求
   */
  complete(): void {
    this.isCompleted = true;
  }

  /**
   * 取消挂起的刷新定时器
   */
  cancelPendingFlush(): void {
    if (this.pendingFlushTimer) {
      clearTimeout(this.pendingFlushTimer);
      this.pendingFlushTimer = null;
    }
  }

  /**
   * 等待当前刷新完成
   * @returns Promise 在刷新完成后解析
   */
  async waitForFlush(): Promise<void> {
    if (!this.isFlushing) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.flushResolvers.push(resolve);
    });
  }

  /**
   * 设置卡片消息是否已准备好接收更新
   * 在卡片创建完成并获取到 messageId 后调用
   */
  setCardMessageReady(ready: boolean): void {
    this._cardMessageReady = ready;
    if (ready) {
      // 初始化时间戳，使第一次 throttledUpdate 看到较小的时间差
      this.lastUpdateTime = Date.now();
    }
  }

  /**
   * 检查卡片消息是否已准备好
   */
  private cardMessageReady(): boolean {
    return this._cardMessageReady;
  }

  /**
   * 执行刷新（带互斥锁保护和冲突重刷机制）
   *
   * 如果刷新期间有新内容到达（needsReflush），会在当前刷新完成后
   * 立即安排一次重新刷新
   */
  private async flush(): Promise<void> {
    if (!this.cardMessageReady() || this.isFlushing || this.isCompleted) {
      // 如果正在刷新且未完成，标记需要重新刷新
      if (this.isFlushing && !this.isCompleted) {
        this.needsReflush = true;
      }
      return;
    }

    this.isFlushing = true;
    this.needsReflush = false;

    // 在 API 调用前更新时间戳，防止并发调用者进入刷新逻辑（竞态条件修复）
    this.lastUpdateTime = Date.now();

    try {
      await this.doFlush();
      this.lastUpdateTime = Date.now();
    } finally {
      this.isFlushing = false;

      // 解析所有等待的 Promise
      const resolvers = this.flushResolvers;
      this.flushResolvers = [];
      for (const resolve of resolvers) {
        resolve();
      }

      // 如果在刷新期间有新内容到达，安排立即重新刷新
      if (this.needsReflush && !this.isCompleted && !this.pendingFlushTimer) {
        this.needsReflush = false;
        this.pendingFlushTimer = setTimeout(() => {
          this.pendingFlushTimer = null;
          void this.flush();
        }, 0);
      }
    }
  }

  /**
   * 节流更新入口点
   *
   * @param throttleMs - 刷新之间的最小间隔（根据 CardKit 或 IM Patch 模式不同）
   */
  async throttledUpdate(throttleMs: number): Promise<void> {
    if (!this.cardMessageReady()) {
      return;
    }

    const now = Date.now();
    const elapsed = now - this.lastUpdateTime;

    if (elapsed >= throttleMs) {
      // 超过节流间隔，可以立即刷新
      this.cancelPendingFlush();

      if (elapsed > THROTTLE_CONSTANTS.LONG_GAP_THRESHOLD_MS) {
        // 长间隔后的首次更新：先批量缓冲一小段时间
        // 这样用户看到的第一次更新包含更多内容，而不是只有 1-2 个字符
        this.lastUpdateTime = now;
        this.pendingFlushTimer = setTimeout(() => {
          this.pendingFlushTimer = null;
          void this.flush();
        }, THROTTLE_CONSTANTS.BATCH_AFTER_GAP_MS);
      } else {
        // 正常刷新
        await this.flush();
      }
    } else if (!this.pendingFlushTimer) {
      // 在节流窗口内，安排延迟刷新
      const delay = throttleMs - elapsed;
      this.pendingFlushTimer = setTimeout(() => {
        this.pendingFlushTimer = null;
        void this.flush();
      }, delay);
    }
  }

  /**
   * 获取当前状态（用于调试）
   */
  getStatus(): {
    isFlushing: boolean;
    pendingFlush: boolean;
    isCompleted: boolean;
    lastUpdateTime: number;
    cardMessageReady: boolean;
  } {
    return {
      isFlushing: this.isFlushing,
      pendingFlush: !!this.pendingFlushTimer || this.needsReflush,
      isCompleted: this.isCompleted,
      lastUpdateTime: this.lastUpdateTime,
      cardMessageReady: this._cardMessageReady,
    };
  }
}
