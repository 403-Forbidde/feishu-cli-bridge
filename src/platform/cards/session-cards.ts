/**
 * Session cards builder
 * 会话管理卡片构建器
 *
 * 构建会话列表、项目列表等 UI 卡片
 */

import { CardColors, createCardConfig, createNoteBlock, createDivider, createButton, truncateText } from './utils.js';
import type { SessionInfo } from '../../adapters/interface/types.js';

/**
 * 构建会话列表卡片
 *
 * @param sessions - 会话列表
 * @param currentSessionId - 当前会话 ID
 * @param page - 当前页码
 * @param totalPages - 总页数
 */
export function buildSessionListCard(
  sessions: SessionInfo[],
  currentSessionId?: string,
  page: number = 1,
  totalPages: number = 1
): object {
  const elements: object[] = [];

  // 标题
  elements.push({
    tag: 'div',
    text: {
      tag: 'plain_text',
      content: '💬 会话列表',
    },
  });
  elements.push(createNoteBlock(`共 ${sessions.length} 个会话 · 第 ${page}/${totalPages} 页`));
  elements.push(createDivider());

  if (sessions.length === 0) {
    elements.push({
      tag: 'div',
      text: {
        tag: 'plain_text',
        content: '暂无会话，发送消息开始新对话',
      },
    });
  } else {
    // 会话列表 - 每行一个
    for (const session of sessions) {
      const isCurrent = session.id === currentSessionId;
      const timeStr = formatTime(session.updatedAt || session.createdAt);
      const title = truncateText(session.title || '未命名会话', 30);

      elements.push({
        tag: 'div',
        text: {
          tag: 'plain_text',
          content: `${isCurrent ? '▶ ' : '  '}${title}`,
        },
      });
      elements.push(createNoteBlock(`📁 ${truncateText(session.workingDir, 25)} · ${timeStr}`));

      // 操作按钮
      elements.push({
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: {
              tag: 'plain_text',
              content: isCurrent ? '当前' : '切换',
            },
            type: isCurrent ? 'primary' : 'default',
            value: {
              action: 'switch_session',
              sessionId: session.id,
            },
            disabled: isCurrent,
          },
          {
            tag: 'button',
            text: {
              tag: 'plain_text',
              content: '重命名',
            },
            type: 'default',
            value: {
              action: 'rename_session',
              sessionId: session.id,
            },
          },
          {
            tag: 'button',
            text: {
              tag: 'plain_text',
              content: '删除',
            },
            type: 'danger',
            value: {
              action: 'delete_session',
              sessionId: session.id,
            },
          },
        ],
      });

      elements.push(createDivider());
    }
  }

  // 分页按钮
  const paginationActions: object[] = [
    {
      tag: 'button',
      text: {
        tag: 'plain_text',
        content: '⬅️ 上一页',
      },
      type: 'default',
      value: {
        action: 'session_page',
        page: page - 1,
      },
      disabled: page <= 1,
    },
    {
      tag: 'button',
      text: {
        tag: 'plain_text',
        content: '下一页 ➡️',
      },
      type: 'default',
      value: {
        action: 'session_page',
        page: page + 1,
      },
      disabled: page >= totalPages,
    },
  ];

  elements.push({
    tag: 'action',
    actions: paginationActions,
  });

  elements.push(createDivider());

  // 快捷命令提示
  elements.push(createNoteBlock('快捷命令: /new - 新建会话 | /switch <id> - 切换会话'));

  return {
    schema: '2.0',
    config: createCardConfig(),
    header: {
      title: {
        tag: 'plain_text',
        content: '会话管理',
      },
      template: CardColors.DEFAULT,
    },
    body: {
      elements,
    },
  };
}

/**
 * 构建空会话卡片（新建会话后的欢迎）
 */
export function buildNewSessionCard(sessionId: string, workingDir: string): object {
  return {
    schema: '2.0',
    config: createCardConfig(),
    header: {
      title: {
        tag: 'plain_text',
        content: '✨ 新会话已创建',
      },
      template: CardColors.SUCCESS,
    },
    body: {
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'plain_text',
            content: `会话 ID: ${sessionId.slice(0, 8)}...`,
          },
        },
        createNoteBlock(`工作目录: ${workingDir}`),
        createDivider(),
        {
          tag: 'div',
          text: {
            tag: 'plain_text',
            content: '💡 发送消息开始对话，或使用 /help 查看所有命令',
          },
        },
      ],
    },
  };
}

/**
 * 构建会话切换确认卡片
 */
export function buildSessionSwitchedCard(sessionId: string, title: string): object {
  return {
    schema: '2.0',
    config: createCardConfig(),
    header: {
      title: {
        tag: 'plain_text',
        content: '✅ 会话已切换',
      },
      template: CardColors.SUCCESS,
    },
    body: {
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'plain_text',
            content: `当前会话: ${title || '未命名会话'}`,
          },
        },
        createNoteBlock(`ID: ${sessionId.slice(0, 8)}...`),
      ],
    },
  };
}

/**
 * 构建会话删除确认卡片
 */
export function buildSessionDeletedCard(sessionId: string): object {
  return {
    schema: '2.0',
    config: createCardConfig(),
    header: {
      title: {
        tag: 'plain_text',
        content: '🗑️ 会话已删除',
      },
      template: CardColors.WARNING,
    },
    body: {
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'plain_text',
            content: `会话 ${sessionId.slice(0, 8)}... 已被删除`,
          },
        },
      ],
    },
  };
}

/**
 * 格式化时间戳
 */
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  // 小于 1 分钟
  if (diff < 60 * 1000) {
    return '刚刚';
  }

  // 小于 1 小时
  if (diff < 60 * 60 * 1000) {
    return `${Math.floor(diff / (60 * 1000))} 分钟前`;
  }

  // 小于 24 小时
  if (diff < 24 * 60 * 60 * 1000) {
    return `${Math.floor(diff / (60 * 60 * 1000))} 小时前`;
  }

  // 大于 24 小时
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}
