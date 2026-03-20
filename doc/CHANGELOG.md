# 更新日志

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
