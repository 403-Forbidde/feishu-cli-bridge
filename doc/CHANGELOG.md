# 更新日志

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
