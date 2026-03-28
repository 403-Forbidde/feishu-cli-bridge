/**
 * Core infrastructure types
 */

// CLI 配置（支持多个 CLI 工具）
export interface CLIConfig {
  enabled: boolean;
  command: string;
  defaultModel: string;
  timeout: number;
  models: Array<{ id: string; name: string } | string>;
}

// 飞书配置
export interface FeishuConfig {
  appId: string;
  appSecret: string;
  encryptKey?: string;
  verificationToken?: string;
}

// 会话配置
export interface SessionConfig {
  maxSessions: number;
  maxHistory: number;
}

// 流式输出配置
export interface StreamingConfig {
  updateInterval: number;    // 秒
  minChunkSize: number;      // 字符
  maxMessageLength: number;  // 字符
}

// 调试配置
export interface DebugConfig {
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  saveLogs: boolean;
  logDir: string;
}

// 项目配置
export interface ProjectConfig {
  storagePath: string;
  maxProjects: number;
}

// 安全配置（新增）
export interface SecurityConfig {
  allowedProjectRoot: string;
  maxAttachmentSize: number;  // 字节
  maxPromptLength: number;    // 字符
}

// 主配置接口
export interface Config {
  feishu: FeishuConfig;
  session: SessionConfig;
  cli: Record<string, CLIConfig>;
  streaming: StreamingConfig;
  debug: DebugConfig;
  project: ProjectConfig;
  security: SecurityConfig;
}
