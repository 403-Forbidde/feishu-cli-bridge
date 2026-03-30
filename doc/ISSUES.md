# 问题追踪

## 待修复问题

### Issue #2: 飞书卡片 Markdown 格式渲染混乱

**状态**: 待修复
**日期**: 2026-03-28
**严重级别**: 高

#### 问题描述

OpenCode 回复内容在飞书卡片中的 Markdown 格式完全混乱，包括：
- 标题渲染异常
- 表格格式错乱
- 代码块显示不正常
- 整体排版混乱

#### 已尝试的修复（未解决问题）

1. **参考 OpenClaw 官方插件实现** - 已对比 `markdown-style.js` 和 `builder.js`
2. **修复正则表达式** - 将 `[\s\n]*` 改为 `[^\S\n]*`（匹配空白但不含换行）
3. **推理内容不经过 optimizeMarkdownStyle** - 仅对答案文本应用格式优化
4. **统一 CardKit 2.0 格式** - 所有卡片使用 `schema: '2.0'` 结构

#### 代码位置

- `src/platform/cards/utils.ts` - `optimizeMarkdownStyle()` 函数
- `src/platform/cards/streaming.ts` - 流式卡片构建
- `src/platform/cards/complete.ts` - 完成卡片构建
- `src/card-builder/utils.ts` - TUI 卡片构建器（另一个实现）

#### 待调查方向

- [ ] 检查飞书官方 CardKit 2.0 Markdown 渲染文档
- [ ] 对比 OpenClaw 插件实际 API 调用参数
- [ ] 确认卡片 `config` 和 `body` 结构是否正确
- [ ] 检查是否有其他代码路径绕过了 `optimizeMarkdownStyle`
- [ ] 统一两个 `optimizeMarkdownStyle` 实现（cards/utils.ts 和 card-builder/utils.ts）

#### 参考资源

- OpenClaw 插件: `/home/error403/.openclaw/extensions/openclaw-lark/src/card/`
- 飞书富文本文档: https://open.feishu.cn/document/feishu-cards/card-json-v2-components/content-components/rich-text
- 飞书 CardKit 流式更新: https://open.feishu.cn/document/cardkit-v1/streaming-updates-openapi-overview

---

## 已修复问题

### Issue #4: /session 会话管理卡片实现

**状态**: 已完成
**日期**: 2026-03-30
**严重级别**: 高

#### 功能概述

`/session` 命令提供完整的会话管理功能，包括列表展示、分页、切换、重命名、删除、新建等操作。

#### 技术要点

**1. Schema 2.0 卡片格式** (`src/platform/cards/session-cards.ts`)

```typescript
{
  schema: '2.0',
  header: {
    title: { tag: 'plain_text', content: '会话管理' },
    template: 'blue',
  },
  body: { elements: [...] }
}
```

**2. 按钮回调机制** (`src/platform/message-processor/index.ts`)

卡片按钮触发 `card.action.trigger` 事件（不是 `im.card.action.trigger_v1`）：

```typescript
private async handleCardAction(event: CardActionEvent): Promise<object> {
  const { action } = event;
  switch (action.value.action) {
    case 'switch_session':
      await this.handleSwitchSession(action.value);
      break;
    case 'rename_session_prompt':
      await this.handleRenamePrompt(action.value);
      break;
    // ...
  }
}
```

**3. 目录隔离实现** (`src/adapters/opencode/session-manager.ts`)

`listSessions()` 支持按目录过滤，确保只显示当前工作目录的会话：

```typescript
async listSessions(limit?: number, directory?: string): Promise<SessionInfo[]> {
  // 获取服务器所有会话
  const serverSessions = await this.httpClient.listSessions(limit * 2);
  // 合并本地缓存的工作目录信息
  const merged = serverSessions.map(s => {
    const local = this.findSessionById(s.id);
    return { ...s, workingDir: local?.workingDir || directory };
  });
  // 按目录过滤
  if (directory) {
    return merged.filter(s => s.workingDir === directory);
  }
}
```

**4. 当前会话标识** (`src/platform/cards/session-cards.ts`)

通过本地缓存判断当前激活会话，用绿色圆点标记：

```typescript
const isCurrent = sessionId === currentSessionId;
const title = isCurrent
  ? `🟢 **${sessionId}**  ...`  // 当前会话带绿点
  : `⚪ **${sessionId}**  ...`; // 非当前会话灰点
```

**5. 删除确认机制** (`src/platform/cards/session-cards.ts`)

双阶段确认防止误删：

```typescript
if (deletingSessionId === sessionId) {
  // 显示确认/取消按钮
  buttons = [
    { type: 'danger', value: { action: 'delete_session_confirm', ... } },
    { type: 'default', value: { action: 'cancel_delete', ... } }
  ];
} else {
  // 显示删除按钮
  buttons = [{ type: 'danger', value: { action: 'delete_session', ... } }];
}
```

**6. 会话切换后的缓存更新** (`src/adapters/opencode/session-manager.ts`)

切换成功后立即更新本地缓存，确保卡片显示正确：

```typescript
async switchSession(sessionId: string, workingDir?: string): Promise<boolean> {
  await this.httpClient.switchSession(sessionId);
  if (workingDir) {
    // 获取会话详情并更新本地缓存
    const detail = await this.httpClient.getSessionDetail(sessionId);
    this.sessions.set(normalizedDir, session);
    await this.save(); // 持久化
  }
}
```

**7. 分页实现** (`src/platform/cards/session-cards.ts`)

固定每页 5 条，最多显示 10 条（2 页）：

```typescript
const PAGE_SIZE = 5;
const MAX_DISPLAY = 10;

// 分页逻辑
const totalPages = Math.min(Math.ceil(totalCount / PAGE_SIZE), 2);

// 分页按钮
{
  tag: 'column_set',
  columns: [
    { tag: 'button', text: '⬅️ 上一页', disabled: page <= 1 },
    { tag: 'markdown', content: '**第 1/2 页**', text_align: 'center' },
    { tag: 'button', text: '下一页 ➡️', disabled: page >= totalPages }
  ]
}
```

**8. 卡片事件类型修正** (`src/platform/feishu-client.ts`)

飞书卡片按钮事件的正确事件名：

```typescript
// 错误
'im.card.action.trigger_v1'

// 正确
'card.action.trigger'
```

#### 相关代码位置

- `src/platform/cards/session-cards.ts` - 会话列表卡片构建
- `src/platform/message-processor/command-processor.ts` - /session 命令处理
- `src/platform/message-processor/index.ts` - 卡片按钮事件处理
- `src/adapters/opencode/session-manager.ts` - 会话管理逻辑
- `src/platform/feishu-client.ts` - WebSocket 事件注册

---

### Issue #3: 推理内容泄漏到正式回复卡片

**状态**: 已修复
**日期**: 2026-03-29
**严重级别**: 高

#### 问题描述

在飞书卡片中，AI 的推理/思考过程（reasoning）错误地显示在了正式回复中，导致：
1. 正式回复卡片中显示了内部思考过程
2. 同时 Markdown 格式渲染也出错（因为 reasoning 内容没有经过格式优化）

从日志可见问题：
```
[sendCompleteCard] completedText length: 0          ← 空的 completedText
[sendCompleteCard] accumulatedText length: 1771     ← 包含 reasoning
[sendCompleteCard] reasoningText length: 713
[sendCompleteCard] displayText preview: 用户想让我列出...  ← 与 reasoning 相同
```

#### 根因分析

1. **`completedText` 为空**：`StreamingCardController.onDeliver()` 从未被调用
2. **没有 DELIVER chunk**：OpenCode 适配器没有发出 `DELIVER` 类型的 chunk
3. **循环顺序问题**：即使添加了 `DELIVER`，它是在 `DONE` 之后发出的，但 `DONE` 会立即触发 `onComplete`，导致 `DELIVER` 来不及处理

#### 修复方案

**步骤 1: 添加 DELIVER chunk 类型** (`src/core/types/stream.ts`)
```typescript
export enum StreamChunkType {
  // ... 其他类型
  /** 完整内容传递（用于最终卡片构建） */
  DELIVER = 'deliver',
}
```

**步骤 2: AI 处理器处理 DELIVER** (`src/platform/message-processor/ai-processor.ts`)
```typescript
case StreamChunkType.DELIVER:
  // 完整内容传递，用于构建最终卡片
  await controller.onDeliver(chunk.data);
  break;
```

**步骤 3: SSE 解析器发出 DELIVER** (`src/adapters/opencode/sse-parser.ts`)
在流结束时累积所有内容，剥离 reasoning 后发出：
```typescript
// 累积所有内容用于 DELIVER
let accumulatedContent = '';
// ... 在处理每个 chunk 时累积 ...

// 发送 DELIVER chunk（完整内容，用于最终卡片构建）
const { answerText } = splitReasoningText(accumulatedContent);
const deliverText = answerText || accumulatedContent;
if (deliverText) {
  yield { type: StreamChunkType.DELIVER, data: deliverText };
}
```

**步骤 4: 修复核心问题** (`src/platform/message-processor/ai-processor.ts`)
由于 `DONE` 会立即结束循环，改为在流结束时直接调用 `onDeliver`：
```typescript
// 正常完成 - 使用 fullContent 作为最终文本（清理推理标签）
const { stripReasoningTags } = await import('../cards/utils.js');
const cleanedContent = stripReasoningTags(fullContent);

// 先调用 onDeliver 设置 completedText
await streamingController.onDeliver(cleanedContent);

// 然后调用 onComplete
await streamingController.onComplete(...);
```

#### 关键改进

1. **`completedText` 被正确填充**：通过 `onDeliver` 设置
2. **Reasoning 被剥离**：使用 `stripReasoningTags()` 清理嵌入的推理标签
3. **格式正确**：正式回复经过 `optimizeMarkdownStyle` 处理

#### 代码位置

- `src/core/types/stream.ts` - StreamChunkType 枚举
- `src/platform/message-processor/ai-processor.ts` - AI 处理器流处理逻辑
- `src/adapters/opencode/sse-parser.ts` - SSE 流解析器
- `src/platform/streaming/controller.ts` - StreamingCardController.onDeliver()

---

### Issue #1: 飞书卡片流式输出问题

**状态**: 已修复
**日期**: 2026-03-28

#### 修复内容

1. **CardKit API 调用修复** - `src/platform/feishu-api.ts`
   - 从 `batchUpdate` 改为 `cardElement.content`，与 OpenClaw 官方插件实现一致
   - 修复参数结构：`{ data: { content, sequence }, path: { card_id, element_id } }`

2. **卡片结构格式修复** - CardKit 2.0 格式统一
   - `buildStreamingCompleteCard` - 添加 `schema: '2.0'` 和 `body: { elements }`
   - `buildStoppedCard` - 同上
   - `buildErrorCard` - 同上

3. **移除不支持的 `collapse` 标签** - 已改用 `collapsible_panel` 替代

---

## 历史问题

| Issue | 标题 | 日期 | 状态 |
|-------|------|------|------|
| #4 | /session 会话管理卡片实现 | 2026-03-30 | 已完成 |
| #3 | 推理内容泄漏到正式回复卡片 | 2026-03-29 | 已修复 |
| #2 | 飞书卡片 Markdown 格式渲染混乱 | 2026-03-28 | 待修复 |
| #1 | 飞书卡片流式输出问题 | 2026-03-28 | 已修复 |


