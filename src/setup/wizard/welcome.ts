import chalk from 'chalk';
import boxen from 'boxen';

export async function showWelcome(): Promise<void> {
  const lines = [
    chalk.bold('🚀 Feishu CLI Bridge 安装向导'),
    '',
    '本向导将帮助你完成以下配置：',
    '  1. Node.js 环境检查',
    '  2. OpenCode CLI 安装与登录',
    '  3. 飞书应用凭据配置',
    '  4. 服务运行方式设置',
    '',
    chalk.dim('按 Ctrl+C 随时退出'),
  ];

  console.log(
    boxen(lines.join('\n'), {
      padding: 1,
      margin: 1,
      borderStyle: 'round',
      borderColor: 'cyan',
    })
  );
}
