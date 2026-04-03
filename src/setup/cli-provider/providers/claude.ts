import { execa } from 'execa';
import which from 'which';
import semver from 'semver';
import process from 'node:process';

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
        return { authenticated: true, provider: 'ANTHROPIC_API_KEY' };
      }

      // 检查 settings.json 中的配置
      const claudePath = await which('claude');
      const { exitCode, stdout } = await execa(
        claudePath,
        ['--output-format', 'stream-json', '--verbose', 'echo test'],
        { reject: false, timeout: 10000, env: { ...process.env, CI: 'true' } }
      );

      // 如果命令成功执行，说明已认证
      if (exitCode === 0 || stdout.includes('system')) {
        return { authenticated: true };
      }

      return { authenticated: false };
    } catch {
      return { authenticated: false };
    }
  }

  async login(): Promise<boolean> {
    console.log('\nClaude Code 使用 API Key 进行认证。');
    console.log('请确保已设置 ANTHROPIC_API_KEY 环境变量。');
    console.log('\n如果使用第三方 Provider（如 Kimi），请设置:');
    console.log('  - ANTHROPIC_API_KEY');
    console.log('  - ANTHROPIC_BASE_URL');
    console.log('\n配置完成后按 Enter 继续...');

    // 等待用户确认
    await new Promise((resolve) => {
      process.stdin.once('data', () => resolve(undefined));
    });

    // 重新检查认证状态
    const authStatus = await this.getAuthStatus();
    return authStatus.authenticated;
  }

  async fetchModels(): Promise<Array<{ id: string; name: string; provider?: string; isFree?: boolean }>> {
    // Claude Code 支持通过 ANTHROPIC_BASE_URL 使用不同 Provider
    // 返回推荐的模型列表
    return [
      { id: 'auto', name: '自动检测（推荐）', provider: 'dynamic', isFree: false },
      { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', provider: 'anthropic', isFree: false },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'anthropic', isFree: false },
      { id: 'kimi-k2.5', name: 'Kimi K2.5', provider: 'kimi', isFree: false },
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
      if (settings.env?.ANTHROPIC_MODEL) {
        return settings.env.ANTHROPIC_MODEL;
      }
    } catch {
      // 读取失败，忽略错误
    }

    return null;
  }
}
