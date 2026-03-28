/**
 * Feishu WebSocket Client
 * 飞书 WebSocket 客户端封装
 *
 * 基于 @larksuiteoapi/node-sdk 的 WSClient 和 EventDispatcher 封装
 * 提供消息事件监听和卡片回调处理能力
 */

import {
  Client as LarkClient,
  WSClient,
  EventDispatcher,
  AppType,
  LoggerLevel,
} from '@larksuiteoapi/node-sdk';
import { EventEmitter } from 'events';
import type {
  FeishuMessage,
  RawMessageEvent,
  RawCardCallbackEvent,
  CardCallbackEvent,
  CardCallbackResponse,
  MessageHandler,
  CardCallbackHandler,
} from './types.js';

/**
 * 飞书客户端配置选项
 */
export interface FeishuClientOptions {
  /** 应用 ID */
  appId: string;
  /** 应用密钥 */
  appSecret: string;
  /** 加密密钥（可选） */
  encryptKey?: string;
  /** 验证令牌（可选） */
  verificationToken?: string;
  /** 日志级别 */
  loggerLevel?: LoggerLevel;
  /** 是否自动重连 */
  autoReconnect?: boolean;
  /** 重连间隔（毫秒） */
  reconnectInterval?: number;
}

/**
 * 飞书 WebSocket 客户端
 */
export class FeishuClient extends EventEmitter {
  private wsClient!: WSClient;
  private eventDispatcher!: EventDispatcher;
  private httpClient: LarkClient;
  private options: FeishuClientOptions;
  private isRunning = false;
  private messageHandler?: MessageHandler;
  private cardCallbackHandler?: CardCallbackHandler;

  constructor(options: FeishuClientOptions) {
    super();
    this.options = {
      autoReconnect: true,
      reconnectInterval: 5000,
      ...options,
    };

    // 创建 HTTP 客户端（用于某些 API 调用）
    this.httpClient = new LarkClient({
      appId: options.appId,
      appSecret: options.appSecret,
      appType: AppType.SelfBuild,
      loggerLevel: options.loggerLevel ?? LoggerLevel.info,
    });
  }

  /**
   * 初始化 EventDispatcher
   */
  private initEventDispatcher(): void {
    this.eventDispatcher = new EventDispatcher({
      verificationToken: this.options.verificationToken ?? '',
      encryptKey: this.options.encryptKey ?? '',
      loggerLevel: this.options.loggerLevel ?? LoggerLevel.info,
    });

    // 注册消息处理器
    this.eventDispatcher.register({
      'im.message.receive_v1': async (data: unknown) => {
        try {
          const event = data as { message?: RawMessageEvent };
          const message = this.parseMessageEvent(event.message);
          if (message) {
            // 触发事件
            this.emit('message', message);

            // 调用注册的处理器
            if (this.messageHandler) {
              await this.messageHandler(message);
            }
          }
        } catch (error) {
          this.emit('error', error);
        }
      },
    });

    // 注册卡片回调处理器
    this.eventDispatcher.register({
      cardAction: async (data: unknown) => {
        try {
          const rawEvent = data as RawCardCallbackEvent;
          const event = this.parseCardCallbackEvent(rawEvent);

          // 触发事件
          this.emit('cardAction', event);

          // 调用注册的处理器
          if (this.cardCallbackHandler) {
            const response = await this.cardCallbackHandler(event);
            return response;
          }

          // 默认响应
          return {
            config: {
              disable_quick_action: false,
              update_multi: false,
            },
          };
        } catch (error) {
          this.emit('error', error);
          return {
            config: {
              disable_quick_action: false,
              update_multi: false,
            },
          };
        }
      },
    });
  }

  /**
   * 解析原始消息事件为结构化消息
   */
  private parseMessageEvent(rawEvent?: RawMessageEvent): FeishuMessage | null {
    if (!rawEvent) return null;

    // 解析消息内容
    let content = '';
    try {
      const parsed = JSON.parse(rawEvent.body?.content ?? '{}');
      content = parsed.text ?? '';
    } catch {
      content = rawEvent.body?.content ?? '';
    }

    // 提取提及的用户
    const mentionUsers: string[] = [];
    if (rawEvent.mentions) {
      for (const mention of rawEvent.mentions) {
        if (mention.id?.open_id) {
          mentionUsers.push(mention.id.open_id);
        }
      }
    }

    return {
      messageId: rawEvent.message_id,
      chatId: rawEvent.chat_id,
      chatType: rawEvent.chat_type === 'p2p' ? 'p2p' : 'group',
      senderId: rawEvent.sender?.sender_id?.open_id ?? '',
      senderName: rawEvent.sender?.nickname ?? '',
      content,
      msgType: rawEvent.msg_type,
      threadId: rawEvent.thread_id,
      mentionUsers,
      parentId: rawEvent.parent_id,
    };
  }

  /**
   * 解析卡片回调事件
   */
  private parseCardCallbackEvent(rawEvent: RawCardCallbackEvent): CardCallbackEvent {
    return {
      openId: rawEvent.open_id,
      chatId: rawEvent.chat_id,
      messageId: rawEvent.message_id,
      data: {
        action: rawEvent.action?.value?.action as string | undefined,
        form: rawEvent.action?.form_value,
        selected: rawEvent.action?.option ? [rawEvent.action.option] : undefined,
        targetElementId: rawEvent.action?.tag,
      },
      raw: rawEvent,
    };
  }

  /**
   * 启动 WebSocket 连接
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    // 初始化 EventDispatcher
    this.initEventDispatcher();

    // 创建 WebSocket 客户端
    this.wsClient = new WSClient({
      appId: this.options.appId,
      appSecret: this.options.appSecret,
      loggerLevel: this.options.loggerLevel ?? LoggerLevel.info,
      autoReconnect: this.options.autoReconnect,
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('WebSocket connection timeout'));
      }, 30000);

      // 监听连接成功
      const checkConnection = () => {
        const info = this.wsClient.getReconnectInfo();
        if (info.lastConnectTime > 0) {
          clearTimeout(timeout);
          this.isRunning = true;
          this.emit('connect');
          resolve();
        } else {
          setTimeout(checkConnection, 100);
        }
      };

      // 启动 WebSocket
      this.wsClient
        .start({
          eventDispatcher: this.eventDispatcher,
        })
        .then(() => {
          checkConnection();
        })
        .catch((error) => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  /**
   * 停止 WebSocket 连接
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.wsClient.close({ force: false });
    this.isRunning = false;
    this.emit('disconnect');
  }

  /**
   * 注册消息处理器
   */
  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  /**
   * 注册卡片回调处理器
   */
  onCardCallback(handler: CardCallbackHandler): void {
    this.cardCallbackHandler = handler;
  }

  /**
   * 获取运行状态
   */
  get isConnected(): boolean {
    return this.isRunning;
  }

  /**
   * 获取 HTTP 客户端（用于直接 API 调用）
   */
  getHttpClient(): LarkClient {
    return this.httpClient;
  }
}

/**
 * 创建飞书客户端的便捷函数
 */
export function createFeishuClient(
  appId: string,
  appSecret: string,
  options?: Omit<FeishuClientOptions, 'appId' | 'appSecret'>
): FeishuClient {
  return new FeishuClient({
    appId,
    appSecret,
    ...options,
  });
}
