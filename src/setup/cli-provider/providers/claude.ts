import { execa } from 'execa';
import which from 'which';
import semver from 'semver';
import chalk from 'chalk';
import process from 'node:process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type {
  ICLIProvider,
  CLICheckResult,
  InstallMethod,
  InstallOptions,
  InstallResult,
  AuthStatus,
  CLIConfig,
} from '../interface.js';

const MIN_VERSION = '2.0.0';

// Claude Code 设置文件路径
const CLAUDE_SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');

// 第三方 Provider 列表
const THIRD_PARTY_PROVIDERS: Record<string, { name: string; url: string; models: string[] }> = {
  'kimi.com': {
    name: 'Kimi',
    url: 'https://api.kimi.com/coding/',
    models: ['kimi-k2.5', 'kimi-k2.5-long'],
  },
  'openrouter.ai': {
    name: 'OpenRouter',
    url: 'https://openrouter.ai/api/v1/',
    models: ['anthropic/claude-opus-4-6', 'anthropic/claude-sonnet-4-6'],
  },
};

export class ClaudeCodeProvider implements ICLIProvider {
  readonly id = 'claude';
  readonly displayName = 'Claude Code';
  readonly adapterName = 'claude';
  readonly websiteUrl = 'https://claude.ai/code';
  readonly docsUrl = 'https://code.claude.com/docs';
  readonly minVersion = MIN_VERSION;
  readonly recommendedModels = [
    { id: 'auto', name: '自动检测（推荐）', description: '从流输出动态检测实际使用的模型' },
    { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', description: '最强大的 Claude 模型' },
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', description: '平衡性能和速度的 Claude 模型' },
  ];

  async check(): Promise<CLICheckResult> {
    try {
      const claudePath = await which('claude');
      const { stdout } = await execa(claudePath, ['--version'], { reject: false });
      const versionMatch = stdout.match(/(\d+\.\d+\.\d+)/);
      const version = versionMatch ? versionMatch[1] : undefined;
      const meetsRequirements = version ? semver.gte(version, MIN_VERSION) : false;
      return {
        installed: true,
        version,
        path: claudePath,
        meetsRequirements,
      };
    } catch {
      return { installed: false, meetsRequirements: false };
    }
  }

  getInstallMethods(): InstallMethod[] {
    const platform = process.platform;
    const methods: InstallMethod[] = [];

    methods.push({
      id: 'official',
      displayName: '官方安装脚本',
      description: '推荐方式，通过 npm 全局安装 Claude Code',
      command: 'npm install -g @anthropic-ai/claude-code',
      platform: ['linux', 'darwin', 'win32'],
    });

    if (platform === 'darwin') {
      methods.push({
        id: 'brew',
        displayName: 'Homebrew',
        description: 'macOS 用户使用 Homebrew 安装',
        command: 'brew install claude-code',
        platform: ['darwin'],
      });
    }

    return methods.filter((m) => !m.platform || m.platform.includes(platform));
  }

  async install(method: string, _options?: InstallOptions): Promise<InstallResult> {
    const methods = this.getInstallMethods();
    const target = methods.find((m) => m.id === method);
    if (!target) {
      return { success: false, error: `未知的安装方式: ${method}` };
    }

    if (!target.command) {
      return { success: false, error: '没有对应的安装命令' };
    }

    try {
      const parts = target.command.split(' ');
      const cmd = parts[0];
      const args = parts.slice(1);
      await execa(cmd, args, { stdio: 'inherit', reject: false });
      return { success: true, message: '安装命令已执行' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async verify(): Promise<boolean> {
    const result = await this.check();
    return result.installed && result.meetsRequirements;
  }

  async getAuthStatus(): Promise<AuthStatus> {
    try {
      // 检查 ANTHROPIC_API_KEY 环境变量
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (apiKey) {
        const providerInfo = await this.detectProvider();
        return {
          authenticated: true,
          provider: providerInfo?.name || 'ANTHROPIC_API_KEY',
        };
      }

      // 检查 settings.json 中的配置
      const settings = await this.readClaudeSettings();
      const envSettings = settings?.env as Record<string, string> | undefined;
      if (envSettings?.ANTHROPIC_API_KEY) {
        const providerInfo = await this.detectProvider();
        return {
          authenticated: true,
          provider: providerInfo?.name || 'settings.json',
        };
      }

      return { authenticated: false };
    } catch {
      return { authenticated: false };
    }
  }

  /**
   * 读取 Claude Code 的 settings.json 配置
   */
  private async readClaudeSettings(): Promise<Record<string, unknown> | null> {
    try {
      const content = await readFile(CLAUDE_SETTINGS_PATH, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * 检测当前使用的 API Provider
   * 返回 Provider 信息或 null（使用官方 API）
   */
  async detectProvider(): Promise<{
    name: string;
    url: string;
    isThirdParty: boolean;
    models: string[];
  } | null> {
    // 1. 检查环境变量
    const envUrl = process.env.ANTHROPIC_BASE_URL;
    if (envUrl) {
      return this.matchProvider(envUrl);
    }

    // 2. 检查 settings.json
    const settings = await this.readClaudeSettings();
    const envSettings = settings?.env as Record<string, string> | undefined;
    const settingsUrl = envSettings?.ANTHROPIC_BASE_URL;
    if (settingsUrl) {
      return this.matchProvider(settingsUrl);
    }

    // 3. 使用官方 API
    return null;
  }

  /**
   * 根据 URL 匹配 Provider
   */
  private matchProvider(url: string): {
    name: string;
    url: string;
    isThirdParty: boolean;
    models: string[];
  } {
    for (const [key, provider] of Object.entries(THIRD_PARTY_PROVIDERS)) {
      if (url.includes(key)) {
        return { ...provider, isThirdParty: true };
      }
    }

    // 未知的第三方 Provider
    return {
      name: `Third-party (${url})`,
      url,
      isThirdParty: true,
      models: ['auto'],
    };
  }

  /**
   * 获取第三方 API 配置提示
   */
  getThirdPartyGuide(): string {
    return `
${chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}
${chalk.bold('🌐 第三方模型 API 配置指南')}
${chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}

Claude Code 支持通过第三方 Provider 使用非 Anthropic 官方模型（如 Kimi）。

${chalk.bold('配置方法：')}

${chalk.yellow('方法 1: 直接编辑配置文件')}
  编辑 ~/.claude/settings.json：
  {
    "env": {
      "ANTHROPIC_API_KEY": "your-api-key",
      "ANTHROPIC_BASE_URL": "https://api.kimi.com/coding/"
    }
  }

${chalk.yellow('方法 2: 使用 cc-switch 工具（推荐）')}
  cc-switch 是一个便捷的 Claude Code 模型切换工具：
  ${chalk.dim('https://github.com/farion1231/cc-switch')}

  安装：
    npm install -g cc-switch

  使用：
    cc-switch kimi      # 切换到 Kimi API
    cc-switch anthropic # 切换到 Anthropic 官方

${chalk.bold('支持的第三方 Provider：')}
  • Kimi (api.kimi.com) - Kimi K2.5 系列模型
  • OpenRouter (openrouter.ai) - 多模型聚合平台

${chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}
    `.trim();
  }

  async login(): Promise<boolean> {
    const providerInfo = await this.detectProvider();

    console.log('\n' + chalk.bold('🔐 Claude Code 认证配置'));
    console.log(chalk.dim('─'.repeat(50)));

    if (providerInfo?.isThirdParty) {
      console.log(chalk.green(`✓ 已配置第三方 Provider: ${providerInfo.name}`));
      console.log(chalk.dim(`  API 地址: ${providerInfo.url}`));
    } else {
      console.log(chalk.cyan('ℹ 当前使用 Anthropic 官方 API'));
    }

    console.log('\n' + chalk.bold('认证方式:'));
    console.log('Claude Code 通过环境变量或配置文件进行认证。');

    // 显示第三方 API 配置指南
    console.log('\n' + this.getThirdPartyGuide());

    console.log('\n' + chalk.yellow('请完成上述配置后按 Enter 继续...'));

    // 等待用户确认
    await new Promise((resolve) => {
      process.stdin.once('data', () => resolve(undefined));
    });

    // 重新检查认证状态
    const authStatus = await this.getAuthStatus();
    return authStatus.authenticated;
  }

  async fetchModels(): Promise<Array<{ id: string; name: string; provider?: string; isFree?: boolean }>> {
    const providerInfo = await this.detectProvider();

    // 根据检测到的 Provider 返回相应模型列表
    if (providerInfo?.isThirdParty) {
      const baseModels = [
        { id: 'auto', name: '自动检测（推荐）', provider: providerInfo.name, isFree: false },
      ];

      // 添加该 Provider 支持的模型
      for (const modelId of providerInfo.models) {
        baseModels.push({
          id: modelId,
          name: `${providerInfo.name} ${modelId}`,
          provider: providerInfo.name.toLowerCase(),
          isFree: false,
        });
      }

      return baseModels;
    }

    // 默认返回 Anthropic 官方模型
    return [
      { id: 'auto', name: '自动检测（推荐）', provider: 'anthropic', isFree: false },
      { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', provider: 'anthropic', isFree: false },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'anthropic', isFree: false },
    ];
  }

  getDefaultConfig(): CLIConfig {
    return {
      enabled: true,
      command: 'claude',
      default_model: 'auto',
      context_window: 'auto',
      permission_mode: 'acceptEdits',
      allowed_tools: ['Bash', 'Read', 'Edit', 'Grep'],
    };
  }

  /**
   * 获取用户已配置的默认模型
   * 通过检查环境变量和 settings.json
   */
  async getUserDefaultModel(): Promise<string | null> {
    // 检查环境变量
    const envModel = process.env.CLAUDE_MODEL;
    if (envModel) {
      return envModel;
    }

    // 尝试读取 settings.json
    try {
      const { readFile } = await import('node:fs/promises');
      const { homedir } = await import('node:os');
      const { join } = await import('node:path');

      const settingsPath = join(homedir(), '.claude', 'settings.json');
      const content = await readFile(settingsPath, 'utf-8');
      const settings = JSON.parse(content);

      // 检查 settings 中的模型相关配置
      const envSettings = settings.env as Record<string, string> | undefined;
      if (envSettings?.ANTHROPIC_MODEL) {
        return envSettings.ANTHROPIC_MODEL;
      }
    } catch {
      // 读取失败，忽略错误
    }

    return null;
  }
}
