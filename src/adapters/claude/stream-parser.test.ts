/**
 * Claude Code Stream Parser 测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ClaudeCodeStreamParser, createClaudeProcessStream } from './stream-parser.js';
import { StreamChunkType } from '../../core/types/stream.js';

// 测试数据：模拟 Claude Code 的 stream-json 输出
const TEST_EVENTS = {
  // 系统初始化事件
  systemInit: {
    type: 'system',
    subtype: 'init',
    cwd: '/test/path',
    session_id: 'test-session-123',
    model: 'kimi-for-coding',
    permissionMode: 'default',
    claude_code_version: '2.1.91',
  },

  // 消息开始事件
  messageStart: {
    type: 'stream_event',
    event: {
      type: 'message_start',
      message: {
        id: 'msg_123',
        usage: {
          input_tokens: 100,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 50,
        },
      },
    },
    session_id: 'test-session-123',
  },

  // 文本增量事件
  textDelta: {
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      index: 1,
      delta: {
        type: 'text_delta',
        text: 'Hello, world!',
      },
    },
  },

  // 思考内容增量事件
  thinkingDelta: {
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      index: 0,
      delta: {
        type: 'thinking_delta',
        thinking: 'Let me think about this...',
      },
    },
  },

  // 消息增量事件（含 usage）
  messageDelta: {
    type: 'stream_event',
    event: {
      type: 'message_delta',
      delta: {
        stop_reason: 'end_turn',
      },
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        completion_tokens: 50,
        total_tokens: 150,
        cache_read_input_tokens: 50,
      },
    },
  },

  // 消息停止事件
  messageStop: {
    type: 'stream_event',
    event: {
      type: 'message_stop',
    },
  },

  // 成功结果事件
  successResult: {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'Hello, world!',
    session_id: 'test-session-123',
    total_cost_usd: 0.007,
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      completion_tokens: 50,
      total_tokens: 150,
    },
    modelUsage: {
      'kimi-k2.5': {
        inputTokens: 100,
        outputTokens: 50,
        cacheReadInputTokens: 50,
        cacheCreationInputTokens: 0,
        costUSD: 0.007,
        contextWindow: 200000,
        maxOutputTokens: 32000,
      },
    },
  },

  // 错误结果事件
  errorResult: {
    type: 'result',
    subtype: 'error_during_execution',
    is_error: true,
    terminal_reason: 'aborted_streaming',
    errors: ['Request was aborted.'],
  },

  // 用户中断事件
  userInterrupt: {
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'text', text: '[Request interrupted by user]' }],
    },
  },
};

describe('ClaudeCodeStreamParser', () => {
  let parser: ClaudeCodeStreamParser;

  beforeEach(() => {
    parser = new ClaudeCodeStreamParser();
  });

  describe('parseLine', () => {
    it('should return null for empty line', () => {
      expect(parser.parseLine('')).toBeNull();
      expect(parser.parseLine('   ')).toBeNull();
    });

    it('should return null for invalid JSON', () => {
      expect(parser.parseLine('not json')).toBeNull();
      expect(parser.parseLine('{invalid}')).toBeNull();
    });

    it('should handle system init event', () => {
      const result = parser.parseLine(JSON.stringify(TEST_EVENTS.systemInit));
      expect(result).toBeNull(); // system 事件不产出 chunk
    });

    it('should handle message start event', () => {
      const result = parser.parseLine(JSON.stringify(TEST_EVENTS.messageStart));
      expect(result).toBeNull(); // message_start 不产出 chunk

      const state = parser.getState();
      expect(state.seenMessageStart).toBe(true);
    });

    it('should handle text delta event', () => {
      const result = parser.parseLine(JSON.stringify(TEST_EVENTS.textDelta));
      expect(result).not.toBeNull();
      expect(result?.type).toBe(StreamChunkType.CONTENT);
      expect(result?.data).toBe('Hello, world!');

      const state = parser.getState();
      expect(state.accumulatedText).toBe('Hello, world!');
    });

    it('should handle thinking delta event', () => {
      const result = parser.parseLine(JSON.stringify(TEST_EVENTS.thinkingDelta));
      expect(result).not.toBeNull();
      expect(result?.type).toBe(StreamChunkType.REASONING);
      expect(result?.data).toBe('Let me think about this...');

      const state = parser.getState();
      expect(state.accumulatedReasoning).toBe('Let me think about this...');
    });

    it('should handle message delta event with usage', () => {
      const result = parser.parseLine(JSON.stringify(TEST_EVENTS.messageDelta));
      expect(result).not.toBeNull();
      expect(result?.type).toBe(StreamChunkType.STATS);
      expect(result?.stats).toMatchObject({
        totalTokens: 150,
        promptTokens: 100,
        completionTokens: 50,
      });
    });

    it('should handle message stop event', () => {
      const result = parser.parseLine(JSON.stringify(TEST_EVENTS.messageStop));
      expect(result).toBeNull(); // message_stop 不产出 chunk

      const state = parser.getState();
      expect(state.seenMessageStop).toBe(true);
    });

    it('should handle success result event', () => {
      const result = parser.parseLine(JSON.stringify(TEST_EVENTS.successResult));
      expect(result).not.toBeNull();
      expect(result?.type).toBe(StreamChunkType.DONE);

      // 验证模型信息被正确提取
      const model = parser.getDetectedModel();
      expect(model).toMatchObject({
        modelId: 'kimi-k2.5',
        contextWindow: 200000,
        maxOutputTokens: 32000,
      });
    });

    it('should handle error result event', () => {
      const result = parser.parseLine(JSON.stringify(TEST_EVENTS.errorResult));
      expect(result).not.toBeNull();
      expect(result?.type).toBe(StreamChunkType.ERROR);
      expect(result?.data).toContain('Request was aborted.');
    });

    it('should handle user interrupt event', () => {
      const result = parser.parseLine(JSON.stringify(TEST_EVENTS.userInterrupt));
      expect(result).toBeNull(); // user 事件不产出 chunk
    });

    it('should handle multiple text deltas', () => {
      const text1 = 'Hello';
      const text2 = ', ';
      const text3 = 'world!';

      parser.parseLine(
        JSON.stringify({
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            index: 1,
            delta: { type: 'text_delta', text: text1 },
          },
        })
      );

      parser.parseLine(
        JSON.stringify({
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            index: 1,
            delta: { type: 'text_delta', text: text2 },
          },
        })
      );

      parser.parseLine(
        JSON.stringify({
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            index: 1,
            delta: { type: 'text_delta', text: text3 },
          },
        })
      );

      const state = parser.getState();
      expect(state.accumulatedText).toBe('Hello, world!');
      expect(state.emittedTextLength).toBe(13);
    });
  });

  describe('resetState', () => {
    it('should reset all state fields', () => {
      // 先解析一些事件
      parser.parseLine(JSON.stringify(TEST_EVENTS.textDelta));
      parser.parseLine(JSON.stringify(TEST_EVENTS.thinkingDelta));
      parser.parseLine(JSON.stringify(TEST_EVENTS.successResult));

      // 重置状态
      parser.resetState();

      const state = parser.getState();
      expect(state.seenMessageStart).toBe(false);
      expect(state.seenMessageStop).toBe(false);
      expect(state.accumulatedText).toBe('');
      expect(state.accumulatedReasoning).toBe('');
      expect(state.emittedTextLength).toBe(0);
      expect(state.emittedReasoningLength).toBe(0);
    });
  });

  describe('createDeliverChunk', () => {
    it('should return null when no content accumulated', () => {
      const result = parser.createDeliverChunk();
      expect(result).toBeNull();
    });

    it('should return DELIVER chunk with accumulated text', () => {
      parser.parseLine(JSON.stringify(TEST_EVENTS.textDelta));
      parser.parseLine(
        JSON.stringify({
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            index: 1,
            delta: { type: 'text_delta', text: ' More text.' },
          },
        })
      );

      const result = parser.createDeliverChunk();
      expect(result).not.toBeNull();
      expect(result?.type).toBe(StreamChunkType.DELIVER);
      expect(result?.data).toBe('Hello, world! More text.');
    });
  });

  describe('createErrorChunk', () => {
    it('should return ERROR chunk', () => {
      const result = parser.createErrorChunk('Test error message');
      expect(result.type).toBe(StreamChunkType.ERROR);
      expect(result.data).toBe('Test error message');
    });
  });

  describe('unknown events', () => {
    it('should handle unknown event type gracefully', () => {
      const unknownEvent = { type: 'unknown_type', data: 'test' };
      const result = parser.parseLine(JSON.stringify(unknownEvent));
      expect(result).toBeNull();
    });

    it('should handle unknown stream_event subtype', () => {
      const unknownEvent = {
        type: 'stream_event',
        event: { type: 'unknown_subtype' },
      };
      const result = parser.parseLine(JSON.stringify(unknownEvent));
      expect(result).toBeNull();
    });
  });
});

describe('createClaudeProcessStream', () => {
  it('should yield chunks from stdout data', async () => {
    const parser = new ClaudeCodeStreamParser();
    const mockCallbacks: Array<(data: string) => void> = [];

    const mockProcessManager = {
      getIsRunning: () => {
        // 第一次返回 true，第二次返回 false
        mockProcessManager.getIsRunning = () => false;
        return true;
      },
      getStderrBuffer: () => '',
      onStdout: (callback: (data: string) => void) => {
        mockCallbacks.push(callback);
        // 立即发送一些数据
        setTimeout(() => {
          callback(JSON.stringify(TEST_EVENTS.textDelta) + '\n');
          callback(JSON.stringify(TEST_EVENTS.successResult) + '\n');
        }, 10);
      },
    };

    const stream = createClaudeProcessStream(mockProcessManager, parser, {
      checkIntervalMs: 10,
    });

    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].type).toBe(StreamChunkType.CONTENT);
    expect(chunks[chunks.length - 1].type).toBe(StreamChunkType.DELIVER);
  });

  it('should handle process exit without message start', async () => {
    const parser = new ClaudeCodeStreamParser();

    const mockProcessManager = {
      getIsRunning: () => false,
      getStderrBuffer: () => 'Error: command not found',
    };

    const stream = createClaudeProcessStream(mockProcessManager, parser);

    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    // 应该产出错误 chunk
    const errorChunk = chunks.find((c) => c.type === StreamChunkType.ERROR);
    expect(errorChunk).toBeDefined();
    expect(errorChunk?.data).toContain('command not found');
  });
});

// 模拟真实场景的集成测试
describe('integration scenarios', () => {
  it('should handle complete conversation flow', () => {
    const parser = new ClaudeCodeStreamParser();
    const chunks = [];

    // 模拟完整的对话流程
    const events = [
      TEST_EVENTS.systemInit,
      TEST_EVENTS.messageStart,
      TEST_EVENTS.thinkingDelta,
      TEST_EVENTS.textDelta,
      TEST_EVENTS.messageDelta,
      TEST_EVENTS.messageStop,
      TEST_EVENTS.successResult,
    ];

    for (const event of events) {
      const chunk = parser.parseLine(JSON.stringify(event));
      if (chunk) {
        chunks.push(chunk);
      }
    }

    // 验证事件序列
    expect(chunks[0].type).toBe(StreamChunkType.REASONING);
    expect(chunks[0].data).toBe('Let me think about this...');

    expect(chunks[1].type).toBe(StreamChunkType.CONTENT);
    expect(chunks[1].data).toBe('Hello, world!');

    expect(chunks[2].type).toBe(StreamChunkType.STATS);
    expect(chunks[2].stats).toBeDefined();

    expect(chunks[3].type).toBe(StreamChunkType.DONE);

    // 验证状态
    const state = parser.getState();
    expect(state.seenMessageStart).toBe(true);
    expect(state.seenMessageStop).toBe(true);
    expect(state.accumulatedText).toBe('Hello, world!');
    expect(state.accumulatedReasoning).toBe('Let me think about this...');
  });

  it('should handle multiple text deltas with partial lines', () => {
    const parser = new ClaudeCodeStreamParser();
    const chunks = [];

    // 模拟分块接收的数据（JSON 被分割）
    const partialData1 = '{"type":"stream_event","event":{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Hello';
    const partialData2 = ', world!"}}}';

    // 第一块数据（不完整）
    let result = parser.parseLine(partialData1);
    if (result) chunks.push(result);

    // 第二块数据（完整 JSON）
    result = parser.parseLine(partialData2);
    if (result) chunks.push(result);

    // 注意：不完整的 JSON 会被 parseLine 处理，返回 null
    // 在实际的流处理中，我们会用 buffer 累积完整行
    expect(chunks.length).toBeLessThanOrEqual(1);
  });

  it('should detect model from success result', () => {
    const parser = new ClaudeCodeStreamParser();

    parser.parseLine(JSON.stringify(TEST_EVENTS.successResult));

    const model = parser.getDetectedModel();
    expect(model).not.toBeNull();
    expect(model?.modelId).toBe('kimi-k2.5');
    expect(model?.contextWindow).toBe(200000);
    expect(model?.maxOutputTokens).toBe(32000);
    expect(model?.inputTokens).toBe(100);
    expect(model?.outputTokens).toBe(50);
    expect(model?.costUSD).toBe(0.007);
  });

  it('should accumulate multiple reasoning deltas', () => {
    const parser = new ClaudeCodeStreamParser();

    const reasoning1 = 'First thought. ';
    const reasoning2 = 'Second thought. ';
    const reasoning3 = 'Third thought.';

    parser.parseLine(
      JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: reasoning1 },
        },
      })
    );

    parser.parseLine(
      JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: reasoning2 },
        },
      })
    );

    parser.parseLine(
      JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: reasoning3 },
        },
      })
    );

    const state = parser.getState();
    expect(state.accumulatedReasoning).toBe('First thought. Second thought. Third thought.');
    expect(state.emittedReasoningLength).toBe(45);
  });

  it('should set seenMessageStop on message_stop and allow result to produce DONE', () => {
    const parser = new ClaudeCodeStreamParser();

    parser.parseLine(JSON.stringify(TEST_EVENTS.messageStop));
    expect(parser.getState().seenMessageStop).toBe(true);

    const result = parser.parseLine(JSON.stringify(TEST_EVENTS.successResult));
    expect(result).not.toBeNull();
    expect(result?.type).toBe(StreamChunkType.DONE);
  });

  it('should extract stats from modelUsage when usage is missing', () => {
    const parser = new ClaudeCodeStreamParser();

    // result 事件缺少 usage 字段，但有 modelUsage
    const resultWithoutUsage = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'Hello!',
      session_id: 'test-session-123',
      total_cost_usd: 0.005,
      // 注意：没有 usage 字段
      modelUsage: {
        'kimi-k2.5': {
          inputTokens: 200,
          outputTokens: 100,
          cacheReadInputTokens: 50,
          cacheCreationInputTokens: 0,
          costUSD: 0.005,
          contextWindow: 256000,
          maxOutputTokens: 32000,
        },
      },
    };

    parser.parseLine(JSON.stringify(resultWithoutUsage));

    // 验证模型信息被正确提取
    const model = parser.getDetectedModel();
    expect(model).not.toBeNull();
    expect(model?.modelId).toBe('kimi-k2.5');

    // 验证 stats 从 modelUsage 中提取
    const stats = parser.getCurrentStats();
    expect(stats).not.toBeNull();
    expect(stats?.promptTokens).toBe(200);
    expect(stats?.completionTokens).toBe(100);
    expect(stats?.totalTokens).toBe(300);
  });

  it('should prefer usage over modelUsage when both are present', () => {
    const parser = new ClaudeCodeStreamParser();

    // result 事件同时有 usage 和 modelUsage，但值不同
    const resultWithBoth = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'Hello!',
      session_id: 'test-session-123',
      total_cost_usd: 0.005,
      usage: {
        input_tokens: 150,
        output_tokens: 75,
        completion_tokens: 75,
        total_tokens: 225,
      },
      modelUsage: {
        'kimi-k2.5': {
          inputTokens: 200,  // 不同值
          outputTokens: 100,  // 不同值
          cacheReadInputTokens: 50,
          cacheCreationInputTokens: 0,
          costUSD: 0.005,
          contextWindow: 256000,
          maxOutputTokens: 32000,
        },
      },
    };

    parser.parseLine(JSON.stringify(resultWithBoth));

    // 验证 stats 使用 usage 字段而非 modelUsage
    const stats = parser.getCurrentStats();
    expect(stats).not.toBeNull();
    expect(stats?.promptTokens).toBe(150);  // 来自 usage
    expect(stats?.completionTokens).toBe(75);  // 来自 usage
    expect(stats?.totalTokens).toBe(225);  // 来自 usage
  });

  it('should handle modelUsage with snake_case field names', () => {
    const parser = new ClaudeCodeStreamParser();

    // result 事件使用下划线命名的字段（某些 Provider 可能这样返回）
    const resultWithSnakeCase = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'Hello!',
      session_id: 'test-session-123',
      total_cost_usd: 0.005,
      // 注意：没有 usage 字段
      modelUsage: {
        'kimi-k2.5': {
          input_tokens: 300,      // 下划线命名
          output_tokens: 150,     // 下划线命名
          cache_read_input_tokens: 100,
          cache_creation_input_tokens: 0,
          cost_usd: 0.005,
          context_window: 256000,
          max_output_tokens: 32000,
        },
      },
    };

    parser.parseLine(JSON.stringify(resultWithSnakeCase));

    // 验证模型信息被正确提取
    const model = parser.getDetectedModel();
    expect(model).not.toBeNull();
    expect(model?.modelId).toBe('kimi-k2.5');
    expect(model?.contextWindow).toBe(256000);
    expect(model?.inputTokens).toBe(300);
    expect(model?.outputTokens).toBe(150);

    // 验证 stats 从 modelUsage 中提取（使用下划线命名字段）
    const stats = parser.getCurrentStats();
    expect(stats).not.toBeNull();
    expect(stats?.promptTokens).toBe(300);
    expect(stats?.completionTokens).toBe(150);
    expect(stats?.totalTokens).toBe(450);
  });
});

describe('createClaudeProcessStream stderr handling', () => {
  it('should convert stderr to ERROR when process fails without message_start', async () => {
    const parser = new ClaudeCodeStreamParser();

    const mockProcessManager = {
      getIsRunning: () => false,
      getStderrBuffer: () => 'claude: command not found',
    };

    const stream = createClaudeProcessStream(mockProcessManager, parser);
    const chunks = [];

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    const errorChunk = chunks.find((c) => c.type === StreamChunkType.ERROR);
    expect(errorChunk).toBeDefined();
    expect(errorChunk?.data).toContain('command not found');
  });

  it('should not emit ERROR for stderr when message_start was seen', async () => {
    const parser = new ClaudeCodeStreamParser();

    const mockProcessManager = {
      getIsRunning: () => false,
      getStderrBuffer: () => 'Some warning in stderr',
    };

    // Simulate message_start was seen
    parser.parseLine(JSON.stringify(TEST_EVENTS.messageStart));
    parser.parseLine(JSON.stringify(TEST_EVENTS.textDelta));

    const stream = createClaudeProcessStream(mockProcessManager, parser);
    const chunks = [];

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    const errorChunk = chunks.find((c) => c.type === StreamChunkType.ERROR);
    expect(errorChunk).toBeUndefined();
  });
});

describe('stream timeout handling', () => {
  it('should yield ERROR on stream timeout', async () => {
    const parser = new ClaudeCodeStreamParser();

    const mockProcessManager = {
      getIsRunning: () => true,
      getStderrBuffer: () => '',
    };

    const stream = createClaudeProcessStream(mockProcessManager, parser, {
      checkIntervalMs: 10,
      timeoutMs: 50,
    });

    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    const errorChunk = chunks.find((c) => c.type === StreamChunkType.ERROR);
    expect(errorChunk).toBeDefined();
    expect(errorChunk?.data).toContain('timeout');
  });
});
