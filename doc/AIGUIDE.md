# AIGuide — 大模型部署指南

> 本文档供 AI 助手（如 Claude Code）在接受用户部署任务时直接执行。
> 按顺序完成各步骤即可将项目从零部署到可用状态。

---

## 一、前置条件检查

在开始前，确认以下工具已安装：

```bash
python --version          # 需要 3.12+
pip --version             # 或 uv（推荐）
opencode --version        # OpenCode CLI（主要 AI 后端，必须在 PATH 中）
# codex --version         # Codex CLI（可选，默认关闭）
```

> **OpenCode 由桥接程序自动管理**：启动 `python -m src.main` 后，收到第一条消息时桥接程序会自动执行 `opencode serve --port 4096`，无需手动启动。但 `opencode` 可执行文件必须存在于 PATH 中。

如果 Python 版本不符或工具缺失，**先停下来告知用户**，不要继续。

---

## 二、安装依赖

```bash
# 进入项目目录
cd /path/to/cli-feishu-bridge

# 方式一：pip
pip install -r requirements.txt

# 方式二：uv（更快）
uv pip install -r requirements.txt
```

安装完成后验证：

```bash
python -c "import lark_oapi, aiohttp, yaml; print('依赖 OK')"
```

---

## 三、创建飞书自建应用

> 此步骤需要用户在浏览器中操作，AI 助手应引导用户完成。

### 3.1 创建应用

1. 打开 [飞书开发者控制台](https://open.feishu.cn/app)
2. 点击「创建企业自建应用」
3. 填写应用名称（如 `AI Bridge`）和描述，点击创建

### 3.2 开启权限

**方式 A：批量导入（推荐）**

在权限管理页面找到「导入权限」功能，将 `doc/BOTAUTH.md` 的 JSON 内容粘贴导入，一次性开启所有权限。

**方式 B：手动开启（最小权限）**

进入应用 → **权限管理** → 搜索并开启以下权限（全部选「申请」）：

| 权限 | 说明 |
|------|------|
| `im:message` | 读取消息 |
| `im:message:send_as_bot` | 以机器人身份发消息 |
| `im:messageReaction:readonly` | 读取 Emoji Reaction |
| `im:messageReaction:write` | 添加/删除 Emoji Reaction |
| `contact:user.id:readonly` | 读取用户 ID |

### 3.3 配置事件订阅

进入应用 → **事件与回调** → **事件配置**：

1. 连接方式选「**使用长连接接收事件**」（无需公网 IP）
2. 点击「添加事件」→ 搜索 `im.message.receive_v1` → 订阅

### 3.4 卡片按钮回调（无需额外配置）

本项目使用**长连接**模式，卡片按钮点击产生的 `im.card.action.trigger_v1` 回调事件通过同一条 WebSocket 连接接收，**无需配置任何回调 URL**，也无需公网 IP。

> 不要在「卡片回调」中填写任何地址，否则飞书会尝试向该地址发送 HTTP 请求而非走长连接。

### 3.5 获取凭据并发布

1. 进入「凭证与基础信息」，记录 **App ID**（格式 `cli_xxx`）和 **App Secret**
2. 进入「版本管理与发布」→ 创建版本 → 填写版本号（如 `1.0.0`）→ 申请发布
   （企业内部应用发布无需审核，直接生效）

---

## 四、配置项目

### 方式 A：config.yaml（推荐）

```bash
cp config.example.yaml config.yaml
```

用文本编辑器打开 `config.yaml`，**至少填写以下两项**：

```yaml
feishu:
  app_id: "cli_xxxxxxxxxxxxxxxx"   # 替换为真实 App ID
  app_secret: "xxxxxxxxxxxxxx"     # 替换为真实 App Secret
```

完整可选配置示例（按需修改）：

```yaml
feishu:
  app_id: "cli_xxx"
  app_secret: "xxx"

session:
  max_sessions: 10       # LRU 最大会话数
  max_history: 20        # 单会话最大历史轮数
  storage_dir: ".sessions"

cli:
  opencode:
    enabled: true
    command: "opencode"
    default_model: "kimi-for-coding/k2p5"
    default_agent: "build"
    timeout: 300
    models:              # /model 命令展示的模型列表
      - id: "kimi-for-coding/k2p5"
        name: "Kimi K2.5"

project:
  storage_path: ""       # 留空 = ~/.config/cli-feishu-bridge/projects.json
  max_projects: 50
```

### 方式 B：纯环境变量（无 config.yaml）

```bash
export FEISHU_APP_ID="cli_xxx"
export FEISHU_APP_SECRET="xxx"
# 可选
export OPENCODE_MODEL="kimi-for-coding/k2p5"
export LOG_LEVEL="INFO"
```

---

## 五、启动服务

```bash
# 标准启动（推荐）
python -m src.main

# 或使用脚本
python start.py
./start.sh

# 强制 IM Patch 模式（CardKit 不可用时）
./start.sh --legacy
# 或
DISABLE_CARDKIT=1 python -m src.main
```

### 预期启动日志

```
INFO  - 加载配置成功
INFO  - OpenCode 适配器已启动（port 4096）
INFO  - 飞书 WebSocket 长连接已建立
INFO  - 等待消息...
```

如果出现 `WebSocket 连接失败` 或 `认证失败`，检查 App ID / App Secret 是否正确，以及应用版本是否已发布。

---

## 六、功能验证

在飞书中打开与机器人的**私聊**，发送以下消息验证：

| 测试内容 | 期望结果 |
|---------|---------|
| `你好` | 机器人回复，卡片流式输出 |
| `/help` | 显示帮助卡片，列出可用命令 |
| `/model` | 显示模型列表卡片，可点击切换 |
| `/new` | 创建新会话，卡片显示会话信息 |
| `/pa ~/code myproject` | 添加项目成功卡片 |

---

## 七、常见问题排查

### 机器人无响应

```bash
# 查看运行日志
python -m src.main 2>&1 | tail -50

# 运行诊断脚本
python scripts/diagnose_feishu.py
```

**可能原因**：
- App ID / App Secret 错误 → 检查 config.yaml 或环境变量
- 应用未发布 → 飞书控制台创建版本并发布
- 事件未订阅 → 确认已订阅 `im.message.receive_v1`
- 没有和机器人私聊 → 需在私聊中发消息，不支持群聊（默认）

### CardKit 更新失败 / 卡片不刷新

CardKit 是飞书高级功能，可能需要特定应用权限。退回 IM Patch 模式：

```bash
DISABLE_CARDKIT=1 python -m src.main
```

### OpenCode 启动失败

```bash
# 检查 opencode 是否可执行
opencode --version

# 手动测试 opencode serve
opencode serve --port 4096
```

若 opencode 未安装，参考 OpenCode 官方文档安装，或改用 Codex（在 config.yaml 中 `cli.codex.enabled: true`，`cli.opencode.enabled: false`）。

### 端口冲突（4096）

```bash
# 查看占用进程
lsof -i :4096
```

修改 OpenCode 监听端口，在 `config.yaml` 中增加：

```yaml
cli:
  opencode:
    server_port: 4097      # 改为未占用的端口
    server_hostname: "127.0.0.1"
```

---

## 八、后台运行（可选）

```bash
# 使用 nohup
nohup python -m src.main > bridge.log 2>&1 &
echo $! > bridge.pid

# 停止
kill $(cat bridge.pid)
```

或使用 systemd / supervisor 等进程管理器。

---

## 九、快速参考

| 操作 | 命令 |
|------|------|
| 启动 | `python -m src.main` |
| 查看帮助 | 飞书发送 `/help` |
| 切换模型 | 飞书发送 `/model` |
| 切换项目 | 飞书发送 `/pl` |
| 新建会话 | 飞书发送 `/new` |
| Lint 检查 | `ruff check src/` |
| 类型检查 | `mypy src/` |

---

*最后更新: 2026-03-21（v0.1.2）*
