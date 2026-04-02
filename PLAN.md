# 交互式安装向导开发计划

**目标**: 实现 Feishu CLI Bridge 的交互式安装向导，第一个版本仅适配 OpenCode

**时间**: 2026-04-02 开始

---

## 阶段规划

### Phase 1: 核心骨架（Day 1-2）

#### 任务 1: 创建 setup 目录结构
- **文件**: 创建 `src/setup/` 完整目录结构
- **内容**:
  ```
  src/setup/
  ├── index.ts
  ├── cli-provider/
  │   ├── interface.ts
  │   ├── registry.ts
  │   └── providers/
  │       └── opencode.ts
  ├── service-manager/
  │   ├── interface.ts
  │   ├── types.ts
  │   └── platforms/
  │       ├── systemd.ts
  │       └── launchd.ts
  ├── wizard/
  │   ├── index.ts
  │   ├── welcome.ts
  │   ├── node-setup.ts
  │   ├── cli-setup.ts
  │   ├── feishu-config.ts
  │   └── service-config.ts
  └── writers/
      ├── config-file.ts
      └── service-files.ts
  ```
- **验收标准**: 目录结构完整，空文件已创建

#### 任务 2: 安装依赖
- **文件**: `package.json`
- **依赖项**:
  - `@inquirer/prompts@^7.0.0` - 交互式提示
  - `chalk@^5.0.0` - 终端颜色
  - `ora@^8.0.0` - 加载动画
  - `boxen@^8.0.0` - 边框盒子
  - `execa@^9.0.0` - 进程执行
  - `commander@^12.0.0` - CLI 框架
  - `semver@^7.6.0` - 版本比较
  - `which@^4.0.0` - 命令查找
  - `@types/semver`, `@types/which` - 类型定义
- **验收标准**: `npm install` 成功，类型检查通过

#### 任务 3: 定义核心接口
- **文件**:
  - `src/setup/cli-provider/interface.ts` - ICLIProvider 接口
  - `src/setup/service-manager/interface.ts` - IServiceManager 接口
  - `src/setup/service-manager/types.ts` - 共享类型
- **验收标准**: 接口定义完整，TypeScript 编译无错误

---

### Phase 2: Node.js 环境检测（Day 2-3）

#### 任务 4: 实现 Node.js 检测器
- **文件**: `src/setup/environment/interface.ts`, `src/setup/environment/node-checker.ts`
- **功能**:
  - 检测 Node.js 版本 (>= 20.0.0)
  - 检测 npm 可用性和镜像源
  - 检测系统包管理器
  - 提供安装方式列表
- **验收标准**:
  - 正确检测已安装/未安装 Node.js
  - 正确判断版本是否满足要求
  - 正确返回安装方式列表

#### 任务 5: 实现 Node.js 安装引导向导
- **文件**: `src/setup/wizard/node-setup.ts`
- **功能**:
  - 显示检测结果（彩色输出）
  - 提供多种安装方式选择
    - 官方安装脚本
    - nvm
    - fnm
    - Homebrew (macOS)
    - 系统包管理器
  - npm 镜像源切换
- **验收标准**:
  - 交互流程顺畅
  - 安装命令正确生成
  - 镜像切换功能正常

---

### Phase 3: OpenCode 提供器（Day 3-4）

#### 任务 6: 实现 OpenCodeProvider
- **文件**: `src/setup/cli-provider/providers/opencode.ts`
- **功能**:
  - `check()`: 检测 OpenCode 是否安装及版本
  - `getInstallMethods()`: 返回安装方式
  - `install()`: 执行安装
  - `verify()`: 验证安装成功
  - `getAuthStatus()`: 检查登录状态
  - `login()`: 执行登录
  - `fetchModels()`: 获取模型列表
  - `getDefaultConfig()`: 返回默认配置
- **安装方式支持**:
  - curl 官方脚本
  - npm 全局安装
  - Homebrew (macOS)
- **验收标准**:
  - 正确检测 OpenCode 安装状态
  - 安装命令执行正确
  - 模型列表获取正常

#### 任务 7: 实现 CLI 配置向导
- **文件**: `src/setup/wizard/cli-setup.ts`
- **功能**:
  - 显示检测到的 CLI 工具状态
  - 引导安装 OpenCode
  - 引导登录认证
  - 选择默认模型
- **验收标准**:
  - 检测状态显示正确
  - 安装流程完整
  - 模型选择交互正常

---

### Phase 4: 飞书配置（Day 4）

#### 任务 8: 实现飞书配置向导
- **文件**: `src/setup/wizard/feishu-config.ts`
- **功能**:
  - 提示获取 App ID/App Secret 的方法
  - 输入 App ID (格式验证 cli_xxxxxxxxx)
  - 输入 App Secret
  - 可选配置 Encrypt Key 和 Verification Token
  - 验证凭据有效性
- **验收标准**:
  - 输入验证正确
  - 凭据验证通过
  - 配置项完整

---

### Phase 5: 服务管理（Day 4-5）

#### 任务 9: 实现 SystemdServiceManager
- **文件**: `src/setup/service-manager/platforms/systemd.ts`
- **功能**:
  - 检测 systemd 可用性
  - 生成用户级服务文件
  - install/start/stop/restart/logs/uninstall
- **验收标准**:
  - Linux 系统正常检测
  - 服务文件生成正确
  - 服务管理命令执行正常

#### 任务 10: 实现 LaunchdServiceManager
- **文件**: `src/setup/service-manager/platforms/launchd.ts`
- **功能**:
  - 检测 launchd 可用性
  - 生成 plist 文件
  - install/start/stop/restart/logs/uninstall
- **验收标准**:
  - macOS 系统正常检测
  - plist 文件生成正确
  - 服务管理命令执行正常

#### 任务 11: 实现服务配置向导
- **文件**: `src/setup/wizard/service-config.ts`
- **功能**:
  - 显示可用运行方式（根据平台动态过滤）
  - 选择运行模式
  - 配置服务参数（名称、日志目录、自动重启、开机自启）
  - 预览生成的配置
- **验收标准**:
  - 平台检测正确
  - 选项过滤正确
  - 参数配置完整

---

### Phase 6: 配置生成与整合（Day 5-6）

#### 任务 12: 实现配置文件生成器
- **文件**:
  - `src/setup/writers/config-file.ts` - 生成 config.yaml
  - `src/setup/writers/service-files.ts` - 生成服务文件
- **功能**:
  - 根据配置生成完整的 config.yaml
  - 生成 systemd/launchd 服务文件
- **验收标准**:
  - 生成的 config.yaml 格式正确
  - 服务文件语法正确
  - 配置项完整无遗漏

#### 任务 13: 实现主流程整合
- **文件**: `src/setup/wizard/index.ts`, `src/setup/index.ts`
- **功能**:
  - 欢迎界面
  - 主流程控制（Node.js → CLI → 飞书 → 服务 → 应用）
  - 配置摘要显示
  - 安装执行
  - 完成界面
- **验收标准**:
  - 流程完整
  - 错误处理完善
  - 用户体验流畅

---

### Phase 7: 集成与测试（Day 6-7）

#### 任务 14: 添加 package.json 脚本
- **文件**: `package.json`
- **内容**:
  ```json
  {
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
- **验收标准**: 命令可以正常执行

#### 任务 15: 完整流程测试
- **测试场景**:
  1. 全新安装（无 Node.js → 安装 → 配置 → 启动）
  2. 已有 Node.js 但版本过低 → 升级
  3. 已有 OpenCode 但未登录 → 引导登录
  4. 已有完整环境 → 快速配置
  5. Linux systemd 用户服务
  6. macOS launchd 用户服务
- **验收标准**: 所有场景测试通过

#### 任务 16: 文档更新
- **文件**: `README.md`, `doc/CHANGELOG.md`
- **内容**:
  - 更新 README 添加安装向导说明
  - 更新 CHANGELOG 记录新功能
- **验收标准**: 文档清晰，示例完整

---

## 任务清单

| ID | 任务 | 优先级 | 状态 | 依赖 |
|----|------|--------|------|------|
| 1 | 创建 setup 目录结构 | P0 | ✅ | - |
| 2 | 安装依赖 | P0 | ✅ | 1 |
| 3 | 定义核心接口 | P0 | ✅ | 2 |
| 4 | Node.js 检测器 | P0 | ✅ | 3 |
| 5 | Node.js 安装向导 | P0 | ✅ | 4 |
| 6 | OpenCodeProvider | P0 | ✅ | 3 |
| 7 | CLI 配置向导 | P0 | ✅ | 6 |
| 8 | 飞书配置向导 | P0 | ✅ | 3 |
| 9 | SystemdServiceManager | P0 | ✅ | 3 |
| 10 | LaunchdServiceManager | P0 | ✅ | 3 |
| 11 | 服务配置向导 | P0 | ✅ | 9, 10 |
| 12 | 配置文件生成器 | P0 | ✅ | 3 |
| 13 | 主流程整合 | P0 | ✅ | 5, 7, 8, 11, 12 |
| 14 | package.json 更新 | P1 | ✅ | 13 |
| 15 | 完整流程测试 | P0 | ✅ | 13 |
| 16 | 文档更新 | P1 | ✅ | 15 |

---

## 接口设计确认

### ICLIProvider 接口

```typescript
export interface ICLIProvider {
  readonly id: string;
  readonly displayName: string;
  readonly adapterName: string;
  readonly websiteUrl: string;
  readonly docsUrl: string;
  readonly minVersion?: string;
  readonly recommendedModels: Array<{ id: string; name: string; description?: string }>;

  check(): Promise<CLICheckResult>;
  getInstallMethods(): InstallMethod[];
  install(method: string, options?: InstallOptions): Promise<InstallResult>;
  verify(): Promise<boolean>;
  getAuthStatus(): Promise<AuthStatus>;
  login(): Promise<boolean>;
  fetchModels(): Promise<Array<{ id: string; name: string; provider?: string }>>;
  getDefaultConfig(): CLIConfig;
}
```

### IServiceManager 接口

```typescript
export interface IServiceManager {
  readonly platform: string;
  
  isAvailable(): Promise<boolean>;
  requiresAdmin(mode: ServiceMode): boolean;
  getStatus(serviceName: string): Promise<ServiceStatus>;
  install(config: ServiceConfig): Promise<{ success: boolean; error?: string }>;
  uninstall(serviceName: string): Promise<{ success: boolean; error?: string }>;
  start(serviceName: string): Promise<{ success: boolean; error?: string }>;
  stop(serviceName: string): Promise<{ success: boolean; error?: string }>;
  restart(serviceName: string): Promise<{ success: boolean; error?: string }>;
  logs(serviceName: string, lines?: number): Promise<string>;
  getConfigPath(serviceName: string): string;
  getAvailableOptions(): RunOption[];
}
```

---

## 注意事项

1. **仅 OpenCode**: 第一个版本只实现 OpenCode 提供器，Codex/Claude Code 预留接口
2. **用户级服务优先**: 优先使用 systemd 用户服务和 launchd 用户服务，避免管理员权限
3. **错误处理**: 每个步骤都需要完善的错误处理和用户提示
4. **回滚机制**: 安装失败时提供清晰的错误信息和清理建议
5. **平台检测**: 自动检测平台，只显示适用的选项

---

## 下一步

请确认此计划后，我将开始实现 Phase 1 的任务。
