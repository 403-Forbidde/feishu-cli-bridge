/**
 * Streaming system types
 * 流式卡片系统类型定义
 */

/**
 * 流式卡片阶段
 */
export type StreamingPhase =
  | 'idle' // 初始状态
  | 'creating' // 正在创建卡片
  | 'streaming' // 正在流式更新
  | 'completed' // 正常完成
  | 'aborted'; // 被中断

/**
 * 流式卡片配置
 */
export interface StreamingConfig {
  /** CardKit 模式更新间隔（毫秒） */
  cardKitInterval: number;
  /** IM Patch 模式更新间隔（毫秒） */
  imPatchInterval: number;
  /** 长间隔检测阈值（毫秒） */
  longGapThreshold: number;
  /** 最大消息长度 */
  maxMessageLength: number;
}

/**
 * 流式卡片状态
 */
export interface StreamingState {
  /** 当前阶段 */
  phase: StreamingPhase;
  /** 当前内容 */
  content: string;
  /** 思考内容 */
  reasoningContent: string;
  /** 开始时间 */
  startTime: number;
  /** 消息 ID */
  messageId?: string;
  /** 卡片 ID */
  cardId?: string;
}
