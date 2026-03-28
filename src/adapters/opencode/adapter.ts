/**
 * OpenCode 适配器主实现
 * OpenCode Adapter Main Implementation
 *
 * 实现 ICLIAdapter 接口，连接 OpenCode CLI
 */

import type { Attachment, Message, ModelInfo, SessionInfo } from '../interface/types.js';
import { BaseCLIAdapter } from '../interface/base-adapter.js';
import { StreamChunkType, type StreamChunk, type TokenStats } from '../../core/types/stream.js';
import { logger } from '../../core/logger.js';
import { AdapterError, AdapterErrorCode } from '../interface/types.js';
import type { AdapterConfig } from '../interface/types.js';
import { OpenCodeHTTPClient } from './http-client.js';
import { OpenCodeServerManager } from './server-manager.js';
import { OpenCodeSessionManager } from './session-manager.js';
import { createSSEIterator, SSEParserV2 } from './sse-parser.js';
import type { OpenCodeConfig, OpenCodeSession, ContextWindowCacheEntry, OpenCodeMessage } from './types.js';

/**
 * OpenCode 适配器
 */
export class OpenCodeAdapter extends BaseCLIAdapter {
  readonly name = 'opencode';
  readonly contextWindow = 128000; // 默认上下文窗口

  private httpClient: OpenCodeHTTPClient;
  private serverManager: OpenCodeServerManager;
  private sessionManager: OpenCodeSessionManager;
  private opencodeConfig: OpenCodeConfig;

  // 上下文窗口缓存（Issue #40: 从 API 动态获取）
  private contextWindowCache: Map<string, ContextWindowCacheEntry> = new Map();
  private readonly CACHE_TTL = 600000; // 10 分钟

  // 取消信号
  private abortController: AbortController | null = null;

  constructor(config: AdapterConfig) {
    super(config);

    this.opencodeConfig = {
      serverPort: 4096,
      serverHostname: '127.0.0.1',
      defaultModel: config.defaultModel,
      defaultAgent: 'build',
      command: config.command,
      timeout: config.timeout,
    };

    // 从配置中解析端口和主机名
    this.parseServerConfig(config);

    // 初始化组件
    this.httpClient = new OpenCodeHTTPClient(this.opencodeConfig);
    this.serverManager = new OpenCodeServerManager({
      config: this.opencodeConfig,
      httpClient: this.httpClient,
    });
    this.sessionManager = new OpenCodeSessionManager({
      httpClient: this.httpClient,
      config: this.opencodeConfig,
    });
  }

  /**
   * 获取默认模型
   */
  get defaultModel(): string {
    return this.opencodeConfig.defaultModel;
  }

  /**
   * 执行流式对话
   */
  async *executeStream(
    prompt: string,
    context: Message[],
    workingDir: string,
    attachments?: Attachment[]
  ): AsyncIterable<StreamChunk> {
    // 确保服务器运行
    const started = await this.ensureServer();
    if (!started) {
      throw new AdapterError(
        'OpenCode server failed to start',
        AdapterErrorCode.SERVER_NOT_RUNNING
      );
    }

    // 获取或创建会话
    const session = await this.sessionManager.getOrCreateSession(workingDir);

    // 准备请求
    const messages = this.buildMessages(context, prompt);
    const requestAttachments = this.buildAttachments(attachments);

    // 创建 AbortController 用于取消
    this.abortController = new AbortController();

    try {
      // 发送请求获取流
      const stream = await this.httpClient.chatStream({
        messages,
        session: session.id,
        stream: true,
        attachments: requestAttachments,
      });

      // 使用 SSE 解析器
      let buffer = '';
      let done = false;

      stream.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
      });

      stream.on('end', () => {
        done = true;
      });

      stream.on('error', (error: Error) => {
        logger.error({ err: error }, 'Stream error');
        done = true;
      });

      // 创建 SSE 解析器
      const chunks: StreamChunk[] = [];
      let resolveNext: ((chunk: StreamChunk | null) => void) | null = null;

      const parser = new SSEParserV2((chunk) => {
        if (resolveNext) {
          resolveNext(chunk);
          resolveNext = null;
        } else {
          chunks.push(chunk);
        }
      });

      // 处理流数据
      while (!done || buffer.length > 0) {
        // 检查是否被取消
        if (this.abortController.signal.aborted) {
          await this.stopGeneration();
          yield {
            type: StreamChunkType.DONE,
            data: '',
          };
          return;
        }

        if (buffer.length > 0) {
          const data = buffer;
          buffer = '';
          parser.parse(data);
        }

        if (chunks.length > 0) {
          yield chunks.shift()!;
        } else if (!done) {
          // 等待更多数据
          const chunk = await new Promise<StreamChunk | null>((resolve) => {
            resolveNext = resolve;
            setTimeout(() => resolve(null), 100);
          });
          if (chunk) {
            yield chunk;
          }
        }
      }

      // 发送完成信号
      yield {
        type: StreamChunkType.DONE,
        data: '',
      };
    } catch (error) {
      logger.error({ err: error }, 'Error in executeStream');
      throw error;
    } finally {
      this.abortController = null;
    }
  }

  /**
   * 创建新会话
   */
  async createNewSession(workingDir?: string): Promise<SessionInfo | null> {
    await this.ensureServer();

    const dir = workingDir || process.cwd();
    const session = await this.sessionManager.getOrCreateSession(dir);
    return session;
  }

  /**
   * 列出会话
   */
  async listSessions(limit?: number, directory?: string): Promise<SessionInfo[]> {
    await this.ensureServer();

    const sessions = await this.sessionManager.listSessions();

    if (limit) {
      return sessions.slice(0, limit);
    }

    return sessions;
  }

  /**
   * 切换会话
   */
  async switchSession(sessionId: string, workingDir?: string): Promise<boolean> {
    await this.ensureServer();

    return await this.sessionManager.switchSession(sessionId, workingDir);
  }

  /**
   * 重置当前会话
   */
  async resetSession(): Promise<boolean> {
    await this.ensureServer();

    return await this.sessionManager.resetSession();
  }

  /**
   * 重命名会话
   */
  async renameSession(sessionId: string, title: string): Promise<boolean> {
    await this.ensureServer();

    return await this.sessionManager.renameSession(sessionId, title);
  }

  /**
   * 删除会话
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    await this.ensureServer();

    return await this.sessionManager.deleteSession(sessionId);
  }

  /**
   * 列出可用模型
   */
  async listModels(_provider?: string): Promise<ModelInfo[]> {
    await this.ensureServer();

    try {
      const models = await this.httpClient.listModels();
      return models.map((m) => ({
        id: m.id,
        name: m.name,
        provider: m.provider,
        contextWindow: m.contextWindow,
      }));
    } catch (error) {
      logger.error({ err: error }, 'Failed to list models');
      // 返回配置中的模型列表作为后备
      return super.listModels();
    }
  }

  /**
   * 切换模型
   */
  async switchModel(modelId: string): Promise<boolean> {
    await this.ensureServer();

    try {
      await this.httpClient.switchModel(modelId);
      this.opencodeConfig.defaultModel = modelId;
      return true;
    } catch (error) {
      logger.error({ err: error, modelId }, 'Failed to switch model');
      return false;
    }
  }

  /**
   * 获取当前模型
   */
  getCurrentModel(): string {
    return this.opencodeConfig.defaultModel;
  }

  /**
   * 停止生成
   */
  async stopGeneration(): Promise<boolean> {
    if (this.abortController) {
      this.abortController.abort();
    }

    try {
      await this.httpClient.stopGeneration();
      return true;
    } catch (error) {
      logger.error({ err: error }, 'Failed to stop generation');
      return false;
    }
  }

  /**
   * 计算 Token 统计
   */
  getStats(context: Message[], completionText: string): TokenStats {
    // 简化的 token 估算：
    // - 英文：约 4 字符/token
    // - 中文：约 1 字符/token
    // 这里使用保守估计

    const estimateTokens = (text: string): number => {
      // 粗略估计：中文字符算 1 token，其他按 4 字符/token
      let tokens = 0;
      for (const char of text) {
        if (/[\u4e00-\u9fa5]/.test(char)) {
          tokens += 1;
        } else {
          tokens += 0.25;
        }
      }
      return Math.ceil(tokens);
    };

    // 计算 prompt tokens
    let promptTokens = 0;
    for (const msg of context) {
      promptTokens += estimateTokens(msg.content);
      // 角色标记开销
      promptTokens += 4;
    }

    const completionTokens = estimateTokens(completionText);
    const totalTokens = promptTokens + completionTokens;
    const contextWindow = this.getDynamicContextWindow();

    return {
      totalTokens,
      promptTokens,
      completionTokens,
      contextUsed: totalTokens,
      contextWindow,
      contextPercent: Math.round((totalTokens / contextWindow) * 100),
    };
  }

  /**
   * 获取会话 ID（根据工作目录）
   */
  getSessionId(workingDir: string): string | null {
    return this.sessionManager.getSessionId(workingDir);
  }

  /**
   * 确保服务器运行
   */
  private async ensureServer(): Promise<boolean> {
    // 初始化 HTTP 客户端
    this.httpClient.initialize();

    // 启动或检查服务器
    return await this.serverManager.start();
  }

  /**
   * 解析服务器配置
   */
  private parseServerConfig(config: AdapterConfig): void {
    // 尝试从命令行参数解析端口
    // 例如：opencode serve --port 4096
    const portMatch = config.command.match(/--port\s+(\d+)/);
    if (portMatch) {
      this.opencodeConfig.serverPort = parseInt(portMatch[1], 10);
    }

    const hostMatch = config.command.match(/--host\s+(\S+)/);
    if (hostMatch) {
      this.opencodeConfig.serverHostname = hostMatch[1];
    }
  }

  /**
   * 构建消息列表
   */
  private buildMessages(context: Message[], prompt: string): OpenCodeMessage[] {
    const messages: OpenCodeMessage[] = [];

    // 添加上下文消息
    for (const msg of context) {
      messages.push({
        role: msg.role,
        content: msg.content,
      });
    }

    // 添加当前提示
    messages.push({
      role: 'user',
      content: prompt,
    });

    return messages;
  }

  /**
   * 构建附件列表
   */
  private buildAttachments(attachments?: Attachment[]): Array<{
    type: 'image' | 'file';
    data: string;
    mime_type: string;
    filename: string;
  }> | undefined {
    if (!attachments || attachments.length === 0) {
      return undefined;
    }

    return attachments.map((att) => ({
      type: att.resourceType === 'image' ? 'image' : 'file',
      data: att.data?.toString('base64') || '',
      mime_type: att.mimeType,
      filename: att.filename,
    }));
  }

  /**
   * 获取动态上下文窗口大小
   */
  private getDynamicContextWindow(): number {
    const model = this.opencodeConfig.defaultModel;

    // 检查缓存
    const cached = this.contextWindowCache.get(model);
    if (cached) {
      const age = Date.now() - cached.timestamp;
      if (age < this.CACHE_TTL) {
        return cached.window;
      }
    }

    // 使用硬编码默认值
    const modelLower = model.toLowerCase();
    let window = 128000;

    if (modelLower.includes('kimi') || modelLower.includes('claude')) {
      window = 200000;
    } else if (modelLower.includes('gpt-4') || modelLower.includes('gpt4')) {
      window = 8192;
    }

    return window;
  }

  /**
   * 关闭适配器
   */
  async close(): Promise<void> {
    await this.httpClient.close();
    await this.serverManager.stop();
  }
}
