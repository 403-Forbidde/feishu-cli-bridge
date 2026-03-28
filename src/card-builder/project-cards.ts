/**
 * Project cards builder
 * 项目卡片构建模块
 *
 * 项目管理相关的卡片构建函数
 */

import type { CardElement, FeishuCard } from './base.js';

/** 项目信息 */
export interface ProjectInfo {
  name: string;
  displayName: string;
  path: string;
  exists: boolean;
  lastActive: Date;
  description?: string;
}

/**
 * 构建项目列表卡片
 */
export function buildProjectListCard(
  projects: ProjectInfo[],
  currentName: string | null
): FeishuCard {
  const elements: CardElement[] = [];

  elements.push({
    tag: 'markdown',
    content: `📁 **项目列表**\n\n共 ${projects.length} 个项目`,
  });
  elements.push({ tag: 'hr' });

  if (projects.length === 0) {
    elements.push({
      tag: 'markdown',
      content: '暂无项目，使用 `/pa <路径>` 添加已有项目，或 `/pc <路径>` 创建新项目。',
    });
  } else {
    for (let i = 0; i < projects.length; i++) {
      const p = projects[i];
      const marker = p.name === currentName ? ' ★' : '';
      const status = p.exists ? '✅' : '❌';

      elements.push({
        tag: 'markdown',
        content: `**${i + 1}.** ${status} **${p.displayName}**${marker}`,
      });
      elements.push({
        tag: 'markdown',
        content: `标识: \`${p.name}\`\n路径: \`${p.path}\`\n活跃: ${p.lastActive.toLocaleString('zh-CN')}`,
      });

      if (p.description) {
        elements.push({
          tag: 'markdown',
          content: `描述: ${p.description}`,
        });
      }

      if (i < projects.length - 1) {
        elements.push({ tag: 'hr' });
      }
    }
  }

  elements.push({ tag: 'hr' });
  elements.push({
    tag: 'markdown',
    content: "💡 `/ps <标识>` 切换项目 · `/pi <标识>` 查看详情",
  });

  return {
    schema: '2.0',
    header: {
      title: { tag: 'plain_text', content: '项目管理' },
      template: 'blue',
    },
    body: { elements },
  };
}

/**
 * 构建项目详情卡片
 */
export function buildProjectInfoCard(
  project: ProjectInfo,
  isCurrent: boolean
): FeishuCard {
  const elements: CardElement[] = [];

  if (isCurrent) {
    elements.push({
      tag: 'markdown',
      content: '<font color="green">🟢 当前激活项目</font>',
    });
  }

  elements.push({
    tag: 'markdown',
    content: `**${project.displayName}**\n\n标识: \`${project.name}\`\n路径: \`${project.path}\``,
  });

  if (project.description) {
    elements.push({
      tag: 'markdown',
      content: `描述: ${project.description}`,
    });
  }

  elements.push({
    tag: 'markdown',
    content: `状态: ${project.exists ? '✅ 目录存在' : '❌ 目录不存在'}\n最后活跃: ${project.lastActive.toLocaleString('zh-CN')}`,
  });

  return {
    schema: '2.0',
    header: {
      title: { tag: 'plain_text', content: '项目详情' },
      template: isCurrent ? 'green' : 'blue',
    },
    body: { elements },
  };
}
