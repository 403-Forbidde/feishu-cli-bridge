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
import { logger } from '../core/logger.js';
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
 * 飞书原始消息事件数据结构（来自 Node.js SDK）
 * Node.js SDK 格式：{ event_id, token, sender, message, ... }（扁平结构）
 * 与 Python SDK 不同：Python 是 { header, event: { sender, message } }
 */
interface SDKMessageEvent {
  /** 事件 ID */
  event_id?: string;
  /** 验证令牌 */
  token?: string;
  /** 创建时间 */
  create_time?: string;
  /** 事件类型 */
  event_type?: string;
  /** 租户标识 */
  tenant_key?: string;
  /** 时间戳 */
  ts?: string;
  /** UUID */
  uuid?: string;
  /** 类型 */
  type?: string;
  /** 应用 ID */
  app_id?: string;
  /** 发送者信息（TOP LEVEL，不在 event 内） */
  sender?: {
    sender_id?: {
      open_id?: string;
      union_id?: string;
      user_id?: string;
    };
    sender_type?: string;
    tenant_key?: string;
  };
  /** 消息数据（TOP LEVEL，不在 event 内） */
  message?: {
    message_id: string;
    root_id?: string;
    parent_id?: string;
    create_time: string;
    update_time?: string;
    chat_id: string;
    thread_id?: string;
    chat_type: string;
    message_type: string;
    content: string;
    mentions?: Array<{
      key: string;
      id: {
        union_id?: string;
        user_id?: string;
        open_id?: string;
      };
      name: string;
      tenant_key?: string;
    }>;
    user_agent?: string;
  };
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
          // Node.js SDK 事件格式: { event_id, token, sender, message, ... }（扁平结构）
          // 注意：与 Python SDK 不同，sender 和 message 在 TOP LEVEL，不在 event 内
          const sdkEvent = data as SDKMessageEvent;

          logger.debug(
            {
              eventId: sdkEvent.event_id,
              hasSender: !!sdkEvent.sender,
              hasMessage: !!sdkEvent.message,
              messageId: sdkEvent.message?.message_id,
            },
            '收到飞书消息事件'
          );

          if (!sdkEvent.message) {
            logger.warn({ data }, '消息数据为空');
            return;
          }

          // 转换为内部 RawMessageEvent 格式
          const rawMessage: RawMessageEvent = {
            message_id: sdkEvent.message.message_id,
            chat_id: sdkEvent.message.chat_id,
            chat_type: sdkEvent.message.chat_type,
            message_type: sdkEvent.message.message_type,
            create_time: sdkEvent.message.create_time,
            update_time: sdkEvent.message.update_time,
            thread_id: sdkEvent.message.thread_id,
            parent_id: sdkEvent.message.parent_id,
            root_id: sdkEvent.message.root_id,
            sender: sdkEvent.sender
              ? {
                  sender_id: {
                    open_id: sdkEvent.sender.sender_id?.open_id || '',
                    union_id: sdkEvent.sender.sender_id?.union_id,
                    user_id: sdkEvent.sender.sender_id?.user_id,
                  },
                  sender_type: sdkEvent.sender.sender_type || 'user',
                }
              : undefined,
            mentions: sdkEvent.message.mentions?.map((m) => ({
              key: m.key,
              id: {
                open_id: m.id.open_id || '',
              },
              name: m.name,
            })),
            body: {
              content: sdkEvent.message.content,
            },
          };

          const message = this.parseMessageEvent(rawMessage);
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

    // 注册卡片回调处理器 - 使用 card.action.trigger 事件类型
    this.eventDispatcher.register({
      'card.action.trigger': async (data: unknown) => {
        try {
          // 记录原始事件数据用于调试
          logger.debug({ rawData: JSON.stringify(data, null, 2) }, '收到卡片回调原始数据');

          // 转换为内部格式
          const rawEvent = data as RawCardCallbackEvent;

          // 详细记录事件结构
          logger.debug({
            hasOpenId: !!rawEvent.open_id,
            hasChatId: !!rawEvent.chat_id,
            hasMessageId: !!rawEvent.message_id,
            hasAction: !!rawEvent.action,
            actionValue: typeof rawEvent.action === 'object' ? rawEvent.action?.value : rawEvent.actionValue,
            hasEvent: !!rawEvent.event,
            eventKeys: rawEvent.event ? Object.keys(rawEvent.event) : [],
          }, '卡片回调事件结构分析');
          const event = this.parseCardCallbackEvent(rawEvent);

          // 记录解析后的事件
          logger.debug(
            {
              openId: event.openId,
              chatId: event.chatId,
              messageId: event.messageId,
              action: event.data.action,
              actionValue: event.data,
            },
            '解析后的卡片回调事件'
          );

          // 触发事件
          this.emit('cardAction', event);

          // 调用注册的处理器
          if (this.cardCallbackHandler) {
            const response = await this.cardCallbackHandler(event);
            // 返回卡片内容用于更新（如果提供了）
            // 飞书 SDK 要求格式: { card: { type: 'raw', data: { schema: '2.0', ... } } }
            if (response.card) {
              return {
                card: {
                  type: 'raw',
                  data: response.card,
                },
              };
            }
          }

          // 默认返回空对象
          return {};
        } catch (error) {
          logger.error({ error }, '卡片回调处理错误');
          return {};
        }
      },
    });
  }

  /**
   * 解析原始消息事件为结构化消息
   */
  private parseMessageEvent(rawEvent?: RawMessageEvent): FeishuMessage | null {
  if (!rawEvent) return null;

  // 获取消息类型（兼容 message_type 和 msg_type）
  const msgType = rawEvent.message_type || rawEvent.msg_type || 'unknown';

  // 调试：记录原始事件结构
  logger.debug(
    {
      messageId: rawEvent.message_id,
      msgType,
      hasBody: !!rawEvent.body,
      hasSender: !!rawEvent.sender,
      rawContent: rawEvent.body?.content?.substring(0, 200),
    },
    '解析原始消息事件'
  );

  // 解析消息内容
  let content = '';
  try {
    const rawContent = rawEvent.body?.content ?? '{}';
    const parsed = JSON.parse(rawContent);
    // 飞书文本消息格式：{"text": "内容"}
    content = parsed.text ?? '';
  } catch {
    // 如果不是 JSON，直接使用原始内容
    content = rawEvent.body?.content ?? '';
  }

  // 如果内容为空，可能是其他消息类型（图片、文件等），尝试获取更多信息
  if (!content && msgType !== 'text') {
    content = `[${msgType}]`;
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
    senderName: rawEvent.sender?.nickname ?? rawEvent.sender?.sender_id?.open_id ?? '',
    content,
    msgType,
    threadId: rawEvent.thread_id,
    mentionUsers,
    parentId: rawEvent.parent_id || rawEvent.root_id,
  };
}

  /**
   * 解析卡片回调事件
   * 支持格式：
   * 1. { operator: { open_id }, action: { value }, context: { ... } }
   * 2. { operator: { open_id }, action: "action_name", actionValue: { ... }, context: { ... } }
   */
  private parseCardCallbackEvent(rawEvent: RawCardCallbackEvent): CardCallbackEvent {
    // Node.js SDK 格式使用 operator/context 嵌套
    const operator = rawEvent.operator;
    const context = rawEvent.context;

    // 处理 action 的两种格式
    let actionName: string | undefined;
    let actionValue: Record<string, unknown> = {};

    if (typeof rawEvent.action === 'string') {
      // 格式 2: action 是字符串，actionValue 是单独字段
      actionName = rawEvent.action;
      actionValue = rawEvent.actionValue || {};
    } else if (rawEvent.action && typeof rawEvent.action === 'object') {
      // 格式 1: action 是对象，value 嵌套在内部
      actionName = rawEvent.action.value?.action as string | undefined;
      actionValue = rawEvent.action.value || {};
    }

    return {
      openId: operator?.open_id ?? '',
      chatId: context?.open_chat_id ?? '',
      messageId: context?.open_message_id ?? '',
      data: {
        action: actionName,
        form: typeof rawEvent.action === 'object' ? rawEvent.action?.form_value : undefined,
        selected: typeof rawEvent.action === 'object' && rawEvent.action?.option ? [rawEvent.action.option] : undefined,
        targetElementId: typeof rawEvent.action === 'object' ? rawEvent.action?.tag : undefined,
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

    // 初始化 EventDispatcher（包含消息和卡片回调处理器）
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
