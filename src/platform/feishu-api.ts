/**
 * Feishu API wrapper
 * 飞书 HTTP API 封装
 *
 * 封装飞书 REST API 调用，提供类型安全的方法
 */

import {
  Client as LarkClient,
  AppType,
  LoggerLevel,
} from '@larksuiteoapi/node-sdk';
import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import type {
  FeishuMessage,
  MessageResult,
  FileDownloadResult,
} from './types.js';
import type { TokenStats } from '../core/types/stream.js';

/**
 * 统计信息提供器
 */
export interface StatsProvider {
  (): {
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    contextUsed: number;
    contextWindow: number;
    contextPercent: number;
  };
}

/**
 * 飞书 API 封装类
 */
export class FeishuAPI {
  private client: LarkClient;
  private appId: string;
  private appSecret: string;

  constructor(appId: string, appSecret: string, loggerLevel?: LoggerLevel) {
    this.appId = appId;
    this.appSecret = appSecret;

    this.client = new LarkClient({
      appId,
      appSecret,
      appType: AppType.SelfBuild,
      loggerLevel: loggerLevel ?? LoggerLevel.info,
    });
  }

  /**
   * 发送纯文本消息
   */
  async sendText(
    chatId: string,
    content: string,
    replyTo?: string
  ): Promise<MessageResult> {
    const response = await this.client.im.v1.message.create({
      params: {
        receive_id_type: 'chat_id',
      },
      data: {
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text: content }),
      },
    });

    if (response.code !== 0) {
      throw new Error(
        `Failed to send text message: ${response.msg} (code: ${response.code})`
      );
    }

    return {
      messageId: response.data?.message_id ?? '',
      createTime: response.data?.create_time ?? String(Date.now()),
    };
  }

  /**
   * 发送富文本消息
   */
  async sendRichText(
    chatId: string,
    content: unknown,
    replyTo?: string
  ): Promise<MessageResult> {
    const response = await this.client.im.v1.message.create({
      params: {
        receive_id_type: 'chat_id',
      },
      data: {
        receive_id: chatId,
        msg_type: 'post',
        content: JSON.stringify(content),
      },
    });

    if (response.code !== 0) {
      throw new Error(
        `Failed to send rich text message: ${response.msg} (code: ${response.code})`
      );
    }

    return {
      messageId: response.data?.message_id ?? '',
      createTime: response.data?.create_time ?? String(Date.now()),
    };
  }

  /**
   * 发送卡片消息（交互式卡片）
   */
  async sendCardMessage(
    chatId: string,
    card: unknown,
    replyTo?: string
  ): Promise<string> {
    const response = await this.client.im.v1.message.create({
      params: {
        receive_id_type: 'chat_id',
      },
      data: {
        receive_id: chatId,
        msg_type: 'interactive',
        content: JSON.stringify(card),
      },
    });

    if (response.code !== 0) {
      throw new Error(
        `Failed to send card message: ${response.msg} (code: ${response.code})`
      );
    }

    return response.data?.message_id ?? '';
  }

  // ==================== CardKit 2.0 流式 API ====================

  /**
   * 创建 CardKit 卡片实体
   * @returns card_id 或 null
   */
  async createCardEntity(card: unknown): Promise<string | null> {
    try {
      const response = await this.client.cardkit.v1.card.create({
        data: {
          type: 'card_json',
          data: JSON.stringify(card),
        },
      });

      if (response.code !== 0) {
        console.warn(`Failed to create CardKit entity: ${response.msg}`);
        return null;
      }

      // 兼容不同 SDK 包装层
      return (response.data?.card_id ?? (response as unknown as { card_id?: string }).card_id) || null;
    } catch (error) {
      console.warn('Failed to create CardKit entity:', error);
      return null;
    }
  }

  /**
   * 通过 card_id 发送卡片消息
   */
  async sendCardByCardId(
    to: string,
    cardId: string,
    replyToMessageId?: string
  ): Promise<{ messageId: string; chatId: string }> {
    const contentPayload = JSON.stringify({
      type: 'card',
      data: { card_id: cardId },
    });

    if (replyToMessageId) {
      // 回复模式
      const response = await this.client.im.v1.message.reply({
        path: { message_id: replyToMessageId },
        data: {
          content: contentPayload,
          msg_type: 'interactive',
        },
      });

      if (response.code !== 0) {
        throw new Error(`Failed to send CardKit reply: ${response.msg}`);
      }

      return {
        messageId: response.data?.message_id ?? '',
        chatId: response.data?.chat_id ?? '',
      };
    }

    // 直接发送
    const response = await this.client.im.v1.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: to,
        msg_type: 'interactive',
        content: contentPayload,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to send CardKit message: ${response.msg}`);
    }

    return {
      messageId: response.data?.message_id ?? '',
      chatId: response.data?.chat_id ?? '',
    };
  }

  /**
   * 流式更新卡片元素内容（CardKit 2.0 打字机效果）
   * 使用 cardElement.content 实现流式更新
   */
  async streamCardContent(
    cardId: string,
    elementId: string,
    content: string,
    sequence: number
  ): Promise<boolean> {
    try {
      // 确保 content 不为空
      if (!content || content.trim().length === 0) {
        console.warn('streamCardContent: content is empty, skipping');
        return false;
      }

      // 使用 cardElement.content 实现流式更新（匹配 OpenClaw 实现）
      const response = await (this.client as unknown as {
        cardkit: {
          v1: {
            cardElement: {
              content: (params: {
                data: { content: string; sequence: number };
                path: { card_id: string; element_id: string };
              }) => Promise<{ code: number; msg: string }>;
            };
          };
        };
      }).cardkit.v1.cardElement.content({
        data: { content, sequence },
        path: { card_id: cardId, element_id: elementId },
      });

      if (response.code !== 0) {
        console.warn(`CardKit stream update failed: ${response.msg} (code: ${response.code})`);
        return false;
      }

      return true;
    } catch (error) {
      console.warn('CardKit stream update error:', error);
      return false;
    }
  }

  /**
   * 更新 CardKit 卡片（用于终态更新）
   */
  async updateCardKitCard(
    cardId: string,
    card: unknown,
    sequence: number
  ): Promise<boolean> {
    try {
      const response = await this.client.cardkit.v1.card.update({
        data: {
          card: { type: 'card_json', data: JSON.stringify(card) },
          sequence,
        },
        path: { card_id: cardId },
      });

      if (response.code !== 0) {
        console.warn(`CardKit update failed: ${response.msg}`);
        return false;
      }

      return true;
    } catch (error) {
      console.warn('CardKit update error:', error);
      return false;
    }
  }

  /**
   * 设置卡片流式模式（开启/关闭打字机效果）
   */
  async setCardStreamingMode(
    cardId: string,
    streamingMode: boolean,
    sequence: number
  ): Promise<boolean> {
    try {
      const response = await this.client.cardkit.v1.card.settings({
        data: {
          settings: JSON.stringify({ streaming_mode: streamingMode }),
          sequence,
        },
        path: { card_id: cardId },
      });

      if (response.code !== 0) {
        console.warn(`CardKit settings failed: ${response.msg}`);
        return false;
      }

      return true;
    } catch (error) {
      console.warn('CardKit settings error:', error);
      return false;
    }
  }

  /**
   * 更新已发送的卡片消息（IM Patch 降级方案）
   */
  async updateCardMessage(
    messageId: string,
    card: unknown
  ): Promise<boolean> {
    const response = await this.client.im.v1.message.patch({
      data: {
        content: JSON.stringify(card),
      },
      path: {
        message_id: messageId,
      },
    });

    return response.code === 0;
  }

  /**
   * 添加"正在输入"表情回应
   */
  async addTypingReaction(messageId: string): Promise<string | null> {
    try {
      const response = await this.client.im.v1.messageReaction.create({
        path: {
          message_id: messageId,
        },
        data: {
          reaction_type: {
            emoji_type: 'Typing',
          },
        },
      });

      if (response.code !== 0) {
        console.warn(`Failed to add reaction: ${response.msg}`);
        return null;
      }

      return response.data?.reaction_id ?? null;
    } catch (error) {
      console.warn('Failed to add typing reaction:', error);
      return null;
    }
  }

  /**
   * 移除表情回应
   */
  async removeTypingReaction(
    messageId: string,
    reactionId: string | null
  ): Promise<void> {
    if (!reactionId) return;

    try {
      await this.client.im.v1.messageReaction.delete({
        path: {
          message_id: messageId,
          reaction_id: reactionId,
        },
      });
    } catch (error) {
      // 忽略删除失败（可能已经被删除）
      console.warn('Failed to remove typing reaction:', error);
    }
  }

  /**
   * 下载消息资源（文件/图片）
   */
  async downloadMessageResource(
    messageId: string,
    fileKey: string,
    resourceType: string,
    filename: string,
    saveDir?: string
  ): Promise<FileDownloadResult | null> {
    try {
      // 创建下载目录
      const downloadDir = saveDir ?? join(tmpdir(), 'feishu-downloads');
      await mkdir(downloadDir, { recursive: true });

      const filePath = join(downloadDir, filename);

      // 获取文件内容
      const fileResponse = await this.client.im.v1.file.get({
        path: {
          file_key: fileKey,
        },
      });

      // 写入文件
      await fileResponse.writeFile(filePath);

      // 获取文件大小
      const { stat } = await import('fs/promises');
      const stats = await stat(filePath);

      return {
        filePath,
        filename,
        size: stats.size,
        mimeType: this.getMimeType(filename),
      };
    } catch (error) {
      console.warn('Failed to download resource:', error);
      return null;
    }
  }

  /**
   * 删除消息
   */
  async deleteMessage(messageId: string): Promise<boolean> {
    const response = await this.client.im.v1.message.delete({
      path: {
        message_id: messageId,
      },
    });

    return response.code === 0;
  }

  /**
   * 回复消息
   */
  async replyToMessage(
    parentMessageId: string,
    content: string,
    msgType: string = 'text'
  ): Promise<MessageResult> {
    const response = await this.client.im.v1.message.reply({
      path: {
        message_id: parentMessageId,
      },
      data: {
        content: JSON.stringify({ text: content }),
        msg_type: msgType,
      },
    });

    if (response.code !== 0) {
      throw new Error(
        `Failed to reply to message: ${response.msg} (code: ${response.code})`
      );
    }

    return {
      messageId: response.data?.message_id ?? '',
      createTime: response.data?.create_time ?? String(Date.now()),
    };
  }

  /**
   * 获取 LarkClient 实例（用于高级操作）
   */
  getClient(): LarkClient {
    return this.client;
  }

  /**
   * 根据文件名获取 MIME 类型
   */
  private getMimeType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      pdf: 'application/pdf',
      txt: 'text/plain',
      md: 'text/markdown',
      json: 'application/json',
      js: 'application/javascript',
      ts: 'application/typescript',
      html: 'text/html',
      css: 'text/css',
      zip: 'application/zip',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };

    return mimeTypes[ext ?? ''] ?? 'application/octet-stream';
  }
}
