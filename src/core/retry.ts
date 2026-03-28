/**
 * 重试工具
 * Retry Utilities
 *
 * 提供指数退避等重试机制
 */

/**
 * 延迟指定时间
 * @param ms 毫秒数
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 重试选项
 */
export interface RetryOptions {
  /** 最大重试次数 */
  maxAttempts: number;
  /** 初始延迟（毫秒） */
  initialDelay: number;
  /** 最大延迟（毫秒） */
  maxDelay: number;
  /** 延迟倍数 */
  backoffMultiplier: number;
  /** 可重试的错误判断函数 */
  retryableError?: (error: unknown) => boolean;
}

/**
 * 默认重试选项
 */
export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
};

/**
 * 使用指数退避执行重试
 * @param fn 要执行的函数
 * @param options 重试选项
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: unknown;
  let delay = opts.initialDelay;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // 如果是最后一次尝试，抛出错误
      if (attempt === opts.maxAttempts) {
        break;
      }

      // 检查是否可重试
      if (opts.retryableError && !opts.retryableError(error)) {
        throw error;
      }

      // 等待后重试
      await sleep(delay);
      delay = Math.min(delay * opts.backoffMultiplier, opts.maxDelay);
    }
  }

  throw lastError;
}

/**
 * 可重试的错误类型判断
 */
export function isRetryableError(error: unknown): boolean {
  if (error && typeof error === 'object') {
    // 网络错误
    const code = (error as { code?: string }).code;
    if (code) {
      return ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(code);
    }

    // HTTP 状态码
    const status = (error as { response?: { status?: number } }).response?.status;
    if (status) {
      return status >= 500 || status === 429; // 服务器错误或限流
    }
  }
  return false;
}
