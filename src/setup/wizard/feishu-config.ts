import { input, password, confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import axios from 'axios';

export interface FeishuConfig {
  appId: string;
  appSecret: string;
  encryptKey?: string;
  verificationToken?: string;
}

export async function runFeishuConfig(): Promise<FeishuConfig> {
  console.log('');
  console.log(chalk.bold('📱 飞书应用配置'));
  console.log('─'.repeat(40));
  console.log(chalk.dim('请在飞书开放平台创建企业自建应用，获取以下凭据：'));
  console.log(chalk.dim('  1. 进入 https://open.feishu.cn/app'));
  console.log(chalk.dim('  2. 创建「企业自建应用」'));
  console.log(chalk.dim('  3. 在「凭证与基础信息」中获取 App ID 和 App Secret'));
  console.log(chalk.dim('  4. 在「事件订阅」中获取 Encrypt Key 和 Verification Token（可选）'));
  console.log('─'.repeat(40));
  console.log('');

  const appId = await input({
    message: 'App ID',
    validate: (value) => {
      if (!value.trim()) {
        return 'App ID 不能为空';
      }
      if (!/^cli_[a-zA-Z0-9]+$/.test(value.trim())) {
        return 'App ID 格式不正确，应为 cli_ 开头';
      }
      return true;
    },
  });

  const appSecret = await password({
    message: 'App Secret',
    mask: '*',
    validate: (value) => {
      if (!value.trim()) {
        return 'App Secret 不能为空';
      }
      return true;
    },
  });

  const needEncrypt = await confirm({
    message: '是否配置 Encrypt Key？',
    default: false,
  });

  let encryptKey: string | undefined;
  if (needEncrypt) {
    encryptKey = await password({
      message: 'Encrypt Key',
      mask: '*',
    });
  }

  const needVerification = await confirm({
    message: '是否配置 Verification Token？',
    default: false,
  });

  let verificationToken: string | undefined;
  if (needVerification) {
    verificationToken = await password({
      message: 'Verification Token',
      mask: '*',
    });
  }

  // Verify credentials
  const spinner = ora('验证凭据有效性...').start();
  const valid = await verifyCredentials(appId.trim(), appSecret.trim());
  spinner.stop();

  if (valid) {
    console.log(chalk.green('凭据验证通过 ✅'));
  } else {
    console.log(chalk.yellow('凭据验证失败，请检查 App ID 和 App Secret 是否正确 ⚠️'));
    const continueAnyway = await confirm({
      message: '是否继续保存配置（可稍后手动修正）？',
      default: true,
    });
    if (!continueAnyway) {
      return runFeishuConfig();
    }
  }

  return {
    appId: appId.trim(),
    appSecret: appSecret.trim(),
    encryptKey: encryptKey?.trim() || undefined,
    verificationToken: verificationToken?.trim() || undefined,
  };
}

async function verifyCredentials(appId: string, appSecret: string): Promise<boolean> {
  try {
    const response = await axios.post(
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
      {
        app_id: appId,
        app_secret: appSecret,
      },
      {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
      }
    );

    if (response.data && response.data.code === 0) {
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}
