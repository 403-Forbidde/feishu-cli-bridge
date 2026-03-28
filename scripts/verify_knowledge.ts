// 验证 TypeScript 环境和 SDK 可用性

import * as lark from '@larksuiteoapi/node-sdk';
import { Mutex } from 'async-mutex';
import yaml from 'js-yaml';

// ===== 1. 类型系统验证 =====
interface Config {
  appId: string;
  appSecret: string;
  version: number;
}

type Environment = 'development' | 'staging' | 'production';

// 泛型函数验证
function identity<T>(value: T): T {
  return value;
}

const num = identity<number>(42);
const str = identity<string>('hello');

// ===== 2. async/await 验证 =====
async function delay(ms: number): Promise<string> {
  await new Promise(resolve => setTimeout(resolve, ms));
  return `Delayed ${ms}ms`;
}

// Async Generator 验证
async function* countTo(n: number) {
  for (let i = 1; i <= n; i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
    yield i;
  }
}

// ===== 3. 异步锁验证 =====
async function testMutex(): Promise<void> {
  const mutex = new Mutex();
  let counter = 0;

  await Promise.all([
    mutex.runExclusive(async () => { counter++; }),
    mutex.runExclusive(async () => { counter++; }),
    mutex.runExclusive(async () => { counter++; }),
  ]);

  console.log(`Mutex test: counter = ${counter} (expected: 3)`);
}

// ===== 4. SDK 类型验证 =====
function createClient(config: Config): lark.Client {
  return new lark.Client({
    appId: config.appId,
    appSecret: config.appSecret,
    appType: lark.AppType.SelfBuild,
  });
}

// ===== 5. 状态机验证 =====
type State = 'idle' | 'running' | 'done';
type Event = 'start' | 'finish';

class SimpleStateMachine {
  private state: State = 'idle';

  private transitions: Record<State, Partial<Record<Event, State>>> = {
    idle: { start: 'running' },
    running: { finish: 'done' },
    done: {},
  };

  dispatch(event: Event): boolean {
    const next = this.transitions[this.state]?.[event];
    if (next) {
      console.log(`State: ${this.state} -> ${next}`);
      this.state = next;
      return true;
    }
    return false;
  }

  getState(): State {
    return this.state;
  }
}

// ===== 6. YAML 验证 =====
function testYaml(): void {
  const doc = yaml.load(`
name: test
version: 1.0
features:
  - streaming
  - cards
  `) as Record<string, unknown>;

  console.log('YAML parsed:', doc.name);
}

// ===== 主验证函数 =====
async function main(): Promise<void> {
  console.log('=== 知识准备验证 ===\n');

  // 1. 类型系统
  console.log('✓ TypeScript 类型系统可用');
  console.log(`  - 数字: ${num}`);
  console.log(`  - 字符串: ${str}`);

  // 2. async/await
  const delayed = await delay(50);
  console.log(`\n✓ async/await 可用: ${delayed}`);

  // 3. Async Iterator
  const numbers: number[] = [];
  for await (const n of countTo(3)) {
    numbers.push(n);
  }
  console.log(`✓ Async Iterator 可用: [${numbers.join(', ')}]`);

  // 4. 异步锁
  await testMutex();

  // 5. SDK 类型
  console.log('\n✓ @larksuiteoapi/node-sdk 可用');
  console.log(`  - lark.AppType.SelfBuild = ${lark.AppType.SelfBuild}`);

  // 6. 状态机
  const sm = new SimpleStateMachine();
  sm.dispatch('start');
  sm.dispatch('finish');
  console.log(`\n✓ 状态机可用: 最终状态 = ${sm.getState()}`);

  // 7. YAML
  testYaml();
  console.log('✓ js-yaml 可用');

  console.log('\n=== 所有验证通过 ===');
}

main().catch(console.error);
