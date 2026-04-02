import { execa } from 'execa';
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import type { IServiceManager } from '../interface.js';
import type { ServiceConfig, ServiceManagerResult, ServiceStatus, RunOption, ServiceMode } from '../types.js';

export class LaunchdServiceManager implements IServiceManager {
  readonly platform = 'darwin';

  async isAvailable(): Promise<boolean> {
    try {
      const { exitCode } = await execa('launchctl', ['version'], { reject: false });
      return exitCode === 0;
    } catch {
      return false;
    }
  }

  requiresAdmin(mode: ServiceMode): boolean {
    return mode === 'launchd-system';
  }

  async getStatus(serviceName: string): Promise<ServiceStatus> {
    const userPath = this.getUserConfigPath(serviceName);
    const systemPath = this.getSystemConfigPath(serviceName);
    const installed = existsSync(userPath) || existsSync(systemPath);

    let running = false;
    let enabled = false;

    if (installed) {
      const isSystem = existsSync(systemPath);
      const domain = isSystem ? 'system' : `gui/${process.getuid?.() || 501}`;

      try {
        const listResult = await execa('launchctl', ['list', serviceName], { reject: false });
        running = listResult.exitCode === 0 && listResult.stdout.includes(serviceName);
      } catch {
        running = false;
      }

      enabled = installed;
    }

    return { installed, running, enabled };
  }

  async install(config: ServiceConfig): Promise<ServiceManagerResult> {
    const mode: ServiceMode = this.requiresAdminByConfig(config)
      ? 'launchd-system'
      : 'launchd-user';
    const plistContent = this.generatePlist(config);
    const configPath = mode === 'launchd-system'
      ? this.getSystemConfigPath(config.serviceName)
      : this.getUserConfigPath(config.serviceName);

    try {
      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(configPath, plistContent, 'utf-8');

      if (config.startOnBoot) {
        const isSystem = mode === 'launchd-system';
        const domain = isSystem ? 'system' : `gui/${process.getuid?.() || 501}`;
        await execa('launchctl', ['bootstrap', domain, configPath], { reject: false });
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
    const domain = isSystem ? 'system' : `gui/${process.getuid?.() || 501}`;

    try {
      await execa('launchctl', ['bootout', domain, isSystem ? systemPath : userPath], { reject: false });

      if (existsSync(userPath)) rmSync(userPath);
      if (existsSync(systemPath)) rmSync(systemPath);

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async start(serviceName: string): Promise<ServiceManagerResult> {
    const userPath = this.getUserConfigPath(serviceName);
    const systemPath = this.getSystemConfigPath(serviceName);
    const isSystem = existsSync(systemPath);
    const configPath = isSystem ? systemPath : userPath;
    const domain = isSystem ? 'system' : `gui/${process.getuid?.() || 501}`;

    try {
      await execa('launchctl', ['bootstrap', domain, configPath], { reject: false });
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async stop(serviceName: string): Promise<ServiceManagerResult> {
    const userPath = this.getUserConfigPath(serviceName);
    const systemPath = this.getSystemConfigPath(serviceName);
    const isSystem = existsSync(systemPath);
    const configPath = isSystem ? systemPath : userPath;
    const domain = isSystem ? 'system' : `gui/${process.getuid?.() || 501}`;

    try {
      await execa('launchctl', ['bootout', domain, configPath], { reject: false });
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async restart(serviceName: string): Promise<ServiceManagerResult> {
    const stopResult = await this.stop(serviceName);
    if (!stopResult.success) return stopResult;
    // Small delay before start
    await new Promise((r) => setTimeout(r, 500));
    return this.start(serviceName);
  }

  async logs(_serviceName: string, lines = 50): Promise<string> {
    try {
      const { stdout } = await execa(
        'log',
        ['show', '--predicate', '(process == "node")', '--last', '1h', '--style', 'compact'],
        { reject: false }
      );
      return stdout.split('\n').slice(-lines).join('\n');
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
        id: 'launchd-user',
        displayName: 'launchd 用户服务',
        description: '无需管理员权限，适合 macOS 用户',
        available: true,
        requiresAdmin: false,
      },
      {
        id: 'launchd-system',
        displayName: 'launchd 系统服务',
        description: '需要管理员权限，全局开机自启',
        available: true,
        requiresAdmin: true,
      },
    ];
  }

  private getUserConfigPath(serviceName: string): string {
    return join(homedir(), 'Library', 'LaunchAgents', `${serviceName}.plist`);
  }

  private getSystemConfigPath(serviceName: string): string {
    return `/Library/LaunchDaemons/${serviceName}.plist`;
  }

  private requiresAdminByConfig(_config: ServiceConfig): boolean {
    return false;
  }

  private generatePlist(config: ServiceConfig): string {
    const envVars = Object.entries(config.env)
      .map(([k, v]) => `    <key>${k}</key>\n    <string>${this.escapeXml(v)}</string>`)
      .join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${config.serviceName}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${config.command}</string>
${config.args.map((a) => `        <string>${this.escapeXml(a)}</string>`).join('\n')}
    </array>
    <key>WorkingDirectory</key>
    <string>${config.workingDirectory}</string>
${envVars ? `    <key>EnvironmentVariables</key>\n    <dict>\n${envVars}\n    </dict>` : ''}
    <key>RunAtLoad</key>
    <${config.startOnBoot ? 'true' : 'false'}/>
    <key>KeepAlive</key>
    <${config.autoRestart ? 'true' : 'false'}/>
    <key>StandardOutPath</key>
    <string>${config.logDirectory}/stdout.log</string>
    <key>StandardErrorPath</key>
    <string>${config.logDirectory}/stderr.log</string>
</dict>
</plist>
`;
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
