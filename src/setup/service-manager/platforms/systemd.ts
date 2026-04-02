import { execa } from 'execa';
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import type { IServiceManager } from '../interface.js';
import type { ServiceConfig, ServiceManagerResult, ServiceStatus, RunOption, ServiceMode } from '../types.js';

export class SystemdServiceManager implements IServiceManager {
  readonly platform = 'linux';

  async isAvailable(): Promise<boolean> {
    try {
      const { exitCode } = await execa('systemctl', ['--version'], { reject: false });
      return exitCode === 0;
    } catch {
      return false;
    }
  }

  requiresAdmin(mode: ServiceMode): boolean {
    return mode === 'systemd-system';
  }

  async getStatus(serviceName: string): Promise<ServiceStatus> {
    const userPath = this.getUserConfigPath(serviceName);
    const systemPath = this.getSystemConfigPath(serviceName);
    const installed = existsSync(userPath) || existsSync(systemPath);

    let running = false;
    let enabled = false;

    if (installed) {
      const isSystem = existsSync(systemPath);
      const scope = isSystem ? [] : ['--user'];

      try {
        const activeResult = await execa('systemctl', [...scope, 'is-active', serviceName], { reject: false });
        running = activeResult.stdout.trim() === 'active';
      } catch {
        running = false;
      }

      try {
        const enabledResult = await execa('systemctl', [...scope, 'is-enabled', serviceName], { reject: false });
        enabled = enabledResult.stdout.trim() === 'enabled';
      } catch {
        enabled = false;
      }
    }

    return { installed, running, enabled };
  }

  async install(config: ServiceConfig): Promise<ServiceManagerResult> {
    const mode: ServiceMode = this.requiresAdminByConfig(config)
      ? 'systemd-system'
      : 'systemd-user';
    const unitContent = this.generateUnit(config);
    const configPath = mode === 'systemd-system'
      ? this.getSystemConfigPath(config.serviceName)
      : this.getUserConfigPath(config.serviceName);

    try {
      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(configPath, unitContent, 'utf-8');

      const scope = mode === 'systemd-system' ? [] : ['--user'];
      await execa('systemctl', [...scope, 'daemon-reload'], { reject: false });

      if (config.startOnBoot) {
        await execa('systemctl', [...scope, 'enable', config.serviceName], { reject: false });
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async uninstall(serviceName: string): Promise<ServiceManagerResult> {
    const status = await this.getStatus(serviceName);
    if (!status.installed) {
      return { success: true };
    }

    const userPath = this.getUserConfigPath(serviceName);
    const systemPath = this.getSystemConfigPath(serviceName);
    const isSystem = existsSync(systemPath);
    const scope = isSystem ? [] : ['--user'];

    try {
      await execa('systemctl', [...scope, 'stop', serviceName], { reject: false });
      await execa('systemctl', [...scope, 'disable', serviceName], { reject: false });

      if (existsSync(userPath)) rmSync(userPath);
      if (existsSync(systemPath)) rmSync(systemPath);

      await execa('systemctl', [...scope, 'daemon-reload'], { reject: false });
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async start(serviceName: string): Promise<ServiceManagerResult> {
    const userPath = this.getUserConfigPath(serviceName);
    const systemPath = this.getSystemConfigPath(serviceName);
    const isSystem = existsSync(systemPath);
    const scope = isSystem || !existsSync(userPath) ? [] : ['--user'];

    try {
      const { exitCode, stderr } = await execa('systemctl', [...scope, 'start', serviceName], { reject: false });
      if (exitCode !== 0) {
        return { success: false, error: stderr || '启动失败' };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async stop(serviceName: string): Promise<ServiceManagerResult> {
    const userPath = this.getUserConfigPath(serviceName);
    const systemPath = this.getSystemConfigPath(serviceName);
    const isSystem = existsSync(systemPath);
    const scope = isSystem || !existsSync(userPath) ? [] : ['--user'];

    try {
      const { exitCode, stderr } = await execa('systemctl', [...scope, 'stop', serviceName], { reject: false });
      if (exitCode !== 0) {
        return { success: false, error: stderr || '停止失败' };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async restart(serviceName: string): Promise<ServiceManagerResult> {
    const userPath = this.getUserConfigPath(serviceName);
    const systemPath = this.getSystemConfigPath(serviceName);
    const isSystem = existsSync(systemPath);
    const scope = isSystem || !existsSync(userPath) ? [] : ['--user'];

    try {
      const { exitCode, stderr } = await execa('systemctl', [...scope, 'restart', serviceName], { reject: false });
      if (exitCode !== 0) {
        return { success: false, error: stderr || '重启失败' };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async logs(serviceName: string, lines = 50): Promise<string> {
    try {
      const { stdout } = await execa(
        'journalctl',
        ['-u', serviceName, '-n', String(lines), '--no-pager'],
        { reject: false }
      );
      return stdout;
    } catch {
      return '';
    }
  }

  getConfigPath(serviceName: string): string {
    return this.getUserConfigPath(serviceName);
  }

  getAvailableOptions(): RunOption[] {
    return [
      {
        id: 'systemd-user',
        displayName: 'systemd 用户服务',
        description: '无需管理员权限，适合大多数用户',
        available: true,
        requiresAdmin: false,
      },
      {
        id: 'systemd-system',
        displayName: 'systemd 系统服务',
        description: '需要 sudo 权限，开机自启对所有用户生效',
        available: true,
        requiresAdmin: true,
      },
    ];
  }

  private getUserConfigPath(serviceName: string): string {
    return join(homedir(), '.config', 'systemd', 'user', `${serviceName}.service`);
  }

  private getSystemConfigPath(serviceName: string): string {
    return `/etc/systemd/system/${serviceName}.service`;
  }

  private requiresAdminByConfig(config: ServiceConfig): boolean {
    return config.serviceName.includes('system') ? false : false; // Determined at selection time
  }

  private generateUnit(config: ServiceConfig): string {
    const envLines = Object.entries(config.env)
      .map(([k, v]) => `Environment="${k}=${v}"`)
      .join('\n');

    return `[Unit]
Description=Feishu CLI Bridge - ${config.serviceName}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${config.workingDirectory}
ExecStart=${config.command} ${config.args.join(' ')}
${envLines}
Restart=${config.autoRestart ? 'always' : 'no'}
RestartSec=5

[Install]
WantedBy=default.target
`;
  }
}
