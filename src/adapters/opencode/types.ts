/**
 * OpenCode 适配器类型定义
 * OpenCode Adapter Type Definitions
 *
 * 定义 OpenCode 特有的数据结构和类型
 */

import type { SessionInfo } from '../interface/types.js';
import type { TokenStats } from '../../core/types/stream.js';

/**
 * OpenCode 会话信息
 */
export interface OpenCodeSession extends SessionInfo {
  /** 会话 slug（可读标识） */
  slug: string;
}

/**
 * 流式处理状态（每轮对话独立）
 */
export interface StreamState {
  /** 是否已看到 assistant 消息 */
  seenAssistantMessage: boolean;
  /** 是否已跳过用户文本 */
  userTextSkipped: boolean;
  /** 已发出的文本长度 */
  emittedTextLength: number;
  /** 提示词哈希（用于去重检测） */
  promptHash?: number;
  /** 当前统计信息 */
  currentStats?: TokenStats;
}

/**
 * OpenCode HTTP API 响应类型
 */

/**
 * 会话创建响应
 */
export interface CreateSessionResponse {
  id: string;
  title: string;
  created_at: number;
  slug: string;
  directory?: string;
}

/**
 * 会话列表响应
 */
export interface ListSessionsResponse {
  sessions: Array<{
    id: string;
    title: string;
    created_at: number;
    updated_at?: number;
    slug: string;
    directory?: string;
  }>;
}

/**
 * SSE 事件类型
 */
export enum SSEEventType {
  MESSAGE = 'message',
  REASONING = 'reasoning',
  STATS = 'stats',
  ERROR = 'error',
  DONE = 'done',
}

/**
 * SSE 消息结构
 */
export interface SSEMessage {
  type: SSEEventType;
  data: unknown;
}

/**
 * OpenCode 消息格式
 */
export interface OpenCodeMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * 聊天请求体
 */
export interface ChatRequest {
  messages: OpenCodeMessage[];
  model?: string;
  session?: string;
  stream?: boolean;
  attachments?: Array<{
    type: 'image' | 'file';
    data: string; // base64
    mime_type: string;
    filename: string;
  }>;
}

/**
 * 上下文窗口缓存项
 */
export interface ContextWindowCacheEntry {
  window: number;
  timestamp: number;
}

/**
 * OpenCode 配置
 */
export interface OpenCodeConfig {
  /** 服务器端口 */
  serverPort: number;
  /** 服务器主机名 */
  serverHostname: string;
  /** 默认模型 */
  defaultModel: string;
  /** 默认 Agent */
  defaultAgent: string;
  /** 命令路径 */
  command: string;
  /** 超时时间（秒） */
  timeout: number;
}

/**
 * 服务器健康状态
 */
export interface ServerHealth {
  /** 是否健康 */
  healthy: boolean;
  /** 响应时间（ms） */
  responseTime?: number;
  /** 错误信息 */
  error?: string;
}
