/**
 * Project commands handler
 * 项目管理命令处理器
 *
 * 处理 /pa /pc /pl /ps /prm /pi 等项目命令
 */

import type { TUIResult } from './base.js';
import { TUIResultType, createTextResult, createCardResult, createErrorResult } from './base.js';
import { buildProjectListCard, buildProjectInfoCard, type ProjectInfo } from '../card-builder/index.js';

// 支持的命令前缀
const PROJECT_PREFIXES = ['/project', '/pa', '/pc', '/pl', '/ps', '/prm', '/pi'];

/** 检查是否是项目管理命令 */
export function isProjectCommand(content: string): boolean {
  for (const prefix of PROJECT_PREFIXES) {
    if (content === prefix || content.startsWith(prefix + ' ')) {
      return true;
    }
  }
  return false;
}

/** 智能分割参数（支持引号） */
function smartSplit(text: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar: string | null = null;

  for (const char of text) {
    if ((char === '"' || char === "'") && !inQuote) {
      inQuote = true;
      quoteChar = char;
    } else if (char === quoteChar && inQuote) {
      inQuote = false;
      quoteChar = null;
    } else if (/\s/.test(char) && !inQuote) {
      if (current) {
        result.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }

  if (current) {
    result.push(current);
  }

  return result;
}

/** 解析 add/create 参数 */
function parseAddArgs(args: string): { path: string; name?: string; displayName?: string } {
  const parts = smartSplit(args);
  if (parts.length === 0) {
    return { path: '' };
  }

  const path = parts[0];
  let name: string | undefined;
  let displayName: string | undefined;

  const isValidName = (s: string): boolean => /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(s);
  const hasChinese = (s: string): boolean => /[\u4e00-\u9fff]/.test(s);

  if (parts.length >= 2) {
    const second = parts[1];
    if (hasChinese(second)) {
      displayName = second;
    } else if (isValidName(second)) {
      name = second;
      if (parts.length >= 3) {
        displayName = parts[2];
      }
    } else {
      displayName = second;
    }
  }

  return { path, name, displayName };
}

/** 格式化时间 */
function formatTime(date: Date): string {
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 项目命令执行结果 */
export interface ProjectCommandResult {
  type: 'list' | 'add' | 'create' | 'switch' | 'remove' | 'info' | 'help' | 'error';
  result: TUIResult;
  projectName?: string;
}

/**
 * 解析并执行项目命令
 *
 * 注意：这是一个简化版本，实际实现需要与 ProjectManager 集成
 */
export function executeProjectCommand(
  content: string,
  projects: ProjectInfo[],
  currentProjectName: string | null,
  page: number = 1
): ProjectCommandResult {
  content = content.trim();

  // 展开快捷命令 → 标准子命令
  const cmdMap: Record<string, string> = {
    '/pa': 'add',
    '/pc': 'create',
    '/pl': 'list',
    '/ps': 'switch',
    '/prm': 'remove',
    '/pi': 'info',
  };

  let subCmd = '';
  let args = '';

  let matchedShortcut = false;
  for (const [shortcut, sub] of Object.entries(cmdMap)) {
    if (content === shortcut || content.startsWith(shortcut + ' ')) {
      subCmd = sub;
      args = content.slice(shortcut.length).trim();
      matchedShortcut = true;
      break;
    }
  }

  if (!matchedShortcut) {
    // /project <sub> <args>
    const rest = content.slice('/project'.length).trim();
    const parts = rest.split(/\s+/);
    if (parts.length === 0 || !parts[0]) {
      return { type: 'help', result: createTextResult(getHelpText()) };
    }

    const subCmdAliases: Record<string, string> = {
      add: 'add',
      a: 'add',
      create: 'create',
      c: 'create',
      new: 'create',
      list: 'list',
      l: 'list',
      ls: 'list',
      switch: 'switch',
      s: 'switch',
      sw: 'switch',
      remove: 'remove',
      rm: 'remove',
      info: 'info',
      i: 'info',
      help: 'help',
      h: 'help',
    };

    subCmd = subCmdAliases[parts[0].toLowerCase()] || 'unknown';
    args = parts.slice(1).join(' ');
  }

  // 分页配置：每页3个，最多12个（4页）
  const ITEMS_PER_PAGE = 3;
  const MAX_ITEMS = 12;
  const totalPages = Math.ceil(Math.min(projects.length, MAX_ITEMS) / ITEMS_PER_PAGE) || 1;
  const currentPage = Math.max(1, Math.min(page, totalPages));

  switch (subCmd) {
    case 'list':
      return {
        type: 'list',
        result: createCardResult('', {
          cardJson: buildProjectListCard(
            projects,
            currentProjectName,
            currentPage,
            totalPages,
            projects.length
          ),
        }),
      };

    case 'add':
    case 'create':
      if (!args) {
        const hint = subCmd === 'add' ? '/pa <路径> <项目名称>' : '/pc <路径> <项目名称>';
        return {
          type: 'error',
          result: createErrorResult(`请提供路径。用法: \`${hint}\``),
        };
      }
      // 简化处理，实际应该调用 ProjectManager
      return {
        type: subCmd,
        result: createTextResult(`⏳ ${subCmd === 'add' ? '添加' : '创建'}项目功能待实现\n\n参数: ${args}`),
      };

    case 'switch':
      if (!args) {
        return {
          type: 'error',
          result: createErrorResult('请提供项目名称。用法: `/ps <标识>`'),
        };
      }
      return {
        type: 'switch',
        projectName: args.split(/\s+/)[0],
        result: createTextResult(`✅ 切换项目命令已接收: ${args}`),
      };

    case 'remove':
      if (!args) {
        return {
          type: 'error',
          result: createErrorResult('请提供项目名称。用法: `/prm <标识>`'),
        };
      }
      return {
        type: 'remove',
        result: createTextResult(`🗑️ 移除项目命令已接收: ${args}`),
      };

    case 'info':
      {
        const name = args ? args.split(/\s+/)[0] : currentProjectName;
        if (!name) {
          return {
            type: 'info',
            result: createTextResult('当前没有激活的项目。使用 `/pa <路径>` 添加项目。'),
          };
        }
        const project = projects.find((p) => p.name === name);
        if (!project) {
          return {
            type: 'error',
            result: createErrorResult(`项目 '${name}' 不存在。使用 \`/pl\` 查看所有项目。`),
          };
        }
        const isCurrent = project.name === currentProjectName;
        return {
          type: 'info',
          result: createCardResult('', { cardJson: buildProjectInfoCard(project, isCurrent) }),
        };
      }

    case 'help':
    default:
      return { type: 'help', result: createTextResult(getHelpText()) };
  }
}

/** 获取帮助文本 */
function getHelpText(): string {
  return `📁 **项目管理命令**

**快捷命令:**
\`/pa <路径> <项目名称>\` — 添加已有目录为项目
\`/pc <路径> <项目名称>\` — 创建新目录并添加为项目
\`/pl\` — 列出所有项目
\`/ps <标识>\` — 切换到指定项目
\`/prm <标识>\` — 从列表移除项目（不删除目录）
\`/pi [标识]\` — 查看项目信息（省略标识则查看当前项目）

**示例:**
\`\`\`
/pa ~/code/my-app myapp
/pc ~/code/new-project myproject
/pl
/ps myapp
/prm myapp
\`\`\`

**说明:**
• 标识：英文字母/数字/下划线/连字符，用于命令参数
• 显示名：可以是中文，用于展示（第二参数为中文时自动识别）
• 切换项目后，AI 对话将在对应目录下执行
`;
}
