/**
 * OpenCode 会话管理器
 * OpenCode Session Manager
 *
 * 管理 OpenCode 会话的生命周期，每个工作目录对应一个会话
 */

import { homedir } from 'os';
import path from 'path';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { logger } from '../../core/logger.js';
import type { OpenCodeHTTPClient } from './http-client.js';
import type { OpenCodeSession, OpenCodeConfig, CreateSessionResponse } from './types.js';

/**
 * 会话存储数据结构
 */
interface SessionStorage {
  version: number;
  sessions: Array<{
    workingDir: string;
    session: OpenCodeSession;
  }>;
}

const STORAGE_VERSION = 1;

/**
 * 获取默认存储路径
 */
function getDefaultStoragePath(): string {
  const configDir = process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config');
  return path.join(configDir, 'feishu-cli-bridge', 'opencode-sessions.json');
}

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
  private storagePath: string;
  private loaded = false;

  constructor(options: SessionManagerOptions) {
    this.httpClient = options.httpClient;
    this.config = options.config;
    this.storagePath = getDefaultStoragePath();
  }

  /**
   * 加载会话缓存
   */
  async load(): Promise<void> {
    if (this.loaded) {
      return;
    }

    try {
      if (existsSync(this.storagePath)) {
        const data = await readFile(this.storagePath, 'utf-8');
        const storage: SessionStorage = JSON.parse(data);

        if (storage.version !== STORAGE_VERSION) {
          logger.warn({ version: storage.version, expected: STORAGE_VERSION }, 'Session storage version mismatch');
          await this.migrateStorage(storage);
          return;
        }

        this.sessions.clear();
        for (const item of storage.sessions) {
          this.sessions.set(item.workingDir, item.session);
        }

        logger.info({ count: this.sessions.size, storagePath: this.storagePath }, 'Loaded sessions from storage');
      } else {
        logger.info({ storagePath: this.storagePath }, 'Session storage file does not exist');
      }

      this.loaded = true;
    } catch (error) {
      logger.error({ err: error, storagePath: this.storagePath }, 'Failed to load session storage');
      this.sessions.clear();
      this.loaded = true;
    }
  }

  /**
   * 保存会话缓存
   */
  async save(): Promise<void> {
    try {
      const storage: SessionStorage = {
        version: STORAGE_VERSION,
        sessions: Array.from(this.sessions.entries()).map(([workingDir, session]) => ({
          workingDir,
          session,
        })),
      };

      // 确保存储目录存在
      const storageDir = path.dirname(this.storagePath);
      await mkdir(storageDir, { recursive: true });

      await writeFile(this.storagePath, JSON.stringify(storage, null, 2), 'utf-8');
      logger.debug({ count: this.sessions.size, storagePath: this.storagePath }, 'Saved sessions to storage');
    } catch (error) {
      logger.error({ err: error, storagePath: this.storagePath }, 'Failed to save session storage');
    }
  }

  /**
   * 迁移存储格式
   */
  private async migrateStorage(_storage: Partial<SessionStorage>): Promise<void> {
    // 目前只有一个版本，未来可以在这里添加迁移逻辑
    logger.info('Migrating session storage');
    this.sessions.clear();
    await this.save();
  }

  /**
   * 创建新会话（总是创建，不检查是否存在）
   * @param workingDir 工作目录
   * @returns 新会话信息
   */
  async createNewSession(workingDir: string): Promise<OpenCodeSession> {
    const normalizedDir = normalizePath(workingDir);

    // 生成唯一标题（时间戳+随机数）
    const timestamp = new Date().toISOString().slice(2, 10).replace(/-/g, '') + '_' +
                      new Date().toTimeString().slice(0, 8).replace(/:/g, '');
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const title = `Feishu Bridge ${timestamp}_${randomSuffix}`;

    try {
      const response = await this.httpClient.createSession(workingDir, title);

      // 防御性处理：检查响应是否有效
      if (!response || !response.id) {
        logger.error({ response }, 'Invalid response from create session API');
        throw new Error('Failed to create session: invalid API response');
      }

      const session = this.mapResponseToSession(response, normalizedDir);
      this.sessions.set(normalizedDir, session);
      this.activeWorkingDir = normalizedDir;

      // 持久化会话缓存
      await this.save();

      logger.info(`Created new session for ${workingDir}: ${session.id}`);
      return session;
    } catch (error) {
      logger.error({ err: error }, `Failed to create session for ${workingDir}`);
      throw error;
    }
  }
  /**
   * 获取或创建会话
   * 如果存在则返回现有会话，否则创建新会话
   */
  async getOrCreateSession(workingDir: string): Promise<OpenCodeSession | null> {
    const normalizedDir = normalizePath(workingDir);
    logger.debug(`getOrCreateSession called: workingDir="${workingDir}", normalizedDir="${normalizedDir}"`);

    // 首先检查本地缓存
    const existingSession = this.findSessionByWorkingDir(normalizedDir);
    if (existingSession) {
      logger.debug(`Found existing session for ${workingDir}: ${existingSession.id}`);
      this.activeWorkingDir = normalizedDir;
      return existingSession;
    }
    logger.debug(`No existing session found in local cache for "${normalizedDir}"`);

    // 尝试从服务器获取该目录的会话列表
    try {
      logger.debug(`Calling listSessions to find sessions for "${normalizedDir}"`);
      const sessions = await this.listSessions(undefined, normalizedDir);
      logger.debug(`listSessions returned ${sessions.length} sessions for "${normalizedDir}"`);
      if (sessions.length > 0) {
        // 按创建时间排序，返回最新的
        const sortedSessions = sessions.sort((a, b) => b.createdAt - a.createdAt);
        const session = sortedSessions[0];
        this.sessions.set(normalizedDir, session);
        this.activeWorkingDir = normalizedDir;
        logger.debug(`Recovered session from server: ${session.id}`);
        return session;
      }
    } catch (error) {
      logger.warn({ err: error }, 'Failed to list sessions from server, will create new');
    }

    // 没有找到现有会话，创建新的
    logger.info(`Creating new session for "${workingDir}"`);
    return await this.createNewSession(workingDir);
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
   * @param limit - 最大返回数量
   * @param directory - 可选的工作目录过滤（客户端过滤）
   *
   * 注意：Python 实现不在 API 层面过滤，而是获取所有会话后在客户端过滤
   * 因为 OpenCode API 的 directory 参数不能正确工作
   */
  async listSessions(limit?: number, directory?: string): Promise<OpenCodeSession[]> {
    try {
      // DEBUG: Log input parameters
      logger.debug(`listSessions called: limit=${limit}, directory=${directory}`);
      logger.debug(`Local cache size: ${this.sessions.size}`);
      for (const [dir, session] of this.sessions) {
        logger.debug(`  Local cache: dir="${dir}", session.id="${session.id?.slice(-8)}", title="${session.title}"`);
      }

      // 获取服务器会话列表（尝试传递 directory 参数）
      const response = await this.httpClient.listSessions(directory);

      // 防御性处理：API 可能返回不同格式
      const sessionsArray = response.sessions || [];

      // DEBUG: Log server response
      logger.debug(`Server returned ${sessionsArray.length} sessions`);
      for (const s of sessionsArray) {
        logger.debug(`  Server: id="${s.id?.slice(-8)}", title="${s.title}", directory="${s.directory}"`);
      }

      // 转换为内部格式
      const allSessions = sessionsArray.map((s) => ({
        id: s.id,
        title: s.title,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
        workingDir: s.directory || '',
        slug: s.slug,
      }));

      // 合并本地缓存中的会话（解决 OpenCode 列表不完整的问题）
      // 对于本地缓存的会话，尝试从服务器获取详情以补充 directory 字段
      const serverSessionIds = new Set(allSessions.map((s) => s.id));
      logger.debug(`Server session IDs: ${Array.from(serverSessionIds).map(id => id?.slice(-8)).join(', ')}`);

      for (const [dir, session] of this.sessions) {
        logger.debug(`Checking local session: dir="${dir}", id="${session.id?.slice(-8)}", inServer=${serverSessionIds.has(session.id)}`);
        if (!serverSessionIds.has(session.id)) {
          // 尝试从服务器获取详情
          try {
            const detail = await this.httpClient.getSessionDetail(session.id);
            if (detail && detail.id) {
              allSessions.push({
                id: detail.id,
                title: detail.title,
                createdAt: detail.created_at,
                updatedAt: detail.created_at,
                workingDir: detail.directory || dir,
                slug: detail.slug,
              });
              logger.debug(`  Added from server detail: id="${detail.id?.slice(-8)}", dir="${detail.directory || dir}"`);
            } else {
              // 获取详情失败，使用本地缓存
              allSessions.push({
                id: session.id,
                title: session.title,
                createdAt: session.createdAt,
                updatedAt: session.updatedAt,
                workingDir: dir,
                slug: session.slug,
              });
              logger.debug(`  Added from local cache (detail null): id="${session.id?.slice(-8)}", dir="${dir}"`);
            }
          } catch (e) {
            // 获取详情失败，使用本地缓存
            allSessions.push({
              id: session.id,
              title: session.title,
              createdAt: session.createdAt,
              updatedAt: session.updatedAt,
              workingDir: dir,
              slug: session.slug,
            });
            logger.debug(`  Added from local cache (detail error): id="${session.id?.slice(-8)}", dir="${dir}"`);
          }
        }
      }

      // DEBUG: Log all sessions before filtering
      logger.debug(`All sessions before filtering: ${allSessions.length}`);
      for (const s of allSessions) {
        logger.debug(`  Before filter: id="${s.id?.slice(-8)}", workingDir="${s.workingDir}", title="${s.title}"`);
      }

      // 如果指定了目录，进行规范化匹配（客户端过滤）
      // 注意：合并后的会话列表中，本地缓存的会话可能已在上面处理 directory
      let filteredSessions = allSessions;
      if (directory) {
        const targetDir = normalizePath(directory);
        logger.debug(`Filtering by directory: targetDir="${targetDir}" (original="${directory}")`);

        // 只过滤：如果会话有 directory 且与目标目录不匹配，则排除
        // 如果会话没有 directory（未知），则保留（不过滤）
        filteredSessions = allSessions.filter((s) => {
          const shouldKeep = !s.workingDir || pathsEqual(s.workingDir, targetDir);
          logger.debug(`  Filter check: id="${s.id?.slice(-8)}", workingDir="${s.workingDir}", keep=${shouldKeep}`);
          return shouldKeep;
        });

        logger.debug(`After filtering: ${filteredSessions.length} sessions remain`);
      }

      // 应用限制
      if (limit && limit > 0) {
        filteredSessions = filteredSessions.slice(0, limit);
      }

      return filteredSessions;
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
        const normalizedDir = normalizePath(workingDir);
        this.activeWorkingDir = normalizedDir;

        // 直接从服务器获取会话详情来更新本地缓存
        try {
          const detail = await this.httpClient.getSessionDetail(sessionId);
          if (detail && detail.id) {
            const session: OpenCodeSession = {
              id: detail.id,
              title: detail.title,
              createdAt: detail.created_at,
              workingDir: normalizedDir,
              slug: detail.slug,
            };
            this.sessions.set(normalizedDir, session);
            // 持久化会话缓存
            await this.save();
            logger.info(`Updated local cache for ${workingDir}: ${sessionId}`);
          }
        } catch (e) {
          // 获取详情失败，但至少更新 ID
          logger.warn({ err: e }, 'Failed to get session detail after switch, updating ID only');
          // 尝试从现有缓存中找到这个会话并更新
          for (const [dir, session] of this.sessions) {
            if (session.id === sessionId) {
              this.sessions.set(normalizedDir, { ...session });
              await this.save();
              break;
            }
          }
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

      // 持久化会话缓存
      await this.save();

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

      // 持久化会话缓存
      await this.save();

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
