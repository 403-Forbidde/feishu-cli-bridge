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

  async fetchModels(): Promise<Array<{ id: string; name: string; provider?: string }>> {
    // 优先尝试通过 API 获取模型列表
    try {
      const opencodePath = await which('opencode');
      // 尝试使用 opencode models list 命令 (如果支持)
      const { stdout, exitCode } = await execa(
        opencodePath,
        ['models', 'list', '--json'],
        { reject: false, timeout: 15000 }
      );
      if (exitCode === 0 && stdout.trim()) {
        const parsed = JSON.parse(stdout) as Array<{ id?: string; name?: string; provider?: string }>;
        return parsed
          .filter((m) => m.id)
          .map((m) => ({
            id: m.id!,
            name: m.name || m.id!,
            provider: m.provider,
          }));
      }
    } catch {
      // fallback to recommended models
    }

    return this.recommendedModels.map((m) => ({
      id: m.id,
      name: m.name,
      provider: 'kimi',
    }));
  }

  getDefaultConfig(): CLIConfig {
    return {
      enabled: true,
      command: 'opencode',
      default_model: 'kimi',
    };
  }
}
