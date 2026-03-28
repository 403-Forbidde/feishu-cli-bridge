/**
 * Streaming system
 * 流式卡片系统
 *
 * 提供流式消息展示的核心组件：
 * - FlushController: 节流刷新控制器
 * - StreamingCardController: 流式卡片状态机
 */

export { FlushController } from './flush-controller.js';
export { StreamingCardController } from './controller.js';
export type { StreamingCardControllerOptions, FeishuAPICardMethods } from './controller.js';
export type { StreamingPhase, StreamingConfig, StreamingState } from './types.js';
