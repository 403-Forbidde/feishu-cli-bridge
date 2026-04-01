/**
 * Configuration management module
 * Loads config from YAML file with environment variable overrides
 *
 * 配置加载优先级：
 * 1. 显式传入的配置文件路径
 * 2. CONFIG_FILE 环境变量
 * 3. XDG_CONFIG_HOME (~/.config/cli-feishu-bridge/config.yaml)
 * 4. 当前工作目录的 config.yaml
 * 5. 环境变量默认值
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { homedir } from 'os';
import { load as loadYaml } from 'js-yaml';
import type {
  Config,
  FeishuConfig,
  SessionConfig,
  CLIConfig,
  StreamingConfig,
  DebugConfig,
  ProjectConfig,
  SecurityConfig,
} from './types/index.js';

// 已加载的配置文件路径（用于相对路径解析）
let _configPath: string | null = null;

// 默认配置常量
const DEFAULTS = {
  SESSION_MAX_SESSIONS: 15,
  SESSION_MAX_HISTORY: 20,
  STREAMING_UPDATE_INTERVAL: 0.3,
  STREAMING_MIN_CHUNK_SIZE: 20,
  STREAMING_MAX_MESSAGE_LENGTH: 8000,
  CLI_TIMEOUT: 300,
  DEBUG_LOG_LEVEL: 'info' as const,
  PROJECT_MAX_PROJECTS: 50,
  SECURITY_MAX_ATTACHMENT_SIZE: 50 * 1024 * 1024,  // 50MB
  SECURITY_MAX_PROMPT_LENGTH: 100_000,
};

/**
 * 获取配置文件所在目录
 */
export function getConfigDir(): string {
  if (_configPath !== null) {
    return dirname(_configPath);
  }
  return process.cwd();
}

/**
 * 解析路径（支持相对路径和 ~ 展开）
 */
export function resolvePath(inputPath: string): string {
  if (inputPath.startsWith('~')) {
    return join(homedir(), inputPath.slice(1));
  }
  if (inputPath.startsWith('./') || inputPath.startsWith('../')) {
    return resolve(getConfigDir(), inputPath);
  }
  return resolve(inputPath);
}

/**
 * 按优先级查找配置文件
 */
function findConfigFile(): string | null {
  // 1. 显式环境变量
  const envPath = process.env.CONFIG_FILE;
  if (envPath) {
    const expanded = resolvePath(envPath);
    if (existsSync(expanded)) {
      return expanded;
    }
  }

  // 2. 平台配置目录
  if (process.platform === 'win32') {
    // Windows: %APPDATA%\cli-feishu-bridge\config.yaml
    const appdata = process.env.APPDATA || homedir();
    const winConfig = join(appdata, 'cli-feishu-bridge', 'config.yaml');
    if (existsSync(winConfig)) {
      return winConfig;
    }
  } else {
    // Linux/macOS: XDG_CONFIG_HOME (~/.config)
    const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
    const xdgConfig = join(configHome, 'cli-feishu-bridge', 'config.yaml');
    if (existsSync(xdgConfig)) {
      return xdgConfig;
    }
  }

  // 3. 当前工作目录（开发模式）
  const cwdConfig = join(process.cwd(), 'config.yaml');
  if (existsSync(cwdConfig)) {
    return cwdConfig;
  }

  return null;
}

/**
 * 从环境变量加载配置
 */
function loadFromEnv(): Config {
  const parseBool = (val: string | undefined, defaultVal: boolean): boolean => {
    if (val === undefined) return defaultVal;
    return val.toLowerCase() === 'true';
  };

  const parseIntEnv = (val: string | undefined, defaultVal: number): number => {
    if (val === undefined) return defaultVal;
    const parsed = parseInt(val, 10);
    return isNaN(parsed) ? defaultVal : parsed;
  };

  const parseFloatEnv = (val: string | undefined, defaultVal: number): number => {
    if (val === undefined) return defaultVal;
    const parsed = parseFloat(val);
    return isNaN(parsed) ? defaultVal : parsed;
  };

  return {
    feishu: {
      appId: process.env.FEISHU_APP_ID || '',
      appSecret: process.env.FEISHU_APP_SECRET || '',
      encryptKey: process.env.FEISHU_ENCRYPT_KEY,
      verificationToken: process.env.FEISHU_VERIFICATION_TOKEN,
    },
    session: {
      maxSessions: parseIntEnv(process.env.MAX_SESSIONS, DEFAULTS.SESSION_MAX_SESSIONS),
      maxHistory: parseIntEnv(process.env.MAX_HISTORY, DEFAULTS.SESSION_MAX_HISTORY),
    },
    cli: {
      opencode: {
        enabled: parseBool(process.env.OPENCODE_ENABLED, true),
        command: process.env.OPENCODE_CMD || 'opencode',
        defaultModel: process.env.OPENCODE_MODEL || 'kimi-for-coding/k2p5',
        timeout: parseIntEnv(process.env.OPENCODE_TIMEOUT, DEFAULTS.CLI_TIMEOUT),
        models: [],
      },
      codex: {
        enabled: parseBool(process.env.CODEX_ENABLED, false),
        command: process.env.CODEX_CMD || 'codex',
        defaultModel: process.env.CODEX_MODEL || 'gpt-5-codex',
        timeout: parseIntEnv(process.env.CODEX_TIMEOUT, DEFAULTS.CLI_TIMEOUT),
        models: [],
      },
    },
    streaming: {
      updateInterval: parseFloatEnv(process.env.STREAM_INTERVAL, DEFAULTS.STREAMING_UPDATE_INTERVAL),
      minChunkSize: parseIntEnv(process.env.MIN_CHUNK_SIZE, DEFAULTS.STREAMING_MIN_CHUNK_SIZE),
      maxMessageLength: parseIntEnv(process.env.MAX_MSG_LENGTH, DEFAULTS.STREAMING_MAX_MESSAGE_LENGTH),
    },
    debug: {
      logLevel: (process.env.LOG_LEVEL as DebugConfig['logLevel']) || DEFAULTS.DEBUG_LOG_LEVEL,
      saveLogs: parseBool(process.env.SAVE_LOGS, true),
      logDir: process.env.LOG_DIR || '',
    },
    project: {
      storagePath: process.env.PROJECT_STORAGE_PATH || '',
      maxProjects: parseIntEnv(process.env.MAX_PROJECTS, DEFAULTS.PROJECT_MAX_PROJECTS),
    },
    security: {
      allowedProjectRoot: process.env.ALLOWED_PROJECT_ROOT || '/',
      maxAttachmentSize: parseIntEnv(process.env.MAX_ATTACHMENT_SIZE, DEFAULTS.SECURITY_MAX_ATTACHMENT_SIZE),
      maxPromptLength: parseIntEnv(process.env.MAX_PROMPT_LENGTH, DEFAULTS.SECURITY_MAX_PROMPT_LENGTH),
    },
  };
}

/**
 * 解析 CLI 配置
 */
function parseCLIConfig(data: Record<string, unknown>): Record<string, CLIConfig> {
  const configs: Record<string, CLIConfig> = {};

  for (const [name, c] of Object.entries(data)) {
    if (typeof c !== 'object' || c === null) continue;

    const config = c as Record<string, unknown>;
    configs[name] = {
      enabled: config.enabled !== false,
      command: (config.command as string) || name,
      defaultModel: (config.default_model as string) || '',
      timeout: (config.timeout as number) || DEFAULTS.CLI_TIMEOUT,
      models: (config.models as CLIConfig['models']) || [],
    };
  }

  return configs;
}

/**
 * 解析 YAML 配置数据
 */
function parseConfig(data: Record<string, unknown>): Config {
  const feishuData = (data.feishu as Record<string, unknown>) || {};
  const sessionData = (data.session as Record<string, unknown>) || {};
  const cliData = (data.cli as Record<string, unknown>) || {};
  const streamingData = (data.streaming as Record<string, unknown>) || {};
  const debugData = (data.debug as Record<string, unknown>) || {};
  const projectData = (data.project as Record<string, unknown>) || {};
  const securityData = (data.security as Record<string, unknown>) || {};

  return {
    feishu: {
      appId: (feishuData.app_id as string) || '',
      appSecret: (feishuData.app_secret as string) || '',
      encryptKey: feishuData.encrypt_key as string | undefined,
      verificationToken: feishuData.verification_token as string | undefined,
    },
    session: {
      maxSessions: (sessionData.max_sessions as number) || DEFAULTS.SESSION_MAX_SESSIONS,
      maxHistory: (sessionData.max_history as number) || DEFAULTS.SESSION_MAX_HISTORY,
    },
    cli: parseCLIConfig(cliData),
    streaming: {
      updateInterval: (streamingData.update_interval as number) || DEFAULTS.STREAMING_UPDATE_INTERVAL,
      minChunkSize: (streamingData.min_chunk_size as number) || DEFAULTS.STREAMING_MIN_CHUNK_SIZE,
      maxMessageLength: (streamingData.max_message_length as number) || DEFAULTS.STREAMING_MAX_MESSAGE_LENGTH,
    },
    debug: {
      logLevel: (debugData.log_level as DebugConfig['logLevel']) || DEFAULTS.DEBUG_LOG_LEVEL,
      saveLogs: debugData.save_logs !== false,
      logDir: (debugData.log_dir as string) || '',
    },
    project: {
      storagePath: (projectData.storage_path as string) || '',
      maxProjects: (projectData.max_projects as number) || DEFAULTS.PROJECT_MAX_PROJECTS,
    },
    security: {
      allowedProjectRoot: (securityData.allowed_project_root as string) || '/',
      maxAttachmentSize: (securityData.max_attachment_size as number) || DEFAULTS.SECURITY_MAX_ATTACHMENT_SIZE,
      maxPromptLength: (securityData.max_prompt_length as number) || DEFAULTS.SECURITY_MAX_PROMPT_LENGTH,
    },
  };
}

/**
 * 加载配置文件
 * @param configPath - 可选的显式配置文件路径
 * @returns 配置对象
 */
export function loadConfig(configPath?: string): Config {
  let configFile: string | null = null;

  if (configPath !== undefined) {
    const resolved = resolvePath(configPath);
    if (existsSync(resolved)) {
      configFile = resolved;
    }
  } else {
    configFile = findConfigFile();
  }

  if (configFile === null) {
    // 没有找到配置文件，从环境变量加载
    _configPath = null;
    return loadFromEnv();
  }

  _configPath = configFile;

  const content = readFileSync(configFile, 'utf-8');
  const data = loadYaml(content) as Record<string, unknown>;

  return parseConfig(data);
}

// 全局配置实例
let _config: Config | null = null;

/**
 * 获取全局配置（单例模式）
 * 首次调用时自动加载配置
 */
export function getConfig(): Config {
  if (_config === null) {
    _config = loadConfig();
  }
  return _config;
}

/**
 * 重新加载配置
 * 用于配置文件热更新
 */
export function reloadConfig(): Config {
  _config = loadConfig();
  return _config;
}

/**
 * 验证配置是否有效
 * 检查必需的配置项
 */
export function validateConfig(config: Config): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // 检查飞书配置
  if (!config.feishu.appId) {
    errors.push('Missing required config: feishu.app_id');
  }
  if (!config.feishu.appSecret) {
    errors.push('Missing required config: feishu.app_secret');
  }

  // 检查至少有一个 CLI 工具被启用
  const hasEnabledCLI = Object.values(config.cli).some(c => c.enabled);
  if (!hasEnabledCLI) {
    errors.push('At least one CLI adapter must be enabled');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
