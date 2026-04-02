/**
 * Help card builder
 * 帮助卡片构建器
 *
 * 构建 /help 命令的帮助卡片（Schema 2.0 格式）
 */

import type { Project } from '../../project/types.js';

/**
 * 命令项定义
 */
interface CommandItem {
  icon: string;
  command: string;
  title: string;
  description: string;
  color?: string;
}

/**
 * 命令列表
 */
const COMMANDS: CommandItem[] = [
  {
    icon: '🆕',
    command: '/new',
    title: '新建会话',
    description: '创建全新的对话上下文，开始独立话题讨论',
  },
  {
    icon: '📋',
    command: '/session',
    title: '会话管理',
    description: '查看、切换和管理所有历史会话记录',
  },
  {
    icon: '🤖',
    command: '/model',
    title: '切换模型',
    description: '在配置的 AI 模型列表中选择使用',
  },
  {
    icon: '🎯',
    command: '/mode',
    title: '工作模式',
    description: '切换 Agent 角色（编码、审查、调试等）',
  },
  {
    icon: '🔄',
    command: '/reset',
    title: '清空对话',
    description: '重置当前会话，清除所有历史消息',
  },
  {
    icon: '🔴',
    command: '/stop',
    title: '停止生成',
    description: '立即中断 AI 正在进行的回复生成',
  },
  {
    icon: '❓',
    command: '/help',
    title: '使用帮助',
    description: '显示所有可用命令的详细说明',
  },
];

/**
 * 构建帮助卡片
 *
 * @param currentProject - 当前项目（可选）
 * @param cliType - CLI 类型
 * @returns 卡片 JSON 对象
 */
export function buildHelpCard(
  currentProject: Project | null,
  cliType: string = 'opencode'
): object {
  const elements: object[] = [];

  // ── 项目信息头部 ────────────────────────────────────────────────────────
  const cliLabel = cliType.toUpperCase();

  if (currentProject) {
    const projectName = currentProject.displayName || currentProject.name;
    let displayDir = currentProject.path;
    const home = process.env.HOME || process.env.USERPROFILE || '';
    if (displayDir.startsWith(home)) {
      displayDir = displayDir.replace(home, '~');
    }

    elements.push({
      tag: 'markdown',
      content: `🤖 **${cliLabel} 智能助手**`,
    });
    elements.push({
      tag: 'column_set',
      flex_mode: 'none',
      columns: [
        {
          tag: 'column',
          width: 'auto',
          elements: [{ tag: 'markdown', content: '📁 **当前项目：**' }],
        },
        {
          tag: 'column',
          width: 'weighted',
          weight: 3,
          elements: [{ tag: 'markdown', content: projectName }],
        },
      ],
    });
    elements.push({
      tag: 'column_set',
      flex_mode: 'none',
      columns: [
        {
          tag: 'column',
          width: 'auto',
          elements: [{ tag: 'markdown', content: '💼 **工作目录：**' }],
        },
        {
          tag: 'column',
          width: 'weighted',
          weight: 3,
          elements: [{ tag: 'markdown', content: `\`${displayDir}\`` }],
        },
      ],
    });
    elements.push({ tag: 'hr' });
  } else {
    elements.push({
      tag: 'markdown',
      content: `🤖 **${cliLabel} 智能助手**`,
    });
    elements.push({
      tag: 'markdown',
      content: '<font color="grey">📁 当前未选择项目</font>',
    });
    elements.push({ tag: 'hr' });
  }

  // ── 命令列表 ────────────────────────────────────────────────────────────
  for (let i = 0; i < COMMANDS.length; i++) {
    const cmd = COMMANDS[i];

    // 命令行：图标 + 命令名 + 标题
    elements.push({
      tag: 'column_set',
      flex_mode: 'none',
      columns: [
        {
          tag: 'column',
          width: 'auto',
          elements: [{ tag: 'markdown', content: `${cmd.icon}` }],
        },
        {
          tag: 'column',
          width: 'auto',
          elements: [{ tag: 'markdown', content: `\`${cmd.command}\`` }],
        },
        {
          tag: 'column',
          width: 'weighted',
          weight: 2,
          elements: [{ tag: 'markdown', content: `**${cmd.title}**` }],
        },
      ],
    });

    // 描述行（缩进）
    elements.push({
      tag: 'markdown',
      content: `<font color="grey">${cmd.description}</font>`,
      text_size: 'small',
    });

    // 分隔线（除了最后一个命令）
    if (i < COMMANDS.length - 1) {
      elements.push({ tag: 'hr' });
    }
  }

  // ── 使用提示 ────────────────────────────────────────────────────────────
  elements.push({ tag: 'hr' });
  elements.push({
    tag: 'markdown',
    content: '💡 **使用提示**',
  });
  elements.push({
    tag: 'markdown',
    content:
      '<font color="grey">• 所有命令以 `/` 开头，支持随时发送\n• 流式输出期间也可执行命令\n• `/stop` 可立即中断正在生成的回复</font>',
    text_size: 'small',
  });

  // Schema 2.0 格式
  return {
    schema: '2.0',
    header: {
      title: { tag: 'plain_text', content: '📖 命令帮助' },
      template: 'blue',
    },
    body: { elements },
  };
}
