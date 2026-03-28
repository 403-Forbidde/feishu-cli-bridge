/**
 * Session cards builder
 * 会话相关卡片构建模块
 *
 * 包含与会话管理相关的所有卡片构建函数
 */

import type { CardElement, FeishuCard } from './base.js';
import { homedir } from 'os';

/** 会话数据 */
export interface SessionData {
  sessionId: string;
  displayId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  isCurrent: boolean;
}

/** 新建会话卡片选项 */
export interface NewSessionCardOptions {
  sessionId: string;
  sessionTitle: string;
  workingDir: string;
  model?: string;
  cliType: string;
  projectName?: string;
  projectDisplayName?: string;
  slug?: string;
}

/**
 * 构建「新建会话成功」卡片
 */
export function buildNewSessionCard(options: NewSessionCardOptions): FeishuCard {
  const {
    sessionId,
    sessionTitle,
    workingDir,
    model,
    cliType,
    projectName,
    projectDisplayName,
    slug,
  } = options;

  // 显示用的短 ID
  const displayId = slug || (sessionId.length > 8 ? sessionId.slice(-8) : sessionId);

  // 工作目录美化
  const home = homedir();
  const displayDir = workingDir.startsWith(home)
    ? workingDir.replace(home, '~')
    : workingDir;

  const cliLabel = cliType.toLowerCase() === 'opencode' ? 'OpenCode' : cliType || 'AI';

  const createKV = (key: string, value: string): CardElement => ({
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
            content: `<font color='grey'>${key}</font>`,
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
            content: value,
            text_size: 'normal',
          },
        ],
      },
    ],
  });

  const rows: CardElement[] = [
    createKV('📋 会话', `**${sessionTitle || '新会话'}**  \`${displayId}\``),
  ];

  if (projectDisplayName || projectName) {
    const label = projectDisplayName || projectName;
    const nameSuffix = projectName && projectDisplayName ? `  \`${projectName}\`` : '';
    rows.push(createKV('💼 项目', `${label}${nameSuffix}`));
  }

  rows.push(createKV('📂 目录', `\`${displayDir}\``));

  if (model) {
    rows.push(createKV('🤖 模型', `\`${model}\``));
  }

  const elements: CardElement[] = [
    ...rows,
    { tag: 'hr' },
    {
      tag: 'markdown',
      content: `<font color='grey'>💡 新消息将在此会话中与 ${cliLabel} 对话</font>`,
      text_size: 'notation',
    },
  ];

  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: '✅ 已创建新会话' },
      template: 'green',
    },
    body: { elements },
  };
}

/**
 * 构建会话列表卡片
 */
export function buildSessionListCard(
  sessions: SessionData[],
  currentSessionId: string,
  cliType: string,
  workingDir: string,
  totalCount: number
): FeishuCard {
  const elements: CardElement[] = [];

  // 项目信息头部
  const projectName = workingDir ? workingDir.split('/').pop() || '未知项目' : '未知项目';
  const displayDir = workingDir;

  elements.push({
    tag: 'markdown',
    content: `📁 **${projectName}**\n\n**📂 目录**: \`${displayDir}\`\n**💬 会话**: ${sessions.length} 个`,
  });
  elements.push({ tag: 'hr' });

  // 顶部标题行 + 新建按钮
  elements.push({
    tag: 'column_set',
    flex_mode: 'none',
    columns: [
      {
        tag: 'column',
        width: 'weighted',
        weight: 3,
        elements: [{ tag: 'markdown', content: '💬 **会话列表**' }],
      },
      {
        tag: 'column',
        width: 'auto',
        elements: [
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '🆕 新建' },
            type: 'primary',
            value: { action: 'create_new_session', cli_type: cliType, working_dir: workingDir },
          },
        ],
      },
    ],
  });
  elements.push({ tag: 'hr' });

  // 会话列表
  if (sessions.length === 0) {
    elements.push({
      tag: 'markdown',
      content: 'ℹ️ **暂无历史会话**\n\n发送消息开始对话，或点击「🆕 新建」',
    });
  } else {
    for (let i = 0; i < sessions.length; i++) {
      const session = sessions[i];
      const isCurrent = session.sessionId === currentSessionId;

      // 格式化时间
      const timestamp = session.updatedAt || session.createdAt;
      const timeStr = timestamp
        ? new Date(timestamp * 1000).toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })
        : '';

      // 第一行：状态图标 + ID + 时间
      const statusIcon = isCurrent ? '🟢' : '⚪';
      let firstLine = `${statusIcon} **${session.displayId}**`;
      if (timeStr) {
        firstLine += `  ·  ${timeStr}`;
      }
      elements.push({ tag: 'markdown', content: firstLine });

      // 第二行：标题 + 操作按钮
      if (isCurrent) {
        elements.push({
          tag: 'column_set',
          flex_mode: 'none',
          columns: [
            {
              tag: 'column',
              width: 'weighted',
              weight: 3,
              elements: [
                {
                  tag: 'markdown',
                  content: `📋 ${session.title}\n<font color='green'>✓ 当前会话</font>`,
                },
              ],
            },
            {
              tag: 'column',
              width: 'auto',
              elements: [
                {
                  tag: 'button',
                  text: { tag: 'plain_text', content: '📝 改名' },
                  type: 'default',
                  value: {
                    action: 'rename_session_prompt',
                    session_id: session.sessionId,
                    session_title: session.title,
                    cli_type: cliType,
                    working_dir: workingDir,
                  },
                },
              ],
            },
          ],
        });
      } else {
        elements.push({
          tag: 'column_set',
          flex_mode: 'none',
          columns: [
            {
              tag: 'column',
              width: 'weighted',
              weight: 3,
              elements: [{ tag: 'markdown', content: `📋 ${session.title}` }],
            },
            {
              tag: 'column',
              width: 'auto',
              elements: [
                {
                  tag: 'button',
                  text: { tag: 'plain_text', content: '▶ 切换' },
                  type: 'primary',
                  value: {
                    action: 'switch_session',
                    session_id: session.sessionId,
                    cli_type: cliType,
                    working_dir: workingDir,
                  },
                },
                {
                  tag: 'button',
                  text: { tag: 'plain_text', content: '🗑️ 删除' },
                  type: 'danger',
                  value: {
                    action: 'delete_session_confirm',
                    session_id: session.sessionId,
                    session_title: session.title,
                    cli_type: cliType,
                    working_dir: workingDir,
                  },
                },
              ],
            },
          ],
        });
      }

      if (i < sessions.length - 1) {
        elements.push({ tag: 'hr' });
      }
    }
  }

  // 底部提示
  elements.push({ tag: 'hr' });

  if (totalCount > 10) {
    const hiddenCount = totalCount - 10;
    elements.push({
      tag: 'markdown',
      content: `<font color='grey'>ℹ️ 还有 ${hiddenCount} 条历史会话未显示</font>`,
      text_size: 'notation',
    });
  }

  elements.push({
    tag: 'markdown',
    content: "<font color='grey'>💡 点击「📝 改名」后直接回复新名称即可完成重命名</font>",
    text_size: 'notation',
  });

  return {
    schema: '2.0',
    header: {
      title: { tag: 'plain_text', content: '会话管理' },
      template: 'blue',
    },
    body: { elements },
  };
}

/**
 * 构建单个会话详情卡片
 */
export function buildSessionInfoCard(
  sessionInfo: SessionData,
  cliType: string
): FeishuCard {
  const elements: CardElement[] = [];

  if (sessionInfo.isCurrent) {
    elements.push({ tag: 'markdown', content: '🟢 **当前激活会话**' });
  }

  // 基本信息
  elements.push({
    tag: 'column_set',
    flex_mode: 'none',
    background_style: 'default',
    columns: [
      { tag: 'column', width: 'auto', elements: [{ tag: 'markdown', content: '🆔' }] },
      { tag: 'column', weight: 4, elements: [{ tag: 'markdown', content: `\`${sessionInfo.displayId}\`` }] },
    ],
  });

  elements.push({
    tag: 'column_set',
    flex_mode: 'none',
    background_style: 'default',
    columns: [
      { tag: 'column', width: 'auto', elements: [{ tag: 'markdown', content: '📋' }] },
      { tag: 'column', weight: 4, elements: [{ tag: 'markdown', content: sessionInfo.title }] },
    ],
  });

  // 操作按钮
  elements.push({ tag: 'hr' });

  if (!sessionInfo.isCurrent) {
    elements.push({
      tag: 'button',
      text: { tag: 'plain_text', content: '▶ 切换到此会话' },
      type: 'primary',
      value: {
        action: 'switch_session',
        session_id: sessionInfo.sessionId,
        cli_type: cliType,
      },
    });
  }

  elements.push({
    tag: 'button',
    text: { tag: 'plain_text', content: '📝 重命名' },
    type: 'default',
    value: {
      action: 'rename_session_prompt',
      session_id: sessionInfo.sessionId,
      cli_type: cliType,
    },
  });

  elements.push({
    tag: 'button',
    text: { tag: 'plain_text', content: '📋 查看列表' },
    type: 'default',
    value: { action: 'list_sessions', cli_type: cliType },
  });

  return {
    schema: '2.0',
    header: {
      title: { tag: 'plain_text', content: '会话详情' },
      template: 'blue',
    },
    body: { elements },
  };
}
