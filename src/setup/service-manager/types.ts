export type ServiceMode = 'foreground' | 'systemd-user' | 'systemd-system' | 'launchd-user' | 'launchd-system';

export interface ServiceStatus {
  installed: boolean;
  running: boolean;
  enabled: boolean;
}

export interface RunOption {
  id: ServiceMode;
  displayName: string;
  description: string;
  available: boolean;
  requiresAdmin: boolean;
}

export interface ServiceConfig {
  serviceName: string;
  workingDirectory: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  logDirectory: string;
  autoRestart: boolean;
  startOnBoot: boolean;
}

export interface ServiceManagerResult {
  success: boolean;
  error?: string;
}
