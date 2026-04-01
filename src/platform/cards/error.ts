/**
 * Error card builder
 * 错误卡片构建器
 *
 * 构建错误状态展示卡片
 */

import { CardColors, createCardConfig, createMarkdownBlock, createNoteBlock, createDivider, createButton } from './utils.js';

/**
 * 错误类型配置
 */
const ERROR_CONFIG: Record<string, { icon: string; title: string; color: string }> = {
  default: {
    icon: '⚠️',
    title: '发生错误',
    color: CardColors.ERROR,
  },
  network: {
    icon: '🌐',
    title: '网络错误',
    color: CardColors.ERROR,
  },
  timeout: {
    icon: '⏱️',
    title: '请求超时',
    color: CardColors.WARNING,
  },
  rate_limit: {
    icon: '🚫',
    title: '请求过于频繁',
    color: CardColors.WARNING,
  },
  server: {
    icon: '🔧',
    title: '服务器错误',
    color: CardColors.ERROR,
  },
  auth: {
    icon: '🔒',
    title: '认证失败',
    color: CardColors.ERROR,
  },
  invalid_request: {
    icon: '📝',
    title: '请求无效',
    color: CardColors.WARNING,
  },
  path_traversal: {
    icon: '🚷',
    title: '路径访问被拒绝',
    color: CardColors.ERROR,
  },
};

/**
 * 构建错误卡片
 *
 * @param message - 错误消息
 * @param type - 错误类型
 * @param details - 详细错误信息（可选）
 * @param suggestion - 解决建议（可选）
 */
export function buildErrorCard(
  message: string,
  type: string = 'default',
  details?: string,
  suggestion?: string
): object {
  const config = ERROR_CONFIG[type] || ERROR_CONFIG.default;
  const elements: object[] = [];

  // 错误图标和消息
  elements.push({
    tag: 'markdown',
    content: `${config.icon} **${message}**`,
  });

  // 详细信息（如果有）- 使用 collapsible_panel 折叠显示
  if (details) {
    elements.push(createDivider());
    elements.push({
      tag: 'collapsible_panel',
      expanded: false,
      header: {
        title: {
          tag: 'markdown',
          content: '🔍 详细信息',
        },
        vertical_align: 'center',
        icon: {
          tag: 'standard_icon',
          token: 'down-small-ccm_outlined',
          size: '16px 16px',
        },
        icon_position: 'follow_text',
        icon_expanded_angle: -180,
      },
      border: { color: 'grey', corner_radius: '5px' },
      vertical_spacing: '8px',
      padding: '8px 8px 8px 8px',
      elements: [
        {
          tag: 'markdown',
          content: `
${details}
`,
          text_size: 'notation',
        },
      ],
    });
  }

  // 解决建议（如果有）
  if (suggestion) {
    elements.push(createDivider());
    elements.push({
      tag: 'markdown',
      content: '💡 **建议**',
    });
    elements.push(createNoteBlock(suggestion));
  }

  // CardKit 2.0 格式
  return {
    schema: '2.0',
    config: {
      ...createCardConfig(),
      summary: { content: config.title },
    },
    header: {
      title: {
        tag: 'plain_text',
        content: config.title,
      },
      template: config.color,
    },
    body: {
      elements,
    },
  };
}

/**
 * 构建网络错误卡片
 */
export function buildNetworkErrorCard(message: string, url?: string): object {
  const details = url ? `请求地址: ${url}` : undefined;
  return buildErrorCard(
    message || '无法连接到服务器',
    'network',
    details,
    '请检查网络连接，或稍后重试。如果问题持续存在，请联系管理员。'
  );
}

/**
 * 构建超时错误卡片
 */
export function buildTimeoutErrorCard(timeoutSeconds: number): object {
  return buildErrorCard(
    `请求超时（${timeoutSeconds}秒）`,
    'timeout',
    undefined,
    '请求处理时间过长。您可以尝试：\n1. 简化您的问题\n2. 稍后重试\n3. 检查服务器状态'
  );
}

/**
 * 构建限流错误卡片
 */
export function buildRateLimitErrorCard(retryAfter?: number): object {
  const message = retryAfter
    ? `请求过于频繁，请等待 ${retryAfter} 秒后重试`
    : '请求过于频繁，请稍后再试';
  return buildErrorCard(message, 'rate_limit');
}

/**
 * 构建服务器错误卡片
 */
export function buildServerErrorCard(statusCode: number, message?: string): object {
  return buildErrorCard(
    message || `服务器错误 (${statusCode})`,
    'server',
    `HTTP 状态码: ${statusCode}`,
    '服务器出现错误，请稍后重试。如果问题持续存在，请联系管理员。'
  );
}

/**
 * 构建路径遍历错误卡片（安全错误）
 */
export function buildPathTraversalErrorCard(path: string): object {
  return buildErrorCard(
    '路径访问被拒绝',
    'path_traversal',
    `尝试访问路径: ${path}`,
    '出于安全考虑，只能访问允许目录下的文件。请联系管理员配置允许的路径。'
  );
}

/**
 * 构建停止确认卡片（用户发送 /stop 后）
 * 使用红色主题和红色圆形图标
 */
export function buildStopConfirmationCard(): object {
  return {
    schema: '2.0',
    config: {
      ...createCardConfig(),
      summary: { content: '已停止生成' },
    },
    header: {
      title: {
        tag: 'plain_text',
        content: '已停止生成',
      },
      template: CardColors.ERROR, // 红色主题
    },
    body: {
      elements: [
        {
          tag: 'markdown',
          content: "🔴 **生成已停止**",
        },
        createDivider(),
        createNoteBlock('用户主动中止了生成过程'),
      ],
    },
  };
}
