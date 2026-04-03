/**
 * OpenCode 服务器管理器
 * OpenCode Server Manager
 *
 * 管理 opencode serve 子进程的生命周期
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { logger } from '../../core/logger.js';
import { sleep } from '../../core/retry.js';
import type { OpenCodeConfig } from './types.js';
import type { OpenCodeHTTPClient } from './http-client.js';

/**
 * 服务器管理器选项
 */
export interface ServerManagerOptions {
  /** 配置 */
  config: OpenCodeConfig;
  /** HTTP 客户端 */
  httpClient: OpenCodeHTTPClient;
}

/**
 * OpenCode 服务器管理器
 * 负责启动、停止和监控 opencode serve 进程
 */
export class OpenCodeServerManager {
  private process: ChildProcess | null = null;
  private isRunning = false;
  private config: OpenCodeConfig;
  private httpClient: OpenCodeHTTPClient;

  constructor(options: ServerManagerOptions) {
    this.config = options.config;
    this.httpClient = options.httpClient;
  }

  /**
   * 启动 OpenCode 服务器
   * @returns 是否成功启动
   */
  async start(): Promise<boolean> {
    // 已经在运行中
    if (this.isRunning) {
      return true;
    }

    // 检查是否已有实例在运行
    const health = await this.httpClient.checkHealth();
    if (health.healthy) {
      this.isRunning = true;
      logger.info('OpenCode server already running');
      return true;
    }

    // 查找 opencode 可执行文件
    const opencodePath = await this.findOpenCodeBinary();
    if (!opencodePath) {
      logger.error('opencode binary not found in PATH');
      return false;
    }

    // 准备环境变量
    const env = {
      ...process.env,
      // 预授权外部目录访问，防止无头模式下 TUI 对话框阻塞
      OPENCODE_PERMISSION: JSON.stringify({ external_directory: 'allow' }),
    };

    // 启动子进程
    const args = ['serve', '--port', String(this.config.serverPort)];
    if (this.config.serverHostname !== '127.0.0.1') {
      args.push('--host', this.config.serverHostname);
    }

    logger.info(`Starting opencode serve on port ${this.config.serverPort}`);

    try {
      this.process = spawn(opencodePath, args, {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
      });

      // 收集 stderr 用于诊断
      let stderrBuffer = '';
      this.process.stderr?.on('data', (data: Buffer) => {
        stderrBuffer += data.toString();
        // 限制缓冲区大小
        if (stderrBuffer.length > 4096) {
          stderrBuffer = stderrBuffer.slice(-4096);
        }
      });

      // 监听进程退出
      this.process.on('exit', (code) => {
        this.isRunning = false;
        if (code !== 0 && code !== null) {
          logger.error(`opencode serve exited with code ${code}`);
        }
      });

      // 等待服务启动（指数退避策略）
      const startTime = Date.now();
      let delay = 100; // 初始延迟 100ms
      const timeout = 10000; // 总超时 10 秒

      while (Date.now() - startTime < timeout) {
        // 检查进程是否已退出
        if (this.process.exitCode !== null) {
          logger.error(
            `opencode serve exited unexpectedly (code=${this.process.exitCode}): ${stderrBuffer}`
          );
          return false;
        }

        // 检查健康状态
        const health = await this.httpClient.checkHealth();
        if (health.healthy) {
          this.isRunning = true;
          logger.info(
            `OpenCode server started successfully in ${Date.now() - startTime}ms`
          );
          return true;
        }

        // 指数退避等待
        await sleep(delay);
        delay = Math.min(delay * 2, 1000); // 翻倍，但不超过 1 秒
      }

      // 超时
      logger.error(
        `OpenCode server start timeout (10s). stderr: ${stderrBuffer || '(no output)'}`
      );
      this.stop();
      return false;
    } catch (error) {
      logger.error({ err: error }, 'Failed to start opencode serve');
      return false;
    }
  }

  /**
   * 停止 OpenCode 服务器
   */
  async stop(): Promise<void> {
    if (!this.process) {
      this.isRunning = false;
      return;
    }

    // 尝试优雅终止
    if (this.process.exitCode === null) {
      this.process.kill('SIGTERM');

      // 等待最多 5 秒
      let waitTime = 0;
      while (this.process.exitCode === null && waitTime < 5000) {
        await sleep(100);
        waitTime += 100;
      }

      // 如果还在运行，强制终止
      if (this.process.exitCode === null) {
        this.process.kill('SIGKILL');
      }
    }

    this.process = null;
    this.isRunning = false;
    logger.info('OpenCode server stopped');
  }

  /**
   * 检查服务器是否健康
   */
  async checkHealth(): Promise<boolean> {
    const health = await this.httpClient.checkHealth();
    return health.healthy;
  }

  /**
   * 获取运行状态
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }

  /**
   * 查找 opencode 可执行文件
   */
  private async findOpenCodeBinary(): Promise<string | null> {
    // 如果配置中指定了完整路径，直接使用
    if (this.config.command.includes('/') || this.config.command.includes('\\')) {
      return this.config.command;
    }

    // 在 PATH 中查找
    const { execSync } = await import('node:child_process');
    try {
      const result = execSync(
        process.platform === 'win32' ? 'where opencode' : 'which opencode',
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
      );
      // 清理 Windows 换行符 \r\n，分割多行
      const lines = result.trim().split('\n').map(l => l.replace(/\r/g, '').trim()).filter(Boolean);

      // Windows: where 命令可能返回无扩展名的 shim 和带扩展名的 .cmd/.exe
      // 优先选择有扩展名的可执行文件
      if (process.platform === 'win32') {
        const exeWithExt = lines.find(l => /\.(exe|cmd|bat|ps1)$/i.test(l));
        if (exeWithExt) return exeWithExt;
      }

      return lines[0] || null;
    } catch {
      return null;
    }
  }
}
