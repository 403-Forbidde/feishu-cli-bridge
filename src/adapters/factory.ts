/**
 * 适配器工厂
 * Adapter Factory
 *
 * 负责创建和管理 CLI 适配器实例
 * 支持根据配置动态创建适配器
 */

import type { Config } from '../core/types/config.js';
import type { ICLIAdapter, AdapterConfig } from './interface/types.js';

/**
 * 适配器注册表
 * 映射适配器名称到其构造函数
 */
type AdapterConstructor = new (config: AdapterConfig) => ICLIAdapter;

const adapterRegistry = new Map<string, AdapterConstructor>();

/**
 * 注册适配器
 * @param name - 适配器名称
 * @param constructor - 适配器构造函数
 */
export function registerAdapter(name: string, constructor: AdapterConstructor): void {
  adapterRegistry.set(name, constructor);
}

/**
 * 创建适配器实例
 * @param name - 适配器名称
 * @param config - 全局配置
 * @returns 适配器实例或 null
 */
export function createAdapter(name: string, config: Config): ICLIAdapter | null {
  const Constructor = adapterRegistry.get(name);
  if (!Constructor) {
    return null;
  }

  const adapterConfig = config.cli[name];
  if (!adapterConfig || !adapterConfig.enabled) {
    return null;
  }

  return new Constructor(adapterConfig);
}

/**
 * 获取所有已启用的适配器
 * @param config - 全局配置
 * @returns 适配器名称列表
 */
export function getEnabledAdapters(config: Config): string[] {
  return Object.entries(config.cli)
    .filter(([, cfg]) => cfg.enabled)
    .map(([name]) => name);
}

/**
 * 检查适配器是否可用
 * @param name - 适配器名称
 * @returns 是否已注册
 */
export function isAdapterAvailable(name: string): boolean {
  return adapterRegistry.has(name);
}

/**
 * 获取已注册的适配器名称列表
 * @returns 适配器名称列表
 */
export function getRegisteredAdapters(): string[] {
  return Array.from(adapterRegistry.keys());
}
