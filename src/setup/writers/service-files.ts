import { SystemdServiceManager } from '../service-manager/platforms/systemd.js';
import { LaunchdServiceManager } from '../service-manager/platforms/launchd.js';
import type { ServiceConfig, ServiceMode } from '../service-manager/types.js';

export async function installService(
  mode: ServiceMode,
  config: ServiceConfig
): Promise<{ success: boolean; error?: string }> {
  if (mode === 'systemd-user' || mode === 'systemd-system') {
    const manager = new SystemdServiceManager();
    return manager.install(config);
  }

  if (mode === 'launchd-user' || mode === 'launchd-system') {
    const manager = new LaunchdServiceManager();
    return manager.install(config);
  }

  return { success: true };
}

export async function startService(
  mode: ServiceMode,
  serviceName: string
): Promise<{ success: boolean; error?: string }> {
  if (mode === 'systemd-user' || mode === 'systemd-system') {
    const manager = new SystemdServiceManager();
    return manager.start(serviceName);
  }

  if (mode === 'launchd-user' || mode === 'launchd-system') {
    const manager = new LaunchdServiceManager();
    return manager.start(serviceName);
  }

  return { success: true };
}
