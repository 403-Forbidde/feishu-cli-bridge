/**
 * 适配器接口层
 * Adapter Interface Layer
 *
 * 定义 CLI 适配器的抽象接口，隔离平台层与具体 CLI 实现
 * 当前仅支持 OpenCode，设计为可扩展支持其他 CLI 工具（Codex、Kimi CLI 等）
 */

export * from './types.js';
export * from './base-adapter.js';
