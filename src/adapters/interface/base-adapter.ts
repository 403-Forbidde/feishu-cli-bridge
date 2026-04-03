/**
 * 适配器基础抽象类
 * Base CLI Adapter Abstract Class
 *
 * 提供适配器的通用实现基础
 * 具体适配器可继承此类并覆盖必要方法
 */

import type {
  ICLIAdapter,
  Message,
  SessionInfo,
  ModelInfo,
  Attachment,
  AdapterConfig,
} from './types.js';
import type { StreamChunk, TokenStats } from '../../core/types/stream.js';

/**
 * CLI 适配器抽象基类
 */
export abstract class BaseCLIAdapter implements ICLIAdapter {
  abstract readonly name: string;
  abstract readonly defaultModel: string;
  abstract readonly contextWindow: number;

  protected config: AdapterConfig;

  constructor(config: AdapterConfig) {
    this.config = config;
  }

  /**
   * 执行流式对话（必须实现）
   */
  abstract executeStream(
    prompt: string,
    context: Message[],
    workingDir: string,
    attachments?: Attachment[]
  ): AsyncIterable<StreamChunk>;

  /**
   * 获取当前模型（必须实现）
   */
  abstract getCurrentModel(): string;

  /**
   * 计算 Token 统计（必须实现）
   */
  abstract getStats(context: Message[], completionText: string): TokenStats;

  /**
   * 创建新会话（可选实现）
   */
  async createNewSession(_workingDir?: string): Promise<SessionInfo | null> {
    return null;
  }

  /**
   * 列出会话（可选实现）
   */
  async listSessions(_limit?: number, _directory?: string): Promise<SessionInfo[]> {
    return [];
  }

  /**
   * 切换会话（可选实现）
   */
  async switchSession(_sessionId: string, _workingDir?: string): Promise<boolean> {
    return false;
  }

  /**
   * 重置会话（可选实现）
   */
  async resetSession(): Promise<boolean> {
    return false;
  }

  /**
   * 重命名会话（可选实现）
   */
  async renameSession(_sessionId: string, _title: string): Promise<boolean> {
    return false;
  }

  /**
   * 删除会话（可选实现）
   */
  async deleteSession(_sessionId: string): Promise<boolean> {
    return false;
  }

  /**
   * 列出模型（可选实现）
   */
  async listModels(_provider?: string): Promise<ModelInfo[]> {
    return this.config.models.map((m) => {
      if (typeof m === 'string') {
        return { id: m, name: m };
      }
      return m;
    });
  }

  /**
   * 切换模型（可选实现）
   */
  async switchModel(_modelId: string): Promise<boolean> {
    return false;
  }

  /**
   * 停止生成（可选实现）
   */
  async stopGeneration(): Promise<boolean> {
    return false;
  }

  /**
   * 获取支持的 TUI 命令列表
   * 默认返回通用命令，子类可覆盖
   */
  getSupportedTUICommands(): string[] {
    return ['new', 'session', 'model', 'reset', 'clear', 'rename', 'delete', 'help'];
  }
}
