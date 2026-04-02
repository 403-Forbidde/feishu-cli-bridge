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
 *
 * @param projects - 项目列表
 * @param currentName - 当前项目名称
 * @param page - 当前页码（从1开始）
 * @param totalPages - 总页数
 * @param totalCount - 总项目数
 */
export function buildProjectListCard(
  projects: ProjectInfo[],
  currentName: string | null,
  page: number = 1,
  totalPages: number = 1,
  totalCount?: number
): FeishuCard {
  const elements: CardElement[] = [];

  // 分页配置：每页3个，最多12个（4页）
  const ITEMS_PER_PAGE = 3;
  const MAX_ITEMS = 12;
  const actualTotalCount = totalCount ?? projects.length;

  // 分页切片
  const currentPage = Math.max(1, Math.min(page, totalPages));
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, Math.min(projects.length, MAX_ITEMS));
  const paginatedProjects = projects.slice(startIndex, endIndex);

  elements.push({
    tag: 'markdown',
    content: `📁 **项目列表** (${actualTotalCount} 个)`,
  });
  elements.push({ tag: 'hr' });

  if (projects.length === 0) {
    elements.push({
      tag: 'markdown',
      content: '暂无项目，使用 `/pa <路径>` 添加已有项目，或 `/pc <路径>` 创建新项目。',
    });
  } else {
    for (let i = 0; i < paginatedProjects.length; i++) {
      const p = paginatedProjects[i];
      const marker = p.name === currentName ? ' ★' : '';
      const status = p.exists ? '✅' : '❌';

      elements.push({
        tag: 'markdown',
        content: `**${startIndex + i + 1}.** ${status} **${p.displayName}**${marker}`,
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

      if (i < paginatedProjects.length - 1) {
        elements.push({ tag: 'hr' });
      }
    }

    // 分页控件
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
              value: { action: 'project_page', page: currentPage - 1 },
              disabled: currentPage <= 1,
            }],
          },
          {
            tag: 'column',
            width: 'weighted',
            weight: 1,
            vertical_align: 'center',
            elements: [{
              tag: 'markdown',
              content: `**第 ${currentPage}/${totalPages} 页**`,
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
              value: { action: 'project_page', page: currentPage + 1 },
              disabled: currentPage >= totalPages,
            }],
          },
        ],
      });
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
      title: { tag: 'plain_text', content: '📁 项目管理' },
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
      title: { tag: 'plain_text', content: '📁 项目详情' },
      template: isCurrent ? 'green' : 'blue',
    },
    body: { elements },
  };
}
