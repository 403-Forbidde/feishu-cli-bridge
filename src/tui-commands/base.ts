/**
 * TUI Commands - Base module
 * TUI 命令基础模块
 *
 * 提供 TUI 命令的抽象基类、数据结构和类型定义
 * 支持跨 CLI 工具的 TUI 命令实现
 */

/** TUI 命令结果类型 */
export enum TUIResultType {
  TEXT = 'text',           // 纯文本回复
  CARD = 'card',           // 卡片消息
  INTERACTIVE = 'interactive', // 交互式消息（需要用户回复）
  ERROR = 'error',         // 错误信息
}

/** TUI 命令执行结果 */
export interface TUIResult {
  type: TUIResultType;
  content: string;
  metadata: Record<string, unknown>;
  interactiveId?: string;   // 交互式消息 ID，用于回复匹配
  options?: Array<Record<string, string>>; // 交互选项
}

/** 创建 TUI 结果的帮助函数 */
export function createTUIResult(
  type: TUIResultType,
  content: string,
  metadata: Record<string, unknown> = {},
  interactiveId?: string,
  options?: Array<Record<string, string>>
): TUIResult {
  return { type, content, metadata, interactiveId, options };
}

/** 创建文本结果 */
export function createTextResult(content: string): TUIResult {
  return createTUIResult(TUIResultType.TEXT, content);
}

/** 创建卡片结果 */
export function createCardResult(
  content: string,
  metadata: Record<string, unknown> = {}
): TUIResult {
  return createTUIResult(TUIResultType.CARD, content, metadata);
}

/** 创建交互式结果 */
export function createInteractiveResult(
  content: string,
  interactiveId: string,
  options: Array<Record<string, string>>,
  metadata: Record<string, unknown> = {}
): TUIResult {
  return createTUIResult(TUIResultType.INTERACTIVE, content, metadata, interactiveId, options);
}

/** 创建错误结果 */
export function createErrorResult(content: string): TUIResult {
  return createTUIResult(TUIResultType.ERROR, content);
}

/** 命令执行上下文 */
export interface CommandContext {
  userId: string;
  chatId: string;
  cliType: string;
  workingDir: string;
  sessionId?: string;
  currentModel?: string;
  projectName?: string;           // 当前项目标识（英文）
  projectDisplayName?: string;    // 当前项目显示名
  timestamp: number;
}

/** 创建命令上下文 */
export function createCommandContext(
  userId: string,
  chatId: string,
  cliType: string,
  workingDir: string,
  options: Partial<CommandContext> = {}
): CommandContext {
  return {
    userId,
    chatId,
    cliType,
    workingDir,
    timestamp: Date.now(),
    ...options,
  };
}

/** TUI 命令基类 */
export abstract class TUIBaseCommand {
  protected adapter: unknown;
  protected logger: unknown;

  constructor(adapter: unknown, logger?: unknown) {
    this.adapter = adapter;
    this.logger = logger;
  }

  /** 返回支持的命令列表 */
  abstract get supportedCommands(): string[];

  /** 执行 TUI 命令 */
  abstract execute(
    command: string,
    args: string | undefined,
    context: CommandContext
  ): Promise<TUIResult>;

  /** 生成会话显示 ID */
  protected generateSessionDisplayId(sessionId: string, slug?: string): string {
    if (slug) {
      return slug;
    }
    // 取后 8 个字符作为唯一标识
    if (sessionId.length > 8) {
      return sessionId.slice(-8);
    }
    return sessionId;
  }

  /** 格式化会话列表为卡片文本 */
  protected formatSessionList(
    sessions: Array<Record<string, unknown>>,
    currentSessionId?: string
  ): string {
    const lines = ['📋 **会话列表**', ''];

    for (let i = 0; i < Math.min(sessions.length, 10); i++) {
      const session = sessions[i];
      const sessionId = String(session.id || '');
      const title = String(session.title || '未命名会话');
      const slug = String(session.slug || '');
      const displayId = this.generateSessionDisplayId(sessionId, slug);

      // 标记当前会话
      const marker = sessionId === currentSessionId ? ' ★' : '';

      // 优化格式：标题加粗，ID用代码格式
      lines.push(`**${i + 1}.** ${title}${marker}`);
      lines.push(`   \`${displayId}\``);
      lines.push('');
    }

    if (sessions.length > 10) {
      lines.push(`*... 还有 ${sessions.length - 10} 个更早的会话*`);
      lines.push('');
    }

    lines.push('━━━━━━━━━━━━━━');
    lines.push('💡 **点击回复**并发送 **数字 1-10** 切换会话');

    return lines.join('\n');
  }

  /** 格式化模型列表为卡片文本 */
  protected formatModelList(
    models: Array<Record<string, unknown>>,
    currentModel?: string
  ): string {
    const lines = ['🤖 可用模型', '━━━━━━━━━━━━━━'];

    // 按 provider 分组
    const providers: Record<string, Array<Record<string, unknown>>> = {};
    for (const model of models) {
      const provider = String(model.provider || 'unknown');
      if (!providers[provider]) {
        providers[provider] = [];
      }
      providers[provider].push(model);
    }

    // 限制显示的模型数量，避免消息过长
    const totalModels = models.length;
    const maxDisplay = 20;
    let displayed = 0;

    for (const provider of Object.keys(providers).sort()) {
      if (displayed >= maxDisplay) {
        break;
      }

      const providerModels = providers[provider];
      lines.push('');
      lines.push(`📦 **${provider.toUpperCase()}**`);
      lines.push('');

      for (let i = 0; i < providerModels.length; i++) {
        if (displayed >= maxDisplay) {
          break;
        }

        const model = providerModels[i];
        const fullId = String(model.fullId || model.full_id || '');
        const name = String(model.name || model.model || '');

        // 当前模型标记
        const marker = fullId === currentModel ? ' ★' : '';

        // 美化格式：名称加粗，ID用代码格式
        lines.push(`**${i + 1}.** ${name}${marker}`);
        lines.push(`   \`${fullId}\``);
        lines.push('');
        displayed++;
      }
    }

    if (totalModels > maxDisplay) {
      lines.push(`*... 还有 ${totalModels - maxDisplay} 个模型未显示*`);
      lines.push('');
    }

    lines.push('━━━━━━━━━━━━━━');
    lines.push('💡 **点击回复**并发送模型完整 ID 切换');

    return lines.join('\n');
  }
}
