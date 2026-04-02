import type { ServiceMode, RunOption, ServiceConfig, ServiceManagerResult, ServiceStatus } from './types.js';

export interface IServiceManager {
  readonly platform: string;

  isAvailable(): Promise<boolean>;
  requiresAdmin(mode: ServiceMode): boolean;
  getStatus(serviceName: string): Promise<ServiceStatus>;
  install(config: ServiceConfig): Promise<ServiceManagerResult>;
  uninstall(serviceName: string): Promise<ServiceManagerResult>;
  start(serviceName: string): Promise<ServiceManagerResult>;
  stop(serviceName: string): Promise<ServiceManagerResult>;
  restart(serviceName: string): Promise<ServiceManagerResult>;
  logs(serviceName: string, lines?: number): Promise<string>;
  getConfigPath(serviceName: string): string;
  getAvailableOptions(): RunOption[];
}
