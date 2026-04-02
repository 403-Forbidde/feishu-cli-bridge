import { select } from '@inquirer/prompts';
import readline from 'node:readline';

export interface SafeSelectChoice<T> {
  name: string;
  value: T;
  description?: string;
}

/**
 * 兼容非 TTY 环境的 select 封装。
 * - TTY 环境下使用 @inquirer/prompts 的 select（支持上下箭头）。
 * - 非 TTY 环境下回退到数字序号输入（解决 iex (irm ...) 等场景箭头键失效问题）。
 */
export async function safeSelect<T>(options: {
  message: string;
  choices: SafeSelectChoice<T>[];
  default?: T;
}): Promise<T> {
  const choices = options.choices;
  if (choices.length === 0) {
    throw new Error('No choices available for selection');
  }
  if (choices.length === 1) {
    return choices[0].value;
  }

  const isTty = process.stdin.isTTY && process.stdout.isTTY;
  if (isTty) {
    return await select({
      message: options.message,
      choices: choices.map((c) => ({
        name: c.name,
        value: c.value,
        description: c.description,
      })),
      default: options.default,
    });
  }

  // 非 TTY 回退：打印列表并要求输入数字序号
  process.stdout.write(`\n${options.message}\n`);
  choices.forEach((c, idx) => {
    process.stdout.write(`  ${idx + 1}. ${c.name}${c.description ? ` — ${c.description}` : ''}\n`);
  });

  const defaultIndex = options.default
    ? Math.max(0, choices.findIndex((c) => c.value === options.default) + 1)
    : 1;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer: string = await new Promise((resolve) => {
    rl.question(`请输入序号 [${defaultIndex}]: `, (ans) => {
      resolve(ans.trim() || String(defaultIndex));
    });
  });
  rl.close();

  const num = parseInt(answer, 10);
  if (Number.isNaN(num) || num < 1 || num > choices.length) {
    throw new Error(`无效选择: ${answer}`);
  }

  return choices[num - 1].value;
}
