/**
 * Claude Code Stream JSON 解析器
 * Claude Code Stream JSON Parser
 *
 * 解析 Claude Code CLI 的 stream-json 输出，转换为 StreamChunk
 * 基于 doc/claude-stream-format.md 定义的事件格式
 *
 * 事件映射：
 * - content_block_delta + text_delta → CONTENT
 * - content_block_delta + thinking_delta → REASONING
 * - message_delta (含 usage) → 缓存 stats
 * - message_stop / result (success) → DONE
 * - result (error) → ERROR
 */

import { StreamChunkType, type StreamChunk, type TokenStats } from '../../core/types/stream.js';
import { logger } from '../../core/logger.js';
import type {
  ClaudeStreamEvent,
  ContentBlockDeltaEvent,
  MessageDeltaEvent,
  MessageStopEvent,
  SuccessResultEvent,
  ErrorResultEvent,
  SystemInitEvent,
  StreamState,
  DetectedModelInfo,
} from './types.js';

/**
 * Claude Code 流解析器
 * 将子进程 stdout 的 JSON Lines 转换为 StreamChunk
 */
export class ClaudeCodeStreamParser {
  private streamState: StreamState;
  private options: { preserveRawEvents?: boolean };

  constructor(options: { preserveRawEvents?: boolean } = {}) {
    this.options = options;
    this.streamState = this.createInitialState();
  }

  /**
   * 创建初始流状态
   */
  private createInitialState(): StreamState {
    return {
      seenMessageStart: false,
      seenMessageStop: false,
      emittedTextLength: 0,
      emittedReasoningLength: 0,
      accumulatedText: '',
      accumulatedReasoning: '',
    };
  }

  /**
   * 重置流状态（新对话开始时调用）
   */
  resetState(): void {
    this.streamState = this.createInitialState();
  }

  /**
   * 获取当前流状态（用于调试）
   */
  getState(): Readonly<StreamState> {
    return this.streamState;
  }

  /**
   * 获取检测到的模型信息
   */
  getDetectedModel(): DetectedModelInfo | undefined {
    return this.streamState.detectedModel;
  }

  /**
   * 获取当前统计信息
   */
  getCurrentStats(): Partial<TokenStats> | undefined {
    return this.streamState.currentStats;
  }

  /**
   * 解析单行 JSON
   * @param line 一行文本（应该为 JSON 格式）
   * @returns StreamChunk 或 null（如果事件不产生输出）
   */
  parseLine(line: string): StreamChunk | null {
    const trimmedLine = line.trim();
    if (!trimmedLine) {
      return null;
    }

    try {
      const event = JSON.parse(trimmedLine) as ClaudeStreamEvent;
      return this.processEvent(event);
    } catch (error) {
      // JSON 解析失败，可能是非 JSON 输出（如警告信息）
      logger.debug(`Failed to parse JSON line: ${trimmedLine.substring(0, 100)}`);
      return null;
    }
  }

  /**
   * 处理解析后的事件
   * @param event Claude Stream JSON 事件
   * @returns StreamChunk 或 null
   */
  private processEvent(event: ClaudeStreamEvent): StreamChunk | null {
    const eventType = event.type;

    switch (eventType) {
      case 'system':
        return this.handleSystemEvent(event as SystemInitEvent);

      case 'stream_event':
        return this.handleStreamEvent(event);

      case 'result':
        return this.handleResultEvent(event as SuccessResultEvent | ErrorResultEvent);

      case 'user':
        // 用户中断事件，忽略（result 事件会处理错误）
        logger.debug('User interrupt event received');
        return null;

      default:
        // 未知事件类型，记录调试信息
        logger.debug(`Unknown event type: ${eventType}`);
        return null;
    }
  }

  /**
   * 处理系统初始化事件
   */
  private handleSystemEvent(event: SystemInitEvent): null {
    logger.info(
      { model: event.model, version: event.claude_code_version, cwd: event.cwd },
      'Claude Code system init'
    );
    // 系统事件不产出 chunk，只记录信息
    return null;
  }

  /**
   * 处理流事件（stream_event 类型）
   */
  private handleStreamEvent(event: ClaudeStreamEvent): StreamChunk | null {
    const streamEvent = (event as { event?: { type?: string } }).event;
    if (!streamEvent?.type) {
      return null;
    }

    const subType = streamEvent.type;

    switch (subType) {
      case 'message_start':
        this.streamState.seenMessageStart = true;
        logger.debug('Message start event');
        return null;

      case 'content_block_delta':
        return this.handleContentBlockDelta(event as ContentBlockDeltaEvent);

      case 'message_delta':
        return this.handleMessageDelta(event as MessageDeltaEvent);

      case 'message_stop':
        this.streamState.seenMessageStop = true;
        logger.debug('Message stop event');
        return null;

      default:
        logger.debug(`Unknown stream_event subtype: ${subType}`);
        return null;
    }
  }

  /**
   * 处理内容块增量事件（文本或思考）
   */
  private handleContentBlockDelta(event: ContentBlockDeltaEvent): StreamChunk | null {
    const delta = event.event.delta;

    // 文本增量
    if (delta.type === 'text_delta') {
      const text = delta.text;
      if (!text) {
        return null;
      }

      this.streamState.accumulatedText += text;
      this.streamState.emittedTextLength += text.length;

      return {
        type: StreamChunkType.CONTENT,
        data: text,
      };
    }

    // 思考内容增量
    if (delta.type === 'thinking_delta') {
      const thinking = delta.thinking;
      if (!thinking) {
        return null;
      }

      this.streamState.accumulatedReasoning += thinking;
      this.streamState.emittedReasoningLength += thinking.length;

      return {
        type: StreamChunkType.REASONING,
        data: thinking,
      };
    }

    return null;
  }

  /**
   * 处理消息增量事件（包含 usage 信息）
   */
  private handleMessageDelta(event: MessageDeltaEvent): StreamChunk | null {
    const usage = event.event.usage;
    if (!usage) {
      return null;
    }

    // 缓存 stats 信息
    const stats: Partial<TokenStats> = {
      promptTokens: usage.input_tokens,
      completionTokens: usage.output_tokens || usage.completion_tokens,
      totalTokens: usage.total_tokens,
    };

    this.streamState.currentStats = stats;

    // 产出 STATS chunk
    return {
      type: StreamChunkType.STATS,
      data: '',
      stats: {
        totalTokens: usage.total_tokens || 0,
        promptTokens: usage.input_tokens || 0,
        completionTokens: usage.output_tokens || usage.completion_tokens || 0,
        contextUsed: usage.total_tokens || 0,
        contextWindow: this.streamState.detectedModel?.contextWindow || 200000,
        contextPercent: 0, // 由适配器计算
      },
    };
  }

  /**
   * 处理结果事件（成功或错误）
   */
  private handleResultEvent(
    event: SuccessResultEvent | ErrorResultEvent
  ): StreamChunk | null {
    if (event.is_error) {
      // 错误结果
      const errorEvent = event as ErrorResultEvent;
      const errorMsg = errorEvent.errors?.join(', ') || errorEvent.terminal_reason || 'Unknown error';
      logger.error({ terminalReason: errorEvent.terminal_reason }, 'Claude Code error result');

      return {
        type: StreamChunkType.ERROR,
        data: errorMsg,
      };
    }

    // 成功结果
    const successEvent = event as SuccessResultEvent;

    // 调试日志：记录 result 事件的原始数据
    logger.debug({
      hasUsage: !!successEvent.usage,
      hasModelUsage: !!successEvent.modelUsage,
      usageKeys: successEvent.usage ? Object.keys(successEvent.usage) : [],
      modelUsageKeys: successEvent.modelUsage ? Object.keys(successEvent.modelUsage) : [],
    }, 'Parsing result event');

    // 提取模型信息
    if (successEvent.modelUsage) {
      const modelEntries = Object.entries(successEvent.modelUsage);
      if (modelEntries.length > 0) {
        const [modelId, usage] = modelEntries[0];
        // 支持两种字段命名方式：驼峰式(inputTokens)和下划线式(input_tokens)
        const inputTokens = usage.inputTokens ?? usage.input_tokens ?? 0;
        const outputTokens = usage.outputTokens ?? usage.output_tokens ?? 0;
        const contextWindow = usage.contextWindow ?? usage.context_window ?? 200000;
        const maxOutputTokens = usage.maxOutputTokens ?? usage.max_output_tokens ?? 32000;
        const cacheReadInputTokens = usage.cacheReadInputTokens ?? usage.cache_read_input_tokens ?? 0;
        const cacheCreationInputTokens = usage.cacheCreationInputTokens ?? usage.cache_creation_input_tokens ?? 0;
        const costUSD = usage.costUSD ?? usage.cost_usd ?? 0;

        this.streamState.detectedModel = {
          modelId,
          contextWindow,
          maxOutputTokens,
          inputTokens,
          outputTokens,
          cacheReadInputTokens,
          cacheCreationInputTokens,
          costUSD,
        };
        logger.info({
          modelId,
          contextWindow,
          inputTokens,
          outputTokens,
        }, 'Detected model from result');
      }
    }

    // 更新 stats（result 中的 usage 是最完整的）
    if (successEvent.usage) {
      const inputTokens = successEvent.usage.input_tokens ?? 0;
      const outputTokens = successEvent.usage.output_tokens ?? successEvent.usage.completion_tokens ?? 0;
      const totalTokens = successEvent.usage.total_tokens ?? (inputTokens + outputTokens);

      this.streamState.currentStats = {
        promptTokens: inputTokens,
        completionTokens: outputTokens,
        totalTokens: totalTokens,
      };

      logger.debug({
        inputTokens,
        outputTokens,
        totalTokens,
        source: 'usage',
      }, 'Updated stats from result.usage');
    } else if (this.streamState.detectedModel) {
      // 备选：从 modelUsage 中提取统计信息
      const model = this.streamState.detectedModel;
      const inputTokens = model.inputTokens ?? 0;
      const outputTokens = model.outputTokens ?? 0;

      this.streamState.currentStats = {
        promptTokens: inputTokens,
        completionTokens: outputTokens,
        totalTokens: inputTokens + outputTokens,
      };

      logger.debug({
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        source: 'modelUsage',
      }, 'Updated stats from modelUsage');
    } else {
      logger.debug('No usage data found in result event');
    }

    // 成功结果产出 DONE
    return {
      type: StreamChunkType.DONE,
      data: '',
    };
  }

  /**
   * 生成最终的 DELIVER chunk
   * 包含累积的完整文本内容
   */
  createDeliverChunk(): StreamChunk | null {
    const text = this.streamState.accumulatedText;
    if (!text) {
      return null;
    }

    return {
      type: StreamChunkType.DELIVER,
      data: text,
    };
  }

  /**
   * 生成错误 chunk
   */
  createErrorChunk(message: string): StreamChunk {
    return {
      type: StreamChunkType.ERROR,
      data: message,
    };
  }
}

/**
 * 创建异步迭代器，从子进程 stdout 产出 StreamChunk
 *
 * 使用示例：
 * ```typescript
 * const parser = new ClaudeCodeStreamParser();
 * const processManager = new ClaudeCodeProcessManager(...);
 *
 * const stream = createClaudeStreamIterator(
 *   (onData) => processManager.onStdout(onData),
 *   parser
 * );
 *
 * for await (const chunk of stream) {
 *   // 处理 chunk
 * }
 * ```
 */
export async function* createClaudeStreamIterator(
  stdoutHandler: (callback: (data: string) => void) => void,
  parser: ClaudeCodeStreamParser
): AsyncIterable<StreamChunk> {
  let buffer = '';
  const lines: string[] = [];
  let streamEnded = false;
  let streamError: Error | null = null;

  // 设置 stdout 处理器
  stdoutHandler((data: string) => {
    buffer += data;

    // 按行分割处理
    const parts = buffer.split('\n');
    buffer = parts.pop() || ''; // 保留最后一个不完整的行

    for (const line of parts) {
      if (line.trim()) {
        lines.push(line);
      }
    }
  });

  try {
    while (!streamEnded || lines.length > 0) {
      // 处理所有已缓冲的行
      while (lines.length > 0) {
        const line = lines.shift()!;
        const chunk = parser.parseLine(line);

        if (chunk) {
          // 检查是否是终止 chunk
          if (chunk.type === StreamChunkType.DONE || chunk.type === StreamChunkType.ERROR) {
            yield chunk;
            streamEnded = true;
            return;
          }
          yield chunk;
        }
      }

      // 如果没有行需要处理，等待一小段时间
      if (!streamEnded && lines.length === 0) {
        await sleep(50);
      }
    }
  } catch (error) {
    streamError = error instanceof Error ? error : new Error(String(error));
    logger.error({ err: streamError }, 'Stream iterator error');
    yield parser.createErrorChunk(streamError.message);
  } finally {
    // 发送最终的 DELIVER chunk
    const deliverChunk = parser.createDeliverChunk();
    if (deliverChunk) {
      yield deliverChunk;
    }
  }
}

/**
 * 创建基于 ProcessManager 的流迭代器
 * 这是实际使用的主要接口
 */
export function createClaudeProcessStream(
  processManager: {
    getIsRunning: () => boolean;
    getStderrBuffer: () => string;
    onStdout?: (callback: (data: string) => void) => void;
  },
  parser: ClaudeCodeStreamParser,
  options: { checkIntervalMs?: number; timeoutMs?: number } = {}
): AsyncIterable<StreamChunk> {
  const { checkIntervalMs = 50, timeoutMs = 300000 } = options; // 默认 5 分钟超时

  return {
    async *[Symbol.asyncIterator]() {
      const startTime = Date.now();
      let buffer = '';
      const pendingLines: string[] = [];
      let isCompleted = false;
      let hasError = false;

      // 如果 processManager 支持 onStdout，使用事件驱动
      if (processManager.onStdout) {
        processManager.onStdout((data: string) => {
          buffer += data;
          const parts = buffer.split('\n');
          buffer = parts.pop() || '';
          for (const line of parts) {
            if (line.trim()) {
              pendingLines.push(line);
            }
          }
        });
      }

      try {
        while (!isCompleted) {
          // 检查超时
          if (Date.now() - startTime > timeoutMs) {
            yield parser.createErrorChunk('Stream timeout');
            isCompleted = true;
            break;
          }

          // 处理所有待处理的行
          while (pendingLines.length > 0) {
            const line = pendingLines.shift()!;
            const chunk = parser.parseLine(line);

            if (chunk) {
              if (chunk.type === StreamChunkType.ERROR) {
                hasError = true;
                isCompleted = true;
              } else if (chunk.type === StreamChunkType.DONE) {
                isCompleted = true;
              }
              yield chunk;
            }
          }

          // 检查进程是否仍在运行
          if (!processManager.getIsRunning()) {
            // 进程已结束，处理剩余缓冲
            if (buffer.trim()) {
              const chunk = parser.parseLine(buffer);
              if (chunk) {
                yield chunk;
              }
              buffer = '';
            }

            // 检查是否有错误
            const stderr = processManager.getStderrBuffer();
            if (!hasError && stderr && !parser.getState().seenMessageStart) {
              yield parser.createErrorChunk(`Process failed: ${stderr}`);
            }

            isCompleted = true;
            break;
          }

          // 等待一段时间再检查
          if (!isCompleted && pendingLines.length === 0) {
            await sleep(checkIntervalMs);
          }
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error({ err: error }, 'Process stream error');
        yield parser.createErrorChunk(errorMsg);
      } finally {
        // 发送最终的 DELIVER chunk
        const deliverChunk = parser.createDeliverChunk();
        if (deliverChunk) {
          yield deliverChunk;
        }
      }
    },
  };
}

/**
 * 辅助函数：延迟指定毫秒
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
