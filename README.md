# Feishu CLI Bridge

程序员专属：用飞书私聊向 OpenCode、Codex 等 CLI 编程工具下达指令，享受流式打字机输出体验。

**版本**: v0.1.2
**开发**: ERROR403
**更新日期**: 2026-03-21

## 使用场景

单人编程辅助。在任意设备上打开飞书，向自己的机器人发送编程指令，机器人将指令转发给本地 CLI 工具执行，流式返回结果。典型场景：

- 在手机上查看代码或让 AI 解释某个实现
- 在会议间隙发起一个后台重构任务
- 切换不同项目目录，让 AI 在对应上下文中工作

## 功能特性

- 🤖 **多 CLI 支持** — OpenCode、Codex，可同时启用，按 `@` 前缀指定
- 💬 **CardKit 流式输出** — 真正的打字机效果，逐字动画显示，左下角 loading 动画
- 💭 **思考过程展示** — 可折叠思考面板，实时显示 AI 推理过程
- 📊 **Token 统计** — Footer 紧凑显示耗时、Token 消耗、上下文占用率、模型名
- 🖼️ **图片/文件输入** — 直接发送图片或文件，模型视觉识别后分析
- 📁 **项目管理** — 管理多个工作目录，`/pl` 交互式卡片一键切换项目
- 🎮 **TUI 命令** — 斜杠命令管理会话（`/new` `/session`）、切换模型（`/model`）、切换 Agent 模式（`/mode`）
- 🔄 **工作目录隔离** — 每个项目对应独立 OpenCode session，工具调用 CWD 精确
- ⚡ **智能节流** — CardKit 100ms / IM Patch 1500ms 双模式，长间隙批处理优化

## 快速开始

### 1. 安装依赖

```bash
pip install -r requirements.txt
# 或
uv pip install -r requirements.txt
```

### 2. 创建飞书自建应用

1. 进入[飞书开发者控制台](https://open.feishu.cn/app)，创建**自建应用**
2. 权限管理中开启：`im:message`、`im:message:send_as_bot`、`im:messageReaction:readonly`、`im:messageReaction:write`、`contact:user.id:readonly`
3. 事件订阅 → 添加事件 `im.message.receive_v1`，连接方式选**长连接**
4. 记录 **App ID** 和 **App Secret**

### 3. 配置

从模板生成配置文件，填写飞书凭据：

```bash
cp config.example.yaml config.yaml
# 编辑 config.yaml，填写 app_id 和 app_secret
```

或只用环境变量（无需 config.yaml）：

```bash
export FEISHU_APP_ID="your_app_id"
export FEISHU_APP_SECRET="your_app_secret"
```

### 4. 启动

```bash
python -m src.main
# 或
python start.py
./start.sh
```

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
  storage_path: ""    # 留空使用默认 ~/.config/cli-feishu-bridge/projects.json
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
│   └── ISSUES.md
├── config.yaml
├── requirements.txt
└── start.sh
```

## 更新日志

### v0.1.2 (2026-03-21)
- ✅ 移除 Claude Code（claudecode）支持，仅保留 OpenCode 和 Codex

### v0.1.1 (2026-03-21)
- ✅ `/new` 卡片显示完整模型 ID（如 `anthropic/claude-sonnet-4-20250514`）

### v0.1.0 (2026-03-21)
- ✅ `/model` 命令卡片化：与 `/mode` 同风格，当前模型绿色高亮，点击按钮原地切换
- ✅ 模型列表改为配置驱动：在 `config.yaml` 的 `cli.opencode.models` 中维护常用模型

### v0.0.9 (2026-03-21)
- ✅ `/mode` 命令：Agent 模式切换卡片（Build / Plan / oh-my-openagent 全系列）
- ✅ 自动检测 oh-my-openagent：未安装显示内置模式，已安装切换为神话命名 Agent 列表
- ✅ 卡片按钮切换：当前模式绿色高亮，其余显示蓝色「▶ 切换至此」按钮，原地重绘

### v0.0.8 (2026-03-21)
- ✅ `/new` 命令卡片化：Schema 2.0 两列布局展示会话信息
- ✅ `/mode plan` 等直接切换命令返回与 `/mode` 样式统一的卡片

### v0.0.7 (2026-03-21)
- ✅ 项目列表卡片删除功能，二次确认防误操作
- ✅ `/pa`、`/pc` 命令响应改为卡片

### v0.0.6 (2026-03-21)
- ✅ `/pl` 返回交互式卡片，点击按钮直接切换项目（无需手动输入 `/ps`）
- ✅ 飞书卡片回调：切换成功后卡片自动刷新当前项目标记

### v0.0.5 (2026-03-21)
- ✅ 项目管理功能（`/pa /pc /pl /ps /prm /pi` 命令集）
- ✅ 切换项目后 AI 工具在对应目录执行（真正多项目隔离）
- ✅ 修复 OpenCode 工作目录不隔离（`directory` query 参数）

### v0.0.4 (2026-03-21)
- ✅ 图片/文件输入（发送图片，模型视觉识别）
- ✅ 切换为 `prompt_async` 端点（与 SSE 事件流架构对齐）

### v0.0.3 (2026-03-20)
- ✅ 卡片样式美化（自动 emoji 分类图标、紧凑 Footer）

### v0.0.2 (2026-03-20)
- ✅ TUI 命令（`/new`、`/session`、`/model`、`/reset`）
- ✅ 交互式消息回复（回复数字/模型 ID 切换）

### v0.0.1 (2026-03-20)
- ✅ CardKit 流式输出（打字机效果 + loading 动画）
- ✅ 可折叠思考面板 + Schema 2.0 卡片格式

完整日志见 [doc/CHANGELOG.md](doc/CHANGELOG.md)

## 环境变量

| 变量 | 说明 |
|------|------|
| `FEISHU_APP_ID` | 飞书 App ID |
| `FEISHU_APP_SECRET` | 飞书 App Secret |
| `LOG_LEVEL` | 日志级别（默认 INFO） |

## 许可证

MIT License

## 致谢

- [Lark OpenAPI SDK](https://github.com/larksuite/oapi-sdk-python)
- OpenClaw-Lark (ByteDance，MIT License) — 卡片样式和流式调度参考
- kimibridge — 流式输出实现参考
