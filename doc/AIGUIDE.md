# AIGuide — 大模型辅助部署指南

> 本文档供 AI 助手（如 Claude Code）在接受用户部署任务时直接执行。
> 按顺序完成各步骤即可将项目从零部署到可用状态。
> AI 助手应主动检测当前环境，在每一步给出针对性的指令，而非让用户自行判断。

---

## 一、环境检测

> **AI 助手应先执行这一节的检查，再决定后续步骤。**

### 1.1 确认操作系统

```bash
uname -s        # Linux → "Linux"，macOS → "Darwin"
# Windows 用户在 CMD/PowerShell 中执行：
# echo %OS%     → "Windows_NT"
```

后续命令根据平台分支处理，Windows 中 `python3` 通常为 `python`，路径分隔符为 `\`。

### 1.2 检查 Python

**Linux / macOS：**

```bash
python3 --version    # 需要 3.12+
python3 -m venv --help 2>/dev/null && echo "venv OK" || echo "venv 缺失"
```

**Windows（CMD）：**

```cmd
python --version
python -m venv --help
```

**处理方案：**

| 情况 | 处理 |
|------|------|
| 版本 < 3.12 | 停下来告知用户升级，不要继续 |
| `python3` / `python` 找不到 | 指引用户安装 Python，见下方安装说明 |
| `venv` 缺失（常见于 Ubuntu 最小安装） | `sudo apt install python3-venv` |
| macOS 系统自带 Python（`/usr/bin/python3`）版本过旧 | 建议 `brew install python3` |

**Python 安装指引（首次安装）：**

- **Ubuntu/Debian**：`sudo apt update && sudo apt install -y python3.12 python3.12-venv python3-pip`
- **macOS**：`brew install python@3.12`（需先安装 [Homebrew](https://brew.sh)）
- **Windows**：从 [python.org](https://www.python.org/downloads/windows/) 下载安装包，安装时务必勾选「**Add Python to PATH**」

### 1.3 检查 Node.js / npm（opencode 依赖）

opencode 通过 npm 分发，必须先有 Node.js：

```bash
node --version    # 需要 18+（LTS 推荐）
npm --version
```

**Node.js 安装指引：**

- **Ubuntu/Debian**：
  ```bash
  curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
  sudo apt-get install -y nodejs
  ```
- **macOS**：`brew install node`
- **Windows**：从 [nodejs.org](https://nodejs.org/) 下载 LTS 安装包，勾选「Add to PATH」

### 1.4 检查 opencode

```bash
opencode --version    # 必须存在于 PATH，版本任意
```

**opencode 安装指引（需要 Node.js 18+）：**

```bash
npm install -g opencode-ai
```

安装后再次运行 `opencode --version` 验证。

**Windows 特别说明：**
- 若 `opencode` 找不到但 npm install 成功，关闭并重新打开 CMD/PowerShell 使 PATH 生效
- 或手动确认 `%APPDATA%\npm` 在 PATH 中

**如果以上任一工具缺失，停下来引导用户安装，不要跳过进入下一步。**

---

## 二、克隆项目 & 安装依赖

### 2.1 克隆

```bash
git clone <repo_url>
cd feishu-cli-bridge
```

若用户已有代码目录，直接 `cd` 进入即可。

### 2.2 创建虚拟环境并安装依赖

**Linux / macOS（推荐方式）：**

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

> macOS Python 3.12+ 禁止向全局环境安装包（PEP 668），**必须使用虚拟环境**，否则 `pip install` 会报错。

**Windows（CMD）：**

```cmd
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

激活后命令行前缀出现 `(.venv)` 表示虚拟环境已生效。

**使用 uv 加速（可选，Linux/macOS）：**

```bash
pip install uv
uv pip install -r requirements.txt
```

### 2.3 验证依赖

```bash
python3 -c "import lark_oapi, aiohttp, yaml, httpx; print('依赖 OK')"
# Windows: python -c "..."
```

若提示 `ModuleNotFoundError`，说明虚拟环境未激活或 `pip install` 失败，重新执行 2.2。

---

## 三、创建飞书自建应用

> 此步骤需要用户在浏览器中操作，AI 助手应逐步引导。

### 3.1 创建应用

1. 打开 [飞书开发者控制台](https://open.feishu.cn/app)
2. 点击「创建企业自建应用」
3. 填写应用名称（如 `AI Bridge`）和描述，点击创建

### 3.2 开启权限

**方式 A：批量导入（推荐）**

在应用「权限管理」页面找到「导入权限」功能，将 `doc/BOTAUTH.md` 的 JSON 内容粘贴导入，一次性开启所有权限。

**方式 B：手动逐一开启**

进入应用 → **权限管理** → 搜索并开启以下权限（全部选「申请」）：

| 权限 scope | 说明 |
|-----------|------|
| `im:message` | 读取消息 |
| `im:message:send_as_bot` | 以机器人身份发消息 |
| `im:message.reactions:read` | 读取 Emoji Reaction（✏️ 打字提示） |
| `im:message.reactions:write_only` | 添加/删除 Emoji Reaction |
| `im:resource` | 下载消息中的图片/文件 |
| `contact:user.id:readonly` | 读取用户 ID |
| `cardkit:card:read` | CardKit 流式卡片（不开则自动降级为 IM Patch 模式） |
| `cardkit:card:write` | CardKit 流式卡片（不开则自动降级为 IM Patch 模式） |

> `im:messageReaction:readonly` / `im:messageReaction:write` 是旧版名称，飞书控制台无法搜索到，请使用上表中的新名称。

### 3.3 配置事件订阅

进入应用 → **事件与回调** → **事件配置**：

1. 连接方式选「**使用长连接接收事件**」（无需公网 IP，无需填写回调 URL）
2. 点击「添加事件」→ 搜索 `im.message.receive_v1` → 订阅

> **重要**：不要在「卡片回调」中填写任何地址。本项目通过同一条 WebSocket 长连接接收卡片按钮回调（`im.card.action.trigger_v1`），无需配置 HTTP 回调 URL。填写了反而会造成问题。

### 3.4 获取凭据并发布应用

1. 进入「凭证与基础信息」，记录 **App ID**（格式 `cli_xxx`）和 **App Secret**
2. 进入「版本管理与发布」→ 创建版本（填写版本号如 `1.0.0`）→ 申请发布
3. 企业内部应用无需审核，发布后立即生效

> 每次在控制台变更权限或事件订阅后，都需要**重新创建版本并发布**，否则变更不生效。

---

## 四、配置项目

### 配置文件查找顺序（优先级由高到低）

程序启动时按以下顺序自动查找配置文件：

1. `CONFIG_FILE` 环境变量指定的路径
2. Linux/macOS：`~/.config/cli-feishu-bridge/config.yaml`
3. Windows：`%APPDATA%\cli-feishu-bridge\config.yaml`
4. 当前工作目录：`./config.yaml`（开发模式）

### 方式 A：config.yaml（推荐）

```bash
cp config.example.yaml config.yaml
# 用文本编辑器打开，至少填写 app_id 和 app_secret
```

**最小配置（必填）：**

```yaml
feishu:
  app_id: "cli_xxxxxxxxxxxxxxxx"   # 替换为真实 App ID
  app_secret: "xxxxxxxxxxxxxx"     # 替换为真实 App Secret
```

**完整可选配置（按需修改）：**

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
    command: "opencode"                   # 可执行文件名或绝对路径
    default_model: "kimi-for-coding/k2p5" # 格式: provider/model
    default_agent: "build"                # build / plan
    timeout: 300
    models:               # /model 命令展示的模型列表
      - id: "kimi-for-coding/k2p5"
        name: "Kimi K2.5"
      - id: "opencode/mimo-v2-pro-free"
        name: "MiMo V2 Pro Free"
  codex:
    enabled: false        # 默认关闭

project:
  storage_path: ""        # 留空 = 平台默认路径
  max_projects: 50

debug:
  log_level: "INFO"       # DEBUG / INFO / WARNING / ERROR
```

### 方式 B：纯环境变量（无 config.yaml）

**Linux / macOS：**

```bash
export FEISHU_APP_ID="cli_xxx"
export FEISHU_APP_SECRET="xxx"
export OPENCODE_MODEL="kimi-for-coding/k2p5"   # 可选
export LOG_LEVEL="INFO"                         # 可选
```

**Windows CMD（当前会话）：**

```cmd
set FEISHU_APP_ID=cli_xxx
set FEISHU_APP_SECRET=xxx
```

**Windows PowerShell（永久写入用户环境变量）：**

```powershell
[System.Environment]::SetEnvironmentVariable("FEISHU_APP_ID", "cli_xxx", "User")
[System.Environment]::SetEnvironmentVariable("FEISHU_APP_SECRET", "xxx", "User")
```

---

## 五、启动服务

### 5.1 开发模式启动

**Linux / macOS：**

```bash
# 方式一：start.sh（自动激活 .venv，推荐）
./start.sh

# 方式二：直接用 Python（需先激活虚拟环境）
source .venv/bin/activate
python3 -m src.main

# 强制降级为 IM Patch 模式（CardKit 不可用时）
./start.sh --legacy
# 或
DISABLE_CARDKIT=1 python3 -m src.main
```

**Windows（CMD，自动激活 .venv）：**

```cmd
start.bat
start.bat --legacy   REM 强制 IM Patch 模式
```

**Windows（直接 Python）：**

```cmd
python -m src.main
```

### 5.2 正常启动日志

启动成功后日志应包含以下关键行：

```
INFO  - ==================================================
INFO  - Feishu CLI Bridge 启动中...
INFO  - 配置目录: /path/to/config
INFO  - ✅ CLI 工具可用: opencode (opencode)
INFO  - 🚀 正在连接飞书...
```

收到第一条消息时，OpenCode 服务器会自动启动：

```
INFO  - opencode serve 已启动（port 4096）
```

**如果出现以下错误，对应处理：**

| 错误信息 | 原因 | 处理 |
|---------|------|------|
| `❌ 飞书配置不完整` | app_id / app_secret 未填或为空 | 检查 config.yaml 或环境变量 |
| `❌ 没有可用的 CLI 工具` | opencode 不在 PATH | 安装 opencode 并确认 PATH |
| `⚠️ CLI 工具未安装: opencode` | 同上 | 同上 |
| `WebSocket 连接失败` / `认证失败` | 凭据错误或应用未发布 | 检查 App ID/Secret，确认已发布 |
| `找不到 opencode 可执行文件` | opencode 未安装或不在 PATH | `npm install -g opencode-ai` |
| `opencode serve 进程意外退出` | opencode 版本兼容性或配置问题 | 手动运行 `opencode serve --port 4096` 查看详细错误 |
| `opencode serve 启动超时（10s）` | 启动过慢（Windows 冷启动） | 重试，或手动预先启动 `opencode serve --port 4096` |

---

## 六、功能验证

在飞书中打开与机器人的**私聊**（不支持群聊），逐项验证：

| 测试内容 | 期望结果 | 不正常时检查 |
|---------|---------|------------|
| `你好` | 出现 ✏️ 反应，随后流式卡片输出 | 检查事件订阅和应用发布 |
| `/help` | 帮助卡片，列出可用命令 | 检查机器人私聊权限 |
| `/model` | 模型列表卡片，可点击切换 | 检查 config.yaml 的 models 列表 |
| `/new` | 新建会话成功卡片 | — |
| `/pa ~/code myproject` | 添加项目成功卡片 | 检查目录是否存在 |
| `/pl` | 项目列表卡片，带「切换」按钮 | — |

---

## 七、常见问题排查

### 机器人无响应

```bash
# 查看完整日志
python3 -m src.main 2>&1

# 运行诊断脚本
python3 scripts/diagnose_feishu.py
```

可能原因（按出现频率排序）：

1. **应用未发布** → 飞书控制台创建版本并发布
2. **App ID / App Secret 错误** → 对照控制台「凭证与基础信息」重新填写
3. **事件未订阅** → 确认已订阅 `im.message.receive_v1`，连接方式为「长连接」
4. **发消息方式错误** → 必须与机器人**私聊**，不支持群聊（默认）
5. **权限未开启** → 权限变更后必须重新发布版本

### opencode serve 启动失败

```bash
# 手动启动，查看详细输出
opencode serve --port 4096

# 检查端口是否被占用
lsof -i :4096         # Linux / macOS
netstat -ano | findstr :4096   # Windows CMD
```

**端口被占用时**，在 `config.yaml` 中修改：

```yaml
cli:
  opencode:
    server_port: 4097        # 改为未占用的端口
    server_hostname: "127.0.0.1"
```

**opencode serve 报错无法识别 `serve` 命令**，说明 opencode 版本过旧：

```bash
npm install -g opencode-ai@latest
```

### CardKit 不刷新 / 卡片内容不更新

CardKit 是飞书高级功能，部分企业版本不可用。降级为 IM Patch 模式（1500ms 节流）：

```bash
DISABLE_CARDKIT=1 python3 -m src.main
# 或
./start.sh --legacy
```

### Python 虚拟环境问题

**macOS：pip install 报 "externally-managed-environment"**

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

**Windows：.venv\Scripts\activate 报"无法加载…脚本执行已被禁用"**

以管理员身份运行 PowerShell，临时允许脚本执行：

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

**虚拟环境内 python 版本不对**

```bash
python3 -m venv --clear .venv    # 重建
source .venv/bin/activate
python3 --version                # 确认版本
```

### opencode 不在 PATH（Windows）

opencode 通过 npm 全局安装后，可执行文件在 `%APPDATA%\npm\opencode.cmd`。若找不到：

1. 确认 `%APPDATA%\npm` 在 PATH 中（系统属性 → 高级 → 环境变量）
2. 重新打开 CMD/PowerShell
3. 或在 `config.yaml` 中使用绝对路径：
   ```yaml
   cli:
     opencode:
       command: "C:\\Users\\你的用户名\\AppData\\Roaming\\npm\\opencode.cmd"
   ```

### 日志位置

| 模式 | 日志位置 |
|------|---------|
| 开发模式（`./config.yaml`） | `./logs/YYYYMMDD.log` |
| 服务模式（`~/.config/cli-feishu-bridge/`） | `~/.config/cli-feishu-bridge/logs/YYYYMMDD.log` |
| 自定义 | `config.yaml` 中 `debug.log_dir` |
| systemd | `journalctl --user -u cli-feishu-bridge -f` |

---

## 八、后台运行（可选）

### Linux — systemd 用户服务（推荐）

```bash
bash scripts/install_service.sh    # 安装服务（自动复制配置模板）

# 安装后编辑配置文件（若尚未配置）
$EDITOR ~/.config/cli-feishu-bridge/config.yaml

# 启动并设为开机自启
systemctl --user enable --now cli-feishu-bridge

# 常用管理命令
systemctl --user status  cli-feishu-bridge    # 查看状态
systemctl --user restart cli-feishu-bridge    # 重启
systemctl --user stop    cli-feishu-bridge    # 停止
systemctl --user disable cli-feishu-bridge    # 取消自启

# 实时日志
journalctl --user -u cli-feishu-bridge -f

# 卸载
bash scripts/uninstall_service.sh
```

> **SSH 远程机器**：若需开机自启且不依赖登录，运行 `loginctl enable-linger $USER`。

### Linux — nohup（简单方式）

```bash
nohup python3 -m src.main > bridge.log 2>&1 &
echo $! > bridge.pid

# 停止
kill $(cat bridge.pid)
```

### macOS — nohup

```bash
nohup ./start.sh > bridge.log 2>&1 &
```

> macOS 暂不支持 launchd 自动配置，推荐结合 `tmux` / `screen` 使用。

### Windows — 任务计划程序（开机自启）

```cmd
schtasks /create /tn "FeiShuBridge" /tr "python -m src.main" /sc onlogon /ru %USERNAME% /sd C:\path\to\feishu-cli-bridge /f

REM 停止
schtasks /end /tn "FeiShuBridge"

REM 卸载
schtasks /delete /tn "FeiShuBridge" /f
```

### Windows — PowerShell 隐藏窗口（临时）

```powershell
Start-Process python -ArgumentList "-m src.main" -WorkingDirectory $PWD -WindowStyle Hidden
```

---

## 九、快速参考

| 操作 | 命令 |
|------|------|
| 启动（开发） | `./start.sh` 或 `python3 -m src.main` |
| 启动（降级） | `./start.sh --legacy` |
| 停止 systemd | `systemctl --user stop cli-feishu-bridge` |
| 查看日志 | `journalctl --user -u cli-feishu-bridge -f` |
| 飞书帮助 | 私聊发送 `/help` |
| 切换模型 | 私聊发送 `/model` |
| 切换项目 | 私聊发送 `/pl` |
| 新建会话 | 私聊发送 `/new` |
| Lint 检查 | `ruff check src/` |
| 类型检查 | `mypy src/` |
| 诊断工具 | `python3 scripts/diagnose_feishu.py` |

---

*最后更新: 2026-03-24（v0.1.8）*
