/**
 * Card Builder Index
 * 卡片构建器主入口
 *
 * 统一导出所有卡片构建功能
 */

// 常量
export { STREAMING_ELEMENT_ID, REASONING_ELEMENT_ID } from './constants.js';

// 工具函数
export {
  optimizeMarkdownStyle,
  formatReasoningDuration,
  formatElapsed,
  simplifyModelName,
  truncateText,
  escapeMarkdown,
} from './utils.js';

// 核心卡片
export { buildCardContent, type CardData, type FeishuCard, type CardElement } from './base.js';

// 交互式卡片
export {
  buildModeSelectCard,
  buildModelSelectCard,
  buildHelpCard,
  buildResetSuccessCard,
  buildTestCardV2Initial,
  buildTestCardV2Details,
  buildTestCardV2Data,
  buildTestCardV2Closed,
  type AgentInfo,
  type ModelInfo,
} from './interactive-cards.js';

// 会话卡片
export {
  buildNewSessionCard,
  buildSessionListCard,
  buildSessionInfoCard,
  type SessionData,
  type NewSessionCardOptions,
} from './session-cards.js';

// 项目卡片
export {
  buildProjectListCard,
  buildProjectInfoCard,
  type ProjectInfo,
} from './project-cards.js';
