#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';

import { runWizard } from './wizard/index.js';

const program = new Command();

program
  .name('feishu-bridge-setup')
  .description('Feishu CLI Bridge 交互式安装向导')
  .version('2.0.0');

program
  .command('wizard', { isDefault: true })
  .description('运行交互式安装向导')
  .action(async () => {
    try {
      await runWizard();
    } catch (error) {
      console.error(chalk.red('\n安装向导发生错误:'));
      console.error(error);
      process.exit(1);
    }
  });

program.parse();
