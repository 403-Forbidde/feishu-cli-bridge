/**
 * Claude Code Adapter 测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ClaudeCodeAdapter } from './adapter.js';
import { StreamChunkType } from '../../core/types/stream.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
}));

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

const mockProcessManager = {
  start: vi.fn(),
  sendStopSignal: vi.fn(),
  stop: vi.fn(),
  getIsRunning: vi.fn(),
  getPid: vi.fn(),
  getStderrBuffer: vi.fn(),
};

const mockSessionManager = {
  initialize: vi.fn().mockResolvedValue(undefined),
  // 默认返回 null 表示需要创建新会话（这样 isNewSession 为 true）
  getOrCreateSessionId: vi.fn().mockResolvedValue(null),
  getSessionId: vi.fn().mockReturnValue(null),
  saveSessionMapping: vi.fn().mockResolvedValue(undefined),
  listSessions: vi.fn().mockResolvedValue([]),
  switchSession: vi.fn().mockResolvedValue(true),
  resetSession: vi.fn().mockResolvedValue(true),
  renameSession: vi.fn().mockResolvedValue(true),
  deleteSession: vi.fn().mockResolvedValue(true),
};

vi.mock('./process-manager.js', () => {
  return {
    ClaudeCodeProcessManager: vi.fn().mockImplementation(() => mockProcessManager),
  };
});

vi.mock('./session-manager.js', () => {
  return {
    ClaudeCodeSessionManager: vi.fn().mockImplementation(() => mockSessionManager),
  };
});

describe('ClaudeCodeAdapter', () => {
  let adapter: ClaudeCodeAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    adapter = new ClaudeCodeAdapter({
      enabled: true,
      command: '/usr/local/bin/claude',
      defaultModel: 'auto',
      timeout: 10,
      models: [],
    });

    // 默认 mock 行为
    mockProcessManager.getIsRunning.mockReturnValue(false);
    mockProcessManager.getStderrBuffer.mockReturnValue('');
    mockProcessManager.stop.mockResolvedValue({ exitCode: 0, signal: null, stderr: '' });
    mockProcessManager.sendStopSignal.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('defaultModel and contextWindow', () => {
    it('should return auto-detect when no model detected', () => {
      expect(adapter.defaultModel).toBe('auto-detect');
      expect(adapter.contextWindow).toBe(200000);
    });

    it('should return configured model when not auto', () => {
      const configuredAdapter = new ClaudeCodeAdapter({
        enabled: true,
        command: 'claude',
        defaultModel: 'claude-opus-4-6',
        timeout: 10,
        models: [],
      });
      expect(configuredAdapter.defaultModel).toBe('claude-opus-4-6');
    });
  });

  describe('executeStream', () => {
    it('should yield CONTENT and DONE chunks', async () => {
      mockProcessManager.start.mockImplementation(async (_prompt: string, _sessionId: string, _workingDir: string, handlers: { onStdout?: (data: string) => void; onExit?: (code: number | null, signal: string | null) => void }) => {
        setTimeout(() => {
          handlers.onStdout?.(
            JSON.stringify({
              type: 'stream_event',
              event: {
                type: 'content_block_delta',
                index: 1,
                delta: { type: 'text_delta', text: 'Hello' },
              },
            }) + '\n'
          );
          handlers.onStdout?.(
            JSON.stringify({
              type: 'result',
              subtype: 'success',
              is_error: false,
              result: 'Hello',
              session_id: 'test-session-id',
              total_cost_usd: 0.001,
              usage: {
                input_tokens: 10,
                output_tokens: 5,
                completion_tokens: 5,
                total_tokens: 15,
              },
              modelUsage: {
                'claude-sonnet-4-6': {
                  inputTokens: 10,
                  outputTokens: 5,
                  cacheReadInputTokens: 0,
                  cacheCreationInputTokens: 0,
                  costUSD: 0.001,
                  contextWindow: 200000,
                  maxOutputTokens: 32000,
                },
              },
            }) + '\n'
          );
          handlers.onExit?.(0, null);
        }, 5);
        return true;
      });

      mockProcessManager.getIsRunning
        .mockReturnValueOnce(true)
        .mockReturnValue(false);

      const chunks = [];
      for await (const chunk of adapter.executeStream('Say hello', [], '/workspace')) {
        chunks.push(chunk);
      }

      expect(mockProcessManager.start).toHaveBeenCalledTimes(1);
      const [, , , , options] = mockProcessManager.start.mock.calls[0];
      expect(options.isNewSession).toBe(true);

      const contentChunk = chunks.find((c) => c.type === StreamChunkType.CONTENT);
      expect(contentChunk).toBeDefined();
      expect(contentChunk?.data).toBe('Hello');

      const doneChunk = chunks.find((c) => c.type === StreamChunkType.DONE);
      expect(doneChunk).toBeDefined();
    });

    it('should yield ERROR when process fails to start', async () => {
      mockProcessManager.start.mockResolvedValue(false);

      const chunks = [];
      for await (const chunk of adapter.executeStream('Fail', [], '/workspace')) {
        chunks.push(chunk);
      }

      expect(chunks[0].type).toBe(StreamChunkType.ERROR);
      expect(chunks[0].data).toContain('Failed to start');
    });

    it('should stop generation when stopRequested is set', async () => {
      mockProcessManager.start.mockImplementation(async (_prompt: string, _sessionId: string, _workingDir: string, handlers: { onStdout?: (data: string) => void }) => {
        setTimeout(() => {
          handlers.onStdout?.(
            JSON.stringify({
              type: 'stream_event',
              event: {
                type: 'content_block_delta',
                index: 1,
                delta: { type: 'text_delta', text: 'Partial' },
              },
            }) + '\n'
          );
        }, 5);
        return true;
      });

      mockProcessManager.getIsRunning.mockReturnValue(true);

      // 在生成过程中请求停止
      const stopPromise = (async () => {
        await vi.advanceTimersByTimeAsync(20);
        const stopped = await adapter.stopGeneration();
        expect(stopped).toBe(true);
      })();

      const chunks = [];
      for await (const chunk of adapter.executeStream('Long task', [], '/workspace')) {
        chunks.push(chunk);
      }

      await stopPromise;

      const doneChunk = chunks.find((c) => c.type === StreamChunkType.DONE);
      expect(doneChunk).toBeDefined();
      expect(mockProcessManager.sendStopSignal).toHaveBeenCalled();
    });

    it('should handle attachments via @filepath syntax', async () => {
      mockProcessManager.start.mockResolvedValue(true);

      const chunks = [];
      for await (const chunk of adapter.executeStream(
        'Analyze this',
        [],
        '/workspace',
        [{ fileKey: 'test_file_key', resourceType: 'file', filename: 'test.txt', data: Buffer.from('test content'), mimeType: 'text/plain' }]
      )) {
        chunks.push(chunk);
      }

      const promptArg = mockProcessManager.start.mock.calls[0][0];
      expect(promptArg).toContain('@');
    });

    it('should support context messages in prompt', async () => {
      mockProcessManager.start.mockResolvedValue(true);

      const chunks = [];
      for await (const chunk of adapter.executeStream(
        'Current question',
        [
          { role: 'user', content: 'Previous question' },
          { role: 'assistant', content: 'Previous answer' },
        ],
        '/workspace'
      )) {
        chunks.push(chunk);
      }

      const promptArg = mockProcessManager.start.mock.calls[0][0];
      expect(promptArg).toContain('历史对话上下文');
      expect(promptArg).toContain('[用户] Previous question');
      expect(promptArg).toContain('[助手] Previous answer');
      expect(promptArg).toContain('Current question');
    });
  });

  describe('session management', () => {
    it('should create new session', async () => {
      const session = await adapter.createNewSession('/workspace');
      expect(session).not.toBeNull();
      // createNewSession 现在调用 resetSession 来清除现有映射
      expect(mockSessionManager.resetSession).toHaveBeenCalledWith('/workspace');
    });

    it('should list sessions', async () => {
      const sessions = await adapter.listSessions(10);
      expect(mockSessionManager.listSessions).toHaveBeenCalledWith(10, undefined);
    });

    it('should switch session', async () => {
      const result = await adapter.switchSession('sess-123', '/workspace');
      expect(result).toBe(true);
      expect(mockSessionManager.switchSession).toHaveBeenCalledWith('sess-123', '/workspace');
    });

    it('should reset session', async () => {
      const result = await adapter.resetSession();
      expect(mockSessionManager.resetSession).toHaveBeenCalled();
    });

    it('should rename session', async () => {
      // renameSession 现在通过 sessionManager 实现
      const result = await adapter.renameSession('sess-123', 'New Title');
      expect(result).toBe(true);
      expect(mockSessionManager.renameSession).toHaveBeenCalledWith('sess-123', 'New Title');
    });

    it('should delete session', async () => {
      const result = await adapter.deleteSession('sess-123');
      expect(result).toBe(true);
      expect(mockSessionManager.deleteSession).toHaveBeenCalledWith('sess-123');
    });
  });

  describe('model management', () => {
    it('should list models', async () => {
      const models = await adapter.listModels();
      expect(models.length).toBeGreaterThan(0);
      expect(models.some((m) => m.id === 'claude-sonnet-4-6')).toBe(true);
    });

    it('should mark detected model as current', async () => {
      mockProcessManager.start.mockImplementation(async (_prompt: string, _sessionId: string, _workingDir: string, handlers: { onStdout?: (data: string) => void; onExit?: (code: number | null, signal: string | null) => void }) => {
        setTimeout(() => {
          handlers.onStdout?.(
            JSON.stringify({
              type: 'result',
              subtype: 'success',
              is_error: false,
              result: 'Done',
              session_id: 'test-session-id',
              total_cost_usd: 0,
              usage: { input_tokens: 1, output_tokens: 1, completion_tokens: 1, total_tokens: 2 },
              modelUsage: {
                'kimi-k2.5': {
                  inputTokens: 1,
                  outputTokens: 1,
                  cacheReadInputTokens: 0,
                  cacheCreationInputTokens: 0,
                  costUSD: 0,
                  contextWindow: 256000,
                  maxOutputTokens: 32000,
                },
              },
            }) + '\n'
          );
          handlers.onExit?.(0, null);
        }, 5);
        return true;
      });
      mockProcessManager.getIsRunning
        .mockReturnValueOnce(true)
        .mockReturnValue(false);

      for await (const _chunk of adapter.executeStream('test', [], '/workspace')) {
        // consume
      }

      const models = await adapter.listModels();
      const current = models.find((m) => m.name.includes('当前'));
      expect(current).toBeDefined();
      expect(current?.id).toBe('kimi-k2.5');
    });

    it('should return false for switchModel', async () => {
      const result = await adapter.switchModel('claude-opus-4-6');
      expect(result).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return default stats when no stream processed', () => {
      const stats = adapter.getStats([], '');
      expect(stats.totalTokens).toBe(0);
      expect(stats.model).toBe('auto-detect');
    });

    it('should return captured stats after stream', async () => {
      mockProcessManager.start.mockImplementation(async (_prompt: string, _sessionId: string, _workingDir: string, handlers: { onStdout?: (data: string) => void; onExit?: (code: number | null, signal: string | null) => void }) => {
        setTimeout(() => {
          handlers.onStdout?.(
            JSON.stringify({
              type: 'stream_event',
              event: {
                type: 'message_delta',
                delta: { stop_reason: 'end_turn' },
                usage: {
                  input_tokens: 100,
                  output_tokens: 50,
                  completion_tokens: 50,
                  total_tokens: 150,
                  cache_read_input_tokens: 0,
                },
              },
            }) + '\n'
          );
          handlers.onStdout?.(
            JSON.stringify({
              type: 'result',
              subtype: 'success',
              is_error: false,
              result: 'Done',
              session_id: 'test-session-id',
              total_cost_usd: 0,
              usage: { input_tokens: 100, output_tokens: 50, completion_tokens: 50, total_tokens: 150 },
              modelUsage: {
                'claude-sonnet-4-6': {
                  inputTokens: 100,
                  outputTokens: 50,
                  cacheReadInputTokens: 0,
                  cacheCreationInputTokens: 0,
                  costUSD: 0,
                  contextWindow: 200000,
                  maxOutputTokens: 32000,
                },
              },
            }) + '\n'
          );
          handlers.onExit?.(0, null);
        }, 5);
        return true;
      });
      mockProcessManager.getIsRunning
        .mockReturnValueOnce(true)
        .mockReturnValue(false);

      for await (const _chunk of adapter.executeStream('test', [], '/workspace')) {
        // consume stream
      }

      const stats = adapter.getStats([], '');
      expect(stats.totalTokens).toBe(150);
      expect(stats.promptTokens).toBe(100);
      expect(stats.completionTokens).toBe(50);
      expect(stats.model).toBe('claude-sonnet-4-6');
      expect(stats.contextWindow).toBe(200000);
    });
  });
});
