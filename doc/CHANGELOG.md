# 更新日志

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
  - `ProjectManager`：增删改查、原子写入持久化（`~/.config/cli-feishu-bridge/projects.json`）、`asyncio.Lock` 并发保护
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
- 项目配置文件：`~/.config/cli-feishu-bridge/projects.json`，原子写入（写 `.tmp` 再 rename）
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
