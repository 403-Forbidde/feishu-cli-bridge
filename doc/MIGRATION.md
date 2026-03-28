# Feishu CLI Bridge Node.js 迁移方案

## 1. 项目概述

### 1.1 迁移背景
- **源项目**: Python 3.9+ 实现的飞书 CLI 桥接器
- **目标技术栈**: Node.js 20+ + TypeScript 5+
- **核心依赖**: `@larksuiteoapi/node-sdk` (飞书官方 Node.js SDK)

### 1.2 确认可用的官方 SDK 能力

```typescript
// 飞书官方 Node.js SDK 已支持的核心 API
client.cardkit.v1.card.create       // 创建 CardKit 卡片
client.cardkit.v1.card.batchUpdate  // 流式更新 (sequence 管理)
client.cardkit.v1.card.update       // 全量更新
client.cardkit.v1.card.settings     // 设置 streaming_mode
client.im.v1.message.create         // 发送消息
client.im.v1.message.reply          // 回复消息
client.im.v1.message.patch          // 更新消息 (IM Patch 降级)
// WebSocket 长连接
wsClient.start()                    // 启动事件监听
```

---

## 2. 架构对比

### 2.1 当前 Python 架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        Python Architecture                       │
├─────────────────────────────────────────────────────────────────┤
│  lark-oapi SDK (WebSocket)                                       │
│         ↓                                                        │
│  FeishuClient (事件分发)                                          │
│         ↓                                                        │
│  MessageHandler (asyncio)                                        │
│         ↓                                                        │
│  StreamingCardController (asyncio.Lock + 状态机)                  │
│         ├─→ CardKitClient (HTTP /v1/card/entities)               │
│         └─→ IM Patch Fallback                                    │
│         ↓                                                        │
│  OpenCodeAdapter (httpx + SSE)                                   │
│         ├─→ subprocess (opencode serve)                          │
│         └─→ SessionManager                                       │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 目标 Node.js 架构

```
┌─────────────────────────────────────────────────────────────────┐
│                     Node.js Architecture                         │
├─────────────────────────────────────────────────────────────────┤
│  @larksuiteoapi/node-sdk (WebSocketClient)                       │
│         ↓                                                        │
│  FeishuService (EventEmitter)                                    │
│         ↓                                                        │
│  MessageHandler (async/await)                                    │
│         ↓                                                        │
│  StreamingCardController (AsyncMutex + 状态机)                    │
│         ├─→ SDK cardkit.v1.card.*                                │
│         └─→ SDK im.v1.message.patch                              │
│         ↓                                                        │
│  OpenCodeAdapter (axios + eventsource-parser)                    │
│         ├─→ child_process (opencode serve)                       │
│         └─→ SessionManager                                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. 模块迁移对照表

| Python 模块 | Node.js 模块 | 复杂度 | 依赖变化 |
|------------|-------------|--------|----------|
| `src/main.py` | `src/main.ts` | 低 | `asyncio` → 原生 Promise |
| `src/config.py` | `src/config.ts` | 低 | `pyyaml` → `js-yaml` |
| `src/feishu/client.py` | `src/feishu/client.ts` | 中 | SDK 替换 |
| `src/feishu/api.py` | `src/feishu/api.ts` | 中 | SDK 封装 |
| `src/feishu/handler.py` | `src/feishu/handler.ts` | 高 | 逻辑复杂 |
| `src/feishu/streaming_controller.py` | `src/feishu/streaming-controller.ts` | 高 | 状态机重写 |
| `src/feishu/flush_controller.py` | `src/feishu/flush-controller.ts` | 中 | `asyncio.Lock` → `async-mutex` |
| `src/feishu/cardkit_client.py` | **删除** | - | 使用 SDK 内置方法 |
| `src/feishu/card_builder/` | `src/card-builder/` | 低 | 字典 → TS 接口 |
| `src/adapters/opencode/` | `src/adapters/opencode/` | 中 | `httpx` → `axios` |
| `src/adapters/codex.py` | `src/adapters/codex.ts` | 低 | 子进程 API 变化 |
| `src/session/manager.py` | `src/session/manager.ts` | 低 | - |
| `src/project/manager.py` | `src/project/manager.ts` | 低 | - |
| `src/tui_commands/` | `src/tui-commands/` | 中 | - |
| `src/utils/` | `src/utils/` | 低 | - |

---

## 4. 关键技术点迁移

### 4.1 异步模型转换

**Python (asyncio)**
```python
async def handle_message(self, event_data: dict):
    async with self._current_generation_lock:
        self._current_generation_task = generation_task
    try:
        full_response = await generation_task
    except asyncio.CancelledError:
        pass
```

**Node.js (async/await + async-mutex)**
```typescript
async handleMessage(eventData: EventData): Promise<void> {
  await this.currentGenerationLock.runExclusive(async () => {
    this.currentGenerationTask = generationTask;
  });

  try {
    const fullResponse = await generationTask;
  } catch (err) {
    if (err instanceof CancelledError) {
      // 处理取消
    }
  }
}
```

### 4.2 CardKit 流式更新

**Python (直接 HTTP)**
```python
async def stream_card_content(
    self, card_id: str, element_id: str, content: str, sequence: int
):
    await self._request(
        "PATCH",
        f"/v1/card/entities/{card_id}",
        json={
            "sequence": sequence,
            "actions": [{"action": "update", "target_element_id": element_id, ...}]
        }
    )
```

**Node.js (SDK)**
```typescript
async streamCardContent(
  cardId: string,
  elementId: string,
  content: string,
  sequence: number
): Promise<void> {
  await this.client.cardkit.v1.card.batchUpdate({
    path: { card_id: cardId },
    data: {
      sequence,
      actions: JSON.stringify([{action: "update", target_element_id: elementId, ...}])
    }
  });
}
```

### 4.3 SSE 流处理

**Python (httpx-sse)**
```python
from httpx_sse import aconnect_sse

async with aconnect_sse(client, "GET", "/event") as event_source:
    async for sse in event_source.aiter_sse():
        yield parse_chunk(sse.data)
```

**Node.js (eventsource-parser)**
```typescript
import { createParser } from 'eventsource-parser';

const parser = createParser((event) => {
  if (event.type === 'event') {
    yield parseChunk(event.data);
  }
});

response.data.on('data', (chunk) => parser.feed(chunk.toString()));
```

---

## 5. 项目结构

```
feishu-cli-bridge/
├── src/
│   ├── main.ts                    # 入口
│   ├── config.ts                  # 配置管理
│   ├── feishu/
│   │   ├── client.ts              # WebSocket 客户端封装
│   │   ├── api.ts                 # API 封装
│   │   ├── handler.ts             # 消息处理器
│   │   ├── streaming-controller.ts # 流式卡片控制器
│   │   ├── flush-controller.ts    # 节流控制器
│   │   ├── card-builder/          # 卡片构建器
│   │   └── types.ts               # 类型定义
│   ├── adapters/
│   │   ├── base.ts                # 适配器基类
│   │   ├── opencode/              # OpenCode 适配器
│   │   └── codex.ts               # Codex 适配器
│   ├── session/
│   │   └── manager.ts
│   ├── project/
│   │   └── manager.ts
│   ├── tui-commands/
│   │   └── ...
│   └── utils/
│       ├── error-codes.ts
│       ├── retry.ts
│       └── logger.ts
├── tests/                         # 测试文件
├── package.json
├── tsconfig.json
├── eslint.config.js
└── doc/
    └── MIGRATION.md               # 本文档
```

---

## 6. 依赖清单

### 6.1 核心依赖

```json
{
  "dependencies": {
    "@larksuiteoapi/node-sdk": "^1.60.0",
    "axios": "^1.7.0",
    "eventsource-parser": "^1.1.0",
    "js-yaml": "^4.1.0",
    "async-mutex": "^0.5.0",
    "p-throttle": "^6.2.0",
    "winston": "^3.13.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/js-yaml": "^4.0.9",
    "typescript": "^5.4.0",
    "tsx": "^4.11.0",
    "vitest": "^1.6.0",
    "eslint": "^9.0.0"
  }
}
```

### 6.2 依赖对照

| Python | Node.js | 用途 |
|--------|---------|------|
| `lark-oapi` | `@larksuiteoapi/node-sdk` | 飞书 SDK |
| `httpx` | `axios` | HTTP 客户端 |
| `httpx-sse` | `eventsource-parser` | SSE 流解析 |
| `pyyaml` | `js-yaml` | YAML 配置 |
| `asyncio.Lock` | `async-mutex` | 异步锁 |
| `logging` | `winston` | 日志 |

---

## 7. 实施计划

### 当前进度

| 日期 | 完成任务 | 状态 |
|------|---------|------|
| 2026-03-28 | Day 1: 项目初始化 | ✅ 完成 |
| 2026-03-28 | Day 2: 配置模块 (config.py → config.ts) | ✅ 完成 |
| - | Day 3: 飞书客户端封装 | ⏳ 待开始 |
| - | Day 4: API 封装层 | ⏳ 待开始 |
| - | Day 5: 类型定义完善 | ⏳ 待开始 |

**已完成文件**: `src/main.ts`, `src/core/config.ts`, `src/core/types/{config,stream,index}.ts`

---

### 第 1 周：基础设施 + 核心框架

| 天数 | 任务 | 产出 |
|------|------|------|
| 1 | 项目初始化、TypeScript 配置、依赖安装 | `package.json`, `tsconfig.json` |
| 2 | 配置模块迁移 (config.py → config.ts) | `src/config.ts` |
| 3 | 飞书客户端封装 (WebSocket 连接) | `src/feishu/client.ts` |
| 4 | API 封装层 (发送消息、Reaction、下载文件) | `src/feishu/api.ts` |
| 5 | 类型定义文件 | `src/feishu/types.ts`, `src/types/` |

### 第 2 周：核心业务逻辑

| 天数 | 任务 | 产出 |
|------|------|------|
| 6 | FlushController (节流/互斥锁) | `src/feishu/flush-controller.ts` |
| 7 | StreamingCardController (状态机) | `src/feishu/streaming-controller.ts` |
| 8 | 卡片构建器迁移 | `src/card-builder/` |
| 9 | 消息处理器 (handler.ts) | `src/feishu/handler.ts` |
| 10 | 命令路由 + TUI 命令 | `src/tui-commands/` |

### 第 3 周：适配器 + 集成

| 天数 | 任务 | 产出 |
|------|------|------|
| 11 | OpenCode 适配器 (HTTP/SSE) | `src/adapters/opencode/` |
| 12 | OpenCode 服务器管理器 | `src/adapters/opencode/server-manager.ts` |
| 13 | Codex 适配器 + 会话管理 | `src/adapters/codex.ts`, `src/session/` |
| 14 | 项目管理 + 入口文件 | `src/project/`, `src/main.ts` |
| 15 | 集成测试 + Bug 修复 | 可运行的完整系统 |

### 第 4 周：测试 + 优化

| 天数 | 任务 | 产出 |
|------|------|------|
| 16-17 | 单元测试编写 | `tests/` |
| 18-19 | 流式场景测试 (CardKit/降级) | 测试报告 |
| 20 | 性能优化 + 文档完善 | 优化报告 |

---

## 8. 风险与应对

| 风险 | 概率 | 影响 | 应对措施 |
|------|------|------|----------|
| SDK CardKit API 行为差异 | 中 | 高 | 第 1 周先验证 SDK 行为 |
| SSE 流边界处理差异 | 中 | 中 | 完整测试 OpenCode 流输出 |
| 状态机竞态条件 | 中 | 高 | 用 `async-mutex` 严格保护 |
| 类型定义不完整 | 低 | 低 | 手动补充类型 |

---

## 9. 验证清单

### 9.1 功能验证

- [ ] WebSocket 连接稳定
- [ ] CardKit 流式打字机效果
- [ ] IM Patch 降级路径
- [ ] OpenCode SSE 流解析
- [ ] 会话创建/切换/重置
- [ ] 项目管理命令
- [ ] /stop 命令中断
- [ ] 图片/文件附件处理
- [ ] Reaction 添加/移除

### 9.2 性能验证

- [ ] 流式更新间隔 100ms (CardKit)
- [ ] 降级模式间隔 1500ms (IM Patch)
- [ ] 内存无泄漏 (长时间运行)

---

## 10. 回滚计划

若迁移出现问题，保留 Python 代码在 `legacy/python` 分支，可快速切换回退。

```bash
# 回滚命令
git checkout legacy/python
pip install -r requirements.txt
python -m src.main
```

---

**文档版本**: 1.0
**创建日期**: 2026-03-27
**迁移负责人**: [待定]
