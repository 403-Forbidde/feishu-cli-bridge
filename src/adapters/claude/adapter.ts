/**
 * Claude Code 适配器主实现
 * Claude Code Adapter Main Implementation
 *
 * 实现 ICLIAdapter 接口，通过子进程调用 Claude Code CLI
 *
 * 关键特性：
 * - 子进程通信（spawn + JSON Lines）
 * - 动态模型检测（支持第三方 Provider 如 Kimi）
 * - SIGINT 信号停止生成
 * - @filepath 文件引用语法
 * - 会话管理（UUID 映射持久化）
 */

import { existsSync } from 'node:fs';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Attachment, Message, ModelInfo, SessionInfo } from '../interface/types.js';
import { BaseCLIAdapter } from '../interface/base-adapter.js';
import { StreamChunkType, type StreamChunk, type TokenStats } from '../../core/types/stream.js';
import { logger } from '../../core/logger.js';
import type { AdapterConfig } from '../interface/types.js';
import { ClaudeCodeProcessManager, type ProcessEventHandlers } from './process-manager.js';
import { ClaudeCodeStreamParser, createClaudeProcessStream } from './stream-parser.js';
import { ClaudeCodeSessionManager } from './session-manager.js';
import type { ClaudeConfig, DetectedModelInfo } from './types.js';

/**
 * Claude Code 适配器
 */
export class ClaudeCodeAdapter extends BaseCLIAdapter {
  readonly name = 'claude';

  private claudeConfig: ClaudeConfig;
  private sessionManager: ClaudeCodeSessionManager;
  private processManager: ClaudeCodeProcessManager;

  /** 检测到的模型信息（动态检测） */
  private detectedModel: DetectedModelInfo | null = null;
  /** 当前 Token 统计 */
  private currentStats: TokenStats | null = null;
  /** 当前会话 ID */
  private currentSessionId: string | null = null;
  /** 当前工作目录 */
  private currentWorkingDir: string | null = null;
  /** 是否正在生成 */
  private isGenerating = false;
  /** 停止信号 */
  private stopRequested = false;

  constructor(adapterConfig: AdapterConfig) {
    super(adapterConfig);

    this.claudeConfig = {
      command: adapterConfig.command || 'claude',
      defaultModel: (adapterConfig.defaultModel as string | 'auto') || 'auto',
      contextWindow: 'auto',
      timeout: adapterConfig.timeout || 300,
      permissionMode: 'acceptEdits',
      allowedTools: [],
      baseDir: process.cwd(),
    };

    // 初始化会话管理器
    this.sessionManager = new ClaudeCodeSessionManager(this.claudeConfig.baseDir);

    // 初始化子进程管理器
    this.processManager = new ClaudeCodeProcessManager({
      command: this.claudeConfig.command,
      timeoutMs: this.claudeConfig.timeout * 1000,
      env: {
        defaultModel: this.claudeConfig.defaultModel,
        contextWindow: this.claudeConfig.contextWindow,
        timeout: this.claudeConfig.timeout,
        permissionMode: this.claudeConfig.permissionMode,
        allowedTools: this.claudeConfig.allowedTools,
        baseDir: this.claudeConfig.baseDir,
      },
    });
  }

  /**
   * 获取默认模型
   * 支持动态检测（从 result.modelUsage 读取）
   */
  get defaultModel(): string {
    // 如果已检测到模型，使用检测到的模型
    if (this.detectedModel?.modelId) {
      return this.detectedModel.modelId;
    }
    // 如果配置为 auto，返回占位符
    if (this.claudeConfig.defaultModel === 'auto') {
      return 'auto-detect';
    }
    return this.claudeConfig.defaultModel;
  }

  /**
   * 获取上下文窗口大小
   * 支持动态检测
   */
  get contextWindow(): number {
    // 如果已检测到，使用检测到的值
    if (this.detectedModel?.contextWindow) {
      return this.detectedModel.contextWindow;
    }
    // 默认值
    return 200000;
  }

  /**
   * 初始化适配器
   */
  async initialize(): Promise<void> {
    await this.sessionManager.initialize();
    logger.info('ClaudeCodeAdapter initialized');
  }

  /**
   * 辅助函数：延迟
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 尝试从 JSON 行中提取 session_id（从 system 事件）
   */
  private tryExtractSessionId(line: string): string | null {
    try {
      const event = JSON.parse(line);
      // system 事件格式：{ "type": "system", "subtype": "init", "session_id": "...", ... }
      if (event.type === 'system' && event.subtype === 'init' && event.session_id) {
        logger.info({ sessionId: event.session_id }, 'Captured session_id from system event');
        return event.session_id as string;
      }
    } catch {
      // JSON 解析失败，忽略
    }
    return null;
  }

  /**
   * 执行流式对话
   *
   * 流程：
   * 1. 获取或创建会话 ID
   * 2. 准备 prompt（含上下文和附件引用）
   * 3. 启动子进程
   * 4. 流式解析输出
   * 5. 捕获模型信息（动态检测）
   */
  async *executeStream(
    prompt: string,
    context: Message[],
    workingDir: string,
    attachments?: Attachment[]
  ): AsyncIterable<StreamChunk> {
    this.stopRequested = false;
    this.isGenerating = true;
    this.currentWorkingDir = workingDir;
    const tempFiles: string[] = [];

    try {
      // 初始化会话管理器（如果尚未初始化）
      await this.sessionManager.initialize();

      // 获取或创建会话 ID
      // 返回 null 表示需要创建新会话（不传 --resume）
      let sessionId = await this.sessionManager.getOrCreateSessionId(workingDir);
      let isNewSession = sessionId === null;

      if (isNewSession) {
        // 新会话：sessionId 暂时使用占位符，将从 system 事件中获取真实 ID
        sessionId = 'pending';
      }

      this.currentSessionId = sessionId;

      logger.info({ sessionId, workingDir, isNewSession }, 'Starting Claude Code stream');

      // 准备临时文件（用于附件）
      if (attachments && attachments.length > 0) {
        const tempPaths = await this.prepareAttachments(attachments, workingDir);
        tempFiles.push(...tempPaths);
      }

      // 准备 prompt（含上下文和附件）
      const fullPrompt = await this.buildFullPrompt(prompt, context, attachments);

      // 创建流解析器
      const parser = new ClaudeCodeStreamParser();
      parser.resetState();

      // 设置 stdout 数据缓冲区
      let stdoutBuffer = '';
      const stdoutLines: string[] = [];

      // 标记是否已捕获 session_id
      let sessionIdCaptured = false;

      const handlers: ProcessEventHandlers = {
        onStdout: (data: string) => {
          stdoutBuffer += data;
          // 按行分割
          const parts = stdoutBuffer.split('\n');
          stdoutBuffer = parts.pop() || ''; // 保留不完整的最后一行

          for (const line of parts) {
            if (line.trim()) {
              stdoutLines.push(line);

              // 检查是否是 system 事件，捕获 session_id
              if (isNewSession && !sessionIdCaptured) {
                const capturedId = this.tryExtractSessionId(line);
                if (capturedId) {
                  sessionIdCaptured = true;
                  this.currentSessionId = capturedId;
                  // 异步保存映射（不阻塞流处理）
                  this.sessionManager.saveSessionMapping(workingDir, capturedId)
                    .catch(err => logger.error({ err }, 'Failed to save session mapping'));
                }
              }
            }
          }
        },
        onStderr: (data: string) => {
          logger.debug({ stderr: data.substring(0, 200) }, 'Claude Code stderr');
        },
        onExit: (code, signal) => {
          logger.info({ code, signal }, 'Claude Code process exited');
          this.isGenerating = false;
        },
        onError: (error) => {
          logger.error({ err: error }, 'Claude Code process error');
          this.isGenerating = false;
        },
      };

      // 启动子进程
      // 新会话时传 null，让 CLI 自动生成 session ID
      // 继续会话时传已保存的 sessionId
      const processSessionId = isNewSession ? null : sessionId;
      const started = await this.processManager.start(
        fullPrompt,
        processSessionId,
        workingDir,
        handlers,
        {
          isNewSession,
          resumeSessionId: isNewSession ? undefined : sessionId || undefined,
        }
      );

      if (!started) {
        yield {
          type: StreamChunkType.ERROR,
          data: 'Failed to start Claude Code process',
        };
        return;
      }

      // 流式处理输出
      const startTime = Date.now();
      const timeoutMs = this.claudeConfig.timeout * 1000;

      while (this.isGenerating || stdoutLines.length > 0) {
        // 检查停止请求
        if (this.stopRequested) {
          logger.info('Stop requested, terminating process');
          await this.processManager.sendStopSignal();
          yield {
            type: StreamChunkType.DONE,
            data: '',
          };
          return;
        }

        // 检查超时
        if (Date.now() - startTime > timeoutMs) {
          yield {
            type: StreamChunkType.ERROR,
            data: 'Claude Code execution timeout',
          };
          await this.processManager.stop();
          return;
        }

        // 处理所有已缓冲的行
        while (stdoutLines.length > 0) {
          const line = stdoutLines.shift()!;
          const chunk = parser.parseLine(line);

          if (chunk) {
            // 检查是否检测到模型信息
            if (chunk.type === StreamChunkType.DONE || chunk.type === StreamChunkType.STATS) {
              const detectedModel = parser.getDetectedModel();
              if (detectedModel) {
                this.detectedModel = detectedModel;
                logger.info({ modelId: detectedModel.modelId }, 'Detected model from stream');
              }

              // 更新 Token 统计
              const stats = parser.getCurrentStats();
              logger.debug({
                stats,
                chunkType: chunk.type,
                detectedModel: this.detectedModel?.modelId,
              }, 'Updating token stats');

              if (stats) {
                this.currentStats = {
                  totalTokens: stats.totalTokens || 0,
                  promptTokens: stats.promptTokens || 0,
                  completionTokens: stats.completionTokens || 0,
                  contextUsed: stats.totalTokens || 0,
                  contextWindow: this.detectedModel?.contextWindow || 200000,
                  contextPercent: 0,
                  model: this.detectedModel?.modelId || this.defaultModel,
                };

                // 计算上下文百分比（保留1位小数，与OpenCode一致）
                if (this.currentStats.contextWindow > 0) {
                  this.currentStats.contextPercent = Math.min(
                    100,
                    Math.round((this.currentStats.totalTokens / this.currentStats.contextWindow) * 1000) / 10
                  );
                }

                logger.debug({
                  totalTokens: this.currentStats.totalTokens,
                  contextPercent: this.currentStats.contextPercent,
                  model: this.currentStats.model,
                }, 'Token stats updated');
              } else {
                logger.debug('No stats available from parser');
              }
            }

            // Stats chunk 由适配器内部消费，不传递给下游
            if (chunk.type === StreamChunkType.STATS) {
              continue;
            }

            yield chunk;

            // 如果是终止 chunk，结束流
            if (chunk.type === StreamChunkType.DONE || chunk.type === StreamChunkType.ERROR) {
              this.isGenerating = false;
              return;
            }
          }
        }

        // 如果进程还在运行且没有新数据，等待一段时间
        if (this.processManager.getIsRunning() && stdoutLines.length === 0) {
          await this.sleep(50);
        } else if (!this.processManager.getIsRunning() && stdoutLines.length === 0) {
          // 进程已结束且没有待处理数据
          break;
        }
      }

      // 处理剩余的缓冲区
      if (stdoutBuffer.trim()) {
        const chunk = parser.parseLine(stdoutBuffer);
        if (chunk && chunk.type !== StreamChunkType.STATS) {
          yield chunk;
        }
      }

      // 发送最终的 DELIVER chunk
      const deliverChunk = parser.createDeliverChunk();
      if (deliverChunk) {
        yield deliverChunk;
      }

      // 发送 DONE
      yield {
        type: StreamChunkType.DONE,
        data: '',
      };

    } catch (error) {
      logger.error({ err: error }, 'Error in executeStream');
      yield {
        type: StreamChunkType.ERROR,
        data: error instanceof Error ? error.message : String(error),
      };
    } finally {
      this.isGenerating = false;
      this.stopRequested = false;

      // 清理临时文件
      await this.cleanupTempFiles(tempFiles);
    }
  }

  /**
   * 创建新会话
   * @param workingDir - 工作目录
   * @returns 会话信息或 null
   */
  async createNewSession(workingDir?: string): Promise<SessionInfo | null> {
    const dir = workingDir || this.currentWorkingDir || process.cwd();
    await this.sessionManager.initialize();
    // 重置会话会删除当前映射，下次 executeStream 时会创建新会话
    const result = await this.sessionManager.resetSession(dir);
    if (!result) return null;

    // 返回一个占位符 SessionInfo，真实的 session ID 将在首次对话时从流中捕获
    return {
      id: 'pending',
      title: dir.split(/[\/]/).pop() || 'unknown',
      workingDir: dir,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  /**
   * 列出会话
   * @param limit - 最大数量
   * @param directory - 指定目录（可选，用于过滤该目录下的会话）
   * @returns 会话列表
   */
  async listSessions(limit?: number, directory?: string): Promise<SessionInfo[]> {
    await this.sessionManager.initialize();
    return await this.sessionManager.listSessions(limit, directory);
  }

  /**
   * 切换会话
   * @param sessionId - 会话 ID
   * @param workingDir - 工作目录（可选）
   * @returns 是否成功
   */
  async switchSession(sessionId: string, workingDir?: string): Promise<boolean> {
    await this.sessionManager.initialize();
    const result = await this.sessionManager.switchSession(sessionId, workingDir);
    if (result) {
      this.currentSessionId = sessionId;
      if (workingDir) {
        this.currentWorkingDir = workingDir;
      }
    }
    return result;
  }

  /**
   * 重置当前会话
   * @returns 是否成功
   */
  async resetSession(): Promise<boolean> {
    await this.sessionManager.initialize();
    const workingDir = this.currentWorkingDir || process.cwd();
    const result = await this.sessionManager.resetSession(workingDir);
    if (result) {
      this.currentSessionId = null;
    }
    return result;
  }

  /**
   * 重命名会话
   * @param _sessionId - 会话 ID
   * @param _title - 新标题
   * @returns 是否成功
   */
  async renameSession(sessionId: string, title: string): Promise<boolean> {
    // Claude Code CLI 本身不支持重命名会话，但我们在 session-manager 中
    // 通过本地映射存储自定义标题来实现此功能
    return await this.sessionManager.renameSession(sessionId, title);
  }

  /**
   * 删除会话
   * @param sessionId - 会话 ID
   * @returns 是否成功
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    await this.sessionManager.initialize();
    return await this.sessionManager.deleteSession(sessionId);
  }

  /**
   * 列出可用模型
   * Claude Code 支持通过 ANTHROPIC_BASE_URL 使用不同 Provider
   * @returns 模型列表
   */
  async listModels(): Promise<ModelInfo[]> {
    // 返回 Claude Code 支持的模型列表
    // 注意：实际使用的模型取决于用户的 ANTHROPIC_BASE_URL 配置
    const models: ModelInfo[] = [
      {
        id: 'claude-opus-4-6',
        name: 'Claude Opus 4.6',
        provider: 'anthropic',
        contextWindow: 200000,
        capabilities: {
          reasoning: true,
          toolcall: true,
          input: { text: true, image: true },
          output: { text: true },
        },
      },
      {
        id: 'claude-sonnet-4-6',
        name: 'Claude Sonnet 4.6',
        provider: 'anthropic',
        contextWindow: 200000,
        capabilities: {
          reasoning: true,
          toolcall: true,
          input: { text: true, image: true },
          output: { text: true },
        },
      },
      {
        id: 'kimi-k2.5',
        name: 'Kimi K2.5',
        provider: 'kimi',
        contextWindow: 256000,
        capabilities: {
          reasoning: true,
          toolcall: true,
          input: { text: true, image: true },
          output: { text: true },
        },
      },
    ];

    // 如果已检测到模型，将其标记为当前使用
    if (this.detectedModel) {
      const detected = models.find((m) => m.id === this.detectedModel?.modelId);
      if (detected) {
        detected.name += ' (当前)';
      } else {
        // 添加检测到的未知模型（赋予默认能力标签）
        models.unshift({
          id: this.detectedModel.modelId,
          name: `${this.detectedModel.modelId} (当前)`,
          provider: 'unknown',
          contextWindow: this.detectedModel.contextWindow,
          capabilities: {
            reasoning: true,
            toolcall: true,
            input: { text: true, image: true },
            output: { text: true },
          },
        });
      }
    }

    // auto 模式下尚未检测到时，加入占位条目，确保当前激活区域能显示能力
    if (this.claudeConfig.defaultModel === 'auto' && !this.detectedModel) {
      models.unshift({
        id: 'auto',
        name: '自动检测',
        provider: 'auto',
        contextWindow: 200000,
        capabilities: {
          reasoning: true,
          toolcall: true,
          input: { text: true, image: true },
          output: { text: true },
        },
      });
    }

    return models;
  }

  /**
   * 切换模型
   * 注意：Claude Code 的模型切换通过环境变量或配置文件实现
   * 适配器层面无法直接切换，返回提示信息
   */
  async switchModel(modelId: string): Promise<boolean> {
    logger.info({ modelId }, 'Model switch requested for Claude Code');
    // Claude Code 的模型由环境变量 ANTHROPIC_BASE_URL 和 settings.json 控制
    // 适配器无法直接切换，需要提示用户手动配置
    return false;
  }

  /**
   * 获取当前模型 ID
   */
  getCurrentModel(): string {
    return this.detectedModel?.modelId || this.claudeConfig.defaultModel;
  }

  /**
   * 停止生成
   * 发送 SIGINT 信号给子进程
   */
  async stopGeneration(): Promise<boolean> {
    if (!this.isGenerating) {
      logger.debug('No generation in progress');
      return false;
    }

    this.stopRequested = true;
    logger.info('Stop generation requested');

    // 发送 SIGINT 信号
    const result = await this.processManager.sendStopSignal();
    return result;
  }

  /**
   * 计算 Token 统计
   * 优先使用从流输出中捕获的精确统计
   */
  getStats(_context: Message[], _completionText: string): TokenStats {
    // 如果已有从流中捕获的统计，直接使用
    if (this.currentStats) {
      return this.currentStats;
    }

    // 返回默认统计
    return {
      totalTokens: 0,
      promptTokens: 0,
      completionTokens: 0,
      contextUsed: 0,
      contextWindow: this.contextWindow,
      contextPercent: 0,
      model: this.defaultModel,
    };
  }

  /**
   * 获取会话 ID
   * @param workingDir - 工作目录
   * @returns 会话 ID 或 null
   */
  getSessionId(workingDir: string): string | null {
    return this.sessionManager.getSessionId(workingDir);
  }

  /**
   * 获取检测到的模型信息
   */
  getDetectedModel(): DetectedModelInfo | null {
    return this.detectedModel;
  }

  /**
   * 获取支持的 TUI 命令列表
   * Claude Code 不支持 Agent 模式切换（/mode）
   */
  getSupportedTUICommands(): string[] {
    return ['new', 'session', 'reset', 'clear', 'rename', 'delete', 'help'];
  }

  /**
   * 构建完整的 prompt（含上下文和附件引用）
   */
  private async buildFullPrompt(
    prompt: string,
    context: Message[],
    attachments?: Attachment[]
  ): Promise<string> {
    const parts: string[] = [];

    // 添加上下文（如果有）
    if (context.length > 0) {
      parts.push('以下是历史对话上下文：');
      for (const msg of context) {
        const role = msg.role === 'user' ? '用户' : '助手';
        parts.push(`[${role}] ${msg.content}`);
      }
      parts.push(''); // 空行分隔
    }

    // 添加当前 prompt
    parts.push(prompt);

    // 添加附件引用（使用 @filepath 语法）
    // 注意：Claude Code CLI 的 -p headless 模式仅支持通过 Read 工具读取文本文件，
    // 不支援将图片作为多模态输入直接嵌入 prompt。因此图片附件仅作文字说明。
    if (attachments && attachments.length > 0) {
      const textFiles = attachments.filter(a => a.resourceType === 'file');
      const images = attachments.filter(a => a.resourceType === 'image');

      if (textFiles.length > 0) {
        parts.push('');
        parts.push('附件文件：');
        for (const att of textFiles) {
          if (att.path) {
            parts.push(`@${att.path}`);
          }
        }
      }

      if (images.length > 0) {
        parts.push('');
        parts.push('图片附件（当前 CLI 模式暂不支持图片内容识别）：');
        for (const att of images) {
          parts.push(`- ${att.filename}`);
        }
      }
    }

    return parts.join('\n');
  }

  /**
   * 准备附件文件
   * 将附件写入临时目录，返回文件路径列表
   */
  private async prepareAttachments(attachments: Attachment[], workingDir: string): Promise<string[]> {
    const tempDir = join(workingDir, '.claude-temp');
    const tempFiles: string[] = [];

    // 创建临时目录
    await mkdir(tempDir, { recursive: true });

    for (const att of attachments) {
      // 优先使用已有的本地路径（由 AttachmentProcessor 下载）
      const localPath = (att as unknown as { localPath?: string }).localPath || att.path;

      if (localPath && existsSync(localPath)) {
        // 如果已经在临时目录内，直接使用
        if (localPath.startsWith(tempDir)) {
          att.path = localPath;
          tempFiles.push(localPath);
        } else {
          const tempPath = join(tempDir, `${randomUUID()}_${att.filename}`);
          await copyFile(localPath, tempPath);
          tempFiles.push(tempPath);
          att.path = tempPath;
          logger.debug({ path: tempPath, filename: att.filename }, 'Prepared attachment (copy)');
        }
      } else if (att.data) {
        const tempPath = join(tempDir, `${randomUUID()}_${att.filename}`);
        await writeFile(tempPath, att.data);
        tempFiles.push(tempPath);

        // 更新 attachment 的 path
        att.path = tempPath;
        logger.debug({ path: tempPath, filename: att.filename }, 'Prepared attachment (write)');
      }
    }

    return tempFiles;
  }

  /**
   * 清理临时文件
   */
  private async cleanupTempFiles(tempFiles: string[]): Promise<void> {
    // 暂时保留临时文件用于调试
    // 在生产环境中可以删除
    logger.debug({ count: tempFiles.length }, 'Cleanup temp files (skipped for debugging)');
  }
}
