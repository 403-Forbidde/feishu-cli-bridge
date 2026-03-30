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
  /** 已发出的文本长度（content） */
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
 * 消息部件（用于 prompt_async）
 */
export interface MessagePart {
  type: 'text' | 'file';
  text?: string;
  mime?: string;
  url?: string;
  filename?: string;
}

/**
 * prompt_async 请求体
 */
export interface PromptAsyncRequest {
  parts: MessagePart[];
  model: {
    providerID: string;
    modelID: string;
  };
  agent: string;
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

/**
 * Provider 信息（从 /provider API 获取）
 */
export interface ProviderInfo {
  /** Provider ID */
  id: string;
  /** Provider 名称 */
  name?: string;
  /** 模型列表 */
  models?: Record<string, ModelLimitInfo>;
}

/**
 * 模型限制信息
 */
export interface ModelLimitInfo {
  /** 限制信息 */
  limit?: {
    /** 上下文窗口大小 */
    context?: number;
  };
}

/**
 * OpenCode SSE 事件（从 /event 端点接收）
 */
export interface OpenCodeSSEEvent {
  /** 事件类型 */
  type: string;
  /** 事件属性 */
  properties?: {
    /** 字段名（用于 message.part.delta） */
    field?: string;
    /** 增量文本 */
    delta?: string;
    /** 部件信息（用于 message.part.updated） */
    part?: {
      type: string;
      text?: string;
      tokens?: {
        total?: number;
        total_tokens?: number;
        input?: number;
        input_tokens?: number;
        prompt_tokens?: number;
        output?: number;
        output_tokens?: number;
        completion_tokens?: number;
      };
    };
    /** 错误消息 */
    message?: string;
  };
}
