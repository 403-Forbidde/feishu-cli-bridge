# 更新日志

## [v0.1.9] - 2026-03-24  【TUI 命令优化】

**开发人**: ERROR403

### 新增功能

- **新增 `/help` 命令** — 显示 OpenCode TUI 命令帮助卡片（Schema 2.0 格式），展示所有支持的命令说明

### 改进

- **`/reset` 命令卡片化** — 重置成功提示从纯文本改为 Schema 2.0 卡片，界面更统一美观
- **简化帮助内容** — `/session` 命令说明精简，移除子命令详情（操作在卡片内完成）

### 技术细节

- 新增 `build_help_card()` 和 `build_reset_success_card()` 卡片构建函数
- OpenCode TUI 命令支持列表新增 `"help"`

---

## [v0.1.8] - 2026-03-24  【Bugfix 版本】

**开发人**: ERROR403

### 修复摘要

本版本聚焦修复三个长期悬而未决的技术难题：上下文百分比计算、会话改名交互、以及 asyncio 事件循环绑定问题。

---

### 🔴 Issue #40: 上下文百分比计算不准确（Bridge 与 OpenCode CLI 显示不一致）

**问题现象**:
- Bridge 显示的上下文占用百分比与 OpenCode CLI 不一致
- 第二轮对话时百分比翻倍（如从 28.6% 变成 57.2%）

**问题根因**（三层问题叠加）:

1. **API 响应解析错误**: `_fetch_context_window_from_api` 假设响应是列表 `[]`，实际 API 返回 `{"all": [...]}` 字典格式
2. **Token 累加逻辑错误**: SSE `step-finish` 事件返回的是会话累计 token 总数，但代码将其当作增量累加
3. **API 端点错误**: `GET /session/:id` 不包含 token 统计，应使用 `GET /session/:id/message` 累加 assistant 消息

**修复方案**:
1. 修复 API 响应解析，支持 `{"all": [...]}` 和 `[]` 两种格式
2. SSE 路径直接替换 `_current_stats`，不再累加
3. 改用 `/session/:id/message` API，遍历累加所有 assistant 消息的 `tokens` 字段
4. 添加详细的调试日志便于诊断

**相关代码**: `src/adapters/opencode.py:1129-1241` (`_fetch_stats_from_api`)

---

### 🔴 Issue #32/#33: 会话改名交互失败、交互式回复卡片空白

**问题现象**:
- `/session` 命令点击「改名」按钮后，回复「请输入新名称...」但没有后续交互
- 会话列表卡片显示空白，按钮不响应
- 交互式回复机制 (`interactive.py`) 注册的消息匹配失败

**问题根因**:

1. **卡片 Schema 错误**: `multi_action` 区域缺少 `tag: "action"` 包裹，导致按钮渲染失败
2. **交互式回复 ID 匹配失败**: `interactive.py` 使用 `parent_id` 匹配，但飞书某些场景下 `parent_id` 为空
3. **状态检查缺失**: `start_interactive_flow` 未检查 `is_interactive` 标志，非交互式场景错误触发

**修复方案**:
1. 修复 `build_session_list_card` 的 Schema，在 `multi_action` 外添加 `{"tag": "action", "actions": [...]}` 包裹
2. `interactive.py` 增强匹配逻辑：优先匹配 `parent_id`，回退到「纯数字」或「provider/model 格式」内容启发式匹配
3. `start_interactive_flow` 添加 `is_interactive` 参数检查

**相关代码**:
- `src/feishu/card_builder.py:1075-1095` (session 卡片 Schema)
- `src/tui_commands/interactive.py:78-120` (ID 匹配逻辑)
- `src/tui_commands/opencode.py:245-280` (改名流程)

---

### 🔴 Issue #45: `asyncio.Lock` 事件循环绑定错误

**问题现象**:
- 执行 `/mode` 命令（调用 `list_agents`）时日志报错：`<asyncio.locks.Event> is bound to a different event loop`
- 功能正常（模式切换卡片正常显示），但日志持续报错
- 4 次修复尝试均失败（懒初始化、异常重试、移除嵌套锁、重置 client）

**问题根因**（长期误解）:

**真正的问题不在 `OpenCodeAdapter`，而在 `FeishuClient._dispatch_to_handler`**。

```
事件循环调用链:
main.py asyncio.run(main())          ← 主事件循环 A (Adapter 在此创建)
    ↓
FeishuClient.start_sync()
    ↓
创建 WebSocket 后台线程              ← 事件循环 B
    ↓
lark-oapi SDK 内部线程池处理消息
    ↓
_on_message_received() 被调用        ← SDK 内部线程 (无事件循环)
    ↓
_dispatch_to_handler()
    ↓
检测到无运行中事件循环
    ↓
创建新线程 _sync_dispatch()          ← 事件循环 C (消息处理实际在此执行!)
    ↓
调用 list_agents() → _ensure_server()
    ↓
尝试获取 _server_lock                ← 锁绑定到事件循环 A，但当前是 C!
```

**修复方案**:
- 修改 `FeishuClient._dispatch_to_handler`，使用 `self._loop`（主事件循环）通过 `asyncio.run_coroutine_threadsafe()` 线程安全地调度消息处理
- 确保所有消息处理都在创建 Adapter 的同一事件循环中执行
- 兜底方案保留，但增加警告日志

**相关代码**: `src/feishu/client.py:275-320` (`_dispatch_to_handler`)

---

### 技术债务

- 移除 `opencode.py` 中 `_ensure_server` 和 `_get_or_create_session` 中的锁重试逻辑（Issue #45 修复后不再需要）
- 简化事件循环绑定错误处理代码

---

## [v0.1.7] - 2026-03-23  【里程碑版本】

**开发人**: ERROR403

### 重大架构变更：Session 管理完全重构

本版本是 Feishu CLI Bridge 的**里程碑版本**，彻底重构了 Session 管理机制，从"本地文件存储 + 多进程"架构升级为"OpenCode HTTP Server 集中管理"架构。

#### 旧架构（v0.1.6 及之前）

```
每个 working_dir 一个 opencode 子进程
        ↓
本地 JSON 文件存储 session 映射 (.sessions/*.json)
        ↓
SessionManager 维护 LRU 缓存和持久化
        ↓
问题：进程多开、状态同步复杂、配置分散
```

**存在的问题**:
- **多进程资源浪费**: 每个工作目录独立启动 `opencode serve` 进程，端口占用混乱
- **状态同步困难**: 本地 JSON 与 OpenCode 实际状态可能不一致（Bridge 重启后 session ID 失效但本地仍保留）
- **配置分散**: 会话配置分布在本地 JSON 和 OpenCode 两端，难以维护
- **并发隐患**: 多进程同时操作导致文件锁竞争

#### 新架构（v0.1.7 起）

```
单一 OpenCode Server 实例（端口 4096）
        ↓
HTTP API 集中管理所有会话（GET/POST/PATCH/DELETE /session）
        ↓
工作目录隔离通过 directory 参数实现（而非多进程）
        ↓
本地仅维护内存中的 session_id → working_dir 映射（无持久化）
```

**核心改进**:
- **单 Server 架构**: 整个 Bridge 只启动一个 `opencode serve` 进程，通过 `directory` 查询参数区分不同项目的上下文
- **服务端权威**: OpenCode 服务器是会话的唯一数据源，Bridge 本地不做任何持久化存储
- **启动恢复**: Bridge 重启后，通过 `GET /session` 从服务器恢复当前目录的活跃会话
- **生命周期托管**: Session 创建、切换、重置、删除全部通过 REST API 完成

#### 技术实现细节

**`OpenCodeServerManager` 单例管理** (`src/adapters/opencode.py`):
```python
# 单一服务器实例
self._server_manager: Optional[OpenCodeServerManager] = None

# 每个工作目录对应一个 OpenCode session（key = working_dir）
self._sessions: Dict[str, OpenCodeSession] = {}
```

**关键 API 调用**:
- `POST /session?directory={working_dir}` — 创建新会话，自动绑定工作目录
- `GET /session` — 获取所有会话，用于列表展示和重启恢复
- `GET /session/{id}` — 获取会话详情，用于切换会话时验证
- `PATCH /session/{id}` — 重命名会话
- `DELETE /session/{id}` — 删除会话

**流式通信机制**:
- 发送消息: `POST /session/{id}/prompt_async` (返回 204 立即响应)
- 接收回复: `GET /event` SSE 流，解析 `message.part.delta` / `session.idle` 事件
- 局部状态 `StreamState` 确保多轮对话并发安全

#### 废弃项

- ❌ `SessionConfig.storage_dir` 配置项已完全移除（原用于指定本地 session JSON 存储路径）
- ❌ `src/session/manager.py` 已清空为桩文件（保留避免破坏 git 记录）
- ❌ 本地 `.sessions/` 目录不再创建或使用

#### 迁移说明

升级至 v0.1.7 后：
1. 原有的本地 session 映射文件将被忽略（可手动删除 `.sessions/` 目录）
2. OpenCode 服务器中的会话仍然保留，不受影响
3. 首次启动时会自动从服务器恢复当前目录的会话关联

### 新增

- **会话管理卡片化** (`src/tui_commands/opencode.py`, `src/feishu/card_builder.py`)
  - `/session` 命令返回 Schema 2.0 交互式卡片，替代纯文本列表
  - 每行会话显示：ID 前缀（FSB-xxx）、标题、最后活跃时间
  - 当前活跃会话高亮显示（🟢 绿色标识）
  - 支持点击卡片按钮直接切换会话，无需再输入 `/session <序号>`
  - 新增功能：改名按钮触发交互式改名流程，删除按钮触发二次确认

- **项目管理卡片 Schema 2.0 全面升级** (`src/feishu/card_builder.py`, `src/tui_commands/project.py`)
  - 项目列表卡片从 Schema 1.0 迁移至 Schema 2.0，与 `/mode`、`/model` 等卡片风格统一
  - 采用 `column_set` 原生两列布局：左侧图标/标签自动收窄，右侧内容自适应展开
  - 状态图标升级：当前项目 🟢、普通项目 🟡、目录丢失 🔴，视觉层次更清晰
  - 每个项目展示：项目名称、标识、路径、最后活跃时间，布局紧凑信息完整
  - 操作按钮优化：当前项目显示「✓ 正在使用」状态标识，其他项目显示「▶ 切换」按钮
  - 删除确认卡片升级：二次确认状态使用 Schema 2.0 渲染，确认/取消按钮布局更合理

- **项目信息卡片 (`/pi`) 卡片化** (`src/tui_commands/project.py`, `src/feishu/card_builder.py`)
  - 原：返回纯文本 `TUIResult.text()`，信息密集难以阅读
  - 现：返回 Schema 2.0 卡片，字段分栏展示：📋 项目信息、📂 工作目录、🆔 标识、🕐 最后活跃、🔗 关联会话数
  - 项目描述支持：有描述时显示备注卡片，无描述时自动隐藏

- **新增项目卡片 (`/pa`, `/pc`) 卡片化** (`src/tui_commands/project.py`)
  - 原：返回纯文本确认消息
  - 现：操作成功后返回完整的项目列表卡片（`TUIResult.card()`），新添加的项目已激活，效果与 `/pl` 完全一致
  - 用户无需再次执行 `/pl` 即可查看完整项目状态

### 修复

- **会话改名交互失败** (`src/feishu/handler.py`, `src/tui_commands/__init__.py`) — Issue #32
  - 问题：用户点击「改名」按钮后回复新名称时，系统错误地将内容当作普通消息处理给 AI，而非执行重命名
  - 根本原因：当用户直接发送消息（而非点击「回复」按钮）时，`parent_id` 为空，系统使用内容启发式匹配（纯数字 1-10 或 `provider/model` 格式）判断是否为交互式回复，但用户输入的新名称不符合这些格式
  - 修复：新增 `get_interactive_target()` 方法，对 `rename_session` 交互类型特殊处理——接受任何非命令内容作为有效回复，不再受限于特定格式

- **交互式回复卡片空白** (`src/feishu/handler.py`)
  - 问题：`_handle_interactive_reply` 在处理卡片类型结果时，使用 `build_card_content()` 对卡片进行重复包装，导致卡片结构损坏，飞书显示为空白消息
  - 修复：检测 `result.metadata["card_json"]`，若存在则直接使用原始卡片数据发送，避免二次包装

### 改进

- **卡片 Header 风格统一** (`src/feishu/card_builder.py`)
  - 所有项目相关卡片使用蓝色 (`blue`) header 模板
  - Header 图标统一为 💼，与项目功能语义匹配
  - Header 标题根据场景动态变化：「项目列表」、「项目详情」、「添加项目」等

- **底部说明信息优化**
  - 命令说明使用全色对比度展示，更易识别
  - 删除行为注释使用灰色 notation 字号，与主内容区分
  - 明确说明删除仅移除列表记录，不删除磁盘目录

### 技术细节

- `OpenCodeAdapter` 完全重写：
  - 新增 `OpenCodeServerManager` 类管理单一 Server 进程生命周期
  - `_ensure_server()` 确保 Server 健康，自动注入 `OPENCODE_PERMISSION` 环境变量
  - `_get_or_create_session()` 支持从服务器恢复会话（按 directory 字段匹配）
  - `_send_message()` 通过 `prompt_async` 端点发送，支持附件 base64 编码
  - `_listen_events()` SSE 流监听，使用局部 `StreamState` 避免并发冲突

- `build_session_list_card()` 新增：会话列表 Schema 2.0 卡片构建
- `build_project_list_card()` 完全重写，从 Schema 1.0 `config` 格式改为 Schema 2.0 `body.elements` 格式
- `build_project_info_card()` 新增，支持单项目详情展示
- `TUIResult.card()` 新增 `card_type` metadata 字段，支持 `"project_list"`、`"project_info"`、`"session_list"` 等类型标识

---

## [v0.1.6] - 2026-03-22

**开发人**: ERROR403

### 修复

- **`parse_chunk` 签名破坏基类接口** (`src/adapters/opencode.py`)
  - OpenCode 内部实现 `parse_chunk(raw_line, state)` 与基类抽象方法 `parse_chunk(raw_line)` 签名不符，违反 Liskov 替换原则
  - 修复：将内部实现重命名为 `_parse_event(raw_line, state)`，保留公开的 `parse_chunk(raw_line)` stub 满足基类接口；`_listen_events` 调用改为 `_parse_event`

- **`asyncio.get_event_loop()` 弃用用法** (`src/adapters/opencode.py`, `src/feishu/flush_controller.py`) — Issue #23
  - `opencode.py` 两处 `asyncio.get_event_loop().time()` → `time.monotonic()`
  - `flush_controller.py` 四处 `asyncio.get_event_loop()` → `asyncio.get_running_loop()`（均在 async 上下文，需要 loop 对象调用 `call_later` / `create_future`）

- **`_send_message` fire-and-forget 丢失错误** (`src/adapters/opencode.py`)
  - 原：`asyncio.create_task(self._send_message(...))` + `await asyncio.sleep(0.5)` 发送失败时异常静默丢弃，且 0.5s hardcoded sleep 在高负载时不可靠
  - 修复：改为 `sent = await self._send_message(...)`，发送失败时立即 yield ERROR chunk 并返回；`prompt_async` 端点返回 204 即代表接受，实际执行异步进行，await 后直接监听 SSE 不会丢失事件

- **`_sessions` 字典无并发锁** (`src/adapters/opencode.py`) — Issue #22
  - `_get_or_create_session` 无锁，并发请求同一 `working_dir` 时可能重复调用 `_create_session`，产生 session 泄漏
  - 修复：添加 `_sessions_lock`（懒初始化 `asyncio.Lock`），用 `async with self._sessions_lock` 包裹读-创建-写原子操作

---

## [v0.1.5] - 2026-03-22

**开发人**: ERROR403

### 修复

- **OpenCode 外部目录权限对话框导致工具调用永久阻塞** (`src/adapters/opencode.py`) — Issue #27
  - 根本原因：Bridge 无头运行，OpenCode 访问 session 工作目录以外路径时弹出 TUI 权限对话框，无法响应，工具调用永久停留在 `status: running`，飞书卡片永久卡在"思考中..."
  - 修复：`OpenCodeServerManager.start()` 启动子进程时注入 `OPENCODE_PERMISSION={"external_directory":"allow"}` 环境变量，进程启动即预授权所有外部目录访问
  - 保留 `_ensure_opencode_permissions()` 写入全局配置文件 `~/.config/opencode/opencode.json` 作为额外保障（原子写入，幂等）

- **工具调用后无文字回复（流提前终止）第五次修复** (`src/adapters/opencode.py`) — Issue #28
  - 根本原因（第四次修复后残留）：`_seen_assistant_message`、`_user_text_skipped`、`_emitted_text_length`、`_current_prompt_hash` 为实例变量，多轮并发对话时后一轮 `execute_stream` 重置同一组变量，覆盖前一轮状态，导致 `session.idle` 时状态错误、流挂起或空内容结束
  - 修复：引入 `StreamState` dataclass 将四个状态变量封装为局部对象，`execute_stream` 每轮创建独立实例并通过参数传递给 `parse_chunk` 和 `_listen_events`，多轮对话完全隔离互不干扰

### 技术细节

- `OPENCODE_PERMISSION` 环境变量优先于配置文件，且在进程启动时即生效，不受项目级 `opencode.json` 覆盖影响
- `StreamState` 包含：`seen_assistant_message`、`user_text_skipped`、`emitted_text_length`、`prompt_hash`、`current_stats` 共五个字段
- `parse_chunk(raw_line, state)` 签名新增 `state` 参数（仅 OpenCodeAdapter 内部使用，不影响其他适配器）
- Token 统计 `current_stats` 在 `execute_stream` 结束时从局部 state 回写到 `self._current_stats`，供 `get_stats()` 使用

---

## [v0.1.4] - 2026-03-21

**开发人**: ERROR403

### 新增

- **Windows 完整支持**
  - `start.bat` — Windows 启动脚本，与 `start.sh` 功能对等（`--legacy` / `--help` 参数、自动激活 `.venv\Scripts\activate.bat`、自动设置 `CONFIG_FILE`）

### 修复（跨平台兼容）

- **`src/feishu/api.py`**：图片/文件临时目录从硬编码 `/tmp/feishu_images` 改为 `Path(tempfile.gettempdir()) / "feishu_images"`，Linux/macOS 行为不变（`gettempdir()` 返回 `/tmp`），Windows 自动使用 `%TEMP%`
- **`src/main.py`**：`signal.SIGTERM` 注册改为 `hasattr` 判断保护，避免 Windows 上 `AttributeError`（Linux/macOS 无影响）
- **`src/main.py`**：`asyncio.Event()` 从模块顶层移入 `main()` 函数内部，修复 Python ≤3.9 上 "Future attached to a different loop" 错误（Python 3.10+ 上此问题已不存在，但代码更规范）
- **`src/main.py`**：`WindowsProactorEventLoopPolicy` 仅在 Python < 3.12 时设置；Python 3.12+ Windows 已默认 ProactorEventLoop，设置反而触发废弃警告
- **`src/config.py`**：配置文件查找路径分平台：Windows 使用 `%APPDATA%\feishu-cli-bridge\config.yaml`，Linux/macOS 继续使用 XDG 路径 `~/.config/feishu-cli-bridge/config.yaml`

### 修复（Windows 实测）

- **`src/adapters/opencode.py`**：去除 `opencode serve` 命令中的 `--hostname` 参数（v1.2.27 不支持此 flag，进程立即退出导致 "Failed to start OpenCode Server"）
- **`src/adapters/opencode.py`**：用 `shutil.which("opencode")` 解析完整可执行路径后再传给 `asyncio.create_subprocess_exec`，修复 Windows 子进程不走 shell PATH 查找导致的 `[WinError 2] 系统找不到指定的文件`
- **`src/adapters/opencode.py`**：启动超时从 3 秒延长到 10 秒，Windows 进程冷启动更慢；进程意外退出时读取 stderr 并记录日志，便于诊断
- **`src/adapters/opencode.py`**：health check 新增备用路径 `/health`、`/api/health`，兼容不同 opencode 版本
- **`start.bat`**：去除所有中文注释，修复 Windows CMD（GBK 编码）下因 UTF-8 中文字符报 "not recognized as an internal or external command" 错误

### 文档

- **README.md** 新增「Windows 运行说明」章节（前置要求、虚拟环境、配置、启动、后台运行、常见问题、与 Linux/macOS 差异表）
- **doc/AIGUIDE.md** 各步骤补充 Windows 命令差异（依赖安装、环境变量设置、启动脚本、端口排查、后台运行）
- **AGENTS.md** 更新临时路径描述、启动命令、配置路径、环境变量、平台兼容性表

---

## [v0.1.3] - 2026-03-21

**开发人**: ERROR403

### 新增

- **systemd 用户服务支持**（仅 Linux）
  - `scripts/install_service.sh` — 一键安装：自动推导代码目录、创建 `~/.config/feishu-cli-bridge/`、复制配置模板、写入 `~/.config/systemd/user/feishu-cli-bridge.service`、重载 daemon，并打印后续步骤
  - `scripts/uninstall_service.sh` — 停止、禁用、删除 service 文件、重载 daemon
  - 服务以 `WorkingDirectory=%h`（用户 home）运行，`PYTHONPATH` 指向代码目录
  - 支持 `loginctl enable-linger` 说明，适配无桌面会话环境

- **`DebugConfig.log_dir` 配置项**（`src/config.py`, `config.example.yaml`）
  - 新增 `debug.log_dir` 字段（留空 = 自动），环境变量 `LOG_DIR`
  - 留空时日志落在配置文件同级 `logs/` 目录，服务模式下自动归入 `~/.config/feishu-cli-bridge/logs/`

### 改进

- **配置文件自动发现**（`src/config.py`）
  - `load_config()` 新增 `_find_config_file()`，按优先级查找：`CONFIG_FILE` 环境变量 → `$XDG_CONFIG_HOME/feishu-cli-bridge/config.yaml` → `./config.yaml`
  - 新增 `get_config_dir() -> Path`，返回实际加载的配置文件目录，供路径解析使用

- **路径解析基于配置文件目录**（`src/main.py`）
  - `storage_dir`、`log_dir` 的相对路径均基于 `get_config_dir()` 解析为绝对路径
  - 服务模式（config 在 `~/.config/...`）与开发模式（config 在项目根）路径自动隔离，无需额外配置

- **`setup_logger()` 接受 `log_dir` 参数**（`src/utils/logger.py`）
  - 新增 `log_dir: Optional[Union[str, Path]] = None` 参数，替代原硬编码的 `Path("logs")`

- **`start.sh` 路径自适应**（`start.sh`）
  - 去掉硬编码的 `/code/feishu-cli-bridge`，改为 `cd "$(dirname "$0")"` 自适应脚本位置
  - 显式设置 `CONFIG_FILE=$(pwd)/config.yaml`，确保开发启动始终使用本地配置，与服务配置隔离

### 文档

- **README.md** 新增 `## macOS 运行说明` 章节（前置要求、启动、CLI 工具安装、与 Linux 差异对比表）
- **README.md** 补全环境变量表（新增 `CONFIG_FILE`、`LOG_DIR`、`DISABLE_CARDKIT`）
- **AGENTS.md** 新增配置文件查找顺序说明、平台兼容性对比表，补全环境变量和 `config.yaml` 示例
- **config.example.yaml** 更新文件头注释（查找顺序、服务/开发两种使用方式），新增 `debug.log_dir`、`session.storage_dir` 路径说明
- **doc/ISSUES.md** 新增 Issue #10：`/session` 命令在飞书客户端作用有限，待讨论是否去除，暂不修改

---

## [v0.1.2] - 2026-03-21

**开发人**: ERROR403

### 移除

- **Claude Code（claudecode）适配器全面下线**
  - 删除 `src/adapters/claudecode.py`
  - `src/adapters/__init__.py` 移除 `ClaudeCodeAdapter` 导入和注册
  - `src/config.py` 移除 `claudecode` 默认配置及 `CLAUDECODE_*` 环境变量
  - `src/feishu/handler.py` 移除 `@claude` / `使用claude` 路由规则、claudecode 回退逻辑
  - `src/feishu/card_builder.py` 移除 `cli_label` 中 `"claudecode": "Claude Code"` 映射
  - `config.yaml` / `config.example.yaml` 移除 `claudecode` 配置段
  - 所有错误提示、帮助文字、文档中的 Claude Code 相关内容全部清除
  - 当前支持工具：**OpenCode**（默认）、**Codex**（`@codex` 前缀指定）

---

## [v0.1.1] - 2026-03-21

**开发人**: ERROR403

### 修复

- **`/new` 卡片模型名称显示不完整** (`src/feishu/card_builder.py`)
  - 原：经 `_simplify_model_name()` 压缩，如 `anthropic/claude-sonnet-4-20250514` 只显示 `Claude-Sonnet`
  - 现：直接渲染完整模型 ID，保留 `provider/model` 全路径，便于确认当前使用的精确模型版本

---

## [v0.1.0] - 2026-03-21

**开发人**: ERROR403

### 新增

- **`/model` 命令卡片化** (`src/tui_commands/opencode.py`, `src/feishu/card_builder.py`, `src/feishu/handler.py`)
  - 原：返回纯文本交互消息，需要手动回复模型 ID 切换，体验差
  - 现：与 `/mode` 风格完全一致的卡片——当前模型绿色高亮，其余模型展示名称 + ID + 蓝色「▶ 切换至此」按钮
  - 点击按钮通过 `im.card.action.trigger_v1` 回调切换，卡片原地重绘，toast 提示结果
  - `handle_card_callback` 新增 `switch_model` action 分支
  - 卡片底部一行灰色提示，引导用户查阅 `config.example.yaml` 管理模型列表

- **模型列表改为配置驱动** (`src/config.py`, `src/feishu/handler.py`, `src/adapters/opencode.py`, `config.yaml`, `config.example.yaml`)
  - 原：`list_models()` 硬编码静态列表，尝试过读 `GET /provider` API、读 `auth.json`，均存在问题（模型过多达 262 个、涉及敏感 API Key）
  - 现：`config.yaml` 的 `cli.opencode.models` 中维护常用模型列表，`list_models()` 直接读配置，零 API 调用，零敏感文件访问
  - 支持 `{id, name}` dict 格式及纯字符串 `"provider/model"` 两种写法
  - `CLIConfig` 新增 `models: list` 字段，handler 透传给 adapter config dict

### 技术细节

- `build_model_select_card()` 新增于 `card_builder.py`，复用 `build_mode_select_card()` 的布局模式
- 卡片 header 使用 `turquoise` 模板与 `/mode` 的 `blue` 区分
- `_list_models()` 改为返回 `TUIResult.card`，不再使用 `TUIResult.interactive`

---

## [v0.0.9] - 2026-03-21

**开发人**: ERROR403

### 新增

- **`/mode` 命令：Agent 模式切换** (`src/tui_commands/opencode.py`, `src/adapters/opencode.py`, `src/feishu/card_builder.py`, `src/feishu/handler.py`)
  - `/mode` — 发送 Agent 模式选择卡片，展示当前激活模式（🟢 绿色高亮）及其余可切换模式（蓝色 `▶ 切换至此` 按钮）
  - `/mode <agent>` — 直接切换，返回与 `/mode` 样式统一的更新卡片
  - 点击卡片按钮通过 `im.card.action.trigger_v1` 回调切换，卡片原地重绘并弹 toast
  - `TUICommandRouter.SUPPORTED_COMMANDS` 注册 `"mode"`

- **oh-my-openagent 自动检测** (`src/adapters/opencode.py`)
  - 未安装时：仅显示 OpenCode 内置的 Build / Plan 两个模式
  - 已安装时：自动改为显示 oh-my-openagent 的 7 个 Agent（Sisyphus、Hephaestus、Prometheus、Oracle、Librarian、Explore、Multimodal Looker），通过特征集合 `{sisyphus, hephaestus, prometheus}` 检测
  - 所有 Agent 附中文展示名称和中文描述，`display_name` 字段由 adapter 注入，card builder 直接渲染

- **`switch_mode` 卡片回调** (`src/feishu/handler.py`)
  - `handle_card_callback` 新增 `switch_mode` action 分支
  - 按钮 value 携带 `agent_id` + `cli_type`，handler 通过 `self.adapters[cli_type]` 路由到对应 adapter

- **`prompt_async` 注入 agent 字段** (`src/adapters/opencode.py`)
  - 每次发消息时 body 携带 `"agent": self.default_agent`，确保 OpenCode 使用选定 agent 处理请求

### 技术细节

- `GET /agent` 动态枚举全部 agent，内部 agent（compaction / title / summary）通过黑名单过滤
- oh-my-openagent 检测依赖特征签名，未来新增 agent 无需修改检测逻辑
- `_switch_mode` 切换后调用 `list_agents()` 重建卡片，与按钮回调路径输出完全一致

---

## [v0.0.8] - 2026-03-21

**开发人**: ERROR403

### 新增

- **`/new` 命令卡片化** (`src/tui_commands/opencode.py`, `src/feishu/card_builder.py`)
  - 原：返回纯文本 `TUIResult.text()`，样式简陋
  - 现：返回 Schema 2.0 绿色 header 卡片，`column_set` 原生两列布局（左侧灰色标签 / 右侧内容）
  - 展示字段：📋 会话名称 + 短 ID（`FSB-` 格式）、💼 当前项目、📂 工作目录、🤖 模型
  - 项目、模型字段可选，无配置时自动隐藏对应行
  - 底部灰色注释说明 CLI 工具名称

- **`CommandContext` 注入项目信息** (`src/tui_commands/base.py`, `src/feishu/handler.py`)
  - `CommandContext` 新增 `project_name`、`project_display_name` 两个可选字段
  - `_handle_tui_command` 构建 context 时从 `project_manager.get_current_project()` 自动填入

### 改进

- **TUI CARD 结果处理统一** (`src/feishu/handler.py`)
  - `_handle_tui_command` 的 CARD 分支改为优先读取 `result.metadata["card_json"]`，与项目命令路径逻辑一致
  - 无预构建卡片时回退到 `build_card_content("complete", ...)` 原有逻辑

### 技术细节

- `build_new_session_card()` 采用 Schema 2.0（`body.elements`），区别于项目列表卡片的 Schema 1.0
- Schema 1.0 `lark_md` 不支持 markdown 表格语法；Schema 2.0 `column_set` 是正确的两列布局方案
- 左列 `width: auto` 自动收窄，右列 `weight: 4` 占剩余宽度，图标与文字对齐无错位

---

## [v0.0.7] - 2026-03-21

**开发人**: ERROR403

### 新增

- **项目列表卡片删除功能** (`src/feishu/card_builder.py`, `src/feishu/handler.py`)
  - 非激活项目新增「🗑️ 删除」按钮（`danger` 类型），与「🔄 切换」并排显示
  - 二次确认机制：首次点击更新卡片为确认状态（「⚠️ 确认删除」+「取消」），防止误操作
  - 当前激活项目**不显示删除按钮**，禁止直接删除正在使用的项目
  - 目录不存在的项目仅显示「🗑️ 删除」（无切换按钮）
  - `handle_card_callback` 新增四个 action 分支：`delete_project_confirm` / `delete_project_cancel` / `delete_project_confirmed`
  - 删除成功后卡片自动更新，Toast 提示 "✅ 已删除项目: {显示名}"

### 改进

- **激活/非激活项目视觉区分** (`src/feishu/card_builder.py`)
  - 当前激活项目：顶部绿色 `▶ 当前激活项目` 标识 + 🟢 状态图标
  - 非激活且目录存在：🟡 状态图标（原 🟢，避免与激活项目混淆）
  - 非激活且目录不存在：🔴 状态图标 + 红色 "⚠️ 目录不存在" 内联提示

- **`/pa`、`/pc` 命令响应改为卡片** (`src/tui_commands/project.py`)
  - 原：返回 `TUIResult.text()` 纯文本确认信息
  - 现：返回完整项目列表卡片（`TUIResult.card()`），新增项目已激活，卡片效果与 `/pl` 一致

- **卡片底部说明优化** (`src/feishu/card_builder.py`)
  - 拆分为三层：`📌 命令说明` 标题 → 命令格式（全色对比度）→ 删除行为注释（灰色）
  - 明确 `/pa <路径> <项目名称>` 格式，说明删除仅移除列表不删除磁盘目录

### 技术细节

- `build_project_list_card()` 新增 `confirming_project: Optional[str]` 参数，控制二次确认状态渲染
- 按钮 `value` 格式：`{"action": "delete_project_confirm|cancel|confirmed", "project_name": "<标识>"}`
- 确认状态卡片通过 IM Patch 更新，与切换项目逻辑复用同一更新路径

---

## [v0.0.6] - 2026-03-21

**开发人**: ERROR403

### 新增

- **项目列表交互式卡片** (`src/feishu/card_builder.py`) — Issue #9
  - `build_project_list_card(projects, current_project_name)` — Schema 1.0 格式带按钮卡片
  - 每个项目显示状态图标（🟢/🔴）、名称、标识、路径、最后活跃时间
  - 当前项目显示 ⭐ **当前** 标记和"✓ 正在使用此项目"提示
  - 非当前且目录存在的项目显示「🔄 切换到 xxx」按钮（`primary` 类型）
  - 目录不存在的项目显示 ⚠️ 红色提示
  - 卡片标题蓝色 header，底部提示快捷命令用法

- **卡片按钮点击回调** (`src/feishu/client.py`)
  - 注册 `register_p2_card_action_trigger` 监听按钮点击事件
  - `_on_card_action_trigger()` 通过 `asyncio.run_coroutine_threadsafe` 在主事件循环执行异步 handler（2.5s 超时）
  - `_patch_card()` 切换成功后用 IM Patch 更新卡片，刷新当前项目标记
  - `on_card_callback()` 方法供外部注册异步回调处理器
  - `start_sync()` 中保存主事件循环引用

- **卡片回调处理** (`src/feishu/handler.py`)
  - `handle_card_callback(event_data)` — 处理 `switch_project` action：调用 `ProjectManager.switch_project()` → 构建更新卡片 → 返回 Toast + update_card
  - 返回成功 Toast："✅ 已切换到: {display_name}"
  - 异常时返回错误 Toast

### 改进

- **`/pl` 命令返回交互式卡片** (`src/tui_commands/project.py`)
  - 原来：返回 `TUIResult.text()` 纯文本列表
  - 现在：返回 `TUIResult.card()` 含 `metadata["card_json"]`，触发实际卡片消息

- **`_handle_project_command()` 支持 CARD 类型** (`src/feishu/handler.py`)
  - 检测 `TUIResultType.CARD` 时调用 `send_card_message()` 发送真实卡片

- **`main.py` 注册卡片回调** (`src/main.py`)
  - `feishu_client.on_card_callback(handler.handle_card_callback)`

### 技术细节

- 按钮 `value` 格式：`{"action": "switch_project", "project_name": "<标识>"}`
- 飞书卡片回调必须在 3s 内同步返回，通过 `run_coroutine_threadsafe` + 2.5s 超时保证
- 卡片更新（刷新当前项目标记）通过 IM Patch 在 Toast 响应之后异步执行

---

## [v0.0.5] - 2026-03-21

**开发人**: ERROR403

### 新增

- **项目管理功能** (`src/project/`, `src/tui_commands/project.py`)
  - `ProjectManager`：增删改查、原子写入持久化（`~/.config/feishu-cli-bridge/projects.json`）、`asyncio.Lock` 并发保护
  - `Project` 数据模型：`name`（英文标识）、`display_name`（可中文）、`path`、`created_at`、`last_active`、`description`、`session_ids`
  - 支持 50 个项目，按最后活跃时间降序排列
  - 路径验证：目录存在性、重复检测、rwx 权限校验

- **项目命令集** (`src/tui_commands/project.py`)
  - `/pa <路径> [名称] [显示名]` — 添加已有目录为项目
  - `/pc <路径> [名称] [显示名]` — 创建新目录并添加为项目
  - `/pl` — 列出所有项目（带当前项目标记 ★）
  - `/ps <标识>` — 切换到指定项目
  - `/prm <标识>` — 从列表移除项目（不删除目录）
  - `/pi [标识]` — 查看项目信息（省略标识查看当前项目）
  - 智能参数解析：中文自动识别为显示名，支持引号路径

- **工作目录自动切换** (`src/feishu/handler.py`)
  - `_get_working_dir()` 优先读 `ProjectManager.get_current_project().path`
  - 普通对话和 TUI 命令均从当前激活项目取 `working_dir`
  - 切换项目后自动关联 session_id 到对应项目

- **ProjectManager 集成** (`src/main.py`)
  - 启动时初始化 `ProjectManager` 并注入 `MessageHandler`

### 修复

- **OpenCode 工具调用工作目录不隔离** (`src/adapters/opencode.py`) — Issue #8
  - 根本原因：OpenCode server 通过全局中间件读取每个 HTTP 请求的 `directory` **query 参数**，完全忽略进程级 `cwd` 和 `PWD` 环境变量
  - 修复：三处请求均加 `params={"directory": working_dir}`：
    - `POST /session?directory=X` — session 在目录 X 的实例中创建
    - `POST /session/{id}/prompt_async?directory=X` — 工具调用（bash/read_file 等）在目录 X 执行
    - `GET /event?directory=X` — SSE 只接收目录 X 实例的事件
  - 同步简化架构：移除无效的"排他单实例"多进程逻辑，改为单一 server + `_sessions: Dict[working_dir, OpenCodeSession]` 按目录缓存 session
  - 参考来源：OpenCode 官方 `server.ts` 源码 + `opencode-telegram-bridge` TypeScript 实现

### 技术细节

- `directory` query 参数来源：OpenCode `server.ts` 全局中间件 `c.req.query("directory") || c.req.header("x-opencode-directory") || process.cwd()`
- 项目配置文件：`~/.config/feishu-cli-bridge/projects.json`，原子写入（写 `.tmp` 再 rename）
- 每个工作目录在 OpenCode server 中对应独立的 Instance，session 归属于 Instance

---

## [v0.0.4] - 2026-03-21

**开发人**: ERROR403

### 新增

- **图片消息输入** (`src/feishu/handler.py`, `src/feishu/api.py`)
  - 处理 `msg_type == "image"` 的飞书消息，自动下载图片到 `/tmp/feishu_images/`
  - 处理 `msg_type == "file"` 的飞书消息，支持 PDF、代码文件等各类格式
  - 处理富文本（`post`）消息中嵌入的图片（`tag == "img"`）
  - MIME 类型自动推断（`mimetypes.guess_type` 根据文件名推断）
  - 24h 临时文件自动清理机制

- **飞书文件下载 API** (`src/feishu/api.py`)
  - `FeishuAPI.download_message_resource(message_id, file_key, resource_type, filename)` 方法
  - 使用 `lark_oapi.api.im.v1.GetMessageResourceRequest` 下载图片/文件
  - `_cleanup_old_files()` 辅助函数清理过期临时文件

- **适配器附件支持** (`src/adapters/base.py`, `src/adapters/opencode.py`)
  - `execute_stream()` 新增 `attachments: Optional[List[Dict]] = None` 参数
  - `OpenCodeAdapter._send_message()` 将附件转 base64 data URL，构建 `FilePart`
  - `claudecode.py`、`codex.py` stub 适配器同步更新签名

- **FeishuMessage 扩展** (`src/feishu/client.py`)
  - 新增 `attachments: Optional[List[Dict]] = None` 字段
  - 附件格式: `{path, mime_type, filename}`（下载完成后赋值）

### 修复

- **切换到 `prompt_async` 端点** (`src/adapters/opencode.py`)
  - 问题：`/session/{id}/message` 端点对 `FilePart` 视觉输入处理不当，模型收到文件路径文本而非图片数据
  - 修复：改用 `/session/{id}/prompt_async` 端点（204 立即返回，响应通过 SSE `/event` 推送）
  - 效果：与 ISSUES.md 技术调研测试路径一致，模型可正确识别图片内容

- **`GetMessageResourceResponse` 属性访问错误** (`src/feishu/api.py`)
  - 问题：错误使用 `response.data.file`，该响应类直接挂载 `.file` 和 `.file_name`
  - 修复：改为 `response.file`，并用 `file is None` 判断下载是否成功

- **文件名重复** (`src/feishu/api.py`)
  - 问题：`save_path = save_dir / f"{file_key}_{filename}"` 导致路径含重复 key
  - 修复：改为 `save_dir / filename`（filename 本身已含 file_key）

### 技术细节

- 图片 base64 转换：在客户端完成，生成 `data:{mime};base64,{b64}` data URL
- OpenCode FilePart 格式: `{"type": "file", "mime": "image/jpeg", "url": "data:...", "filename": "..."}`
- 架构影响：`prompt_async` 对文本消息同样适用，更符合 SSE 事件驱动设计

---

## [v0.0.3] - 2026-03-20

**开发人**: ERROR403

### 优化

- **卡片样式美化** (`src/feishu/card_builder.py`)
  - 参考 OpenClaw-Lark 插件的飞书消息卡片样式进行改进
  - 自动为分类标题添加 emoji 图标（如 📚 信息与搜索、🛠️ 技术开发等）
  - 支持 30+ 个常用分类关键词的自动 emoji 匹配
  - 思考面板样式优化：蓝色边框、更大圆角、更合适的间距
  - Footer 信息改为单行紧凑显示，更简洁美观
  - Token 统计使用更简洁的格式：`📊 1.2K (5%)` 替代长格式
  - 模型名称简化显示（如 `Claude-Sonnet` 替代完整路径）

### 新增

- **Emoji 分类系统** (`src/feishu/card_builder.py`)
  - `CATEGORY_EMOJI_MAP` - 分类关键词到 emoji 的映射表
  - `_add_category_emojis()` - 自动检测并添加 emoji 图标
  - `_beautify_list_items()` - 列表项美化（预留扩展）
  - `_append_token_stats_compact()` - 紧凑格式 Token 统计

### 设计参考

- 样式参考: `/home/error403/.openclaw/extensions/openclaw-lark`
- OpenClaw-Lark: ByteDance 官方飞书插件 (MIT License, Copyright 2026 ByteDance)

---

## [v0.0.2] - 2026-03-20

**开发人**: ERROR403

### 新增

- **TUI 命令系统** (`src/tui_commands/`)
  - 全新 TUI 命令模块，支持斜杠命令管理 CLI 工具
  - `/new` - 创建新会话，生成唯一标题避免复用
  - `/session` - 列出最近 10 个会话，支持回复数字或 ID 切换
  - `/model` - 列出已配置 API key 的可用模型（约 10 个常用模型）
  - `/reset` / `/clear` - 重置当前会话
  - 交互式消息支持：用户回复数字或模型 ID 自动识别并处理
  - 独立模块设计：`base.py` (基类)、`opencode.py` (实现)、`interactive.py` (交互管理)、`__init__.py` (路由)

- **适配器 TUI 接口** (`src/adapters/base.py`, `src/adapters/opencode.py`)
  - `supported_tui_commands` 属性声明支持的命令列表
  - `create_new_session()` - 创建新会话
  - `list_sessions()` - 列出会话（支持 OpenCode HTTP API）
  - `switch_session()` - 切换会话
  - `reset_session()` - 重置会话
  - `list_models()` - 列出模型（只显示已配置 API key 的模型）
  - `switch_model()` - 切换模型
  - `get_current_model()` - 获取当前模型

- **消息处理器集成** (`src/feishu/handler.py`)
  - 集成 TUI 命令路由 (`TUICommandRouter`)
  - 检测斜杠命令并路由到对应处理器
  - 支持交互式消息回复（通过 parent_id 或内容匹配）
  - 数字回复（1-10）自动识别为会话切换
  - 模型 ID 格式（如 `opencode/mimo-v2`）自动识别为模型切换

- **消息对象扩展** (`src/feishu/client.py`)
  - `FeishuMessage` 添加 `parent_id` 字段，支持回复消息追踪

### 优化

- **会话数量限制** (`src/config.py`)
  - 默认最大会话数从 15 调整为 10
  - 减少资源占用，提高响应速度

- **会话 ID 显示** (`src/tui_commands/base.py`)
  - 修复所有会话显示相同 ID 的问题（原取前 6 位都是 `ses_2f`）
  - 改为取会话 ID 后 8 位作为显示 ID，确保唯一性

- **消息格式美化**
  - 会话列表：标题加粗、ID 代码格式、当前会话标记 ★
  - 模型列表：按提供商分组、名称加粗、ID 代码格式
  - 成功消息：统一格式，使用 Markdown 加粗和代码块

### 修复

- **模型列表为空** (`src/adapters/opencode.py`)
  - 问题：`opencode models --format json` 选项不存在，解析失败
  - 修复：改为直接解析 `opencode models` 标准输出

- **交互式回复失效** (`src/tui_commands/opencode.py`)
  - 问题：模型列表返回 `TUIResult.card` 而非 `TUIResult.interactive`
  - 修复：改为 `TUIResult.interactive`，支持用户回复模型 ID

- **模型 ID 回复未识别** (`src/feishu/handler.py`)
  - 问题：只检测数字回复，未检测模型 ID 格式
  - 修复：添加模型 ID 格式检测（包含 `/` 且不以 `/` 开头）

### 设计原则

- **完全隔离**：每个 CLI 工具有独立的 TUI 命令实现模块
- **自动路由**：根据当前会话上下文自动路由命令
- **向后兼容**：原有对话功能不受影响

---

## [v0.0.1] - 2026-03-20

**开发人**: ERROR403

### 新增

- **FlushController** (`src/feishu/flush_controller.py`)
  - 通用节流刷新控制器，纯调度原语设计
  - 支持 CardKit 100ms / IM Patch 1500ms 双模式节流
  - 长间隙检测：超过 2s 无更新后延迟 300ms 批处理，避免首次更新内容过少
  - 互斥刷新保护，冲突时自动标记 reflush
  - 参考 OpenClaw-Lark 实现 (MIT License, Copyright 2026 ByteDance)

- **StreamingCardController 重构** (`src/feishu/streaming_controller.py`)
  - 集成 FlushController，业务逻辑与调度逻辑分离
  - 严格状态机管理：idle → creating → streaming → completed/aborted/terminated
  - 懒创建卡片：第一个数据包到来时才创建，减少空等待
  - 支持思考阶段实时流式显示（保留 loading 动画图标）
  - CardKit 失败自动降级 IM Patch，无缝回退
  - 添加 `LOADING_ELEMENT_ID` 和飞书官方 loading 动画图标

- **Schema 2.0 卡片格式** (`src/feishu/card_builder.py`)
  - 所有卡片（thinking/streaming/complete）统一使用飞书 Schema 2.0 格式
  - `{"schema": "2.0", "body": {"elements": [...]}}` 结构
  - 修复 CardKit `code=200610 body is nil` 错误
  - 修复 IM Patch `code=230099 schemaV2 card can not change schemaV1` 错误

- **飞书原生引用气泡** (`src/feishu/api.py`, `src/feishu/handler.py`)
  - 使用 `im.v1.message.reply` API 替代 `im.v1.message.create`
  - 卡片顶部显示原生"回复 XXX: 内容"引用气泡
  - 支持 CardKit 路径和 IM Patch 回退路径

- **OpenCode 适配器优化** (`src/adapters/opencode.py`)
  - REASONING 事件去重：只在文本实际变化时 yield，避免高频触发 CardKit
  - CONTENT 事件批量策略：首批 ≥10 字符快速发出，后续 ≥30 字符或 0.4s 发出

### 修复

- **流式输出内容截断/乱码** (`src/feishu/streaming_controller.py`)
  - 问题：`on_content_stream` 将 delta 当全量文本处理，导致内容被覆盖
  - 修复：改为累积追加模式 `accumulated_text += text`

- **卡片更新失败** (`src/feishu/card_builder.py`)
  - 问题：complete 卡片使用旧格式 Schema 1.0，CardKit 报 body is nil
  - 修复：统一改为 Schema 2.0 格式，包含 `schema` 和 `body.elements`

- **消息格式不兼容** (`src/feishu/card_builder.py`)
  - 问题：IM Patch 回退时发送 Schema 1.0 卡片到 Schema 2.0 消息
  - 修复：所有卡片统一使用 Schema 2.0，确保兼容性

### 优化

- **节流参数对齐 OpenClaw**
  - CardKit: 100ms（原 80ms）
  - IM Patch: 1500ms（原 400ms，避免 230020 限流）
  - 长间隙阈值: 2000ms + 批处理窗口 300ms（新增）

- **Markdown 样式优化**
  - 标题降级：H1→H4, H2~H6→H5
  - 表格/代码块前后自动添加 `<br>` 间距
  - 无效图片 key 过滤（防止 CardKit 200570 错误）
  - 保留有效图片（`img_xxx` 和 HTTP(S) URL）

- **底部 Footer 样式**
  - 右对齐 + notation 字号
  - 格式：`✅ 已完成 · 耗时 3.2s · 📊 1,234 tokens (3.9%) · 🤖 Claude-Sonnet`
  - 支持 OpenCode/Kimi 两种 Token 统计格式

### 优化（2026-03-20 补充）

- **卡片 Footer 元数据布局调整** (`src/feishu/card_builder.py`)
  - 从单行改为两行显示，视觉层次更清晰
  - 第一行：✅ 已完成 · ⏱️ 耗时 3.2s（状态 + 耗时）
  - 第二行：📊 17,163 tokens (11.7%) · Context: 128K · 🤖 kimi-k2.5（Token统计 + 模型）
  - 两行均右对齐，notation 字号

- **OpenCode 默认模型切换** (`config.yaml`)
  - 从 `opencode/mimo-v2-pro-free` 切换为 `kimi-for-coding/k2p5`
  - Kimi K2.5 在代码任务上表现更佳

### 修复

- **api.py 逻辑错误** (`src/feishu/api.py`)
  - 问题：`send_card_by_card_id` 方法中重复定义 `result` 变量，使用未初始化的 `response`
  - 修复：删除冗余代码块，直接使用前面分支中已定义的 `result`

### 技术债务

- LSP 类型检查错误：lark_oapi SDK 类型定义不完整导致的误报，不影响实际运行
- 部分既有类型注解不匹配（CoroutineType vs AsyncIterator），运行正常

### 参考实现

- OpenClaw-Lark: ByteDance 官方飞书插件 (MIT License, Copyright 2026 ByteDance)
- kimibridge: 流式输出和卡片样式参考

---

**版本状态**: ✅ 完成核心功能开发和测试，等待部署验证
