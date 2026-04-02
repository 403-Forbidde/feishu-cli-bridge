import process from 'node:process';
import { select, confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';

import { OpenCodeProvider } from '../cli-provider/providers/opencode.js';
import type { ICLIProvider, CLICheckResult, AuthStatus } from '../cli-provider/interface.js';

export interface CliSetupResult {
  success: boolean;
  provider?: ICLIProvider;
  config?: ReturnType<ICLIProvider['getDefaultConfig']>;
}

export async function runCliSetup(): Promise<CliSetupResult> {
  const provider = new OpenCodeProvider();

  const spinner = ora('检测 CLI 工具中...').start();
  const checkResult = await provider.check();
  spinner.stop();

  printCheckResult(provider.displayName, checkResult);

  if (!checkResult.installed || !checkResult.meetsRequirements) {
    const shouldInstall = await confirm({
      message: `${provider.displayName} 未安装或版本过低，是否安装？`,
      default: true,
    });

    if (shouldInstall) {
      const installSuccess = await promptInstallCli(provider);
      if (!installSuccess) {
        return { success: false };
      }
      // Re-check
      const retrySpinner = ora('重新检测 CLI 工具...').start();
      const retryResult = await provider.check();
      retrySpinner.stop();
      printCheckResult(provider.displayName, retryResult);
      if (!retryResult.meetsRequirements) {
        return { success: false };
      }
    } else {
      return { success: false };
    }
  }

  // Auth check
  const authSpinner = ora('检查登录状态...').start();
  const authStatus = await provider.getAuthStatus();
  authSpinner.stop();
  printAuthStatus(authStatus);

  if (!authStatus.authenticated) {
    const shouldLogin = await confirm({
      message: '尚未登录，是否现在登录？',
      default: true,
    });

    if (shouldLogin) {
      const loginSpinner = ora('等待登录完成...').start();
      const loginSuccess = await provider.login();
      loginSpinner.stop();
      if (!loginSuccess) {
        console.log(chalk.red('登录失败或已取消'));
        const continueAnyway = await confirm({
          message: '是否继续配置（可稍后手动登录）？',
          default: true,
        });
        if (!continueAnyway) {
          return { success: false };
        }
      } else {
        console.log(chalk.green('登录成功'));
      }
    }
  }

  // Model selection
  const modelSpinner = ora('获取模型列表...').start();
  const models = await provider.fetchModels();
  modelSpinner.stop();

  const defaultConfig = provider.getDefaultConfig();
  let selectedModel = defaultConfig.default_model;

  if (models.length > 0) {
    selectedModel = await select({
      message: '选择默认模型',
      choices: models.map((m) => ({
        name: m.provider ? `${m.name} (${m.provider})` : m.name,
        value: m.id,
        description: m.id,
      })),
      default: defaultConfig.default_model,
    });
  }

  const config = {
    ...defaultConfig,
    default_model: selectedModel,
  };

  console.log(chalk.green(`\n已选择默认模型: ${selectedModel}\n`));

  return {
    success: true,
    provider,
    config,
  };
}

function printCheckResult(name: string, result: CLICheckResult): void {
  console.log('');
  console.log(chalk.bold(`🔧 ${name} 检测结果`));
  console.log('─'.repeat(40));

  if (result.installed) {
    const versionColor = result.meetsRequirements ? chalk.green : chalk.red;
    console.log(`  状态: ${chalk.green('已安装')}`);
    console.log(`  版本: ${versionColor(result.version || 'unknown')}`);
    if (result.path) {
      console.log(`  路径: ${chalk.dim(result.path)}`);
    }
  } else {
    console.log(`  状态: ${chalk.red('未安装')}`);
  }

  console.log('─'.repeat(40));
  console.log('');
}

function printAuthStatus(status: AuthStatus): void {
  if (status.authenticated) {
    console.log(chalk.green(`  登录状态: 已登录${status.user ? ` (${status.user})` : ''}`));
  } else {
    console.log(chalk.red('  登录状态: 未登录'));
  }
  console.log('');
}

async function promptInstallCli(provider: ICLIProvider): Promise<boolean> {
  const methods = provider.getInstallMethods();
  if (methods.length === 0) {
    console.log(chalk.red('未找到适合当前平台的安装方式'));
    return false;
  }

  const choice = await select({
    message: '选择安装方式',
    choices: methods.map((m) => ({
      name: `${m.displayName} - ${m.description}`,
      value: m.id,
      description: m.command,
    })),
  });

  const method = methods.find((m) => m.id === choice);
  if (!method) {
    return false;
  }

  // 询问是否自动执行
  const autoRun = await confirm({
    message: '是否自动执行安装命令？（选择否则将显示命令供手动执行）',
    default: true,
  });

  if (autoRun) {
    const installSpinner = ora('正在安装...').start();
    const result = await provider.install(method.id);
    installSpinner.stop();
    if (!result.success) {
      console.log(chalk.red(`安装失败: ${result.error || '未知错误'}`));
      return false;
    }
    console.log(chalk.green('安装命令执行完成'));
    return true;
  }

  console.log(chalk.yellow('\n请执行以下命令安装：\n'));
  console.log(chalk.bgGray(`  ${method.command}  \n`));
  console.log(chalk.dim('安装完成后，按回车继续...'));
  process.stdin.setRawMode(true);
  await new Promise<void>((resolve) => {
    process.stdin.once('data', () => {
      process.stdin.setRawMode(false);
      resolve();
    });
  });

  return true;
}
