# Feishu CLI Bridge - 交互式安装向导设计文档

**版本**: 1.0  
**日期**: 2026-04-02  
**状态**: 设计阶段  

---

## 1. 功能概述

### 1.1 目标

实现一个**交互式安装向导**，让用户通过简单的命令完成 Feishu CLI Bridge 的完整部署：

- 自动检测和安装 CLI 工具（OpenCode、Codex、Claude Code 等）
- 配置飞书机器人凭据
- 选择服务运行模式（systemd/launchd/PM2/前台运行）
- 自动配置开机自启
- 支持多平台（Linux/macOS/Windows）

### 1.2 使用方式

```bash
# 方法一：npx 直接运行（推荐，无需预先安装）
npx feishu-cli-bridge-setup

# 方法二：安装后运行
npm install -g feishu-cli-bridge
feishu-bridge-setup

# 方法三：本地开发模式
git clone https://github.com/error403/feishu-cli-bridge.git
cd feishu-cli-bridge
npm install
npm run setup
```

---

## 2. 架构设计

### 2.1 模块结构

```
src/setup/
├── index.ts                        # 主入口
├── cli-provider/                   # CLI 工具提供器模块
│   ├── interface.ts                # ICLIProvider 接口
│   ├── registry.ts                 # Provider 注册表
│   ├── factory.ts                  # Provider 工厂
│   └── providers/                  # 各 CLI 工具实现
│       ├── opencode.ts             # OpenCode（完整实现）
│       ├── codex.ts                # Codex（预留）
│       └── claudecode.ts           # Claude Code（预留）
│
├── service-manager/                # 服务管理模块
│   ├── interface.ts                # IServiceManager 接口
│   ├── types.ts                    # 共享类型定义
│   ├── registry.ts                 # 平台检测与注册
│   └── platforms/                  # 各平台实现
│       ├── systemd.ts              # Linux systemd
│       ├── launchd.ts              # macOS launchd
│       ├── windows-service.ts      # Windows 服务（预留）
│       └── pm2.ts                  # PM2 跨平台方案
│
├── wizard/                         # 交互式向导
│   ├── index.ts                    # 主流程整合
│   ├── welcome.ts                  # 欢迎 + 系统检查
│   ├── cli-setup.ts                # CLI 工具安装向导
│   ├── feishu-config.ts            # 飞书配置向导
│   └── service-config.ts           # 服务运行模式配置
│
└── writers/                        # 配置文件生成
    ├── config-file.ts              # 生成 config.yaml
    └── service-files.ts            # 生成服务配置文件
```

### 2.2 设计原则

1. **可扩展性**：新增 CLI 工具只需实现 `ICLIProvider` 接口
2. **跨平台**：自动检测平台，提供适合该平台的选项
3. **用户优先**：清晰的交互提示，让用户按需选择
4. **无需管理员**：优先使用用户级服务，避免权限问题
5. **可回滚**：安装失败时提供清晰的错误信息和回滚方案

---

## 3. CLI 工具提供器设计

### 3.1 ICLIProvider 接口

```typescript
export interface ICLIProvider {
  /** 提供器 ID */
  readonly id: string;
  
  /** 显示名称 */
  readonly displayName: string;
  
  /** 对应的 adapter 名称 */
  readonly adapterName: string;
  
  /** 官网链接 */
  readonly websiteUrl: string;
  
  /** 文档链接 */
  readonly docsUrl: string;
  
  /** 最低版本要求 */
  readonly minVersion?: string;
  
  /** 推荐的默认模型 */
  readonly recommendedModels: Array<{
    id: string;
    name: string;
    description?: string;
  }>;

  /**
   * 检测 CLI 工具是否已安装
   */
  check(): Promise<CLICheckResult>;

  /**
   * 获取支持的安装方式
   */
  getInstallMethods(): InstallMethod[];

  /**
   * 执行安装
   */
  install(method: string, options?: InstallOptions): Promise<InstallResult>;

  /**
   * 验证 CLI 工具是否可用
   */
  verify(): Promise<boolean>;

  /**
   * 获取登录/认证状态
   */
  getAuthStatus(): Promise<AuthStatus>;

  /**
   * 执行登录
   */
  login(): Promise<boolean>;

  /**
   * 获取可用模型列表
   */
  fetchModels(): Promise<Array<{ id: string; name: string; provider?: string }>>;

  /**
   * 获取默认配置
   */
  getDefaultConfig(): CLIConfig;
}
```

### 3.2 OpenCode Provider 实现

| 功能 | 实现状态 | 说明 |
|------|---------|------|
| 版本检测 | ✅ | 通过 `opencode --version` |
| 自动安装 | ✅ | curl 脚本 / npm / brew |
| OAuth 登录 | ✅ | `opencode auth login` |
| 模型列表获取 | ✅ | `opencode models list` |
| 版本检查 | ✅ | 对比最低版本要求 |

### 3.3 预留 Provider

| Provider | 状态 | 预计支持功能 |
|----------|------|-------------|
| Codex | 预留 | npm install -g @openai/codex |
| Claude Code | 预留 | 官方安装脚本 |
| Kimi CLI | 预留 | 未来官方 CLI |

---

## 4. 服务管理模块设计

### 4.1 运行模式枚举

```typescript
export enum ServiceMode {
  /** 前台运行 */
  FOREGROUND = 'FOREGROUND',
  
  /** 后台运行 */
  BACKGROUND = 'BACKGROUND',
  
  /** PM2 进程管理 */
  PM2 = 'PM2',
  
  /** systemd 用户服务 */
  SYSTEMD_USER = 'SYSTEMD_USER',
  
  /** systemd 系统服务 */
  SYSTEMD_SYSTEM = 'SYSTEMD_SYSTEM',
  
  /** launchd 用户服务 */
  LAUNCHD_USER = 'LAUNCHD_USER',
  
  /** launchd 系统服务 */
  LAUNCHD_SYSTEM = 'LAUNCHD_SYSTEM',
  
  /** Windows 服务 */
  WINDOWS_SERVICE = 'WINDOWS_SERVICE',
}
```

### 4.2 平台支持矩阵

| 运行模式 | Linux | macOS | Windows | 需要管理员 | 推荐指数 |
|---------|-------|-------|---------|-----------|---------|
| FOREGROUND | ✅ | ✅ | ✅ | ❌ | ⭐ 开发测试 |
| BACKGROUND | ✅ | ✅ | ❌ | ❌ | ⭐ 临时使用 |
| PM2 | ✅ | ✅ | ✅ | ❌ | ⭐⭐⭐ 跨平台 |
| SYSTEMD_USER | ✅ | ❌ | ❌ | ❌ | ⭐⭐⭐⭐⭐ Linux 推荐 |
| SYSTEMD_SYSTEM | ✅ | ❌ | ❌ | ✅ | ⭐⭐⭐ 服务器 |
| LAUNCHD_USER | ❌ | ✅ | ❌ | ❌ | ⭐⭐⭐⭐⭐ macOS 推荐 |
| LAUNCHD_SYSTEM | ❌ | ✅ | ❌ | ✅ | ⭐⭐⭐ 服务器 |

### 4.3 IServiceManager 接口

```typescript
export interface IServiceManager {
  readonly platform: string;
  
  /** 检测平台是否可用 */
  isAvailable(): Promise<boolean>;
  
  /** 检查是否需要管理员权限 */
  requiresAdmin(mode: ServiceMode): boolean;
  
  /** 获取服务状态 */
  getStatus(serviceName: string): Promise<ServiceStatus>;
  
  /** 安装服务 */
  install(config: ServiceConfig): Promise<{ success: boolean; error?: string }>;
  
  /** 卸载服务 */
  uninstall(serviceName: string): Promise<{ success: boolean; error?: string }>;
  
  /** 启动服务 */
  start(serviceName: string): Promise<{ success: boolean; error?: string }>;
  
  /** 停止服务 */
  stop(serviceName: string): Promise<{ success: boolean; error?: string }>;
  
  /** 重启服务 */
  restart(serviceName: string): Promise<{ success: boolean; error?: string }>;
  
  /** 查看日志 */
  logs(serviceName: string, lines?: number): Promise<string>;
  
  /** 获取配置文件路径 */
  getConfigPath(serviceName: string): string;
  
  /** 获取可用选项 */
  getAvailableOptions(): RunOption[];
}
```

---

## 4.5 Node.js 环境检测模块（新增）

### 4.5.1 检测流程

在欢迎界面之后、CLI 工具配置之前，插入 Node.js 环境检测步骤：

```
Step 1: 欢迎界面
    │
    ▼
Step 2: Node.js 环境检测 ⭐ 新增
    │
    ▼
Step 3: CLI 工具配置
    │
    ▼
...
```

### 4.5.2 版本要求

- **最低版本**: Node.js >= 20.0.0
- **推荐版本**: Node.js >= 20.10.0 LTS
- **package.json 引擎字段**:
  ```json
  {
    "engines": {
      "node": ">=20.0.0"
    }
  }
  ```

### 4.5.3 IEnvironmentChecker 接口

```typescript
// src/setup/environment/interface.ts

export interface NodeVersionInfo {
  /** 是否已安装 */
  installed: boolean;
  
  /** 当前版本（如 "v20.5.0"） */
  version?: string;
  
  /** 主要版本号 */
  major?: number;
  
  /** 是否满足最低要求 */
  satisfies: boolean;
  
  /** 当前版本与要求的对比 */
  comparison?: 'newer' | 'equal' | 'older';
  
  /** 可执行文件路径 */
  path?: string;
  
  /** npm 版本 */
  npmVersion?: string;
  
  /** npm 镜像源 */
  npmRegistry?: string;
}

export interface IEnvironmentChecker {
  /** 检查 Node.js 环境 */
  checkNode(): Promise<NodeVersionInfo>;
  
  /** 检查 npm 可用性 */
  checkNpm(): Promise<{ available: boolean; version?: string; registry?: string }>;
  
  /** 获取推荐的 Node.js 安装方式 */
  getInstallMethods(): InstallMethod[];
  
  /** 检测系统包管理器（用于安装 Node.js） */
  detectSystemPackageManager(): Promise<SystemPackageManager | null>;
}

export interface InstallMethod {
  id: string;
  name: string;
  description: string;
  platforms: ('linux' | 'macos' | 'windows')[];
  requiresAdmin: boolean;
  estimatedTime: string;
  commands: string[];
}

type SystemPackageManager = 'apt' | 'yum' | 'dnf' | 'pacman' | 'brew' | 'choco' | 'scoop';
```

### 4.5.4 Node.js 安装方式支持

| 安装方式 | Linux | macOS | Windows | 需要管理员 | 特点 |
|---------|-------|-------|---------|-----------|------|
| **官方安装器** | ✅ | ✅ | ✅ | Windows 需要 | 最可靠，推荐 |
| **nvm** | ✅ | ✅ | ❌ | ❌ | 多版本管理，推荐开发者 |
| **fnm** | ✅ | ✅ | ✅ | ❌ | 快速、跨平台 |
| **包管理器** | ✅ | ✅ | ✅ | 通常需要 | apt/yum/brew/choco |
| ** volta** | ✅ | ✅ | ✅ | ❌ | 项目级版本管理 |

### 4.5.5 NodeEnvironmentChecker 实现

```typescript
// src/setup/environment/node-checker.ts

import { execa } from 'execa';
import which from 'which';
import { satisfies, compare } from 'semver';
import type { 
  NodeVersionInfo, 
  IEnvironmentChecker, 
  InstallMethod,
  SystemPackageManager 
} from './interface.js';

export class NodeEnvironmentChecker implements IEnvironmentChecker {
  private readonly minVersion = '20.0.0';
  private readonly recommendedVersion = '20.10.0';

  async checkNode(): Promise<NodeVersionInfo> {
    try {
      const nodePath = await which('node');
      const { stdout } = await execa('node', ['--version']);
      const version = stdout.trim();
      const major = parseInt(version.slice(1).split('.')[0], 10);
      
      const satisfiesMin = satisfies(version, `>=${this.minVersion}`);
      const comparison = satisfiesMin 
        ? (version === `v${this.recommendedVersion}` ? 'equal' : 'newer')
        : 'older';

      return {
        installed: true,
        version,
        major,
        satisfies: satisfiesMin,
        comparison,
        path: nodePath,
      };
    } catch {
      return {
        installed: false,
        satisfies: false,
      };
    }
  }

  async checkNpm(): Promise<{ available: boolean; version?: string; registry?: string }> {
    try {
      const [versionResult, configResult] = await Promise.all([
        execa('npm', ['--version']),
        execa('npm', ['config', 'get', 'registry']),
      ]);

      return {
        available: true,
        version: versionResult.stdout.trim(),
        registry: configResult.stdout.trim() || 'https://registry.npmjs.org/',
      };
    } catch {
      return { available: false };
    }
  }

  async detectSystemPackageManager(): Promise<SystemPackageManager | null> {
    const platform = process.platform;
    
    if (platform === 'linux') {
      // 检测常见 Linux 包管理器
      const managers: Array<{ cmd: string; name: SystemPackageManager }> = [
        { cmd: 'apt', name: 'apt' },
        { cmd: 'apt-get', name: 'apt' },
        { cmd: 'yum', name: 'yum' },
        { cmd: 'dnf', name: 'dnf' },
        { cmd: 'pacman', name: 'pacman' },
      ];
      
      for (const { cmd, name } of managers) {
        try {
          await which(cmd);
          return name;
        } catch {
          continue;
        }
      }
    } else if (platform === 'darwin') {
      try {
        await which('brew');
        return 'brew';
      } catch {
        return null;
      }
    } else if (platform === 'win32') {
      const managers: Array<{ cmd: string; name: SystemPackageManager }> = [
        { cmd: 'choco', name: 'choco' },
        { cmd: 'scoop', name: 'scoop' },
      ];
      
      for (const { cmd, name } of managers) {
        try {
          await which(cmd);
          return name;
        } catch {
          continue;
        }
      }
    }
    
    return null;
  }

  getInstallMethods(): InstallMethod[] {
    const platform = process.platform === 'darwin' ? 'macos' : 
                     process.platform === 'win32' ? 'windows' : 'linux';
    
    return [
      {
        id: 'official',
        name: '官方安装脚本',
        description: '从 Node.js 官网下载安装（最可靠）',
        platforms: ['linux', 'macos'],
        requiresAdmin: false,
        estimatedTime: '2-3 分钟',
        commands: ['curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -', 'sudo apt-get install -y nodejs'],
      },
      {
        id: 'nvm',
        name: 'nvm (Node Version Manager)',
        description: '使用 nvm 安装和管理 Node.js 版本',
        platforms: ['linux', 'macos'],
        requiresAdmin: false,
        estimatedTime: '3-5 分钟',
        commands: ['curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash', 'nvm install 20', 'nvm use 20'],
      },
      {
        id: 'fnm',
        name: 'fnm (Fast Node Manager)',
        description: '使用 fnm 快速安装（推荐，跨平台）',
        platforms: ['linux', 'macos', 'windows'],
        requiresAdmin: false,
        estimatedTime: '1-2 分钟',
        commands: ['curl -fsSL https://fnm.vercel.app/install | bash', 'fnm install 20', 'fnm use 20'],
      },
      {
        id: 'brew',
        name: 'Homebrew',
        description: 'macOS 包管理器安装',
        platforms: ['macos'],
        requiresAdmin: false,
        estimatedTime: '2-3 分钟',
        commands: ['brew install node@20'],
      },
      {
        id: 'choco',
        name: 'Chocolatey',
        description: 'Windows 包管理器安装',
        platforms: ['windows'],
        requiresAdmin: true,
        estimatedTime: '2-3 分钟',
        commands: ['choco install nodejs-lts'],
      },
      {
        id: 'manual',
        name: '手动安装',
        description: '访问官网下载安装包自行安装',
        platforms: ['linux', 'macos', 'windows'],
        requiresAdmin: false,
        estimatedTime: '5-10 分钟',
        commands: [],
      },
    ].filter(m => m.platforms.includes(platform));
  }

  /**
   * 获取当前版本与要求的对比说明
   */
  getVersionAdvice(info: NodeVersionInfo): string {
    if (!info.installed) {
      return '未检测到 Node.js，需要安装';
    }
    
    if (!info.satisfies) {
      return `当前版本 ${info.version} 过低，需要 >= ${this.minVersion}`;
    }
    
    if (info.comparison === 'equal' || info.comparison === 'newer') {
      return `当前版本 ${info.version} 满足要求 (>= ${this.minVersion})`;
    }
    
    return '版本检测异常';
  }
}
```

### 4.5.6 Node.js 安装引导交互

```typescript
// src/setup/wizard/node-setup.ts

import { select, confirm, input } from '@inquirer/prompts';
import ora from 'ora';
import chalk from 'chalk';
import boxen from 'boxen';
import { NodeEnvironmentChecker } from '../environment/node-checker.js';

export async function runNodeSetupWizard(): Promise<{
  installed: boolean;
  version: string;
  upgraded: boolean;
  npmRegistry?: string;
}> {
  console.log(chalk.cyan('\n📦 Node.js 环境检测\n'));

  const checker = new NodeEnvironmentChecker();
  const nodeInfo = await checker.checkNode();
  const npmInfo = await checker.checkNpm();

  // 显示检测结果
  console.log('检测结果:');
  
  if (nodeInfo.installed) {
    const statusIcon = nodeInfo.satisfies ? chalk.green('✓') : chalk.red('✗');
    console.log(`${statusIcon} Node.js: ${chalk.bold(nodeInfo.version)}`);
    console.log(`  路径: ${chalk.gray(nodeInfo.path)}`);
    
    if (!nodeInfo.satisfies) {
      console.log(chalk.red(`  ⚠️  ${checker.getVersionAdvice(nodeInfo)}`));
    } else {
      console.log(chalk.green(`  ✓ ${checker.getVersionAdvice(nodeInfo)}`));
    }
  } else {
    console.log(chalk.red('✗ Node.js: 未安装'));
  }

  if (npmInfo.available) {
    console.log(`${chalk.green('✓')} npm: ${chalk.bold(npmInfo.version)}`);
    console.log(`  镜像源: ${chalk.gray(npmInfo.registry)}`);
  } else {
    console.log(chalk.red('✗ npm: 未安装'));
  }

  console.log();

  // 如果版本满足要求，询问是否继续
  if (nodeInfo.satisfies && npmInfo.available) {
    const shouldContinue = await confirm({
      message: 'Node.js 环境满足要求，是否继续？',
      default: true,
    });

    if (!shouldContinue) {
      // 提供选项切换 npm 镜像
      const shouldSwitchRegistry = await confirm({
        message: '是否切换 npm 镜像源？',
        default: false,
      });

      if (shouldSwitchRegistry) {
        await switchNpmRegistry();
      }
    }

    return {
      installed: true,
      version: nodeInfo.version!,
      upgraded: false,
      npmRegistry: npmInfo.registry,
    };
  }

  // 需要安装或升级
  console.log(boxen(
    chalk.yellow('Node.js 环境不满足要求\n\n') +
    chalk.white('Feishu CLI Bridge 需要:') + '\n' +
    `  • Node.js >= ${chalk.bold('20.0.0')}\n` +
    `  • npm >= ${chalk.bold('10.0.0')}\n\n` +
    chalk.gray('请选择安装方式:'),
    { padding: 1, borderStyle: 'round', borderColor: 'yellow' }
  ));

  // 获取可用的安装方式
  const installMethods = checker.getInstallMethods();
  const detectedPM = await checker.detectSystemPackageManager();

  // 如果有系统包管理器，添加相应选项
  if (detectedPM && detectedPM !== 'brew') {
    installMethods.unshift({
      id: 'system-pm',
      name: `系统包管理器 (${detectedPM})`,
      description: `使用 ${detectedPM} 安装 Node.js`,
      platforms: [process.platform === 'darwin' ? 'macos' : 'linux'],
      requiresAdmin: true,
      estimatedTime: '2-3 分钟',
      commands: this.getSystemPMCommands(detectedPM),
    });
  }

  const selectedMethod = await select({
    message: '选择 Node.js 安装方式:',
    choices: installMethods.map(m => ({
      name: `${m.name} - ${m.description} (${m.estimatedTime})`,
      value: m.id,
      description: m.requiresAdmin ? '⚠️ 需要管理员权限' : '✓ 无需管理员权限',
    })),
  });

  if (selectedMethod === 'manual') {
    console.log(chalk.cyan('\n请访问以下地址下载安装 Node.js:'));
    console.log(chalk.blue('https://nodejs.org/dist/v20.10.0/\n'));
    console.log(chalk.gray('安装完成后，请重新运行本向导。\n'));
    
    process.exit(0);
  }

  // 执行安装
  const method = installMethods.find(m => m.id === selectedMethod)!;
  const upgraded = await installNodeJs(method, nodeInfo.installed);

  // 安装完成后重新检测
  const newNodeInfo = await checker.checkNode();
  
  if (!newNodeInfo.satisfies) {
    console.log(chalk.red('\n✗ Node.js 安装/升级失败，请手动安装后重试\n'));
    process.exit(1);
  }

  console.log(chalk.green(`\n✓ Node.js ${newNodeInfo.version} 安装成功\n`));

  // npm 镜像配置
  const shouldConfigNpm = await confirm({
    message: '是否配置 npm 镜像源（加快国内下载速度）？',
    default: true,
  });

  let registry = npmInfo.registry;
  if (shouldConfigNpm) {
    registry = await switchNpmRegistry();
  }

  return {
    installed: true,
    version: newNodeInfo.version!,
    upgraded,
    npmRegistry: registry,
  };
}

async function installNodeJs(
  method: InstallMethod, 
  isUpgrade: boolean
): Promise<boolean> {
  console.log(chalk.cyan(`\n${isUpgrade ? '升级' : '安装'} Node.js...\n`));

  const spinner = ora('准备安装...').start();

  try {
    for (const command of method.commands) {
      spinner.text = `执行: ${command}`;
      
      // 执行命令
      await execa('sh', ['-c', command], {
        stdio: 'inherit', // 让用户看到安装进度
      });
    }

    spinner.succeed('Node.js 安装完成');
    
    // 提示用户可能需要重新加载 shell
    if (method.id === 'nvm' || method.id === 'fnm') {
      console.log(chalk.yellow('\n⚠️  请执行以下命令重新加载 shell 环境:'));
      console.log(chalk.cyan('  source ~/.bashrc  # 或 ~/.zshrc\n'));
      console.log(chalk.gray('然后重新运行本向导。\n'));
      process.exit(0);
    }

    return isUpgrade;
  } catch (error) {
    spinner.fail(`安装失败: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

async function switchNpmRegistry(): Promise<string> {
  const registries = [
    { name: 'npm 官方', value: 'https://registry.npmjs.org/', default: true },
    { name: '淘宝镜像', value: 'https://registry.npmmirror.com/', default: false },
    { name: '腾讯云', value: 'https://mirrors.cloud.tencent.com/npm/', default: false },
    { name: '华为云', value: 'https://mirrors.huaweicloud.com/repository/npm/', default: false },
    { name: '自定义', value: 'custom', default: false },
  ];

  const selected = await select({
    message: '选择 npm 镜像源:',
    choices: registries.map(r => ({
      name: r.name,
      value: r.value,
      description: r.value === 'custom' ? '输入自定义镜像地址' : r.value,
    })),
  });

  let registryUrl = selected;
  
  if (selected === 'custom') {
    registryUrl = await input({
      message: '输入镜像源地址:',
      default: 'https://registry.npmmirror.com/',
    });
  }

  const spinner = ora('切换镜像源...').start();
  
  try {
    await execa('npm', ['config', 'set', 'registry', registryUrl]);
    spinner.succeed(`已切换到: ${registryUrl}`);
    return registryUrl;
  } catch (error) {
    spinner.fail('切换失败');
    throw error;
  }
}

function getSystemPMCommands(pm: SystemPackageManager): string[] {
  switch (pm) {
    case 'apt':
      return [
        'curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -',
        'sudo apt-get install -y nodejs',
      ];
    case 'yum':
    case 'dnf':
      return [
        'curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -',
        `sudo ${pm} install -y nodejs`,
      ];
    case 'pacman':
      return ['sudo pacman -S nodejs npm'];
    case 'brew':
      return ['brew install node@20'];
    case 'choco':
      return ['choco install nodejs-lts'];
    case 'scoop':
      return ['scoop install nodejs-lts'];
    default:
      return [];
  }
}
```

### 4.5.7 交互示例

```
📦 Node.js 环境检测

检测结果:
✗ Node.js: 未安装
✗ npm: 未安装

┌─────────────────────────────────────────────────────┐
│ ⚠️  Node.js 环境不满足要求                           │
│                                                      │
│ Feishu CLI Bridge 需要:                              │
│   • Node.js >= 20.0.0                               │
│   • npm >= 10.0.0                                   │
│                                                      │
│ 请选择安装方式:                                      │
└─────────────────────────────────────────────────────┘

? 选择 Node.js 安装方式: › - Use arrow-keys. Return to submit.
❯   系统包管理器 (apt) - 使用 apt 安装 Node.js (2-3 分钟)
    官方安装脚本 - 从 Node.js 官网下载安装（最可靠） (2-3 分钟)
    nvm (Node Version Manager) - 使用 nvm 安装和管理 Node.js 版本 (3-5 分钟)
    fnm (Fast Node Manager) - 使用 fnm 快速安装（推荐，跨平台） (1-2 分钟)
    手动安装 - 访问官网下载安装包自行安装 (5-10 分钟)

⠧ 执行: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
✓ Node.js 安装完成

✓ Node.js v20.10.0 安装成功

? 是否配置 npm 镜像源（加快国内下载速度）？ (Y/n) › yes

? 选择 npm 镜像源: › - Use arrow-keys. Return to submit.
❯   npm 官方 - https://registry.npmjs.org/
    淘宝镜像 - https://registry.npmmirror.com/
    腾讯云 - https://mirrors.cloud.tencent.com/npm/
    华为云 - https://mirrors.huaweicloud.com/repository/npm/
    自定义

✓ 已切换到: https://registry.npmmirror.com/
```

### 4.5.8 更新后主流程

```
┌─────────────────────────────────────────────────────────────────┐
│                     Feishu CLI Bridge Setup                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: 欢迎界面                                                 │
│ • 显示版本信息                                                   │
│ • 检测操作系统                                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 2: Node.js 环境检测 ⭐ 新增                                 │
│ • 检测 Node.js 版本 (>= 20.0.0)                                  │
│ • 检测 npm 可用性                                                │
│ • 如不满足，引导安装/升级                                        │
│   - 官方安装脚本 / nvm / fnm / 包管理器                          │
│ • 配置 npm 镜像源（可选）                                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 3: CLI 工具配置                                             │
│ • 检测 OpenCode/Codex/...                                        │
│ • 引导安装和登录                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 4: 飞书配置                                                 │
│ • 输入 App ID / App Secret                                       │
│ • 验证凭据                                                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 5: 运行模式配置                                             │
│ • 选择 systemd/launchd/PM2/前台运行                              │
│ • 配置服务参数                                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 6: 应用配置                                                 │
│ • 生成 config.yaml                                               │
│ • 安装服务                                                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. 交互流程设计

### 5.1 主流程

```
┌─────────────────────────────────────────────────────────────────┐
│                     Feishu CLI Bridge Setup                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: 欢迎界面                                                 │
│ • 显示版本信息                                                   │
│ • 系统环境检查 (Node.js 版本、网络连通性)                          │
│ • 检查现有配置                                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 2: CLI 工具配置                                             │
│ • 检测已安装的 CLI 工具 (OpenCode/Codex/...)                     │
│ • 显示检测状态 (✓已安装 / ✗未安装 / ⚠️版本过旧)                   │
│ • 引导安装未安装的 CLI 工具                                        │
│   - 选择安装方式 (curl/npm/brew/...)                             │
│   - 执行安装                                                     │
│   - 引导登录认证                                                  │
│   - 选择默认模型                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 3: 飞书配置                                                 │
│ • 提示获取 App ID 和 App Secret 的步骤                            │
│ • 输入 App ID (格式验证: cli_xxxxxxxxx)                           │
│ • 输入 App Secret                                                │
│ • 验证凭据有效性                                                  │
│ • 可选: 配置 Encrypt Key 和 Verification Token                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 4: 运行模式配置                                              │
│ • 显示可用运行方式（根据平台动态变化）                               │
│ • 选择运行模式                                                    │
│ • 配置服务参数（名称、日志目录、自动重启等）                          │
│ • 确认开机自启                                                    │
│ • 预览生成的配置文件                                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 5: 确认与应用                                               │
│ • 显示配置摘要                                                   │
│ • 确认所有配置                                                   │
│ • 生成 config.yaml                                               │
│ • 安装服务（如选择服务模式）                                       │
│ • 启动服务                                                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 6: 完成 + 管理菜单（可选）                                     │
│ • 显示服务状态                                                    │
│ • 提供管理命令参考                                                │
│ • 可选: 进入服务管理菜单                                           │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 CLI 工具配置交互示例

```
🛠️  CLI 工具配置

正在检测已安装的 CLI 工具...

✓ OpenCode: 已安装 (v0.8.2)
✗ Codex: 未安装
✗ Claude Code: 未安装

? 是否安装/更新 OpenCode? (Y/n) › yes

📦 OpenCode 安装

官网: https://opencode.ai
文档: https://opencode.ai/docs

? 选择安装方式: › - Use arrow-keys. Return to submit.
❯   官方安装脚本 (curl) - 从官网下载安装脚本自动安装（推荐） (1-2 分钟)
    npm 全局安装 - 通过 npm install -g opencode 安装 (30 秒)
    Homebrew (macOS) - brew install opencode (1 分钟)
    手动安装 - 我将自行安装，跳过此步骤

⠼ 正在下载安装脚本...
✔ OpenCode 安装成功 (v0.8.2)

? 是否立即登录？ (Y/n) › yes

正在启动登录流程，请按提示操作...
请在浏览器中完成授权...

✓ 登录成功 (user@example.com)

? 选择默认模型: › - Use arrow-keys. Return to submit.
❯   Kimi K2.5 - 推荐，性价比高
    Kimi K2 Thinking - 推理能力强
    MiMo V2 Pro Free - 免费模型

✓ OpenCode 配置完成

? 是否安装 Codex? (y/N) › no
? 是否安装 Claude Code? (y/N) › no
```

### 5.3 服务运行模式交互示例

```
⚙️  运行模式配置

检测到平台: linux

📋 可用的运行方式:

🖥️ 前台运行 [无需管理员]
   在当前终端窗口运行，适合调试和开发
   适合: 开发测试、临时使用

👻 后台运行 [无需管理员]
   使用 nohup 在后台运行，简单轻量
   适合: 简单的后台运行

🔄 PM2 进程管理 [无需管理员]
   使用 PM2 管理进程，跨平台支持
   适合: 跨平台部署、Node.js 开发者

⭐ 🐧 systemd 用户服务 [无需管理员] [推荐]
   systemd 用户级服务（推荐 Linux 用户）
   适合: 个人服务器、桌面 Linux

🔧 systemd 系统服务 [需要管理员]
   systemd 系统级服务（需要 root）
   适合: 生产服务器、多用户环境

? 选择运行方式: › 🐧 systemd 用户服务

┌─────────────────────────────────────────────────────┐
│ systemd 用户服务                                     │
│                                                     │
│ systemd 用户级服务（推荐 Linux 用户）                  │
│                                                     │
│ 功能特性:                                            │
│   • 开机自启                                         │
│   • 自动重启                                         │
│   • 日志管理                                         │
│   • systemctl 控制                                  │
│                                                     │
│ 优点:                                               │
│   ✓ 无需 root 权限                                  │
│   ✓ 功能完整                                         │
│   ✓ 稳定可靠                                         │
│                                                     │
│ 缺点:                                               │
│   • 仅 Linux 系统                                   │
└─────────────────────────────────────────────────────┘

? 确认使用此运行方式? (Y/n) › yes

⚙️  systemd 用户服务 配置

? 服务名称: › feishu-bridge
? 日志目录: › /home/user/.config/feishu-bridge/logs
? 是否启用自动重启? (Y/n) › yes
? 是否启用开机自启? (Y/n) › yes

? 是否立即安装并启动服务? (Y/n) › yes

🚀 安装服务

✓ 服务已安装: /home/user/.config/systemd/user/feishu-bridge.service
✓ 已设置为开机自启
✓ 服务已启动

✓ 服务安装完成

状态概览:
  安装: ✓
  运行: ✓
  自启: ✓
  PID: 12345

📖 常用命令:

# 查看状态
systemctl --user status feishu-bridge

# 查看日志
systemctl --user journalctl -u feishu-bridge -f

# 停止服务
systemctl --user stop feishu-bridge

# 重启服务
systemctl --user restart feishu-cli-bridge
```

---

## 6. 配置文件生成

### 6.1 生成的 config.yaml 示例

```yaml
# Feishu CLI Bridge - 自动生成的配置
# 生成时间: 2026-04-02T10:30:00Z
# 安装方式: systemd 用户服务

feishu:
  app_id: "cli_xxxxxxxxxxxxxxxx"
  app_secret: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
  encrypt_key: ""
  verification_token: ""

cli:
  opencode:
    enabled: true
    command: "opencode"
    default_model: "kimi-for-coding/k2p5"
    timeout: 300
    models:
      - id: "kimi-for-coding/k2p5"
        name: "Kimi K2.5"
      - id: "kimi-for-coding/kimi-k2-thinking"
        name: "Kimi K2 Thinking"

  codex:
    enabled: false
    command: "codex"
    default_model: "gpt-5-codex"
    timeout: 300

session:
  max_sessions: 10
  max_history: 20

streaming:
  update_interval: 0.3
  min_chunk_size: 20
  max_message_length: 8000

debug:
  log_level: "INFO"
  save_logs: true
  log_dir: "/home/user/.config/feishu-bridge/logs"

project:
  storage_path: "/home/user/.config/feishu-bridge/projects.json"
  max_projects: 50

security:
  allowed_project_root: "/home/user"
  max_attachment_size: 52428800
  max_prompt_length: 100000
```

### 6.2 systemd 服务文件示例

```ini
# ~/.config/systemd/user/feishu-bridge.service
[Unit]
Description=Feishu CLI Bridge - 飞书机器人服务
Documentation=https://github.com/error403/feishu-cli-bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=user
WorkingDirectory=/home/user/feishu-cli-bridge
ExecStart=/usr/bin/node /home/user/feishu-cli-bridge/dist/main.js
Environment="NODE_ENV=production"
Environment="FEISHU_APP_ID=cli_xxxxxxxxxxxxxxxx"
Environment="OPENCODE_ENABLED=true"

# 日志输出
StandardOutput=append:/home/user/.config/feishu-bridge/logs/stdout.log
StandardError=append:/home/user/.config/feishu-bridge/logs/stderr.log

# 重启策略
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

---

## 7. 依赖项

### 7.1 新增依赖

```json
{
  "dependencies": {
    "@inquirer/prompts": "^7.0.0",
    "boxen": "^8.0.0",
    "chalk": "^5.0.0",
    "commander": "^12.0.0",
    "execa": "^9.0.0",
    "ora": "^8.0.0",
    "plist": "^3.1.0",
    "semver": "^7.6.0",
    "which": "^4.0.0"
  },
  "devDependencies": {
    "@types/plist": "^3.0.5",
    "@types/semver": "^7.5.8",
    "@types/which": "^3.0.4"
  }
}
```

### 7.2 package.json 更新

```json
{
  "name": "feishu-cli-bridge",
  "bin": {
    "feishu-bridge": "./dist/main.js",
    "feishu-bridge-setup": "./dist/setup/index.js"
  },
  "scripts": {
    "setup": "node dist/setup/index.js",
    "setup:dev": "tsx src/setup/index.ts"
  }
}
```

---

## 8. 实现计划

### Phase 1: 核心功能（建议优先实现）

| 任务 | 优先级 | 预估工时 | 状态 |
|------|-------|---------|------|
| IEnvironmentChecker 接口定义 | P0 | 2h | ⏳ 待开始 |
| Node.js 版本检测实现 | P0 | 4h | ⏳ 待开始 |
| Node.js 安装引导（多种方式） | P0 | 6h | ⏳ 待开始 |
| npm 镜像配置 | P1 | 2h | ⏳ 待开始 |
| ICLIProvider 接口定义 | P0 | 2h | ⏳ 待开始 |
| OpenCodeProvider 实现 | P0 | 8h | ⏳ 待开始 |
| IServiceManager 接口定义 | P0 | 2h | ⏳ 待开始 |
| SystemdServiceManager 实现 | P0 | 6h | ⏳ 待开始 |
| LaunchdServiceManager 实现 | P0 | 6h | ⏳ 待开始 |
| 交互式向导框架 | P0 | 4h | ⏳ 待开始 |
| 配置生成器 | P0 | 4h | ⏳ 待开始 |
| **Phase 1 小计** | | **46h** | |

### Phase 2: 增强功能

| 任务 | 优先级 | 预估工时 | 状态 |
|------|-------|---------|------|
| PM2ServiceManager 实现 | P1 | 4h | ⏳ 待开始 |
| Windows 支持 | P1 | 8h | ⏳ 待开始 |
| 服务管理菜单（启动/停止/日志） | P1 | 4h | ⏳ 待开始 |
| Codex Provider 预留实现 | P2 | 4h | ⏳ 待开始 |
| 配置验证和测试 | P1 | 4h | ⏳ 待开始 |
| **Phase 2 小计** | | **24h** | |

### Phase 3: 高级功能（可选）

| 任务 | 优先级 | 预估工时 | 状态 |
|------|-------|---------|------|
| Docker 运行模式 | P3 | 8h | ⏳ 待开始 |
| Web 配置界面 | P3 | 16h | ⏳ 待开始 |
| 更新检查功能 | P2 | 4h | ⏳ 待开始 |
| 多实例管理 | P3 | 8h | ⏳ 待开始 |
| **Phase 3 小计** | | **36h** | |

**总计**: 106h (约 14 人天)

---

## 9. 测试策略

### 9.1 测试环境

| 环境 | 发行版/版本 | 测试内容 |
|------|-----------|---------|
| Linux | Ubuntu 22.04/24.04 | systemd 用户/系统服务 |
| Linux | CentOS 8/RHEL 8 | systemd 用户/系统服务 |
| macOS | macOS 14 (Sonoma) | launchd 用户/系统服务 |
| macOS | macOS 15 (Sequoia) | launchd 用户/系统服务 |
| Windows | Windows 11 | PM2 模式（Phase 2） |

### 9.2 测试用例

#### Node.js 环境检测

1. **无 Node.js 场景**
   - 未安装 Node.js → 引导安装 → 选择安装方式 → 安装成功 → 继续向导

2. **版本过低场景**
   - Node.js v18.17.0 → 检测版本过低 → 引导升级 → 升级成功 → 继续向导

3. **版本满足场景**
   - Node.js v20.10.0 → 检测通过 → 询问是否配置 npm 镜像 → 继续向导

4. **npm 镜像切换**
   - 选择淘宝/腾讯云/华为云镜像 → 执行 `npm config set registry` → 验证切换成功

5. **多种安装方式**
   - 测试官方脚本 / nvm / fnm / 系统包管理器安装

#### 完整流程测试

1. **全新安装流程**
   - 无 Node.js → 安装 Node.js → 安装 OpenCode → 登录 → 配置飞书 → systemd 安装 → 启动

2. **已有配置升级**
   - 检测现有 config.yaml → 提示备份 → 合并新配置

3. **权限不足场景**
   - 选择系统级服务 → 提示需要管理员 → 引导使用用户级服务

4. **网络失败恢复**
   - OpenCode 安装中断 → 重试/更换安装方式

5. **服务管理操作**
   - 启动/停止/重启/查看日志/卸载

---

## 10. 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 各发行版 systemd 差异 | 中 | 中 | 使用标准用户级服务，避免发行版特有功能 |
| macOS 版本兼容性 | 低 | 中 | 测试 macOS 14+，旧版本回退到前台运行 |
| OpenCode 安装脚本变更 | 中 | 低 | 提供多种安装方式备选 |
| Windows 服务权限复杂 | 高 | 中 | Phase 2 再实现，Phase 1 仅支持前台/PM2 |

---

## 11. 附录

### 11.1 参考文档

- [OpenCode 官方文档](https://opencode.ai/docs)
- [systemd 用户服务文档](https://wiki.archlinux.org/title/Systemd/User)
- [launchd 文档](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html)
- [PM2 文档](https://pm2.keymetrics.io/docs/usage/quick-start/)

### 11.2 相关文件

- `CLAUDE.md` - 项目开发指南
- `config.example.yaml` - 配置示例
- `README.md` - 项目说明

---

## 变更记录

| 日期 | 版本 | 变更内容 | 作者 |
|------|------|---------|------|
| 2026-04-02 | 1.0 | 初始版本 | Claude |
| 2026-04-02 | 1.1 | 新增 Node.js 环境检测模块 | Claude |

---

**注**: 本文档为设计文档，实现细节可能在开发过程中调整。建议定期更新文档以反映最新实现状态。
