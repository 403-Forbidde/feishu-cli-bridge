# 问题追踪

## 已修复

### Issue #1: CardKit 更新失败 `code=200610 body is nil`

**状态**: ✅ 已修复  
**时间**: 2026-03-20  
**影响版本**: v0.0.0 → v0.0.1

**问题描述**:  
流式输出完成后，调用 CardKit `update_card()` 更新最终卡片时失败，返回错误 `code=200610, msg=ErrMsg: body is nil`。

**根本原因**:  
`card_builder.py` 中的 `complete` 卡片输出的是旧格式 Schema 1.0（`{"config":..., "elements":[...]}}`），而 CardKit API 要求 Schema 2.0 格式（`{"schema":"2.0", "body":{"elements":[...]}}}`）。

**修复方案**:  
将所有卡片（`thinking`/`streaming`/`complete`）统一改为 Schema 2.0 格式：
```python
{
    "schema": "2.0",
    "config": {"wide_screen_mode": True, "update_multi": True},
    "body": {"elements": [...]}
}
```

**相关文件**: `src/feishu/card_builder.py`

---

### Issue #2: IM Patch 跨 Schema 失败 `code=230099 schemaV2 card can not change schemaV1`

**状态**: ✅ 已修复  
**时间**: 2026-03-20  
**影响版本**: v0.0.0 → v0.0.1

**问题描述**:  
CardKit 失败回退到 IM Patch 模式时，`update_card_message` 返回错误 `code=230099 schemaV2 card can not change schemaV1`。

**根本原因**:  
CardKit 使用 Schema 2.0 创建卡片，但 IM Patch 回退时发送的是 Schema 1.0 格式的更新内容，飞书不允许跨 Schema 版本 patch。

**修复方案**:  
与 Issue #1 一同修复，所有卡片统一使用 Schema 2.0 格式。

**相关文件**: `src/feishu/card_builder.py`

---

### Issue #3: 流式输出内容截断/乱码

**状态**: ✅ 已修复  
**时间**: 2026-03-20  
**影响版本**: v0.0.0 → v0.0.1

**问题描述**:  
流式输出时，内容显示不完整或乱码（如 "isely based on my actual capabilities"），然后突然全部出现。

**根本原因**:  
`streaming_controller.py` 的 `on_content_stream` 将 OpenCode 适配器发送的 delta（增量）当作全量文本处理：
```python
# 错误代码
self.text.accumulated_text = text  # text 是 delta，如 "Hello"
```
导致每次新 delta 到来时覆盖已有内容。

**修复方案**:  
改为累积追加模式：
```python
# 正确代码
self.text.accumulated_text += text  # 累积追加
```

**相关文件**: `src/feishu/streaming_controller.py`

---

### Issue #4: 思考阶段空白/无内容显示

**状态**: ✅ 已修复  
**时间**: 2026-03-20  
**影响版本**: v0.0.0 → v0.0.1

**问题描述**:  
AI 思考时卡片只显示空白，没有思考内容，然后突然跳到回答。

**根本原因**:  
1. `STREAMING_THINKING_CARD` 缺少 `loading_icon` 元素，没有动态加载动画
2. OpenCode 适配器的 REASONING 事件高频重复触发，造成无效更新

**修复方案**:  
1. 在 `STREAMING_THINKING_CARD` 中加入 `loading_icon` 元素（飞书 CDN 官方图标）
2. OpenCode 适配器添加 REASONING 去重逻辑，只在文本实际变化时 yield

**相关文件**: 
- `src/feishu/streaming_controller.py`
- `src/adapters/opencode.py`

---

### Issue #5: 消息无引用气泡

**状态**: ✅ 已修复  
**时间**: 2026-03-20  
**影响版本**: v0.0.0 → v0.0.1

**问题描述**:  
AI 回复的卡片不显示"回复 XXX: 内容"引用气泡，用户无法看出是回复哪条消息。

**根本原因**:  
使用 `im.v1.message.create` API 发送消息，该 API 不支持引用回复功能。

**修复方案**:  
改用 `im.v1.message.reply` API：
- 新增 `ReplyMessageRequest` 支持
- `send_card_message()` 和 `send_card_by_card_id()` 在有 `reply_to` 时使用 reply 接口
- `handler.py` 将 `message.message_id` 作为 `reply_to_message_id` 传入

**相关文件**: 
- `src/feishu/api.py`
- `src/feishu/handler.py`
- `src/feishu/streaming_controller.py`

---

### Issue #6: `GetMessageResourceResponse` 无 `.data` 属性

**状态**: ✅ 已修复
**时间**: 2026-03-21
**影响版本**: v0.0.4 开发阶段

**问题描述**:
下载飞书消息图片时报错：`'GetMessageResourceResponse' object has no attribute 'data'`，图片下载失败。

**根本原因**:
`GetMessageResourceResponse` 与其他飞书 API 响应不同，文件内容**直接挂载**在响应对象上（`.file`、`.file_name`），而不是嵌套在 `.data` 中。错误代码：
```python
file_content = response.data.file  # AttributeError
```

**修复方案**:
```python
file_content = response.file  # 直接访问
```
同时将成功判断从 `response.success()` 改为 `response.file is None`，因为文件下载响应的 `code` 字段可能为 `None`。

**相关文件**: `src/feishu/api.py`

---

### Issue #7: 图片消息发给模型后模型看不到图片内容

**状态**: ✅ 已修复
**时间**: 2026-03-21
**影响版本**: v0.0.4 开发阶段

**问题描述**:
图片下载成功后，模型回复"我没有看到您上传的图片"，或者模型输出"图片路径是 /tmp/feishu_images/..."，说明模型收到的是文件路径文本而非图片内容。

**根本原因**:
两个子问题：

1. **端点选择错误**：原代码使用 `/session/{id}/message` 端点（同步，返回 200），该端点对 `FilePart` 的处理不支持视觉输入，会将文件路径作为文本传给模型。应使用 `/session/{id}/prompt_async` 端点（异步，返回 204，响应通过 SSE 推送），这是 ISSUES.md 技术调研时验证通过的端点。

2. **文件名重复**：`save_path = save_dir / f"{file_key}_{filename}"` 导致路径包含重复的 file_key，如 `img_xxx_img_xxx.jpg`。

**修复方案**:
1. 端点改为 `prompt_async`
2. 附件在客户端转为 base64 data URL 发送，不依赖服务端读取 `file://` 路径
3. 文件名改为 `save_dir / filename`（不再重复拼接 file_key）

**相关文件**: `src/adapters/opencode.py`, `src/feishu/api.py`

---

### Issue #11: asyncio.Event 跨循环错误（Python ≤3.9）

**状态**: ✅ 已修复
**时间**: 2026-03-21
**影响版本**: Windows Python 3.9 用户

**问题描述**:
Windows 上启动时报 `RuntimeError: Task got Future attached to a different loop`，程序无法运行。

**根本原因**:
`asyncio.Event()` 在模块顶层（`shutdown_event = asyncio.Event()`）创建时，Python 3.9 会将其绑定到当时存在的事件循环（或默认循环）。`asyncio.run()` 再创建新的事件循环，导致两者不一致。Python 3.10+ 已修复此行为。

**修复方案**:
将 `shutdown_event = asyncio.Event()` 从模块顶层移入 `main()` 函数内部，确保在运行中的事件循环内创建。`signal_handler` 通过闭包捕获 `shutdown_event`，行为不变。

**相关文件**: `src/main.py`

---

### Issue #12: start.bat 中文注释乱码

**状态**: ✅ 已修复
**时间**: 2026-03-21
**影响版本**: v0.1.4 Windows

**问题描述**:
运行 `start.bat` 时报多行 `'xxx' is not recognized as an internal or external command`，脚本无法正常执行。

**根本原因**:
`start.bat` 以 UTF-8 编码保存，包含中文注释。Windows CMD 默认使用 GBK/GB2312 代码页，UTF-8 中文字节序列被误解析为命令执行。

**修复方案**:
将 `start.bat` 中所有中文注释改为英文，消除编码依赖。

**相关文件**: `start.bat`

---

### Issue #13: opencode 子进程启动失败 [WinError 2]

**状态**: ✅ 已修复
**时间**: 2026-03-21
**影响版本**: v0.1.4 Windows

**问题描述**:
飞书发送消息后控制台报 `启动 opencode serve 失败: [WinError 2] 系统找不到指定的文件`，所有对话均失败。

**根本原因**:
`asyncio.create_subprocess_exec` 在 Windows 上不走 shell 的 `PATH` 查找，直接将第一个参数作为完整可执行路径处理。`"opencode"` 字符串在这种情况下找不到对应文件。

**修复方案**:
启动前用 `shutil.which("opencode")` 解析完整可执行路径（如 `C:\Users\xxx\AppData\Roaming\npm\opencode.cmd`），再传给 `create_subprocess_exec`。

**相关文件**: `src/adapters/opencode.py`

---

### Issue #14: opencode serve --hostname 参数在 v1.2.27 不支持

**状态**: ✅ 已修复
**时间**: 2026-03-21
**影响版本**: opencode v1.2.27+

**问题描述**:
opencode server 启动超时（10s 后），日志显示 `opencode serve 进程意外退出`。

**根本原因**:
代码中 `opencode serve` 命令携带了 `--hostname 127.0.0.1` 参数，该参数在 opencode v1.2.27 中不存在（可能已更名或移除），导致进程启动后立即以错误码退出。

**修复方案**:
去除 `--hostname` 参数，仅保留 `--port`。opencode v1.2.27 默认即绑定 `127.0.0.1`。

**相关文件**: `src/adapters/opencode.py`

---

### Issue #15: asyncio.WindowsProactorEventLoopPolicy 废弃警告

**状态**: ✅ 已修复
**时间**: 2026-03-21
**影响版本**: Python 3.12+ Windows

**问题描述**:
启动时输出两行 `DeprecationWarning: 'asyncio.WindowsProactorEventLoopPolicy' is deprecated and slated for removal in Python 3.16`。

**根本原因**:
Python 3.12+ 在 Windows 上已将 `ProactorEventLoop` 设为默认，不再需要手动 `set_event_loop_policy`；强行设置反而触发废弃警告。

**修复方案**:
加版本判断：仅在 Python < 3.12 时设置 `WindowsProactorEventLoopPolicy`。

**相关文件**: `src/main.py`

---

## 已知问题

### LSP 类型检查误报

**状态**: ⚠️ 已知，不影响运行  
**优先级**: 低

**问题描述**:  
VS Code / LSP 显示大量类型错误，如：
- `"v1" is not a known attribute of "None"`
- `"message_id" is not a known attribute of "None"`

**根本原因**:  
lark_oapi SDK 的类型定义不完整，导致 LSP 无法正确推断响应类型。

**影响**:  
仅影响开发体验，不影响实际运行。所有 API 调用在运行时正常工作。

**缓解措施**:  
运行时验证通过，所有功能测试正常。

---

## 待优化

### Issue #9: 项目列表卡片简陋，切换需要交互式按钮

**状态**: ✅ 已修复
**时间**: 2026-03-21
**影响版本**: v0.0.5+

**问题描述**:

`/pl` 返回的项目列表是纯文本格式，信息密度低，且切换项目需要手动输入 `/ps <标识>`，交互不友好。

**期望效果**:

1. **`/pl` 返回结构化卡片**，每个项目一行，包含：
   - 项目名称（加粗）+ 路径（代码格式）+ 最后活跃时间
   - 当前项目用不同颜色/图标区分
   - 每行右侧有「切换」按钮

2. **点击「切换」按钮**直接触发项目切换（等同 `/ps <标识>`），无需手动输入命令

3. **切换成功后卡片更新**，当前项目标记更新到新项目

**修复方案**:

1. `card_builder.py` 新增 `build_project_list_card()` — Schema 1.0 格式（`action + button + value` 支持点击回调），每个非当前项目显示「🔄 切换」按钮
2. `tui_commands/project.py` `/pl` 命令改为返回 `TUIResult.card()` 含 `card_json`
3. `feishu/handler.py` `_handle_project_command()` 检测 CARD 类型直接发卡片；新增 `handle_card_callback()` 处理 `switch_project` action
4. `feishu/client.py` 注册 `register_p2_card_action_trigger`，通过 `asyncio.run_coroutine_threadsafe` 调用 handler；切换后用 IM Patch 更新卡片
5. `main.py` 注册 `handler.handle_card_callback` 到 `feishu_client.on_card_callback()`

**相关文件**:
- `src/feishu/card_builder.py`
- `src/feishu/client.py`
- `src/feishu/handler.py`
- `src/tui_commands/project.py`
- `src/main.py`

---

**实现方向（原）**:

飞书 Schema 2.0 卡片支持 `action` 元素（`button` 类型），点击时触发回调：

```json
{
  "tag": "button",
  "text": {"tag": "plain_text", "content": "切换"},
  "type": "primary",
  "behaviors": [{
    "type": "callback",
    "value": {"action": "switch_project", "name": "myapp"}
  }]
}
```

需要：
1. `card_builder.py` 新增 `build_project_list_card()` 函数，构建含按钮的项目列表卡片
2. 飞书卡片回调处理：在 `handler.py` 或新增 `card_callback_handler.py` 处理卡片按钮点击事件
3. 注册飞书卡片回调路由（`im.card.action.trigger_v1` 事件）
4. 回调收到后调用 `ProjectManager.switch_project(name)` 并回复切换结果

**相关文件**:
- `src/feishu/card_builder.py` — 新增项目列表卡片构建
- `src/feishu/handler.py` — 新增卡片回调处理
- `src/tui_commands/project.py` — `/pl` 命令改为返回卡片类型结果

---

### Issue #8: OpenCode 工具调用工作目录不隔离

**状态**: ✅ 已修复
**时间**: 2026-03-21
**影响版本**: v0.0.5

**问题描述**:

切换项目（`/ps <名称>`）后，模型工具调用（`bash`/`read_file` 等）的实际执行路径仍为错误目录。

**根本原因**:

OpenCode server 通过**全局中间件**读取每个 HTTP 请求的 `directory` **query 参数**（或 `x-opencode-directory` header）来确定工作目录上下文：

```typescript
// server.ts 中间件（对所有路由生效）
const raw = c.req.query("directory") || c.req.header("x-opencode-directory") || process.cwd()
```

`directory` 不是请求体字段，进程级别的 `cwd`/`PWD` 也无效。必须在每个请求上附加 query 参数。

**修复方案**:

三处请求都需携带 `?directory=working_dir` query 参数：

1. `POST /session?directory=/code/myproject` — session 在该目录上下文中创建
2. `POST /session/{id}/prompt_async?directory=/code/myproject` — prompt 的工具调用在该目录执行
3. `GET /event?directory=/code/myproject` — 只接收该目录实例的事件

同步简化架构：单一 server 实例 + `_sessions: Dict[working_dir, OpenCodeSession]` 按目录缓存 session。

**相关文件**: `src/adapters/opencode.py`

---

### Issue #10: /session 命令在飞书客户端下作用有限

**状态**: 🔍 待讨论
**时间**: 2026-03-21
**优先级**: 低

**问题描述**:
`/session` 命令返回最近 10 个会话的列表，用户回复数字或 `provider/model` 格式切换会话。该交互模式在桌面终端 TUI 下较自然，但在飞书客户端中存在以下局限：

1. **使用场景稀少** — 飞书用户通常只维护一个对话上下文，极少需要手动切换历史会话
2. **列表不美观** — 当前返回的会话列表为纯文本格式，信息展示粗糙，与其他已卡片化的命令（`/model`、`/pl`）风格不一致
3. **必要性存疑** — `/new` 已覆盖"开启新会话"的核心需求，`/session` 的增量价值不明确

**当前行为**:
返回纯文本会话列表，用户回复数字 1-10 切换，交互体验较差。

**待讨论**:
- 是否直接移除 `/session` 命令，仅保留 `/new`
- 如保留，是否卡片化改造（与 `/model`、`/pl` 风格对齐）

**暂定决策**:
不做修改，保留现状，等待进一步使用反馈后再决定去留。

---

### 1. 适配器类型注解统一

**描述**:  
`BaseCLIAdapter.execute_stream` 返回类型声明为 `AsyncIterator[StreamChunk]`，但子类实现返回 `CoroutineType[Any, Any, AsyncIterator[StreamChunk]]`，造成 LSP 警告。

**建议**:  
统一改为异步生成器函数签名，消除类型警告。

---

### 2. 心跳和连接稳定性

**描述**:  
WebSocket 长连接在弱网环境下可能断开，当前重连逻辑较简单。

**建议**:  
- 添加指数退避重连
- 心跳检测
- 断线恢复后自动续传

---

## 功能建议

### 1. 多轮对话历史显示优化

当前历史以纯文本存储，建议添加结构化显示（如折叠、时间戳）。

### 2. 支持图片和文件输入

**状态**: ✅ 已实现 (v0.0.4, 2026-03-21)
**优先级**: 高

**背景**:
飞书支持发送图片消息，但当前系统仅处理 `msg_type == "text"` 和 `"post"`，图片消息被丢弃。

**技术调研结果 (2026-03-21)**:

✅ **方案 B（file:// 协议）验证成功**

通过 `kimi-for-coding/k2p5` 模型测试，确认 `file://` URL 可以被 OpenCode 正确处理：

1. **OpenCode API 支持 FilePart**:
   ```json
   {
     "type": "file",
     "mime": "image/png",
     "url": "file:///path/to/image.png",
     "filename": "image.png"
   }
   ```

2. **OpenCode 自动处理**:
   Server 端收到 `file://` URL 后，会自动读取文件并转为 base64 data URI 传给模型。

3. **模型视觉识别有效**:
   测试 `/code/cli-feishu-bridge/doc/bad.png`（飞书对话截图），模型成功：
   - 识别出是飞书/Lark 聊天界面
   - 详细描述了界面布局和内容
   - 正确提取了文字信息

**测试记录**:
```bash
# 会话创建
POST /session -> ses_2f1e320e0ffee8T23najp0ST5l

# 发送图片消息
POST /session/{id}/prompt_async
Body: {
  "parts": [
    {"type": "text", "text": "描述图片内容"},
    {"type": "file", "mime": "image/png", "url": "file:///code/cli-feishu-bridge/doc/bad.png"}
  ],
  "model": {"providerID": "kimi-for-coding", "modelID": "k2p5"}
}

# 结果：模型成功识别并详细描述了截图内容
```

**实现方案**:

无需启动本地 HTTP 服务器，`file://` 方案完全可行：

1. **`handler.py`** — 扩展 `_parse_event_data()` 处理 `msg_type == "image"`:
   - 解析图片 `file_key`
   - 调用飞书 API 下载图片到临时目录 `/tmp/feishu_images/`
   - 将图片路径存入消息对象

2. **`opencode.py:_send_message()`** — 支持图片 parts:
   ```python
   parts = [{"type": "text", "text": prompt}]
   if image_path:
       parts.append({
           "type": "file",
           "mime": mime_type,
           "url": f"file://{image_path}",
           "filename": filename
       })
   ```

3. **清理机制**:
   定期清理 `/tmp/feishu_images/` 目录，或会话结束时删除。

**相关文件**:
- `src/feishu/handler.py` — 处理图片消息下载
- `src/adapters/opencode.py` — 发送图片 part
- `src/feishu/api.py` — 飞书文件下载 API

**参考**:
- OpenCode Part 类型定义: `FilePartInput = {type: "file", mime: string, url: string}`
- 飞书图片消息格式: `{"message_type": "image", "content": {"image_key": "..."}}`

### 3. 会话持久化到云端

当前会话存储在本地 `.sessions/` 目录，建议支持云存储或数据库。

---

### 4. 项目管理功能

**状态**: ✅ 已实现 (v0.0.5, 2026-03-21)
**优先级**: 高
**参考实现**: `/code/kimibridge/src/` 中已有完整实现可直接参考

#### 需求描述

通过飞书命令管理"项目"（即工作目录），选择项目后 CLI 工具的 `working_dir` 自动切换到对应路径，实现多项目隔离开发。

#### 命令设计

| 命令 | 说明 |
|------|------|
| `/pa <路径> [名称]` | 添加已有目录为项目（`/project add` 简写） |
| `/pc <路径> [名称]` | 创建新目录并添加为项目（`/project create` 简写） |
| `/pl` | 列出所有项目，返回交互式卡片 |
| `/ps <名称>` | 切换到指定项目 |
| `/prm <名称>` | 从列表移除项目（不删除目录） |
| `/pi [名称]` | 查看项目信息 |

路径支持 `~` 展开；名称未指定时自动从目录名生成（英文标识符，重名自动加数字后缀）。

#### 数据模型

```python
@dataclass
class Project:
    name: str           # URL安全英文标识（命令使用）
    display_name: str   # 展示名，可中文
    path: Path          # 项目绝对路径
    created_at: datetime
    last_active: datetime
    description: str = ""
    session_ids: List[str] = []
```

存储位置：`~/.config/cli-feishu-bridge/projects.json`，原子写入（先写 `.tmp` 再 rename）。

```json
{
  "version": "1.0",
  "projects": {
    "my-app": {
      "name": "my-app",
      "display_name": "我的项目",
      "path": "/code/my-app",
      "created_at": "...",
      "last_active": "...",
      "session_ids": []
    }
  },
  "current_project": "my-app"
}
```

#### 实现方案

**新增文件：**

| 文件 | 职责 |
|------|------|
| `src/project/manager.py` | `ProjectManager`：增删改查、持久化、asyncio.Lock 并发保护 |
| `src/project/models.py` | `Project`、`ProjectsConfig` dataclass |
| `src/tui_commands/project.py` | `/p*` 命令解析与响应逻辑 |

**修改文件：**

| 文件 | 改动 |
|------|------|
| `src/feishu/handler.py` | 在 `handle_message()` 中优先检测 `/p*` 命令并分发；每次普通对话时从 `ProjectManager.get_current_project()` 取 `path` 作为 `working_dir` |
| `src/tui_commands/__init__.py` | 注册项目命令路由 |
| `src/main.py` | 初始化 `ProjectManager` 并注入 `MessageHandler` |
| `config.yaml` | 添加 `project.storage_path` 配置项 |

**切换项目时的执行流程：**

```
/ps <名称>
  → ProjectManager.switch_project(name)     # 更新 current_project，写 projects.json
  → 当前会话的 working_dir 覆盖为 project.path
  → SessionManager 持久化新 working_dir
  → ProjectManager.add_session_to_project() # 关联 session_id
  → 飞书回复切换成功卡片（显示项目名、路径、关联会话数）
```

**普通对话时：**

```python
# handler.py handle_message() 中
current_project = await project_manager.get_current_project()
working_dir = current_project.path if current_project else default_working_dir
# 传给 adapter.execute_stream(prompt, context, working_dir=working_dir)
```

#### 路径验证规则

添加项目时（参考 kimibridge 实现）：
- 目录必须存在（`/pa`）或可创建（`/pc`）
- 必须是目录，不能是文件
- 未被其他项目占用（同路径去重）
- 当前用户有 rwx 权限

#### 飞书卡片交互

`/pl` 返回项目列表卡片，每个项目显示：
- 名称 + 展示名
- 路径
- 最后活跃时间
- "切换"按钮（卡片回调 → 等同 `/ps <name>`）

#### 参考实现位置

| 参考文件 | 对应新文件 |
|---------|-----------|
| `/code/kimibridge/src/models/project.py` | `src/project/models.py` |
| `/code/kimibridge/src/services/project_manager.py` | `src/project/manager.py` |
| `/code/kimibridge/src/handlers/project_command_handler.py` | `src/tui_commands/project.py` |
| `/code/kimibridge/src/handlers/feishu_handler_v3.py`（项目相关部分） | `src/feishu/handler.py` |

---

### Issue #16: 双重消息解析路径（死代码 + 一致性问题）

**状态**: 📋 待修复
**优先级**: 高
**发现时间**: 2026-03-21

**问题描述**:
`FeishuClient._parse_message`（`client.py:307`）解析完消息后，结果被立即丢弃。代码随即调用 `_event_to_dict` 将事件转回字典，再由 `handler.py:275` 重新解析一遍。两套解析逻辑对附件处理能力不对等（`client.py` 版不处理 `image/file` 类型），且一次事件被解析两次。

**修复方案**:
删除 `client.py` 中的 `_parse_message` 方法（死代码），统一由 `handler.py` 的 `_parse_event_data` 负责消息解析。

**相关文件**: `src/feishu/client.py`, `src/feishu/handler.py`

---

### Issue #17: `_stream_reply_legacy` 丢失 reply_to 参数

**状态**: 📋 待修复
**优先级**: 高
**发现时间**: 2026-03-21

**问题描述**:
`api.py:609` 在 IM Patch 回退路径中调用 `send_card_message` 时未传 `reply_to` 参数：
```python
message_id = await self.send_card_message(chat_id, initial_card)
# 应为：send_card_message(chat_id, initial_card, reply_to=reply_to_message_id)
```
导致 IM Patch 模式下回复不显示原生引用气泡，与 CardKit 路径行为不一致。

**修复方案**:
在调用处补传 `reply_to=reply_to_message_id`。

**相关文件**: `src/feishu/api.py`

---

### Issue #18: `SessionManager._save_session` 在事件循环中同步阻塞

**状态**: 📋 待修复
**优先级**: 高
**发现时间**: 2026-03-21

**问题描述**:
`session/manager.py:109` 的 `_save_session` 是同步文件写入，在异步上下文（`handle_message`）中被直接调用，每条消息触发 2-3 次，持续阻塞 asyncio 事件循环。

**修复方案**:
改用 `await asyncio.to_thread(self._save_session, session)` 将磁盘 IO 移到线程池。

**相关文件**: `src/session/manager.py`

---

### Issue #19: `_patch_card` 每次回调重建 SDK Client

**状态**: 📋 待修复
**优先级**: 高
**发现时间**: 2026-03-21

**问题描述**:
`client.py:183` 在每次卡片回调时执行 `lark.Client.builder().app_id(...).build()`，不复用已有的 SDK 客户端，导致连接池无法复用，累积资源浪费和潜在连接泄漏。

**修复方案**:
直接使用 `FeishuAPI` 中已初始化的 `self.client` 实例，或在 `FeishuClient` 构造时创建共享实例。

**相关文件**: `src/feishu/client.py`

---

### Issue #20: handler.py 重复 TUI 命令检测（死代码）

**状态**: 📋 待修复
**优先级**: 高
**发现时间**: 2026-03-21

**问题描述**:
`handler.py:167-177` 存在两段相同的 `is_tui_command` 检测逻辑，第二段（第 174 行）因第一段已 `return` 而永远不会执行，是死代码：
```python
if self.tui_router.is_tui_command(content):   # 第 167 行，执行后 return
    ...
    return
if not content:
    return
if self.tui_router.is_tui_command(content):   # 第 174 行，永远不会执行
    ...
```

**修复方案**:
删除第二段重复检测，将 `if not content: return` 移到第一段之前。

**相关文件**: `src/feishu/handler.py`

---

### Issue #21: 附件保存存在路径穿越风险

**状态**: 📋 待修复
**优先级**: 中
**发现时间**: 2026-03-21

**问题描述**:
`api.py:432` 直接使用飞书 SDK 返回的 `response.file_name` 构造保存路径：
```python
save_path = save_dir / filename  # filename 来自飞书响应，可能含 ../
```
若 `filename` 包含 `../` 路径组件，文件将被写入 `feishu_images/` 目录之外。

**修复方案**:
```python
save_path = save_dir / Path(filename).name  # 只取基础文件名
```

**相关文件**: `src/feishu/api.py`

---

### Issue #22: OpenCode `_sessions` 字典无并发锁保护

**状态**: 📋 待修复
**优先级**: 中
**发现时间**: 2026-03-21

**问题描述**:
`opencode.py:159` 的 `self._sessions` 在并发消息场景下，`_get_or_create_session` 和 `create_new_session` 同时执行时可能产生竞态——两个协程对同一 `working_dir` 均触发 `_create_session`，产生重复 API 调用和 session 泄漏。

**修复方案**:
添加 `self._sessions_lock = asyncio.Lock()`，在 `_get_or_create_session` 中使用 `async with self._sessions_lock`。

**相关文件**: `src/adapters/opencode.py`

---

### Issue #23: `asyncio.get_event_loop()` 弃用用法

**状态**: 📋 待修复
**优先级**: 中
**发现时间**: 2026-03-21

**问题描述**:
以下位置在异步函数中使用了已弃用的 `asyncio.get_event_loop()`，在 Python 3.10+ 触发 `DeprecationWarning`：
- `opencode.py:424,443`：`asyncio.get_event_loop().time()`
- `flush_controller.py:102`：`loop = asyncio.get_event_loop()`

**修复方案**:
统一替换为 `asyncio.get_running_loop()`（在 async 函数中）或 `time.monotonic()`。

**相关文件**: `src/adapters/opencode.py`, `src/feishu/flush_controller.py`

---

### Issue #24: `_beautify_list_items` 是完全空操作

**状态**: 📋 待修复
**优先级**: 中
**发现时间**: 2026-03-21

**问题描述**:
`card_builder.py:977-1002` 的 `_beautify_list_items` 函数设置了 `prev_was_list` 局部变量但从未使用，函数无任何可观测副作用，是完全空操作。`optimize_markdown_style` 每次调用它都白白遍历一遍文本行。

**修复方案**:
删除此函数及所有调用点。

**相关文件**: `src/feishu/card_builder.py`

---

### Issue #25: `formatter.py` 大量死代码待清理

**状态**: 📋 待修复
**优先级**: 低
**发现时间**: 2026-03-21

**问题描述**:
`formatter.py` 中以下代码已被 `card_builder.py` 的同名实现取代，但未删除，造成维护混乱：
- `optimize_markdown_style`（第 55 行）— 已被 `card_builder.py:1010` 取代，且逻辑不同（H1→H3 vs H1→H4），`format_with_metadata` 仍调用旧版
- `_simplify_model_name`（第 104 行）— 已被 `card_builder.py:1159` 取代，截断逻辑不一致
- `format_with_metadata`（第 8 行）— 无任何调用方
- `parse_mention`（第 155 行）— 无任何调用方

**修复方案**:
删除 `formatter.py` 中的全部死代码；若文件为空则删除整个文件，并更新 import。

**相关文件**: `src/feishu/formatter.py`, `src/feishu/card_builder.py`

---

### Issue #26: `max_sessions` 默认值三处不一致

**状态**: 📋 待修复
**优先级**: 低
**发现时间**: 2026-03-21

**问题描述**:
`max_sessions` 的默认值在三处不一致：
- `config.py:21`（dataclass 字段默认值）：`10`
- `config.py:145`（env 变量解析）：`int(os.getenv("MAX_SESSIONS", "15"))`
- `config.py:207`（YAML 解析）：`session_data.get("max_sessions", 15)`

**修复方案**:
统一为同一个值（建议 15），或抽取为模块级常量 `DEFAULT_MAX_SESSIONS = 15`。

**相关文件**: `src/config.py`

---

### 5. Codex 适配器完整化（对齐 OpenCode 功能）

**状态**: 📋 待规划
**优先级**: 中
**调研时间**: 2026-03-21

#### 背景

当前 `src/adapters/codex.py` 是基于旧版推测写成的占位实现，存在以下问题：

1. **JSON 事件解析错误** — `parse_chunk` 查找的字段（`response`、`delta`、`command`、`done`）不匹配真实 Codex `--json` 输出格式。实际格式（v0.44+）为 `{"type": "agent_message", ...}`、`{"type": "turn.completed", ...}` 等
2. **`--history` 参数不存在** — 代码尝试传 `--history <tmpfile>` 参数，但该 flag 从未实现（GitHub issue #118，已关闭为"不计划"）；上下文持久化靠 session resume 机制
3. **图片支持缺失** — `attachments` 参数被完全忽略，Codex 实际支持 `--image path[,path...]`
4. **无 TUI 命令支持** — 缺少 `/new`、`/session`、`/model`、`/reset` 命令

#### OpenCode vs Codex 功能对比

| 功能 | OpenCode 实现方式 | Codex 实现方式 | 当前状态 |
|------|-----------------|---------------|---------|
| 流式输出 | HTTP/SSE `GET /event` | `--json` stdout JSONL | ❌ 解析格式错误 |
| 会话创建 | `POST /session` | 直接运行（新进程） | ❌ 缺失 |
| 会话续接 | session ID + HTTP | `codex exec resume <ID>` | ❌ 缺失 |
| 会话重置 `/reset` | 新建 session | 不传 `resume`，新起进程 | ❌ 缺失 |
| 会话列表 `/session` | `GET /session` | 读 `~/.codex/sessions/` 目录 | ❌ 缺失 |
| 模型切换 `/model` | 更新 config | `--model` flag | ❌ 缺失 |
| 图片输入 | FilePart base64 data URL | `--image path[,path...]` | ❌ 缺失 |
| Agent 切换 | `GET /agent` + config | 无（Codex 无 agent 系统） | N/A |

#### 需要修改的内容

1. **重写 `parse_chunk`** — 按真实 Codex event schema 解析：
   - `type: "agent_message"` → `StreamChunkType.CONTENT`
   - `type: "turn.completed"` → `StreamChunkType.DONE`
   - `type: "turn.failed"` / `type: "error"` → `StreamChunkType.ERROR`

2. **Session ID 追踪** — 从 `--json` 输出中提取 session ID，持久化到 `.sessions/` 供 resume 使用

3. **`execute_stream` 支持 resume** — 有 session ID 时用 `codex exec resume <ID>`，否则新起会话

4. **图片支持** — 将 `attachments` 中的本地路径转为 `--image path1,path2` 参数（支持 PNG/JPEG）

5. **TUI 命令** — 实现以下方法（对齐 OpenCode 接口）：
   - `create_new_session()` — 清除当前 session ID，下次调用自动新建
   - `list_sessions()` — 扫描 `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` 目录
   - `switch_session(session_id)` — 设置当前 session ID 为指定值
   - `reset_session()` — 等同 `create_new_session()`
   - `list_models()` — 从 `config.yaml models` 列表读取（与 OpenCode 相同方式）
   - `switch_model(model_id)` — 更新 `config["default_model"]`（与 OpenCode 相同）

#### 技术参考

- [Codex 非交互模式文档](https://developers.openai.com/codex/noninteractive)
- [Codex CLI 命令参考](https://developers.openai.com/codex/cli/reference)
- [GitHub Issue #4776: JSON 输出格式漂移](https://github.com/openai/codex/issues/4776)（已修复，event 字段名为 `type` 非 `item_type`）
- [GitHub Issue #118: streaming/history 标志](https://github.com/openai/codex/issues/118)（`--history` 不会实现，用 resume）

