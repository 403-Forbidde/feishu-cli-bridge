/**
 * Attachment Processor
 * 附件处理器
 *
 * 处理飞书消息中的附件下载和预处理
 * 支持图片、文件等资源的下载和 base64 编码
 */

import { mkdir, readFile, stat } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { logger } from '../../core/logger.js';
import type { FeishuAPI } from '../feishu-api.js';
import type { Attachment } from '../../adapters/interface/types.js';
import type { FileDownloadResult } from '../types.js';

/**
 * 处理后的附件信息
 */
export interface ProcessedAttachment extends Attachment {
  /** 本地文件路径 */
  localPath: string;
  /** 文件大小（字节） */
  size: number;
  /** Base64 编码内容（如果是图片） */
  base64Data?: string;
  /** 数据 URL（用于发送给 AI） */
  dataUrl?: string;
}

/**
 * 附件处理器选项
 */
export interface AttachmentProcessorOptions {
  /** 飞书 API 实例 */
  feishuAPI: FeishuAPI;
  /** 下载目录（默认为系统临时目录） */
  downloadDir?: string;
  /** 最大文件大小（字节，默认 50MB） */
  maxFileSize?: number;
  /** 是否自动编码为 base64 */
  autoEncodeBase64?: boolean;
}

/**
 * 附件处理器
 *
 * 负责下载和预处理消息附件
 */
export class AttachmentProcessor {
  private feishuAPI: FeishuAPI;
  private downloadDir: string;
  private maxFileSize: number;
  private autoEncodeBase64: boolean;

  constructor(options: AttachmentProcessorOptions) {
    this.feishuAPI = options.feishuAPI;
    this.downloadDir = options.downloadDir ?? join(tmpdir(), 'feishu-attachments');
    this.maxFileSize = options.maxFileSize ?? 50 * 1024 * 1024; // 50MB
    this.autoEncodeBase64 = options.autoEncodeBase64 ?? true;
  }

  /**
   * 处理单个附件
   * @param messageId - 消息 ID
   * @param attachment - 附件信息
   * @returns 处理后的附件信息
   */
  async processAttachment(
    messageId: string,
    attachment: Attachment
  ): Promise<ProcessedAttachment | null> {
    try {
      // 确保下载目录存在
      await mkdir(this.downloadDir, { recursive: true });

      // 下载文件
      const result = await this.feishuAPI.downloadMessageResource(
        messageId,
        attachment.fileKey,
        attachment.resourceType,
        attachment.filename,
        this.downloadDir
      );

      if (!result) {
        logger.warn({ fileKey: attachment.fileKey }, '下载附件失败');
        return null;
      }

      // 检查下载后的文件大小
      const fileStats = await stat(result.filePath);
      if (fileStats.size > this.maxFileSize) {
        logger.warn(
          { filename: attachment.filename, size: fileStats.size },
          '下载后的文件超出大小限制'
        );
        return null;
      }

      // 构建处理后的附件信息
      const processed: ProcessedAttachment = {
        ...attachment,
        localPath: result.filePath,
        size: fileStats.size,
      };

      // 如果是图片，进行 base64 编码并保留原始 buffer 供适配器使用
      if (this.autoEncodeBase64 && this.isImage(attachment.mimeType)) {
        const data = await readFile(result.filePath);
        const base64Data = data.toString('base64');
        processed.base64Data = base64Data;
        processed.dataUrl = `data:${attachment.mimeType};base64,${base64Data}`;
        processed.data = data;
      }

      logger.debug(
        { filename: attachment.filename, type: attachment.resourceType, size: fileStats.size },
        '附件处理完成'
      );

      return processed;
    } catch (error) {
      logger.error({ error, fileKey: attachment.fileKey }, '处理附件时出错');
      return null;
    }
  }

  /**
   * 批量处理多个附件
   * @param messageId - 消息 ID
   * @param attachments - 附件列表
   * @returns 处理后的附件列表
   */
  async processAttachments(
    messageId: string,
    attachments: Attachment[]
  ): Promise<ProcessedAttachment[]> {
    const results: ProcessedAttachment[] = [];

    for (const attachment of attachments) {
      const processed = await this.processAttachment(messageId, attachment);
      if (processed) {
        results.push(processed);
      }
    }

    logger.info(
      { total: attachments.length, success: results.length },
      '批量附件处理完成'
    );

    return results;
  }

  /**
   * 将文件编码为 base64
   * @param filePath - 文件路径
   * @returns base64 编码字符串
   */
  async encodeToBase64(filePath: string): Promise<string> {
    const data = await readFile(filePath);
    return data.toString('base64');
  }

  /**
   * 检查 MIME 类型是否为图片
   * @param mimeType - MIME 类型
   */
  isImage(mimeType: string): boolean {
    return mimeType.startsWith('image/');
  }

  /**
   * 检查 MIME 类型是否为文本文件
   * @param mimeType - MIME 类型
   */
  isTextFile(mimeType: string): boolean {
    const textTypes = [
      'text/',
      'application/json',
      'application/javascript',
      'application/typescript',
      'application/xml',
      'application/yaml',
    ];
    return textTypes.some(type => mimeType.includes(type));
  }

  /**
   * 读取文本文件内容
   * @param filePath - 文件路径
   * @param maxLength - 最大读取长度（字符）
   * @returns 文件内容
   */
  async readTextFile(filePath: string, maxLength: number = 10000): Promise<string | null> {
    try {
      const data = await readFile(filePath, 'utf-8');
      if (data.length > maxLength) {
        return data.substring(0, maxLength) + '\n... (内容已截断)';
      }
      return data;
    } catch (error) {
      logger.error({ error, filePath }, '读取文本文件失败');
      return null;
    }
  }

  /**
   * 构建附件描述文本
   * @param attachments - 处理后的附件列表
   * @returns 描述文本
   */
  buildAttachmentDescription(attachments: ProcessedAttachment[]): string {
    if (attachments.length === 0) {
      return '';
    }

    const lines: string[] = ['\n\n**附件:**'];

    for (const att of attachments) {
      const sizeKb = Math.round(att.size / 1024);
      lines.push(`- ${att.filename} (${sizeKb} KB, ${att.mimeType})`);

      // 如果是文本文件，添加内容预览
      if (this.isTextFile(att.mimeType) && !att.mimeType.startsWith('image/')) {
        lines.push('```');
        lines.push(`[文件内容: ${att.localPath}]`);
        lines.push('```');
      }
    }

    return lines.join('\n');
  }

  /**
   * 清理临时文件
   * @param attachments - 要清理的附件列表
   */
  async cleanup(attachments: ProcessedAttachment[]): Promise<void> {
    // 暂时不自动删除，让系统定时清理临时目录
    // 或者可以在进程退出时批量清理
    logger.debug({ count: attachments.length }, '跳过附件清理（保留在临时目录）');
  }
}

/**
 * 创建附件处理器实例
 */
export function createAttachmentProcessor(
  options: AttachmentProcessorOptions
): AttachmentProcessor {
  return new AttachmentProcessor(options);
}
