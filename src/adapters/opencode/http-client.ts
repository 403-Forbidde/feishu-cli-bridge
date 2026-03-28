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
import type { OpenCodeConfig, ServerHealth, CreateSessionResponse, ListSessionsResponse, ChatRequest } from './types.js';

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
   */
  async createSession(workingDir?: string): Promise<CreateSessionResponse> {
    this.ensureInitialized();

    try {
      const response = await this.client!.post<CreateSessionResponse>('/sessions', {
        directory: workingDir,
      });
      return response.data;
    } catch (error) {
      throw this.wrapError('Failed to create session', error);
    }
  }

  /**
   * 列出所有会话
   */
  async listSessions(limit?: number): Promise<ListSessionsResponse> {
    this.ensureInitialized();

    try {
      const params = limit ? { limit } : undefined;
      const response = await this.client!.get<ListSessionsResponse>('/sessions', {
        params,
      });
      return response.data;
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
      await this.client!.post(`/sessions/${sessionId}/switch`);
    } catch (error) {
      throw this.wrapError(`Failed to switch to session ${sessionId}`, error);
    }
  }

  /**
   * 重命名会话
   */
  async renameSession(sessionId: string, title: string): Promise<void> {
    this.ensureInitialized();

    try {
      await this.client!.patch(`/sessions/${sessionId}`, { title });
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
      await this.client!.delete(`/sessions/${sessionId}`);
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
      await this.client!.post('/sessions/reset');
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
   */
  async listAgents(): Promise<AgentInfo[]> {
    this.ensureInitialized();

    try {
      const response = await this.client!.get<{ agents: AgentInfo[] }>('/agents');
      return response.data.agents || [];
    } catch (error) {
      throw this.wrapError('Failed to list agents', error);
    }
  }

  /**
   * 发送聊天请求（流式）
   */
  async chatStream(request: ChatRequest): Promise<NodeJS.ReadableStream> {
    this.ensureInitialized();

    try {
      const response = await this.client!.post('/chat', request, {
        responseType: 'stream',
        headers: {
          'Accept': 'text/event-stream',
        },
      });
      return response.data as NodeJS.ReadableStream;
    } catch (error) {
      throw this.wrapError('Failed to start chat stream', error);
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
   * 获取 base URL
   */
  getBaseURL(): string {
    return this.baseURL;
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
