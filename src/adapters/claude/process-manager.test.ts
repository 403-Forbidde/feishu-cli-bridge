/**
 * Claude Code Process Manager 测试
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ClaudeCodeProcessManager } from './process-manager.js';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';

vi.mock('node:child_process', () => {
  return {
    spawn: vi.fn(),
  };
});

function createMockChildProcess(options: { pid?: number; exitCode?: number | null; signalCode?: string | null } = {}) {
  const { pid = 12345, exitCode = null, signalCode = null } = options;

  const ee = new EventEmitter();

  const mockProcess = {
    pid,
    exitCode,
    signalCode,
    stdout: Object.assign(new EventEmitter(), { setEncoding: vi.fn() }),
    stderr: Object.assign(new EventEmitter(), { setEncoding: vi.fn() }),
    stdin: Object.assign(new EventEmitter(), { end: vi.fn(), write: vi.fn() }),
    on: ee.on.bind(ee),
    once: ee.once.bind(ee),
    emit: ee.emit.bind(ee),
    kill: vi.fn((signal?: string | number) => {
      if (mockProcess.exitCode === null) {
        setTimeout(() => {
          mockProcess.exitCode = signal === 'SIGKILL' ? 1 : 0;
          mockProcess.signalCode = signal ? String(signal) : 'SIGTERM';
          ee.emit('exit', mockProcess.exitCode, mockProcess.signalCode);
        }, 10);
      }
      return true;
    }),
  };

  return mockProcess as unknown as ReturnType<typeof spawn> & {
    pid: number;
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
    stdout: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
    stderr: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
    emit: (event: string, ...args: unknown[]) => void;
  };
}

describe('ClaudeCodeProcessManager', () => {
  let manager: ClaudeCodeProcessManager;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('start', () => {
    it('should spawn process with correct basic args and pass prompt via -p', async () => {
      const mockProcess = createMockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ReturnType<typeof spawn>);

      manager = new ClaudeCodeProcessManager({
        command: '/usr/local/bin/claude',
        timeoutMs: 5000,
      });

      const started = await manager.start('Hello Claude', 'sess-123', '/workspace', {});
      expect(started).toBe(true);

      expect(spawn).toHaveBeenCalledTimes(1);
      const [cmd, args, opts] = vi.mocked(spawn).mock.calls[0];
      expect(cmd).toBe('/usr/local/bin/claude');
      expect(args).toContain('-p');
      expect(args).toContain('Hello Claude');
      expect(args).toContain('--output-format');
      expect(args).toContain('stream-json');
      expect(args).toContain('--include-partial-messages');
      expect(args).toContain('--verbose');
      // 注意：不再传递 --session-id，Claude CLI 自动生成 session ID
      expect(args).toContain('--bare');
      expect(opts).toMatchObject({
        cwd: '/workspace',
        detached: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      });
    });

    it('should use --resume for existing session', async () => {
      const mockProcess = createMockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ReturnType<typeof spawn>);

      manager = new ClaudeCodeProcessManager({
        command: '/usr/local/bin/claude',
        timeoutMs: 5000,
      });

      await manager.start('Hello', 'sess-456', '/workspace', {}, { isNewSession: false, resumeSessionId: 'sess-456' });

      const [, args] = vi.mocked(spawn).mock.calls[0];
      expect(args).toContain('--resume');
      expect(args).toContain('sess-456');
    });

    it('should skip --continue for new session', async () => {
      const mockProcess = createMockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ReturnType<typeof spawn>);

      manager = new ClaudeCodeProcessManager({
        command: '/usr/local/bin/claude',
        timeoutMs: 5000,
      });

      await manager.start('Hello', 'sess-new', '/workspace', {}, { isNewSession: true });

      const [, args] = vi.mocked(spawn).mock.calls[0];
      expect(args).not.toContain('--continue');
      expect(args).not.toContain('--fork-session');
    });

    it('should use --resume when resumeSessionId is provided', async () => {
      const mockProcess = createMockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ReturnType<typeof spawn>);

      manager = new ClaudeCodeProcessManager({
        command: '/usr/local/bin/claude',
        timeoutMs: 5000,
      });

      await manager.start('Hello', 'sess-789', '/workspace', {}, { resumeSessionId: 'sess-789' });

      const [, args] = vi.mocked(spawn).mock.calls[0];
      expect(args).toContain('--resume');
      expect(args).toContain('sess-789');
      expect(args).not.toContain('--continue');
      expect(args).not.toContain('--fork-session');
    });

    it('should add --model when defaultModel is not auto', async () => {
      const mockProcess = createMockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ReturnType<typeof spawn>);

      manager = new ClaudeCodeProcessManager({
        command: '/usr/local/bin/claude',
        timeoutMs: 5000,
        env: {
          defaultModel: 'claude-sonnet-4-6',
          permissionMode: 'plan',
          allowedTools: ['Bash', 'Read', 'Edit', 'Grep'],
        },
      });

      await manager.start('Hello', 'sess-001', '/workspace', {});

      const [, args] = vi.mocked(spawn).mock.calls[0];
      expect(args).toContain('--model');
      expect(args).toContain('claude-sonnet-4-6');
      expect(args).toContain('--permission-mode');
      expect(args).toContain('plan');
      expect(args).toContain('--allowed-tools');
      expect(args).toContain('Bash,Read,Edit,Grep');
    });

    it('should skip --model when defaultModel is auto', async () => {
      const mockProcess = createMockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ReturnType<typeof spawn>);

      manager = new ClaudeCodeProcessManager({
        command: '/usr/local/bin/claude',
        timeoutMs: 5000,
        env: {
          defaultModel: 'auto',
        },
      });

      await manager.start('Hello', 'sess-002', '/workspace', {});

      const [, args] = vi.mocked(spawn).mock.calls[0];
      expect(args).not.toContain('--model');
    });

    it('should return false if process exits immediately', async () => {
      const mockProcess = createMockChildProcess({ exitCode: 1 });
      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ReturnType<typeof spawn>);

      manager = new ClaudeCodeProcessManager({
        command: '/usr/local/bin/claude',
        timeoutMs: 5000,
      });

      const started = await manager.start('Hello', 'sess-003', '/workspace', {});
      expect(started).toBe(false);
    });

    it('should capture stderr output', async () => {
      const mockProcess = createMockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ReturnType<typeof spawn>);

      manager = new ClaudeCodeProcessManager({
        command: '/usr/local/bin/claude',
        timeoutMs: 5000,
      });

      const onStderr = vi.fn();
      await manager.start('Hello', 'sess-004', '/workspace', { onStderr });

      mockProcess.stderr.emit('data', 'Warning: something went wrong\n');

      expect(onStderr).toHaveBeenCalledWith('Warning: something went wrong\n');
      expect(manager.getStderrBuffer()).toContain('something went wrong');
    });

    it('should use shell: true on Windows for .cmd files', async () => {
      const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const mockProcess = createMockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ReturnType<typeof spawn>);

      manager = new ClaudeCodeProcessManager({
        command: 'C:\\Users\\test\\claude.cmd',
        timeoutMs: 5000,
      });

      await manager.start('Hello', 'sess-win', '/workspace', {});

      const [, , opts] = vi.mocked(spawn).mock.calls[0];
      expect(opts).toMatchObject({ shell: true });

      if (originalPlatform) {
        Object.defineProperty(process, 'platform', originalPlatform);
      }
    });
  });

  describe('sendStopSignal', () => {
    it('should send SIGINT to running process', async () => {
      const mockProcess = createMockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ReturnType<typeof spawn>);

      manager = new ClaudeCodeProcessManager({
        command: '/usr/local/bin/claude',
        timeoutMs: 5000,
      });

      await manager.start('Hello', 'sess-005', '/workspace', {});
      const result = await manager.sendStopSignal();

      expect(result).toBe(true);
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGINT');
    });

    it('should return false when no process is running', async () => {
      manager = new ClaudeCodeProcessManager({
        command: '/usr/local/bin/claude',
        timeoutMs: 5000,
      });

      const result = await manager.sendStopSignal();
      expect(result).toBe(false);
    });
  });

  describe('stop', () => {
    it('should send SIGINT and wait for graceful exit', async () => {
      const mockProcess = createMockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ReturnType<typeof spawn>);

      manager = new ClaudeCodeProcessManager({
        command: '/usr/local/bin/claude',
        timeoutMs: 5000,
      });

      await manager.start('Hello', 'sess-006', '/workspace', {});

      // Simulate process exiting on SIGINT
      mockProcess.kill.mockImplementation((signal?: string | number) => {
        if (mockProcess.exitCode === null) {
          setTimeout(() => {
            mockProcess.exitCode = 0;
            mockProcess.signalCode = signal ? (String(signal) as NodeJS.Signals) : 'SIGTERM';
            mockProcess.emit('exit', 0, mockProcess.signalCode);
          }, 10);
        }
        return true;
      });

      const stopPromise = manager.stop(500);
      await vi.advanceTimersByTimeAsync(100);
      const result = await stopPromise;

      expect(result.exitCode).toBe(0);
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGINT');
    });

    it('should escalate to SIGKILL if SIGINT times out', async () => {
      const mockProcess = createMockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ReturnType<typeof spawn>);

      manager = new ClaudeCodeProcessManager({
        command: '/usr/local/bin/claude',
        timeoutMs: 5000,
      });

      await manager.start('Hello', 'sess-007', '/workspace', {});

      // Process ignores SIGINT
      mockProcess.kill.mockImplementation(() => true);

      const stopPromise = manager.stop(50);
      await vi.advanceTimersByTimeAsync(200);
      const result = await stopPromise;

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGINT');
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL');
    });

    it('should return immediately if process already exited', async () => {
      const mockProcess = createMockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ReturnType<typeof spawn>);

      manager = new ClaudeCodeProcessManager({
        command: '/usr/local/bin/claude',
        timeoutMs: 5000,
      });

      await manager.start('Hello', 'sess-008', '/workspace', {});
      // Simulate process having already exited externally
      mockProcess.exitCode = 0;
      const result = await manager.stop();

      expect(result.exitCode).toBe(0);
      expect(mockProcess.kill).not.toHaveBeenCalled();
    });
  });

  describe('getters', () => {
    it('should return correct pid and running state', async () => {
      const mockProcess = createMockChildProcess({ pid: 99999 });
      vi.mocked(spawn).mockReturnValue(mockProcess as unknown as ReturnType<typeof spawn>);

      manager = new ClaudeCodeProcessManager({
        command: '/usr/local/bin/claude',
        timeoutMs: 5000,
      });

      expect(manager.getIsRunning()).toBe(false);
      expect(manager.getPid()).toBeNull();

      await manager.start('Hello', 'sess-009', '/workspace', {});

      expect(manager.getIsRunning()).toBe(true);
      expect(manager.getPid()).toBe(99999);
    });
  });
});
