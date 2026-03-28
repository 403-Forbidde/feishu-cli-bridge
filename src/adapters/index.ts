/**
 * 适配器层
 * Adapter Layer
 *
 * CLI 工具适配器统一出口
 */

// 接口定义
export * from './interface/index.js';

// 工厂
export * from './factory.js';

// OpenCode 适配器
export * from './opencode/index.js';

// 注册 OpenCode 适配器
import { OpenCodeAdapter } from './opencode/adapter.js';
import { registerAdapter } from './factory.js';

registerAdapter('opencode', OpenCodeAdapter);
