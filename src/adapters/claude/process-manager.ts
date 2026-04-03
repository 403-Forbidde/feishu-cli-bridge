/**
 * Claude Code 子进程管理器
 * Claude Code Process Manager
 *
 * 负责管理 claude CLI 子进程的生命周期
 * - 构建命令参数
 * - 启动/停止子进程
 * - 处理 stdout/stderr 输出
 * - 发送 SIGINT 信号停止生成
 */

import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { logger } from '../../core/logger.js';
import { sleep } from '../../core/retry.js';
import type { ClaudeConfig, ProcessResult, ProcessManagerOptions } from './types.js';

/**
 * 子进程事件处理器
 */
export interface ProcessEventHandlers {
  /** 收到 stdout 数据 */
  onStdout?: (data: string) => void;
  /** 收到 stderr 数据 */
  onStderr?: (data: string) => void;
  /** 进程退出 */
  onExit?: (code: number | null, signal: string | null) => void;
  /** 发生错误 */
  onError?: (error: Error) => void;
}

/**
 * Claude Code 子进程管理器
 * 管理 claude CLI 子进程的完整生命周期
 */
export class ClaudeCodeProcessManager {
  private process: ChildProcess | null = null;
  private config: ClaudeConfig;
  private sessionId: string | null = null;
  private workingDir: string | null = null;
  private isRunning = false;
  private stderrBuffer = '';
  private readonly maxStderrBufferSize = 4096;

  constructor(options: ProcessManagerOptions) {
    this.config = {
      command: options.command,
      defaultModel: 'auto',
      contextWindow: 'auto',
      timeout: 300,
      permissionMode: 'default',
      allowedTools: [],
      baseDir: process.cwd(),
      ...options.env,
    };
  }

  /**
   * 启动 Claude Code 子进程
   * @param prompt - 用户提示词
   * @param sessionId - 会话 ID（null 表示让 CLI 自动生成）
   * @param workingDir - 工作目录
   * @param handlers - 事件处理器
   * @param options - 启动选项
   * @returns 是否成功启动
   */
  async start(
    prompt: string,
    sessionId: string | null,
    workingDir: string,
    handlers: ProcessEventHandlers = {},
    options: {
      isNewSession?: boolean;
      resumeSessionId?: string;
    } = {}
  ): Promise<boolean> {
    // 检查是否已有进程在运行
    if (this.isRunning && this.process) {
      logger.warn('Claude Code process already running, stopping previous instance');
      await this.stop();
    }

    // 查找 claude 可执行文件
    const claudePath = await this.findClaudeBinary();
    if (!claudePath) {
      logger.error('claude binary not found in PATH');
      return false;
    }

    // 保存会话信息
    this.sessionId = sessionId;
    this.workingDir = workingDir;
    this.stderrBuffer = '';

    // 构建命令参数
    const args = this.buildArgs(prompt, sessionId, options);

    logger.info(
      { sessionId, model: this.config.defaultModel, permissionMode: this.config.permissionMode },
      `Starting Claude Code process in ${workingDir}`
    );

    // Windows: 执行 .cmd/.bat 文件需要 shell: true
    const isCmdFile = process.platform === 'win32' && /\.(cmd|bat)$/i.test(claudePath);

    const spawnOptions: SpawnOptions = {
      cwd: workingDir,
      detached: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: this.buildEnv(),
      shell: isCmdFile,
    };

    try {
      this.process = spawn(claudePath, args, spawnOptions);

      // prompt 通过 -p 参数传递（base64 已移除，不会触发 E2BIG）
      // stdin 保持可用以便后续扩展

      // 设置 stdout 处理器
      if (this.process.stdout) {
        this.process.stdout.setEncoding('utf-8');
        this.process.stdout.on('data', (data: string) => {
          handlers.onStdout?.(data);
        });
      }

      // 设置 stderr 处理器
      if (this.process.stderr) {
        this.process.stderr.setEncoding('utf-8');
        this.process.stderr.on('data', (data: string) => {
          // 收集 stderr 用于诊断
          this.stderrBuffer += data;
          if (this.stderrBuffer.length > this.maxStderrBufferSize) {
            this.stderrBuffer = this.stderrBuffer.slice(-this.maxStderrBufferSize);
          }
          handlers.onStderr?.(data);
        });
      }

      // 设置错误处理器
      this.process.on('error', (error: Error) => {
        this.isRunning = false;
        logger.error({ err: error }, 'Claude Code process error');
        handlers.onError?.(error);
      });

      // 设置退出处理器
      this.process.on('exit', (code: number | null, signal: string | null) => {
        this.isRunning = false;
        logger.info(`Claude Code process exited (code=${code}, signal=${signal})`);
        handlers.onExit?.(code, signal);
      });

      // 等待进程启动（短暂延迟确保进程已创建）
      await sleep(100);

      // 检查进程是否立即退出
      if (this.process.exitCode !== null) {
        logger.error(
          `Claude Code process exited immediately (code=${this.process.exitCode}): ${this.stderrBuffer}`
        );
        this.process = null;
        return false;
      }

      this.isRunning = true;
      logger.info('Claude Code process started successfully');
      return true;

    } catch (error) {
      logger.error({ err: error }, 'Failed to start Claude Code process');
      this.process = null;
      this.isRunning = false;
      return false;
    }
  }

  /**
   * 停止 Claude Code 子进程
   * 首先尝试 SIGINT，超时后使用 SIGKILL
   * @param timeoutMs - 等待优雅终止的超时时间（默认 5000ms）
   * @returns 进程执行结果
   */
  async stop(timeoutMs = 5000): Promise<ProcessResult> {
    if (!this.process) {
      return { exitCode: null, signal: null, stderr: '' };
    }

    const process = this.process;
    this.process = null;
    this.isRunning = false;

    // 如果进程已经退出
    if (process.exitCode !== null) {
      return {
        exitCode: process.exitCode,
        signal: null,
        stderr: this.stderrBuffer,
      };
    }

    // 首先尝试 SIGINT（优雅终止，允许 Claude Code 保存状态）
    logger.info('Sending SIGINT to Claude Code process');
    process.kill('SIGINT');

    // 等待进程退出
    const startTime = Date.now();
    while (process.exitCode === null && Date.now() - startTime < timeoutMs) {
      await sleep(100);
    }

    // 如果进程仍在运行，强制终止
    if (process.exitCode === null) {
      logger.warn('SIGINT timeout, sending SIGKILL');
      process.kill('SIGKILL');

      // 再等待一小段时间
      const killStartTime = Date.now();
      while (process.exitCode === null && Date.now() - killStartTime < 1000) {
        await sleep(50);
      }
    }

    const result: ProcessResult = {
      exitCode: process.exitCode,
      signal: process.signalCode,
      stderr: this.stderrBuffer,
    };

    logger.info({ exitCode: result.exitCode, signal: result.signal }, 'Claude Code process stopped');
    return result;
  }

  /**
   * 发送 SIGINT 信号停止生成
   * 用于 /stop 命令
   * @returns 是否成功发送信号
   */
  async sendStopSignal(): Promise<boolean> {
    if (!this.process || this.process.exitCode !== null) {
      logger.debug('No running process to stop');
      return false;
    }

    try {
      logger.info('Sending SIGINT to stop generation');
      this.process.kill('SIGINT');
      return true;
    } catch (error) {
      logger.error({ err: error }, 'Failed to send SIGINT');
      return false;
    }
  }

  /**
   * 检查进程是否正在运行
   */
  getIsRunning(): boolean {
    if (!this.process) {
      return false;
    }
    return this.process.exitCode === null;
  }

  /**
   * 获取当前进程 ID
   */
  getPid(): number | null {
    return this.process?.pid ?? null;
  }

  /**
   * 获取当前会话 ID
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * 获取当前工作目录
   */
  getWorkingDir(): string | null {
    return this.workingDir;
  }

  /**
   * 获取标准错误缓冲区内容
   */
  getStderrBuffer(): string {
    return this.stderrBuffer;
  }

  /**
   * 构建命令参数数组
   * @param prompt - 用户提示词
   * @param sessionId - 会话 ID（null 表示让 CLI 自动生成）
   * @param isNewSession - 是否为新会话
   * @returns 参数数组
   */
  private buildArgs(
    prompt: string,
    sessionId: string | null,
    options: { isNewSession?: boolean; resumeSessionId?: string } = {}
  ): string[] {
    const args: string[] = [
      '-p', prompt,
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--verbose',
    ];

    // 新会话：不传 --resume，让 CLI 自动生成 session ID
    // 继续会话：传 --resume 使用已保存的 session ID
    if (!options.isNewSession && options.resumeSessionId) {
      args.push('--resume', options.resumeSessionId);
    }
    // 注意：Claude Code 似乎忽略 --session-id 参数，所以我们不再传递它
    // 而是从 system 事件中捕获真实的 session_id

    // 仅在用户显式配置且非 auto 时添加 --model
    if (this.config.defaultModel && this.config.defaultModel !== 'auto') {
      args.push('--model', this.config.defaultModel);
    }

    // 添加权限模式
    args.push('--permission-mode', this.config.permissionMode);

    // 添加允许的工具列表
    if (this.config.allowedTools.length > 0) {
      args.push('--allowed-tools', this.config.allowedTools.join(','));
    }

    // 使用 --bare 加速启动，避免自动加载 hooks/mcp
    args.push('--bare');

    return args;
  }

  /**
   * 构建环境变量
   * @returns 环境变量对象
   */
  private buildEnv(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      // 确保输出是 UTF-8
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
    };
  }

  /**
   * 查找 claude 可执行文件
   * @returns 可执行文件路径或 null
   */
  private async findClaudeBinary(): Promise<string | null> {
    const command = this.config.command;

    // 如果配置中指定了完整路径，直接使用
    if (command.includes('/') || command.includes('\\')) {
      return command;
    }

    // 在 PATH 中查找
    const { execSync } = await import('node:child_process');
    try {
      const platform = process.platform;
      const whichCmd = platform === 'win32' ? 'where claude' : 'which claude';

      const result = execSync(whichCmd, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });

      // 清理 Windows 换行符 \r\n，分割多行
      const lines = result
        .trim()
        .split('\n')
        .map(l => l.replace(/\r/g, '').trim())
        .filter(Boolean);

      // Windows: where 命令可能返回无扩展名的 shim 和带扩展名的 .cmd/.exe
      // 优先选择有扩展名的可执行文件
      if (platform === 'win32') {
        const exeWithExt = lines.find(l => /\.(exe|cmd|bat|ps1)$/i.test(l));
        if (exeWithExt) return exeWithExt;
      }

      return lines[0] || null;
    } catch {
      return null;
    }
  }
}
