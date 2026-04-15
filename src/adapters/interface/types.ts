/**
 * 适配器接口层类型定义
 * Adapter Interface Layer Type Definitions
 *
 * 定义 CLI 适配器的抽象接口和共享类型
 * 当前仅实现 OpenCode，设计支持未来扩展其他 CLI 工具
 */

import type { StreamChunk, TokenStats } from '../../core/types/stream.js';

/**
 * 对话消息角色
 */
export type MessageRole = 'user' | 'assistant';

/**
 * 对话消息
 */
export interface Message {
  role: MessageRole;
  content: string;
  timestamp?: number;
}

/**
 * 会话统计摘要
 */
export interface SessionSummary {
  additions: number;
  deletions: number;
  files: number;
}

/**
 * 会话信息
 */
export interface SessionInfo {
  id: string;
  title: string;
  createdAt: number;
  updatedAt?: number;
  workingDir: string;
  slug?: string;
  version?: string;
  summary?: SessionSummary;
}

/**
 * Agent 信息
 */
export interface AgentInfo {
  id: string;
  name: string;
  description?: string;
  color?: string;
}

/**
 * 模型能力信息
 */
export interface ModelCapabilities {
  temperature?: boolean;
  reasoning?: boolean;
  attachment?: boolean;
  toolcall?: boolean;
  input?: {
    text?: boolean;
    image?: boolean;
    audio?: boolean;
    video?: boolean;
    pdf?: boolean;
  };
  output?: {
    text?: boolean;
    image?: boolean;
    audio?: boolean;
    video?: boolean;
    pdf?: boolean;
  };
}

/**
 * 模型信息
 */
export interface ModelInfo {
  id: string;
  name: string;
  provider?: string;
  contextWindow?: number;
  capabilities?: ModelCapabilities;
}

/**
 * 适配器配置
 */
export interface AdapterConfig {
  enabled: boolean;
  command: string;
  defaultModel: string;
  timeout: number;
  models: Array<{ id: string; name: string } | string>;
  serverPassword?: string;
}

/**
 * CLI 适配器接口
 * 所有 CLI 工具适配器必须实现此接口
 */
export interface ICLIAdapter {
  /** 适配器名称 */
  readonly name: string;

  /** 默认模型 ID */
  readonly defaultModel: string;

  /** 上下文窗口大小（token 数） */
  readonly contextWindow: number;

  /**
   * 执行流式对话
   * @param prompt - 用户输入
   * @param context - 历史消息上下文
   * @param workingDir - 工作目录
   * @param attachments - 附件列表（可选）
   * @returns 流式响应块
   */
  executeStream(
    prompt: string,
    context: Message[],
    workingDir: string,
    attachments?: Attachment[]
  ): AsyncIterable<StreamChunk>;

  /**
   * 创建新会话
   * @param workingDir - 工作目录（可选）
   * @returns 会话信息或 null
   */
  createNewSession(workingDir?: string): Promise<SessionInfo | null>;

  /**
   * 列出会话
   * @param limit - 最大数量
   * @param directory - 指定目录（可选）
   * @returns 会话列表
   */
  listSessions(limit?: number, directory?: string): Promise<SessionInfo[]>;

  /**
   * 切换会话
   * @param sessionId - 会话 ID
   * @param workingDir - 工作目录（可选）
   * @returns 是否成功
   */
  switchSession(sessionId: string, workingDir?: string): Promise<boolean>;

  /**
   * 重置当前会话
   * @returns 是否成功
   */
  resetSession(): Promise<boolean>;

  /**
   * 重命名会话
   * @param sessionId - 会话 ID
   * @param title - 新标题
   * @returns 是否成功
   */
  renameSession(sessionId: string, title: string): Promise<boolean>;

  /**
   * 删除会话
   * @param sessionId - 会话 ID
   * @returns 是否成功
   */
  deleteSession(sessionId: string): Promise<boolean>;

  /**
   * 列出可用模型
   * @param provider - 提供商筛选（可选）
   * @returns 模型列表
   */
  listModels(provider?: string): Promise<ModelInfo[]>;

  /**
   * 切换模型
   * @param modelId - 模型 ID
   * @returns 是否成功
   */
  switchModel(modelId: string): Promise<boolean>;

  /**
   * 获取当前模型 ID
   * @returns 模型 ID
   */
  getCurrentModel(): string;

  /**
   * 停止生成
   * @returns 是否成功
   */
  stopGeneration(): Promise<boolean>;

  /**
   * 计算 Token 统计
   * @param context - 历史消息
   * @param completionText - 完整回复文本
   * @returns Token 统计信息
   */
  getStats(context: Message[], completionText: string): TokenStats;

  /**
   * 获取当前工作目录的会话 ID（可选实现）
   * @param workingDir - 工作目录
   * @returns 会话 ID 或 null
   */
  getSessionId?(workingDir: string): string | null;

  /**
   * 获取支持的 TUI 命令列表
   * @returns 命令名称数组（不含前导斜杠）
   */
  getSupportedTUICommands(): string[];
}

/**
 * 附件信息
 */
export interface Attachment {
  fileKey: string;
  resourceType: 'image' | 'file';
  filename: string;
  mimeType: string;
  path?: string;
  data?: Buffer;
}

/**
 * 适配器错误类型
 */
export enum AdapterErrorCode {
  SERVER_NOT_RUNNING = 'SERVER_NOT_RUNNING',
  SERVER_UNREACHABLE = 'SERVER_UNREACHABLE',
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
  MODEL_NOT_FOUND = 'MODEL_NOT_FOUND',
  RATE_LIMITED = 'RATE_LIMITED',
  INVALID_REQUEST = 'INVALID_REQUEST',
  STREAM_ERROR = 'STREAM_ERROR',
  UNKNOWN = 'UNKNOWN',
}

/**
 * 适配器错误
 */
export class AdapterError extends Error {
  constructor(
    message: string,
    public readonly code: AdapterErrorCode,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'AdapterError';
  }
}
