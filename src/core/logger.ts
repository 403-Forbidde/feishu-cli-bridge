/**
 * 日志模块
 * Logger Module
 *
 * 使用 Pino 进行结构化日志记录
 */

import pino from 'pino';

// 日志级别
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

// 创建 Pino 日志实例
export const logger = pino({
  level: LOG_LEVEL,
  transport: process.env.NODE_ENV === 'development'
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'yyyy-mm-dd HH:MM:ss',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
  base: {
    pid: process.pid,
  },
});

/**
 * 创建子日志器
 * @param bindings - 上下文绑定
 * @returns 子日志器
 */
export function child(bindings: Record<string, unknown>): pino.Logger {
  return logger.child(bindings);
}

/**
 * 设置日志级别
 * @param level - 日志级别
 */
export function setLogLevel(level: string): void {
  logger.level = level;
}

/**
 * 获取当前日志级别
 * @returns 日志级别
 */
export function getLogLevel(): string {
  return logger.level;
}
