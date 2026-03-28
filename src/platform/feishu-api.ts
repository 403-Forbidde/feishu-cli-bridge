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
import type {
  FeishuMessage,
  MessageResult,
  FileDownloadResult,
} from './types.js';
import type { StreamChunk, TokenStats } from '../core/types/stream.js';

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

  /**
   * 通过卡片模板 ID 发送卡片
   */
  async sendCardByCardId(
    to: string,
    cardId: string,
    replyToMessageId?: string
  ): Promise<Record<string, string>> {
    // 使用 CardKit 发送卡片
    const response = await this.client.cardkit.v1.card.create({
      data: {
        type: 'card_json',
        data: JSON.stringify({
          type: 'template',
          data: {
            template_id: cardId,
            template_version: '1.0.0',
          },
        }),
      },
    });

    if (response.code !== 0) {
      throw new Error(
        `Failed to send card by ID: ${response.msg} (code: ${response.code})`
      );
    }

    return {
      messageId: response.data?.card_id ?? '',
      cardId: response.data?.card_id ?? '',
    };
  }

  /**
   * 更新已发送的卡片消息
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
   * 使用 CardKit 更新卡片内容
   */
  async updateCardKitContent(
    cardId: string,
    elementId: string,
    content: string,
    sequence: number
  ): Promise<boolean> {
    const response = await this.client.cardkit.v1.card.batchUpdate({
      path: {
        card_id: cardId,
      },
      data: {
        sequence,
        uuid: crypto.randomUUID(),
        actions: JSON.stringify([
          {
            action: 'update',
            target_element_id: elementId,
            content,
          },
        ]),
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
            emoji_type: 'Pencil',
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
