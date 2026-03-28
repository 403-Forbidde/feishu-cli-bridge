/**
 * 会话管理类型定义
 * Session Management Type Definitions
 *
 * 定义用户会话、会话状态等相关类型
 */

import type { Message } from '../adapters/interface/types.js';

/**
 * 会话信息
 */
export interface Session {
  /** 用户唯一标识 */
  userId: string;

  /** 当前 CLI 类型 */
  cliType: string;

  /** 工作目录 */
  workingDir: string;

  /** 对话历史 */
  history: Message[];

  /** 最后活动时间 */
  lastActivity: number;

  /** 关联的项目 ID */
  projectId?: string;
}

/**
 * 会话配置
 */
export interface SessionConfig {
  /** 最大会话数（LRU 清理阈值） */
  maxSessions: number;

  /** 最大历史消息数 */
  maxHistory: number;

  /** 会话超时时间（毫秒） */
  timeoutMs?: number;
}

/**
 * 会话统计
 */
export interface SessionStats {
  /** 总会话数 */
  totalSessions: number;

  /** 活跃会话数 */
  activeSessions: number;

  /** 总消息数 */
  totalMessages: number;
}
