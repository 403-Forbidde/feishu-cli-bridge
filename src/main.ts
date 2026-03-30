#!/usr/bin/env node
/**
 * Feishu CLI Bridge - Node.js/TypeScript Edition
 * 主入口文件
 *
 * 负责：
 * 1. 加载配置
 * 2. 初始化日志
 * 3. 创建并初始化所有管理器
 * 4. 启动 WebSocket 连接
 * 5. 处理信号和优雅退出
 */

import { loadConfig, validateConfig } from './core/config.js';
import { logger } from './core/logger.js';
import { FeishuClient } from './platform/feishu-client.js';
import { FeishuAPI } from './platform/feishu-api.js';
import { MessageProcessor } from './platform/message-processor/index.js';
import { SessionManager } from './session/manager.js';
import { ProjectManager } from './project/manager.js';
import { createAdapter, getEnabledAdapters } from './adapters/factory.js';
import './adapters/index.js'; // 导入以注册适配器
import type { Config } from './core/types/config.js';
import type { ICLIAdapter } from './adapters/interface/types.js';

/**
 * 应用程序上下文
 */
interface AppContext {
  config: Config;
  feishuClient: FeishuClient;
  feishuAPI: FeishuAPI;
  sessionManager: SessionManager;
  projectManager: ProjectManager;
  adapters: Map<string, ICLIAdapter>;
  messageProcessor: MessageProcessor;
}

/**
 * 初始化应用程序
 */
async function initializeApp(): Promise<AppContext> {
  logger.info('========================================');
  logger.info('Feishu CLI Bridge 启动中...');
  logger.info(`Node.js 版本: ${process.version}`);
  logger.info(`平台: ${process.platform}`);
  logger.info('========================================');

  // 1. 加载配置
  logger.info('加载配置...');
  const config = loadConfig();

  // 2. 验证配置
  const validation = validateConfig(config);
  if (!validation.valid) {
    logger.error('配置验证失败:');
    for (const error of validation.errors) {
      logger.error(`  - ${error}`);
    }
    throw new Error('Invalid configuration');
  }

  logger.info(
    {
      feishuAppId: config.feishu.appId ? '***已设置***' : '未设置',
      opencodeEnabled: config.cli.opencode?.enabled || false,
      maxSessions: config.session.maxSessions,
      logLevel: config.debug.logLevel,
    },
    '配置加载成功'
  );

  // 3. 创建飞书 API 客户端
  logger.info('初始化飞书 API 客户端...');
  const feishuAPI = new FeishuAPI(
    config.feishu.appId,
    config.feishu.appSecret
  );

  // 4. 创建适配器
  logger.info('创建适配器...');
  const adapters = new Map<string, ICLIAdapter>();
  const enabledAdapters = getEnabledAdapters(config);

  for (const adapterName of enabledAdapters) {
    const adapter = createAdapter(adapterName, config);
    if (adapter) {
      adapters.set(adapterName, adapter);
      logger.info({ adapter: adapterName }, '适配器已创建');
    } else {
      logger.warn({ adapter: adapterName }, '适配器创建失败');
    }
  }

  if (adapters.size === 0) {
    throw new Error('没有可用的适配器');
  }

  // 5. 创建管理器
  logger.info('初始化管理器...');

  const sessionManager = new SessionManager(config.session);

  const projectManager = new ProjectManager({
    storagePath: config.project.storagePath,
    maxProjects: config.project.maxProjects,
    allowedRoot: config.security.allowedProjectRoot,
  });
  await projectManager.load();

  logger.info(
    {
      projectCount: projectManager.getProjectCount(),
      currentProject: projectManager.getCurrentProjectId(),
    },
    '项目管理器已加载'
  );

  // 6. 创建消息处理器
  logger.info('初始化消息处理器...');
  const defaultAdapterType = enabledAdapters[0];
  const useCardKit = process.env.DISABLE_CARDKIT !== '1';

  const messageProcessor = new MessageProcessor({
    feishuAPI,
    sessionManager,
    projectManager,
    adapters,
    defaultAdapterType,
    maxPromptLength: config.security.maxPromptLength,
    maxAttachmentSize: config.security.maxAttachmentSize,
    useCardKit,
  });

  // 7. 创建飞书 WebSocket 客户端
  logger.info('初始化飞书 WebSocket 客户端...');
  const feishuClient = new FeishuClient({
    appId: config.feishu.appId,
    appSecret: config.feishu.appSecret,
    encryptKey: config.feishu.encryptKey,
    verificationToken: config.feishu.verificationToken,
  });

  // 8. 注册事件处理器
  feishuClient.onMessage(async (message) => {
    await messageProcessor.process(message);
  });

  feishuClient.onCardCallback(async (event) => {
    try {
      return await messageProcessor.processCardCallback(event);
    } catch (error) {
      logger.error({ error }, '卡片回调处理错误');
      return {};
    }
  });

  feishuClient.on('connect', () => {
    logger.info('飞书 WebSocket 连接成功');
  });

  feishuClient.on('disconnect', () => {
    logger.warn('飞书 WebSocket 连接断开');
  });

  feishuClient.on('error', (error) => {
    logger.error({ error }, '飞书客户端错误');
  });

  return {
    config,
    feishuClient,
    feishuAPI,
    sessionManager,
    projectManager,
    adapters,
    messageProcessor,
  };
}

/**
 * 启动 WebSocket 连接
 */
async function startWebSocket(context: AppContext): Promise<void> {
  logger.info('启动 WebSocket 连接...');

  try {
    await context.feishuClient.start();
    logger.info('========================================');
    logger.info('Feishu CLI Bridge 启动成功！');
    logger.info('========================================');
  } catch (error) {
    logger.error({ error }, 'WebSocket 连接失败');
    throw error;
  }
}

/**
 * 设置信号处理
 */
function setupSignalHandlers(context: AppContext): void {
  const gracefulShutdown = async (signal: string) => {
    logger.info({ signal }, '收到关闭信号，正在优雅退出...');

    try {
      // 停止 WebSocket 客户端
      context.feishuClient.stop();

      // 保存项目配置
      await context.projectManager.save();

      logger.info('优雅退出完成');
      process.exit(0);
    } catch (error) {
      logger.error({ error }, '优雅退出失败');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

  // 处理未捕获的异常
  process.on('uncaughtException', (error) => {
    logger.fatal({ error }, '未捕获的异常');
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error({ reason, promise }, '未处理的 Promise 拒绝');
  });
}

/**
 * 主函数
 */
async function main(): Promise<void> {
  let context: AppContext | null = null;

  try {
    // 初始化应用
    context = await initializeApp();

    // 设置信号处理
    setupSignalHandlers(context);

    // 启动 WebSocket
    await startWebSocket(context);

    // 保持进程运行
    await new Promise(() => {
      // 无限等待，由信号处理程序终止
    });
  } catch (error) {
    logger.fatal({ error }, '应用程序启动失败');
    process.exit(1);
  }
}

// 启动应用
main().catch((error: unknown) => {
  console.error('[Feishu CLI Bridge] 致命错误:', error);
  process.exit(1);
});
