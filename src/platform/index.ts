/**
 * Feishu platform layer
 * 飞书平台层入口
 *
 * 导出飞书相关的所有类型和类
 */

// 类型定义
export type {
  Attachment,
  FeishuMessage,
  MessageResult,
  CardCallbackData,
  CardCallbackEvent,
  CardCallbackResponse,
  MessageHandler,
  CardCallbackHandler,
  WSEvent,
  RawMessageEvent,
  RawCardCallbackEvent,
  FeishuAPIResponse,
  FileDownloadResult,
} from './types.js';

// FeishuErrorCode enum（只从这里导出）
export { FeishuErrorCode } from './types.js';

// Feishu API
export { FeishuAPI, type StatsProvider } from './feishu-api.js';

// Feishu Client
export {
  FeishuClient,
  createFeishuClient,
  type FeishuClientOptions,
} from './feishu-client.js';

// Streaming system
export {
  FlushController,
  type StreamingPhase,
  type StreamingConfig,
  type StreamingState,
} from './streaming/index.js';
