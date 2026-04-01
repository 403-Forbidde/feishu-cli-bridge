/**
 * OpenCode HTTP 客户端
 * OpenCode HTTP Client
 *
 * 管理 HTTP 连接和请求，复用 Axios 实例
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import http from 'node:http';
import https from 'node:https';
import { logger } from '../../core/logger.js';
import { AdapterError, AdapterErrorCode } from '../interface/types.js';
import type { ModelInfo, AgentInfo } from '../interface/types.js';
import type { OpenCodeConfig, ServerHealth, CreateSessionResponse, ListSessionsResponse, PromptAsyncRequest, ProviderInfo } from './types.js';

/**
 * HTTP 客户端管理器
 */
export class OpenCodeHTTPClient {
  private client: AxiosInstance | null = null;
  private baseURL: string;
  private config: OpenCodeConfig;

  constructor(config: OpenCodeConfig) {
    this.config = config;
    this.baseURL = `http://${config.serverHostname}:${config.serverPort}`;
  }

  /**
   * 初始化 HTTP 客户端
   */
  initialize(): void {
    if (this.client) {
      return;
    }

    // 创建 axios 实例，启用 keepAlive 连接池
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: this.config.timeout * 1000,
      headers: {
        'Content-Type': 'application/json',
      },
      httpAgent: new http.Agent({
        keepAlive: true,
        maxSockets: 10,
      }),
      httpsAgent: new https.Agent({
        keepAlive: true,
        maxSockets: 10,
      }),
    });

    logger.debug(`OpenCode HTTP client initialized: ${this.baseURL}`);
  }

  /**
   * 关闭 HTTP 客户端
   */
  async close(): Promise<void> {
    if (this.client) {
      // axios 没有显式的 close 方法，但我们需要清理 agent
      const httpAgent = this.client.defaults.httpAgent as http.Agent;
      const httpsAgent = this.client.defaults.httpsAgent as https.Agent;

      httpAgent?.destroy();
      httpsAgent?.destroy();

      this.client = null;
      logger.debug('OpenCode HTTP client closed');
    }
  }

  /**
   * 检查服务器健康状态
   * 尝试多个健康检查端点以兼容不同版本
   */
  async checkHealth(): Promise<ServerHealth> {
    const endpoints = ['/global/health', '/health', '/api/health'];
    const startTime = Date.now();

    for (const endpoint of endpoints) {
      try {
        const response = await axios.get(`${this.baseURL}${endpoint}`, {
          timeout: 1000,
          // 不重用 client，健康检查使用独立配置
        });

        if (response.status === 200) {
          return {
            healthy: true,
            responseTime: Date.now() - startTime,
          };
        }
      } catch {
        // 继续尝试下一个端点
        continue;
      }
    }

    return {
      healthy: false,
      responseTime: Date.now() - startTime,
      error: 'All health endpoints failed',
    };
  }

  /**
   * 创建新会话
   * Python 参考: client.post("/session", json={"title": title}, params={"directory": working_dir})
   */
  async createSession(workingDir?: string, title?: string): Promise<CreateSessionResponse> {
    this.ensureInitialized();

    try {
      const response = await this.client!.post<CreateSessionResponse>('/session', {
        title: title || 'Feishu Bridge Session',
      }, {
        params: workingDir ? { directory: workingDir } : undefined,
      });
      return response.data;
    } catch (error) {
      throw this.wrapError('Failed to create session', error);
    }
  }

  /**
   * 列出所有会话
   * Python 参考: client.get("/session") - 可选传递 directory 参数
   * 注意：OpenCode API 的 directory 参数行为可能不一致，需要在客户端过滤
   */
  async listSessions(directory?: string): Promise<ListSessionsResponse> {
    this.ensureInitialized();

    try {
      interface SessionItem {
        id?: string;
        title?: string;
        created_at?: number;
        time?: { created?: number; updated?: number };
        slug?: string;
        directory?: string;
      }

      // 响应可能是数组或 {items: [...]}
      const params = directory ? { directory } : undefined;
      logger.debug(`listSessions API call with directory=${directory}`);
      const response = await this.client!.get<SessionItem[] | { items?: SessionItem[] }>('/session', { params });
      const data = response.data;
      const sessions = Array.isArray(data) ? data : (data?.items || []);

      logger.debug(`listSessions API returned ${sessions.length} sessions`);

      return {
        sessions: sessions.map((s) => ({
          id: String(s.id || ''),
          title: String(s.title || '未命名会话'),
          created_at: Number(s.created_at || s.time?.created || 0) / 1000,
          updated_at: s.time?.updated ? Number(s.time.updated) / 1000 : undefined,
          slug: String(s.slug || ''),
          directory: s.directory ? String(s.directory) : undefined,
        })),
      };
    } catch (error) {
      throw this.wrapError('Failed to list sessions', error);
    }
  }

  /**
   * 切换会话
   */
  async switchSession(sessionId: string): Promise<void> {
    this.ensureInitialized();

    try {
      await this.client!.post(`/session/${sessionId}/switch`);
    } catch (error) {
      throw this.wrapError(`Failed to switch to session ${sessionId}`, error);
    }
  }

  /**
   * 获取会话详情
   * Python 参考: client.get(f"/session/{session_id}")
   */
  async getSessionDetail(sessionId: string): Promise<CreateSessionResponse | null> {
    this.ensureInitialized();

    try {
      const response = await this.client!.get<CreateSessionResponse>(`/session/${sessionId}`);
      return response.data;
    } catch (error) {
      // 404 表示会话不存在，返回 null
      const axiosError = error as AxiosError;
      if (axiosError.response?.status === 404) {
        return null;
      }
      throw this.wrapError(`Failed to get session detail ${sessionId}`, error);
    }
  }

  /**
   * 重命名会话
   */
  async renameSession(sessionId: string, title: string): Promise<void> {
    this.ensureInitialized();

    try {
      await this.client!.patch(`/session/${sessionId}`, { title });
    } catch (error) {
      throw this.wrapError(`Failed to rename session ${sessionId}`, error);
    }
  }

  /**
   * 删除会话
   */
  async deleteSession(sessionId: string): Promise<void> {
    this.ensureInitialized();

    try {
      await this.client!.delete(`/session/${sessionId}`);
    } catch (error) {
      throw this.wrapError(`Failed to delete session ${sessionId}`, error);
    }
  }

  /**
   * 重置当前会话
   */
  async resetSession(): Promise<void> {
    this.ensureInitialized();

    try {
      await this.client!.post('/session/reset');
    } catch (error) {
      throw this.wrapError('Failed to reset session', error);
    }
  }

  /**
   * 获取可用模型列表
   */
  async listModels(): Promise<ModelInfo[]> {
    this.ensureInitialized();

    try {
      const response = await this.client!.get<{ models: ModelInfo[] }>('/models');
      return response.data.models || [];
    } catch (error) {
      throw this.wrapError('Failed to list models', error);
    }
  }

  /**
   * 切换模型
   */
  async switchModel(modelId: string): Promise<void> {
    this.ensureInitialized();

    try {
      await this.client!.post('/models/switch', { model: modelId });
    } catch (error) {
      throw this.wrapError(`Failed to switch to model ${modelId}`, error);
    }
  }

  /**
   * 获取当前模型
   */
  async getCurrentModel(): Promise<string> {
    this.ensureInitialized();

    try {
      const response = await this.client!.get<{ model: string }>('/models/current');
      return response.data.model;
    } catch (error) {
      throw this.wrapError('Failed to get current model', error);
    }
  }

  /**
   * 获取可用 Agents 列表
   * 端点: /agent (参考 Python 实现)
   */
  async listAgents(): Promise<
    Array<{
      name: string;
      display_name?: string;
      description?: string;
      hidden?: boolean;
      mode?: string;
      native?: boolean;
    }>
  > {
    this.ensureInitialized();

    try {
      const response = await this.client!.get<
        Array<{
          name: string;
          display_name?: string;
          description?: string;
          hidden?: boolean;
          mode?: string;
          native?: boolean;
        }>
      >('/agent');
      return response.data || [];
    } catch (error) {
      throw this.wrapError('Failed to list agents', error);
    }
  }

  /**
   * 发送消息到会话（prompt_async）
   * Python 参考: client.post(f"/session/{session_id}/prompt_async", json=body, params=params)
   */
  async sendPromptAsync(
    sessionId: string,
    request: PromptAsyncRequest,
    workingDir?: string
  ): Promise<boolean> {
    this.ensureInitialized();

    try {
      const params = workingDir ? { directory: workingDir } : undefined;
      const response = await this.client!.post(
        `/session/${sessionId}/prompt_async`,
        request,
        { params }
      );
      return response.status >= 200 && response.status < 300;
    } catch (error) {
      throw this.wrapError('Failed to send message', error);
    }
  }

  /**
   * 监听 SSE 事件流（从 /event 端点）
   * Python 参考: client.stream("GET", "/event", params=params)
   *
   * 返回的流中每行以 "data: " 开头，后面是 JSON 格式的事件数据
   */
  async listenEvents(workingDir?: string): Promise<NodeJS.ReadableStream> {
    this.ensureInitialized();

    try {
      const params = workingDir ? { directory: workingDir } : undefined;
      const response = await this.client!.get('/event', {
        responseType: 'stream',
        params,
      });
      return response.data as NodeJS.ReadableStream;
    } catch (error) {
      throw this.wrapError('Failed to listen to events', error);
    }
  }

  /**
   * 停止生成
   */
  async stopGeneration(): Promise<void> {
    this.ensureInitialized();

    try {
      await this.client!.post('/stop');
    } catch (error) {
      // 停止生成可能返回 404（如果没有正在进行的生成）
      // 这是正常情况，不需要抛出错误
      const axiosError = error as AxiosError;
      if (axiosError.response?.status === 404) {
        return;
      }
      throw this.wrapError('Failed to stop generation', error);
    }
  }

  /**
   * 获取 Provider 列表（包含模型的 context window 信息）
   * Python 参考: client.get("/provider")
   */
  async getProviders(): Promise<ProviderInfo[]> {
    this.ensureInitialized();

    try {
      const response = await this.client!.get<ProviderInfo[] | { all: ProviderInfo[] }>('/provider');
      const data = response.data;

      // 处理 { all: [...] } 或 [...] 两种格式
      const providers = Array.isArray(data) ? data : (data.all || []);
      return providers;
    } catch (error) {
      throw this.wrapError('Failed to get providers', error);
    }
  }

  /**
   * 确保客户端已初始化
   */
  private ensureInitialized(): void {
    if (!this.client) {
      throw new AdapterError(
        'HTTP client not initialized',
        AdapterErrorCode.SERVER_NOT_RUNNING
      );
    }
  }

  /**
   * 包装错误为 AdapterError
   */
  private wrapError(message: string, error: unknown): AdapterError {
    const axiosError = error as AxiosError;

    // 根据 HTTP 状态码映射到错误码
    if (axiosError.code === 'ECONNREFUSED') {
      return new AdapterError(
        `${message}: Server not responding`,
        AdapterErrorCode.SERVER_UNREACHABLE,
        error
      );
    }

    if (axiosError.response) {
      const status = axiosError.response.status;

      if (status === 404) {
        return new AdapterError(
          `${message}: Resource not found`,
          AdapterErrorCode.SESSION_NOT_FOUND,
          error
        );
      }

      if (status === 429) {
        return new AdapterError(
          `${message}: Rate limited`,
          AdapterErrorCode.RATE_LIMITED,
          error
        );
      }

      if (status >= 400 && status < 500) {
        return new AdapterError(
          `${message}: ${axiosError.response.statusText}`,
          AdapterErrorCode.INVALID_REQUEST,
          error
        );
      }
    }

    return new AdapterError(
      message,
      AdapterErrorCode.UNKNOWN,
      error
    );
  }
}
