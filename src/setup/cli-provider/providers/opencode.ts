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

const MIN_VERSION = '0.5.0';

export class OpenCodeProvider implements ICLIProvider {
  readonly id = 'opencode';
  readonly displayName = 'OpenCode';
  readonly adapterName = 'opencode';
  readonly websiteUrl = 'https://opencode.ai';
  readonly docsUrl = 'https://opencode.ai/docs';
  readonly minVersion = MIN_VERSION;
  readonly recommendedModels = [
    { id: 'kimi-for-coding/k2p5', name: 'Kimi K2.5', description: 'Kimi coding model' },
  ];

  async check(): Promise<CLICheckResult> {
    try {
      const opencodePath = await which('opencode');
      const { stdout } = await execa(opencodePath, ['--version'], { reject: false });
      const versionMatch = stdout.match(/(\d+\.\d+\.\d+)/);
      const version = versionMatch ? versionMatch[1] : undefined;
      const meetsRequirements = version ? semver.gte(version, MIN_VERSION) : false;
      return {
        installed: true,
        version,
        path: opencodePath,
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
      id: 'curl',
      displayName: '官方安装脚本 (curl)',
      description: '推荐方式，自动安装最新版',
      command: 'curl -fsSL https://opencode.ai/install.sh | sh',
      platform: ['linux', 'darwin'],
    });

    methods.push({
      id: 'npm',
      displayName: 'npm 全局安装',
      description: '通过 npm 安装 opencode-ai 包',
      command: 'npm install -g opencode-ai',
      platform: ['linux', 'darwin', 'win32'],
    });

    if (platform === 'darwin') {
      methods.push({
        id: 'brew',
        displayName: 'Homebrew',
        description: 'macOS 用户使用 Homebrew 安装',
        command: 'brew install opencode',
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
      const opencodePath = await which('opencode');
      // 尝试通过 whoami / account 检查登录状态
      const { exitCode, stdout, stderr } = await execa(
        opencodePath,
        ['whoami'],
        { reject: false, timeout: 10000 }
      );
      if (exitCode === 0 && stdout.trim()) {
        return { authenticated: true, user: stdout.trim() };
      }
      // 有些版本可能不支持 whoami，尝试检查 health
      const health = await execa(opencodePath, ['serve', '--version'], { reject: false });
      if (health.exitCode === 0) {
        return { authenticated: true };
      }
      return { authenticated: false };
    } catch {
      return { authenticated: false };
    }
  }

  async login(): Promise<boolean> {
    try {
      const opencodePath = await which('opencode');
      const { exitCode } = await execa(opencodePath, ['login'], {
        stdio: 'inherit',
        reject: false,
      });
      return exitCode === 0;
    } catch {
      return false;
    }
  }

  async fetchModels(): Promise<Array<{ id: string; name: string; provider?: string; isFree?: boolean }>> {
    // 优先尝试通过 opencode models 命令获取模型列表
    try {
      const opencodePath = await which('opencode');
      // 使用 opencode models 命令获取所有模型
      const { stdout, exitCode } = await execa(
        opencodePath,
        ['models'],
        { reject: false, timeout: 15000 }
      );
      if (exitCode === 0 && stdout.trim()) {
        // 解析模型列表，每行一个模型 ID
        const allModels = stdout
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith('Commands:') && !line.startsWith('Options:') && !line.startsWith('Positionals:'));

        // 过滤出包含 free 的模型
        const freeModels = allModels
          .filter((id) => id.toLowerCase().includes('free'))
          .map((id) => ({
            id,
            name: this.formatModelName(id),
            provider: id.split('/')[0] || 'unknown',
            isFree: true,
          }));

        if (freeModels.length > 0) {
          return freeModels;
        }
      }
    } catch {
      // fallback to recommended models
    }

    // 如果无法获取或没有免费模型，返回默认的免费模型列表
    const defaultFreeModels = [
      { id: 'opencode/mimo-v2-omni-free', name: 'Mimo V2 Omni (Free)', provider: 'opencode', isFree: true },
      { id: 'opencode/mimo-v2-pro-free', name: 'Mimo V2 Pro (Free)', provider: 'opencode', isFree: true },
      { id: 'opencode/minimax-m2.5-free', name: 'MiniMax M2.5 (Free)', provider: 'opencode', isFree: true },
      { id: 'opencode/nemotron-3-super-free', name: 'Nemotron 3 Super (Free)', provider: 'opencode', isFree: true },
      { id: 'opencode/qwen3.6-plus-free', name: 'Qwen 3.6 Plus (Free)', provider: 'opencode', isFree: true },
    ];

    return defaultFreeModels;
  }

  private formatModelName(id: string): string {
    // 将模型 ID 转换为可读名称
    const parts = id.split('/');
    const name = parts[parts.length - 1] || id;
    return name
      .replace(/-/g, ' ')
      .replace(/:free$/, ' (Free)')
      .replace(/-free$/, ' (Free)')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  getDefaultConfig(): CLIConfig {
    return {
      enabled: true,
      command: 'opencode',
      default_model: 'kimi',
    };
  }
}
