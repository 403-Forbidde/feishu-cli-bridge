/**
 * Project cards builder
 * 项目管理卡片构建器
 *
 * 构建项目列表、项目详情等 UI 卡片
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
}

/**
 * 构建项目列表卡片
 *
 * @param projects - 项目列表
 * @param activeProjectId - 当前激活的项目 ID
 */
export function buildProjectListCard(
  projects: ProjectInfo[],
  activeProjectId?: string
): object {
  const elements: object[] = [];

  // 标题
  elements.push({
    tag: 'div',
    text: {
      tag: 'plain_text',
      content: '📁 项目列表',
    },
  });
  elements.push(createNoteBlock(`共 ${projects.length} 个项目`));
  elements.push(createDivider());

  if (projects.length === 0) {
    elements.push({
      tag: 'div',
      text: {
        tag: 'plain_text',
        content: '暂无项目，使用 /project add <路径> 添加',
      },
    });
  } else {
    // 项目列表
    for (const project of projects) {
      const isActive = project.id === activeProjectId;
      const timeStr = formatTime(project.updatedAt || project.createdAt);

      elements.push({
        tag: 'div',
        text: {
          tag: 'plain_text',
          content: `${isActive ? '🟢 ' : '⚪ '}${project.name}`,
        },
      });
      elements.push(createNoteBlock(`📂 ${truncateText(project.path, 30)} · ${timeStr}`));

      // 操作按钮
      const actions: object[] = [
        {
          tag: 'button',
          text: {
            tag: 'plain_text',
            content: isActive ? '当前' : '切换',
          },
          type: isActive ? 'primary' : 'default',
          value: {
            action: 'switch_project',
            projectId: project.id,
          },
          disabled: isActive,
        },
        {
          tag: 'button',
          text: {
            tag: 'plain_text',
            content: '删除',
          },
          type: 'danger',
          value: {
            action: 'delete_project',
            projectId: project.id,
          },
        },
      ];

      elements.push({
        tag: 'action',
        actions,
      });

      elements.push(createDivider());
    }
  }

  // 快捷命令提示
  elements.push(createNoteBlock('快捷命令: /project add <路径> - 添加项目 | /project switch <id> - 切换项目'));

  return {
    schema: '2.0',
    config: createCardConfig(),
    header: {
      title: {
        tag: 'plain_text',
        content: '项目管理',
      },
      template: CardColors.DEFAULT,
    },
    body: {
      elements,
    },
  };
}

/**
 * 构建项目添加成功卡片
 */
export function buildProjectAddedCard(project: ProjectInfo): object {
  return {
    schema: '2.0',
    config: createCardConfig(),
    header: {
      title: {
        tag: 'plain_text',
        content: '✅ 项目已添加',
      },
      template: CardColors.SUCCESS,
    },
    body: {
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'plain_text',
            content: `名称: ${project.name}`,
          },
        },
        createNoteBlock(`路径: ${project.path}`),
        createDivider(),
        {
          tag: 'div',
          text: {
            tag: 'plain_text',
            content: '💡 使用 /project switch ' + project.id.slice(0, 8) + ' 切换到该项目',
          },
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
    config: createCardConfig(),
    header: {
      title: {
        tag: 'plain_text',
        content: '✅ 项目已切换',
      },
      template: CardColors.SUCCESS,
    },
    body: {
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'plain_text',
            content: `当前项目: ${project.name}`,
          },
        },
        createNoteBlock(`工作目录: ${project.path}`),
      ],
    },
  };
}

/**
 * 构建项目删除确认卡片
 */
export function buildProjectDeletedCard(projectId: string): object {
  return {
    schema: '2.0',
    config: createCardConfig(),
    header: {
      title: {
        tag: 'plain_text',
        content: '🗑️ 项目已删除',
      },
      template: CardColors.WARNING,
    },
    body: {
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'plain_text',
            content: `项目 ${projectId.slice(0, 8)}... 已被删除`,
          },
        },
      ],
    },
  };
}

/**
 * 构建项目信息卡片
 */
export function buildProjectInfoCard(project: ProjectInfo): object {
  return {
    schema: '2.0',
    config: createCardConfig(),
    header: {
      title: {
        tag: 'plain_text',
        content: '📁 项目信息',
      },
      template: CardColors.DEFAULT,
    },
    body: {
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'plain_text',
            content: `名称: ${project.name}`,
          },
        },
        createNoteBlock(`ID: ${project.id}`),
        createNoteBlock(`路径: ${project.path}`),
        createDivider(),
        createNoteBlock(`创建时间: ${new Date(project.createdAt).toLocaleString('zh-CN')}`),
      ],
    },
  };
}
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
