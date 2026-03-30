/**
 * Stream chunk types for AI responses
 */

export enum StreamChunkType {
  CONTENT = 'content',
  REASONING = 'reasoning',
  ERROR = 'error',
  DONE = 'done',
  STATS = 'stats',
  /** 完整内容传递（用于最终卡片构建） */
  DELIVER = 'deliver',
}

export interface StreamChunk {
  type: StreamChunkType;
  data: string;
  stats?: TokenStats;
}

export interface TokenStats {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  contextUsed: number;
  contextWindow: number;
  contextPercent: number;
  model?: string;
}
