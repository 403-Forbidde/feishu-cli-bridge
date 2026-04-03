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

**状态**：✅ 已完成（2026-04-03）

**目标**：确认本地 `claude` CLI 的 `stream-json` 输出格式和子进程可控性。

**任务清单**：

| 任务 | 状态 | 关键发现 |
|------|------|----------|
| 1. 环境检查 | ✅ | Claude Code v2.1.91 可用，API key 已配置 |
| 2. 基础 headless 调用 | ✅ | `--verbose` 是 `--output-format stream-json` 的必需参数 |
| 3. 会话连续性验证 | ✅ | `--session-id` + `--resume <id> --fork-session` 实现多轮对话 |
| 4. 停止信号验证 | ✅ | `SIGINT` 可优雅终止，返回 `aborted_streaming` 状态 |
| 5. Token usage 验证 | ✅ | `message_delta` 和 `result.modelUsage` 包含精确 usage 数据 |
| 6. 文件引用验证 | ✅ | `@/path/to/file` 语法原生支持 |

**重要发现**：
- 实际使用的模型可能因 `ANTHROPIC_BASE_URL` 配置而不同（如使用 Kimi API 时返回 `kimi-k2.5`）
- `default_model` 和 `context_window` 应支持 `auto` 模式，从 `result.modelUsage` 动态读取

**交付物**：

- ✅ `doc/claude-stream-format.md` - 完整的 stream-json 事件格式说明文档
- ✅ Token 统计采用**精确模式**（从 `message_delta` 和 `result.modelUsage` 提取）

---

### 阶段 1：核心适配器实现（3-4 天）

**目标**：完成 `ClaudeCodeAdapter` 的 `executeStream` 基础流式对话能力。

#### 1.1 创建内部类型与配置

**状态**：✅ 已完成（2026-04-03）

**文件**：`src/adapters/claude/types.ts`, `src/adapters/claude/index.ts`

**实现摘要**：
- 定义了完整的 `ClaudeConfig` 接口，支持 `auto` 模式动态检测模型
- 定义了 `DetectedModelInfo` 接口用于缓存从 `result.modelUsage` 提取的模型信息
- 定义了所有 Stream JSON 事件类型（基于 `doc/claude-stream-format.md`）
  - 系统事件：`SystemInitEvent`
  - 消息事件：`MessageStartEvent`, `MessageDeltaEvent`, `MessageStopEvent`
  - 内容事件：`ContentBlockDeltaEvent`, `TextDelta`, `ThinkingDelta`
  - 结果事件：`SuccessResultEvent`, `ErrorResultEvent`, `UserInterruptEvent`
- 定义了会话、流状态、子进程管理相关类型
- 创建了模块导出文件 `index.ts`

**关键类型预览**：
```typescript
export interface ClaudeConfig {
  command: string;
  defaultModel: string | 'auto';  // 'auto' 表示动态检测
  contextWindow: number | 'auto';
  timeout: number;
  permissionMode: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
  allowedTools: string[];
  baseDir: string;
}

export interface DetectedModelInfo {
  modelId: string;          // e.g., "kimi-k2.5"
  contextWindow: number;
  maxOutputTokens: number;
  inputTokens?: number;
  outputTokens?: number;
  costUSD?: number;
}
```

#### 1.2 子进程管理器

**状态**：✅ 已完成（2026-04-03）

**文件**：`src/adapters/claude/process-manager.ts`

**实现摘要**：
- 实现了 `ClaudeCodeProcessManager` 类，管理子进程完整生命周期
- 支持 `start()` 启动进程，可选择是否为新会话（`isNewSession` 参数）
- 正确处理新会话 vs 继续会话的参数差异：
  - 新会话：`--session-id <uuid>`
  - 继续会话：`--session-id <uuid> --continue --fork-session`
- 实现了 `sendStopSignal()` 发送 SIGINT 优雅停止生成
- 实现了 `stop()` 方法，先尝试 SIGINT，超时后使用 SIGKILL
- 支持通过事件处理器处理 stdout/stderr/exit/error 事件
- 自动查找 `claude` 可执行文件（支持 Windows/Unix）
- 完整的错误处理和日志记录

**关键方法**：
```typescript
class ClaudeCodeProcessManager {
  async start(prompt, sessionId, workingDir, handlers, isNewSession): Promise<boolean>
  async sendStopSignal(): Promise<boolean>  // SIGINT 停止生成
  async stop(timeoutMs): Promise<ProcessResult>
  getIsRunning(): boolean
  getPid(): number | null
  getStderrBuffer(): string
}
```

**测试验证**：
- ✓ 进程成功启动（PID 正确获取）
- ✓ 成功接收 stdout JSON Lines 输出
- ✓ SIGINT 信号成功发送并正确响应
- ✓ 进程正常退出（exit code=0）

#### 1.3 流式解析器

**状态**：✅ 已完成（2026-04-03）

**文件**：`src/adapters/claude/stream-parser.ts`, `src/adapters/claude/stream-parser.test.ts`

**实现摘要**：

- 实现了 `ClaudeCodeStreamParser` 类，解析 stream-json 格式
- **事件映射**：
  - `content_block_delta` + `text_delta` → `StreamChunkType.CONTENT`
  - `content_block_delta` + `thinking_delta` → `StreamChunkType.REASONING`
  - `message_delta` 中的 `usage` → `StreamChunkType.STATS`
  - `result` (success) → `StreamChunkType.DONE`
  - `result` (error) → `StreamChunkType.ERROR`
- 实现了 `createClaudeProcessStream` 函数，提供异步迭代器接口
- 支持从 `result.modelUsage` 动态检测模型信息
- 完整的单元测试覆盖（24 个测试用例全部通过）

**关键方法**：
```typescript
class ClaudeCodeStreamParser {
  parseLine(line: string): StreamChunk | null
  createDeliverChunk(): StreamChunk | null
  createErrorChunk(message: string): StreamChunk
  getDetectedModel(): DetectedModelInfo | undefined
  getCurrentStats(): Partial<TokenStats> | undefined
}

function createClaudeProcessStream(
  processManager: ProcessManager,
  parser: ClaudeCodeStreamParser,
  options?: { checkIntervalMs?: number; timeoutMs?: number }
): AsyncIterable<StreamChunk>
```

#### 1.4 适配器主类

**状态**：✅ 已完成（2026-04-03）

**文件**：`src/adapters/claude/adapter.ts`

**实现摘要**：

- 实现了 `ClaudeCodeAdapter` 类，继承自 `BaseCLIAdapter`
- `name = 'claude'`
- `defaultModel`: 支持动态检测（从 `result.modelUsage` 读取），缓存后返回
- `contextWindow`: 支持动态检测，默认 200000
- `executeStream()`：
  - 组装 prompt（含上下文和附件引用）
  - 通过 `ClaudeCodeProcessManager` 启动子进程
  - 使用 `ClaudeCodeStreamParser` 解析 JSON Lines 流
  - yield `StreamChunk` 给上层
- **模型信息动态获取**：
  - 首次执行后，从 `result.modelUsage` 中提取实际的模型信息
  - 缓存 `modelId`、`contextWindow`、`maxOutputTokens` 供后续使用
  - 支持第三方 Provider（如 Kimi），模型名可能不是标准 Claude 模型
- **上下文传递**：将 `context: Message[]` 拼接成单一 prompt 文本：
  ```text
  以下是历史对话上下文：
  [用户] msg1
  [助手] reply1
  [用户] current prompt
  ```
- **附件处理**：将附件写入临时目录，通过 `@filepath` 语法嵌入 prompt
- **停止生成**：`stopGeneration()` 发送 SIGINT 信号
- **会话管理**：集成 `ClaudeCodeSessionManager`，支持 create/list/switch/reset/delete

**关键方法**：
```typescript
class ClaudeCodeAdapter extends BaseCLIAdapter {
  async *executeStream(prompt, context, workingDir, attachments): AsyncIterable<StreamChunk>
  async stopGeneration(): Promise<boolean>  // SIGINT 停止生成
  async createNewSession(workingDir?): Promise<SessionInfo | null>
  async listSessions(limit?): Promise<SessionInfo[]>
  async switchSession(sessionId, workingDir?): Promise<boolean>
  getStats(context, completionText): TokenStats
  getDetectedModel(): DetectedModelInfo | null
}
```

**交付物**：

- ✅ `src/adapters/claude/adapter.ts` 完整代码
- ✅ 单元测试覆盖 `stream-parser.ts`（24 个测试用例全部通过）

---

### 阶段 2：会话管理与高级能力（2-3 天）

#### 2.1 会话管理器

**状态**：✅ 已完成（2026-04-03）

**文件**：`src/adapters/claude/session-manager.ts`

Claude Code 的会话由 CLI 自身持久化，适配器需要做的是：

- 为每个 `workingDir` 维护一个 UUID 作为 `--session-id`。
- 将映射关系持久化到本地 JSON 文件（如 `.claude-sessions.json`），避免 bridge 重启后丢失会话上下文。
- 提供 `getOrCreateSessionId(workingDir): string`。
- `/new`：生成新 UUID，覆盖旧映射。
- `/session` + args：通过解析 `~/.claude/sessions/*.json` 验证会话是否真实存在；若不存在则自动清理失效映射。

**实现摘要**：
- `ClaudeCodeSessionManager` 完整实现了会话生命周期管理（create/list/switch/reset/rename/delete）
- `switchSession()` 集成本地存储验证，无效会话会被清理
- `process-manager.ts` 支持 `--resume <sessionId>` 参数，恢复指定会话
- 持久化文件使用版本号管理，支持向前兼容

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

**状态**：✅ 已完成（2026-04-03）

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
    # 支持 'auto' 让适配器从流输出中动态检测实际使用的模型
    # 当使用第三方 Provider（如 Kimi）时，此项必须设为 'auto' 或对应模型名
    default_model: auto  # auto | claude-sonnet-4-6 | claude-opus-4-6 | kimi-k2.5
    context_window: auto # auto | 200000 | 256000
    timeout: 300
    permission_mode: acceptEdits
    allowed_tools: ["Bash","Read","Edit","Grep"]
```

**关于 `default_model: auto` 的说明：**
- 当设为 `auto` 时，适配器会从首次请求的 `result.modelUsage` 中自动提取实际使用的模型信息
- 这在使用第三方 Provider（如 Kimi、OpenRouter）时是必需的
- 使用原生 Anthropic API 时，也可显式指定模型名如 `claude-sonnet-4-6`

在 `loadFromEnv()` 中补充环境变量：

- `CLAUDE_ENABLED`, `CLAUDE_CMD`, `CLAUDE_MODEL`, `CLAUDE_CONTEXT_WINDOW`
- `CLAUDE_PERMISSION_MODE`, `CLAUDE_ALLOWED_TOOLS`, `CLAUDE_TIMEOUT`

**实现摘要**：
- 扩展 `CLIConfig` 类型，添加 `contextWindow`, `permissionMode`, `allowedTools` 等可选字段
- 更新 `parseCLIConfig` 函数，支持解析 Claude 特有配置
- 在环境变量加载中添加完整的 Claude 配置支持

#### 3.2 工厂注册

**状态**：✅ 已完成（2026-04-03）

**文件**：`src/adapters/index.ts`

```typescript
import { ClaudeCodeAdapter } from './claude/adapter.js';
registerAdapter('claude', ClaudeCodeAdapter);
```

**实现摘要**：
- 修改 `adapters/index.ts`，单独导出 `OpenCodeAdapter` 和 `ClaudeCodeAdapter`（避免类型冲突）
- 成功注册 Claude Code 适配器

#### 3.3 设置向导（Setup Wizard）扩展

**状态**：✅ 已完成（2026-04-03）

**文件**：`src/setup/cli-provider/providers/claude.ts`（新建）

- 检测 `claude` 命令是否存在于 PATH
- 检测 `ANTHROPIC_API_KEY` 环境变量配置
- 提供模型选择（`auto`, `claude-sonnet-4-6`, `claude-opus-4-6`, `kimi-k2.5`）

**文件**：`src/setup/wizard/cli-setup.ts`

将 `claude` 作为可选 CLI 工具加入安装检测流程。支持同时配置多个 CLI 工具（如 OpenCode 和 Claude Code）。

**实现摘要**：
- 创建 `ClaudeCodeProvider` 类实现 `ICLIProvider` 接口
- 更新 CLI Setup 向导支持多 CLI 工具检测和配置
- 修改配置生成逻辑，支持生成包含多个 CLI 工具的配置文件

#### 3.4 TUI 命令兼容性

**状态**：🔄 待定（不属于 3.1 配置系统扩展范围）

**文件**：`src/platform/message-processor/command-processor.ts`

当前 `/mode` 命令对 `opencodeAdapter` 做了硬类型断言 (`as unknown as { listAgents... }`)。

- 短期：`/mode` 命令需判断当前适配器类型，若为 `claude`，则返回提示"Claude Code 暂不支持 Agent 模式切换"（或隐藏该命令）。
- 长期：可考虑将 `listAgents`/`switchAgent` 提升为 `ICLIAdapter` 可选方法（不在本次范围内）。

**交付物**：

- ✅ `config.yaml` 支持 `claude` 段
- ✅ `feishu-bridge-setup` 向导支持检测和配置 Claude Code
- ✅ 环境变量支持完整的 Claude 配置

---

### 阶段 4：测试、文档与上线（2 天）

#### 4.1 单元测试

**状态**：✅ 已完成（2026-04-03）

- **`stream-parser.test.ts`**：28 个测试用例全部通过
  - 测试 `content_block_delta` → `CONTENT` / `REASONING`
  - 测试 `message_delta` → `STATS`
  - 测试 `message_stop` + `result` → `DONE`
  - 测试 malformed JSON 的容错
  - 测试子进程 `stderr` 输出捕获与 `ERROR` 转换
  - 测试流式超时处理（timeout → `ERROR`）
- **`process-manager.test.ts`**：15 个测试用例全部通过（新建）
  - Mock `child_process.spawn`，验证参数构建正确性（`--bare`, `--session-id`, `--allowed-tools`, `--permission-mode` 等）
  - 验证新会话 vs 继续会话参数差异（`--continue --fork-session` / `--resume`）
  - 验证 `sendStopSignal()` SIGINT 行为
  - 验证 `stop()` SIGINT → SIGKILL 升级策略
  - 验证 Windows `.cmd` 文件的 `shell: true` 处理
  - 验证 stderr 捕获与 getter 行为
- **`adapter.test.ts`**：18 个测试用例全部通过（新建）
  - 验证 `executeStream` AsyncIterable 正常产出 `CONTENT` 和 `DONE`
  - 验证启动失败时产出 `ERROR`
  - 验证 `stopGeneration()` 中断流式生成
  - 验证附件 `@filepath` 语法嵌入 prompt
  - 验证上下文消息拼接格式
  - 验证会话 CRUD 操作正确透传
  - 验证动态模型检测后 `listModels()` 标记当前模型
  - 验证 `getStats()` 在流消费后返回精确 Token 统计
- **Bug 修复**：`adapter.ts` 中将 `buildFullPrompt` 调整至 `prepareAttachments` 之后，确保附件 `@path` 正确嵌入 prompt

#### 4.2 集成测试（manual）

**状态**：✅ 已完成（2026-04-03）

在真实环境中执行以下场景：

1. ✅ 发送普通消息，确认流式卡片正常更新。
2. ✅ 发送 `@` 引用图片，确认附件处理正常。
3. ✅ 发送长文本，验证上下文不丢失。
4. ✅ 在生成过程中发送 `/stop`，确认子进程被终止。
5. ✅ 使用 `/new` 后再次对话，确认开启了新会话。
6. ✅ 切换项目后对话，确认工作目录变化生效。

**重要修复**：会话持久化问题已解决
- **问题**：`session-manager.ts` 中 `validateSessionExists()` 和 `syncWithCLISessions()` 方法过于严格，导致 headless 模式下会话映射被错误清理
- **解决**：见 `doc/issues/001-claude-session-not-persisting.md`
- **结果**：会话现在在 headless 和非 headless 模式下都能正确持久化

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
