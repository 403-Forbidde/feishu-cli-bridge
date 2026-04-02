/**
 * Windows UTF-8 编码初始化
 * 在 Node.js 日志输出前执行 chcp 65001，避免中文乱码
 */

import { execSync } from 'node:child_process';

if (process.platform === 'win32' && process.stdout.isTTY) {
  try {
    execSync('chcp 65001', { stdio: 'ignore' });
  } catch {
    // ignore
  }
}
