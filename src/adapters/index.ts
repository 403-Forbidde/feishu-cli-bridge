/**
 * 适配器层
 * Adapter Layer
 *
 * CLI 工具适配器统一出口
 */

// 接口定义
export * from './interface/index.js';

// 工厂
export * from './factory.js';

// 接口定义
export * from './interface/index.js';

// 工厂
export * from './factory.js';

// OpenCode 适配器 - 按需导出，避免类型冲突
export { OpenCodeAdapter } from './opencode/adapter.js';

// Claude Code 适配器 - 按需导出，避免类型冲突
export { ClaudeCodeAdapter } from './claude/adapter.js';
export type { ClaudeConfig, DetectedModelInfo } from './claude/types.js';

// 注册适配器
import { OpenCodeAdapter } from './opencode/adapter.js';
import { ClaudeCodeAdapter } from './claude/adapter.js';
import { registerAdapter } from './factory.js';

registerAdapter('opencode', OpenCodeAdapter);
registerAdapter('claude', ClaudeCodeAdapter);
