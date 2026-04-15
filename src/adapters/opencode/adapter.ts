/**
 * OpenCode 适配器主实现
 * OpenCode Adapter Main Implementation
 *
 * 实现 ICLIAdapter 接口，连接 OpenCode CLI
 * 完全参考 Python 实现: core.py
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import type { Attachment, Message, ModelInfo, SessionInfo } from '../interface/types.js';
import { BaseCLIAdapter } from '../interface/base-adapter.js';
import { StreamChunkType, type StreamChunk, type TokenStats } from '../../core/types/stream.js';
import { logger } from '../../core/logger.js';
import { AdapterError, AdapterErrorCode } from '../interface/types.js';
import type { AdapterConfig } from '../interface/types.js';
import { OpenCodeHTTPClient } from './http-client.js';
import { OpenCodeServerManager } from './server-manager.js';
import { OpenCodeSessionManager } from './session-manager.js';
import { OpenCodeEventParser, createOpenCodeEventIterator } from './sse-parser.js';
import type {
  OpenCodeConfig,
  OpenCodeSession,
  ContextWindowCacheEntry,
  PromptAsyncRequest,
  MessagePart,
} from './types.js';

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

  // Issue #52: 取消事件
  private cancelEvent: boolean = false;

  // Issue #40: 当前统计信息（从 SSE 获取）
  private currentStats: TokenStats | null = null;

  // 活跃的会话状态
  private activeWorkingDir: string = '';

  // 内置 Agent 定义（参考 Python 实现）
  private readonly BUILTIN_AGENTS: Record<string, { name: string; description: string }> = {
    build: { name: 'Build · 构建', description: '默认模式，全工具权限，可读写文件、执行命令' },
    plan: { name: 'Plan · 规划', description: '只读模式，用于分析代码和制定方案，不会修改文件' },
  };

  private readonly OHM_AGENTS: Record<string, { name: string; description: string }> = {
    sisyphus: { name: 'Sisyphus · 总协调', description: '主协调者，并行调度其他 agent，驱动任务完成' },
    hephaestus: { name: 'Hephaestus · 深度工作', description: '自主深度工作者，端到端探索和执行代码任务' },
    prometheus: { name: 'Prometheus · 战略规划', description: '动手前先与你确认任务范围和策略' },
    oracle: { name: 'Oracle · 架构调试', description: '架构设计与调试专家' },
    librarian: { name: 'Librarian · 文档搜索', description: '文档查找与代码搜索专家' },
    explore: { name: 'Explore · 快速探索', description: '快速代码库 grep 与文件浏览' },
    multimodal_looker: { name: 'Multimodal Looker · 视觉分析', description: '图片与多模态内容分析' },
  };

  private readonly OHM_SIGNATURE = new Set(['sisyphus', 'hephaestus', 'prometheus']);

  constructor(config: AdapterConfig) {
    super(config);

    this.opencodeConfig = {
      serverPort: 4096,
      serverHostname: '127.0.0.1',
      defaultModel: config.defaultModel,
      defaultAgent: 'build',
      command: config.command,
      timeout: config.timeout,
      serverPassword: config.serverPassword,
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
   *
   * 对应 Python: execute_stream 方法
   * 流程：
   * 1. 确保服务器运行
   * 2. 获取或创建会话
   * 3. 发送消息（prompt_async）
   * 4. 监听事件流（/event）
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
      yield {
        type: StreamChunkType.ERROR,
        data: 'Failed to start OpenCode Server',
      };
      return;
    }

    this.activeWorkingDir = workingDir;

    // Issue #52: 初始化取消标志
    this.cancelEvent = false;

    // 获取或创建会话
    const session = await this.sessionManager.getOrCreateSession(workingDir);
    if (!session) {
      yield {
        type: StreamChunkType.ERROR,
        data: 'Failed to create session',
      };
      return;
    }

    // 创建事件解析器并初始化状态
    const parser = new OpenCodeEventParser();
    parser.resetState(this.hashString(prompt.trim()));

    // 构建消息部件
    const parts = this.buildMessageParts(prompt, attachments);

    // 解析模型 provider 和 ID
    const [providerId, modelId] = this.parseModelId(this.opencodeConfig.defaultModel);

    // 发送消息
    const request: PromptAsyncRequest = {
      parts,
      model: {
        providerID: providerId,
        modelID: modelId,
      },
      agent: this.opencodeConfig.defaultAgent,
    };

    try {
      const sent = await this.httpClient.sendPromptAsync(session.id, request, workingDir);
      if (!sent) {
        yield {
          type: StreamChunkType.ERROR,
          data: 'Failed to send message to OpenCode',
        };
        return;
      }

      // 监听事件流
      const eventStream = await this.httpClient.listenEvents(workingDir);

      for await (const chunk of createOpenCodeEventIterator(eventStream, parser)) {
        // Issue #52: 检查取消信号
        if (this.cancelEvent) {
          logger.info('executeStream: cancellation detected, breaking stream');
          yield {
            type: StreamChunkType.DONE,
            data: '',
          };
          return;
        }

        // 保存 token 统计信息
        if (chunk.type === StreamChunkType.STATS && chunk.stats) {
          // 从 API 获取准确的 context window（异步）
          const contextWindow = await this.refreshContextWindowCache();
          const totalTokens = chunk.stats.totalTokens;
          const contextPercent = contextWindow > 0
            ? Math.min(100, Math.round((totalTokens / contextWindow) * 100 * 10) / 10)
            : 0;

          this.currentStats = {
            ...chunk.stats,
            contextWindow,
            contextUsed: totalTokens,
            contextPercent,
            model: this.getCurrentModel(),
          };

          logger.debug(
            `executeStream: received stats - total=${totalTokens}, window=${contextWindow}, context=${contextPercent}%`
          );
          continue; // 不将 stats chunk 传递给下游
        }

        yield chunk;

        // 如果收到 DONE 或 ERROR，结束
        if (chunk.type === StreamChunkType.DONE || chunk.type === StreamChunkType.ERROR) {
          return;
        }
      }
    } catch (error) {
      logger.error({ err: error }, 'Error in executeStream');
      yield {
        type: StreamChunkType.ERROR,
        data: error instanceof Error ? error.message : String(error),
      };
    } finally {
      // Issue #52: 重置取消标志
      this.cancelEvent = false;
    }
  }

  /**
   * 创建新会话
   */
  async createNewSession(workingDir?: string): Promise<SessionInfo | null> {
    await this.ensureServer();

    const dir = workingDir || process.cwd();
    try {
      const session = await this.sessionManager.createNewSession(dir);
      // 重置 token 统计
      this.currentStats = null;
      return session;
    } catch (error) {
      logger.error({ err: error }, 'Failed to create new session');
      return null;
    }
  }

  /**
   * 列出会话
   */
  async listSessions(limit?: number, directory?: string): Promise<SessionInfo[]> {
    await this.ensureServer();

    // 传递 limit 和 directory 参数给 sessionManager
    const sessions = await this.sessionManager.listSessions(limit, directory);
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
   *
   * 策略：
   * 1. 从 config.yaml 的 cli.opencode.models 读取用户手动配置的模型（始终优先）
   * 2. 从 OpenCode 本地缓存 (~/.cache/opencode/models.json) 读取 opencode 官方 provider 下的免费模型
   * 3. 合并并去重（config 中手动配置的模型排在前面）
   *
   * 不调用 OpenCode API，不修改配置文件，free 模型随缓存实时更新。
   */
  async listModels(_provider?: string): Promise<ModelInfo[]> {
    const configModels = await super.listModels();

    try {
      const freeModels = await this.loadOpenCodeFreeModelsFromCache();
      if (freeModels.length === 0) {
        return configModels;
      }

      // 去重：config 中已配置的模型优先保留
      const existingIds = new Set(configModels.map((m) => m.id));
      const merged: ModelInfo[] = [...configModels];
      for (const m of freeModels) {
        if (!existingIds.has(m.id)) {
          merged.push(m);
          existingIds.add(m.id);
        }
      }
      return merged;
    } catch (error) {
      logger.warn({ err: error }, '加载 OpenCode 免费模型缓存失败，仅使用 config 配置');
      return configModels;
    }
  }

  /**
   * 从 OpenCode 本地缓存读取 opencode provider 的免费模型
   * 判定标准：provider === 'opencode' 且 cost.input === 0 且 cost.output === 0
   */
  private async loadOpenCodeFreeModelsFromCache(): Promise<ModelInfo[]> {
    const cachePath = path.join(homedir(), '.cache', 'opencode', 'models.json');
    let raw: string;
    try {
      raw = await readFile(cachePath, 'utf-8');
    } catch {
      return [];
    }

    const data = JSON.parse(raw) as Record<
      string,
      {
        models?: Record<
          string,
          {
            id: string;
            name?: string;
            providerID?: string;
            cost?: { input?: number; output?: number };
            limit?: { context?: number };
            capabilities?: ModelInfo['capabilities'];
            status?: string;
            // OpenCode 本地缓存中的扁平化能力字段
            reasoning?: boolean;
            attachment?: boolean;
            temperature?: boolean;
            tool_call?: boolean;
            modalities?: { input?: string[]; output?: string[] };
          }
        >;
      }
    >;

    const opencodeProvider = data['opencode'];
    if (!opencodeProvider?.models) {
      return [];
    }

    const freeModels: ModelInfo[] = [];
    for (const info of Object.values(opencodeProvider.models)) {
      const cost = info.cost || {};
      // 只保留官方标记为免费的模型（-free 后缀）或 opencode 原生免费模型 big-pickle
      const isOfficialFree = info.id.endsWith('-free') || info.id === 'big-pickle';
      if (cost.input === 0 && cost.output === 0 && info.status !== 'deprecated' && isOfficialFree) {
        // 缓存文件中的能力是扁平化字段，需要映射到 capabilities 对象
        const capabilities: ModelInfo['capabilities'] = info.capabilities || {
          temperature: info.temperature,
          reasoning: info.reasoning,
          attachment: info.attachment,
          toolcall: info.tool_call,
          input: info.modalities?.input
            ? {
                text: info.modalities.input.includes('text'),
                image: info.modalities.input.includes('image'),
                audio: info.modalities.input.includes('audio'),
                video: info.modalities.input.includes('video'),
                pdf: info.modalities.input.includes('pdf'),
              }
            : undefined,
          output: info.modalities?.output
            ? {
                text: info.modalities.output.includes('text'),
                image: info.modalities.output.includes('image'),
                audio: info.modalities.output.includes('audio'),
                video: info.modalities.output.includes('video'),
                pdf: info.modalities.output.includes('pdf'),
              }
            : undefined,
        };
        freeModels.push({
          id: `opencode/${info.id}`,
          name: info.name || info.id,
          provider: 'opencode',
          contextWindow: info.limit?.context || 0,
          capabilities,
        });
      }
    }

    return freeModels;
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
   * 列出可用 Agents
   */
  async listAgents(): Promise<Array<{ id: string; name?: string; description?: string }>> {
    await this.ensureServer();

    try {
      const agents = await this.httpClient.listAgents();

      // OpenCode 1.4.4+ 的 agent name 可能包含零宽字符且格式变化
      // 例如 "\u200bSisyphus - Ultraworker"，需要进行规范化匹配
      const normalizedNames = agents.map((a) => this.normalizeAgentName(a.name));
      const hasOhmSignature = [...this.OHM_SIGNATURE].some((sig) =>
        normalizedNames.some((n) => n.includes(sig))
      );

      if (hasOhmSignature) {
        // 返回 OHM agents，并映射为统一格式
        return agents
          .filter((a) => {
            const normalized = this.normalizeAgentName(a.name);
            return Object.keys(this.OHM_AGENTS).some((key) => normalized.includes(key));
          })
          .map((a) => {
            const normalized = this.normalizeAgentName(a.name);
            const matchedKey = Object.keys(this.OHM_AGENTS).find((key) => normalized.includes(key));
            const display = matchedKey ? this.OHM_AGENTS[matchedKey] : undefined;
            return {
              id: a.name,
              name: display?.name || this.cleanAgentName(a.name),
              description: display?.description || a.description || '',
            };
          });
      }

      // 非 OHM 环境：返回所有非隐藏的 primary agents
      return agents
        .filter((a) => !a.hidden && (a.mode === 'primary' || !a.mode))
        .map((a) => ({
          id: a.name,
          name: this.cleanAgentName(a.name),
          description: a.description || '',
        }));
    } catch (error) {
      logger.warn({ err: error }, 'listAgents 失败，使用内置 agents');
      // 返回内置 agents 作为后备
      return Object.entries(this.BUILTIN_AGENTS).map(([key, value]) => ({
        id: key,
        name: value.name,
        description: value.description,
      }));
    }
  }

  /**
   * 规范化 agent 名称（去除零宽字符并转小写，用于匹配）
   * OpenCode 1.4.4+ 的 agent name 可能包含 \u200b 等零宽字符
   */
  private normalizeAgentName(name?: string): string {
    return (name || '').replace(/[\u200b\u200c\u200d\ufeff]/g, '').toLowerCase().trim();
  }

  /**
   * 清理 agent 名称（去除零宽字符，用于展示）
   */
  private cleanAgentName(name?: string): string {
    return (name || '').replace(/[\u200b\u200c\u200d\ufeff]/g, '').trim();
  }

  /**
   * 切换 Agent
   * 注意：Python 实现中只更新本地配置，不调用 API
   */
  async switchAgent(agentId: string): Promise<boolean> {
    this.opencodeConfig.defaultAgent = agentId;
    logger.info({ agentId }, '切换到 agent');
    return true;
  }

  /**
   * 获取当前 Agent
   */
  getCurrentAgent(): string {
    return this.opencodeConfig.defaultAgent;
  }

  /**
   * 获取支持的 TUI 命令列表
   */
  getSupportedTUICommands(): string[] {
    return ['new', 'session', 'model', 'mode', 'reset', 'clear', 'rename', 'delete', 'help'];
  }

  /**
   * 停止生成
   *
   * Issue #52: 用于实现 /stop 命令
   */
  async stopGeneration(): Promise<boolean> {
    // 设置取消标志
    this.cancelEvent = true;
    logger.info('stopGeneration: triggered cancellation');

    try {
      // 同时调用服务器的停止接口
      await this.httpClient.stopGeneration();
      return true;
    } catch (error) {
      logger.error({ err: error }, 'Failed to stop generation');
      return false;
    }
  }

  /**
   * 计算 Token 统计
   *
   * Issue #40: 优先使用从 SSE 获取的准确统计
   */
  getStats(context: Message[], completionText: string): TokenStats {
    // 如果有从 SSE 获取的统计，直接使用
    if (this.currentStats) {
      return this.currentStats;
    }

    // 否则使用估算
    return this.estimateStats(context, completionText);
  }

  /**
   * 估算 Token 统计（后备方案）
   */
  private estimateStats(context: Message[], completionText: string): TokenStats {
    // 简化的 token 估算：
    // - 英文：约 4 字符/token
    // - 中文：约 1 字符/token

    const estimateTokens = (text: string): number => {
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

    // 加载会话缓存
    await this.sessionManager.load();

    // 启动或检查服务器
    return await this.serverManager.start();
  }

  /**
   * 解析服务器配置
   */
  private parseServerConfig(config: AdapterConfig): void {
    // 尝试从命令行参数解析端口
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
   * 构建消息部件
   */
  private buildMessageParts(prompt: string, attachments?: Attachment[]): MessagePart[] {
    const parts: MessagePart[] = [
      { type: 'text', text: prompt },
    ];

    if (attachments) {
      for (const att of attachments) {
        if (att.data) {
          parts.push({
            type: 'file',
            mime: att.mimeType,
            url: `data:${att.mimeType};base64,${att.data.toString('base64')}`,
            filename: att.filename,
          });
        }
      }
    }

    return parts;
  }

  /**
   * 解析模型 ID
   * 格式: "provider/model" 或 "model"
   */
  private parseModelId(modelId: string): [string, string] {
    const parts = modelId.split('/', 2);
    if (parts.length === 2) {
      return [parts[0], parts[1]];
    }
    return ['opencode', modelId];
  }

  /**
   * 计算字符串哈希（用于去重）
   */
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash;
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
   * 从 OpenCode API 获取指定模型的 context window
   * Python 参考: _fetch_context_window_from_api
   */
  private async fetchContextWindowFromAPI(providerId: string, modelId: string): Promise<number | null> {
    try {
      const providers = await this.httpClient.getProviders();

      // 找到指定的 provider
      for (const provider of providers) {
        if (provider.id === providerId) {
          const models = provider.models || {};
          const modelInfo = models[modelId];
          if (modelInfo?.limit?.context && modelInfo.limit.context > 0) {
            logger.debug(
              `fetchContextWindowFromAPI: ${providerId}/${modelId} = ${modelInfo.limit.context}`
            );
            return modelInfo.limit.context;
          }
        }
      }

      logger.warn(`fetchContextWindowFromAPI: context not found for ${providerId}/${modelId}`);
      return null;
    } catch (error) {
      logger.error({ err: error }, 'fetchContextWindowFromAPI: error');
      return null;
    }
  }

  /**
   * 刷新指定模型或当前模型的 context window 缓存
   * Python 参考: refresh_context_window_cache
   */
  private async refreshContextWindowCache(model?: string): Promise<number> {
    const targetModel = model || this.opencodeConfig.defaultModel;

    // 解析 provider 和 model
    const [providerId, modelId] = this.parseModelId(targetModel);

    // 尝试从 API 获取
    const contextWindow = await this.fetchContextWindowFromAPI(providerId, modelId);

    if (contextWindow && contextWindow > 0) {
      // 更新缓存
      this.contextWindowCache.set(targetModel, {
        window: contextWindow,
        timestamp: Date.now(),
      });
      logger.debug(`refreshContextWindowCache: cached ${targetModel} = ${contextWindow}`);
      return contextWindow;
    }

    // API 获取失败，使用硬编码值作为缓存
    const modelLower = targetModel.toLowerCase();
    let fallback = 128000;
    if (modelLower.includes('kimi') || modelLower.includes('claude')) {
      fallback = 200000;
    } else if (modelLower.includes('gpt-4') || modelLower.includes('gpt4')) {
      fallback = 8192;
    }

    this.contextWindowCache.set(targetModel, {
      window: fallback,
      timestamp: Date.now(),
    });
    logger.debug(`refreshContextWindowCache: using fallback for ${targetModel} = ${fallback}`);
    return fallback;
  }

  /**
   * 关闭适配器
   */
  async close(): Promise<void> {
    await this.httpClient.close();
    await this.serverManager.stop();
  }
}
