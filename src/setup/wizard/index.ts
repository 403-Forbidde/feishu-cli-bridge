import chalk from 'chalk';
import ora from 'ora';
import boxen from 'boxen';
import { homedir } from 'node:os';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { showWelcome } from './welcome.js';
import { runNodeSetup } from './node-setup.js';
import { runCliSetup } from './cli-setup.js';
import { runFeishuConfig, type FeishuConfig } from './feishu-config.js';
import { runServiceConfig, type ServiceSetupResult } from './service-config.js';
import { writeConfigFile, type FullConfig } from '../writers/config-file.js';
import { installService, startService } from '../writers/service-files.js';
import { getDefaultConfigPath } from '../../core/config.js';

export async function runWizard(): Promise<void> {
  await showWelcome();

  // Phase 2: Node.js
  const nodeResult = await runNodeSetup();
  if (!nodeResult.success) {
    console.log(chalk.red('\nNode.js 环境检查未通过，安装向导退出'));
    console.log(chalk.dim('请手动安装 Node.js >= 20.0.0 后重试'));
    process.exit(1);
  }

  // Phase 3: CLI setup
  const cliResult = await runCliSetup();
  if (!cliResult.success || !cliResult.config) {
    console.log(chalk.red('\nCLI 工具配置未完成，安装向导退出'));
    process.exit(1);
  }

  // Phase 4: Feishu config
  const feishuConfig = await runFeishuConfig();

  // Phase 5 & 6: Service config
  const workingDirectory = resolve(process.cwd());
  const serviceResult = await runServiceConfig(workingDirectory, 'node', ['dist/main.js']);

  // Phase 6: Write config and install service
  const configPath = getDefaultConfigPath();

  const fullConfig: FullConfig = {
    feishu: feishuConfig,
    cli: {
      opencode: cliResult.config,
    },
    debug: {
      log_level: 'info',
      save_logs: true,
      log_dir: join(homedir(), '.feishu-bridge', 'logs'),
    },
    project: {
      storage_path: join(homedir(), '.feishu-bridge', 'projects'),
    },
    security: {
      allowed_project_root: homedir(),
    },
    session: {
      max_sessions: 15,
      max_history: 20,
    },
    streaming: {
      update_interval: 0.3,
      min_chunk_size: 20,
      max_message_length: 8000,
    },
  };

  const saveSpinner = ora('保存配置文件中...').start();
  try {
    writeConfigFile(fullConfig, configPath);
    saveSpinner.succeed(`配置文件已保存至 ${configPath}`);
  } catch (error) {
    saveSpinner.fail('配置文件保存失败');
    console.error(error);
    process.exit(1);
  }

  // Build project before installing service (ensures dist/main.js exists)
  const buildSpinner = ora('构建项目中...').start();
  try {
    const { execa } = await import('execa');
    const { exitCode } = await execa('npm', ['run', 'build'], { cwd: process.cwd() });
    if (exitCode === 0) {
      buildSpinner.succeed('项目构建成功');
    } else {
      buildSpinner.fail('项目构建失败');
      process.exit(1);
    }
  } catch (error) {
    buildSpinner.fail('项目构建失败');
    console.error(error);
    process.exit(1);
  }

  let serviceRunning = false;

  // Install service if not foreground
  if (serviceResult.mode !== 'foreground') {
    const installSpinner = ora('安装系统服务...').start();
    const installResult = await installService(serviceResult.mode, serviceResult.config);
    installSpinner.stop();

    if (installResult.success) {
      console.log(chalk.green('系统服务安装成功 ✅'));
      const startSpinner = ora('启动服务...').start();
      const startResult = await startService(serviceResult.mode, serviceResult.config.serviceName);
      startSpinner.stop();
      if (startResult.success) {
        console.log(chalk.green('服务启动成功 ✅'));
        serviceRunning = true;
      } else {
        console.log(chalk.yellow(`服务启动失败: ${startResult.error || '未知错误'}`));
      }
    } else {
      console.log(chalk.yellow(`系统服务安装失败: ${installResult.error || '未知错误'}`));
    }
  }

  // Write setup result for setup.sh / setup.ps1 to consume
  const setupResult = {
    mode: serviceResult.mode,
    serviceName: serviceResult.config.serviceName,
    serviceRunning,
    projectDir: process.cwd(),
  };
  try {
    writeFileSync('.setup_result.json', JSON.stringify(setupResult, null, 2));
  } catch {
    // ignore write failure
  }

  // Summary
  printSummary(configPath, feishuConfig, cliResult.config.default_model as string, serviceResult, serviceRunning);
}

function printSummary(
  configPath: string,
  feishu: FeishuConfig,
  model: string,
  service: ServiceSetupResult,
  serviceRunning: boolean
): void {
  const lines = [
    chalk.bold('🎉 安装完成！'),
    '',
    `配置文件: ${chalk.cyan(configPath)}`,
    `App ID: ${chalk.cyan(feishu.appId)}`,
    `默认模型: ${chalk.cyan(model)}`,
    `运行方式: ${chalk.cyan(service.mode)}`,
  ];

  if (service.mode !== 'foreground') {
    lines.push(`服务名称: ${chalk.cyan(service.config.serviceName)}`);
    if (serviceRunning) {
      lines.push(chalk.green('服务状态: 正在运行 ✅'));
    } else {
      lines.push(chalk.yellow('服务状态: 启动失败，请手动检查 ⚠️'));
    }
    lines.push('');
    lines.push(chalk.dim('常用命令:'));
    const name = service.config.serviceName;
    switch (service.mode) {
      case 'systemd-user':
        lines.push(chalk.dim(`  systemctl --user status ${name}`));
        lines.push(chalk.dim(`  systemctl --user restart ${name}`));
        lines.push(chalk.dim(`  journalctl --user -u ${name} -f`));
        break;
      case 'systemd-system':
        lines.push(chalk.dim(`  sudo systemctl status ${name}`));
        lines.push(chalk.dim(`  sudo systemctl restart ${name}`));
        lines.push(chalk.dim(`  sudo journalctl -u ${name} -f`));
        break;
      case 'launchd-user':
        lines.push(chalk.dim(`  launchctl list | grep ${name}`));
        lines.push(chalk.dim(`  launchctl bootout gui/$UID ~/Library/LaunchAgents/${name}.plist`));
        lines.push(chalk.dim(`  launchctl bootstrap gui/$UID ~/Library/LaunchAgents/${name}.plist`));
        break;
      case 'launchd-system':
        lines.push(chalk.dim(`  sudo launchctl list | grep ${name}`));
        lines.push(chalk.dim(`  sudo launchctl bootout system /Library/LaunchDaemons/${name}.plist`));
        lines.push(chalk.dim(`  sudo launchctl bootstrap system /Library/LaunchDaemons/${name}.plist`));
        break;
    }
  } else {
    lines.push('');
    lines.push(chalk.dim('前台运行命令:'));
    lines.push(chalk.dim('  npm start'));
  }

  lines.push('');
  lines.push(chalk.dim('下一步:'));
  lines.push(chalk.dim('  1. 确保飞书应用已订阅 im.message.receive_v1 事件'));
  lines.push(chalk.dim('  2. 确保已开通所需权限（im:message、im:message:send_as_bot 等）'));
  lines.push(chalk.dim('  3. 如果使用加密，请确认 Encrypt Key 配置正确'));

  console.log(
    boxen(lines.join('\n'), {
      padding: 1,
      margin: 1,
      borderStyle: 'round',
      borderColor: 'green',
    })
  );
}
