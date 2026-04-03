# Claude Code Stream JSON 格式说明

> 验证环境：Claude Code v2.1.91
> 验证时间：2026-04-03

## 一、基础 Headless 调用方式

```bash
claude -p "prompt text" \
  --output-format stream-json \
  --include-partial-messages \
  --verbose \
  --session-id "<uuid>"
```

**关键参数说明：**
- `-p, --print`: 非交互模式，输出结果后退出
- `--output-format stream-json`: 流式 JSON 输出（必须配合 `--verbose`）
- `--include-partial-messages`: 包含部分消息增量
- `--verbose`: 启用详细输出（stream-json 模式必需）
- `--session-id <uuid>`: 指定会话 ID（必须是有效 UUID）

## 二、Stream JSON 事件类型

### 1. 系统初始化事件

```json
{
  "type": "system",
  "subtype": "init",
  "cwd": "/current/working/dir",
  "session_id": "xxx",
  "model": "kimi-for-coding",
  "permissionMode": "default",
  "claude_code_version": "2.1.91"
}
```

**重要说明**：`model` 字段显示的是实际使用的模型，可能因配置不同而变化：
- 使用 Anthropic API 时：`claude-sonnet-4-6`、`claude-opus-4-6` 等
- 使用第三方 Provider（如 Kimi）时：`kimi-for-coding` 等
- 实际模型信息会在 `result.modelUsage` 中详细展示

### 2. 消息开始事件

```json
{
  "type": "stream_event",
  "event": {
    "type": "message_start",
    "message": {
      "id": "msg_xxx",
      "usage": {
        "input_tokens": 20926,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 0
      }
    }
  },
  "session_id": "xxx"
}
```

### 3. 思考内容块（Reasoning）

```json
{
  "type": "stream_event",
  "event": {
    "type": "content_block_delta",
    "index": 0,
    "delta": {
      "type": "thinking_delta",
      "thinking": "thinking content..."
    }
  }
}
```

### 4. 文本内容块（Content）

```json
{
  "type": "stream_event",
  "event": {
    "type": "content_block_delta",
    "index": 1,
    "delta": {
      "type": "text_delta",
      "text": "Hello!"
    }
  }
}
```

### 5. Token 用量更新

```json
{
  "type": "stream_event",
  "event": {
    "type": "message_delta",
    "delta": { "stop_reason": "end_turn" },
    "usage": {
      "input_tokens": 9662,
      "output_tokens": 39,
      "completion_tokens": 39,
      "total_tokens": 20965,
      "cache_read_input_tokens": 11264
    }
  }
}
```

### 6. 消息结束事件

```json
{
  "type": "stream_event",
  "event": { "type": "message_stop" }
}
```

### 7. 最终结果事件

```json
{
  "type": "result",
  "subtype": "success",
  "is_error": false,
  "result": "完整的回复文本",
  "session_id": "xxx",
  "total_cost_usd": 0.032,
  "usage": {
    "input_tokens": 9662,
    "output_tokens": 39,
    "completion_tokens": 39,
    "total_tokens": 20965
  },
  "modelUsage": {
    "kimi-k2.5": {
      "inputTokens": 180,
      "outputTokens": 34,
      "cacheReadInputTokens": 20736,
      "cacheCreationInputTokens": 0,
      "costUSD": 0.007,
      "contextWindow": 200000,
      "maxOutputTokens": 32000
    }
  }
}
```

**注意**：`modelUsage` 的 key 是实际使用的模型名称，可能因 Provider 配置而不同。适配器应从此字段动态读取模型信息，而不是硬编码。

### 8. 用户中断事件

当发送 SIGINT 信号时：

```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": [{"type": "text", "text": "[Request interrupted by user]"}]
  }
}
```

```json
{
  "type": "result",
  "subtype": "error_during_execution",
  "is_error": true,
  "terminal_reason": "aborted_streaming",
  "errors": ["Error: Request was aborted."]
}
```

## 三、事件映射到 StreamChunk

| Claude 事件 | StreamChunkType | 说明 |
|------------|-----------------|------|
| `content_block_delta` + `thinking_delta` | `REASONING` | 思考过程 |
| `content_block_delta` + `text_delta` | `CONTENT` | 回复内容 |
| `message_delta` (含 usage) | `STATS` | Token 统计 |
| `message_stop` / `result` (success) | `DONE` | 完成信号 |
| `result` (error) | `ERROR` | 错误信号 |

## 四、会话管理

### 创建新会话

```bash
SESSION_ID=$(python3 -c "import uuid; print(uuid.uuid4())")
claude -p "Hello" --session-id "$SESSION_ID" --output-format stream-json --verbose
```

### 恢复会话

```bash
# 恢复并复用原 session ID
claude -p "Follow up" --resume "$SESSION_ID" --output-format stream-json --verbose

# 恢复并创建新的 session ID（fork）
NEW_ID=$(python3 -c "import uuid; print(uuid.uuid4())")
claude -p "Follow up" --resume "$SESSION_ID" --fork-session --session-id "$NEW_ID" \
  --output-format stream-json --verbose
```

## 五、Token 统计提取方案

**结论：采用精确模式**

Token usage 可从以下位置精确获取：

1. **流式过程中的 `message_delta` 事件**
   - `usage.output_tokens`: 输出 token 数
   - `usage.completion_tokens`: 完成 token 数
   - `usage.cache_read_input_tokens`: 缓存命中 token 数

2. **最终结果中的 `result.usage` 和 `result.modelUsage`**
   - 包含完整的 input/output/completion/total tokens
   - 包含费用估算 `total_cost_usd`

**适配器实现策略：**
- 在 `stream-parser.ts` 中捕获 `message_delta` 的 usage 并缓存
- 在 `result` 事件时统一汇总并 yield STATS chunk
- `getStats()` 方法返回最后一次缓存的 usage 数据

## 六、文件引用语法

Claude Code 原生支持 `@filepath` 语法引用本地文件：

```bash
claude -p "请分析 @/path/to/file.txt 的内容" --output-format json
```

**实现建议：**
- 附件处理器下载文件到临时目录
- 在 prompt 中通过 `@/absolute/path` 引用
- 注意文件大小限制（建议不超过 5MB）

## 七、停止生成机制

通过向子进程发送 `SIGINT` 信号（Ctrl+C）：

```typescript
process.kill('SIGINT');
```

Claude Code 会优雅地终止请求并返回 `aborted_streaming` 状态。

如果 SIGINT 无效，可降级为 `SIGTERM` 或 `SIGKILL`。

## 八、关键配置参数

```yaml
cli:
  claude:
    enabled: true
    command: claude
    # 模型配置：支持动态从流输出中读取，或手动指定
    # 实际使用的模型取决于 ~/.claude/settings.json 中的 Provider 配置
    default_model: auto  # auto | claude-sonnet-4-6 | claude-opus-4-6 | kimi-k2.5 | ...
    context_window: auto # auto | 200000 | 256000 等，auto 表示从 stream 输出中读取
    timeout: 300         # 秒
    permission_mode: acceptEdits  # default | acceptEdits | plan | bypassPermissions
    allowed_tools: ["Bash", "Read", "Edit", "Grep", "Glob"]
```

### 关于模型配置的说明

**为什么 `default_model` 应该是动态的？**

Claude Code CLI 支持通过 `ANTHROPIC_BASE_URL` 配置第三方 Provider（如 Kimi、OpenRouter 等）：

```json
// ~/.claude/settings.json
{
  "env": {
    "ANTHROPIC_API_KEY": "sk-kimi-xxxxx",
    "ANTHROPIC_BASE_URL": "https://api.kimi.com/coding/"
  }
}
```

此时实际运行的模型可能是 `kimi-k2.5` 而非 `claude-sonnet-4-6`，返回的 `modelUsage` 中也会显示实际的模型信息。

**适配器实现策略：**

1. **静态配置模式**：用户在 `config.yaml` 中明确指定模型名和参数
2. **动态检测模式**（推荐）：
   - 首次启动时不指定 `--model` 参数，或保留 CLI 的默认配置
   - 从 `system` 初始化事件或 `result.modelUsage` 中读取实际使用的模型
   - 缓存模型信息供后续请求使用

**子进程构建参数示例：**

```typescript
const args = [
  '-p', prompt,
  '--output-format', 'stream-json',
  '--include-partial-messages',
  '--verbose',
  '--session-id', sessionId,
  // 仅在用户明确配置时添加 --model 参数
  ...(config.defaultModel && config.defaultModel !== 'auto' 
      ? ['--model', config.defaultModel] 
      : []),
  `--permission-mode`, config.permissionMode,
  ...(config.allowedTools.length ? ['--tools', config.allowedTools.join(',')] : []),
];

if (isResume) {
  args.push('--resume', previousSessionId, '--fork-session');
}
```

**动态获取模型信息：**

```typescript
// 从初始化事件中提取
interface SystemInitEvent {
  type: 'system';
  subtype: 'init';
  model: string;  // e.g., "kimi-for-coding"
}

// 从结果中提取详细模型信息
interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  contextWindow: number;  // 实际的上下文窗口大小
  maxOutputTokens: number;
  costUSD: number;
}
```
