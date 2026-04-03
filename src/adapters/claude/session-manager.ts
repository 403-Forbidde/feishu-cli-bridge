/**
 * Claude Code 会话管理器
 * Claude Code Session Manager
 *
 * 管理会话列表和工作目录到当前激活会话的映射
 * 与 Claude Code CLI 的会话机制对接：
 * - CLI 自动生成 session ID（首次运行）
 * - 从 system 事件捕获实际的 session_id
 * - 使用 --resume 参数继续已有会话
 * - 支持多会话历史（类似 `claude -r`）
 */

import { readFile, writeFile, access, mkdir, readdir, unlink } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { logger } from '../../core/logger.js';
import type { SessionInfo } from '../interface/types.js';

/**
 * Claude CLI 会话文件格式（~/.claude/sessions/{pid}.json）
 */
interface CLISessionFile {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number;
  kind: string;
  entrypoint: string;
}

/**
 * 会话信息（用于历史记录）
 */
interface SessionData {
  sessionId: string;
  workingDir: string;
  createdAt: number;
  lastUsedAt: number;
  title?: string;
}

/**
 * 持久化文件格式
 */
interface SessionPersistence {
  version: number;
  // 所有会话历史（sessionId -> sessionData）
  allSessions: Record<string, {
    workingDir: string;
    createdAt: number;
    lastUsedAt: number;
    title?: string;
  }>;
  // 当前激活的会话（workingDir -> sessionId）
  activeSessions: Record<string, string>;
}

const SESSIONS_FILE_NAME = '.claude-sessions.json';
const SESSIONS_FILE_VERSION = 4; // 版本升级：重构数据结构支持多会话历史

/**
 * Claude Code 会话管理器
 */
export class ClaudeCodeSessionManager {
  /** 所有会话历史：sessionId -> SessionData */
  private allSessions: Map<string, SessionData> = new Map();
  /** 当前激活的会话：workingDir -> sessionId */
  private activeSessions: Map<string, string> = new Map();
  /** 持久化文件路径 */
  private persistencePath: string;
  /** 是否已初始化 */
  private initialized = false;

  constructor(baseDir: string) {
    this.persistencePath = join(baseDir, SESSIONS_FILE_NAME);
  }

  /**
   * 初始化会话管理器
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.loadSessions();
    await this.syncWithCLISessions();

    this.initialized = true;
  }

  /**
   * 获取或创建会话
   * @param workingDir - 工作目录
   * @returns 会话 ID（如果已有激活会话）或 null（需要创建新会话）
   */
  async getOrCreateSessionId(workingDir: string): Promise<string | null> {
    await this.initialize();

    const normalizedPath = this.normalizePath(workingDir);

    // 检查是否有当前激活的会话
    const activeSessionId = this.activeSessions.get(normalizedPath);
    if (activeSessionId) {
      const sessionData = this.allSessions.get(activeSessionId);
      if (sessionData) {
        // 更新最后使用时间
        sessionData.lastUsedAt = Date.now();
        await this.saveSessions();
        logger.debug({ sessionId: activeSessionId, workingDir: normalizedPath }, 'Reusing active session');
        return activeSessionId;
      }
    }

    // 需要创建新会话（不传 --resume）
    logger.info({ workingDir: normalizedPath }, 'No active session found, will create new session');
    return null;
  }

  /**
   * 保存新会话映射（从 system 事件捕获到 session_id 后调用）
   * @param workingDir - 工作目录
   * @param sessionId - 从 CLI 捕获的 session ID
   */
  async saveSessionMapping(workingDir: string, sessionId: string): Promise<void> {
    const normalizedPath = this.normalizePath(workingDir);
    const now = Date.now();

    // 添加到所有会话历史
    this.allSessions.set(sessionId, {
      sessionId,
      workingDir: normalizedPath,
      createdAt: now,
      lastUsedAt: now,
    });

    // 设置为当前激活的会话
    this.activeSessions.set(normalizedPath, sessionId);

    await this.saveSessions();
    logger.info({ sessionId, workingDir: normalizedPath }, 'Saved new session mapping');
  }

  /**
   * 列出所有会话
   * @param limit - 最大数量
   * @param workingDir - 可选的工作目录过滤
   * @returns 会话列表
   */
  async listSessions(limit?: number, workingDir?: string): Promise<SessionInfo[]> {
    await this.initialize();

    // 获取所有会话
    let sessions = Array.from(this.allSessions.values());

    // 如果指定了工作目录，只显示该目录下的会话
    if (workingDir) {
      const normalizedPath = this.normalizePath(workingDir);
      sessions = sessions.filter(s => s.workingDir === normalizedPath);
    }

    // 按最后使用时间排序
    const sorted = sessions
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
      .slice(0, limit);

    logger.debug({ count: sorted.length, workingDir }, 'Listing sessions');

    // 转换为 SessionInfo
    const result: SessionInfo[] = sorted.map(session => ({
      id: session.sessionId,
      title: session.title || this.generateSessionTitle(session.workingDir),
      createdAt: session.createdAt,
      updatedAt: session.lastUsedAt,
      workingDir: session.workingDir,
    }));

    return result;
  }

  /**
   * 切换会话
   * @param sessionId - 会话 ID
   * @param workingDir - 工作目录（可选）
   * @returns 是否成功
   */
  async switchSession(sessionId: string, workingDir?: string): Promise<boolean> {
    await this.initialize();

    // 查找会话
    const sessionData = this.allSessions.get(sessionId);
    if (!sessionData) {
      logger.warn({ sessionId }, 'Session not found');
      return false;
    }

    // 更新最后使用时间
    sessionData.lastUsedAt = Date.now();

    // 如果提供了工作目录，更新激活映射
    if (workingDir) {
      const normalizedPath = this.normalizePath(workingDir);
      this.activeSessions.set(normalizedPath, sessionId);
      logger.info({ sessionId, workingDir: normalizedPath }, 'Switched to session');
    } else {
      // 使用会话原来的工作目录
      this.activeSessions.set(sessionData.workingDir, sessionId);
      logger.info({ sessionId, workingDir: sessionData.workingDir }, 'Switched to session');
    }

    await this.saveSessions();
    return true;
  }

  /**
   * 重置当前工作目录的会话（创建新会话时调用）
   * @param workingDir - 工作目录
   * @returns 是否成功
   *
   * 注意：不再删除历史会话，只是清除当前激活的映射
   */
  async resetSession(workingDir: string): Promise<boolean> {
    const normalizedPath = this.normalizePath(workingDir);

    const activeSessionId = this.activeSessions.get(normalizedPath);
    if (activeSessionId) {
      logger.info({ sessionId: activeSessionId, workingDir: normalizedPath }, 'Clearing active session (history preserved)');
      this.activeSessions.delete(normalizedPath);
      await this.saveSessions();
    }

    return true;
  }

  /**
   * 重命名会话
   * @param sessionId - 会话 ID
   * @param title - 新标题
   * @returns 是否成功
   */
  async renameSession(sessionId: string, title: string): Promise<boolean> {
    await this.initialize();

    const sessionData = this.allSessions.get(sessionId);
    if (!sessionData) {
      logger.warn({ sessionId }, 'Session not found for rename');
      return false;
    }

    sessionData.title = title;
    sessionData.lastUsedAt = Date.now();
    await this.saveSessions();

    logger.info({ sessionId, title }, 'Renamed session');
    return true;
  }

  /**
   * 删除会话
   * @param sessionId - 会话 ID
   * @returns 是否成功
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    await this.initialize();

    const sessionData = this.allSessions.get(sessionId);
    if (!sessionData) {
      logger.warn({ sessionId }, 'Session not found');
      return false;
    }

    // 从所有会话中删除
    this.allSessions.delete(sessionId);

    // 从激活映射中删除（如果存在）
    for (const [path, activeId] of this.activeSessions.entries()) {
      if (activeId === sessionId) {
        this.activeSessions.delete(path);
        break;
      }
    }

    await this.saveSessions();
    logger.info({ sessionId }, 'Deleted session');
    return true;
  }

  /**
   * 获取工作目录对应的当前激活会话 ID
   * @param workingDir - 工作目录
   * @returns 会话 ID 或 null
   */
  getSessionId(workingDir: string): string | null {
    const normalizedPath = this.normalizePath(workingDir);
    return this.activeSessions.get(normalizedPath) ?? null;
  }

  /**
   * 加载持久化的会话数据
   */
  private async loadSessions(): Promise<void> {
    try {
      await access(this.persistencePath);
    } catch {
      this.allSessions = new Map();
      this.activeSessions = new Map();
      return;
    }

    try {
      const content = await readFile(this.persistencePath, 'utf-8');
      const data: SessionPersistence = JSON.parse(content);

      // 版本检查
      if (data.version > SESSIONS_FILE_VERSION) {
        logger.warn({ version: data.version, expected: SESSIONS_FILE_VERSION }, 'Sessions file version is newer than expected, resetting');
        this.allSessions = new Map();
        this.activeSessions = new Map();
        return;
      }

      // 从 v3 迁移：旧格式只有 sessions（workingDir -> sessionInfo）
      if (data.version < 4) {
        logger.info({ version: data.version }, 'Migrating from old sessions format');
        // 旧格式数据需要转换
        const oldSessions = (data as unknown as { sessions: Record<string, { sessionId: string; lastUsedAt: number; title?: string }> }).sessions;
        for (const [path, sessionData] of Object.entries(oldSessions)) {
          const sessionId = sessionData.sessionId;
          const now = Date.now();
          this.allSessions.set(sessionId, {
            sessionId,
            workingDir: path,
            createdAt: sessionData.lastUsedAt,
            lastUsedAt: sessionData.lastUsedAt,
            title: sessionData.title,
          });
          this.activeSessions.set(path, sessionId);
        }
      } else {
        // v4 格式
        for (const [sessionId, sessionData] of Object.entries(data.allSessions || {})) {
          this.allSessions.set(sessionId, {
            sessionId,
            workingDir: sessionData.workingDir,
            createdAt: sessionData.createdAt,
            lastUsedAt: sessionData.lastUsedAt,
            title: sessionData.title,
          });
        }
        for (const [path, sessionId] of Object.entries(data.activeSessions || {})) {
          this.activeSessions.set(path, sessionId);
        }
      }

      logger.info({
        allCount: this.allSessions.size,
        activeCount: this.activeSessions.size,
        path: this.persistencePath
      }, 'Loaded sessions');
    } catch (error) {
      logger.error({ err: error }, 'Failed to load sessions');
      this.allSessions = new Map();
      this.activeSessions = new Map();
    }
  }

  /**
   * 保存会话数据到文件
   */
  private async saveSessions(): Promise<void> {
    try {
      const dir = dirname(this.persistencePath);
      await mkdir(dir, { recursive: true });

      const data: SessionPersistence = {
        version: SESSIONS_FILE_VERSION,
        allSessions: {},
        activeSessions: {},
      };

      for (const [sessionId, sessionData] of this.allSessions.entries()) {
        data.allSessions[sessionId] = {
          workingDir: sessionData.workingDir,
          createdAt: sessionData.createdAt,
          lastUsedAt: sessionData.lastUsedAt,
          title: sessionData.title,
        };
      }

      for (const [path, sessionId] of this.activeSessions.entries()) {
        data.activeSessions[path] = sessionId;
      }

      await writeFile(this.persistencePath, JSON.stringify(data, null, 2), 'utf-8');
      logger.debug({
        path: this.persistencePath,
        allCount: this.allSessions.size,
        activeCount: this.activeSessions.size
      }, 'Saved sessions');
    } catch (error) {
      logger.error({ err: error }, 'Failed to save sessions');
    }
  }

  /**
   * 同步 CLI 会话文件（headless 模式下跳过）
   */
  private async syncWithCLISessions(): Promise<void> {
    logger.debug('Skipping CLI session sync (headless mode)');
  }

  /**
   * 验证会话是否存在
   * 当前策略：信任自己的映射
   */
  private async validateSessionExists(_sessionId: string): Promise<boolean> {
    return true;
  }

  /**
   * 生成会话标题（基于目录名）
   */
  private generateSessionTitle(workingDir: string): string {
    return basename(workingDir) || 'unknown';
  }

  /**
   * 规范化路径
   */
  private normalizePath(inputPath: string): string {
    return inputPath.replace(/\\/g, '/').replace(/\/$/, '');
  }
}
