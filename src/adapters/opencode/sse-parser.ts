/**
 * SSE 流解析器
 * Server-Sent Events Parser
 *
 * 解析 OpenCode 返回的 SSE 流，转换为 StreamChunk
 */

import { createParser, type ParsedEvent, type ReconnectInterval } from 'eventsource-parser';
import { StreamChunkType, type StreamChunk } from '../../core/types/stream.js';
import { logger } from '../../core/logger.js';
import type { SSEMessage, SSEEventType } from './types.js';

/**
 * SSE 解析器
 */
export class SSEParser {
  private buffer = '';

  /**
   * 创建 SSE 解析器
   * @param onChunk 当解析出 chunk 时的回调
   */
  constructor(private onChunk: (chunk: StreamChunk) => void) {}

  /**
   * 解析 SSE 数据块
   * @param data 接收到的数据
   */
  parse(data: string): void {
    this.buffer += data;

    // SSE 消息以 \n\n 分隔
    const messages = this.buffer.split('\n\n');

    // 保留最后一个不完整的消息在 buffer 中
    this.buffer = messages.pop() || '';

    for (const message of messages) {
      if (message.trim()) {
        this.parseMessage(message);
      }
    }
  }

  /**
   * 解析单个 SSE 消息
   */
  private parseMessage(message: string): void {
    const lines = message.split('\n');
    let eventType = 'message';
    let eventData = '';

    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        eventData = line.slice(5).trim();
      }
    }

    if (!eventData) {
      return;
    }

    try {
      const parsedData = JSON.parse(eventData) as SSEMessage;
      this.handleEvent(eventType as SSEEventType, parsedData);
    } catch (error) {
      // 如果 JSON 解析失败，将数据作为原始内容处理
      logger.debug(`Failed to parse SSE data as JSON: ${eventData}`);
      this.onChunk({
        type: StreamChunkType.CONTENT,
        data: eventData,
      });
    }
  }

  /**
   * 处理解析后的事件
   */
  private handleEvent(eventType: string, data: SSEMessage): void {
    switch (eventType) {
      case 'message':
        if (typeof data.data === 'string') {
          this.onChunk({
            type: StreamChunkType.CONTENT,
            data: data.data,
          });
        }
        break;

      case 'reasoning':
        if (typeof data.data === 'string') {
          this.onChunk({
            type: StreamChunkType.REASONING,
            data: data.data,
          });
        }
        break;

      case 'stats':
        // 统计数据，可以存储供后续使用
        logger.debug({ data: data.data }, 'Received stats event');
        break;

      case 'error':
        this.onChunk({
          type: StreamChunkType.ERROR,
          data: typeof data.data === 'string' ? data.data : JSON.stringify(data.data),
        });
        break;

      case 'done':
        this.onChunk({
          type: StreamChunkType.DONE,
          data: '',
        });
        break;

      default:
        logger.debug(`Unknown SSE event type: ${eventType}`);
    }
  }

  /**
   * 刷新缓冲区（在流结束时调用）
   */
  flush(): void {
    if (this.buffer.trim()) {
      this.parseMessage(this.buffer);
      this.buffer = '';
    }
  }
}

/**
 * 使用 eventsource-parser 库的解析器（更可靠的实现）
 */
export class SSEParserV2 {
  private parser: ReturnType<typeof createParser>;

  constructor(private onChunk: (chunk: StreamChunk) => void) {
    this.parser = createParser((event: ParsedEvent | ReconnectInterval) => {
      if (event.type === 'event' && event.event) {
        this.handleEvent(event.event, event.data);
      }
    });
  }

  /**
   * 解析 SSE 数据
   */
  parse(data: string): void {
    this.parser.feed(data);
  }

  /**
   * 处理事件
   */
  private handleEvent(eventType: string, data: string): void {
    try {
      const parsed = JSON.parse(data) as SSEMessage;

      switch (eventType) {
        case 'message':
          if (typeof parsed.data === 'string') {
            this.onChunk({
              type: StreamChunkType.CONTENT,
              data: parsed.data,
            });
          }
          break;

        case 'reasoning':
          if (typeof parsed.data === 'string') {
            this.onChunk({
              type: StreamChunkType.REASONING,
              data: parsed.data,
            });
          }
          break;

        case 'error':
          this.onChunk({
            type: StreamChunkType.ERROR,
            data: typeof parsed.data === 'string' ? parsed.data : JSON.stringify(parsed.data),
          });
          break;

        case 'done':
          this.onChunk({
            type: StreamChunkType.DONE,
            data: '',
          });
          break;

        default:
          // 未知事件类型，尝试作为内容处理
          if (typeof parsed.data === 'string') {
            this.onChunk({
              type: StreamChunkType.CONTENT,
              data: parsed.data,
            });
          }
      }
    } catch {
      // JSON 解析失败，作为原始内容
      this.onChunk({
        type: StreamChunkType.CONTENT,
        data,
      });
    }
  }

  /**
   * 重置解析器
   */
  reset(): void {
    // createParser 返回的解析器没有 reset 方法
    // 需要重新创建
    this.parser = createParser((event: ParsedEvent | ReconnectInterval) => {
      if (event.type === 'event' && event.event) {
        this.handleEvent(event.event, event.data);
      }
    });
  }
}

/**
 * 创建 SSE 异步迭代器
 * 将 Node.js ReadableStream 转换为 AsyncIterable<StreamChunk>
 */
export async function* createSSEIterator(
  stream: NodeJS.ReadableStream
): AsyncIterable<StreamChunk> {
  const chunks: StreamChunk[] = [];
  let resolveNext: ((chunk: StreamChunk | null) => void) | null = null;
  let finished = false;

  const parser = new SSEParserV2((chunk) => {
    if (resolveNext) {
      resolveNext(chunk);
      resolveNext = null;
    } else {
      chunks.push(chunk);
    }
  });

  // 监听数据
  stream.on('data', (data: Buffer) => {
    parser.parse(data.toString());
  });

  // 监听结束
  stream.on('end', () => {
    finished = true;
    if (resolveNext) {
      resolveNext(null);
    }
  });

  // 监听错误
  stream.on('error', (error) => {
    finished = true;
    logger.error({ err: error }, 'SSE stream error');
    if (resolveNext) {
      resolveNext({
        type: StreamChunkType.ERROR,
        data: error instanceof Error ? error.message : String(error),
      });
    }
  });

  try {
    while (!finished || chunks.length > 0) {
      if (chunks.length > 0) {
        yield chunks.shift()!;
      } else {
        const chunk = await new Promise<StreamChunk | null>((resolve) => {
          resolveNext = resolve;
        });
        if (chunk === null) {
          break;
        }
        yield chunk;
      }
    }
  } finally {
    // 清理
    stream.removeAllListeners();
  }
}
