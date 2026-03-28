/**
 * FlushController - 节流刷新控制器
 *
 * 纯调度原语，负责：
 * 1. 节流控制 - 限制卡片更新频率（CardKit 100ms / IM Patch 1500ms）
 * 2. 互斥锁 - 防止并发刷新冲突
 * 3. 长间隔检测 - 超过 2s 无更新时批量刷新
 *
 * 注意：此类不包含业务逻辑，只负责调度时机控制
 */

export class FlushController {
  /** 节流定时器 */
  private throttleTimer: NodeJS.Timeout | null = null;

  /** 刷新锁 - 防止并发 */
  private isFlushing = false;

  /** 等待刷新的标记 */
  private pendingFlush = false;

  /** 上次刷新时间 */
  private lastFlushTime = 0;

  /** 长间隔阈值（毫秒）- 超过此时间强制刷新 */
  private readonly longGapThreshold: number;

  /** 是否已完成 */
  private completed = false;

  /**
   * 创建 FlushController 实例
   * @param doFlush 实际执行刷新的回调函数
   * @param longGapThreshold 长间隔阈值（默认 2000ms）
   */
  constructor(
    private readonly doFlush: () => Promise<void>,
    longGapThreshold = 2000
  ) {
    this.longGapThreshold = longGapThreshold;
  }

  /**
   * 节流更新 - 在指定时间内只执行一次刷新
   * @param throttleMs 节流间隔（毫秒）
   */
  async throttledUpdate(throttleMs: number): Promise<void> {
    if (this.completed) {
      return;
    }

    // 检查是否需要立即刷新（长间隔检测）- 但首次调用除外
    const now = Date.now();
    const timeSinceLastFlush = now - this.lastFlushTime;

    // 如果距离上次刷新超过阈值，且不是首次调用，立即执行
    if (this.lastFlushTime > 0 && timeSinceLastFlush > this.longGapThreshold && !this.isFlushing) {
      await this.performFlush();
      return;
    }

    // 如果已有定时器，标记需要刷新并返回
    if (this.throttleTimer) {
      this.pendingFlush = true;
      return;
    }

    // 设置节流定时器
    this.pendingFlush = true;
    this.throttleTimer = setTimeout(async () => {
      this.throttleTimer = null;
      if (this.pendingFlush && !this.completed) {
        await this.performFlush();
      }
    }, throttleMs);
  }

  /**
   * 等待当前刷新完成
   * 用于流结束时的同步
   */
  async waitForFlush(): Promise<void> {
    // 取消挂起的定时器
    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }

    // 如果有待刷新内容，立即执行
    if (this.pendingFlush && !this.isFlushing) {
      await this.performFlush();
    }

    // 等待当前刷新完成（简单轮询）
    while (this.isFlushing) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  /**
   * 取消挂起的刷新
   * 用于停止生成时清除待执行的刷新
   */
  cancelPendingFlush(): void {
    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
    this.pendingFlush = false;
  }

  /**
   * 标记完成状态
   * 调用后不再接受新的刷新请求
   */
  complete(): void {
    this.completed = true;
    this.cancelPendingFlush();
  }

  /**
   * 执行实际刷新（带锁保护）
   */
  private async performFlush(): Promise<void> {
    // 获取锁
    if (this.isFlushing) {
      // 如果正在刷新，标记为有需要刷新的内容
      this.pendingFlush = true;
      return;
    }

    this.isFlushing = true;
    this.pendingFlush = false;

    try {
      await this.doFlush();
      this.lastFlushTime = Date.now();
    } catch (error) {
      // 刷新失败，标记需要重试
      this.pendingFlush = true;
      throw error;
    } finally {
      this.isFlushing = false;
      // 如果在刷新期间有新的刷新请求，再次执行
      if (this.pendingFlush && !this.completed) {
        this.pendingFlush = false;
        await this.performFlush();
      }
    }
  }

  /**
   * 获取当前状态（用于调试）
   */
  getStatus(): {
    isFlushing: boolean;
    pendingFlush: boolean;
    completed: boolean;
    lastFlushTime: number;
  } {
    return {
      isFlushing: this.isFlushing,
      pendingFlush: this.pendingFlush,
      completed: this.completed,
      lastFlushTime: this.lastFlushTime,
    };
  }
}
