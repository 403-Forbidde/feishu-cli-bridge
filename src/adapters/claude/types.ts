/**
 * Claude Code 适配器类型定义
 * Claude Code Adapter Type Definitions
 *
 * 定义 Claude Code CLI 特有的数据结构和类型
 * 基于 stream-json 输出格式（验证版本：Claude Code v2.1.91）
 *
 * 关键特性：
 * - 支持动态模型检测（从 result.modelUsage 读取实际使用的模型）
 * - 支持第三方 Provider（如 Kimi）通过 ANTHROPIC_BASE_URL 配置
 * - 子进程通信方式（spawn + JSON Lines）
 */

import type { SessionInfo } from '../interface/types.js';
import type { TokenStats } from '../../core/types/stream.js';

/**
 * Claude Code 配置
 * 支持 'auto' 模式用于动态模型检测
 */
export interface ClaudeConfig {
  /** 命令路径（默认为 'claude'） */
  command: string;
  /**
   * 默认模型
   * - 'auto': 从流输出中动态检测（推荐，支持第三方 Provider）
   * - 显式值: 'claude-sonnet-4-6', 'claude-opus-4-6', 'kimi-k2.5' 等
   */
  defaultModel: string | 'auto';
  /**
   * 上下文窗口大小
   * - 'auto': 从流输出中动态检测
   * - 显式值: 200000, 256000 等
   */
  contextWindow: number | 'auto';
  /** 超时时间（秒，默认 300） */
  timeout: number;
  /**
   * 权限模式
   * - default: 默认权限控制
   * - acceptEdits: 自动接受编辑
   * - plan: 计划模式
   * - bypassPermissions: 绕过权限检查（危险）
   */
  permissionMode: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
  /** 允许使用的工具列表 */
  allowedTools: string[];
  /** 临时文件存放目录（用于附件） */
  baseDir: string;
}

/**
 * 从流输出中捕获的模型信息
 * 用于动态检测实际使用的模型（支持第三方 Provider）
 */
export interface DetectedModelInfo {
  /** 模型 ID，如 'kimi-k2.5', 'claude-sonnet-4-6' */
  modelId: string;
  /** 上下文窗口大小，如 200000 */
  contextWindow: number;
  /** 最大输出 Token 数，如 32000 */
  maxOutputTokens: number;
  /** 输入 Token 数 */
  inputTokens?: number;
  /** 输出 Token 数 */
  outputTokens?: number;
  /** 缓存读取的输入 Token 数 */
  cacheReadInputTokens?: number;
  /** 缓存创建的输入 Token 数 */
  cacheCreationInputTokens?: number;
  /** 费用估算（USD） */
  costUSD?: number;
}

/**
 * Claude Code 会话信息
 * 使用 UUID 作为 session-id，通过 --session-id 参数传递
 */
export interface ClaudeSession extends SessionInfo {
  /** 工作目录（Claude Code 的会话与工作目录绑定） */
  workingDir: string;
  /** 会话 ID（UUID） */
  sessionId: string;
  /** 最后使用时间 */
  lastUsedAt: number;
}

/**
 * 流式处理状态
 */
export interface StreamState {
  /** 是否已看到消息开始 */
  seenMessageStart: boolean;
  /** 是否已看到消息结束 */
  seenMessageStop: boolean;
  /** 已发出的文本长度 */
  emittedTextLength: number;
  /** 已发出的思考内容长度 */
  emittedReasoningLength: number;
  /** 当前累积的完整文本 */
  accumulatedText: string;
  /** 当前累积的思考内容 */
  accumulatedReasoning: string;
  /** 当前统计信息（从 message_delta 中捕获） */
  currentStats?: Partial<TokenStats>;
  /** 检测到的模型信息（从 result.modelUsage 中捕获） */
  detectedModel?: DetectedModelInfo;
}

/**
 * Claude Code Stream JSON 事件类型
 * 基于 doc/claude-stream-format.md 定义
 */

/**
 * 系统初始化事件
 */
export interface SystemInitEvent {
  type: 'system';
  subtype: 'init';
  cwd: string;
  session_id: string;
  model: string;
  permissionMode: string;
  claude_code_version: string;
}

/**
 * 消息开始事件
 */
export interface MessageStartEvent {
  type: 'stream_event';
  event: {
    type: 'message_start';
    message: {
      id: string;
      usage: {
        input_tokens: number;
        cache_creation_input_tokens: number;
        cache_read_input_tokens: number;
      };
    };
  };
  session_id: string;
}

/**
 * 内容块增量（文本或思考）
 */
export interface ContentBlockDeltaEvent {
  type: 'stream_event';
  event: {
    type: 'content_block_delta';
    index: number;
    delta: TextDelta | ThinkingDelta;
  };
}

/**
 * 文本增量
 */
export interface TextDelta {
  type: 'text_delta';
  text: string;
}

/**
 * 思考内容增量
 */
export interface ThinkingDelta {
  type: 'thinking_delta';
  thinking: string;
}

/**
 * 消息增量（包含 usage 信息）
 */
export interface MessageDeltaEvent {
  type: 'stream_event';
  event: {
    type: 'message_delta';
    delta: {
      stop_reason: string;
    };
    usage: {
      input_tokens: number;
      output_tokens: number;
      completion_tokens: number;
      total_tokens: number;
      cache_read_input_tokens: number;
    };
  };
}

/**
 * 消息停止事件
 */
export interface MessageStopEvent {
  type: 'stream_event';
  event: {
    type: 'message_stop';
  };
}

/**
 * ModelUsage 详细信息
 * 支持两种字段命名方式：驼峰式和下划线式（来自 CLI JSON 输出）
 */
export interface ModelUsage {
  // 驼峰式（内部使用）
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  costUSD?: number;
  contextWindow?: number;
  maxOutputTokens?: number;
  // 下划线式（来自 CLI JSON 输出）
  input_tokens?: number;
  output_tokens?: number;
  completion_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cost_usd?: number;
  context_window?: number;
  max_output_tokens?: number;
}

/**
 * 成功结果事件
 */
export interface SuccessResultEvent {
  type: 'result';
  subtype: 'success';
  is_error: false;
  result: string;
  session_id: string;
  total_cost_usd: number;
  /** usage 字段在某些 Provider（如 Kimi）中可能缺失 */
  usage?: {
    input_tokens: number;
    output_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  modelUsage: Record<string, ModelUsage>;
}

/**
 * 错误结果事件
 */
export interface ErrorResultEvent {
  type: 'result';
  subtype: 'error_during_execution' | string;
  is_error: true;
  terminal_reason: string;
  errors: string[];
}

/**
 * 用户中断事件
 */
export interface UserInterruptEvent {
  type: 'user';
  message: {
    role: 'user';
    content: Array<{ type: 'text'; text: string }>;
  };
}

/**
 * 联合类型：所有可能的 Stream JSON 事件
 */
export type ClaudeStreamEvent =
  | SystemInitEvent
  | MessageStartEvent
  | ContentBlockDeltaEvent
  | MessageDeltaEvent
  | MessageStopEvent
  | SuccessResultEvent
  | ErrorResultEvent
  | UserInterruptEvent
  | Record<string, unknown>;

/**
 * 子进程管理选项
 */
export interface ProcessManagerOptions {
  /** 命令路径 */
  command: string;
  /** 超时时间（毫秒） */
  timeoutMs: number;
  /** 可选配置覆盖 */
  env?: Partial<ClaudeConfig>;
  /** 工作目录 */
  cwd?: string;
}

/**
 * 子进程执行结果
 */
export interface ProcessResult {
  /** 退出码 */
  exitCode: number | null;
  /** 是否被信号终止 */
  signal: string | null;
  /** 标准错误输出 */
  stderr: string;
}

/**
 * 会话持久化数据
 * 存储在工作目录下的 .claude-sessions.json 中
 */
export interface SessionPersistence {
  /** 版本号 */
  version: number;
  /** 会话映射表 */
  sessions: Record<
    string,
    {
      /** 会话 ID（UUID） */
      sessionId: string;
      /** 创建时间 */
      createdAt: number;
      /** 最后使用时间 */
      lastUsedAt: number;
    }
  >;
}

/**
 * 解析器配置
 */
export interface StreamParserOptions {
  /** 是否保留原始事件 */
  preserveRawEvents?: boolean;
  /** 最大缓冲区大小（字节） */
  maxBufferSize?: number;
}

/**
 * 适配器运行时状态
 */
export interface AdapterRuntimeState {
  /** 当前活跃的子进程 */
  activeProcess: import('child_process').ChildProcess | null;
  /** 当前会话 ID */
  currentSessionId: string | null;
  /** 当前工作目录 */
  currentWorkingDir: string | null;
  /** 检测到的模型信息（缓存） */
  cachedModelInfo: DetectedModelInfo | null;
  /** 是否正在生成 */
  isGenerating: boolean;
}
