import process from 'node:process';
import { select, confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import { execa } from 'execa';

import { checkNode, getNodeInstallMethods } from '../environment/node-checker.js';
import type { NodeCheckResult } from '../environment/interface.js';

export interface NodeSetupResult {
  success: boolean;
  nodeOk: boolean;
  npmRegistry?: string;
}

export async function runNodeSetup(): Promise<NodeSetupResult> {
  const spinner = ora('检测 Node.js 环境中...').start();
  const checkResult = await checkNode();
  spinner.stop();

  printCheckResult(checkResult);

  if (!checkResult.installed) {
    console.log(chalk.red('\n❌ 未检测到 Node.js 环境。'));
    console.log(chalk.dim('安装向导本身需要 Node.js 才能运行。请使用以下方式安装：'));
    console.log(chalk.dim('  • Linux/macOS: curl -fsSL .../scripts/setup.sh | bash'));
    console.log(chalk.dim('  • Windows: 下载并运行 scripts/setup.bat'));
    console.log(chalk.dim('  • 或手动安装 Node.js >= 20.0.0 后重试\n'));
    return { success: false, nodeOk: false };
  }

  if (!checkResult.meetsRequirements) {
    console.log(chalk.red(`\n❌ Node.js v${checkResult.version} 版本过低，需要 >= 20.0.0`));
    console.log(chalk.dim('由于当前向导已在运行，无法直接替换 Node.js 版本。'));
    console.log(chalk.dim('请先升级 Node.js，然后重新运行本向导。\n'));
    console.log(chalk.yellow('建议升级方式：'));
    const methods = getNodeInstallMethods();
    for (const m of methods.slice(0, 3)) {
      console.log(chalk.dim(`  • ${m.displayName}: ${m.command}`));
    }
    console.log('');
    return { success: false, nodeOk: false };
  }

  let npmRegistry = checkResult.npmRegistry;
  if (checkResult.npmAvailable) {
    const registry = await promptNpmRegistry(checkResult.npmRegistry);
    npmRegistry = registry;
  }

  return { success: true, nodeOk: true, npmRegistry };
}

function printCheckResult(result: NodeCheckResult): void {
  console.log('');
  console.log(chalk.bold('📦 Node.js 环境检测结果'));
  console.log('─'.repeat(40));

  if (result.installed) {
    const versionColor = result.meetsRequirements ? chalk.green : chalk.red;
    console.log(`  Node.js: ${versionColor(`v${result.version}`)}`);
  } else {
    console.log(`  Node.js: ${chalk.red('未安装')}`);
  }

  console.log(`  npm: ${result.npmAvailable ? chalk.green('可用') : chalk.red('不可用')}`);
  if (result.npmAvailable && result.npmRegistry) {
    console.log(`  当前镜像源: ${chalk.cyan(result.npmRegistry)}`);
  }
  if (result.packageManager) {
    console.log(`  系统包管理器: ${chalk.cyan(result.packageManager)}`);
  }
  console.log(`  版本要求: >= v20.0.0 ${result.meetsRequirements ? chalk.green('✅') : chalk.red('❌')}`);
  console.log('─'.repeat(40));
  console.log('');
}

async function promptInstallNode(): Promise<boolean> {
  const methods = getNodeInstallMethods();
  if (methods.length === 0) {
    console.log(chalk.red('未找到适合当前平台的安装方式，请手动安装 Node.js >= 20.0.0'));
    return false;
  }

  const choice = await select({
    message: '选择 Node.js 安装方式',
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

  console.log(chalk.yellow('\n请执行以下命令安装 Node.js：\n'));
  console.log(chalk.bgGray(`  ${method.command}  \n`));
  console.log(chalk.dim('安装完成后，按回车继续...'));
  // Pause for user to press enter
  process.stdin.setRawMode(true);
  await new Promise<void>((resolve) => {
    process.stdin.once('data', () => {
      process.stdin.setRawMode(false);
      resolve();
    });
  });

  return true;
}

async function promptNpmRegistry(currentRegistry?: string): Promise<string | undefined> {
  const isTaoBao = currentRegistry?.includes('taobao') || currentRegistry?.includes('npmmirror');
  const switchMirror = await confirm({
    message: isTaoBao ? '当前使用的是国内镜像，是否切换回官方镜像？' : '是否切换到 npm 国内镜像（淘宝）？',
    default: false,
  });

  if (!switchMirror) {
    return currentRegistry;
  }

  const targetRegistry = isTaoBao
    ? 'https://registry.npmjs.org/'
    : 'https://registry.npmmirror.com';

  const spinner = ora(`切换 npm 镜像源为 ${targetRegistry}...`).start();
  try {
    await execa('npm', ['config', 'set', 'registry', targetRegistry], { reject: false });
    spinner.succeed('镜像源切换成功');
    return targetRegistry;
  } catch (error) {
    spinner.fail('镜像源切换失败');
    return currentRegistry;
  }
}
