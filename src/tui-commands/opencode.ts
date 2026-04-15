/**
 * OpenCode TUI Commands
 * OpenCode TUI 命令实现 (v0.3.0)
 *
 * 实现 OpenCode CLI 专用的 TUI 命令
 * 从 v0.3.0 开始，会话管理完全委托给 OpenCode 服务器
 */

import type { TUIResult, CommandContext } from './base.js';
import { TUIBaseCommand, TUIResultType, createCardResult, createErrorResult } from './base.js';
import type { ICLIAdapter, SessionInfo, ModelInfo, AgentInfo } from '../adapters/interface/types.js';
import {
  buildNewSessionCard,
  buildSessionListCard,
  buildSessionInfoCard,
  buildModelSelectCard,
  buildModeSelectCard,
  buildResetSuccessCard,
  buildHelpCard,
} from '../card-builder/index.js';
import { buildSuccessCard, buildInfoCard } from '../platform/cards/result-cards.js';

/** OpenCode 适配器扩展接口 */
interface OpenCodeAdapter extends ICLIAdapter {
  createNewSession(workingDir?: string): Promise<SessionInfo | null>;
  listSessions(limit?: number, directory?: string): Promise<SessionInfo[]>;
  switchSession(sessionId: string, workingDir?: string): Promise<boolean>;
  renameSession(sessionId: string, title: string): Promise<boolean>;
  deleteSession(sessionId: string): Promise<boolean>;
  resetSession(): Promise<boolean>;
  listModels(provider?: string): Promise<ModelInfo[]>;
  switchModel(modelId: string): Promise<boolean>;
  listAgents?(): Promise<AgentInfo[]>;
  switchAgent?(agentId: string): Promise<boolean>;
  getCurrentAgent?(): string;
  getSessionId(workingDir: string): string | null;
  getSessionDetail?(sessionId: string): Promise<Record<string, unknown> | null>;
}

/**
 * 路径相等检查（规范化后比较）
 */
function pathsEqual(a: string, b: string): boolean {
  // 简单的路径规范化比较
  const normalize = (p: string) => p.replace(/\\/g, '/').replace(/\/$/, '');
  return normalize(a) === normalize(b);
}

/**
 * OpenCode TUI 命令实现类
 *
 * 支持命令:
 * - /new: 新建会话（在 OpenCode 创建）
 * - /session: 列出当前项目的会话（从 OpenCode 获取，按 directory 过滤）
 * - /session rename <ID> <名称>: 重命名会话
 * - /session delete <ID>: 删除会话
 * - /model: 列出或切换模型
 * - /mode: 列出或切换 agent 模式
 * - /reset: 重置当前会话
 */
export class OpenCodeTUICommands extends TUIBaseCommand {
  protected adapter: OpenCodeAdapter;
  protected logger: Console;

  constructor(adapter: OpenCodeAdapter, logger?: Console) {
    super(adapter, logger);
    this.adapter = adapter;
    this.logger = logger || console;
  }

  get supportedCommands(): string[] {
    return ['new', 'session', 'model', 'mode', 'reset', 'help'];
  }

  async execute(
    command: string,
    args: string | undefined,
    context: CommandContext
  ): Promise<TUIResult> {
    switch (command) {
      case 'new':
        return await this.handleNew(context);
      case 'session':
        return await this.handleSession(args, context);
      case 'model':
        return await this.handleModel(args, context);
      case 'mode':
        return await this.handleMode(args, context);
      case 'reset':
        return await this.handleReset(context);
      case 'help':
        return await this.handleHelp(context);
      default:
        return createErrorResult(`未知命令: ${command}`);
    }
  }

  // ── /new ─────────────────────────────────────────────────────────────────

  private async handleNew(context: CommandContext): Promise<TUIResult> {
    try {
      const sessionInfo = await this.adapter.createNewSession(context.workingDir);
      if (!sessionInfo) {
        return createErrorResult('创建会话失败: OpenCode 未返回会话信息');
      }

      const card = buildNewSessionCard({
        sessionId: sessionInfo.id,
        sessionTitle: sessionInfo.title || '',
        workingDir: context.workingDir,
        model: context.currentModel,
        cliType: context.cliType,
        projectName: context.projectName,
        projectDisplayName: context.projectDisplayName,
        slug: sessionInfo.slug,
      });

      return createCardResult('', { cardJson: card });
    } catch (e) {
      this.logger.error('创建会话失败:', e);
      return createErrorResult(`创建会话失败: ${e}`);
    }
  }

  // ── /session ──────────────────────────────────────────────────────────────

  private async handleSession(
    args: string | undefined,
    context: CommandContext
  ): Promise<TUIResult> {
    try {
      if (!args) {
        return await this.listSessions(context);
      }

      const argsParts = args.trim().split(/\s+/);
      const subCommand = argsParts[0].toLowerCase();

      if (subCommand === 'rename') {
        if (argsParts.length < 3) {
          return createErrorResult('用法: /session rename <会话ID> <新名称>');
        }
        return await this.renameSession(argsParts[1], argsParts.slice(2).join(' '), context);
      } else if (subCommand === 'delete') {
        if (argsParts.length < 2) {
          return createErrorResult('用法: /session delete <会话ID>');
        }
        return await this.deleteSession(argsParts[1], context);
      } else {
        return await this.switchSession(args.trim(), context);
      }
    } catch (e) {
      this.logger.error('处理会话命令失败:', e);
      return createErrorResult(`处理会话命令失败: ${e}`);
    }
  }

  private async listSessions(context: CommandContext): Promise<TUIResult> {
    try {
      // 从服务器获取当前项目目录的会话
      const filtered = await this.adapter.listSessions(50, context.workingDir);

      // 当前活跃会话
      const currentSessionId = this.adapter.getSessionId(context.workingDir) || '';

      // 当前会话排最前
      filtered.sort((a, b) => {
        if (a.id === currentSessionId) return -1;
        if (b.id === currentSessionId) return 1;
        return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
      });

      const sessionDataList = filtered.slice(0, 10).map((session) => ({
        sessionId: session.id,
        displayId: session.slug || (session.id.length >= 8 ? session.id.slice(-8) : session.id),
        title: session.title || '未命名会话',
        createdAt: session.createdAt || 0,
        updatedAt: session.updatedAt || 0,
        isCurrent: session.id === currentSessionId,
        summary: session.summary,
      }));

      const card = buildSessionListCard(
        sessionDataList,
        currentSessionId,
        context.cliType,
        context.workingDir,
        filtered.length
      );

      return createCardResult('', { cardJson: card });
    } catch (e) {
      this.logger.error('列出会话失败:', e);
      return createErrorResult(`列出会话失败: ${e}`);
    }
  }

  private async switchSession(args: string, context: CommandContext): Promise<TUIResult> {
    try {
      let sessionId = args.trim();

      // 纯数字：从当前项目会话列表取第 N 个
      if (/^\d+$/.test(sessionId)) {
        const index = parseInt(sessionId, 10) - 1;
        const filtered = await this.adapter.listSessions(50, context.workingDir);
        if (index >= 0 && index < filtered.length) {
          sessionId = filtered[index].id;
        } else {
          return createErrorResult(`无效的会话索引: ${args}`);
        }
      }

      // 验证会话属于当前项目
      if (this.adapter.getSessionDetail) {
        const sessionDetail = await this.adapter.getSessionDetail(sessionId);
        if (sessionDetail) {
          const sessionDir = String(sessionDetail.directory || '');
          if (sessionDir && !pathsEqual(sessionDir, context.workingDir)) {
            return createErrorResult(
              `无法切换: 该会话属于其他项目\n` +
              `**当前项目:** \`${context.workingDir}\`\n` +
              `**会话项目:** \`${sessionDir}\``
            );
          }
        }
      }

      const success = await this.adapter.switchSession(sessionId, context.workingDir);
      if (success) {
        // 获取会话详情以显示 slug
        let displayId = sessionId;
        if (this.adapter.getSessionDetail) {
          const detail = await this.adapter.getSessionDetail(sessionId);
          if (detail?.slug) {
            displayId = String(detail.slug);
          } else if (sessionId.length >= 8) {
            displayId = sessionId.slice(-8);
          }
        } else if (sessionId.length >= 8) {
          displayId = sessionId.slice(-8);
        }

        return createCardResult('', {
          cardJson: buildSuccessCard(
            '✅ 切换成功',
            '已切换到会话',
            [{ key: '🆔 会话ID', value: `\`${displayId}\`` }],
            '可以继续之前的对话了'
          ),
        });
      } else {
        return createErrorResult('切换会话失败: 会话不存在或无法访问');
      }
    } catch (e) {
      this.logger.error('切换会话失败:', e);
      return createErrorResult(`切换会话失败: ${e}`);
    }
  }

  private async renameSession(
    sessionIdOrIndex: string,
    newTitle: string,
    context: CommandContext
  ): Promise<TUIResult> {
    try {
      let sessionId = sessionIdOrIndex.trim();

      if (/^\d+$/.test(sessionId)) {
        const index = parseInt(sessionId, 10) - 1;
        const filtered = await this.adapter.listSessions(50, context.workingDir);
        if (index >= 0 && index < filtered.length) {
          sessionId = filtered[index].id;
        } else {
          return createErrorResult(`无效的会话索引: ${sessionIdOrIndex}`);
        }
      }

      if (newTitle.length > 50) {
        return createErrorResult('会话名称不能超过50个字符');
      }
      if (!newTitle.trim()) {
        return createErrorResult('会话名称不能为空');
      }

      const success = await this.adapter.renameSession(sessionId, newTitle.trim());
      if (success) {
        return createCardResult('', {
          cardJson: buildSuccessCard(
            '✅ 重命名成功',
            '已重命名会话',
            [{ key: '📋 新名称', value: newTitle }],
            '使用 `/session` 查看列表'
          ),
        });
      } else {
        return createErrorResult('重命名会话失败');
      }
    } catch (e) {
      this.logger.error('重命名会话失败:', e);
      return createErrorResult(`重命名会话失败: ${e}`);
    }
  }

  private async deleteSession(
    sessionIdOrIndex: string,
    context: CommandContext
  ): Promise<TUIResult> {
    try {
      let sessionId = sessionIdOrIndex.trim();

      if (/^\d+$/.test(sessionId)) {
        const index = parseInt(sessionId, 10) - 1;
        const filtered = await this.adapter.listSessions(50, context.workingDir);
        if (index >= 0 && index < filtered.length) {
          sessionId = filtered[index].id;
        } else {
          return createErrorResult(`无效的会话索引: ${sessionIdOrIndex}`);
        }
      }

      // 验证会话属于当前项目
      if (this.adapter.getSessionDetail) {
        const sessionDetail = await this.adapter.getSessionDetail(sessionId);
        if (sessionDetail) {
          const sessionDir = String(sessionDetail.directory || '');
          if (sessionDir && !pathsEqual(sessionDir, context.workingDir)) {
            return createErrorResult('无法删除: 该会话属于其他项目');
          }
        }
      }

      const success = await this.adapter.deleteSession(sessionId);
      if (success) {
        let displayId = sessionId;
        if (sessionId.length >= 8) {
          displayId = sessionId.slice(-8);
        }
        return createCardResult('', {
          cardJson: buildSuccessCard(
            '✅ 删除成功',
            '已删除会话',
            [{ key: '🆔 会话ID', value: `\`${displayId}\`` }],
            '该会话及其消息历史已永久删除'
          ),
        });
      } else {
        return createErrorResult('删除会话失败');
      }
    } catch (e) {
      this.logger.error('删除会话失败:', e);
      return createErrorResult(`删除会话失败: ${e}`);
    }
  }

  // ── /model ────────────────────────────────────────────────────────────────

  private async handleModel(
    args: string | undefined,
    context: CommandContext
  ): Promise<TUIResult> {
    try {
      if (args) {
        return await this.switchModel(args, context);
      } else {
        return await this.listModels(context);
      }
    } catch (e) {
      this.logger.error('处理模型命令失败:', e);
      return createErrorResult(`处理模型命令失败: ${e}`);
    }
  }

  private async listModels(context: CommandContext): Promise<TUIResult> {
    try {
      const models = await this.adapter.listModels();
      if (!models || models.length === 0) {
        return createCardResult('', {
          cardJson: buildInfoCard(
            'ℹ️ 提示',
            '暂无可用模型，请在 `config.yaml` 的 `cli.opencode.models` 中添加',
            'grey'
          ),
        });
      }

      const card = buildModelSelectCard(
        models.map((m) => ({ ...m, fullId: m.id })),
        context.currentModel || '',
        context.cliType
      );

      return createCardResult('', { cardJson: card });
    } catch (e) {
      this.logger.error('列出模型失败:', e);
      return createErrorResult(`列出模型失败: ${e}`);
    }
  }

  private async switchModel(args: string, context: CommandContext): Promise<TUIResult> {
    try {
      const modelId = args.trim();
      if (!modelId.includes('/')) {
        return createErrorResult(
          `模型 ID 格式错误，应为 provider/model 格式\n` +
          `例如: opencode/mimo-v2, anthropic/claude-sonnet-4-20250514`
        );
      }

      const success = await this.adapter.switchModel(modelId);
      if (success) {
        return createCardResult('', {
          cardJson: buildSuccessCard(
            '✅ 切换成功',
            '已切换到模型',
            [{ key: '🤖 模型', value: `\`${modelId}\`` }],
            '新消息将使用此模型'
          ),
        });
      } else {
        return createErrorResult('切换模型失败: 模型不可用');
      }
    } catch (e) {
      this.logger.error('切换模型失败:', e);
      return createErrorResult(`切换模型失败: ${e}`);
    }
  }

  // ── /mode ─────────────────────────────────────────────────────────────────

  private async handleMode(
    args: string | undefined,
    context: CommandContext
  ): Promise<TUIResult> {
    try {
      if (args) {
        return await this.switchMode(args.trim(), context);
      }
      return await this.listModes(context);
    } catch (e) {
      this.logger.error('处理 mode 命令失败:', e);
      return createErrorResult(`处理 mode 命令失败: ${e}`);
    }
  }

  private async listModes(context: CommandContext): Promise<TUIResult> {
    if (!this.adapter.listAgents) {
      return createErrorResult('适配器不支持 list_agents');
    }
    const agents = await this.adapter.listAgents();
    if (!agents || agents.length === 0) {
      return createCardResult('', {
        cardJson: buildInfoCard('ℹ️ 提示', '暂无可用 agent 模式', 'grey'),
      });
    }

    const current = this.adapter.getCurrentAgent ? this.adapter.getCurrentAgent() : 'build';

    const card = buildModeSelectCard(
      agents.map((a) => ({ name: a.id, displayName: a.name, description: a.description, color: a.color })),
      current,
      context.cliType
    );

    return createCardResult('', { cardJson: card });
  }

  private async switchMode(agentId: string, context: CommandContext): Promise<TUIResult> {
    if (!this.adapter.switchAgent) {
      return createErrorResult('适配器不支持 switch_agent');
    }

    await this.adapter.switchAgent(agentId);
    const agents = this.adapter.listAgents ? await this.adapter.listAgents() : [];

    const card = buildModeSelectCard(
      agents.map((a) => ({ name: a.id, displayName: a.name, description: a.description, color: a.color })),
      agentId,
      context.cliType
    );

    return createCardResult('', { cardJson: card });
  }

  // ── /reset ────────────────────────────────────────────────────────────────

  private async handleReset(context: CommandContext): Promise<TUIResult> {
    try {
      const success = await this.adapter.resetSession();
      if (success) {
        const card = buildResetSuccessCard();
        return createCardResult('', { cardJson: card });
      } else {
        return createErrorResult('重置会话失败');
      }
    } catch (e) {
      this.logger.error('重置会话失败:', e);
      return createErrorResult(`重置会话失败: ${e}`);
    }
  }

  // ── /help ─────────────────────────────────────────────────────────────────

  private async handleHelp(context: CommandContext): Promise<TUIResult> {
    try {
      const card = buildHelpCard(
        context.cliType,
        context.workingDir,
        context.projectDisplayName || context.projectName
      );
      return createCardResult('', { cardJson: card });
    } catch (e) {
      this.logger.error('生成帮助卡片失败:', e);
      return createErrorResult(`生成帮助失败: ${e}`);
    }
  }

  // ── 交互式回复处理 ───────────────────────────────────────────────────────

  async handleInteractiveReply(
    interactiveId: string,
    reply: string,
    metadata: Record<string, unknown>,
    context: CommandContext
  ): Promise<TUIResult> {
    if (interactiveId === 'session_select') {
      return await this.switchSession(reply, context);
    } else if (interactiveId === 'model_select') {
      return await this.switchModel(reply, context);
    } else if (interactiveId === 'rename_session') {
      return await this.handleRenameReply(reply, metadata, context);
    }
    return createErrorResult(`未知的交互式消息: ${interactiveId}`);
  }

  private async handleRenameReply(
    newTitle: string,
    metadata: Record<string, unknown>,
    context: CommandContext
  ): Promise<TUIResult> {
    const sessionId = String(metadata.sessionId || '');
    const workingDir = String(metadata.workingDir || context.workingDir);
    const cliType = String(metadata.cliType || context.cliType);

    const title = newTitle.trim();
    if (!title) {
      return createErrorResult('名称不能为空');
    }
    if (title.length > 50) {
      return createErrorResult('名称不能超过50个字符');
    }

    const success = await this.adapter.renameSession(sessionId, title);
    if (!success) {
      return createErrorResult('重命名失败');
    }

    // 返回更新后的会话列表卡片
    const currentSessionId = this.adapter.getSessionId(workingDir) || '';
    const filtered = await this.adapter.listSessions(20, workingDir);
    filtered.sort((a, b) => {
      if (a.id === currentSessionId) return -1;
      if (b.id === currentSessionId) return 1;
      return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
    });

    const sessionDataList = filtered.slice(0, 10).map((session) => ({
      sessionId: session.id,
      displayId: session.slug || (session.id.length >= 8 ? session.id.slice(-8) : session.id),
      title: session.title || '未命名会话',
      createdAt: session.createdAt || 0,
      updatedAt: session.updatedAt || 0,
      isCurrent: session.id === currentSessionId,
    }));

    const card = buildSessionListCard(
      sessionDataList,
      currentSessionId,
      cliType,
      workingDir,
      filtered.length
    );

    return createCardResult('', { cardJson: card });
  }
}
