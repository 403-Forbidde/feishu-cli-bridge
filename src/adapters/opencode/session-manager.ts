/**
 * OpenCode 会话管理器
 * OpenCode Session Manager
 *
 * 管理 OpenCode 会话的生命周期，每个工作目录对应一个会话
 */

import { logger } from '../../core/logger.js';
import type { OpenCodeHTTPClient } from './http-client.js';
import type { OpenCodeSession, OpenCodeConfig, CreateSessionResponse } from './types.js';

/**
 * 会话管理器选项
 */
export interface SessionManagerOptions {
  /** HTTP 客户端 */
  httpClient: OpenCodeHTTPClient;
  /** 配置 */
  config: OpenCodeConfig;
}

/**
 * 规范化路径，用于比较
 * 解决尾随斜杠和符号链接问题
 */
function normalizePath(path: string): string {
  if (!path) return '';

  try {
    // 展开 ~ 和 ~user
    const expanded = path.replace(/^~(?=$|\/|\\)/, process.env.HOME || '');
    // 使用 Node.js 的 path 规范化（注意：这里不解析符号链接，只做字符串规范化）
    const { normalize } = require('node:path');
    const normalized = normalize(expanded);
    // 移除尾随斜杠（根目录 / 除外）
    return normalized.replace(/\\/g, '/').replace(/\/$/, '') || '/';
  } catch {
    // 如果出错，至少做基本的字符串规范化
    return path.replace(/\\/g, '/').replace(/\/$/, '') || '/';
  }
}

/**
 * 比较两个路径是否相等
 */
function pathsEqual(path1: string, path2: string): boolean {
  return normalizePath(path1) === normalizePath(path2);
}

/**
 * OpenCode 会话管理器
 */
export class OpenCodeSessionManager {
  private sessions: Map<string, OpenCodeSession> = new Map(); // workingDir -> Session
  private httpClient: OpenCodeHTTPClient;
  private config: OpenCodeConfig;
  private activeWorkingDir = '';

  constructor(options: SessionManagerOptions) {
    this.httpClient = options.httpClient;
    this.config = options.config;
  }

  /**
   * 获取或创建会话
   * @param workingDir 工作目录
   * @returns 会话信息
   */
  async getOrCreateSession(workingDir: string): Promise<OpenCodeSession> {
    const normalizedDir = normalizePath(workingDir);

    // 检查是否已有该工作目录的会话
    const existingSession = this.findSessionByWorkingDir(normalizedDir);
    if (existingSession) {
      logger.debug(`Using existing session for ${workingDir}: ${existingSession.id}`);
      this.activeWorkingDir = normalizedDir;
      return existingSession;
    }

    // 创建新会话
    try {
      const response = await this.httpClient.createSession(workingDir);
      const session = this.mapResponseToSession(response, normalizedDir);
      this.sessions.set(normalizedDir, session);
      this.activeWorkingDir = normalizedDir;
      logger.info(`Created new session for ${workingDir}: ${session.id}`);
      return session;
    } catch (error) {
      logger.error({ err: error }, `Failed to create session for ${workingDir}`);
      throw error;
    }
  }

  /**
   * 根据工作目录查找会话
   */
  private findSessionByWorkingDir(workingDir: string): OpenCodeSession | undefined {
    for (const [dir, session] of this.sessions) {
      if (pathsEqual(dir, workingDir)) {
        return session;
      }
    }
    return undefined;
  }

  /**
   * 列出所有会话
   */
  async listSessions(): Promise<OpenCodeSession[]> {
    try {
      const response = await this.httpClient.listSessions();
      return response.sessions.map((s) => ({
        id: s.id,
        title: s.title,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
        workingDir: s.directory || '',
        slug: s.slug,
      }));
    } catch (error) {
      logger.error({ err: error }, 'Failed to list sessions');
      return [];
    }
  }

  /**
   * 切换会话
   * @param sessionId 会话 ID
   * @param workingDir 可选的工作目录（用于更新本地映射）
   */
  async switchSession(sessionId: string, workingDir?: string): Promise<boolean> {
    try {
      await this.httpClient.switchSession(sessionId);

      // 更新本地状态
      if (workingDir) {
        this.activeWorkingDir = normalizePath(workingDir);
        // 尝试从服务器获取会话信息并更新本地缓存
        const sessions = await this.listSessions();
        const session = sessions.find((s) => s.id === sessionId);
        if (session) {
          this.sessions.set(this.activeWorkingDir, session);
        }
      }

      logger.info(`Switched to session: ${sessionId}`);
      return true;
    } catch (error) {
      logger.error({ err: error }, `Failed to switch to session ${sessionId}`);
      return false;
    }
  }

  /**
   * 重命名会话
   */
  async renameSession(sessionId: string, title: string): Promise<boolean> {
    try {
      await this.httpClient.renameSession(sessionId, title);

      // 更新本地缓存
      for (const [dir, session] of this.sessions) {
        if (session.id === sessionId) {
          session.title = title;
          this.sessions.set(dir, session);
          break;
        }
      }

      logger.info(`Renamed session ${sessionId} to: ${title}`);
      return true;
    } catch (error) {
      logger.error({ err: error }, `Failed to rename session ${sessionId}`);
      return false;
    }
  }

  /**
   * 删除会话
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    try {
      await this.httpClient.deleteSession(sessionId);

      // 从本地缓存中移除
      for (const [dir, session] of this.sessions) {
        if (session.id === sessionId) {
          this.sessions.delete(dir);
          break;
        }
      }

      logger.info(`Deleted session: ${sessionId}`);
      return true;
    } catch (error) {
      logger.error({ err: error }, `Failed to delete session ${sessionId}`);
      return false;
    }
  }

  /**
   * 重置当前会话
   */
  async resetSession(): Promise<boolean> {
    try {
      await this.httpClient.resetSession();
      logger.info('Reset current session');
      return true;
    } catch (error) {
      logger.error({ err: error }, 'Failed to reset session');
      return false;
    }
  }

  /**
   * 根据工作目录获取会话 ID
   */
  getSessionId(workingDir: string): string | null {
    const session = this.findSessionByWorkingDir(normalizePath(workingDir));
    return session?.id || null;
  }

  /**
   * 获取当前活跃的工作目录
   */
  getActiveWorkingDir(): string {
    return this.activeWorkingDir;
  }

  /**
   * 恢复会话（从服务器同步）
   */
  async recoverSessions(): Promise<void> {
    try {
      const sessions = await this.listSessions();
      logger.info(`Recovered ${sessions.length} sessions from server`);

      // 更新本地缓存，但保留工作目录映射
      // 注意：OpenCode API 可能不返回 directory 字段，
      // 所以我们只能保留现有的映射
    } catch (error) {
      logger.error({ err: error }, 'Failed to recover sessions');
    }
  }

  /**
   * 将 API 响应映射为会话对象
   */
  private mapResponseToSession(
    response: CreateSessionResponse,
    workingDir: string
  ): OpenCodeSession {
    return {
      id: response.id,
      title: response.title,
      createdAt: response.created_at,
      workingDir: workingDir,
      slug: response.slug,
    };
  }
}
