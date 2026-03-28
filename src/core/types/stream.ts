/**
 * Stream chunk types for AI responses
 */

export enum StreamChunkType {
  CONTENT = 'content',
  REASONING = 'reasoning',
  ERROR = 'error',
  DONE = 'done',
}

export interface StreamChunk {
  type: StreamChunkType;
  data: string;
}

export interface TokenStats {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  contextUsed: number;
  contextWindow: number;
  contextPercent: number;
}
