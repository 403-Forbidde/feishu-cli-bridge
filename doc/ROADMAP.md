# 🗺️ Roadmap / 发展路线图

---

## 中文

### 里程碑总览

| 里程碑 | 核心交付 | 状态 |
|:-------|:---------|:----:|
| **v0.2.1** | TypeScript 重写 · 架构优化 · 性能提升 | ✅ 已完成 |
| **v0.3.0** | Claude Code 适配器 | ✅ 已完成 |
| **v0.4.0** | Kimi CLI 适配器（Wire 协议） | 🔜 规划中 |
| **v0.5.0** | Codex CLI 适配器 | 🔜 规划中 |
| **v1.0.0** | 首个正式版本 | 🔜 规划中 |

---

### ✅ v0.2.1（当前版本）— TypeScript 重写完成

- [x] 全面迁移至 TypeScript/Node.js 技术栈
- [x] 分层架构：Core → Platform → Adapter
- [x] 类型安全：严格的 TypeScript 类型定义
- [x] 性能优化：HTTP 连接池复用、智能节流
- [x] 安全加固：路径遍历防护、输入验证
- [x] CardKit 流式输出（打字机效果 + loading 动画，100ms 节流）
- [x] IM Patch 降级回退（CardKit 不可用时自动切换，1500ms 节流）
- [x] 可折叠思考面板（Reasoning 过程实时展示）
- [x] 图片 / 文件输入（base64 FilePart，视觉模型识别）
- [x] 多项目管理（`/pl` 交互式卡片，支持分页与删除二次确认）
- [x] TUI 命令（`/new` `/session` `/model` `/mode` `/reset` `/help` `/stop`），全部以交互式卡片回复
- [x] OpenCode Server 会话管理（完全委托给 OpenCode 服务器，本地零持久化）
- [x] 跨平台支持：Windows / Linux / macOS

---

### ✅ v0.3.0 — Claude Code 适配器（已完成）

**目标**：集成 Claude Code CLI，通过 `@claude` 前缀调用。

| 特性 | 说明 | 状态 |
|:-----|:-----|:----:|
| 子进程流式输出 | `child_process.spawn` + JSON Lines 实时解析 | ✅ |
| 会话管理 | `--session-id` + `--resume` + `--fork-session`，本地映射持久化 | ✅ |
| 停止生成 | `SIGINT` 信号优雅终止 | ✅ |
| 模型动态检测 | 从 `result.modelUsage` 自动读取实际模型 | ✅ |
| 文件引用 | `@filepath` 语法引用附件 | ✅ |
| 双路并行启用 | `@opencode` / `@claude` 自由切换 | ✅ |
| 单元测试 | 61 个测试用例全部通过 | ✅ |

**交付时间**：2026-04-03

**关键实现**：
- `ClaudeCodeAdapter`：实现 `BaseCLIAdapter` 接口
- `ClaudeCodeProcessManager`：子进程生命周期管理
- `ClaudeCodeStreamParser`：stream-json 解析器（28 个单元测试）
- `ClaudeCodeSessionManager`：会话 ID 映射与持久化

---

### 🔜 v0.4.0 — Kimi CLI 适配器（Wire 协议）

---

### 🔜 v0.4.0 — Kimi CLI 适配器（Wire 协议）

**目标**：将 [Kimi CLI](https://kimi.moonshot.cn) 以 Wire 协议接入，通过 `@kimi` 前缀调用。

| 特性 | 说明 |
|:-----|:-----|
| Wire 协议（JSON-RPC 2.0 over stdin/stdout） | 比 HTTP/SSE 延迟更低，无需启动独立 HTTP server |
| 持久化子进程池 | 每个 session 对应独立长驻 kimi 进程，上下文完整保留 |
| 思维链流式展示 | `--thinking` 模式下推理过程实时显示在可折叠面板 |
| `--yolo` 全自动模式 | 工具调用无需人工确认，配置开关控制 |
| 三路并行启用 | `@opencode` / `@claude` / `@kimi` 自由切换 |

---

### 🔜 v0.5.0 — Codex CLI 适配器

**目标**：将 [Codex CLI](https://github.com/openai/codex) 以子进程模式接入，通过 `@codex` 前缀调用。

| 特性 | 说明 |
|:-----|:-----|
| 子进程流式输出 | `codex --stream` 模式，逐行解析 stdout |
| 独立会话管理 | 与其他 CLI 会话隔离，LRU 复用 |
| 四路并行启用 | `@opencode` / `@claude` / `@kimi` / `@codex` 自由切换 |
| 图片输入支持 | 与 OpenCode 路径对齐，附件统一预处理 |

---

### 🔜 v1.0.0 — 首个正式版本

**目标**：经过大量测试和完善后的生产就绪稳定版本。

| 重点领域 | 说明 |
|:---------|:-----|
| 稳定性与可靠性 | 全面的错误处理、优雅降级 |
| 性能优化 | 连接池、缓存、内存优化 |
| 文档完善 | 完整的 API 文档、部署指南、故障排查 |
| 测试覆盖 | 高测试覆盖率、集成测试、E2E 验证 |

---

## English

### Milestone Overview

| Milestone | Core Deliverables | Status |
|:----------|:------------------|:------:|
| **v0.2.1** | TypeScript Rewrite · Architecture Optimization · Performance Improvements | ✅ Completed |
| **v0.3.0** | Claude Code Adapter | ✅ Completed |
| **v0.4.0** | Kimi CLI Adapter (Wire Protocol) | 🔜 Planned |
| **v0.5.0** | Codex CLI Adapter | 🔜 Planned |
| **v1.0.0** | First Stable Release | 🔜 Planned |

---

### ✅ v0.2.1 (Current) — TypeScript Rewrite Complete

- [x] Full migration to TypeScript/Node.js stack
- [x] Layered architecture: Core → Platform → Adapter
- [x] Type safety: Strict TypeScript type definitions
- [x] Performance optimization: HTTP connection pooling, smart throttling
- [x] Security hardening: Path traversal protection, input validation
- [x] Feature complete: 100% parity with Python version
- [x] CardKit streaming (typewriter effect + loading animation, 100ms throttle)
- [x] IM Patch fallback (auto-switch when CardKit unavailable, 1500ms throttle)
- [x] Collapsible thinking panel (real-time reasoning display)
- [x] Image / file input (base64 FilePart, vision model recognition)
- [x] Multi-project management (`/pl` interactive card with pagination and delete confirmation)
- [x] TUI commands (`/new` `/session` `/model` `/mode` `/reset` `/help` `/stop`), all replied as interactive cards
- [x] OpenCode Server session management (fully delegated to OpenCode server, zero local persistence)
- [x] Cross-platform support: Windows / Linux / macOS

---

### ✅ v0.3.0 — Claude Code Adapter (Completed)

**Goal**: Integrate Claude Code CLI via subprocess mode, invoked with `@claude` prefix.

| Feature | Description | Status |
|:--------|:------------|:------:|
| Subprocess Streaming Output | `child_process.spawn` + JSON Lines real-time parsing | ✅ |
| Session Management | `--session-id` + `--resume` + `--fork-session`, local mapping persistence | ✅ |
| Stop Generation | `SIGINT` signal graceful termination | ✅ |
| Dynamic Model Detection | Auto-detect actual model from `result.modelUsage` | ✅ |
| File Reference | `@filepath` syntax for attachments | ✅ |
| Dual Parallel Enablement | `@opencode` / `@claude` free switching | ✅ |
| Unit Tests | 61 test cases all passing | ✅ |

**Delivery Date**: 2026-04-03

**Key Implementations**:
- `ClaudeCodeAdapter`: Implements `BaseCLIAdapter` interface
- `ClaudeCodeProcessManager`: Child process lifecycle management
- `ClaudeCodeStreamParser`: stream-json parser (28 unit tests)
- `ClaudeCodeSessionManager`: Session ID mapping and persistence

---

### 🔜 v0.4.0 — Kimi CLI Adapter (Wire Protocol)

---

### 🔜 v0.4.0 — Kimi CLI Adapter (Wire Protocol)

**Goal**: Integrate [Kimi CLI](https://kimi.moonshot.cn) via Wire protocol, invoked with `@kimi` prefix.

| Feature | Description |
|:--------|:------------|
| Wire Protocol (JSON-RPC 2.0 over stdin/stdout) | Lower latency than HTTP/SSE, no standalone HTTP server needed |
| Persistent Subprocess Pool | Each session corresponds to a long-running kimi process, full context retention |
| Thinking Chain Streaming | `--thinking` mode reasoning displayed in real-time in collapsible panel |
| `--yolo` Fully Automatic Mode | Tool calls without manual confirmation, controlled by config switch |
| Triple Parallel Enablement | `@opencode` / `@claude` / `@kimi` free switching |

---

### 🔜 v0.5.0 — Codex CLI Adapter

**Goal**: Integrate [Codex CLI](https://github.com/openai/codex) via subprocess mode, invoked with `@codex` prefix.

| Feature | Description |
|:--------|:------------|
| Subprocess Streaming Output | `codex --stream` mode, line-by-line stdout parsing |
| Independent Session Management | Isolated from other CLI sessions, LRU reuse |
| Quadruple Parallel Enablement | `@opencode` / `@claude` / `@kimi` / `@codex` free switching |
| Image Input Support | Aligned with OpenCode path, unified attachment preprocessing |

---

### 🔜 v1.0.0 — First Stable Release

**Goal**: Production-ready stable release after extensive testing and refinement.

| Focus Area | Description |
|:-----------|:------------|
| Stability & Reliability | Comprehensive error handling, graceful degradation |
| Performance Optimization | Connection pooling, caching, memory optimization |
| Documentation | Complete API docs, deployment guides, troubleshooting |
| Testing | High test coverage, integration tests, E2E validation |
