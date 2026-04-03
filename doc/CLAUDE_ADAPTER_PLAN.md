# Claude Code 适配器对接工作计划

> 制定时间：2026-04-03
> 基于项目版本：v0.2.1（TypeScript 重构完成版）

---

## 一、核心差异与技术选型

| 能力 | OpenCode (现状) | Claude Code (目标) |
| :--- | :--- | :--- |
| **通信方式** | HTTP Client + SSE | `child_process.spawn` + JSON Lines |
| **会话管理** | HTTP API (`/session`) | CLI 原生 (`--session-id`, `--resume`, `--continue`) |
| **停止生成** | HTTP API (`/stop`) | 子进程 `SIGKILL` / `SIGINT` |
| **流式输出** | 自定义 SSE | `--output-format stream-json --include-partial-messages` |
| **Token 统计** | SSE `step-finish` 精确返回 | 从 `message_delta` 中提取或估算 |
| **附件/图片** | Base64 HTTP 请求 | 写入临时文件，通过 `@filepath` 在 prompt 中引用 |
| **权限控制** | 服务端控制 | CLI `--allowedTools` / `--permission-mode` |

### 官方文档参考

- [Run Claude Code programmatically (Headless)](https://code.claude.com/docs/en/headless)
- [CLI Reference](https://code.claude.com/docs/en/cli-reference)
- [Stream responses in real-time (Agent SDK)](https://platform.claude.com/docs/en/agent-sdk/streaming-output)

---

## 二、总体架构设计

新增 `src/adapters/claude/` 目录，结构与 OpenCode 适配器对称：

```
src/adapters/
├── claude/                    # 新增
│   ├── index.ts               # 模块统一出口
│   ├── adapter.ts             # ClaudeCodeAdapter（核心）
│   ├── process-manager.ts     # 子进程生命周期管理
│   ├── stream-parser.ts       # stream-json 解析器
│   ├── session-manager.ts     # 会话 ID 映射/持久化
│   └── types.ts               # 内部类型定义
```

### 关键组件职责

1. **`ClaudeCodeProcessManager`**：负责 `spawn` 子进程、环境变量注入、超时控制、信号处理。
2. **`ClaudeCodeStreamParser`**：逐行读取 `stdout`，将 JSON Lines (`content_block_delta`, `message_delta`, `tool_use` 等) 转换为项目标准的 `StreamChunk`。
3. **`ClaudeCodeSessionManager`**：维护 `workingDir -> sessionId` 的映射。因为 Claude Code 的会话是 CLI 自管理的，适配器只需生成并传递 `--session-id`。
4. **`ClaudeCodeAdapter`**：实现 `BaseCLIAdapter` 接口。

---

## 三、分阶段实施计划

### 阶段 0：技术验证与 PoC（1-2 天）

**目标**：确认本地 `claude` CLI 的 `stream-json` 输出格式和子进程可控性。

**任务清单**：

1. **环境检查**：确认运行环境中 `claude` 命令可用，验证 `claude -v`。
2. **基础 headless 调用**：
   ```bash
   claude -p "hello" --output-format stream-json --include-partial-messages --verbose
   ```
   观察标准输出中的事件类型（`message_start`, `content_block_delta`, `message_delta`, `message_stop` 等）。
3. **会话连续性验证**：
   ```bash
   # 第一次
   claude -p "first msg" --output-format json --session-id "550e8400-e29b-41d4-a716-446655440000"
   # 第二次
   claude -p "follow up" --output-format json --session-id "550e8400-e29b-41d4-a716-446655440000" --continue
   ```
4. **停止信号验证**：在流式输出过程中对子进程发送 `SIGINT`/`SIGTERM`，观察是否能优雅终止。
5. **Token usage 验证**：检查 `stream-json` 的 `message_delta` 或 `message_stop` 事件中是否包含 `usage` 字段。如果不包含，确认 `--output-format json` 非流式结果中的 usage 结构。
6. **文件引用验证**：测试通过 `@/path/to/image.png` 在 prompt 中引用本地文件/图片是否被正确识别。

**交付物**：

- 一份 `stream-json` 事件格式说明文档（可写入 `doc/claude-stream-format.md`）。
- 确定 Token 统计提取方案（精确 vs 估算）。

---

### 阶段 1：核心适配器实现（3-4 天）

**目标**：完成 `ClaudeCodeAdapter` 的 `executeStream` 基础流式对话能力。

#### 1.1 创建内部类型与配置

**文件**：`src/adapters/claude/types.ts`

```typescript
export interface ClaudeConfig {
  command: string;              // 'claude'
  defaultModel: string;         // 'claude-sonnet-4-6'
  timeout: number;
  permissionMode: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
  allowedTools: string[];       // e.g. ['Bash','Read','Edit']
  baseDir: string;              // 临时文件存放目录
}

export interface ClaudeStreamEvent {
  type: string;                 // "stream_event" | "system" | ...
  event?: {
    type: string;               // "content_block_delta" | "message_delta" | ...
    delta?: { type: string; text?: string; partial_json?: string };
    usage?: { input_tokens: number; output_tokens: number };
  };
  // ... 其他字段
}
```

#### 1.2 子进程管理器

**文件**：`src/adapters/claude/process-manager.ts`

职责：

- 根据配置构建 `spawn` 参数数组。
- 注入环境变量（如 `ANTHROPIC_API_KEY`）。
- 处理子进程 `stdout`/`stderr`/`error`/`exit` 事件。
- 暴露 `kill()` 方法用于 `/stop`。

**构建的命令示例**：

```typescript
const args = [
  '-p', prompt,
  '--output-format', 'stream-json',
  '--include-partial-messages',
  '--verbose',
  '--session-id', sessionId,
  '--continue',
  '--model', config.defaultModel,
  `--permission-mode`, config.permissionMode,
  ...(config.allowedTools.length ? ['--allowed-tools', config.allowedTools.join(',')] : []),
  '--bare', // 加速启动，避免自动加载 hooks/mcp
];
```

#### 1.3 流式解析器

**文件**：`src/adapters/claude/stream-parser.ts`

职责：

- 将 `stdout` 的 `data` 缓冲区按 `\n` 分割。
- 解析每行 JSON，过滤出有效事件。
- **事件映射**：
  - `content_block_delta` + `delta.type === 'text_delta'` → `StreamChunkType.CONTENT`
  - 思考内容（若 future 版本支持 `thinking_delta`）→ `StreamChunkType.REASONING`
  - `message_delta` 中的 `usage` → 缓存到适配器，不直接 yield（类似 OpenCode 的 `STATS` 处理）
  - `message_stop` / `ResultMessage` → `StreamChunkType.DONE`
  - 解析错误或子进程崩溃 → `StreamChunkType.ERROR`
- 最后 yield `DELIVER` chunk（完整累积文本）。

#### 1.4 适配器主类

**文件**：`src/adapters/claude/adapter.ts`

实现 `BaseCLIAdapter`：

- `name = 'claude'`
- `defaultModel` 从配置读取
- `contextWindow = 200000`（Sonnet/Opus 默认值，可后续细化）
- `executeStream()`：组装 prompt（含上下文和附件引用），启动子进程，调用解析器，yield chunks。
- **上下文传递**：Claude Code CLI 的 `-p` 模式不支持直接传入历史消息数组。需将 `context: Message[]` 拼接成单一 prompt 文本，或在系统提示中注入。推荐方式：
  ```text
  [system] 以下是历史对话摘要...
  [user] msg1
  [assistant] reply1
  [user] current prompt
  ```
- **附件处理**：将 `Attachment` 下载后的文件，通过 `@filepath` 直接嵌入 prompt（Claude Code 原生支持 `@` 语法）。

**交付物**：

- `src/adapters/claude/` 目录完整代码
- 单元测试覆盖 `stream-parser.ts`

---

### 阶段 2：会话管理与高级能力（2-3 天）

#### 2.1 会话管理器

**文件**：`src/adapters/claude/session-manager.ts`

Claude Code 的会话由 CLI 自身持久化，适配器需要做的是：

- 为每个 `workingDir` 维护一个 UUID 作为 `--session-id`。
- 将映射关系持久化到本地 JSON 文件（如 `.claude-sessions.json`），避免 bridge 重启后丢失会话上下文。
- 提供 `getOrCreateSessionId(workingDir): string`。
- `/new`：生成新 UUID，覆盖旧映射。
- `/session` + args：通过 `--resume <id>` 验证会话是否存在（可通过执行一个空 prompt 或解析本地 `.claude/` 目录结构验证）。

#### 2.2 停止生成

**文件**：修改 `src/adapters/claude/process-manager.ts`

- `AIProcessor.stop()` 调用 `adapter.stopGeneration()`。
- `ClaudeCodeAdapter.stopGeneration()` 调用 `processManager.kill('SIGINT')`。
- 若 `SIGINT` 无效，降级为 `SIGKILL`。
- 子进程被杀后，解析器应正确收尾，yield `DONE`。

#### 2.3 Token 统计

- **精确模式**：若验证阶段确认 `stream-json` 的 `message_delta` 包含 `usage`，则在解析器中捕获并缓存。
- **估算模式**：若流式无精确 usage，在 `getStats()` 中回退到字符估算（复用 OpenCode 的估算逻辑或调用 tiktoken 库）。

**交付物**：

- `/stop` 命令对 Claude 适配器生效
- `/new`, `/session`, `/reset` 正常工作

---

### 阶段 3：配置集成与设置向导（2 天）

#### 3.1 配置系统扩展

**文件**：`src/core/config.ts` 及 `src/core/types/config.ts`

在 `cli` 配置段中新增 `claude`：

```yaml
cli:
  opencode:
    enabled: true
    command: opencode
    default_model: kimi-for-coding/k2p5
  claude:
    enabled: true
    command: claude
    default_model: claude-sonnet-4-6
    timeout: 300
    permission_mode: acceptEdits
    allowed_tools: ["Bash","Read","Edit","Grep"]
```

在 `loadFromEnv()` 中补充环境变量：

- `CLAUDE_ENABLED`, `CLAUDE_CMD`, `CLAUDE_MODEL`, `CLAUDE_PERMISSION_MODE`, `CLAUDE_ALLOWED_TOOLS`

#### 3.2 工厂注册

**文件**：`src/adapters/index.ts`

```typescript
import { ClaudeCodeAdapter } from './claude/adapter.js';
registerAdapter('claude', ClaudeCodeAdapter);
```

#### 3.3 设置向导（Setup Wizard）扩展

**文件**：`src/setup/cli-provider/providers/claude.ts`（新建）

- 检测 `claude` 命令是否存在于 PATH。
- 检测 `ANTHROPIC_API_KEY` 是否配置。
- 提供模型选择（`claude-sonnet-4-6`, `claude-opus-4-6`）。

**文件**：修改 `src/setup/wizard/cli-setup.ts`

将 `claude` 作为可选 CLI 工具加入安装检测流程。

#### 3.4 TUI 命令兼容性

**文件**：`src/platform/message-processor/command-processor.ts`

当前 `/mode` 命令对 `opencodeAdapter` 做了硬类型断言 (`as unknown as { listAgents... }`)。

- 短期：`/mode` 命令需判断当前适配器类型，若为 `claude`，则返回提示"Claude Code 暂不支持 Agent 模式切换"（或隐藏该命令）。
- 长期：可考虑将 `listAgents`/`switchAgent` 提升为 `ICLIAdapter` 可选方法（不在本次范围内）。

**交付物**：

- `config.yaml` 支持 `claude` 段
- `feishu-bridge-setup` 向导支持检测和配置 Claude Code

---

### 阶段 4：测试、文档与上线（2 天）

#### 4.1 单元测试

- **`stream-parser.test.ts`**：
  - 测试 `content_block_delta` → `CONTENT`
  - 测试 `message_stop` → `DONE`
  - 测试 malformed JSON 的容错
  - 测试子进程 `stderr` 输出捕获与 `ERROR` 转换
- **`process-manager.test.ts`**：
  - Mock `child_process.spawn`，验证参数构建正确性（`--bare`, `--session-id`, `--allowed-tools` 等）。
  - 验证 `kill()` 行为。
- **`adapter.test.ts`**：
  - 验证 `executeStream` AsyncIterable 正常产出。

#### 4.2 集成测试（manual）

在真实环境中执行以下场景：

1. 发送普通消息，确认流式卡片正常更新。
2. 发送 `@` 引用图片，确认附件处理正常。
3. 发送长文本，验证上下文不丢失。
4. 在生成过程中发送 `/stop`，确认子进程被终止。
5. 使用 `/new` 后再次对话，确认开启了新会话。
6. 切换项目后对话，确认工作目录变化生效。

#### 4.3 文档更新

- **`CLAUDE.md`**：在 "Future: Adding a New CLI Adapter" 附近补充 `claude` 适配器的概要说明。
- **`README.md`**：更新支持的 CLI 工具列表（OpenCode + Claude Code）。
- **`doc/CHANGELOG.md`**：记录新增 Claude Code 适配器。

---

## 四、风险与兼容性考虑

1. **Claude Code CLI 版本差异**
   `-p` 和 `--output-format stream-json` 是较新的功能，要求用户安装较新版本的 `claude`（建议 >= 0.2.x，视实际验证而定）。在设置向导中应加入版本检查。

2. **会话持久化安全**
   Claude Code 的会话数据存储在用户本地的 `~/.claude/` 或工作目录的 `.claude/` 中。适配器生成的 `session-id` 映射文件不应暴露敏感信息，可存储在项目配置的 `storagePath` 下。

3. **并发子进程**
   当前 `AIProcessor` 使用单例 `AbortController`。若同一用户在多条消息中触发多个请求，需要确保 `ClaudeCodeAdapter` 能管理**每个执行的子进程实例**，避免 kill 错进程。建议 `executeStream` 中将当前子进程引用存入实例数组，`stopGeneration` 只 kill 最新的活跃进程。

4. **Token 用量不可精确获取**
   如果 `stream-json` 最终确认不包含精确 token usage，建议在最终卡片中同时显示"估算值"和"（估算）"提示，避免用户误解。

5. **附件大小限制**
   Claude API 对图片/文件有大小限制（通常 5MB/32MB）。适配器应将文件写入临时目录前检查 `config.security.maxAttachmentSize`。

---

## 五、执行顺序总览（建议）

| 天数 | 重点工作 |
| :--- | :--- |
| **D1** | 阶段 0 技术验证：本地测试 `stream-json` 输出格式、会话连续性、停止信号、Token usage |
| **D2-D3** | 阶段 1：`types.ts`, `process-manager.ts`, `stream-parser.ts`, `adapter.ts` 核心编码 |
| **D4** | 阶段 1 收尾：单元测试，`executeStream` 跑通；处理附件 `@` 引用逻辑 |
| **D5-D6** | 阶段 2：会话管理器（UUID 映射持久化）、`/stop`/ `/new`/ `/session` 命令联调 |
| **D7** | 阶段 3：配置扩展（`config.ts`, `types/config.ts`）、工厂注册、设置向导扩展 |
| **D8** | 阶段 4：集成测试、文档更新、`README.md` 调整、Bug 修复 |
