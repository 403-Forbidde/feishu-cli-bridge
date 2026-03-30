/**
 * OpenCode 适配器模块
 * OpenCode Adapter Module
 *
 * 导出 OpenCode 适配器的所有组件
 */

export { OpenCodeAdapter } from './adapter.js';
export { OpenCodeHTTPClient } from './http-client.js';
export { OpenCodeServerManager } from './server-manager.js';
export { OpenCodeSessionManager } from './session-manager.js';
export { OpenCodeEventParser, createOpenCodeEventIterator } from './sse-parser.js';

export type {
  OpenCodeSession,
  StreamState,
  OpenCodeConfig,
  ServerHealth,
  CreateSessionResponse,
  ListSessionsResponse,
  SSEMessage,
  SSEEventType,
  OpenCodeMessage,
  ChatRequest,
  ContextWindowCacheEntry,
} from './types.js';

export type {
  ServerManagerOptions,
} from './server-manager.js';

export type {
  SessionManagerOptions,
} from './session-manager.js';
