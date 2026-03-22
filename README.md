# Feishu CLI Bridge

程序员专属：用飞书私聊向本地 CLI AI 工具下达指令，享受流式打字机输出体验。当前已接入 **OpenCode**，Codex 与 Kimi CLI 支持规划中。

**版本**: v0.1.6
**开发**: ERROR403
**更新日期**: 2026-03-22

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
- 🔄 **工作目录隔离** — 每个项目对应独立 OpenCode session，工具调用（bash/read_file 等）CWD 精确隔离
- ⚡ **智能节流** — 长间隙后先批处理再刷新，避免首次更新内容过少
- 🌐 **跨平台支持** — Windows / Linux / macOS，Linux 含 systemd 用户服务一键安装

## Roadmap

> 欢迎通过 Issues 反馈优先级或提交 PR。

### 里程碑总览

| 里程碑 | 核心交付 | 状态 |
|--------|---------|------|
| **v0.1.x** | OpenCode 接入 · CardKit 流式输出 · TUI 命令 · 多平台支持 | ✅ 已完成 |
| **v0.2.0** | Kimi CLI 适配器（Wire 协议） | 🔜 规划中 |
| **v1.0.0** | Codex CLI 适配器 | 🔜 规划中 |

---

### ✅ v0.1.x — 已完成

- [x] **OpenCode 适配器**（HTTP/SSE）：自动启动 `opencode serve`，`POST /session` 会话管理，SSE 事件流接收
- [x] CardKit 流式输出（打字机效果 + loading 动画，100ms 节流）
- [x] IM Patch 降级回退（CardKit 不可用时自动切换，1500ms 节流）
- [x] 可折叠思考面板（Reasoning 过程实时展示）
- [x] 图片 / 文件输入（base64 FilePart，视觉模型识别）
- [x] 多项目管理（`/pl` 交互式卡片切换工作目录）
- [x] TUI 命令（`/new` `/session` `/model` `/mode` `/reset` `/help`）
- [x] LRU 会话持久化（最多 15 个，`.sessions/*.json`）
- [x] 跨平台支持：Windows / Linux / macOS

---

### 🔜 v0.2.0 — Kimi CLI 适配器（Wire 协议）

**目标**：将 [Kimi CLI](https://kimi.moonshot.cn) 以 Wire 协议接入，通过 `@kimi` 前缀调用。

| 特性 | 说明 |
|------|------|
| Wire 协议（JSON-RPC 2.0 over stdin/stdout） | 比 HTTP/SSE 延迟更低，无需启动独立 HTTP server |
| 持久化子进程池 | 每个 session 对应独立长驻 kimi 进程，上下文完整保留 |
| 思维链流式展示 | `--thinking` 模式下推理过程实时显示在可折叠面板 |
| `--yolo` 全自动模式 | 工具调用无需人工确认，配置开关控制 |
| 与 OpenCode 并行启用 | `@kimi` / `@opencode` 自由切换，无默认冲突 |

**实现路径**：新增 `src/adapters/kimicode.py`，预计约 400 行。

---

### 🔜 v1.0.0 — Codex CLI 适配器

**目标**：将 [Codex CLI](https://github.com/openai/codex) 以子进程模式接入，通过 `@codex` 前缀调用。

| 特性 | 说明 |
|------|------|
| 子进程流式输出 | `codex --stream` 模式，逐行解析 stdout |
| 独立会话管理 | 与 OpenCode / Kimi session 隔离，LRU 复用 |
| 与 OpenCode / Kimi 并行启用 | `@opencode` / `@kimi` / `@codex` 三路自由切换 |
| 图片输入支持 | 与 OpenCode 路径对齐，附件统一预处理 |

**实现路径**：完善 `src/adapters/codex.py`，预计新增约 150 行。

---

## 快速开始（Linux · Ubuntu 24.04）

> macOS 和 Windows 用户请跳转至下方对应平台章节。

### 前置要求

Ubuntu 24.04 内置 Python 3.12，需确保 `python3-venv` 已安装：

```bash
sudo apt update && sudo apt install -y python3-venv python3-pip
```

安装 Node.js LTS（opencode 通过 npm 分发）：

```bash
# 通过 NodeSource 安装最新 LTS
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
```

安装 opencode CLI：

```bash
npm install -g opencode-ai
```

验证安装：

```bash
python3 --version   # 需 3.12+
node --version      # 需 LTS（18+）
opencode --version
```

### 1. 克隆项目 & 创建虚拟环境

```bash
git clone <repo_url>
cd feishu-cli-bridge

# 创建虚拟环境（Ubuntu 24.04 Python 3.12+ 必须）
python3 -m venv .venv
source .venv/bin/activate

# 安装依赖
pip install -r requirements.txt
```

激活后命令行前缀会出现 `(.venv)`，表示虚拟环境已生效。

### 2. 创建飞书自建应用

1. 进入[飞书开发者控制台](https://open.feishu.cn/app)，创建**自建应用**
2. 权限管理中开启所需权限（推荐批量导入，见下方说明）
3. 事件订阅 → 添加事件 `im.message.receive_v1`，连接方式选**长连接**
4. 创建版本并发布（企业内部应用无需审核，发布后立即生效）
5. 记录 **App ID** 和 **App Secret**

**权限配置（二选一）：**

**方式 A — 批量导入（推荐）：** 在权限管理页面点击「导入权限」，将 [`doc/BOTAUTH.md`](doc/BOTAUTH.md) 的 JSON 内容粘贴进去，一次性导入所有必需权限。

**方式 B — 手动开启：** 搜索并逐一添加以下权限：

| 权限 scope | 用途 |
|-----------|------|
| `im:message` | 读取消息 |
| `im:message:send_as_bot` | 以机器人身份发消息 |
| `im:message.reactions:read` | 读取 Emoji Reaction（打字提示） |
| `im:message.reactions:write_only` | 添加/删除 Emoji Reaction |
| `im:resource` | 下载消息中的图片/文件 |
| `contact:user.id:readonly` | 读取用户 ID |
| `cardkit:card:read` | CardKit 流式卡片（可选，不开启则自动降级） |
| `cardkit:card:write` | CardKit 流式卡片（可选，不开启则自动降级） |

### 3. 配置

从模板生成配置文件，填写飞书凭据：

```bash
cp config.example.yaml config.yaml
# 用编辑器打开，填写 app_id 和 app_secret
nano config.yaml
```

或只用环境变量（无需 config.yaml）：

```bash
export FEISHU_APP_ID="your_app_id"
export FEISHU_APP_SECRET="your_app_secret"
```

### 4. 启动

```bash
# 推荐：start.sh 自动检测并激活 .venv，无需手动激活
./start.sh           # CardKit 流式模式（默认）
./start.sh --legacy  # 传统 IM Patch 模式

# 或直接用 python3
source .venv/bin/activate  # 若虚拟环境未激活
python3 -m src.main
```

### 后台运行（systemd 用户服务）

```bash
# 安装 systemd 用户服务（开机自启，无需 root）
bash scripts/install_service.sh

# 管理服务
systemctl --user status feishu-bridge
systemctl --user stop feishu-bridge
systemctl --user restart feishu-bridge

# 卸载服务
bash scripts/uninstall_service.sh
```

## macOS 运行说明（Apple Silicon / Intel）

`./start.sh` 在 macOS 上可直接运行，无需任何代码修改。所有依赖均有 macOS arm64/x86_64 wheel，无 Linux 专属组件。

### 前置要求

```bash
# 安装 Homebrew（如果没有）
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 安装 Python 3
brew install python3

# 安装 Node.js LTS
brew install node
```

> **注意**：macOS 系统自带的 `python3` 版本可能较旧，建议通过 Homebrew 安装最新版本。

### 安装依赖（需使用虚拟环境）

macOS Python 3.12+ 起系统禁止直接向全局环境安装包（PEP 668），必须先创建虚拟环境：

```bash
# 在项目目录下创建虚拟环境
cd ~/feishu-cli-bridge
python3 -m venv .venv

# 激活虚拟环境
source .venv/bin/activate

# 安装依赖
pip install -r requirements.txt
```

激活后命令行提示符会出现 `(.venv)` 前缀，表示虚拟环境已生效。

### 启动

虚拟环境**无需每次手动激活**，`start.sh` 会自动检测并激活项目目录下的 `.venv`：

```bash
./start.sh           # CardKit 流式模式（默认）
./start.sh --legacy  # 传统 IM Patch 模式
```

### CLI 工具安装

opencode 和 codex 均需有对应平台的可执行文件。以 opencode 为例：

```bash
# 参考 opencode 官方文档安装 macOS 版本
brew install opencode   # 如果 Homebrew 提供
# 或从 GitHub Releases 下载 macOS 二进制
```

安装后验证：

```bash
which opencode   # 应输出可执行文件路径
```

### 与 Linux 的差异

| 特性 | Linux | macOS |
|------|-------|-------|
| `./start.sh` 启动 | ✅ | ✅ |
| 开发模式运行 | ✅ | ✅ |
| systemd 服务自启 | ✅ `scripts/install_service.sh` | ❌ 暂不支持 |
| launchd 服务自启 | ❌ | 🔜 计划支持 |

macOS 如需后台常驻，目前推荐结合终端复用工具（`tmux` / `screen`）使用 `./start.sh`。

## Windows 运行说明

`start.bat` 在 Windows 上可直接运行，无需管理员权限。

### 前置要求

- **Python 3.12+**：从 [python.org](https://www.python.org/downloads/windows/) 下载安装包，安装时务必勾选「**Add Python to PATH**」
- **Node.js LTS**：从 [nodejs.org](https://nodejs.org/) 下载 LTS 版本安装包，安装时勾选「**Add to PATH**」
- **opencode CLI**：安装 Node.js 后通过 npm 全局安装：

```cmd
npm install -g opencode-ai
```

验证安装：

```cmd
python --version
node --version
opencode --version
```

### 安装依赖（虚拟环境）

```cmd
cd C:\path\to\feishu-cli-bridge
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

激活后命令行前缀会出现 `(.venv)`。

### 配置

```cmd
copy config.example.yaml config.yaml
REM 用记事本或 VS Code 打开，填写 app_id 和 app_secret
notepad config.yaml
```

或使用环境变量（临时，当前窗口有效）：

```cmd
set FEISHU_APP_ID=cli_xxx
set FEISHU_APP_SECRET=xxx
```

永久设置（系统级）：

```powershell
[System.Environment]::SetEnvironmentVariable("FEISHU_APP_ID", "cli_xxx", "User")
[System.Environment]::SetEnvironmentVariable("FEISHU_APP_SECRET", "xxx", "User")
```

### 启动

`start.bat` 会自动检测并激活 `.venv`，无需每次手动激活：

```cmd
start.bat           REM CardKit 流式模式（默认）
start.bat --legacy  REM 传统 IM Patch 模式（CardKit 不可用时）
start.bat --help    REM 显示帮助
```

也可直接用 Python：

```cmd
python -m src.main
python start.py
```

### 后台运行（可选）

**方式一：PowerShell 隐藏窗口**

```powershell
Start-Process python -ArgumentList "-m src.main" -WorkingDirectory $PWD -WindowStyle Hidden
```

**方式二：Windows 任务计划程序（开机自启）**

```cmd
schtasks /create /tn "FeiShuBridge" /tr "python -m src.main" /sc onlogon /ru %USERNAME% /sd C:\path\to\feishu-cli-bridge /f
```

停止：

```cmd
schtasks /end /tn "FeiShuBridge"
schtasks /delete /tn "FeiShuBridge" /f
```

### 常见问题

**端口 4096 被占用**

```cmd
netstat -ano | findstr :4096
taskkill /PID <pid> /F
```

或在 `config.yaml` 中改端口：

```yaml
cli:
  opencode:
    server_port: 4097
```

**VCRUNTIME 缺失报错**

从微软官网安装 [Visual C++ Redistributable](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist)。

### 与 Linux/macOS 的差异

| 特性 | Linux | macOS | Windows |
|------|-------|-------|---------|
| 启动脚本 | `./start.sh` | `./start.sh` | `start.bat` |
| 开发模式运行 | ✅ | ✅ | ✅ |
| systemd 服务自启 | ✅ | ❌ | ❌ |
| 任务计划程序自启 | ❌ | ❌ | ✅ |
| launchd 自启 | ❌ | 🔜 | ❌ |

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
  max_sessions: 10          # 最大保留会话数（LRU）
  max_history: 20           # 单会话最大历史轮数
  storage_dir: ".sessions"  # 会话存储目录

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
│   ├── adapters/              # CLI 适配器（OpenCode/Codex）
│   ├── feishu/                # 飞书模块（WebSocket/API/卡片/流式控制）
│   ├── project/               # 项目管理（增删改查、JSON 持久化）
│   ├── session/               # 会话管理（LRU 缓存）
│   ├── tui_commands/          # TUI 斜杠命令（路由/交互/项目）
│   ├── config.py              # 配置管理（YAML + 环境变量）
│   └── main.py                # 入口
├── doc/
│   ├── CHANGELOG.md
│   ├── ISSUES.md
│   └── AIGUIDE.md         # AI 模型部署指南
├── config.yaml
├── requirements.txt
├── start.sh           # Linux/macOS 启动脚本
└── start.bat          # Windows 启动脚本
```

## 更新日志

### v0.1.6 (2026-03-22)
- ✅ 修复 `parse_chunk` 接口签名与基类不符（内部重命名为 `_parse_event`）
- ✅ 修复 `asyncio.get_event_loop()` 弃用用法（替换为 `time.monotonic()` / `get_running_loop()`）
- ✅ 修复消息发送 fire-and-forget 丢失错误，改为 await 直接调用
- ✅ 修复 `_sessions` 并发竞态，添加 `asyncio.Lock` 保护

完整日志见 [doc/CHANGELOG.md](doc/CHANGELOG.md)

## 环境变量

| 变量 | 说明 |
|------|------|
| `FEISHU_APP_ID` | 飞书 App ID |
| `FEISHU_APP_SECRET` | 飞书 App Secret |
| `CONFIG_FILE` | 显式指定配置文件路径（覆盖自动发现） |
| `LOG_LEVEL` | 日志级别（默认 INFO） |
| `LOG_DIR` | 日志目录（留空则使用配置文件同级 `logs/`） |
| `DISABLE_CARDKIT` | 设为 `1` 强制使用 IM Patch 模式 |

## 许可证

MIT License

## 致谢

- [Lark OpenAPI SDK](https://github.com/larksuite/oapi-sdk-python)