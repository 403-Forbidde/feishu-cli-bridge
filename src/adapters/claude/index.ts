/**
 * Claude Code 适配器模块
 * Claude Code Adapter Module
 *
 * 导出 Claude Code 适配器的所有组件
 *
 * 特性：
 * - 子进程通信（spawn + JSON Lines）
 * - 动态模型检测（支持第三方 Provider）
 * - SIGINT 信号停止生成
 * - @filepath 文件引用语法
 */

// 导出主适配器类（阶段 1.4 已实现）
export { ClaudeCodeAdapter } from './adapter.js';

// 导出子进程管理器（阶段 1.2 已实现）
export { ClaudeCodeProcessManager } from './process-manager.js';

// 导出流式解析器（阶段 1.3 实现）
export {
  ClaudeCodeStreamParser,
  createClaudeStreamIterator,
  createClaudeProcessStream,
} from './stream-parser.js';

// 导出会话管理器（阶段 2.1 已提前实现）
export { ClaudeCodeSessionManager } from './session-manager.js';

// 导出类型定义（阶段 1.1 已完成）
export type {
  // 配置类型
  ClaudeConfig,
  ProcessManagerOptions,
  StreamParserOptions,

  // 模型检测类型
  DetectedModelInfo,
  ModelUsage,

  // 会话类型
  ClaudeSession,
  SessionPersistence,

  // 流状态类型
  StreamState,
  AdapterRuntimeState,

  // 流事件类型
  ClaudeStreamEvent,
  SystemInitEvent,
  MessageStartEvent,
  ContentBlockDeltaEvent,
  TextDelta,
  ThinkingDelta,
  MessageDeltaEvent,
  MessageStopEvent,
  SuccessResultEvent,
  ErrorResultEvent,
  UserInterruptEvent,

  // 执行结果类型
  ProcessResult,
} from './types.js';
