/**
 * Project cards builder
 * 项目管理卡片构建器
 *
 * 构建项目列表、项目详情等 UI 卡片（Schema 2.0 格式）
 */

import { CardColors, createCardConfig, createNoteBlock, createDivider, truncateText } from './utils.js';

/**
 * 项目信息
 */
export interface ProjectInfo {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  updatedAt?: number;
  isActive?: boolean;
  /** 版本控制信息，如 "Git (main)" 或 undefined */
  vcs?: string;
}

/**
 * 格式化时间
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

  // 大于 24 小时，显示日期
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

/**
 * 格式化完整日期时间
 */
function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

/**
 * 缩短路径显示
 */
function shortenPath(path: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (path.startsWith(home)) {
    return path.replace(home, '~');
  }
  return path;
}

/**
 * 构建项目列表卡片（Schema 2.0 格式）
 *
 * 布局：
 * 1. 顶部：当前激活项目详细信息（绿色主题）
 * 2. 中部：未激活项目列表
 *
 * @param projects - 项目列表
 * @param activeProjectId - 当前激活的项目 ID
 */
export function buildProjectListCard(
  projects: ProjectInfo[],
  activeProjectId?: string
): object {
  const elements: object[] = [];

  // 分离激活项目和其他项目
  const activeProject = projects.find(p => p.id === activeProjectId);
  const inactiveProjects = projects.filter(p => p.id !== activeProjectId);

  // ── 顶部：当前激活项目详细信息 ─────────────────────────────────────────
  if (activeProject) {
    elements.push({
      tag: 'markdown',
      content: `🟢 **当前项目**`,
    });

    // 项目名称
    elements.push({
      tag: 'markdown',
      content: `**${activeProject.name}**`,
    });

    // 表格：使用 Markdown 表格样式
    const displayId = activeProject.id.length >= 12 ? activeProject.id.slice(-12) : activeProject.id;
    const createdStr = formatDateTime(activeProject.createdAt);
    const updatedStr = activeProject.updatedAt && activeProject.updatedAt !== activeProject.createdAt
      ? formatDateTime(activeProject.updatedAt)
      : createdStr;
    const vcsText = activeProject.vcs || '未启用项目版本管理';

    elements.push({
      tag: 'markdown',
      content: `| 🆔 项目ID | 📅 创建时间 |\n| --- | --- |\n| ${displayId} | ${createdStr} |\n| 🔀 版本管理 | 📝 更新时间 |\n| ${vcsText} | ${updatedStr} |`,
    });

    // 项目路径（表格外单独一行）
    elements.push({
      tag: 'markdown',
      content: `📂 **项目路径**\n\`${shortenPath(activeProject.path)}\``,
    });

    elements.push({ tag: 'hr' });
  }

  // ── 中部：未激活项目列表 ───────────────────────────────────────────────
  elements.push({
    tag: 'markdown',
    content: `📁 **项目列表** (${inactiveProjects.length} 个)`,
  });

  if (inactiveProjects.length === 0 && !activeProject) {
    elements.push({
      tag: 'markdown',
      content: 'ℹ️ **暂无项目**\n\n使用 `/pa <路径> [名称]` 或 `/pc <路径> [名称]` 添加项目',
    });
  } else if (inactiveProjects.length === 0) {
    elements.push({
      tag: 'markdown',
      content: '<font color=\'grey\'>暂无其他项目</font>',
    });
  } else {
    for (let i = 0; i < inactiveProjects.length; i++) {
      const project = inactiveProjects[i];
      const timeStr = formatTime(project.updatedAt || project.createdAt);

      // 项目名称
      elements.push({
        tag: 'markdown',
        content: `⚪ **${project.name}**`,
      });

      // 路径和时间
      elements.push({
        tag: 'markdown',
        content: `<font color='grey'>📂</font> \`${shortenPath(project.path)}\` · ${timeStr}`,
      });

      // 操作按钮
      elements.push({
        tag: 'column_set',
        flex_mode: 'none',
        columns: [
          {
            tag: 'column',
            width: 'weighted',
            weight: 1,
            elements: [],
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
                  action: 'switch_project',
                  projectId: project.id,
                },
              },
              {
                tag: 'button',
                text: { tag: 'plain_text', content: '🗑️ 删除' },
                type: 'danger',
                value: {
                  action: 'delete_project',
                  projectId: project.id,
                },
              },
            ],
          },
        ],
      });

      if (i < inactiveProjects.length - 1) {
        elements.push({ tag: 'hr' });
      }
    }
  }

  // ── 底部提示 ─────────────────────────────────────────────────────────
  elements.push({ tag: 'hr' });
  elements.push({
    tag: 'markdown',
    content: '<font color=\'grey\'>💡 使用 `/pa <路径> [名称]` 添加项目 · `/pi` 查看当前项目详情</font>',
    text_size: 'notation',
  });

  // Schema 2.0 格式
  return {
    schema: '2.0',
    header: {
      title: { tag: 'plain_text', content: '项目管理' },
      template: 'green',
    },
    body: { elements },
  };
}

/**
 * 构建项目添加成功卡片
 */
export function buildProjectAddedCard(project: ProjectInfo): object {
  return {
    schema: '2.0',
    header: {
      title: { tag: 'plain_text', content: '✅ 项目已添加' },
      template: 'green',
    },
    body: {
      elements: [
        {
          tag: 'markdown',
          content: `**名称:** ${project.name}`,
        },
        {
          tag: 'markdown',
          content: `<font color='grey'>路径:</font> \`${shortenPath(project.path)}\``,
        },
        { tag: 'hr' },
        {
          tag: 'markdown',
          content: `💡 使用 \`/pl\` 查看项目列表，或点击切换按钮`,
        },
      ],
    },
  };
}

/**
 * 构建项目切换成功卡片
 */
export function buildProjectSwitchedCard(project: ProjectInfo): object {
  return {
    schema: '2.0',
    header: {
      title: { tag: 'plain_text', content: '✅ 项目已切换' },
      template: 'green',
    },
    body: {
      elements: [
        {
          tag: 'markdown',
          content: `**当前项目:** ${project.name}`,
        },
        {
          tag: 'markdown',
          content: `<font color='grey'>工作目录:</font> \`${shortenPath(project.path)}\``,
        },
      ],
    },
  };
}

/**
 * 构建项目删除确认卡片
 */
export function buildProjectDeletedCard(projectId: string): object {
  const displayId = projectId.length >= 8 ? projectId.slice(-8) : projectId;

  return {
    schema: '2.0',
    header: {
      title: { tag: 'plain_text', content: '🗑️ 项目已删除' },
      template: 'orange',
    },
    body: {
      elements: [
        {
          tag: 'markdown',
          content: `项目 \`${displayId}\` 已被删除`,
        },
      ],
    },
  };
}

/**
 * 构建项目信息卡片
 */
export function buildProjectInfoCard(project: ProjectInfo): object {
  const elements: object[] = [
    {
      tag: 'markdown',
      content: `**${project.name}**`,
    },
    {
      tag: 'markdown',
      content: `<font color='grey'>🆔 ID:</font> \`${project.id}\``,
    },
    {
      tag: 'markdown',
      content: `<font color='grey'>📂 路径:</font> \`${shortenPath(project.path)}\``,
    },
    { tag: 'hr' },
    {
      tag: 'markdown',
      content: `<font color='grey'>📅 创建时间:</font> ${formatDateTime(project.createdAt)}`,
    },
  ];

  if (project.updatedAt && project.updatedAt !== project.createdAt) {
    elements.push({
      tag: 'markdown',
      content: `<font color='grey'>📝 更新时间:</font> ${formatDateTime(project.updatedAt)}`,
    });
  }

  return {
    schema: '2.0',
    header: {
      title: { tag: 'plain_text', content: '📁 项目信息' },
      template: 'blue',
    },
    body: { elements },
  };
}
