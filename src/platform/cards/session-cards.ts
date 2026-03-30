/**
 * Session cards builder
 * 会话管理卡片构建器
 *
 * 构建会话列表、项目列表等 UI 卡片（Schema 2.0 格式）
 */

import type { SessionInfo } from '../../adapters/interface/types.js';

/**
 * 构建会话列表卡片（Schema 2.0 格式）
 *
 * @param sessions - 会话列表
 * @param currentSessionId - 当前会话 ID
 * @param cliType - CLI 类型
 * @param workingDir - 当前工作目录
 * @param deletingSessionId - 处于"确认删除"状态的会话ID
 * @param totalCount - 总会话数
 */
export function buildSessionListCard(
  sessions: SessionInfo[],
  currentSessionId?: string,
  page: number = 1,
  totalPages: number = 1,
  cliType: string = 'opencode',
  workingDir: string = '',
  deletingSessionId?: string,
  totalCount?: number
): object {
  const elements: object[] = [];

  // ── 项目信息头部 ────────────────────────────────────────────────────────
  const projectName = workingDir ? workingDir.split('/').pop() || workingDir : '未知项目';
  let displayDir = workingDir;
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (displayDir.startsWith(home)) {
    displayDir = displayDir.replace(home, '~');
  }

  // 计算实际显示的总数（使用传入的 totalCount 或当前 sessions 长度）
  const actualTotalCount = totalCount ?? sessions.length;

  elements.push({
    tag: 'markdown',
    content: `📁 **${projectName}**\n\n📂 目录: \`${displayDir}\`\n💬 会话: ${actualTotalCount} 个`,
  });
  elements.push({ tag: 'hr' });

  // ── 顶部标题行 + 新建按钮 ─────────────────────────────────────────────
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
        elements: [{
          tag: 'button',
          text: { tag: 'plain_text', content: '🆕 新建' },
          type: 'primary',
          value: { action: 'create_new_session', cli_type: cliType, working_dir: workingDir },
        }],
      },
    ],
  });
  elements.push({ tag: 'hr' });

  // ── 会话列表 ──────────────────────────────────────────────────────────
  if (sessions.length === 0) {
    elements.push({
      tag: 'markdown',
      content: 'ℹ️ **暂无历史会话**\n\n发送消息开始对话，或点击「🆕 新建」',
    });
  } else {
    // 最多显示 5 条（分页）
    const sessionList = sessions.slice(0, 5);
    for (let i = 0; i < sessionList.length; i++) {
      const session = sessionList[i];
      const sessionId = session.id;
      const title = session.title || '未命名会话';
      const displayId = sessionId.length >= 8 ? sessionId.slice(-8) : sessionId;
      const isCurrent = sessionId === currentSessionId;
      const isDeleting = sessionId === deletingSessionId;

      // 格式化时间（OpenCode 返回秒级时间戳，转换为毫秒）
      const createdTimestamp = session.createdAt ? session.createdAt * 1000 : 0;
      const updatedTimestamp = session.updatedAt ? session.updatedAt * 1000 : 0;
      let createdStr = '';
      let updatedStr = '';

      if (createdTimestamp) {
        const date = new Date(createdTimestamp);
        createdStr = `${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
      }

      if (updatedTimestamp && updatedTimestamp !== createdTimestamp) {
        const date = new Date(updatedTimestamp);
        updatedStr = `${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
      }

      // 第一行：状态图标 + ID + 创建时间
      const statusIcon = isCurrent ? '🟢' : isDeleting ? '🔴' : '⚪';
      let firstLine = `${statusIcon} **${displayId}**`;
      if (createdStr) {
        firstLine += `  ·  📅 ${createdStr}`;
      }
      if (updatedStr) {
        firstLine += `  ·  📝 ${updatedStr}`;
      }
      elements.push({ tag: 'markdown', content: firstLine });

      // 第二行：标题 + 操作按钮
      if (isDeleting) {
        // 删除确认态
        elements.push({
          tag: 'column_set',
          flex_mode: 'none',
          columns: [
            {
              tag: 'column',
              width: 'weighted',
              weight: 3,
              elements: [{
                tag: 'markdown',
                content: `📋 ${title}\n<font color='red'>⚠️ 确认永久删除？</font>`,
              }],
            },
            {
              tag: 'column',
              width: 'auto',
              elements: [
                {
                  tag: 'button',
                  text: { tag: 'plain_text', content: '✅ 确认' },
                  type: 'danger',
                  value: {
                    action: 'delete_session_confirmed',
                    session_id: sessionId,
                    cli_type: cliType,
                  },
                },
                {
                  tag: 'button',
                  text: { tag: 'plain_text', content: '取消' },
                  type: 'default',
                  value: {
                    action: 'delete_session_cancel',
                    cli_type: cliType,
                  },
                },
              ],
            },
          ],
        });
      } else if (isCurrent) {
        // 当前会话
        elements.push({
          tag: 'column_set',
          flex_mode: 'none',
          columns: [
            {
              tag: 'column',
              width: 'weighted',
              weight: 3,
              elements: [{
                tag: 'markdown',
                content: `📋 ${title}\n<font color='green'>✓ 当前会话</font>`,
              }],
            },
            {
              tag: 'column',
              width: 'auto',
              elements: [{
                tag: 'button',
                text: { tag: 'plain_text', content: '📝 改名' },
                type: 'default',
                value: {
                  action: 'rename_session_prompt',
                  session_id: sessionId,
                  session_title: title,
                  cli_type: cliType,
                  working_dir: workingDir,
                },
              }],
            },
          ],
        });
      } else {
        // 非当前会话
        elements.push({
          tag: 'column_set',
          flex_mode: 'none',
          columns: [
            {
              tag: 'column',
              width: 'weighted',
              weight: 3,
              elements: [{ tag: 'markdown', content: `📋 ${title}` }],
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
                    session_id: sessionId,
                    cli_type: cliType,
                    working_dir: workingDir,
                  },
                },
                {
                  tag: 'button',
                  text: { tag: 'plain_text', content: '📝 改名' },
                  type: 'default',
                  value: {
                    action: 'rename_session_prompt',
                    session_id: sessionId,
                    session_title: title,
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
                    session_id: sessionId,
                    session_title: title,
                    cli_type: cliType,
                    working_dir: workingDir,
                  },
                },
              ],
            },
          ],
        });
      }

      if (i < sessionList.length - 1) {
        elements.push({ tag: 'hr' });
      }
    }
  }

  // ── 分页 ───────────────────────────────────────────────────────────────
  if (totalPages > 1) {
    elements.push({ tag: 'hr' });
    elements.push({
      tag: 'column_set',
      flex_mode: 'none',
      columns: [
        {
          tag: 'column',
          width: 'auto',
          elements: [{
            tag: 'button',
            text: { tag: 'plain_text', content: '⬅️ 上一页' },
            type: 'default',
            value: { action: 'session_page', page: page - 1, cli_type: cliType },
            disabled: page <= 1,
          }],
        },
        {
          tag: 'column',
          width: 'weighted',
          weight: 1,
          vertical_align: 'center',
          elements: [{
            tag: 'markdown',
            content: `**第 ${page}/${totalPages} 页**`,
            text_align: 'center',
          }],
        },
        {
          tag: 'column',
          width: 'auto',
          elements: [{
            tag: 'button',
            text: { tag: 'plain_text', content: '下一页 ➡️' },
            type: 'default',
            value: { action: 'session_page', page: page + 1, cli_type: cliType },
            disabled: page >= totalPages,
          }],
        },
      ],
    });
  }

  // ── 底部提示 ──────────────────────────────────────────────────────────
  elements.push({ tag: 'hr' });

  // 显示超出提示
  const actualTotal = totalCount ?? sessions.length;
  if (actualTotal > 10) {
    const hiddenCount = actualTotal - 10;
    elements.push({
      tag: 'markdown',
      content: `<font color='grey'>ℹ️ 还有 ${hiddenCount} 条历史会话未显示</font>`,
      text_size: 'notation',
    });
  }

  elements.push({
    tag: 'markdown',
    content: `<font color='grey'>💡 点击「📝 改名」后直接回复新名称即可完成重命名</font>`,
    text_size: 'notation',
  });

  // Schema 2.0 格式
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
 * 构建空会话卡片（新建会话后的欢迎）
 */
export function buildNewSessionCard(
  sessionId: string,
  workingDir: string,
  title?: string,
  model?: string,
  cliType: string = 'opencode'
): object {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const displayDir = workingDir.startsWith(home) ? workingDir.replace(home, '~') : workingDir;
  const displayId = sessionId.length >= 8 ? sessionId.slice(-8) : sessionId;

  const cliLabel = cliType.toLowerCase() === 'opencode' ? 'OpenCode' :
                   cliType.toLowerCase() === 'codex' ? 'Codex' : cliType || 'AI';

  const rows: object[] = [];

  rows.push({
    tag: 'column_set',
    flex_mode: 'none',
    columns: [
      {
        tag: 'column',
        width: 'auto',
        vertical_align: 'top',
        elements: [{ tag: 'markdown', content: "<font color='grey'>📋 会话</font>" }],
      },
      {
        tag: 'column',
        width: 'weighted',
        weight: 4,
        vertical_align: 'top',
        elements: [{ tag: 'markdown', content: `**${title || '新会话'}**  \`${displayId}\`` }],
      },
    ],
  });

  rows.push({
    tag: 'column_set',
    flex_mode: 'none',
    columns: [
      {
        tag: 'column',
        width: 'auto',
        vertical_align: 'top',
        elements: [{ tag: 'markdown', content: "<font color='grey'>📂 目录</font>" }],
      },
      {
        tag: 'column',
        width: 'weighted',
        weight: 4,
        vertical_align: 'top',
        elements: [{ tag: 'markdown', content: `\`${displayDir}\`` }],
      },
    ],
  });

  if (model) {
    rows.push({
      tag: 'column_set',
      flex_mode: 'none',
      columns: [
        {
          tag: 'column',
          width: 'auto',
          vertical_align: 'top',
          elements: [{ tag: 'markdown', content: "<font color='grey'>🤖 模型</font>" }],
        },
        {
          tag: 'column',
          width: 'weighted',
          weight: 4,
          vertical_align: 'top',
          elements: [{ tag: 'markdown', content: `\`${model}\`` }],
        },
      ],
    });
  }

  const elements: object[] = [
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
 * 构建会话切换确认卡片
 */
export function buildSessionSwitchedCard(sessionId: string, title: string): object {
  const displayId = sessionId.length >= 8 ? sessionId.slice(-8) : sessionId;

  return {
    schema: '2.0',
    header: {
      title: { tag: 'plain_text', content: '✅ 会话已切换' },
      template: 'green',
    },
    body: {
      elements: [
        { tag: 'markdown', content: `**当前会话:** ${title || '未命名会话'}` },
        { tag: 'markdown', content: `ID: \`${displayId}\`` },
      ],
    },
  };
}

/**
 * 构建会话删除确认卡片
 */
export function buildSessionDeletedCard(sessionId: string): object {
  const displayId = sessionId.length >= 8 ? sessionId.slice(-8) : sessionId;

  return {
    schema: '2.0',
    header: {
      title: { tag: 'plain_text', content: '🗑️ 会话已删除' },
      template: 'orange',
    },
    body: {
      elements: [
        { tag: 'markdown', content: `会话 \`${displayId}\` 已被删除` },
      ],
    },
  };
}
