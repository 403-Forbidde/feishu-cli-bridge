/**
 * Feishu platform types
 * 飞书平台层类型定义
 *
 * 定义飞书消息、附件、事件处理器等类型
 */

/**
 * 飞书消息附件
 */
export interface Attachment {
  /** 文件唯一标识 */
  fileKey: string;
  /** 资源类型 */
  resourceType: 'image' | 'file';
  /** 文件名 */
  filename: string;
  /** MIME 类型 */
  mimeType: string;
  /** 下载后的本地路径（下载后填充） */
  path?: string;
}

/**
 * 飞书消息结构
 */
export interface FeishuMessage {
  /** 消息唯一标识 */
  messageId: string;
  /** 聊天 ID */
  chatId: string;
  /** 聊天类型 */
  chatType: 'p2p' | 'group';
  /** 发送者 ID */
  senderId: string;
  /** 发送者名称 */
  senderName: string;
  /** 消息内容（纯文本） */
  content: string;
  /** 消息类型 */
  msgType: string;
  /** 话题 ID（如果有） */
  threadId?: string;
  /** @提及的用户列表 */
  mentionUsers: string[];
  /** 父消息 ID（回复消息时） */
  parentId?: string;
  /** 附件列表 */
  attachments?: Attachment[];
}

/**
 * 发送消息结果
 */
export interface MessageResult {
  /** 消息 ID */
  messageId: string;
  /** 发送时间戳 */
  createTime: string;
}

/**
 * 卡片回调数据
 */
export interface CardCallbackData {
  /** 操作类型 */
  action?: string;
  /** 表单数据 */
  form?: Record<string, unknown>;
  /** 选中的选项 */
  selected?: string[];
  /** 点击的元素 ID */
  targetElementId?: string;
}

/**
 * 消息处理器函数类型
 */
export type MessageHandler = (message: FeishuMessage) => Promise<void>;

/**
 * 卡片回调处理器函数类型
 */
export type CardCallbackHandler = (
  eventData: CardCallbackEvent
) => Promise<CardCallbackResponse>;

/**
 * 卡片回调事件
 */
export interface CardCallbackEvent {
  /** 用户 Open ID */
  openId: string;
  /** 聊天 ID */
  chatId: string;
  /** 消息 ID */
  messageId: string;
  /** 回调数据 */
  data: CardCallbackData;
  /** 原始事件数据 */
  raw: unknown;
}

/**
 * 卡片回调响应
 * 使用 CardActionHandler 时，需要返回卡片对象或空字符串
 */
export interface CardCallbackResponse {
  /** 响应配置（旧格式，用于 EventDispatcher） */
  config?: {
    /** 是否禁用快捷操作 */
    disable_quick_action?: boolean;
    /** 是否更新卡片 */
    update_multi?: boolean;
  };
  /** 响应数据（旧格式） */
  response?: Record<string, unknown>;
  /** 输入表单值（旧格式） */
  input?: Record<string, unknown>;
  /** 新卡片内容（CardActionHandler 格式）
   * 如果有值，会用于更新原卡片
   */
  card?: object;
}

/**
 * WebSocket 事件类型
 */
export interface WSEvent {
  /** 事件类型 */
  type: string;
  /** 事件 ID */
  id?: string;
  /** 事件数据 */
  data: unknown;
}

/**
 * 飞书原始消息事件数据结构
 * （来自 SDK 的事件）
 */
export interface RawMessageEvent {
  /** 消息 ID */
  message_id: string;
  /** 聊天 ID */
  chat_id: string;
  /** 聊天类型 */
  chat_type: string;
  /** 发送者信息（可能在 event.sender 中） */
  sender?: {
    sender_id: {
      open_id: string;
      union_id?: string;
      user_id?: string;
    };
    sender_type: string;
    nickname?: string;
  };
  /** 消息体 */
  body: {
    content: string;
  };
  /** 消息类型 */
  message_type?: string;
  /** 消息类型（兼容字段） */
  msg_type?: string;
  /** 话题 ID */
  thread_id?: string;
  /** 父消息 ID */
  parent_id?: string;
  /** 根消息 ID */
  root_id?: string;
  /** 提及信息 */
  mentions?: Array<{
    key: string;
    id: {
      open_id: string;
    };
    name: string;
  }>;
  /** 创建时间 */
  create_time?: string;
  /** 更新时间 */
  update_time?: string;
}

/**
 * 飞书原始卡片回调事件数据结构
 * Node.js SDK 格式: { operator: { open_id }, action: { value }, context: { open_message_id, open_chat_id }, host }
 */
export interface RawCardCallbackEvent {
  /** Schema 版本 */
  schema?: string;
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
  /** 应用 ID */
  app_id?: string;
  /** 用户信息 (实际格式) */
  operator?: {
    open_id?: string;
    user_id?: string;
  };
  /** 操作数据 */
  action?: {
    value?: Record<string, unknown>;
    form_value?: Record<string, unknown>;
    tag?: string;
    option?: string;
  } | string;
  /** 操作值（SDK 某些版本直接返回此字段） */
  actionValue?: Record<string, unknown>;
  /** 上下文信息 (实际格式) */
  context?: {
    open_message_id?: string;
    open_chat_id?: string;
  };
  /** Host 信息 */
  host?: string;
  /** 用户 Open ID (向后兼容) */
  open_id?: string;
  /** 聊天 ID (向后兼容) */
  chat_id?: string;
  /** 消息 ID (向后兼容) */
  message_id?: string;
  /** 嵌套事件数据 (向后兼容) */
  event?: {
    operator?: {
      open_id?: string;
      user_id?: string;
    };
    action?: {
      value?: Record<string, unknown>;
      form_value?: Record<string, unknown>;
      tag?: string;
      option?: string;
    };
    context?: {
      open_message_id?: string;
      open_chat_id?: string;
    };
    token?: string;
  };
  /** 原始数据 */
  data?: Record<string, unknown>;
}

/**
 * 飞书 API 错误码
 */
export enum FeishuErrorCode {
  SUCCESS = 0,
  TOKEN_INVALID = 99991663,
  APP_ACCESS_TOKEN_INVALID = 99991661,
  USER_ACCESS_TOKEN_INVALID = 99991671,
  REQUEST_FORBIDDEN = 99991672,
  MESSAGE_NOT_EXIST = 230001,
  CHAT_NOT_EXIST = 230002,
  RATE_LIMIT = 99991400,
  INTERNAL_ERROR = 99991401,
}

/**
 * 飞书 API 响应
 */
export interface FeishuAPIResponse<T> {
  /** 错误码 */
  code: number;
  /** 错误消息 */
  msg: string;
  /** 响应数据 */
  data?: T;
}

/**
 * 文件下载结果
 */
export interface FileDownloadResult {
  /** 本地文件路径 */
  filePath: string;
  /** 文件名 */
  filename: string;
  /** 文件大小 */
  size: number;
  /** MIME 类型 */
  mimeType: string;
}
