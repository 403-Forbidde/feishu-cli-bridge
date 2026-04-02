import { select, confirm, input } from '@inquirer/prompts';
import chalk from 'chalk';
import process from 'node:process';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { SystemdServiceManager } from '../service-manager/platforms/systemd.js';
import { LaunchdServiceManager } from '../service-manager/platforms/launchd.js';
import type { ServiceMode, RunOption, ServiceConfig } from '../service-manager/types.js';

export interface ServiceSetupResult {
  mode: ServiceMode;
  config: ServiceConfig;
}

export async function runServiceConfig(
  workingDirectory: string,
  cliCommand = 'node',
  cliArgs = ['dist/main.js']
): Promise<ServiceSetupResult> {
  const options = await buildOptions();

  console.log('');
  console.log(chalk.bold('⚙️ 服务运行方式配置'));
  console.log('─'.repeat(40));

  const availableOptions = options.filter((o) => o.available);
  if (availableOptions.length === 0) {
    console.log(chalk.yellow('未检测到可用的服务管理器，使用前台运行模式'));
    return {
      mode: 'foreground',
      config: buildServiceConfig('foreground', workingDirectory, cliCommand, cliArgs),
    };
  }

  const choice = await select({
    message: '选择运行方式',
    choices: availableOptions.map((o) => ({
      name: `${o.displayName}${o.requiresAdmin ? ' [需管理员权限]' : ''}`,
      value: o.id,
      description: o.description,
    })),
  });

  const selectedMode = choice as ServiceMode;
  const requiresAdmin = availableOptions.find((o) => o.id === selectedMode)?.requiresAdmin ?? false;

  if (requiresAdmin) {
    console.log(chalk.yellow('\n⚠️ 该选项需要管理员权限，安装/启动服务时可能需要输入密码\n'));
  }

  // Service parameters
  const serviceName = await input({
    message: '服务名称',
    default: 'feishu-cli-bridge',
  });

  const defaultLogDir = join(homedir(), '.feishu-bridge', 'logs');
  const logDirectory = await input({
    message: '日志目录',
    default: defaultLogDir,
  });

  const autoRestart = await confirm({
    message: '是否启用自动重启？',
    default: true,
  });

  const startOnBoot = await confirm({
    message: '是否开机自启？',
    default: true,
  });

  const config: ServiceConfig = {
    serviceName: serviceName.trim(),
    workingDirectory,
    command: cliCommand,
    args: cliArgs,
    env: {},
    logDirectory: logDirectory.trim(),
    autoRestart,
    startOnBoot,
  };

  // Preview
  console.log('');
  console.log(chalk.bold('📋 服务配置预览'));
  console.log('─'.repeat(40));
  console.log(`  运行方式: ${selectedMode}`);
  console.log(`  服务名称: ${config.serviceName}`);
  console.log(`  工作目录: ${config.workingDirectory}`);
  console.log(`  启动命令: ${config.command} ${config.args.join(' ')}`);
  console.log(`  日志目录: ${config.logDirectory}`);
  console.log(`  自动重启: ${config.autoRestart ? '是' : '否'}`);
  console.log(`  开机自启: ${config.startOnBoot ? '是' : '否'}`);
  console.log('─'.repeat(40));
  console.log('');

  const proceed = await confirm({
    message: '确认以上配置？',
    default: true,
  });

  if (!proceed) {
    return runServiceConfig(workingDirectory, cliCommand, cliArgs);
  }

  return { mode: selectedMode, config };
}

async function buildOptions(): Promise<RunOption[]> {
  const systemd = new SystemdServiceManager();
  const launchd = new LaunchdServiceManager();

  const options: RunOption[] = [];

  options.push({
    id: 'foreground',
    displayName: '前台运行（手动启动）',
    description: '不安装系统服务，需要时手动运行 npm start',
    available: true,
    requiresAdmin: false,
  });

  if (await systemd.isAvailable()) {
    options.push(...systemd.getAvailableOptions());
  }

  if (await launchd.isAvailable()) {
    options.push(...launchd.getAvailableOptions());
  }

  return options;
}

function buildServiceConfig(
  mode: ServiceMode,
  workingDirectory: string,
  cliCommand: string,
  cliArgs: string[]
): ServiceConfig {
  return {
    serviceName: 'feishu-cli-bridge',
    workingDirectory,
    command: cliCommand,
    args: cliArgs,
    env: {},
    logDirectory: join(homedir(), '.feishu-bridge', 'logs'),
    autoRestart: mode !== 'foreground',
    startOnBoot: mode !== 'foreground',
  };
}
