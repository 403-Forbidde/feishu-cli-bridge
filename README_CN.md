# Feishu CLI Bridge

> [English](README.md) | [简体中文](#feishu-cli-bridge)

程序员专属：用飞书私聊向本地 CLI AI 工具下达指令，享受流式打字机输出体验。当前已接入 **OpenCode**，Codex 与 Kimi CLI 支持规划中。

**版本**: v0.2.0  
**开发**: ERROR403  
**更新日期**: 2026-04-01

## 使用场景

单人编程辅助。在任意设备上打开飞书，向自己的机器人发送编程指令，机器人将指令转发给运行在本地的 CLI AI 工具执行，流式返回结果。

**支持平台**：Windows、Linux、macOS（Apple Silicon / Intel）

典型场景：

- 在手机上查看代码或让 AI 解释某个实现
- 在会议间隙发起一个后台重构任务
- 切换不同项目目录，让 AI 在对应上下文中工作
- 在 Windows 开发环境中通过飞书调用本地 OpenCode

## 功能特性

- 🤖 **OpenCode 接入** — HTTP/SSE 方式，自动启动并管理 `opencode serve`，自动预授权外部目录访问（无头模式工具调用不阻塞）
- 🎭 **Agent 模式** — 内置 Build / Plan 模式；自动检测 oh-my-openagent，已安装时切换为 7 个专业 Agent，`/mode` 卡片一键切换
- 🔀 **模型切换** — `/model` 卡片展示 `config.yaml` 中配置的模型列表，点击按钮即时切换，无需重启
- 💬 **CardKit 流式输出** — 真正的打字机效果，100ms 节流推送；CardKit 不可用时自动降级 IM Patch（1500ms）
- 💭 **思考过程展示** — 可折叠思考面板，实时显示 AI 推理过程，工具调用步骤完成后继续等待文字回复
- 📊 **Token 统计** — 右对齐 Footer 紧凑显示耗时、Token 消耗、上下文占用率、模型名
- 🖼️ **图片/文件输入** — 发送图片或文件自动下载并 base64 编码，作为 FilePart 传给模型视觉识别
- 📁 **项目管理** — `/pl` 交互式卡片管理多个工作目录，点击「切换」按钮直接切换，带删除二次确认
- 🔄 **工作目录隔离** — 每个项目对应独立 OpenCode session（通过 `directory` 参数），工具调用 CWD 精确隔离
- ⚡ **智能节流** — 长间隙后先批处理再刷新，避免首次更新内容过少
- 🌐 **跨平台支持** — Windows / Linux / macOS

## Roadmap

> 欢迎通过 Issues 反馈优先级或提交 PR。

### 里程碑总览

| 里程碑 | 核心交付 | 状态 |
|--------|---------|------|
| **v0.2.0** | TypeScript 重写 · 架构优化 · 性能提升 | ✅ 已完成 |
| **v0.3.0** | Kimi CLI 适配器（Wire 协议） | 🔜 规划中 |
| **v1.0.0** | Codex CLI 适配器 | 🔜 规划中 |

---

### ✅ v0.2.0 — TypeScript 重写完成

- [x] 全面迁移至 TypeScript/Node.js 技术栈
- [x] 分层架构：Core → Platform → Adapter
- [x] 类型安全：严格的 TypeScript 类型定义
- [x] 性能优化：HTTP 连接池复用、智能节流
- [x] 安全加固：路径遍历防护、输入验证
- [x] CardKit 流式输出（打字机效果 + loading 动画，100ms 节流）
- [x] IM Patch 降级回退（CardKit 不可用时自动切换，1500ms 节流）
- [x] 可折叠思考面板（Reasoning 过程实时展示）
- [x] 图片 / 文件输入（base64 FilePart，视觉模型识别）
- [x] 多项目管理（`/pl` 交互式卡片切换工作目录）
- [x] TUI 命令（`/new` `/session` `/model` `/mode` `/reset` `/help` `/stop`）
- [x] OpenCode Server 会话管理（完全委托给 OpenCode 服务器，本地零持久化）
- [x] 跨平台支持：Windows / Linux / macOS

---

### 🔜 v0.3.0 — Kimi CLI 适配器（Wire 协议）

**目标**：将 [Kimi CLI](https://kimi.moonshot.cn) 以 Wire 协议接入，通过 `@kimi` 前缀调用。

| 特性 | 说明 |
|------|------|
| Wire 协议（JSON-RPC 2.0 over stdin/stdout） | 比 HTTP/SSE 延迟更低，无需启动独立 HTTP server |
| 持久化子进程池 | 每个 session 对应独立长驻 kimi 进程，上下文完整保留 |
| 思维链流式展示 | `--thinking` 模式下推理过程实时显示在可折叠面板 |
| `--yolo` 全自动模式 | 工具调用无需人工确认，配置开关控制 |
| 与 OpenCode 并行启用 | `@kimi` / `@opencode` 自由切换，无默认冲突 |

---

### 🔜 v1.0.0 — Codex CLI 适配器

**目标**：将 [Codex CLI](https://github.com/openai/codex) 以子进程模式接入，通过 `@codex` 前缀调用。

| 特性 | 说明 |
|------|------|
| 子进程流式输出 | `codex --stream` 模式，逐行解析 stdout |
| 独立会话管理 | 与 OpenCode / Kimi session 隔离，LRU 复用 |
| 与 OpenCode / Kimi 并行启用 | `@opencode` / `@kimi` / `@codex` 三路自由切换 |
| 图片输入支持 | 与 OpenCode 路径对齐，附件统一预处理 |

---

## 快速开始

### 第一步：安装前置依赖

需要 **Node.js 20+ LTS** 和 **opencode CLI**。

**Linux（Ubuntu/Debian）：**

```bash
# Node.js LTS
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs

# opencode
npm install -g opencode-ai
```

**macOS：**

```bash
brew install node    # 需先安装 Homebrew: https://brew.sh
npm install -g opencode-ai
```

**Windows（CMD）：**

- [Node.js LTS](https://nodejs.org/) — 安装时勾选「**Add to PATH**」
- 安装完成后：`npm install -g opencode-ai`

**验证：**

```bash
node --version      # 需 20+
npm --version
opencode --version
```

---

### 第二步：克隆项目 & 安装依赖

```bash
git clone <repo_url>
cd feishu-cli-bridge
npm install
```

---

### 第三步：创建飞书自建应用

1. 进入[飞书开发者控制台](https://open.feishu.cn/app)，创建**企业自建应用**
2. **权限管理** — 手动开启下表权限：

   | 权限 scope | 用途 |
   |-----------|------|
   | `im:message` | 读取消息 |
   | `im:message:send_as_bot` | 以机器人身份发消息 |
   | `im:message.reactions:read` | ✏️ 打字提示 |
   | `im:message.reactions:write_only` | 添加/删除 Reaction |
   | `im:resource` | 下载图片/文件 |
   | `contact:user.id:readonly` | 读取用户 ID |
   | `cardkit:card:read` / `cardkit:card:write` | CardKit 流式卡片（不开则自动降级） |

3. **事件与回调** → 连接方式选「**长连接**」→ 添加事件 `im.message.receive_v1`
   > 不要填写卡片回调 URL，长连接会自动接收卡片按钮回调。
4. **版本管理与发布** → 创建版本 → 发布（内部应用无需审核，立即生效）
5. 记录「凭证与基础信息」中的 **App ID** 和 **App Secret**

> 每次在控制台变更权限或事件订阅后，都需要重新发布版本才能生效。

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

```bash
# Linux / macOS
export FEISHU_APP_ID="cli_xxx"
export FEISHU_APP_SECRET="xxx"
```

```cmd
REM Windows CMD（临时）
set FEISHU_APP_ID=cli_xxx
set FEISHU_APP_SECRET=xxx
```

---

### 第五步：启动

**开发模式（热重载）：**

```bash
npm run dev
```

**开发模式（IM Patch 降级）：**

```bash
npm run dev:legacy
```

**生产模式：**

```bash
npm run build
npm start
```

启动成功后日志会显示 `🚀 Feishu CLI Bridge 启动成功！`。收到第一条飞书消息时，桥接程序会自动启动 `opencode serve`，无需手动操作。

---

### 后台运行（可选）

**Linux — systemd 用户服务（推荐，开机自启）：**

```bash
# 创建服务文件 ~/.config/systemd/user/cli-feishu-bridge.service
# 内容参考 scripts/install_service.sh（需自行修改适配 npm 启动）

systemctl --user enable --now cli-feishu-bridge   # 启动并设为自启
systemctl --user status  cli-feishu-bridge        # 查看状态
systemctl --user restart cli-feishu-bridge        # 重启
journalctl --user -u cli-feishu-bridge -f         # 实时日志
```

**使用 PM2：**

```bash
npm install -g pm2
pm2 start npm --name "feishu-bridge" -- start
pm2 save
pm2 startup
```

**macOS — nohup（推荐配合 tmux）：**

```bash
npm run build
nohup npm start > bridge.log 2>&1 &
```

**Windows — 任务计划程序（开机自启）：**

```cmd
schtasks /create /tn "FeiShuBridge" /tr "npm start" /sc onlogon /ru %USERNAME% /sd C:\path\to\feishu-cli-bridge /f
schtasks /end    /tn "FeiShuBridge"   & REM 停止
schtasks /delete /tn "FeiShuBridge" /f  & REM 卸载
```

---

## 使用方法

在飞书中打开与机器人的**私聊**，直接发送消息即可：

```
帮我写一个 Python 脚本来处理 CSV 文件
```

### 指定 CLI 工具

通过 `@` 前缀指定工具（默认优先 OpenCode）：

```
@codex 生成一个 React 组件
```

### TUI 命令

#### 会话 & 模型

| 命令 | 说明 |
|------|------|
| `/new` | 创建新会话 |
| `/session` | 列出最近 10 个会话，回复数字切换 |
| `/model` | 列出可用模型（卡片），点击按钮切换；模型列表在 `config.yaml` 中维护 |
| `/mode` | 列出 Agent 模式，点击卡片按钮切换（Build / Plan / oh-my-openagent） |
| `/mode <agent>` | 直接切换到指定 Agent 模式 |
| `/reset` 或 `/clear` | 清空当前会话上下文 |
| `/stop` | 强制停止当前 AI 输出 |
| `/help` | 显示帮助 |

#### 项目管理

| 命令 | 说明 |
|------|------|
| `/pa <路径> [名称]` | 添加已有目录为项目 |
| `/pc <路径> [名称]` | 创建新目录并添加为项目 |
| `/pl` | 列出所有项目（卡片带切换按钮） |
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

## 配置文件

完整 `config.yaml` 示例：

```yaml
# 飞书配置
feishu:
  app_id: "your_app_id"
  app_secret: "your_app_secret"

# 会话配置
session:
  max_sessions: 15          # 最大保留会话数（LRU，本地内存缓存）
  max_history: 20           # 单会话最大历史轮数

# CLI 工具配置
cli:
  opencode:
    enabled: true
    command: "opencode"
    default_model: "kimi-for-coding/k2p5"
    default_agent: "build"
    timeout: 300
    models:                        # /model 命令展示的常用模型列表
      - id: "kimi-for-coding/k2p5"
        name: "Kimi K2.5"
      - id: "opencode/mimo-v2-pro-free"
        name: "MiMo V2 Pro Free"

# 项目管理
project:
  storage_path: ""    # 留空使用默认 ~/.config/feishu-cli-bridge/projects.json
  max_projects: 50

# 安全配置
security:
  allowed_project_root: ""    # 允许的项目根目录（留空使用用户主目录）
  max_attachment_size: 52428800   # 最大附件大小（50MB）
  max_prompt_length: 100000       # 最大提示词长度

# 调试配置
debug:
  log_level: "info"       # debug | info | warn | error
  save_logs: true         # 是否保存日志到文件
  log_dir: ""            # 日志目录（留空使用默认）
```

## AI 回复卡片结构

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

## 项目结构

```
feishu-cli-bridge/
├── src/
│   ├── core/                  # 核心基础设施
│   │   ├── config.ts          # 配置管理（YAML + 环境变量）
│   │   ├── logger.ts          # Pino 日志
│   │   ├── retry.ts           # 指数退避重试
│   │   └── types/             # 共享类型定义
│   │
│   ├── adapters/              # CLI 适配器层
│   │   ├── interface/         # 抽象接口
│   │   │   ├── base-adapter.ts
│   │   │   └── types.ts
│   │   ├── opencode/          # OpenCode 适配器
│   │   │   ├── adapter.ts     # 主适配器
│   │   │   ├── http-client.ts # HTTP 客户端
│   │   │   ├── sse-parser.ts  # SSE 流解析
│   │   │   ├── server-manager.ts
│   │   │   └── session-manager.ts
│   │   └── factory.ts         # 适配器工厂
│   │
│   ├── platform/              # 飞书平台层
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
│   │   │   └── flush-controller.ts
│   │   └── cards/             # 卡片构建
│   │       ├── streaming.ts
│   │       ├── complete.ts
│   │       ├── session-cards.ts
│   │       ├── project-cards.ts
│   │       └── utils.ts
│   │
│   ├── card-builder/          # TUI 卡片构建
│   │   ├── base.ts
│   │   ├── interactive-cards.ts
│   │   ├── project-cards.ts
│   │   ├── session-cards.ts
│   │   └── utils.ts
│   │
│   ├── tui-commands/          # TUI 命令
│   │   ├── index.ts
│   │   ├── base.ts
│   │   ├── opencode.ts
│   │   └── project.ts
│   │
│   ├── project/               # 项目管理
│   │   ├── manager.ts
│   │   └── types.ts
│   │
│   ├── session/               # 会话管理
│   │   ├── manager.ts
│   │   └── types.ts
│   │
│   └── main.ts                # 入口
│
├── scripts/                   # 脚本工具
├── config.example.yaml        # 配置模板
├── package.json
├── tsconfig.json
└── README.md
```

## 更新日志

### v0.2.0 (2026-04-01) — TypeScript 重写

- 🔧 **全面迁移** — 从 Python 迁移至 TypeScript/Node.js
- 🏗️ **架构升级** — 分层架构：Core → Platform → Adapter
- 🔒 **类型安全** — 严格的 TypeScript 类型定义
- ⚡ **性能优化** — HTTP 连接池复用、智能节流
- 🛡️ **安全加固** — 路径遍历防护、输入验证
- 🎯 **功能完整** — 100% 功能对标 Python 版本

## 环境变量

| 变量 | 说明 |
|------|------|
| `FEISHU_APP_ID` | 飞书 App ID |
| `FEISHU_APP_SECRET` | 飞书 App Secret |
| `CONFIG_FILE` | 显式指定配置文件路径（覆盖自动发现） |
| `LOG_LEVEL` | 日志级别（默认 info） |
| `LOG_DIR` | 日志目录（留空则使用配置文件同级 `logs/`） |
| `DISABLE_CARDKIT` | 设为 `1` 强制使用 IM Patch 模式 |

## 开发命令

```bash
# 安装依赖
npm install

# 开发模式（热重载）
npm run dev

# 开发模式（IM Patch 降级）
npm run dev:legacy

# 类型检查
npm run typecheck

# 代码检查
npm run lint

# 构建
npm run build

# 生产运行
npm start

# 测试
npm run test
npm run test:unit
npm run test:integration
```

## 许可证

MIT License

## 致谢

- [Feishu OpenAPI SDK](https://github.com/larksuite/oapi-sdk-nodejs) — 飞书 Node.js SDK
- [OpenCode](https://opencode.ai) — AI 编程助手
