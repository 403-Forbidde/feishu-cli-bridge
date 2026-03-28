# Node.js 迁移知识准备

本文档汇总 Feishu CLI Bridge Node.js 迁移所需的核心知识点。

---

## 1. TypeScript 类型系统

### 1.1 基础类型

```typescript
// 基本类型
let isDone: boolean = false;
let decimal: number = 6;
let color: string = "blue";
let list: number[] = [1, 2, 3];
let tuple: [string, number] = ["hello", 10];

// 枚举
enum Color { Red, Green, Blue }
let c: Color = Color.Green;

// Any 和 Unknown
let notSure: any = 4;
let looselyTyped: unknown = 4;
// unknown 需要类型检查后才能使用
if (typeof looselyTyped === 'number') {
  looselyTyped.toFixed();
}

// Void, Null, Undefined
function warnUser(): void {
  console.log("This is my warning message");
}
let u: undefined = undefined;
let n: null = null;
```

### 1.2 接口与类型别名

```typescript
// 接口 - 可扩展
interface Person {
  firstName: string;
  lastName: string;
  age?: number;  // 可选属性
  readonly id: number;  // 只读属性
}

// 类型别名 - 用于联合类型等
type StringOrNumber = string | number;
type Point = {
  x: number;
  y: number;
};

// 函数类型
interface SearchFunc {
  (source: string, subString: string): boolean;
}

// 索引签名
interface StringArray {
  [index: number]: string;
}
```

### 1.3 泛型

```typescript
// 基础泛型
function identity<T>(arg: T): T {
  return arg;
}

// 泛型接口
interface GenericIdentityFn<T> {
  (arg: T): T;
}

// 泛型类
class GenericNumber<T> {
  zeroValue: T;
  add: (x: T, y: T) => T;
}

// 泛型约束
interface Lengthwise {
  length: number;
}
function loggingIdentity<T extends Lengthwise>(arg: T): T {
  console.log(arg.length);
  return arg;
}
```

### 1.4 高级类型

```typescript
// 联合类型和交叉类型
type Union = string | number;
type Intersection = Person & Employee;

// 类型守卫
function isString(value: unknown): value is string {
  return typeof value === 'string';
}

// 映射类型
type Readonly<T> = {
  readonly [P in keyof T]: T[P];
};
type Partial<T> = {
  [P in keyof T]?: T[P];
};

// 条件类型
type NonNullable<T> = T extends null | undefined ? never : T;

// 实用工具类型
type UserProps = {
  id: number;
  name: string;
  email?: string;
};
type RequiredUser = Required<UserProps>;
type UserPreview = Pick<UserProps, 'id' | 'name'>;
type UserWithoutId = Omit<UserProps, 'id'>;
```

---

## 2. async/await 模式

### 2.1 基础用法

```typescript
// Promise 基础
const promise = new Promise<string>((resolve, reject) => {
  setTimeout(() => {
    resolve("Hello");
  }, 1000);
});

// async/await
async function greet(): Promise<string> {
  const result = await promise;
  return result + " World";
}

// 错误处理
try {
  const result = await riskyOperation();
} catch (error) {
  console.error("Error:", error);
}
```

### 2.2 并发控制

```typescript
// 并行执行
const [user, posts] = await Promise.all([
  fetchUser(),
  fetchPosts()
]);

// 快速失败
const result = await Promise.race([
  fetchData(),
  timeout(5000)
]);

// 错误收集
const results = await Promise.allSettled([
  fetchUser(),
  fetchPosts(),
  fetchComments()
]);

// 串行执行
for (const item of items) {
  await processItem(item);
}
```

### 2.3 Node.js 流与 Async Iterator

```typescript
// Async Generator
async function* generateSequence(start: number, end: number) {
  for (let i = start; i <= end; i++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    yield i;
  }
}

// 消费 Async Iterator
for await (const num of generateSequence(1, 10)) {
  console.log(num);
}

// 可读流转 Async Iterator
import { createReadStream } from 'fs';

async function* readLines(filename: string) {
  const stream = createReadStream(filename, { encoding: 'utf-8' });
  let remainder = '';

  for await (const chunk of stream) {
    const lines = (remainder + chunk).split('\n');
    remainder = lines.pop() || '';
    for (const line of lines) {
      yield line;
    }
  }

  if (remainder) {
    yield remainder;
  }
}
```

### 2.4 异步锁模式

```typescript
import { Mutex } from 'async-mutex';

const mutex = new Mutex();

async function exclusiveOperation() {
  // 自动获取和释放锁
  const result = await mutex.runExclusive(async () => {
    // 临界区代码
    await criticalWork();
    return 'done';
  });
}

// 手动控制
async function manualLock() {
  const release = await mutex.acquire();
  try {
    await criticalWork();
  } finally {
    release();
  }
}

// 读写锁
import { RwLock } from 'async-mutex';

const rwLock = new RwLock();

async function readOperation() {
  await rwLock.readLock();
  // 读取操作
  rwLock.unlock();
}

async function writeOperation() {
  await rwLock.writeLock();
  // 写入操作
  rwLock.unlock();
}
```

---

## 3. @larksuiteoapi/node-sdk

### 3.1 客户端初始化

```typescript
import * as lark from '@larksuiteoapi/node-sdk';

// 创建客户端
const client = new lark.Client({
  appId: process.env.FEISHU_APP_ID!,
  appSecret: process.env.FEISHU_APP_SECRET!,
  appType: lark.AppType.SelfBuild,
  // 可选配置
  loggerLevel: lark.LoggerLevel.info,
});

// WebSocket 客户端 (事件订阅)
const wsClient = new lark.WSClient({
  appId: process.env.FEISHU_APP_ID!,
  appSecret: process.env.FEISHU_APP_SECRET!,
  loggerLevel: lark.LoggerLevel.info,
});
```

### 3.2 发送消息

```typescript
// 发送文本消息
async function sendTextMessage(chatId: string, content: string) {
  const result = await client.im.v1.message.create({
    params: {
      receive_id_type: 'chat_id',
    },
    data: {
      receive_id: chatId,
      content: JSON.stringify({ text: content }),
      msg_type: 'text',
    },
  });
  return result;
}

// 发送卡片消息
async function sendCardMessage(chatId: string, card: object) {
  const result = await client.im.v1.message.create({
    params: {
      receive_id_type: 'chat_id',
    },
    data: {
      receive_id: chatId,
      content: JSON.stringify(card),
      msg_type: 'interactive',
    },
  });
  return result;
}

// 回复消息
async function replyMessage(messageId: string, content: string) {
  const result = await client.im.v1.message.reply({
    path: {
      message_id: messageId,
    },
    data: {
      content: JSON.stringify({ text: content }),
      msg_type: 'text',
    },
  });
  return result;
}
```

### 3.3 更新卡片消息

```typescript
// IM Patch 方式更新卡片
async function patchCardMessage(messageId: string, card: object) {
  await client.im.v1.message.patch({
    path: {
      message_id: messageId,
    },
    data: {
      content: JSON.stringify(card),
    },
  });
}

// CardKit 方式更新卡片
async function updateCardKit(cardId: string, actions: object[]) {
  await client.cardkit.v1.card.batchUpdate({
    path: {
      card_id: cardId,
    },
    data: {
      sequence: Date.now(),
      uuid: crypto.randomUUID(),
      actions: JSON.stringify(actions),
    },
  });
}
```

### 3.4 消息事件处理

```typescript
// 注册消息处理器
wsClient.on('message', async (event) => {
  const { message } = event;

  // 解析消息内容
  if (message.message_type === 'text') {
    const content = JSON.parse(message.content);
    console.log('Received:', content.text);

    // 处理消息...
    await handleTextMessage(message, content.text);
  }
});

// 注册卡片回调处理器
wsClient.on('cardAction', async (event) => {
  const { action } = event;
  console.log('Card action:', action.value);

  // 返回响应
  return {
    toast: {
      type: 'success',
      content: '操作成功',
    },
  };
});

// 启动 WebSocket 连接
await wsClient.start();
```

### 3.5 资源下载

```typescript
// 下载消息资源
async function downloadResource(
  messageId: string,
  fileKey: string
): Promise<Buffer> {
  const response = await client.im.v1.resource.get({
    path: {
      message_id: messageId,
      file_key: fileKey,
    },
  });

  // response 可能包含 Buffer 或 Stream
  return response as Buffer;
}

// 保存到文件
import { writeFile } from 'fs/promises';

async function saveAttachment(
  messageId: string,
  fileKey: string,
  filename: string
): Promise<void> {
  const data = await downloadResource(messageId, fileKey);
  await writeFile(filename, data);
}
```

### 3.6 表情回复

```typescript
// 添加表情回复
async function addReaction(messageId: string, emojiType: string) {
  const result = await client.im.v1.messageReaction.create({
    path: {
      message_id: messageId,
    },
    data: {
      reaction_type: {
        emoji_type: emojiType,
      },
    },
  });
  return result.data?.reaction_id;
}

// 删除表情回复
async function removeReaction(messageId: string, reactionId: string) {
  await client.im.v1.messageReaction.delete({
    path: {
      message_id: messageId,
      reaction_id: reactionId,
    },
  });
}

// 常用表情类型
const EmojiTypes = {
  TYPING: 'writing_hand',  // ✍️ 输入中
  DONE: 'white_check_mark', // ✅ 完成
  ERROR: 'x',              // ❌ 错误
  STOP: 'octagonal_sign',  // 🛑 停止
} as const;
```

---

## 4. 状态机设计

### 4.1 基础状态机

```typescript
// 定义状态和事件
type State = 'idle' | 'loading' | 'success' | 'error';
type Event = 'FETCH' | 'SUCCESS' | 'ERROR' | 'RETRY';

// 状态转换表
const transitions: Record<State, Partial<Record<Event, State>>> = {
  idle: { FETCH: 'loading' },
  loading: { SUCCESS: 'success', ERROR: 'error' },
  success: { FETCH: 'loading' },
  error: { RETRY: 'loading', FETCH: 'loading' },
};

// 简单状态机实现
class SimpleStateMachine {
  private state: State = 'idle';

  dispatch(event: Event): boolean {
    const nextState = transitions[this.state]?.[event];
    if (nextState) {
      this.onExit(this.state);
      this.state = nextState;
      this.onEnter(nextState);
      return true;
    }
    return false;
  }

  getState(): State {
    return this.state;
  }

  protected onEnter(state: State) {
    console.log(`Entering state: ${state}`);
  }

  protected onExit(state: State) {
    console.log(`Exiting state: ${state}`);
  }
}
```

### 4.2 流式卡片状态机

```typescript
type StreamingPhase =
  | 'idle'
  | 'creating'
  | 'streaming'
  | 'completed'
  | 'aborted';

type StreamingEvent =
  | 'START_STREAM'
  | 'CARD_CREATED'
  | 'CONTENT_RECEIVED'
  | 'COMPLETE'
  | 'ERROR'
  | 'ABORT';

interface StreamingContext {
  cardId?: string;
  content: string;
  sequence: number;
  error?: string;
}

class StreamingCardStateMachine {
  private phase: StreamingPhase = 'idle';
  private context: StreamingContext = {
    content: '',
    sequence: 0,
  };

  // 状态进入处理器
  private onEnter: Record<StreamingPhase, () => void> = {
    idle: () => {
      this.context = { content: '', sequence: 0 };
    },
    creating: () => {
      this.createCard();
    },
    streaming: () => {
      this.startFlushLoop();
    },
    completed: () => {
      this.finalizeCard();
    },
    aborted: () => {
      this.cleanup();
    },
  };

  // 状态转换
  async transition(
    event: StreamingEvent,
    data?: unknown
  ): Promise<void> {
    switch (this.phase) {
      case 'idle':
        if (event === 'START_STREAM') {
          await this.setPhase('creating');
        }
        break;

      case 'creating':
        if (event === 'CARD_CREATED') {
          this.context.cardId = data as string;
          await this.setPhase('streaming');
        } else if (event === 'ERROR') {
          this.context.error = data as string;
          await this.setPhase('aborted');
        }
        break;

      case 'streaming':
        if (event === 'CONTENT_RECEIVED') {
          this.context.content += data as string;
          this.context.sequence++;
        } else if (event === 'COMPLETE') {
          await this.setPhase('completed');
        } else if (event === 'ABORT') {
          await this.setPhase('aborted');
        }
        break;

      case 'completed':
      case 'aborted':
        // 最终状态，只能重置
        if (event === 'START_STREAM') {
          await this.setPhase('creating');
        }
        break;
    }
  }

  private async setPhase(phase: StreamingPhase): Promise<void> {
    this.phase = phase;
    await this.onEnter[phase]();
  }

  // 具体实现方法
  private async createCard(): Promise<void> {
    // 创建卡片逻辑
  }

  private async startFlushLoop(): Promise<void> {
    // 启动刷新循环
  }

  private async finalizeCard(): Promise<void> {
    // 完成卡片
  }

  private async cleanup(): Promise<void> {
    // 清理资源
  }

  getPhase(): StreamingPhase {
    return this.phase;
  }

  getContext(): StreamingContext {
    return { ...this.context };
  }
}
```

### 4.3 状态机与异步流结合

```typescript
// 带异步操作的状态机
abstract class AsyncStateMachine<S extends string, E extends string> {
  protected state: S;
  private transitionLock = new Mutex();

  constructor(initialState: S) {
    this.state = initialState;
  }

  getState(): S {
    return this.state;
  }

  async dispatch(event: E, payload?: unknown): Promise<boolean> {
    return this.transitionLock.runExclusive(async () => {
      const nextState = await this.getNextState(this.state, event, payload);

      if (nextState && nextState !== this.state) {
        await this.onExit(this.state, nextState);
        const prevState = this.state;
        this.state = nextState;
        await this.onEnter(nextState, prevState, payload);
        return true;
      }

      return false;
    });
  }

  protected abstract getNextState(
    current: S,
    event: E,
    payload?: unknown
  ): Promise<S | null>;

  protected abstract onEnter(
    state: S,
    from: S,
    payload?: unknown
  ): Promise<void>;

  protected abstract onExit(state: S, to: S): Promise<void>;
}

// 使用示例
class StreamingController extends AsyncStateMachine<
  StreamingPhase,
  StreamingEvent
> {
  constructor() {
    super('idle');
  }

  protected async getNextState(
    current: StreamingPhase,
    event: StreamingEvent
  ): Promise<StreamingPhase | null> {
    const transitions: Record<
      StreamingPhase,
      Partial<Record<StreamingEvent, StreamingPhase>>
    > = {
      idle: { START_STREAM: 'creating' },
      creating: { CARD_CREATED: 'streaming', ERROR: 'aborted' },
      streaming: { COMPLETE: 'completed', ABORT: 'aborted' },
      completed: { START_STREAM: 'creating' },
      aborted: { START_STREAM: 'creating' },
    };

    return transitions[current]?.[event] || null;
  }

  protected async onEnter(
    state: StreamingPhase,
    from: StreamingPhase
  ): Promise<void> {
    console.log(`Transition: ${from} -> ${state}`);
  }

  protected async onExit(
    state: StreamingPhase,
    to: StreamingPhase
  ): Promise<void> {
    // 清理工作
  }
}
```

---

## 5. 快速参考

### 5.1 Python vs TypeScript 对照表

| Python | TypeScript | 说明 |
|--------|------------|------|
| `def func()` | `function func()` | 函数定义 |
| `async def` | `async function` | 异步函数 |
| `await` | `await` | 等待异步操作 |
| `list[T]` | `T[]` 或 `Array<T>` | 数组 |
| `dict[str, T]` | `Record<string, T>` | 字典/对象 |
| `Optional[T]` | `T \| undefined` | 可选值 |
| `Union[A, B]` | `A \| B` | 联合类型 |
| `Callable[[A], B]` | `(arg: A) => B` | 函数类型 |
| `@dataclass` | `class` + 构造函数 | 数据类 |
| `raise Exception` | `throw new Error` | 抛出异常 |
| `try/except` | `try/catch` | 异常处理 |
| `asyncio.Lock` | `Mutex` from async-mutex | 异步锁 |
| `asyncio.Event` | `EventEmitter` | 事件通知 |
| `asyncio.Queue` | 无原生等价 | 使用数组 + 锁 |
| `yield` | `yield` | Generator |
| `async for` | `for await` | 异步迭代 |

### 5.2 常用 npm 包

```json
{
  "dependencies": {
    "@larksuiteoapi/node-sdk": "飞书 SDK",
    "axios": "HTTP 客户端",
    "js-yaml": "YAML 解析",
    "async-mutex": "异步锁",
    "eventsource-parser": "SSE 解析"
  },
  "devDependencies": {
    "typescript": "TypeScript 编译器",
    "tsx": "TypeScript 执行器",
    "vitest": "测试框架",
    "eslint": "代码检查"
  }
}
```

---

**文档版本**: 1.0
**更新日期**: 2026-03-28
