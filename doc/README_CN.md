<div align="center">

<!-- Logo/Title -->
<img src="https://img.shields.io/badge/Feishu-CLI%20Bridge-1677FF?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik0xMiAybDIuNCA3LjJoNy42bC02IDQuOCAyLjQgNy4yLTYtNC44LTYgNC44IDIuNC03LjItNi00LjhoNy42eiIvPjwvc3ZnPg==&logoColor=white" height="40" alt="Feishu CLI Bridge">

<h1>
  <img src="https://img.shields.io/badge/🚀-Feishu%20CLI%20Bridge-FF6B6B?style=flat-square&colorA=2d3436&colorB=FF6B6B" height="28">
</h1>

<p align="center">
  <b>程序员专属：用飞书私聊向本地 CLI AI 工具下达指令，享受流式打字机输出体验</b><br>
  <i>当前已接入 OpenCode，Codex 与 Kimi CLI 支持规划中</i>
</p>

<!-- Language Switch -->
<p>
  <a href="../README.md">
    <img src="https://img.shields.io/badge/🇬🇧-English-white?style=flat-square&color=3498db" height="20">
  </a>
  <a href="#feishu-cli-bridge">
    <img src="https://img.shields.io/badge/🇨🇳-简体中文-white?style=flat-square&color=2ecc71" height="20">
  </a>
</p>

<!-- Status Badges -->
<p>
  <img src="https://img.shields.io/badge/version-v0.2.0-FF6B6B?style=flat-square&logo=semver&logoColor=white" alt="Version">
  <img src="https://img.shields.io/badge/license-MIT-4ECDC4?style=flat-square&logo=opensourceinitiative&logoColor=white" alt="License">
  <img src="https://img.shields.io/badge/TypeScript-5.0+-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Node.js-20+-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js">
</p>

<!-- Platform Support -->
<p>
  <img src="https://img.shields.io/badge/Windows-0078D6?style=flat-square&logo=windows&logoColor=white" alt="Windows">
  <img src="https://img.shields.io/badge/Linux-FCC624?style=flat-square&logo=linux&logoColor=black" alt="Linux">
  <img src="https://img.shields.io/badge/macOS-000000?style=flat-square&logo=apple&logoColor=white" alt="macOS">
</p>

<!-- Last Updated -->
<p>
  <img src="https://img.shields.io/badge/Updated-2026--04--02-9b59b6?style=flat-square" alt="Updated">
</p>

</div>

---

## 📑 目录

- [🎯 使用场景](#-使用场景)
- [✨ 功能特性](#-功能特性)
- [🗺️ Roadmap](#️-roadmap)
- [⚡ 快速开始](#-快速开始)
- [📖 使用方法](#-使用方法)
- [⚙️ 配置文件](#️-配置文件)
- [🏗️ 项目结构](#️-项目结构)
- [🔧 开发命令](#-开发命令)
- [📝 更新日志](#-更新日志)
- [📄 许可证](#-许可证)

---

## 🎯 使用场景

**单人编程辅助。** 在任意设备上打开飞书，向自己的机器人发送编程指令，机器人将指令转发给运行在本地的 CLI AI 工具执行，流式返回结果。

**支持平台**：Windows、Linux、macOS（Apple Silicon / Intel）

### 典型场景

| 场景 | 描述 |
|:-----|:-----|
| 📱 **手机查看** | 在手机上查看代码或让 AI 解释某个实现 |
| 💼 **会议间隙** | 在会议间隙发起一个后台重构任务 |
| 🔄 **上下文切换** | 切换不同项目目录，让 AI 在对应上下文中工作 |
| 🪟 **Windows 环境** | 在 Windows 开发环境中通过飞书调用本地 OpenCode |

---

## ✨ 功能特性

<table>
<tr>
<td width="50%">

### 🤖 **OpenCode 接入**
HTTP/SSE 方式，自动启动并管理 `opencode serve`，自动预授权外部目录访问（无头模式工具调用不阻塞）

### 🎭 **Agent 模式**
内置 Build / Plan 模式；自动检测 oh-my-openagent，已安装时切换为 7 个专业 Agent，`/mode` 卡片一键切换

### 🔀 **模型切换**
`/model` 卡片展示 `config.yaml` 中配置的模型列表，点击按钮即时切换，无需重启

### 💬 **CardKit 流式输出**
真正的打字机效果，100ms 节流推送；CardKit 不可用时自动降级 IM Patch（1500ms）

### 💭 **思考过程展示**
可折叠思考面板，实时显示 AI 推理过程，工具调用步骤完成后继续等待文字回复

</td>
<td width="50%">

### 📊 **Token 统计**
右对齐 Footer 紧凑显示耗时、Token 消耗、上下文占用率、模型名

### 🖼️ **图片/文件输入**
发送图片或文件自动下载并 base64 编码，作为 FilePart 传给模型视觉识别

### 📁 **项目管理**
`/pl` 交互式卡片管理多个工作目录，支持分页，点击「切换」按钮直接切换，带删除二次确认

### 🔄 **工作目录隔离**
每个项目对应独立 OpenCode session（通过 `directory` 参数），工具调用 CWD 精确隔离

### ⚡ **智能节流**
长间隙后先批处理再刷新，避免首次更新内容过少

</td>
</tr>
</table>

---

## 🗺️ Roadmap

> 欢迎通过 Issues 反馈优先级或提交 PR。

### 里程碑总览

| 里程碑 | 核心交付 | 状态 |
|:-------|:---------|:----:|
| **v0.2.0** | TypeScript 重写 · 架构优化 · 性能提升 | ✅ 已完成 |
| **v0.3.0** | Claude Code 适配器 | 🔜 规划中 |
| **v0.4.0** | Kimi CLI 适配器（Wire 协议） | 🔜 规划中 |
| **v0.5.0** | Codex CLI 适配器 | 🔜 规划中 |
| **v1.0.0** | 首个正式版本 | 🔜 规划中 |

---

### ✅ v0.2.0（当前版本）— TypeScript 重写完成

- [x] 全面迁移至 TypeScript/Node.js 技术栈
- [x] 分层架构：Core → Platform → Adapter
- [x] 类型安全：严格的 TypeScript 类型定义
- [x] 性能优化：HTTP 连接池复用、智能节流
- [x] 安全加固：路径遍历防护、输入验证
- [x] CardKit 流式输出（打字机效果 + loading 动画，100ms 节流）
- [x] IM Patch 降级回退（CardKit 不可用时自动切换，1500ms 节流）
- [x] 可折叠思考面板（Reasoning 过程实时展示）
- [x] 图片 / 文件输入（base64 FilePart，视觉模型识别）
- [x] 多项目管理（`/pl` 交互式卡片，支持分页与删除二次确认）
- [x] TUI 命令（`/new` `/session` `/model` `/mode` `/reset` `/help` `/stop`），全部以交互式卡片回复
- [x] OpenCode Server 会话管理（完全委托给 OpenCode 服务器，本地零持久化）
- [x] 跨平台支持：Windows / Linux / macOS

---

### 🔜 v0.3.0 — Claude Code 适配器

**目标**：集成 Claude Code CLI，通过 `@claude` 前缀调用。

| 特性 | 说明 |
|:-----|:-----|
| 子进程流式输出 | 实时解析 stdout/stderr 实现流式响应 |
| 会话管理 | 与 OpenCode 会话隔离，LRU 复用 |
| 双路并行启用 | `@opencode` / `@claude` 自由切换 |
| 图片输入支持 | 统一的附件预处理管道 |

---

### 🔜 v0.4.0 — Kimi CLI 适配器（Wire 协议）

**目标**：将 [Kimi CLI](https://kimi.moonshot.cn) 以 Wire 协议接入，通过 `@kimi` 前缀调用。

| 特性 | 说明 |
|:-----|:-----|
| Wire 协议（JSON-RPC 2.0 over stdin/stdout） | 比 HTTP/SSE 延迟更低，无需启动独立 HTTP server |
| 持久化子进程池 | 每个 session 对应独立长驻 kimi 进程，上下文完整保留 |
| 思维链流式展示 | `--thinking` 模式下推理过程实时显示在可折叠面板 |
| `--yolo` 全自动模式 | 工具调用无需人工确认，配置开关控制 |
| 三路并行启用 | `@opencode` / `@claude` / `@kimi` 自由切换 |

---

### 🔜 v0.5.0 — Codex CLI 适配器

**目标**：将 [Codex CLI](https://github.com/openai/codex) 以子进程模式接入，通过 `@codex` 前缀调用。

| 特性 | 说明 |
|:-----|:-----|
| 子进程流式输出 | `codex --stream` 模式，逐行解析 stdout |
| 独立会话管理 | 与其他 CLI 会话隔离，LRU 复用 |
| 四路并行启用 | `@opencode` / `@claude` / `@kimi` / `@codex` 自由切换 |
| 图片输入支持 | 与 OpenCode 路径对齐，附件统一预处理 |

---

### 🔜 v1.0.0 — 首个正式版本

**目标**：经过大量测试和完善后的生产就绪稳定版本。

| 重点领域 | 说明 |
|:---------|:-----|
| 稳定性与可靠性 | 全面的错误处理、优雅降级 |
| 性能优化 | 连接池、缓存、内存优化 |
| 文档完善 | 完整的 API 文档、部署指南、故障排查 |
| 测试覆盖 | 高测试覆盖率、集成测试、E2E 验证 |

---

## ⚡ 快速开始

### 第一步：安装前置依赖

在开始之前，请确保已安装以下软件：

| 依赖 | 最低版本 | 用途 | 安装方式 |
|:-----|:--------|:-----|:---------|
| **Node.js** | 20+ LTS | 运行环境 | [官网下载](https://nodejs.org/) 或包管理器 |
| **Git** | 任意 | 克隆仓库 | [官网下载](https://git-scm.com/) 或包管理器 |
| **OpenCode CLI** | 0.5.0+ | AI 编程助手 | `npm install -g opencode-ai` |

> 💡 **重要说明**：本项目是**桥接工具**，专注于连接飞书和本地 CLI 工具。**不会自动安装** OpenCode 等 CLI 工具，配置向导只负责检测和引导。

#### 各平台安装指南

<details>
<summary><b>🐧 Linux（Ubuntu/Debian）</b></summary>

```bash
# 1. 安装 Node.js LTS
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. 验证 Node.js 版本
node --version  # 应显示 v20.x.x 或更高

# 3. 安装 OpenCode CLI（需手动安装）
npm install -g opencode-ai

# 4. 验证 OpenCode
opencode --version
```

**常见问题**：
- 如果 `npm` 提示权限错误，尝试：`sudo npm install -g opencode-ai`
- 或者更改 npm 全局目录：[npm 文档](https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally)

</details>

<details>
<summary><b>🍎 macOS</b></summary>

```bash
# 1. 安装 Homebrew（如未安装）
# 访问 https://brew.sh 获取安装命令

# 2. 安装 Node.js
brew install node

# 3. 验证版本
node --version  # 应显示 v20.x.x 或更高

# 4. 安装 OpenCode CLI（需手动安装）
npm install -g opencode-ai

# 5. 验证
opencode --version
```

</details>

<details>
<summary><b>🪟 Windows</b></summary>

**依次安装以下软件：**

1. **[Node.js LTS (v20+)](https://nodejs.org/en/download)**
   - 下载 Windows Installer (.msi)
   - **关键**：安装过程中勾选「**Add to PATH**」

2. **[Git for Windows](https://git-scm.com/download/win)**
   - 下载 64-bit Git for Windows Setup
   - 使用默认选项安装即可

3. **OpenCode CLI**
   ```powershell
   npm install -g opencode-ai
   ```

**重要步骤**：
> 安装完成后，**重启 PowerShell**（或 CMD），使环境变量生效。

验证安装：
```powershell
node --version      # 应显示 v20.x.x
opencode --version  # 应显示 0.5.0+
```

</details>

---

### 安装方式选择

安装本项目有两种方式，选择适合你的：

| 方式 | 适用场景 | 复杂度 |
|:-----|:---------|:-------|
| **一键安装脚本** | 快速开始，自动完成大部分配置 | ⭐ 简单 |
| **手动克隆安装** | 开发者，需要自定义配置 | ⭐⭐ 中等 |

#### 方式一：一键安装脚本（推荐）

<details>
<summary><b>🐧 Linux / 🍎 macOS</b></summary>

```bash
curl -fsSL https://raw.githubusercontent.com/403-Forbidde/feishu-cli-bridge/main/scripts/setup.sh | bash
```

脚本会自动：
1. 检查 Node.js 版本（如低于 20 会尝试安装）
2. 检查 Git 是否安装
3. 克隆仓库到 `~/feishu-cli-bridge`
4. 安装 npm 依赖
5. 启动交互式配置向导

</details>

<details>
<summary><b>🪟 Windows (PowerShell)</b></summary>

```powershell
powershell -ExecutionPolicy Bypass -Command "iex (irm https://raw.githubusercontent.com/403-Forbidde/feishu-cli-bridge/main/scripts/setup.ps1)"
```

> `-ExecutionPolicy Bypass` 仅作用于当前进程，用于允许执行远程脚本。

脚本会：
1. 检查 Node.js 和 Git 是否已安装（**不会自动安装**，如未安装会提示）
2. 克隆仓库
3. 安装 npm 依赖
4. 启动交互式配置向导

</details>

**配置向导流程**：

```
┌─────────────────────────────────────────────────────────┐
│  1. CLI 工具检测                                         │
│     └─ 未安装 → 显示安装命令 → 等待手动安装 → 重新检测    │
│     └─ 已安装 → 检查登录状态 → 提示登录（如未登录）        │
│                                                         │
│  2. 模型选择                                            │
│     └─ 获取可用模型列表 → 选择默认模型                    │
│                                                         │
│  3. 飞书配置                                            │
│     └─ 输入 App ID / App Secret → 验证格式              │
│                                                         │
│  4. 服务配置（可选）                                     │n│     └─ 生成 systemd/launchd/Windows 服务配置             │
└─────────────────────────────────────────────────────────┘
```

> 💡 **注意**：配置向导**不会自动安装 CLI 工具**，只负责检测和引导。如果未检测到，会显示安装命令供你手动执行。

---

### 第二步：克隆项目 & 安装依赖

```bash
# 克隆仓库
git clone <仓库地址>
cd feishu-cli-bridge

# 安装依赖
npm install
```

> 💡 **手动安装 vs 一键安装**：如果你使用了一键安装脚本，这一步已经完成，直接进入第三步。

---

### 关于 CLI 工具的重要说明

本项目是一个**桥接工具**，负责连接飞书和本地 CLI 工具。

- ✅ **我们会做的**：检测 CLI 工具、引导你完成配置、启动桥接服务
- ❌ **我们不会做的**：自动执行 `npm install -g opencode-ai` 等安装命令

**为什么？** 全局安装需要 sudo 权限，可能与你现有的 Node.js 环境冲突。我们相信你应该完全掌控自己的开发环境。

**如果未检测到 CLI 工具**，配置向导会显示安装命令供你手动执行，安装完成后继续配置。`

---

### 第三步：创建飞书自建应用

#### 3.1 创建应用

1. 进入[飞书开发者控制台](https://open.feishu.cn/app)，点击「创建企业自建应用」
2. 填写应用信息（名称、描述、图标）

#### 3.2 配置权限

**方式一：JSON 批量导入（推荐）**

本项目提供了完整的权限配置文件 [`doc/feishu_permissions.json`](./feishu_permissions.json)，包含所有必需的权限。操作步骤：

```
权限管理 → 批量导入 → 选择 feishu_permissions.json 文件 → 确认导入
```

导入后将自动启用消息、卡片、文件下载等所有必需权限。

**方式二：手动开启**

如需手动配置，请开启以下权限：

| 权限 scope | 用途 | 是否必需 |
|:-----------|:-----|:--------:|
| `im:message` | 读取消息 | ✅ |
| `im:message:send_as_bot` | 以机器人身份发消息 | ✅ |
| `im:message.reactions:read` | ✏️ 打字提示 | ✅ |
| `im:message.reactions:write_only` | 添加/删除 Reaction | ✅ |
| `im:resource` | 下载图片/文件 | ✅ |
| `contact:user.id:readonly` | 读取用户 ID | ✅ |
| `cardkit:card:read` / `cardkit:card:write` | CardKit 流式卡片 | ❌ |

> 💡 **提示**：如果不开启 CardKit 权限，系统会自动降级使用 IM Patch 模式（1500ms 刷新间隔），核心功能不受影响。

#### 3.3 配置事件订阅

**事件与回调** → 连接方式选择「**长连接**」→ 添加事件 `im.message.receive_v1`

> 不要填写卡片回调 URL，长连接模式会自动接收卡片按钮点击事件。

#### 3.4 发布应用

**版本管理与发布** → 创建版本 → 填写版本信息 → 发布

> 内部应用无需审核，发布后立即生效。

#### 3.5 记录凭证

进入「凭证与基础信息」页面，记录以下信息（后续配置需要）：
- **App ID**（格式：`cli_xxxxxxxxxxxxxxxx`）
- **App Secret**

> 📝 **重要提示**：每次修改权限或事件订阅后，必须创建新版本并发布才能生效。

---

### 第四步：配置

```bash
cp config.example.yaml config.yaml   # Windows: copy config.example.yaml config.yaml
```

打开 `config.yaml`，填写飞书凭据（**只有这两项是必填的**）：

```yaml
feishu:
  app_id: "cli_xxxxxxxxxxxxxxxx"
  app_secret: "xxxxxxxxxxxxxx"
```

也可以不创建配置文件，直接用环境变量：

<details>
<summary><b>🐧 Linux / macOS</b></summary>

```bash
export FEISHU_APP_ID="cli_xxx"
export FEISHU_APP_SECRET="xxx"
```

</details>

<details>
<summary><b>🪟 Windows CMD（临时）</b></summary>

```cmd
set FEISHU_APP_ID=cli_xxx
set FEISHU_APP_SECRET=xxx
```

</details>

---

### 第五步：启动

#### 开发模式（热重载）

```bash
npm run dev
```

#### 生产模式

```bash
npm run build
npm start
```

启动成功后日志会显示 `🚀 Feishu CLI Bridge 启动成功！`。收到第一条飞书消息时，桥接程序会自动启动 `opencode serve`，无需手动操作。

> 💡 **关于 CLI 工具安装**：本项目专注于桥接飞书与本地 CLI 工具，**不会自动安装** OpenCode 等 CLI 工具。首次运行配置向导时，如果未检测到 CLI 工具，向导会显示安装命令供你手动执行。这样可以避免权限问题和环境冲突，让你完全掌控自己的开发环境。

---

### 后台运行（可选）

<details>
<summary><b>🐧 Linux — systemd 用户服务（推荐，开机自启）</b></summary>

```bash
# 创建服务文件 ~/.config/systemd/user/feishu-cli-bridge.service
# 内容参考 scripts/install_service.sh（需自行修改适配 npm 启动）

systemctl --user enable --now feishu-cli-bridge   # 启动并设为自启
systemctl --user status  feishu-cli-bridge        # 查看状态
systemctl --user restart feishu-cli-bridge        # 重启
journalctl --user -u feishu-cli-bridge -f         # 实时日志
```

</details>

<details>
<summary><b>📦 使用 PM2</b></summary>

```bash
npm install -g pm2
pm2 start npm --name "feishu-bridge" -- start
pm2 save
pm2 startup
```

</details>

<details>
<summary><b>🍎 macOS — nohup（推荐配合 tmux）</b></summary>

```bash
npm run build
nohup npm start > bridge.log 2>&1 &
```

</details>

<details>
<summary><b>🪟 Windows — 任务计划程序（开机自启）</b></summary>

```cmd
schtasks /create /tn "FeiShuBridge" /tr "npm start" /sc onlogon /ru %USERNAME% /sd C:\path\to\feishu-cli-bridge /f
schtasks /end    /tn "FeiShuBridge"   & REM 停止
schtasks /delete /tn "FeiShuBridge" /f  & REM 卸载
```

> 在 CMD/PowerShell 中运行 `npm start` 前，先执行 `chcp 65001`，可避免中文日志乱码。

</details>

---

## 📖 使用方法

在飞书中打开与机器人的**私聊**，直接发送消息即可：

```
帮我写一个 Python 脚本来处理 CSV 文件
```

### 指定 CLI 工具

通过 `@` 前缀指定工具（默认优先 OpenCode）：

```
@codex 生成一个 React 组件
```

---

### 🎮 TUI 命令

#### 会话 & 模型

| 命令 | 说明 |
|:-----|:-----|
| `/new` | 创建新会话 |
| `/session` | 列出最近会话，以交互式卡片回复，支持切换/重命名/删除 |
| `/model` | 列出可用模型（卡片），点击按钮切换；模型列表在 `config.yaml` 中维护 |
| `/mode` | 列出 Agent 模式，点击卡片按钮切换（Build / Plan / oh-my-openagent） |
| `/mode <agent>` | 直接切换到指定 Agent 模式 |
| `/reset` 或 `/clear` | 清空当前会话上下文 |
| `/stop` | 强制停止当前 AI 输出 |
| `/help` | 显示帮助 |

#### 项目管理

| 命令 | 说明 |
|:-----|:-----|
| `/pa <路径> [名称]` | 添加已有目录为项目 |
| `/pc <路径> [名称]` | 创建新目录并添加为项目 |
| `/pl` | 列出所有项目（交互式卡片，支持分页与切换按钮） |
| `/ps <标识>` | 切换到指定项目 |
| `/prm <标识>` | 从列表移除项目（不删除目录） |
| `/pi [标识]` | 查看项目信息 |

切换项目后，AI 工具调用（`bash`/`read_file` 等）将在对应目录执行。`/pl` 返回交互式卡片，点击按钮可直接切换，无需手动输入命令。

**示例：**

```
/pa ~/code/my-app myapp 我的应用   # 添加并命名
/pl                                 # 查看项目列表（卡片带切换按钮）
/ps myapp                           # 命令行方式切换
/pi                                 # 查看当前项目信息
```

---

## ⚙️ 配置文件

完整 `config.yaml` 示例：

```yaml
# ═══════════════════════════════════════════════════════════════
# 飞书配置
# ═══════════════════════════════════════════════════════════════
feishu:
  app_id: "your_app_id"
  app_secret: "your_app_secret"

# ═══════════════════════════════════════════════════════════════
# 会话配置
# ═══════════════════════════════════════════════════════════════
session:
  max_sessions: 15          # 最大保留会话数（LRU，本地内存缓存）
  max_history: 20           # 单会话最大历史轮数

# ═══════════════════════════════════════════════════════════════
# CLI 工具配置
# ═══════════════════════════════════════════════════════════════
cli:
  opencode:
    enabled: true
    command: "opencode"
    default_model: "kimi"
    default_agent: "build"
    timeout: 300
    models:                        # /model 命令展示的常用模型列表
      - id: "kimi"
        name: "Kimi"
      - id: "opencode/mimo-v2-pro-free"
        name: "MiMo V2 Pro Free"

# ═══════════════════════════════════════════════════════════════
# 项目管理
# ═══════════════════════════════════════════════════════════════
project:
  storage_path: ""    # 留空使用默认 ~/.config/feishu-cli-bridge/projects.json（Linux/macOS）或 %APPDATA%\feishu-cli-bridge\projects.json（Windows）
  max_projects: 50

# ═══════════════════════════════════════════════════════════════
# 安全配置
# ═══════════════════════════════════════════════════════════════
security:
  allowed_project_root: ""    # 允许的项目根目录（留空使用用户主目录）
  max_attachment_size: 52428800   # 最大附件大小（50MB）
  max_prompt_length: 100000       # 最大提示词长度

# ═══════════════════════════════════════════════════════════════
# 调试配置
# ═══════════════════════════════════════════════════════════════
debug:
  log_level: "info"       # debug | info | warn | error
  save_logs: true         # 是否保存日志到文件
  log_dir: ""            # 日志目录（留空使用默认）
```

---

## 🎴 AI 回复卡片结构

```
┌─────────────────────────────────────────────┐
│ 回复 ERROR403: 帮我分析这段代码               │  ← 飞书原生引用气泡
├─────────────────────────────────────────────┤
│ 💭 Thought for 3.2s  [展开/折叠]             │  ← 可折叠思考面板
├─────────────────────────────────────────────┤
│ 这是 AI 的回复内容...                        │  ← 主回答（打字机效果）
│                                    ⊙ loading │  ← 流式中显示 loading 动画
├─────────────────────────────────────────────┤
│  ✅ 已完成 · ⏱️ 3.2s · 📊 1.2K (15%) · 🤖 Kimi │  ← 右对齐 Footer
└─────────────────────────────────────────────┘
```

---

## 🏗️ 项目结构

```
feishu-cli-bridge/
├── src/
│   ├── core/                  # 🔧 核心基础设施
│   │   ├── config.ts          # 配置管理（YAML + 环境变量）
│   │   ├── logger.ts          # Pino 日志
│   │   ├── retry.ts           # 指数退避重试
│   │   └── types/             # 共享类型定义
│   │       ├── config.ts
│   │       ├── stream.ts
│   │       └── index.ts
│   │
│   ├── adapters/              # 🔌 CLI 适配器层
│   │   ├── interface/         # 抽象接口
│   │   │   ├── base-adapter.ts
│   │   │   └── types.ts
│   │   ├── factory.ts         # 适配器工厂
│   │   ├── index.ts           # 适配器注册
│   │   └── opencode/          # OpenCode 适配器
│   │       ├── adapter.ts     # 主适配器
│   │       ├── http-client.ts # HTTP 客户端
│   │       ├── sse-parser.ts  # SSE 流解析
│   │       ├── server-manager.ts
│   │       ├── session-manager.ts
│   │       └── types.ts
│   │
│   ├── platform/              # 📱 飞书平台层
│   │   ├── feishu-client.ts   # WebSocket 客户端
│   │   ├── feishu-api.ts      # HTTP API 封装
│   │   ├── message-processor/ # 消息处理
│   │   │   ├── index.ts
│   │   │   ├── router.ts
│   │   │   ├── ai-processor.ts
│   │   │   ├── command-processor.ts
│   │   │   └── attachment-processor.ts
│   │   ├── streaming/         # 流式系统
│   │   │   ├── controller.ts
│   │   │   ├── flush-controller.ts
│   │   │   └── types.ts
│   │   └── cards/             # 卡片构建
│   │       ├── streaming.ts
│   │       ├── complete.ts
│   │       ├── session-cards.ts
│   │       ├── project-cards.ts
│   │       ├── error.ts
│   │       └── utils.ts
│   │
│   ├── card-builder/          # 🎨 TUI 卡片构建
│   │   ├── base.ts
│   │   ├── interactive-cards.ts
│   │   ├── project-cards.ts
│   │   ├── session-cards.ts
│   │   ├── constants.ts
│   │   └── utils.ts
│   │
│   ├── tui-commands/          # ⌨️ TUI 命令
│   │   ├── index.ts
│   │   ├── base.ts
│   │   ├── opencode.ts
│   │   └── project.ts
│   │
│   ├── project/               # 📁 项目管理
│   │   ├── manager.ts
│   │   ├── types.ts
│   │   └── index.ts
│   │
│   ├── session/               # 💾 会话管理
│   │   ├── manager.ts
│   │   ├── types.ts
│   │   └── index.ts
│   │
│   └── main.ts                # 🚀 入口
│
├── scripts/                   # 🛠️ 脚本工具
├── config.example.yaml        # 📝 配置模板
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── README.md                  # 🇬🇧 英文文档
└── doc/
    ├── CHANGELOG.md           # 版本更新日志
    ├── README_CN.md           # 🇨🇳 中文文档（本文件）
    └── feishu_permissions.json # 飞书机器人权限配置（开发者后台导入）
```

---

## 🔧 开发命令

```bash
# 📦 安装依赖
npm install

# 🔥 开发模式（热重载）
npm run dev

# 🔄 开发模式（IM Patch 降级）
npm run dev:legacy

# ✅ 类型检查
npm run typecheck

# 🔍 代码检查
npm run lint

# 🏗️ 构建
npm run build

# 🚀 生产运行
npm start

# 🧪 测试
npm run test
```

---

## 📝 更新日志

### v0.2.0 (2026-04-02) — TypeScript 重写（当前版本）

- 🔧 **全面迁移** — 从 Python 迁移至 TypeScript/Node.js
- 🏗️ **架构升级** — 分层架构：Core → Platform → Adapter
- 🔒 **类型安全** — 严格的 TypeScript 类型定义
- ⚡ **性能优化** — HTTP 连接池复用、智能节流
- 🛡️ **安全加固** — 路径遍历防护、输入验证
- 🎯 **功能完整** — 100% 功能对标 Python 版本
- 🎴 **TUI 统一卡片化** — 所有 TUI 命令（`/session`、`/model`、`/pl` 等）均以交互式卡片回复
- 📁 **项目管理增强** — `/pl` 卡片支持分页与删除二次确认

---

## 🌐 环境变量

| 变量 | 说明 |
|:-----|:-----|
| `FEISHU_APP_ID` | 飞书 App ID |
| `FEISHU_APP_SECRET` | 飞书 App Secret |
| `CONFIG_FILE` | 显式指定配置文件路径（覆盖自动发现） |
| `LOG_LEVEL` | 日志级别（默认 info） |
| `LOG_DIR` | 日志目录（留空则使用配置文件同级 `logs/`） |
| `DISABLE_CARDKIT` | 设为 `1` 强制使用 IM Patch 模式 |

---

## 📄 许可证

<p align="center">
  <img src="https://img.shields.io/badge/License-MIT-4ECDC4?style=for-the-badge&logo=opensourceinitiative&logoColor=white" alt="MIT License">
</p>

---

## 🙏 致谢

<table>
<tr>
<td align="center">
  <a href="https://github.com/larksuite/oapi-sdk-nodejs">
    <img src="https://img.shields.io/badge/Feishu-OpenAPI_SDK-1677FF?style=flat-square" alt="Feishu SDK">
  </a>
</td>
<td>
  <a href="https://github.com/larksuite/oapi-sdk-nodejs">Feishu OpenAPI SDK</a> — 飞书 Node.js SDK
</td>
</tr>
<tr>
<td align="center">
  <a href="https://github.com/larksuite/openclaw-lark">
    <img src="https://img.shields.io/badge/OpenClaw-Feishu_Plugin-FF6B6B?style=flat-square" alt="OpenClaw">
  </a>
</td>
<td>
  <a href="https://github.com/larksuite/openclaw-lark">OpenClaw Feishu Plugin</a> — 飞书卡片交互参考实现
</td>
</tr>
<tr>
<td align="center">
  <a href="https://opencode.ai">
    <img src="https://img.shields.io/badge/OpenCode-AI_Assistant-339933?style=flat-square" alt="OpenCode">
  </a>
</td>
<td>
  <a href="https://opencode.ai">OpenCode</a> — AI 编程助手
</td>
</tr>
</table>

---

<div align="center">

<p>
  <img src="https://img.shields.io/badge/Made%20with%20❤️%20by-ERROR403-FF6B6B?style=flat-square" alt="Author">
</p>

<p><i>⭐ 如果这个项目对你有帮助，请给它点个星！</i></p>

</div>
