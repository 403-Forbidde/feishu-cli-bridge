import { confirm, select } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';

import { OpenCodeProvider } from '../cli-provider/providers/opencode.js';
import { ClaudeCodeProvider } from '../cli-provider/providers/claude.js';
import type { ICLIProvider, CLICheckResult, AuthStatus, InstallMethod, CLIConfig } from '../cli-provider/interface.js';
import { safeSelect } from './safe-select.js';

export interface CliSetupResult {
  success: boolean;
  provider?: ICLIProvider;
  configs?: Record<string, CLIConfig>;
}

export async function runCliSetup(): Promise<CliSetupResult> {
  // 检测所有可用的 CLI 工具
  const providers = [new OpenCodeProvider(), new ClaudeCodeProvider()];
  const availableProviders: ICLIProvider[] = [];

  console.log(chalk.bold('\n🔧 CLI 工具检测'));
  console.log('─'.repeat(40));

  for (const provider of providers) {
    const spinner = ora(`检测 ${provider.displayName}...`).start();
    const checkResult = await provider.check();
    spinner.stop();

    if (checkResult.installed) {
      console.log(`  ${provider.displayName}: ${chalk.green('已安装')} ${chalk.dim(`(${checkResult.version})`)}`);
      availableProviders.push(provider);
    } else {
      console.log(`  ${provider.displayName}: ${chalk.yellow('未安装')}`);
    }
  }

  console.log('─'.repeat(40));

  // 如果没有检测到任何 CLI 工具，提示用户安装
  if (availableProviders.length === 0) {
    console.log(chalk.yellow('\n⚠️ 未检测到任何支持的 CLI 工具'));
    console.log(chalk.cyan('\n可用的 CLI 工具：'));
    console.log('  1. OpenCode - https://opencode.ai');
    console.log('  2. Claude Code - https://claude.ai/code');
    console.log(chalk.dim('\n请至少安装一个 CLI 工具后重新运行配置向导。'));
    return { success: false };
  }

  // 让用户选择要配置的 CLI 工具
  let selectedProvider: ICLIProvider;

  if (availableProviders.length === 1) {
    selectedProvider = availableProviders[0];
    console.log(chalk.green(`\n自动选择: ${selectedProvider.displayName}`));
  } else {
    const providerChoice = await select({
      message: '选择要配置的 CLI 工具',
      choices: availableProviders.map((p) => ({
        name: p.displayName,
        value: p.id,
        description: `配置 ${p.displayName} 作为默认 AI 工具`,
      })),
    });
    selectedProvider = availableProviders.find((p) => p.id === providerChoice)!;
  }

  // 运行所选 CLI 工具的配置流程
  const config = await configureProvider(selectedProvider);

  if (!config) {
    return { success: false };
  }

  // 询问是否启用其他检测到的 CLI 工具
  const configs: Record<string, CLIConfig> = {
    [selectedProvider.id]: config,
  };

  const otherProviders = availableProviders.filter((p) => p.id !== selectedProvider.id);
  for (const provider of otherProviders) {
    const enableOther = await confirm({
      message: `是否同时启用 ${provider.displayName}（可作为备用）？`,
      default: false,
    });

    if (enableOther) {
      const otherConfig = provider.getDefaultConfig();
      otherConfig.enabled = true;
      configs[provider.id] = otherConfig;
    } else {
      configs[provider.id] = { ...provider.getDefaultConfig(), enabled: false };
    }
  }

  return {
    success: true,
    provider: selectedProvider,
    configs,
  };
}

async function configureProvider(provider: ICLIProvider): Promise<CLIConfig | null> {
  const checkResult = await provider.check();
  printCheckResult(provider, checkResult);

  // 对于 Claude Code，检测并显示第三方 Provider 信息
  if (provider.id === 'claude') {
    const claudeProvider = provider as import('../cli-provider/providers/claude.js').ClaudeCodeProvider;
    const providerInfo = await claudeProvider.detectProvider();

    console.log(chalk.bold('\n🌐 API Provider 检测'));
    console.log('─'.repeat(40));

    if (providerInfo?.isThirdParty) {
      console.log(`  当前 Provider: ${chalk.green(providerInfo.name)}`);
      console.log(`  API 地址: ${chalk.dim(providerInfo.url)}`);
      console.log(`  可用模型: ${providerInfo.models.join(', ')}`);
    } else {
      console.log(`  当前 Provider: ${chalk.cyan('Anthropic 官方')}`);
      console.log(chalk.dim('  提示: 如需使用第三方 API（如 Kimi），请参考后续的认证步骤'));
    }
    console.log('─'.repeat(40));
  }

  if (!checkResult.installed || !checkResult.meetsRequirements) {
    const installReady = await promptInstallGuide(provider, checkResult);

    if (!installReady) {
      return null;
    }

    // Re-check after user manually installed
    const retrySpinner = ora('重新检测 CLI 工具...').start();
    const retryResult = await provider.check();
    retrySpinner.stop();
    printCheckResult(provider, retryResult);

    if (!retryResult.meetsRequirements) {
      console.log(chalk.red('\n仍未检测到满足要求的 CLI 工具。请检查安装是否成功，然后重新运行配置向导。'));
      console.log(chalk.dim(`\n文档地址: ${provider.docsUrl}`));
      return null;
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
          return null;
        }
      } else {
        console.log(chalk.green('登录成功'));
      }
    }
  }

  return await selectModelAndComplete(provider);
}

async function selectModelAndComplete(provider: ICLIProvider): Promise<CLIConfig | null> {
  // 首先尝试读取用户已有的默认模型配置
  const userModelSpinner = ora('读取用户默认模型配置...').start();
  const userDefaultModel = await provider.getUserDefaultModel();
  userModelSpinner.stop();

  let selectedModel: string;

  // 如果用户已配置默认模型，询问是否使用
  if (userDefaultModel) {
    console.log(chalk.green(`  检测到默认模型: ${userDefaultModel}`));
    const useExisting = await confirm({
      message: '是否使用该模型作为桥接服务的默认模型？',
      default: true,
    });

    if (useExisting) {
      selectedModel = userDefaultModel;
      console.log(chalk.green(`  已选择使用现有模型: ${selectedModel}\n`));
    } else {
      // 用户选择不使用，继续从列表选择
      selectedModel = await promptModelSelection(provider);
    }
  } else {
    // 用户没有配置默认模型，从列表选择
    console.log(chalk.yellow('  未检测到默认模型配置'));
    console.log(chalk.cyan('  ℹ️  您需要选择一个模型作为桥接服务的默认模型'));
    console.log(chalk.dim('     （选择后可在配置文件中随时修改）'));
    console.log('');
    selectedModel = await promptModelSelection(provider);
  }

  const defaultConfig = provider.getDefaultConfig();
  const config: CLIConfig = {
    ...defaultConfig,
    default_model: selectedModel,
  };

  return config;
}

/**
 * 提示用户从模型列表中选择
 */
async function promptModelSelection(provider: ICLIProvider): Promise<string> {
  const modelSpinner = ora('获取可用模型列表...').start();
  const models = await provider.fetchModels();
  modelSpinner.stop();

  if (models.length === 0) {
    // 如果没有获取到模型，提示用户并退出
    console.log(chalk.red('  错误：无法获取可用模型列表'));
    console.log(chalk.dim(`  请检查 ${provider.displayName} CLI 是否已正确安装和登录`));
    console.log(chalk.dim('  或者稍后手动编辑配置文件设置模型'));
    process.exit(1);
  }

  // 显示找到的模型数量
  console.log(chalk.green(`  找到 ${models.length} 个可用模型`));
  console.log('');
  console.log(chalk.cyan('  ℹ️  请从列表中选择默认使用的模型'));
  console.log(chalk.dim('     （选择后可在配置文件中随时修改）'));
  console.log('');

  // 让用户选择模型
  const modelChoices = models.map((m) => ({
    name: `${m.name} (${m.id})`,
    value: m.id,
    description: `提供商: ${m.provider || 'unknown'}${m.isFree ? ' | 免费' : ''}`,
  }));

  const selectedModel = await select({
    message: '选择默认使用的模型',
    choices: modelChoices,
  });

  console.log(chalk.green(`  已选择: ${selectedModel}\n`));
  return selectedModel;
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
