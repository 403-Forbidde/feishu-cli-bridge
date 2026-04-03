# Issue: Claude Code 适配器图片附件识别失效

**状态**: 未解决，需要进一步调查  
**发现时间**: 2026-04-03  
**相关文件**: `src/adapters/claude/adapter.ts`, `src/adapters/claude/process-manager.ts`, `src/platform/message-processor/ai-processor.ts`

## 症状

用户在 Feishu 中发送带有图片的消息（如"描述图片"），Claude Code 适配器：
- 能成功下载图片附件（`messageResource.get` 返回 200）
- 但 Claude Code 完全无法识别图片内容，有时甚至会报告"图片损坏"或完全没有响应

## 已尝试的修复及其结果

### 1. 修复消息解析（✅）
**修改**: `src/platform/feishu-client.ts` 的 `parseMessageEvent`
- 之前 `post` / `image` 类型消息中的 `image_key` 被丢弃
- 现在已能正确提取 `image_key` 并组装到 `message.attachments`

### 2. 修复附件下载 API（✅）
**修改**: `src/platform/feishu-api.ts` 的 `downloadMessageResource`
- 之前使用 `im.v1.file.get` / `im.v1.image.get`，但这两个接口只能下载**机器人自己上传**的文件
- 已改为使用 `im.v1.messageResource.get`，这是飞书官方用于下载用户发送的附件（图片/文件）的接口
- 验证：日志显示 `total=1, success=1`，图片能成功下载到临时目录

### 3. 修复附件数据保留（✅）
**修改**: `src/platform/message-processor/attachment-processor.ts`
- 之前下载后的图片只做了 base64 编码，没有保留原始 `Buffer` 和 `localPath`
- 现在 `ProcessedAttachment` 会填充 `data`、`localPath`，供下游适配器使用

### 4. 修复命令行参数过长导致的 E2BIG（✅ 但引入了新问题）
**修改**: `src/platform/message-processor/ai-processor.ts` + `src/adapters/claude/process-manager.ts`

**问题**: 当 `buildPrompt` 把 base64 `dataUrl` 直接拼进 prompt 时，传给 `claude` 子进程的 `-p` 参数会超过操作系统命令行长度限制（`spawn E2BIG`）。

**修复尝试**:
- `ai-processor.ts`: `buildPrompt` 不再拼接 base64，只附加 `[附件: filename]` 的文本提示
- `process-manager.ts`: **移除 `-p` 参数，改为通过 `stdin` 向子进程发送 prompt**

**结果**:
- E2BIG 错误消失，进程能正常启动
- **但 Claude Code 完全没有任何输出**，说明它可能：
  1. **不支持通过标准输入读取 prompt**（至少默认模式下不支持）
  2. 需要某个特定命令行参数（如 `-p -`）来启用 stdin 模式
  3. 在收到 stdin 后行为异常（因为没有 `-p` 时 CLI 不知道应该把 stdin 当作 prompt）

## 当前状态

日志显示：
```
Starting Claude Code process in /code/feishu-cli-bridge
Claude Code process started successfully
... （之后没有任何 stdout 输出）
```

这表明：
- 子进程已启动且没有立即退出
- 但进程没有产生任何 `stream-json` 数据
- 推测 `claude` CLI 在**没有 `-p` 参数时**不会把 stdin 内容当作 prompt 执行

## 根本原因假设

1. **Claude Code CLI 的 `-p` 参数是必需的**
   - 之前的普通文本消息一直使用 `-p prompt`，工作正常
   - 一旦移除 `-p`，即使是普通文本也没有响应
   - 因此 CLI 很可能不支持纯 stdin 模式，或需要特定的调用约定

2. **图片附件无法通过 `@filepath` 传给 Claude Code**
   - 当前 `claude/adapter.ts` 的 `buildFullPrompt` 会追加 `@/path/to/image.png`
   - 但尚不确定 Claude Code CLI 是否支持这种多模态输入语法
   - 之前的"图片损坏"反馈可能正是因为 CLI 尝试解析 `@filepath` 但处理失败

3. **需要一种不通过 `-p` 参数传递大 prompt 的替代方案**
   - 例如：将 prompt 先写入临时文件，再用 `claude -p $(cat file.txt)`
   - 或者使用某种环境变量 / API 方式传递图片
   - 或者考虑通过 MCP / files API 让 Claude Code 读取图片

## 下一步建议

1. **验证 stdin 是否真的有效**
   - 在终端手动测试：`echo "hello" | claude --output-format stream-json --bare`
   - 观察是否有输出，确认 CLI 是否支持无 `-p` 的 stdin 模式

2. **如果 CLI 必须依赖 `-p`，需要重新设计大 prompt 传递方案**
   - 选项 A：prompt 写入临时文件，通过 `claude -p "$(cat /tmp/prompt.txt)"` — 但仍可能触及长度限制
   - 选项 B：调研 Claude Code CLI 是否有官方的多模态 / 图片输入方式
   - 选项 C：考虑使用 `claude_code` 的 Python API 或 MCP server 替代直接 spawn CLI

3. **暂时回滚 stdin 改动**
   - 在找到正确的图片传递方案之前，可以回滚 `process-manager.ts`，恢复 `-p` 参数
   - 同时限制 `buildPrompt` 中不再塞 base64（避免 E2BIG）
   - 先保证普通文本消息可用，再单独攻克图片输入

## 相关日志

```
# 消息到达，附件下载成功
total=1, success=1

# 启动 Claude Code 进程成功
Claude Code process started successfully

# system init 正常（模型检测正常）
model=kimi-k2.5, version=2.1.91

# 但随后没有任何 stream-json 输出
# 进程最终在后续消息触发时被 SIGINT 终止
```
