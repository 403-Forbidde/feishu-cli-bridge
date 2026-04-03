import { confirm, select } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';

import { OpenCodeProvider } from '../cli-provider/providers/opencode.js';
import type { ICLIProvider, CLICheckResult, AuthStatus, InstallMethod } from '../cli-provider/interface.js';
import { safeSelect } from './safe-select.js';

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

  printCheckResult(provider, checkResult);

  if (!checkResult.installed || !checkResult.meetsRequirements) {
    const installReady = await promptInstallGuide(provider, checkResult);

    if (!installReady) {
      return { success: false };
    }

    // Re-check after user manually installed
    const retrySpinner = ora('重新检测 CLI 工具...').start();
    const retryResult = await provider.check();
    retrySpinner.stop();
    printCheckResult(provider, retryResult);

    if (!retryResult.meetsRequirements) {
      console.log(chalk.red('\n仍未检测到满足要求的 CLI 工具。请检查安装是否成功，然后重新运行配置向导。'));
      console.log(chalk.dim(`\n文档地址: ${provider.docsUrl}`));
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

  return await selectModelAndComplete(provider);
}

async function selectModelAndComplete(provider: ICLIProvider): Promise<CliSetupResult> {
  // Model selection: fetch free models from opencode and let user choose
  const modelSpinner = ora('获取可用模型列表...').start();
  const freeModels = await provider.fetchModels();
  modelSpinner.stop();

  let selectedModel: string;

  if (freeModels.length === 0) {
    // 如果没有获取到免费模型，使用默认配置
    const defaultConfig = provider.getDefaultConfig();
    selectedModel = defaultConfig.default_model;
    console.log(chalk.yellow('  未找到免费模型，使用默认模型'));
    console.log(chalk.dim(`  默认模型: ${selectedModel}（如需更改可后续手动修改配置文件）\n`));
  } else {
    // 显示找到的免费模型数量
    console.log(chalk.green(`  找到 ${freeModels.length} 个免费模型`));
    console.log('');

    // 让用户选择模型
    const modelChoices = freeModels.map((m) => ({
      name: `${m.name} (${m.id})`,
      value: m.id,
      description: `提供商: ${m.provider || 'unknown'}`,
    }));

    selectedModel = await select({
      message: '选择默认使用的模型',
      choices: modelChoices,
    });

    console.log(chalk.green(`  已选择: ${selectedModel}\n`));
  }

  const defaultConfig = provider.getDefaultConfig();
  const config = {
    ...defaultConfig,
    default_model: selectedModel,
  };

  return {
    success: true,
    provider,
    config,
  };
}

function printCheckResult(provider: ICLIProvider, result: CLICheckResult): void {
  console.log('');
  console.log(chalk.bold(`🔧 ${provider.displayName} 检测结果`));
  console.log('─'.repeat(40));

  if (result.installed) {
    const versionColor = result.meetsRequirements ? chalk.green : chalk.red;
    console.log(`  状态: ${chalk.green('已安装')}`);
    console.log(`  版本: ${versionColor(result.version || 'unknown')}`);
    if (result.path) {
      console.log(`  路径: ${chalk.dim(result.path)}`);
    }
    if (!result.meetsRequirements) {
      console.log(`  要求: ${chalk.yellow(`版本 >= ${provider.minVersion || 'unknown'}`)}`);
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

/**
 * 显示安装指南，引导用户手动安装 CLI 工具
 * 注意：我们不自动执行安装，以避免环境冲突和权限问题
 */
async function promptInstallGuide(
  provider: ICLIProvider,
  checkResult: CLICheckResult
): Promise<boolean> {
  const methods = provider.getInstallMethods();
  if (methods.length === 0) {
    console.log(chalk.red('未找到适合当前平台的安装方式'));
    console.log(chalk.dim(`请访问官方文档获取安装指南: ${provider.docsUrl}`));
    return false;
  }

  console.log(chalk.yellow('⚠️ CLI 工具未安装或版本过低'));
  console.log('');
  console.log(chalk.bold('本向导将引导您手动安装，以避免环境冲突。'));
  console.log(chalk.dim('（自动安装可能导致权限问题或与现有环境冲突）'));
  console.log('');

  // 根据检测结果给出提示
  if (checkResult.installed && !checkResult.meetsRequirements) {
    console.log(chalk.yellow(`当前版本 ${checkResult.version} 不满足要求，需要 >= ${provider.minVersion}`));
    console.log('');
  }

  const choice = await safeSelect({
    message: '选择适合您的安装方式',
    choices: methods.map((m) => ({
      name: `${m.displayName}`,
      value: m.id,
      description: m.description,
    })),
  });

  const method = methods.find((m) => m.id === choice);
  if (!method) {
    return false;
  }

  return await showInstallInstructions(method, provider);
}

/**
 * 显示具体安装命令和说明，等待用户手动完成
 */
async function showInstallInstructions(
  method: InstallMethod,
  provider: ICLIProvider
): Promise<boolean> {
  console.log('');
  console.log(chalk.bold('📋 安装指南'));
  console.log('─'.repeat(50));
  console.log('');
  console.log(chalk.cyan('请执行以下命令完成安装：'));
  console.log('');
  console.log(chalk.bgGray(chalk.black(`  ${method.command}  `)));
  console.log('');

  if (method.platform?.includes('win32')) {
    console.log(chalk.dim('Windows 提示：'));
    console.log(chalk.dim('  - 在 PowerShell 或 CMD 中运行上述命令'));
    console.log(chalk.dim('  - 安装完成后可能需要重启终端'));
  } else {
    console.log(chalk.dim('macOS/Linux 提示：'));
    console.log(chalk.dim('  - 如果提示权限不足，请在命令前加 sudo'));
    console.log(chalk.dim('  - 安装完成后可能需要重新加载 shell 配置'));
  }

  console.log('');
  console.log(chalk.dim(`官方文档: ${provider.docsUrl}`));
  console.log('');
  console.log('─'.repeat(50));
  console.log('');

  const ready = await confirm({
    message: '安装完成后，是否继续？',
    default: true,
  });

  if (!ready) {
    console.log(chalk.yellow('\n您可以稍后重新运行配置向导完成设置。'));
    console.log(chalk.dim(`运行命令: npm run setup`));
    return false;
  }

  return true;
}
