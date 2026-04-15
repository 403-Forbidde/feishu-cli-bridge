/**
 * Command Processor
 * 命令处理器
 *
 * 处理 TUI 命令（如 /new, /session, /model 等）和项目命令
 * 协调适配器、会话管理和项目管理
 */

import { logger } from '../../core/logger.js';
import type { FeishuAPI } from '../feishu-api.js';
import type { FeishuMessage } from '../types.js';
import type { ICLIAdapter, SessionInfo, ModelInfo } from '../../adapters/interface/types.js';
import type { SessionManager } from '../../session/manager.js';
import type { ProjectManager } from '../../project/manager.js';
import { buildSessionListCard } from '../cards/session-cards.js';
import { buildProjectListCard, buildProjectInfoCard } from '../cards/project-cards.js';
import { buildHelpCard } from '../cards/help-card.js';
import { buildSuccessCard, buildInfoCard, buildWarningCard } from '../cards/result-cards.js';
import { buildErrorCard } from '../cards/error.js';
import { buildModeSelectCard, buildModelSelectCard } from '../../card-builder/interactive-cards.js';

/**
 * 命令处理器选项
 */
export interface CommandProcessorOptions {
  /** 飞书 API 实例 */
  feishuAPI: FeishuAPI;
  /** 会话管理器 */
  sessionManager: SessionManager;
  /** 项目管理器 */
  projectManager: ProjectManager;
  /** 适配器映射 */
  adapters: Map<string, ICLIAdapter>;
  /** 默认适配器类型 */
  defaultAdapterType: string;
}

/**
 * 命令上下文
 */
interface CommandContext {
  /** 用户 ID */
  userId: string;
  /** 聊天 ID */
  chatId: string;
  /** 消息 ID */
  messageId: string;
  /** 当前适配器类型 */
  adapterType: string;
  /** 当前工作目录 */
  workingDir: string;
}

/**
 * 命令处理器
 *
 * 处理所有 TUI 命令和项目管理命令
 */
export class CommandProcessor {
  private feishuAPI: FeishuAPI;
  private sessionManager: SessionManager;
  private projectManager: ProjectManager;
  private adapters: Map<string, ICLIAdapter>;
  private defaultAdapterType: string;

  constructor(options: CommandProcessorOptions) {
    this.feishuAPI = options.feishuAPI;
    this.sessionManager = options.sessionManager;
    this.projectManager = options.projectManager;
    this.adapters = options.adapters;
    this.defaultAdapterType = options.defaultAdapterType;
  }

  /**
   * 处理 TUI 命令
   * @param message - 飞书消息
   * @param command - 命令名称
   * @param args - 命令参数
   */
  async processTUICommand(
    message: FeishuMessage,
    command: string,
    args: string[]
  ): Promise<void> {
    const context = await this.buildContext(message);

    // 检查适配器是否支持该命令
    const adapter = this.adapters.get(context.adapterType);
    const supportedCommands = adapter?.getSupportedTUICommands?.() || ['new', 'session', 'model', 'reset', 'help'];
    const commandName = command.slice(1);
    if (!supportedCommands.includes(commandName)) {
      await this.feishuAPI.sendCardMessage(
        context.chatId,
        buildErrorCard(`命令 ${command} 不被 ${context.adapterType} 支持`, 'invalid_request')
      );
      return;
    }

    logger.info({ command, args: args.join(' '), userId: context.userId }, '处理 TUI 命令');

    try {
      switch (command) {
        case '/new':
          await this.handleNewSession(context, args);
          break;
        case '/session':
          await this.handleSessionList(context, args);
          break;
        case '/model':
          await this.handleModelCommand(context, args);
          break;
        case '/mode':
          await this.handleModeCommand(context, args);
          break;
        case '/reset':
        case '/clear':
          await this.handleResetSession(context);
          break;
        case '/rename':
          await this.handleRenameSession(context, args);
          break;
        case '/delete':
          await this.handleDeleteSession(context, args);
          break;
        default:
          await this.feishuAPI.sendCardMessage(
            context.chatId,
            buildErrorCard(`未知命令: ${command}`, 'invalid_request')
          );
      }
    } catch (error) {
      logger.error({ error, command }, '处理 TUI 命令时出错');
      await this.feishuAPI.sendCardMessage(
        context.chatId,
        buildErrorCard(
          `命令执行失败: ${error instanceof Error ? error.message : '未知错误'}`,
          'default'
        )
      );
    }
  }

  /**
   * 处理项目命令
   * @param message - 飞书消息
   * @param subcommand - 子命令
   * @param args - 命令参数
   */
  async processProjectCommand(
    message: FeishuMessage,
    subcommand: string,
    args: string[]
  ): Promise<void> {
    const context = await this.buildContext(message);

    logger.info({ subcommand, args: args.join(' '), userId: context.userId }, '处理项目命令');

    try {
      switch (subcommand) {
        case '/pa':
          await this.handleAddProject(context, args);
          break;
        case '/pc':
          await this.handleCreateProject(context, args);
          break;
        case '/pl':
          await this.handleListProjects(context);
          break;
        case '/ps':
          await this.handleSwitchProject(context, args);
          break;
        case '/pi':
          await this.handleProjectInfo(context);
          break;
        case '/pd':
          await this.handleDeleteProject(context, args);
          break;
        default:
          await this.feishuAPI.sendCardMessage(
            context.chatId,
            buildErrorCard(`未知项目命令: ${subcommand}`, 'invalid_request')
          );
      }
    } catch (error) {
      logger.error({ error, subcommand }, '处理项目命令时出错');
      await this.feishuAPI.sendCardMessage(
        context.chatId,
        buildErrorCard(
          `项目命令执行失败: ${error instanceof Error ? error.message : '未知错误'}`,
          'default'
        )
      );
    }
  }

  /**
   * 处理帮助命令
   * @param message - 飞书消息
   */
  async processHelp(message: FeishuMessage): Promise<void> {
    const context = await this.buildContext(message);

    // 获取当前项目信息
    const currentProject = await this.projectManager.getCurrentProject();

    // 构建帮助卡片
    const card = buildHelpCard(currentProject, context.adapterType);
    await this.feishuAPI.sendCardMessage(context.chatId, card);
  }

  // ============ 会话命令处理 ============

  /**
   * 处理 /new - 创建新会话
   */
  private async handleNewSession(context: CommandContext, _args: string[]): Promise<void> {
    const adapter = this.adapters.get(context.adapterType);
    if (!adapter) {
      await this.feishuAPI.sendCardMessage(
        context.chatId,
        buildErrorCard(`适配器 ${context.adapterType} 不可用`, 'server')
      );
      return;
    }

    // 调用适配器创建新会话
    const sessionInfo = await adapter.createNewSession(context.workingDir);

    if (sessionInfo) {
      // 清空本地会话历史
      this.sessionManager.clearHistory(context.userId);

      const displayId = sessionInfo.id.length > 8 ? sessionInfo.id.slice(-8) : sessionInfo.id;
      await this.feishuAPI.sendCardMessage(
        context.chatId,
        buildSuccessCard(
          '✅ 已创建新会话',
          `**${sessionInfo.title}**`,
          [{ key: '🆔 会话ID', value: `\`${displayId}\`` }],
          '新消息将在此会话中继续对话'
        )
      );
    } else {
      // 适配器不支持或创建失败，只清空本地历史
      this.sessionManager.clearHistory(context.userId);
      await this.feishuAPI.sendCardMessage(
        context.chatId,
        buildSuccessCard('✅ 已重置', '会话历史已清空', [], '可以开始新的对话了')
      );
    }
  }

  /**
   * 处理 /session - 会话列表
   */
  private async handleSessionList(context: CommandContext, args: string[]): Promise<void> {
    const adapter = this.adapters.get(context.adapterType);
    if (!adapter) {
      await this.feishuAPI.sendCardMessage(
        context.chatId,
        buildErrorCard(`适配器 ${context.adapterType} 不可用`, 'server')
      );
      return;
    }

    // 如果有参数，尝试切换会话
    if (args.length > 0) {
      const sessionId = args[0];
      const success = await adapter.switchSession(sessionId, context.workingDir);

      if (success) {
        // 清空本地历史（切换会话后需要重新加载）
        this.sessionManager.clearHistory(context.userId);
        const displayId = sessionId.length > 8 ? sessionId.slice(-8) : sessionId;
        await this.feishuAPI.sendCardMessage(
          context.chatId,
          buildSuccessCard(
            '✅ 切换成功',
            '已切换到会话',
            [{ key: '🆔 会话ID', value: `\`${displayId}\`` }],
            '可以继续之前的对话了'
          )
        );
      } else {
        await this.feishuAPI.sendCardMessage(
          context.chatId,
          buildErrorCard(`无法切换到会话: ${sessionId}`, 'invalid_request')
        );
      }
      return;
    }

    // 列出当前工作目录的会话（最多10条，支持分页）
    const allSessions = await adapter.listSessions(10, context.workingDir);

    // 分页：每页5条，最多2页（10条）
    const pageSize = 5;
    const totalPages = Math.ceil(allSessions.length / pageSize) || 1;
    const currentPage = 1; // 默认显示第一页
    const sessions = allSessions.slice(0, pageSize);

    // 获取当前会话 ID（适配器可能未实现此方法）
    const currentSessionId = adapter.getSessionId?.(context.workingDir) ?? undefined;

    const card = buildSessionListCard(
      sessions,
      currentSessionId,
      currentPage,
      totalPages,
      context.adapterType,
      context.workingDir,
      undefined,
      allSessions.length
    );
    await this.feishuAPI.sendCardMessage(context.chatId, card);
  }

  /**
   * 处理 /model - 模型管理
   */
  private async handleModelCommand(context: CommandContext, args: string[]): Promise<void> {
    const adapter = this.adapters.get(context.adapterType);
    if (!adapter) {
      await this.feishuAPI.sendCardMessage(
        context.chatId,
        buildErrorCard(`适配器 ${context.adapterType} 不可用`, 'server')
      );
      return;
    }

    // 如果有参数，尝试切换模型
    if (args.length > 0) {
      const modelId = args[0];
      const success = await adapter.switchModel(modelId);

      if (success) {
        await this.feishuAPI.sendCardMessage(
          context.chatId,
          buildSuccessCard(
            '✅ 切换成功',
            '已切换到模型',
            [{ key: '🤖 模型', value: `\`${modelId}\`` }],
            '新消息将使用此模型'
          )
        );
      } else if (context.adapterType === 'claude') {
        // Claude Code 的模型由本地配置决定，适配器无法直接切换
        await this.feishuAPI.sendCardMessage(
          context.chatId,
          buildInfoCard(
            'ℹ️ Claude Code 模型切换说明',
            'Claude Code 的模型由其本地配置（`~/.claude/settings.json` 中的 `ANTHROPIC_BASE_URL`）决定，bridge 无法直接切换。\n\n如需更改模型，请修改本地配置后重启 bridge。',
            'grey'
          )
        );
      } else {
        await this.feishuAPI.sendCardMessage(
          context.chatId,
          buildErrorCard(`无法切换到模型: ${modelId}`, 'invalid_request')
        );
      }
      return;
    }

    // 列出模型 - 使用交互式卡片
    const models = await adapter.listModels();
    const currentModel = adapter.getCurrentModel();

    const card = buildModelSelectCard(
      models.map((m) => ({ ...m, fullId: m.id })),
      currentModel,
      context.adapterType
    );
    await this.feishuAPI.sendCardMessage(context.chatId, card);
  }

  /**
   * 处理 /mode - 模式/Agent 切换
   */
  private async handleModeCommand(context: CommandContext, args: string[]): Promise<void> {
    const adapter = this.adapters.get(context.adapterType);
    if (!adapter) {
      await this.feishuAPI.sendCardMessage(
        context.chatId,
        buildErrorCard(`适配器 ${context.adapterType} 不可用`, 'server')
      );
      return;
    }

    // 通用能力检测：适配器是否支持 Agent 模式切换
    const agentAdapter = adapter as unknown as {
      listAgents?(): Promise<Array<{ id: string; name?: string; description?: string; color?: string }>>;
      switchAgent?(agentId: string): Promise<boolean>;
      getCurrentAgent?(workingDir?: string): Promise<string>;
    };

    if (
      typeof agentAdapter.listAgents !== 'function' ||
      typeof agentAdapter.switchAgent !== 'function'
    ) {
      await this.feishuAPI.sendCardMessage(
        context.chatId,
        buildErrorCard(`适配器 ${context.adapterType} 不支持 Agent 模式切换`, 'invalid_request')
      );
      return;
    }

    // 如果有参数，尝试切换模式
    if (args.length > 0) {
      const agentId = args[0];
      const success = await agentAdapter.switchAgent!(agentId);
      if (success) {
        await this.feishuAPI.sendCardMessage(
          context.chatId,
          buildSuccessCard(
            '✅ 切换成功',
            '已切换到模式',
            [{ key: '🎯 模式', value: `\`${agentId}\`` }],
            '新消息将使用此 Agent 模式'
          )
        );
      } else {
        await this.feishuAPI.sendCardMessage(
          context.chatId,
          buildErrorCard(`无法切换到模式: ${agentId}`, 'invalid_request')
        );
      }

      // 切换后显示模式列表
      const agents = await agentAdapter.listAgents!();
      const current = agentAdapter.getCurrentAgent ? await agentAdapter.getCurrentAgent(context.workingDir) : agentId;
      const card = buildModeSelectCard(
        agents.map((a) => ({ name: a.id, displayName: a.name, description: a.description, color: a.color })),
        current,
        context.adapterType
      );
      await this.feishuAPI.sendCardMessage(context.chatId, card);
      return;
    }

    // 列出可用模式
    const agents = await agentAdapter.listAgents!();
    if (!agents || agents.length === 0) {
      await this.feishuAPI.sendCardMessage(
        context.chatId,
        buildInfoCard('ℹ️ 提示', '暂无可用 Agent 模式')
      );
      return;
    }

    const current = agentAdapter.getCurrentAgent ? await agentAdapter.getCurrentAgent(context.workingDir) : '';
    const card = buildModeSelectCard(
      agents.map((a) => ({ name: a.id, displayName: a.name, description: a.description, color: a.color })),
      current,
      context.adapterType
    );
    await this.feishuAPI.sendCardMessage(context.chatId, card);
  }

  /**
   * 处理 /reset 或 /clear - 重置会话
   */
  private async handleResetSession(context: CommandContext): Promise<void> {
    const adapter = this.adapters.get(context.adapterType);

    // 调用适配器重置
    if (adapter) {
      await adapter.resetSession();
    }

    // 清空本地历史
    this.sessionManager.clearHistory(context.userId);

    await this.feishuAPI.sendCardMessage(
      context.chatId,
      buildSuccessCard('✅ 已重置', '会话已重置，历史已清空', [], '可以开始新的对话了')
    );
  }

  /**
   * 处理 /rename - 重命名会话
   */
  private async handleRenameSession(context: CommandContext, args: string[]): Promise<void> {
    if (args.length === 0) {
      await this.feishuAPI.sendCardMessage(
        context.chatId,
        buildErrorCard('请提供新名称，例如: `/rename 我的新会话`', 'invalid_request')
      );
      return;
    }

    const adapter = this.adapters.get(context.adapterType);
    if (!adapter) {
      await this.feishuAPI.sendCardMessage(
        context.chatId,
        buildErrorCard(`适配器 ${context.adapterType} 不可用`, 'server')
      );
      return;
    }

    const newTitle = args.join(' ');

    // 获取当前会话 ID（这里简化处理，实际需要跟踪当前会话）
    // TODO: 需要从 SessionManager 获取当前会话 ID
    await this.feishuAPI.sendCardMessage(
      context.chatId,
      buildWarningCard('功能暂不可用', '重命名功能需要当前会话 ID 支持，敬请期待')
    );
  }

  /**
   * 处理 /delete - 删除会话
   */
  private async handleDeleteSession(context: CommandContext, args: string[]): Promise<void> {
    if (args.length === 0) {
      await this.feishuAPI.sendCardMessage(
        context.chatId,
        buildErrorCard('请提供会话 ID，例如: `/delete sess_xxx`', 'invalid_request')
      );
      return;
    }

    const adapter = this.adapters.get(context.adapterType);
    if (!adapter) {
      await this.feishuAPI.sendCardMessage(
        context.chatId,
        buildErrorCard(`适配器 ${context.adapterType} 不可用`, 'server')
      );
      return;
    }

    const sessionId = args[0];
    const success = await adapter.deleteSession(sessionId);

    if (success) {
      const displayId = sessionId.length > 8 ? sessionId.slice(-8) : sessionId;
      await this.feishuAPI.sendCardMessage(
        context.chatId,
        buildSuccessCard('✅ 删除成功', '已删除会话', [{ key: '🆔 会话ID', value: `\`${displayId}\`` }])
      );
    } else {
      await this.feishuAPI.sendCardMessage(
        context.chatId,
        buildErrorCard(`无法删除会话: ${sessionId}`, 'invalid_request')
      );
    }
  }

  // ============ 项目命令处理 ============

  /**
   * 处理 /pa - 添加项目
   */
  private async handleAddProject(context: CommandContext, args: string[]): Promise<void> {
    if (args.length === 0) {
      await this.feishuAPI.sendCardMessage(
        context.chatId,
        buildErrorCard('请提供项目路径，例如: `/pa /path/to/project 我的项目`', 'invalid_request')
      );
      return;
    }

    const projectPath = args[0];
    const projectName = args.slice(1).join(' ') || undefined;

    try {
      const project = await this.projectManager.addProject(projectPath, projectName);
      await this.feishuAPI.sendCardMessage(
        context.chatId,
        buildSuccessCard(
          '✅ 项目已添加',
          `**${project.displayName}**`,
          [
            { key: '📂 路径', value: `\`${project.path}\`` },
            { key: '🆔 项目ID', value: `\`${project.id}\`` },
          ],
          '使用 `/ps <标识>` 切换到该项目'
        )
      );
    } catch (error) {
      await this.feishuAPI.sendCardMessage(
        context.chatId,
        buildErrorCard(
          `添加项目失败: ${error instanceof Error ? error.message : '未知错误'}`,
          'default'
        )
      );
    }
  }

  /**
   * 处理 /pc - 创建项目
   */
  private async handleCreateProject(context: CommandContext, args: string[]): Promise<void> {
    // 目前与 /pa 相同，只是语义上的区别
    await this.handleAddProject(context, args);
  }

  /**
   * 处理 /pl - 列出项目
   */
  private async handleListProjects(context: CommandContext, page: number = 1): Promise<void> {
    const projects = await this.projectManager.listProjects();
    const currentProject = await this.projectManager.getCurrentProject();

    // 分页配置：每页3个，最多12个（4页）
    const ITEMS_PER_PAGE = 3;
    const MAX_ITEMS = 12;
    const totalCount = projects.length;

    // 转换为 ProjectInfo 格式（并行获取每个项目的 VCS 信息，最多处理 MAX_ITEMS 个）
    const limitedProjects = projects.slice(0, MAX_ITEMS);
    const projectInfos = await Promise.all(
      limitedProjects.map(async (p) => ({
        id: p.id,
        name: p.displayName || p.name,
        path: p.path,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        isActive: p.id === currentProject?.id,
        vcs: await this.projectManager.getVCSInfo(p.path),
      }))
    );

    const totalPages = Math.ceil(projectInfos.length / ITEMS_PER_PAGE) || 1;
    const currentPage = Math.max(1, Math.min(page, totalPages));

    const card = buildProjectListCard(
      projectInfos,
      currentProject?.id,
      currentPage,
      totalPages,
      totalCount
    );
    await this.feishuAPI.sendCardMessage(context.chatId, card);
  }

  /**
   * 处理 /ps - 切换项目
   */
  private async handleSwitchProject(context: CommandContext, args: string[]): Promise<void> {
    if (args.length === 0) {
      await this.feishuAPI.sendCardMessage(
        context.chatId,
        buildErrorCard('请提供项目 ID 或名称，例如: `/ps my-project`', 'invalid_request')
      );
      return;
    }

    const identifier = args[0];
    const success = await this.projectManager.switchProject(identifier);

    if (success) {
      const project = await this.projectManager.getCurrentProject();
      await this.feishuAPI.sendCardMessage(
        context.chatId,
        buildSuccessCard(
          '✅ 切换成功',
          `已切换到项目: **${project?.displayName || identifier}**`,
          project?.path ? [{ key: '📂 路径', value: `\`${project.path}\`` }] : undefined,
          '新消息将在此项目的工作目录下执行'
        )
      );
    } else {
      await this.feishuAPI.sendCardMessage(
        context.chatId,
        buildErrorCard(`未找到项目: ${identifier}`, 'invalid_request')
      );
    }
  }

  /**
   * 处理 /pi - 项目信息
   */
  private async handleProjectInfo(context: CommandContext): Promise<void> {
    const currentProject = await this.projectManager.getCurrentProject();

    if (!currentProject) {
      await this.feishuAPI.sendCardMessage(
        context.chatId,
        buildInfoCard(
          '📂 当前未选择项目',
          '没有激活的项目',
          'grey',
          '使用 `/pl` 查看项目列表，或 `/pa <路径>` 添加项目'
        )
      );
      return;
    }

    // 转换为 ProjectInfo 格式
    const projectInfo = {
      id: currentProject.id,
      name: currentProject.displayName || currentProject.name,
      path: currentProject.path,
      createdAt: currentProject.createdAt,
      updatedAt: currentProject.updatedAt,
      isActive: true,
    };

    const card = buildProjectInfoCard(projectInfo);
    await this.feishuAPI.sendCardMessage(context.chatId, card);
  }

  /**
   * 处理 /pd - 删除项目
   */
  private async handleDeleteProject(context: CommandContext, args: string[]): Promise<void> {
    if (args.length === 0) {
      await this.feishuAPI.sendCardMessage(
        context.chatId,
        buildErrorCard('请提供项目 ID 或名称，例如: `/pd my-project`', 'invalid_request')
      );
      return;
    }

    const identifier = args[0];
    const success = await this.projectManager.deleteProject(identifier);

    if (success) {
      await this.feishuAPI.sendCardMessage(
        context.chatId,
        buildSuccessCard('✅ 删除成功', `已删除项目: **${identifier}**`)
      );
    } else {
      await this.feishuAPI.sendCardMessage(
        context.chatId,
        buildErrorCard(`未找到项目: ${identifier}`, 'invalid_request')
      );
    }
  }

  // ============ 辅助方法 ============

  /**
   * 构建命令上下文
   */
  private async buildContext(message: FeishuMessage): Promise<CommandContext> {
    const session = this.sessionManager.getOrCreate(
      message.senderId,
      this.defaultAdapterType,
      await this.projectManager.getCurrentWorkingDir()
    );

    return {
      userId: message.senderId,
      chatId: message.chatId,
      messageId: message.messageId,
      adapterType: session.cliType,
      workingDir: session.workingDir,
    };
  }
}

/**
 * 创建命令处理器实例
 */
export function createCommandProcessor(
  options: CommandProcessorOptions
): CommandProcessor {
  return new CommandProcessor(options);
}
