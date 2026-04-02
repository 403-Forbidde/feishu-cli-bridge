/**
 * Result cards builder
 * 通用结果卡片构建器
 *
 * 为 TUI 命令提供统一风格的成功/信息/提示卡片
 */

import type { CardElement, FeishuCard } from '../../card-builder/base.js';

/** KV 字段 */
export interface ResultField {
  key: string;
  value: string;
}

/**
 * 构建成功结果卡片
 *
 * @param title - 标题（如 "✅ 操作成功"）
 * @param action - 操作名称/主内容（如 "已创建新会话"）
 * @param fields - 键值对字段列表（可选）
 * @param tip - 底部提示（可选）
 */
export function buildSuccessCard(
  title: string,
  action: string,
  fields?: ResultField[],
  tip?: string
): FeishuCard {
  const elements: CardElement[] = [
    {
      tag: 'markdown',
      content: action,
    },
  ];

  if (fields && fields.length > 0) {
    elements.push({ tag: 'hr' });
    for (const field of fields) {
      elements.push({
        tag: 'column_set',
        flex_mode: 'none',
        columns: [
          {
            tag: 'column',
            width: 'auto',
            vertical_align: 'top',
            elements: [
              {
                tag: 'markdown',
                content: `<font color='grey'>${field.key}</font>`,
                text_size: 'normal',
              },
            ],
          },
          {
            tag: 'column',
            width: 'weighted',
            weight: 4,
            vertical_align: 'top',
            elements: [
              {
                tag: 'markdown',
                content: field.value,
                text_size: 'normal',
              },
            ],
          },
        ],
      });
    }
  }

  if (tip) {
    elements.push({ tag: 'hr' });
    elements.push({
      tag: 'markdown',
      content: `<font color='grey'>${tip}</font>`,
      text_size: 'notation',
    });
  }

  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: title },
      template: 'green',
    },
    body: { elements },
  };
}

/**
 * 构建信息提示卡片
 *
 * @param title - 标题（如 "ℹ️ 提示"）
 * @param content - 主内容
 * @param template - 主题色（默认 blue）
 * @param tip - 底部提示（可选）
 */
export function buildInfoCard(
  title: string,
  content: string,
  template: 'blue' | 'grey' | 'orange' = 'blue',
  tip?: string
): FeishuCard {
  const elements: CardElement[] = [
    {
      tag: 'markdown',
      content,
    },
  ];

  if (tip) {
    elements.push({ tag: 'hr' });
    elements.push({
      tag: 'markdown',
      content: `<font color='grey'>${tip}</font>`,
      text_size: 'notation',
    });
  }

  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: title },
      template,
    },
    body: { elements },
  };
}

/**
 * 构建警告提示卡片
 *
 * @param title - 标题
 * @param content - 主内容
 * @param tip - 底部提示（可选）
 */
export function buildWarningCard(
  title: string,
  content: string,
  tip?: string
): FeishuCard {
  return buildInfoCard(title, content, 'orange', tip);
}
