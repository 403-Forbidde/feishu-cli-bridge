# Feishu CLI Bridge Node.js 迁移详细计划

## 目录

1. [执行摘要](#1-执行摘要)
2. [前置条件](#2-前置条件)
3. [详细任务分解](#3-详细任务分解)
4. [文件映射清单](#4-文件映射清单)
5. [代码迁移示例](#5-代码迁移示例)
6. [测试策略](#6-测试策略)
7. [风险缓解](#7-风险缓解)
8. [验收标准](#8-验收标准)

---

## 1. 执行摘要

### 1.1 项目信息

| 项目 | 内容 |
|------|------|
| 项目名称 | Feishu CLI Bridge Node.js 迁移 |
| 源技术栈 | Python 3.9+ |
| 目标技术栈 | Node.js 20+ / TypeScript 5+ |
| 预计工期 | 4 周（20 个工作日）|
| 负责人 | [待指定] |
| 代码仓库 | http://10.10.10.253:3000/error403/feishu-cli-bridge (node 分支) |

### 1.2 里程碑

```
Week 1 (Day 1-5):   基础设施 + 核心框架  → 可编译运行
Week 2 (Day 6-10):  业务逻辑 + 流式系统  → 核心功能可用
Week 3 (Day 11-13): 适配器 + 集成       → 端到端可用
Week 4 (Day 14-18): 测试 + 优化         → 生产就绪
```

---

## 2. 前置条件

### 2.1 环境准备

- [x] Node.js 20+ 安装
- [x] 内网 npm registry 配置
- [x] Git 分支 `node` 创建
- [x] TypeScript 编译环境验证
- [x] 飞书测试应用配置

### 2.2 知识准备

| 知识点 | 要求 | 学习资源 | 状态 |
|--------|------|----------|------|
| TypeScript 类型系统 | 必须 | Handbook | ✅ 已完成 - 见 doc/KNOWLEDGE_PREP.md |
| async/await 模式 | 必须 | MDN | ✅ 已完成 - 见 doc/KNOWLEDGE_PREP.md |
| @larksuiteoapi/node-sdk | 必须 | 官方文档 | ✅ 已完成 - 见 doc/KNOWLEDGE_PREP.md |
| 状态机设计 | 推荐 | XState 文档 | ✅ 已完成 - 见 doc/KNOWLEDGE_PREP.md |

---

## 3. 详细任务分解

### Week 1: 基础设施与核心框架

#### Day 1: 项目初始化

**任务 1.1: 创建项目结构**

```bash
# 目录创建清单
mkdir -p src/{feishu,adapters,session,project,tui-commands,utils,card-builder}
mkdir -p tests/{unit,integration}
mkdir -p scripts
```

**任务 1.2: 初始化 package.json**

```json
{
  "name": "feishu-cli-bridge",
  "version": "2.0.0",
  "type": "module",
  "engines": {
    "node": ">=20.0.0"
  },
  "scripts": {
    "dev": "tsx src/main.ts",
    "build": "tsc",
    "start": "node dist/main.js",
    "test": "vitest",
    "lint": "eslint src/",
    "typecheck": "tsc --noEmit"
  }
}
```

**任务 1.3: TypeScript 配置**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**验收标准:**
- [ ] `npm install` 成功
- [ ] `npm run typecheck` 通过
- [ ] `npm run dev` 能启动（空程序）

---

#### Day 2: 配置模块 (config.py → config.ts)

**任务 2.1: 类型定义**

```typescript
// src/types/config.ts
export interface FeishuConfig {
  appId: string;
  appSecret: string;
  encryptKey?: string;
  verificationToken?: string;
}

export interface SessionConfig {
  maxSessions: number;
  maxHistory: number;
}

export interface CLIConfig {
  enabled: boolean;
  command: string;
  defaultModel: string;
  timeout: number;
  models: Array<{ id: string; name: string } | string>;
}

export interface StreamingConfig {
  updateInterval: number;
  minChunkSize: number;
  maxMessageLength: number;
}

export interface DebugConfig {
  logLevel: string;
  saveLogs: boolean;
  logDir: string;
}

export interface ProjectConfig {
  storagePath: string;
  maxProjects: number;
}

export interface Config {
  feishu: FeishuConfig;
  session: SessionConfig;
  cli: Record<string, CLIConfig>;
  streaming: StreamingConfig;
  debug: DebugConfig;
  project: ProjectConfig;
}
```

**任务 2.2: 配置加载实现**

**迁移要点:**
- Python `yaml.safe_load` → Node.js `js-yaml.load`
- Python `os.environ.get` → Node.js `process.env`
- Python `Path` → Node.js `path` 模块

**验收标准:**
- [ ] 从 YAML 文件加载配置
- [ ] 环境变量覆盖
- [ ] 路径解析正确（相对路径基于配置文件目录）

---

#### Day 3: 飞书客户端封装

**任务 3.1: 类型定义**

```typescript
// src/feishu/types.ts
export interface FeishuMessage {
  messageId: string;
  chatId: string;
  chatType: 'p2p' | 'group';
  senderId: string;
  senderName: string;
  content: string;
  msgType: string;
  threadId?: string;
  mentionUsers: string[];
  parentId?: string;
  attachments?: Attachment[];
}

export interface Attachment {
  fileKey: string;
  resourceType: 'image' | 'file';
  filename: string;
  mimeType: string;
  path?: string;
}

export type MessageHandler = (eventData: unknown) => Promise<void>;
export type CardCallbackHandler = (eventData: unknown) => Promise<Record<string, unknown>>;
```

**任务 3.2: 客户端实现**

**关键差异:**
| Python | Node.js |
|--------|---------|
| `lark.Client` | `new lark.Client()` |
| `WSClient` | `new lark.WSClient()` |
| `asyncio.to_thread` | 直接使用 Promise |
| `threading.Thread` | Worker threads（如需要）|

**验收标准:**
- [ ] WebSocket 连接成功
- [ ] 能接收消息事件
- [ ] 事件正确分发到 Handler

---

#### Day 4: API 封装层

**任务 4.1: FeishuAPI 类设计**

```typescript
// src/feishu/api.ts
export class FeishuAPI {
  private client: lark.Client;
  private cardkitClient: CardKitClient; // 检查是否需要保留

  constructor(appId: string, appSecret: string) {
    this.client = new lark.Client({
      appId,
      appSecret,
      appType: lark.AppType.SelfBuild
    });
  }

  // 核心方法映射
  async sendText(chatId: string, content: string, replyTo?: string): Promise<MessageResult>;
  async sendCardMessage(chatId: string, card: unknown, replyTo?: string): Promise<string>;
  async sendCardByCardId(to: string, cardId: string, replyToMessageId?: string): Promise<Record<string, string>>;
  async updateCardMessage(messageId: string, card: unknown): Promise<boolean>;
  async addTypingReaction(messageId: string): Promise<string | null>;
  async removeTypingReaction(messageId: string, reactionId: string | null): Promise<void>;
  async downloadMessageResource(messageId: string, fileKey: string, resourceType: string, filename: string): Promise<string | null>;
}
```

**任务 4.2: 流式回复核心**

**重点:**
- Python `AsyncIterator` → TypeScript `AsyncIterable`
- 保持 `StreamChunk` 类型兼容

**验收标准:**
- [x] 能发送文本消息
- [x] 能发送卡片消息
- [x] 能下载文件
- [x] 能添加/移除表情回应
- [x] 能更新卡片消息
- [x] 能使用 CardKit 更新卡片内容

---

#### Day 5: 类型定义完善 + 代码审查

**任务 5.1: 核心类型定义**

```typescript
// src/types/stream.ts
export enum StreamChunkType {
  CONTENT = 'content',
  REASONING = 'reasoning',
  ERROR = 'error',
  DONE = 'done'
}

export interface StreamChunk {
  type: StreamChunkType;
  data: string;
}

export interface TokenStats {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  contextUsed: number;
  contextWindow: number;
  contextPercent: number;
}

// src/types/adapter.ts
export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
}

export abstract class BaseCLIAdapter {
  abstract readonly name: string;
  abstract readonly defaultModel: string;
  abstract executeStream(prompt: string, context: Message[], workingDir: string, attachments?: unknown[]): AsyncIterable<StreamChunk>;
  abstract getStats(history: Message[], fullContent: string): TokenStats;
  abstract getCurrentModel(): string;
}
```

**验收标准:**
- [x] 所有核心类型定义完成
- [x] 代码通过 TypeScript 编译
- [x] Week 1 代码审查通过

---

### Week 2: 业务逻辑与流式系统

#### Day 6: FlushController (节流控制器)

**任务 6.1: Python → TypeScript 迁移**

**Python 原代码结构:**
```python
class FlushController:
    def __init__(self, do_flush: Callable):
        self._do_flush = do_flush
        self._lock = asyncio.Lock()
        self._pending = False
        self._flush_event = asyncio.Event()
        self._flush_complete_event = asyncio.Event()
```

**TypeScript 目标实现:**
```typescript
// src/feishu/flush-controller.ts
import { Mutex } from 'async-mutex';
import { EventEmitter } from 'events';

export class FlushController {
  private mutex = new Mutex();
  private pending = false;
  private flushEvent = new EventEmitter();
  private flushCompleteEvent = new EventEmitter();

  constructor(private doFlush: () => Promise<void>) {}

  async throttledUpdate(throttleMs: number): Promise<void> {
    // 实现节流逻辑
  }

  async waitForFlush(): Promise<void> {
    // 等待刷新完成
  }

  cancelPendingFlush(): void {
    // 取消挂起的刷新
  }

  complete(): void {
    // 标记完成
  }
}
```

**关键点:**
- `asyncio.Lock` → `async-mutex` 的 `Mutex`
- `asyncio.Event` → Node.js `EventEmitter`
- 保持相同的节流算法（100ms CardKit / 1500ms IM Patch）

**验收标准:**
- [x] 节流逻辑正确
- [x] 互斥锁工作正常
- [x] 无竞态条件

**已完成:**
- 实现了 `FlushController` 类，位于 `src/platform/streaming/flush-controller.ts`
- 实现了节流控制（支持 CardKit 100ms / IM Patch 1500ms 模式）
- 实现了互斥锁防止并发刷新冲突
- 实现了长间隔检测（超过 2s 无更新时立即刷新）
- 编写了完整的单元测试（11 个测试用例）
- 类型检查通过

---

#### Day 7-8: StreamingCardController (状态机)

**任务 7.1: 状态机设计**

**状态转换图:**
```
         ┌─────────────┐
         │    idle     │
         └──────┬──────┘
                │ _ensure_card_created()
                ▼
         ┌─────────────┐     CardKit 失败
         │  creating   │────────────────┐
         └──────┬──────┘                │
                │ 创建成功               │
                ▼                        ▼
         ┌─────────────┐         ┌─────────────┐
    ┌────│  streaming  │◄────────│  IM Patch   │
    │    └──────┬──────┘ 降级    └─────────────┘
    │           │
    │    ┌──────┴──────┐
    │    │             │
    ▼    ▼             ▼
┌────────┐       ┌──────────┐
│completed│      │ aborted  │
└────────┘       └──────────┘
```

**任务 7.2: 核心方法实现**

```typescript
// src/feishu/streaming-controller.ts
export class StreamingCardController {
  private phase: Phase = 'idle';
  private cardKitState: CardKitState;
  private textState: TextState;
  private reasoningState: ReasoningState;
  private flushController: FlushController;

  // 公共方法
  async onContentStream(text: string): Promise<void>;
  async onReasoningStream(text: string): Promise<void>;
  async onComplete(statsProvider?: StatsProvider, model?: string): Promise<void>;
  async onError(error: string): Promise<void>;
  markFullyComplete(): void;

  // 内部方法
  private async ensureCardCreated(): Promise<void>;
  private async createCardTask(epoch: number): Promise<void>;
  private async performFlush(): Promise<void>;
  private async closeStreamingAndUpdate(cardId: string, card: unknown, label: string): Promise<void>;
}
```

**任务 7.3: CardKit SDK 集成**

```typescript
// 使用 SDK 替代直接 HTTP 调用
private async updateCardKitContent(cardId: string, elementId: string, content: string, sequence: number): Promise<void> {
  await this.client.cardkit.v1.card.batchUpdate({
    path: { card_id: cardId },
    data: {
      sequence,
      uuid: crypto.randomUUID(),
      actions: JSON.stringify([{
        action: 'update',
        target_element_id: elementId,
        content
      }])
    }
  });
}
```

**验收标准:**
- [x] 状态机转换正确
- [x] CardKit 流式更新工作
- [x] IM Patch 降级路径可用

**已完成:**
- 实现了 `StreamingCardController` 状态机，位于 `src/platform/streaming/controller.ts`
- 状态转换：idle → creating → streaming → completed/aborted
- 使用 `FlushController` 进行节流刷新控制
- 支持内容块和推理内容的流式更新
- 实现了完成、错误、停止等多种状态的卡片发送
- 创建了完整的卡片构建器模块 `src/platform/cards/`：
  - `streaming.ts` - 思考中/流式卡片
  - `complete.ts` - 完成结果卡片
  - `error.ts` - 错误卡片（含多种错误类型）
  - `session-cards.ts` - 会话管理卡片
  - `project-cards.ts` - 项目管理卡片
  - `utils.ts` - 共享工具函数
- 所有模块类型检查通过

---

#### Day 9: 消息处理器 (Handler)

**任务 9.1: MessageHandler 类**

```typescript
// src/feishu/handler.ts
export class MessageHandler {
  private adapters: Map<string, BaseCLIAdapter> = new Map();
  private dedup: MessageDeduplicator;
  private tuiRouter: TUIRouter;
  private commandRouter: CommandRouter;
  private cardHandler: CardCallbackHandler;

  // Issue #52: 停止控制
  private currentGenerationLock = new Mutex();
  private currentGenerationTask: Promise<void> | null = null;
  private stopEvent: EventEmitter | null = null;

  async handleMessage(eventData: unknown): Promise<void>;
  async handleCardCallback(eventData: unknown): Promise<Record<string, unknown>>;

  // 私有处理方法
  private async handleAIMessage(content: string, message: FeishuMessage, cliType: string): Promise<void>;
  private async handleTUICommand(content: string, message: FeishuMessage): Promise<void>;
  private async handleProjectCommand(content: string, message: FeishuMessage): Promise<void>;
  private async handleInteractiveReply(message: FeishuMessage): Promise<void>;
  private async handleStop(message: FeishuMessage): Promise<void>;
  private async handleReset(message: FeishuMessage): Promise<void>;
  private async handleHelp(message: FeishuMessage): Promise<void>;
}
```

**任务 9.2: 命令路由**

```typescript
// src/feishu/command-router.ts
export enum CommandType {
  AI_MESSAGE = 'ai_message',
  TUI_COMMAND = 'tui_command',
  PROJECT_COMMAND = 'project_command',
  INTERACTIVE_REPLY = 'interactive_reply',
  UNKNOWN = 'unknown'
}

export class CommandRouter {
  route(content: string, senderId: string, chatId: string, parentId?: string): { type: CommandType; extra: Record<string, unknown> };
}
```

**验收标准:**
- [x] 消息去重工作
- [x] 命令正确路由
- [x] 附件下载处理

**已完成:**
- 拆分了 Python 的 monolithic `MessageHandler` 为 4 个专注处理器：
  - `router.ts` - 消息路由（AI_MESSAGE, TUI_COMMAND, PROJECT_COMMAND, STOP_COMMAND, HELP_COMMAND）
  - `ai-processor.ts` - AI 流式消息处理，支持 AbortController 停止信号（Issue #52）
  - `command-processor.ts` - TUI 命令（/new, /session, /model, /reset, /rename, /delete）和项目命令（/pa, /pc, /pl, /ps, /pi, /pd）
  - `attachment-processor.ts` - 附件下载、base64 编码、临时文件管理
- 消息去重：基于 Set 的 messageId 去重，最大 1000 条
- 流式生成控制：支持用户主动停止（/stop 命令）
- 所有类型检查通过

---

#### Day 10: 卡片构建器 + TUI 命令

**任务 10.1: 卡片构建器**

```typescript
// src/card-builder/index.ts
export type CardType = 'streaming' | 'complete' | 'thinking' | 'error';

export interface CardData {
  text: string;
  reasoningText?: string;
  reasoningElapsedMs?: number;
  elapsedMs?: number;
  tokenStats?: TokenStats;
  model?: string;
  isError?: boolean;
}

export function buildCardContent(type: CardType, data: CardData): unknown;
export function optimizeMarkdownStyle(text: string): string;
```

**任务 10.2: TUI 命令系统**

**命令列表:**
| 命令 | 功能 |
|------|------|
| `/new` | 创建新会话 |
| `/session` | 列出/切换会话 |
| `/model` | 列出/切换模型 |
| `/reset` `/clear` | 重置会话 |
| `/stop` | 停止生成 |
| `/help` | 帮助信息 |
| `/pa` `/pc` `/pl` `/ps` `/pi` | 项目管理 |

**验收标准:**
- [x] 所有卡片类型构建正确
- [x] TUI 命令响应正确
- [x] 交互式回复跟踪工作

**已完成:**
- 卡片构建器模块 `src/card-builder/`：
  - `constants.ts` - 流式元素 ID 常量
  - `utils.ts` - Markdown 优化、emoji 分类、格式化工具
  - `base.ts` - 核心卡片构建（thinking/streaming/complete 状态）
  - `interactive-cards.ts` - 交互式卡片（模型选择、模式选择、帮助、重置成功）
  - `session-cards.ts` - 会话管理卡片（新建、列表、详情）
  - `project-cards.ts` - 项目管理卡片（列表、详情）
  - `index.ts` - 统一导出
- TUI 命令模块 `src/tui-commands/`：
  - `base.ts` - TUIResult 类型、TUIBaseCommand 抽象基类
  - `index.ts` - TUICommandRouter 路由
  - `opencode.ts` - OpenCodeTUICommands 实现（/new, /session, /model, /mode, /reset, /help）
  - `project.ts` - 项目命令处理（/pa, /pc, /pl, /ps, /prm, /pi）
- 类型检查全部通过

---

### Week 3: 适配器与集成

#### Day 11: OpenCode 适配器核心

**任务 11.1: 类型定义**

```typescript
// src/adapters/opencode/types.ts
export interface OpenCodeSession {
  id: string;
  title: string;
  createdAt: number;
  workingDir: string;
  slug: string;
}

export interface StreamState {
  seenAssistantMessage: boolean;
  userTextSkipped: boolean;
  emittedTextLength: number;
  promptHash?: number;
  currentStats?: TokenStats;
}
```

**任务 11.2: OpenCodeAdapter 实现**

```typescript
// src/adapters/opencode/adapter.ts
export class OpenCodeAdapter extends BaseCLIAdapter {
  readonly name = 'opencode';
  private serverManager: OpenCodeServerManager;
  private sessionManager: OpenCodeSessionManager;
  private httpClient: AxiosInstance;

  async executeStream(
    prompt: string,
    context: Message[],
    workingDir: string,
    attachments?: unknown[]
  ): AsyncIterable<StreamChunk>;

  async listSessions(limit?: number, directory?: string): Promise<OpenCodeSession[]>;
  async renameSession(sessionId: string, title: string): Promise<boolean>;
  async resetSession(): Promise<boolean>;
  getSessionId(workingDir: string): string | null;
  getCurrentModel(): string;
  getStats(history: Message[], fullContent: string): TokenStats;
}
```

**验收标准:**
- [x] HTTP 调用正常
- [x] 流解析正确

**已完成:**
- 创建了 OpenCode 适配器核心模块 `src/adapters/opencode/`：
  - `types.ts` - OpenCode 特有类型定义（OpenCodeSession, StreamState, SSEEventType 等）
  - `http-client.ts` - HTTP 客户端管理，使用 axios 与 keep-alive 连接池
  - `sse-parser.ts` - SSE 流解析器（原生实现 + eventsource-parser 库版本）
  - `server-manager.ts` - opencode serve 子进程生命周期管理
  - `session-manager.ts` - 会话管理器（按工作目录隔离）
  - `adapter.ts` - 主适配器实现，继承 BaseCLIAdapter
  - `index.ts` - 统一导出
- 创建了重试工具模块 `src/core/retry.ts`（指数退避策略）
- 在 `src/adapters/index.ts` 注册 OpenCode 适配器
- 所有模块类型检查通过

---

#### Day 12: 项目管理 + 入口文件

**任务 12.1: ProjectManager**

```typescript
// src/project/manager.ts
export interface Project {
  id: string;
  name: string;
  displayName: string;
  path: string;
  createdAt: number;
  updatedAt: number;
}

export class ProjectManager {
  private projects: Project[] = [];
  private currentProjectId: string | null = null;
  private storagePath: string;

  async load(): Promise<void>;
  async save(): Promise<void>;
  async addProject(path: string, name?: string): Promise<Project>;
  async switchProject(identifier: string): Promise<boolean>;
  async getCurrentProject(): Promise<Project | null>;
  async listProjects(): Promise<Project[]>;
}
```

**任务 12.2: 主入口 (main.ts)**

```typescript
// src/main.ts
import { Client as LarkClient } from '@larksuiteoapi/node-sdk';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = setupLogger(config.debug);

  const feishuApi = new FeishuAPI(config.feishu.appId, config.feishu.appSecret);
  const projectManager = new ProjectManager(config.project);
  await projectManager.load();

  const handler = new MessageHandler(config, feishuApi, projectManager);

  const wsClient = new LarkClient({
    appId: config.feishu.appId,
    appSecret: config.feishu.appSecret,
    loggerLevel: lark.LoggerLevel.info
  });

  wsClient.on('message', handler.handleMessage.bind(handler));
  wsClient.on('cardAction', handler.handleCardCallback.bind(handler));

  await wsClient.start();
}

main().catch(console.error);
```

**验收标准:**
- [x] 程序能启动
- [x] 配置加载正常
- [x] WebSocket 连接成功

**已完成:**
- 实现了完整的 `ProjectManager` 持久化存储功能：`src/project/manager.ts`
  - 从 JSON 文件加载/保存项目配置
  - 路径安全验证（路径遍历防护）
  - 项目 CRUD 操作（增删改查）
  - 自动验证项目路径有效性
  - 存储版本迁移支持
- 实现了完整的入口文件 `src/main.ts`：
  - 配置加载和验证
  - 初始化所有组件（FeishuClient、FeishuAPI、SessionManager、ProjectManager、MessageProcessor）
  - 适配器工厂集成
  - 信号处理和优雅退出
  - 错误处理和日志记录
- 所有模块类型检查通过

---

#### Day 13: 集成测试 + Bug 修复

**任务 13.1: 完成卡片 Footer 样式修复**

**问题**: 完成卡片的 footer 只显示 `已完成 · 耗时 5.8s`，缺少 token 统计和模型信息。

**期望样式**: `✅ 已完成 · ⏱️ 13.0s · 📊 15.6K (7.4%) · 🤖 mimo-v2-pro-free`

**修改内容:**
1. `src/platform/cards/streaming.ts`:
   - `buildStreamingCompleteCard`: 添加 `stats` 和 `model` 参数
   - `buildStoppedCard`: 添加可选的 `stats` 和 `model` 参数
   - Footer 格式改为: `✅ 已完成 · ⏱️ Xs · 📊 XK (X%) · 🤖 model-name`

2. `src/platform/streaming/controller.ts`:
   - `sendCompleteCard`: 传递 `stats` 和 `this.model` 给卡片构建函数
   - `sendStoppedCard`: 传递 `this.model` 给卡片构建函数（stats 为 undefined）

**状态**: 已完成

---

**任务 13.2: 推理内容泄漏到正式回复卡片 Bug 修复**

**问题**: 在飞书卡片中，AI 的推理/思考过程（reasoning）错误地显示在了正式回复中，同时 `completedText` 为空导致内容重复。

**日志表现**:
```
[sendCompleteCard] completedText length: 0          ← 空的 completedText
[sendCompleteCard] accumulatedText length: 1771     ← 包含 reasoning
[sendCompleteCard] displayText preview: 用户想让我...  ← 与 reasoning 相同
```

**根因**:
1. `StreamingCardController.onDeliver()` 从未被调用
2. OpenCode 适配器没有发出 `DELIVER` 类型的 chunk
3. 流结束时需要直接调用 `onDeliver` 设置 `completedText`

**修复内容**:
1. 添加 `StreamChunkType.DELIVER` 类型 (`src/core/types/stream.ts`)
2. AI 处理器处理 `DELIVER` chunk (`src/platform/message-processor/ai-processor.ts`)
3. SSE 解析器在流结束时发出 `DELIVER` (`src/adapters/opencode/sse-parser.ts`)
4. 流结束时直接调用 `onDeliver` 并清理推理标签

**状态**: 已完成

---

**任务 13.3: 集成测试场景**

| 场景 | 步骤 |
|------|------|
| 基本对话 | 发送消息 → 接收流式回复 |
| 会话切换 | `/session` → 选择 → 新会话对话 |
| 项目切换 | `/pl` → 点击切换 → 确认上下文隔离 |
| 停止生成 | 长回复时发送 `/stop` → 确认中断 |
| 附件处理 | 发送图片 → 确认 base64 编码发送 |
| 降级模式 | 设置 `DISABLE_CARDKIT=1` → 确认 IM Patch 工作 |

**验收标准:**
- [ ] 所有场景通过
- [ ] 无阻塞 Bug

---

### Week 4: 测试与优化

#### Day 14-15: 单元测试

**测试覆盖目标:**

| 模块 | 覆盖率目标 |
|------|-----------|
| config.ts | 80% |
| flush-controller.ts | 90% |
| streaming-controller.ts | 85% |
| command-router.ts | 80% |
| card-builder/* | 70% |
| opencode/adapter.ts | 75% |
| opencode/server-manager.ts | 70% |

**测试框架:** Vitest

```typescript
// tests/unit/flush-controller.test.ts
import { describe, it, expect, vi } from 'vitest';
import { FlushController } from '../../src/feishu/flush-controller';

describe('FlushController', () => {
  it('should throttle updates correctly', async () => {
    const flushFn = vi.fn().mockResolvedValue(undefined);
    const controller = new FlushController(flushFn);

    // 测试节流逻辑
  });

  it('should handle concurrent updates safely', async () => {
    // 测试互斥锁
  });
});
```

---

#### Day 16-17: 流式场景测试

**测试用例:**

1. **CardKit 流式测试**
   - 连续快速更新（<100ms 间隔）
   - 序列号冲突处理
   - 网络抖动恢复

2. **降级测试**
   - CardKit 失败自动降级
   - IM Patch 限流处理
   - 手动禁用 CardKit

3. **并发测试**
   - 多用户同时对话
   - 快速切换会话

4. **长运行测试**
   - 连续运行 4 小时
   - 内存泄漏检查

---

#### Day 18: 性能优化 + 文档完善

**优化项:**

| 项目 | 目标 |
|------|------|
| 启动时间 | <3 秒 |
| 内存占用 | <200MB (空闲) |
| 流式延迟 | <150ms (首字) |
| CPU 使用 | <10% (空闲) |

**文档更新:**
- [ ] README.md 更新
- [ ] 部署文档
- [ ] 配置说明
- [ ] 故障排查指南

---

## 4. 文件映射清单

### 4.1 完整文件对照表

| Python 文件 | TypeScript 文件 | 状态 | 复杂度 |
|------------|----------------|------|--------|
| `src/main.py` | `src/main.ts` | **已完成** | 低 |
| `src/config.py` | `src/core/config.ts` | 已完成 | 低 |
| `src/__init__.py` | `src/index.ts` | 待迁移 | 低 |
| `src/feishu/__init__.py` | `src/platform/index.ts` | 已完成 | 低 |
| `src/feishu/client.py` | `src/platform/feishu-client.ts` | 已完成 | 中 |
| `src/feishu/api.py` | `src/platform/feishu-api.ts` | 已完成 | 中 |
| `src/feishu/handler.py` | `src/platform/message-processor/` | 已完成 | 高 |
| `src/feishu/streaming_controller.py` | `src/feishu/streaming-controller.ts` | 待迁移 | 高 |
| `src/feishu/flush_controller.py` | `src/platform/streaming/flush-controller.ts` | 已完成 | 中 |
| `src/feishu/cardkit_client.py` | ~~删除~~ | 无需 | - |
| `src/feishu/card_builder/__init__.py` | `src/card-builder/index.ts` | 待迁移 | 低 |
| `src/feishu/card_builder/base.py` | `src/card-builder/base.ts` | 待迁移 | 低 |
| `src/feishu/card_builder/interactive_cards.py` | `src/card-builder/interactive-cards.ts` | 待迁移 | 低 |
| `src/feishu/card_builder/project_cards.py` | `src/card-builder/project-cards.ts` | 待迁移 | 低 |
| `src/feishu/card_builder/session_cards.py` | `src/card-builder/session-cards.ts` | 待迁移 | 低 |
| `src/feishu/card_builder/utils.py` | `src/card-builder/utils.ts` | 待迁移 | 低 |
| `src/feishu/dedup.py` | `src/feishu/dedup.ts` | 待迁移 | 低 |
| `src/feishu/message_parser.py` | `src/feishu/message-parser.ts` | 待迁移 | 低 |
| `src/feishu/command_router.py` | `src/feishu/command-router.ts` | 待迁移 | 中 |
| `src/feishu/card_callback_handler.py` | `src/feishu/card-callback-handler.ts` | 待迁移 | 中 |
| `src/feishu/toast_helper.py` | `src/feishu/toast-helper.ts` | 待迁移 | 低 |
| `src/feishu/formatter.py` | `src/feishu/formatter.ts` | 待迁移 | 低 |
| `src/adapters/__init__.py` | `src/adapters/index.ts` | 已完成 | 低 |
| `src/adapters/base.py` | `src/adapters/base.ts` | 待迁移 | 低 |
| `src/adapters/codex.py` | ~~删除~~ | 无需 | - |
| `src/adapters/opencode/__init__.py` | `src/adapters/opencode/index.ts` | 已完成 | 低 |
| `src/adapters/opencode/core.py` | `src/adapters/opencode/adapter.ts` | 已完成 | 高 |
| `src/adapters/opencode/server_manager.py` | `src/adapters/opencode/server-manager.ts` | 已完成 | 中 |
| `src/adapters/opencode/session_manager.py` | `src/adapters/opencode/session-manager.ts` | 已完成 | 中 |
| `src/session/__init__.py` | `src/session/index.ts` | 已完成 | 低 |
| `src/session/manager.py` | `src/session/manager.ts` | 已完成 | 低 |
| `src/project/__init__.py` | `src/project/index.ts` | 已完成 | 低 |
| `src/project/manager.py` | `src/project/manager.ts` | 已完成 | 低 |
| `src/project/models.py` | `src/project/types.ts` | 已完成 | 低 |
| `src/tui_commands/__init__.py` | `src/tui-commands/index.ts` | 待迁移 | 低 |
| `src/tui_commands/base.py` | `src/tui-commands/base.ts` | 待迁移 | 低 |
| `src/tui_commands/interactive.py` | `src/tui-commands/interactive.ts` | 待迁移 | 中 |
| `src/tui_commands/opencode.py` | `src/tui-commands/opencode.ts` | 待迁移 | 中 |
| `src/tui_commands/project.py` | `src/tui-commands/project.ts` | 待迁移 | 中 |
| `src/tui_commands/testcard.py` | ~~删除~~ | 无需 | - |
| `src/utils/__init__.py` | `src/utils/index.ts` | 待迁移 | 低 |
| `src/utils/error_codes.py` | `src/utils/error-codes.ts` | 待迁移 | 低 |
| `src/utils/retry.py` | `src/utils/retry.ts` | 待迁移 | 低 |
| `src/utils/logger.py` | `src/core/logger.ts` | 已完成 | 低 |

### 4.2 新增文件

| 文件 | 用途 |
|------|------|
| `src/types/config.ts` | `src/core/types/config.ts` | 已完成 | 新增 |
| `src/types/stream.ts` | `src/core/types/stream.ts` | 已完成 | 新增 |
| `src/types/adapter.ts` | `src/adapters/interface/types.ts` | 已完成 | 新增 |
| `src/types/feishu.ts` | `src/platform/types.ts` | 已完成 | 新增 |
| `tests/unit/*.test.ts` | 单元测试 |
| `tests/integration/*.test.ts` | 集成测试 |
| `scripts/setup.sh` | 环境初始化脚本 |

---

## 5. 代码迁移示例

### 5.1 异步锁转换

**Python (asyncio.Lock):**
```python
import asyncio

class FlushController:
    def __init__(self):
        self._lock = asyncio.Lock()
        self._pending = False

    async def throttled_update(self, throttle_ms: int):
        async with self._lock:
            if self._pending:
                return
            self._pending = True

        await asyncio.sleep(throttle_ms / 1000)

        async with self._lock:
            await self._do_flush()
            self._pending = False
```

**TypeScript (async-mutex):**
```typescript
import { Mutex } from 'async-mutex';

export class FlushController {
  private mutex = new Mutex();
  private pending = false;

  async throttledUpdate(throttleMs: number): Promise<void> {
    await this.mutex.runExclusive(() => {
      if (this.pending) return;
      this.pending = true;
    });

    await new Promise(resolve => setTimeout(resolve, throttleMs));

    await this.mutex.runExclusive(async () => {
      await this.doFlush();
      this.pending = false;
    });
  }
}
```

### 5.2 SSE 流解析

**Python (httpx-sse):**
```python
from httpx_sse import aconnect_sse
import httpx

async def stream_events(client: httpx.AsyncClient, url: str):
    async with aconnect_sse(client, "GET", url) as event_source:
        async for sse in event_source.aiter_sse():
            yield parse_chunk(sse.data)
```

**TypeScript (eventsource-parser):**
```typescript
import { createParser, ParsedEvent } from 'eventsource-parser';
import axios, { AxiosResponse } from 'axios';

async function* streamEvents(url: string): AsyncIterable<StreamChunk> {
  const response: AxiosResponse = await axios.get(url, {
    responseType: 'stream'
  });

  const parser = createParser((event: ParsedEvent) => {
    if (event.type === 'event') {
      controller.enqueue(parseChunk(event.data));
    }
  });

  const stream = response.data;
  stream.on('data', (chunk: Buffer) => {
    parser.feed(chunk.toString());
  });

  // 转换为 AsyncIterable
  // ...
}
```

### 5.3 子进程管理

**Python (asyncio.subprocess):**
```python
import asyncio

async def start_server():
    process = await asyncio.create_subprocess_exec(
        "opencode", "serve", "--port", "4096",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        start_new_session=True
    )

    # 等待健康检查
    for _ in range(10):
        if await check_health():
            return True
        await asyncio.sleep(1)
```

**TypeScript (child_process):**
```typescript
import { spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';

const sleep = promisify(setTimeout);

async function startServer(): Promise<boolean> {
  const process = spawn('opencode', ['serve', '--port', '4096'], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  // 等待健康检查
  for (let i = 0; i < 10; i++) {
    if (await checkHealth()) {
      return true;
    }
    await sleep(1000);
  }

  return false;
}
```

---

## 6. 测试策略

### 6.1 测试金字塔

```
       /\
      /  \     E2E 测试 (5%) - 完整对话流程
     /----\
    /      \   集成测试 (20%) - API/流式/适配器
   /--------\
  /          \ 单元测试 (75%) - 工具函数/状态机
 /------------\
```

### 6.2 测试环境

| 环境 | 用途 | 数据 |
|------|------|------|
| 本地 | 开发调试 | 模拟数据 |
| 测试 | CI/CD | 测试应用 |
| 预发布 | 验收 | 生产镜像 |

### 6.3 关键测试用例

**流式系统测试:**
```typescript
// tests/integration/streaming.test.ts
describe('StreamingCardController', () => {
  it('should stream content with CardKit', async () => {
    const controller = new StreamingCardController(...);

    // 模拟流数据
    await controller.onContentStream('Hello');
    await controller.onContentStream(' World');
    await controller.markFullyComplete();
    await controller.onComplete(() => stats, 'test-model');

    // 验证 CardKit API 被调用
    expect(mockClient.cardkit.v1.card.batchUpdate).toHaveBeenCalled();
  });

  it('should fallback to IM Patch on CardKit failure', async () => {
    // CardKit 失败场景
    mockClient.cardkit.v1.card.create.mockRejectedValue(new Error('timeout'));

    const controller = new StreamingCardController(...);
    await controller.onContentStream('test');

    // 验证降级到 IM Patch
    expect(mockClient.im.v1.message.patch).toHaveBeenCalled();
  });
});
```

---

## 7. 风险缓解

### 7.1 风险登记册

| ID | 风险 | 概率 | 影响 | 缓解措施 |
|----|------|------|------|----------|
| R1 | SDK CardKit 行为与预期不符 | 中 | 高 | Week 1 验证 SDK 行为；准备回滚方案 |
| R2 | SSE 流边界解析差异 | 中 | 中 | 完整测试 OpenCode 输出；对比验证 |
| R3 | 状态机竞态条件 | 中 | 高 | 使用 async-mutex；编写并发测试 |
| R4 | 内存泄漏 | 低 | 高 | 长运行测试；内存监控 |
| R5 | 子进程僵尸进程 | 低 | 中 | 确保进程清理；信号处理 |
| R6 | 类型定义不完整 | 低 | 低 | 手动补充；逐步完善 |

### 7.2 应急方案

**如果迁移延期:**
1. 保留 Python 代码在 `legacy/python` 分支
2. 采用"灰度发布"：部分用户先用 Node.js 版本
3. 关键 Bug 可回滚到 Python 版本

---

## 8. 验收标准

### 8.1 功能验收

| 功能 | 验收标准 | 验证方法 |
|------|----------|----------|
| WebSocket 连接 | 稳定运行 24h 无断开 | 日志检查 |
| 消息接收 | 100% 消息到达 | 压力测试 |
| CardKit 流式 | 100ms 更新间隔 | 抓包验证 |
| IM Patch 降级 | 1500ms 更新间隔 | 配置验证 |
| OpenCode 适配 | SSE 流完整解析 | 端到端测试 |
| 会话管理 | 创建/切换/重置正常 | 手工测试 |
| 项目管理 | 增删改查正常 | 手工测试 |
| /stop 命令 | 立即停止生成 | 手工测试 |

### 8.2 性能验收

| 指标 | 目标 | 测试方法 |
|------|------|----------|
| 启动时间 | <3s | 计时 |
| 内存占用 | <200MB | `process.memoryUsage()` |
| 流式首字延迟 | <150ms | 日志分析 |
| 并发处理 | 10 用户同时 | 压力测试 |

### 8.3 代码质量

| 指标 | 目标 |
|------|------|
| TypeScript 编译 | 0 error, 0 warning |
| ESLint | 0 error |
| 单元测试覆盖率 | >70% |
| 关键模块覆盖率 | >85% |

---

**文档版本**: 1.0
**创建日期**: 2026-03-27
**最后更新**: 2026-03-29
**迁移负责人**: [待指定]
**技术负责人**: [待指定]
