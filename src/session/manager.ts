/**
 * 会话管理器
 * Session Manager
 *
 * 管理用户会话，使用 LRU 策略清理过期会话
 */

import type { Session, SessionConfig, SessionStats } from './types.js';
import type { Message } from '../adapters/interface/types.js';
import { logger } from '../core/logger.js';

/**
 * 会话管理器
 */
export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private maxSessions: number;
  private maxHistory: number;

  constructor(private config: SessionConfig) {
    this.maxSessions = config.maxSessions || 15;
    this.maxHistory = config.maxHistory || 20;
  }

  /**
   * 获取或创建会话
   * @param userId - 用户 ID
   * @param cliType - CLI 类型
   * @param workingDir - 工作目录
   * @returns 会话对象
   */
  getOrCreate(userId: string, cliType: string, workingDir: string): Session {
    let session = this.sessions.get(userId);

    if (!session) {
      // 检查是否需要 LRU 清理
      if (this.sessions.size >= this.maxSessions) {
        this.cleanupLRU();
      }

      session = {
        userId,
        cliType,
        workingDir,
        history: [],
        lastActivity: Date.now(),
      };

      this.sessions.set(userId, session);
      logger.debug({ userId, cliType, workingDir }, '创建新会话');
    } else {
      // 更新活动时间和工作目录
      session.lastActivity = Date.now();
      session.workingDir = workingDir;

      // 如果 CLI 类型变化，清空历史
      if (session.cliType !== cliType) {
        session.cliType = cliType;
        session.history = [];
        logger.debug({ userId, cliType }, '切换 CLI 类型，清空历史');
      }
    }

    return session;
  }

  /**
   * 获取会话
   * @param userId - 用户 ID
   * @returns 会话对象或 null
   */
  getSession(userId: string): Session | null {
    const session = this.sessions.get(userId);
    if (session) {
      session.lastActivity = Date.now();
    }
    return session || null;
  }

  /**
   * 添加消息到会话历史
   * @param userId - 用户 ID
   * @param role - 消息角色
   * @param content - 消息内容
   */
  addMessage(userId: string, role: 'user' | 'assistant', content: string): void {
    const session = this.sessions.get(userId);
    if (!session) {
      return;
    }

    session.history.push({
      role,
      content,
      timestamp: Date.now(),
    });

    // 限制历史长度
    if (session.history.length > this.maxHistory) {
      session.history = session.history.slice(-this.maxHistory);
    }

    session.lastActivity = Date.now();
  }

  /**
   * 清空会话历史
   * @param userId - 用户 ID
   * @returns 是否成功
   */
  clearHistory(userId: string): boolean {
    const session = this.sessions.get(userId);
    if (!session) {
      return false;
    }

    session.history = [];
    session.lastActivity = Date.now();

    logger.debug({ userId }, '清空会话历史');
    return true;
  }

  /**
   * 删除会话
   * @param userId - 用户 ID
   * @returns 是否成功
   */
  deleteSession(userId: string): boolean {
    const result = this.sessions.delete(userId);
    if (result) {
      logger.debug({ userId }, '删除会话');
    }
    return result;
  }

  /**
   * LRU 清理：移除最久未使用的会话
   */
  cleanupLRU(): void {
    if (this.sessions.size === 0) {
      return;
    }

    let oldestUserId: string | null = null;
    let oldestTime = Infinity;

    for (const [userId, session] of this.sessions.entries()) {
      if (session.lastActivity < oldestTime) {
        oldestTime = session.lastActivity;
        oldestUserId = userId;
      }
    }

    if (oldestUserId) {
      this.sessions.delete(oldestUserId);
      logger.info({ userId: oldestUserId }, 'LRU 清理会话');
    }
  }

  /**
   * 清理超时会话
   * @param timeoutMs - 超时时间（毫秒）
   * @returns 清理的会话数
   */
  cleanupExpired(timeoutMs: number): number {
    const now = Date.now();
    let count = 0;

    for (const [userId, session] of this.sessions.entries()) {
      if (now - session.lastActivity > timeoutMs) {
        this.sessions.delete(userId);
        count++;
      }
    }

    if (count > 0) {
      logger.info({ count }, '清理超时会话');
    }

    return count;
  }

  /**
   * 获取统计信息
   */
  getStats(): SessionStats {
    return {
      totalSessions: this.sessions.size,
      activeSessions: this.sessions.size,
      totalMessages: Array.from(this.sessions.values()).reduce(
        (sum, s) => sum + s.history.length,
        0
      ),
    };
  }

  /**
   * 获取所有会话列表
   */
  listSessions(): Session[] {
    return Array.from(this.sessions.values()).sort(
      (a, b) => b.lastActivity - a.lastActivity
    );
  }

  /**
   * 获取会话数
   */
  getSessionCount(): number {
    return this.sessions.size;
  }
}
