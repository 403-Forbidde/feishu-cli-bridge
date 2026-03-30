/**
 * SSE 流解析器
 * Server-Sent Events Parser
 *
 * 解析 OpenCode 返回的 SSE 流，转换为 StreamChunk
 * 基于 Python 实现: _parse_event 和 _listen_events
 *
 * OpenCode SSE 格式:
 * - 每行以 "data: " 开头
 * - 后面是 JSON，包含 { type, properties }
 * - 没有 "event:" 行（不是标准 SSE）
 */

import { StreamChunkType, type StreamChunk } from '../../core/types/stream.js';
import { logger } from '../../core/logger.js';
import type { OpenCodeSSEEvent, StreamState } from './types.js';

/**
 * OpenCode SSE 事件解析器
 * 模拟 Python 的 _parse_event 方法
 */
export class OpenCodeEventParser {
  private streamState: StreamState;

  constructor() {
    this.streamState = {
      seenAssistantMessage: false,
      userTextSkipped: false,
      emittedTextLength: 0,
    };
  }

  /**
   * 重置流状态（每轮对话开始时调用）
   */
  resetState(promptHash?: number): void {
    this.streamState = {
      seenAssistantMessage: false,
      userTextSkipped: false,
      emittedTextLength: 0,
      promptHash,
    };
  }

  /**
   * 解析单个 SSE 事件行
   * 对应 Python: _parse_event(self, raw_line: bytes, state: StreamState)
   *
   * @param line 一行数据（应该是 "data: {json}" 格式）
   * @returns StreamChunk 或 null（如果事件不产生输出）
   */
  parseLine(line: string): StreamChunk | null {
    // 必须以 "data: " 开头
    if (!line.startsWith('data: ')) {
      return null;
    }

    const rawData = line.slice(6); // 去掉 "data: " 前缀

    try {
      const event = JSON.parse(rawData) as OpenCodeSSEEvent;
      const eventType = event.type || '';
      const properties = event.properties || {};

      // 记录事件类型以便诊断（除了高频的 message.part.delta）
      if (eventType !== 'message.part.delta') {
        logger.debug(`SSE event: type=${eventType}`);
        // 诊断日志：记录完整事件内容用于调试 thinking 内容泄漏问题
        if (eventType === 'message.part.updated' && properties.part) {
          logger.debug(`SSE message.part.updated: partType=${properties.part.type}, text_len=${properties.part.text?.length || 0}`);
          if (properties.part.text) {
            logger.debug(`SSE text preview: ${properties.part.text.substring(0, 200)}...`);
          }
        }
      }

      // 处理 message.part.delta（真正的流式事件）
      if (eventType === 'message.part.delta') {
        const field = properties.field || '';
        const deltaText = properties.delta || '';

        // 处理 reasoning 增量
        if (field === 'reasoning' && deltaText) {
          logger.debug(`SSE: delta reasoning: len=${deltaText.length}`);
          return {
            type: StreamChunkType.REASONING,
            data: deltaText,
          };
        }

        // 处理 text 增量
        if (field === 'text' && deltaText) {
          logger.debug(`SSE: delta text: len=${deltaText.length}`);
          this.streamState.seenAssistantMessage = true;
          this.streamState.emittedTextLength += deltaText.length;
          return {
            type: StreamChunkType.CONTENT,
            data: deltaText,
          };
        }
      }

      // 处理 message.part.updated（包含完整块，可能重复）
      if (eventType === 'message.part.updated') {
        const part = (properties.part || {}) as {
          type?: string;
          text?: string;
          tokens?: Record<string, number>;
        };
        const partType = part.type || '';

        logger.debug(`SSE: message.part.updated with part_type=${partType}`);

        // 优先处理思考过程（reasoning 类型）
        // Python 参考: 直接返回完整 text，在 _listen_events 中去重
        if (partType === 'reasoning') {
          const text = part.text || '';
          if (text) {
            return {
              type: StreamChunkType.REASONING,
              data: text,
            };
          }
          return null;
        }

        // 处理文本部件
        if (partType === 'text') {
          const rawText = part.text || '';

          logger.debug(`SSE: updated text: raw_len=${rawText.length}, emitted=${this.streamState.emittedTextLength}`);
          // 诊断日志：检查是否包含 reasoning 内容
          if (rawText.length > 0) {
            const preview = rawText.substring(0, 100).replace(/\n/g, '\\n');
            logger.debug(`SSE: text preview: ${preview}...`);
          }

          // 关键修复：使用与 OpenClaw 相同的逻辑分离 reasoning 和 answer
          const { reasoningText, answerText } = splitReasoningText(rawText);

          // 诊断日志：记录分离结果
          if (reasoningText) {
            logger.debug(`SSE: extracted reasoning: len=${reasoningText.length}`);
          }
          if (answerText) {
            logger.debug(`SSE: extracted answer: len=${answerText.length}`);
          }

          // 如果有 reasoning 内容，作为 REASONING chunk 发送（完整替换）
          if (reasoningText) {
            return {
              type: StreamChunkType.REASONING,
              data: reasoningText,
            };
          }

          // 如果没有 answer 内容，跳过
          if (!answerText) {
            return null;
          }

          // 通过内容匹配识别用户输入（与当前 prompt 的 hash 比较）
          if (!this.streamState.userTextSkipped && this.streamState.promptHash !== undefined) {
            const textHash = this.hashString(answerText.trim());
            if (textHash === this.streamState.promptHash) {
              this.streamState.userTextSkipped = true;
              return null;
            }
          }

          // AI 回复处理：只发送新增的内容（增量）
          if (answerText.length > this.streamState.emittedTextLength) {
            const newContent = answerText.slice(this.streamState.emittedTextLength);

            logger.debug(`SSE: new content: len=${newContent.length}`);
            this.streamState.emittedTextLength = answerText.length;
            this.streamState.seenAssistantMessage = true;
            return {
              type: StreamChunkType.CONTENT,
              data: newContent,
            };
          }

          // 如果 text 长度 <= 已发送长度，说明是重复内容或历史内容，跳过
          return null;
        }

        // 处理 step-finish（嵌套在 message.part.updated 中）
        if (partType === 'step-finish') {
          const tokens = part.tokens || {};
          logger.debug(`SSE: step-finish (nested): tokens=${JSON.stringify(tokens)}`);

          // 提取 token 统计信息（支持多种字段名格式）
          const totalTokens = tokens.total || tokens.total_tokens || 0;
          const inputTokens = tokens.input || tokens.input_tokens || tokens.prompt_tokens || 0;
          const outputTokens = tokens.output || tokens.output_tokens || tokens.completion_tokens || 0;

          return {
            type: StreamChunkType.STATS,
            data: '',
            stats: {
              totalTokens,
              promptTokens: inputTokens,
              completionTokens: outputTokens,
              contextUsed: totalTokens,
              contextWindow: 128000, // 默认值，适配器会更新
              contextPercent: 0, // 适配器会计算
            },
          };
        }
      }

      // 处理独立的 step-finish 事件
      if (eventType === 'step-finish') {
        const props = properties as Record<string, unknown>;
        const tokens = (props.tokens || {}) as Record<string, number>;
        logger.debug(`SSE: step-finish (standalone): tokens=${JSON.stringify(tokens)}`);

        // 提取 token 统计信息（支持多种字段名格式）
        const totalTokens = tokens.total || tokens.total_tokens || 0;
        const inputTokens = tokens.input || tokens.input_tokens || tokens.prompt_tokens || 0;
        const outputTokens = tokens.output || tokens.output_tokens || tokens.completion_tokens || 0;

        return {
          type: StreamChunkType.STATS,
          data: '',
          stats: {
            totalTokens,
            promptTokens: inputTokens,
            completionTokens: outputTokens,
            contextUsed: totalTokens,
            contextWindow: 128000, // 默认值，适配器会更新
            contextPercent: 0, // 适配器会计算
          },
        };
      }

      // session.idle：只有已经看到文字回复时才发出 DONE
      if (eventType === 'session.idle') {
        if (this.streamState.seenAssistantMessage) {
          return {
            type: StreamChunkType.DONE,
            data: '',
          };
        }
        return null;
      }

      // 处理错误
      if (eventType === 'error') {
        const errorMsg = properties.message || 'Unknown error';
        return {
          type: StreamChunkType.ERROR,
          data: errorMsg,
        };
      }
    } catch (error) {
      // JSON 解析失败，忽略
      logger.debug(`Failed to parse SSE event: ${error}`);
    }

    return null;
  }

  /**
   * 计算字符串的哈希值（用于去重检测）
   */
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 转换为 32bit 整数
    }
    return hash;
  }
}

/**
 * Split a payload text into optional `reasoningText` and `answerText`.
 * 参考 OpenClaw 实现: builder.js splitReasoningText
 *
 * Handles multiple formats:
 * 1. "Reasoning:\n_italic line_\n…" prefix — the entire payload is reasoning
 * 2. `<thinking>…</thinking>` / `<thought>…</thought>` XML tags
 * 3. "Thinking:\n" or "思考：\n" prefix (for Chinese models like Kimi)
 * 4. Content that looks like internal monologue (starts with self-referential phrases)
 */
function splitReasoningText(text: string): { reasoningText?: string; answerText?: string } {
  if (typeof text !== 'string' || !text.trim()) {
    return {};
  }

  const trimmed = text.trim();
  const REASONING_PREFIXES = [
    'Reasoning:\n',
    'Thinking:\n',
    '思考：\n',
    '思考:\n',
  ];

  // Case 1: Known reasoning prefixes — the entire payload is reasoning
  for (const prefix of REASONING_PREFIXES) {
    if (trimmed.startsWith(prefix) && trimmed.length > prefix.length) {
      return { reasoningText: cleanReasoningPrefix(trimmed, prefix) };
    }
  }

  // Case 2: XML thinking tags — extract content and strip from answer
  const taggedReasoning = extractThinkingContent(text);
  const strippedAnswer = stripReasoningTags(text);

  if (!taggedReasoning && strippedAnswer === text) {
    // No reasoning found, all text is answer
    return { answerText: text };
  }

  return {
    reasoningText: taggedReasoning || undefined,
    answerText: strippedAnswer || undefined,
  };
}

/**
 * Extract content from `<thinking>`, `<thought>`, `<antthinking>` blocks.
 * Handles both closed and unclosed (streaming) tags.
 */
function extractThinkingContent(text: string): string {
  if (!text) return '';

  const scanRe = /<\s*(\/?)\s*(?:think(?:ing)?|thought|antthinking)\s*>/gi;
  let result = '';
  let lastIndex = 0;
  let inThinking = false;

  for (const match of text.matchAll(scanRe)) {
    const idx = match.index ?? 0;
    if (inThinking) {
      result += text.slice(lastIndex, idx);
    }
    inThinking = match[1] !== '/';
    lastIndex = idx + match[0].length;
  }

  // Handle unclosed tag (still streaming)
  if (inThinking) {
    result += text.slice(lastIndex);
  }

  return result.trim();
}

/**
 * Clean a reasoning message back to plain text.
 * Strips the prefix and per-line italic markdown wrappers.
 */
function cleanReasoningPrefix(text: string, prefix: string): string {
  // Create regex to strip the prefix (case insensitive)
  const prefixRegex = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
  let cleaned = text.replace(prefixRegex, '');
  // Strip per-line italic markdown wrappers (_text_)
  cleaned = cleaned
    .split('\n')
    .map((line) => line.replace(/^_(.+)_$/, '$1'))
    .join('\n');
  return cleaned.trim();
}

/**
 * Strip reasoning blocks — XML tags with their content.
 * 参考 OpenClaw 插件实现: builder.js stripReasoningTags
 *
 * 注意：此函数只处理 XML 标签，不处理 "Reasoning:\n" 前缀。
 * "Reasoning:\n" 前缀应该在调用 splitReasoningText 时处理。
 */
function stripReasoningTags(text: string): string {
  if (!text) return '';

  // Strip complete XML blocks (think, thinking, thought, antthinking)
  let result = text.replace(/<\s*(?:think(?:ing)?|thought|antthinking)\s*>[\s\S]*?<\s*\/\s*(?:think(?:ing)?|thought|antthinking)\s*>/gi, '');
  // Strip unclosed tag at end (streaming)
  result = result.replace(/<\s*(?:think(?:ing)?|thought|antthinking)\s*>[\s\S]*$/gi, '');
  // Strip orphaned closing tags
  result = result.replace(/<\s*\/\s*(?:think(?:ing)?|thought|antthinking)\s*>/gi, '');
  return result.trim();
}
/**
 * 对应 Python: _listen_events 方法
 *
 * 将 Node.js ReadableStream 转换为 AsyncIterable<StreamChunk>
 * 包含内容缓冲逻辑（前 10 字符立即发送，之后每 30 字符或 400ms 发送）
 */
export async function* createOpenCodeEventIterator(
  stream: NodeJS.ReadableStream,
  parser: OpenCodeEventParser
): AsyncIterable<StreamChunk> {
  let buffer = '';
  let contentBuffer = '';
  let lastContentFlush = Date.now();
  let hasSentFirstContent = false;
  let lastReasoningText = '';

  const CHUNK_SIZE = 30;
  const FLUSH_INTERVAL = 400;
  const FIRST_CHUNK_SIZE = 10;

  // 用于异步生成器的 promise 机制
  const chunks: StreamChunk[] = [];
  let resolveNext: ((chunk: StreamChunk | null) => void) | null = null;
  let streamEnded = false;
  let streamError: Error | null = null;

  // 处理数据
  stream.on('data', (data: Buffer) => {
    buffer += data.toString();

    // 按行分割处理
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // 保留最后一个不完整的行

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      const chunk = parser.parseLine(trimmedLine);
      if (!chunk) continue;

      if (chunk.type === StreamChunkType.CONTENT) {
        // 内容已经在 parser 中处理过，直接累积即可
        contentBuffer += chunk.data;
        const now = Date.now();
        const elapsed = now - lastContentFlush;

        // 第一个内容：达到 FIRST_CHUNK_SIZE 就发送
        if (!hasSentFirstContent && contentBuffer.length >= FIRST_CHUNK_SIZE) {
          if (resolveNext) {
            resolveNext({
              type: StreamChunkType.CONTENT,
              data: contentBuffer,
            });
            resolveNext = null;
          } else {
            chunks.push({
              type: StreamChunkType.CONTENT,
              data: contentBuffer,
            });
          }
          contentBuffer = '';
          lastContentFlush = now;
          hasSentFirstContent = true;
        }
        // 后续内容：达到 CHUNK_SIZE 或超过 FLUSH_INTERVAL
        else if (hasSentFirstContent && (contentBuffer.length >= CHUNK_SIZE || elapsed >= FLUSH_INTERVAL)) {
          if (resolveNext) {
            resolveNext({
              type: StreamChunkType.CONTENT,
              data: contentBuffer,
            });
            resolveNext = null;
          } else {
            chunks.push({
              type: StreamChunkType.CONTENT,
              data: contentBuffer,
            });
          }
          contentBuffer = '';
          lastContentFlush = now;
        }
      } else if (chunk.type === StreamChunkType.REASONING) {
        // Reasoning 去重：如果和上次相同则跳过（参考 Python: last_reasoning_text）
        // 注意：不像 CONTENT，REASONING 不缓冲，直接发送去重后的完整文本
        if (chunk.data === lastReasoningText) {
          continue;
        }
        lastReasoningText = chunk.data;
        // 直接发送，不缓冲（与 Python 行为一致）
        if (resolveNext) {
          resolveNext(chunk);
          resolveNext = null;
        } else {
          chunks.push(chunk);
        }
      } else {
        // DONE 或 ERROR：先清空内容缓冲区
        if (contentBuffer) {
          if (resolveNext) {
            resolveNext({
              type: StreamChunkType.CONTENT,
              data: contentBuffer,
            });
            resolveNext = null;
          } else {
            chunks.push({
              type: StreamChunkType.CONTENT,
              data: contentBuffer,
            });
          }
          contentBuffer = '';
        }

        if (resolveNext) {
          resolveNext(chunk);
          resolveNext = null;
        } else {
          chunks.push(chunk);
        }

        if (chunk.type === StreamChunkType.DONE || chunk.type === StreamChunkType.ERROR) {
          streamEnded = true;
        }
      }
    }
  });

  // 监听结束
  stream.on('end', () => {
    streamEnded = true;
    if (resolveNext) {
      resolveNext(null);
    }
  });

  // 监听错误
  stream.on('error', (error: Error) => {
    streamError = error;
    streamEnded = true;
    logger.error({ err: error }, 'Event stream error');
    if (resolveNext) {
      resolveNext({
        type: StreamChunkType.ERROR,
        data: error instanceof Error ? error.message : String(error),
      });
    }
  });

  try {
    // 累积所有内容用于 DELIVER
    let accumulatedContent = '';
    let accumulatedReasoning = '';

    while (!streamEnded || chunks.length > 0) {
      if (chunks.length > 0) {
        const chunk = chunks.shift()!;
        // 累积内容用于 DELIVER
        if (chunk.type === StreamChunkType.CONTENT) {
          accumulatedContent += chunk.data;
        } else if (chunk.type === StreamChunkType.REASONING) {
          accumulatedReasoning = chunk.data; // REASONING 是完整替换
        }
        yield chunk;
      } else {
        const chunk = await new Promise<StreamChunk | null>((resolve) => {
          resolveNext = resolve;
        });
        if (chunk === null) {
          break;
        }
        // 累积内容用于 DELIVER
        if (chunk.type === StreamChunkType.CONTENT) {
          accumulatedContent += chunk.data;
        } else if (chunk.type === StreamChunkType.REASONING) {
          accumulatedReasoning = chunk.data; // REASONING 是完整替换
        }
        yield chunk;
      }
    }

    // 发送剩余的内容
    if (contentBuffer) {
      accumulatedContent += contentBuffer;
      yield {
        type: StreamChunkType.CONTENT,
        data: contentBuffer,
      };
    }

    // 发送 DELIVER chunk（完整内容，用于最终卡片构建）
    // 如果有 reasoning，需要从 content 中剥离（因为 SSE 中的 text 可能包含 reasoning）
    const { answerText } = splitReasoningText(accumulatedContent);
    const deliverText = answerText || accumulatedContent;

    if (deliverText) {
      logger.debug(`SSE: emitting DELIVER chunk with ${deliverText.length} chars`);
      yield {
        type: StreamChunkType.DELIVER,
        data: deliverText,
      };
    }

    // Note: REASONING 不缓冲，所以没有剩余需要发送
  } finally {
    stream.removeAllListeners();
  }
}
