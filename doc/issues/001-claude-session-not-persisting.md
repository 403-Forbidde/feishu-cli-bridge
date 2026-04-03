# Issue: Claude Code 适配器会话无法持久化

**状态**: ✅ 已修复  
**创建时间**: 2026-04-03  
**修复时间**: 2026-04-03  
**标签**: bug, claude-adapter, session-management

---

## 问题描述

Claude Code 适配器每次对话都会创建新会话，无法保持历史上下文。用户在同一工作目录下连续对话时，每次都被当作新会话处理。

---

## 复现步骤

1. 启动 feishu-bridge 服务
2. 在飞书客户端向 bot 发送消息（如 "你好"）
3. 等待回复完成后，再次发送消息（如 "刚才我说了什么"）
4. 观察日志，发现每次都会创建新的 session

---

## 期望行为

- 同一工作目录下的连续对话应该使用同一个 session
- 历史上下文应该被保持
- 第二次对话时应该通过 `--resume` 参数继续之前的会话

---

## 实际行为

每次对话都创建新的 session，从日志可以看到：

```
# 第一次对话
{"level":30,"time":...,"sessionId":"d3d32749-13e3-4688-a3e1-1a0879f12386","workingDir":"/code/feishu-cli-bridge","msg":"Created new session"}

# 第二次对话（同一工作目录）
{"level":40,"time":...,"sessionId":"d3d32749-13e3-4688-a3e1-1a0879f12386","workingDir":"/code/feishu-cli-bridge","msg":"Session not found in CLI, creating new session"}
{"level":30,"time":...,"sessionId":"7201a384-71cf-4345-b9e0-1f76ca5eb650","workingDir":"/code/feishu-cli-bridge","msg":"Created new session"}
```

---

## 环境信息

- **Claude Code CLI 版本**: 2.1.91
- **适配器版本**: v0.2.1
- **Node.js 版本**: 20.x
- **操作系统**: Linux 6.17.0-19-generic

---

## 初步分析

### 1. CLI 会话文件格式

Claude Code CLI 在 `~/.claude/sessions/{pid}.json` 中存储会话信息：

```json
{
  "pid": 312424,
  "sessionId": "e4e9b1a6-1cfe-4111-91ce-c07ecb7a4017",
  "cwd": "/code/feishu-cli-bridge",
  "startedAt": 1775194524150,
  "kind": "interactive",
  "entrypoint": "cli"
}
```

注意：CLI 生成的 `sessionId` 是 UUID 格式，与 pid 不同。

### 2. 适配器会话映射文件

适配器使用 `.claude-sessions.json` 存储 workingDir -> sessionId 的映射：

```json
{
  "version": 2,
  "sessions": {}
}
```

当前文件为空，说明映射没有正确保存或加载。

### 3. 可能的根因

1. **session_id 捕获失败**: 可能 `system` 事件的 `session_id` 字段解析有问题
2. **映射保存失败**: `saveSessionMapping` 可能没有正确写入文件
3. **CLI 忽略 --session-id**: 传入的 `--session-id` 参数被 CLI 忽略，导致每次都生成新的 session
4. **--resume 参数问题**: `--resume` 参数可能没有正确传递或使用

### 4. 关键代码位置

- `src/adapters/claude/adapter.ts:175-190` - 尝试从 system 事件捕获 session_id
- `src/adapters/claude/session-manager.ts:85-110` - 保存会话映射
- `src/adapters/claude/process-manager.ts:297-333` - 构建命令参数

---

## 调试建议

1. 添加详细日志验证 `system` 事件中的 `session_id` 是否被正确捕获
2. 验证 `.claude-sessions.json` 文件权限和写入是否成功
3. 手动测试 Claude Code CLI 的 `--resume` 参数行为：
   ```bash
   # 第一次运行（获取 session_id）
   claude -p "hello" --output-format stream-json --verbose
   
   # 第二次运行（尝试 resume）
   claude -p "world" --output-format stream-json --verbose --resume <session_id>
   ```

---

## 相关文件

- `src/adapters/claude/adapter.ts`
- `src/adapters/claude/session-manager.ts`
- `src/adapters/claude/process-manager.ts`
- `src/adapters/claude/types.ts`
- `.claude-sessions.json` (运行时生成)

---

## 修复方案

### 根因分析

Claude Code 在使用 `-p` (headless) 模式时，**不会在 `~/.claude/sessions/` 目录下创建持久化的会话文件**。会话文件只在交互模式下创建。

这导致 `session-manager.ts` 中的两个方法出现问题：

1. **`validateSessionExists()`**: 只在 CLI 会话文件中查找会话，导致 headless 模式下总是返回 false
2. **`syncWithCLISessions()`**: 当找不到 CLI 会话文件时，会错误地将所有映射标记为过期并删除

### 修复内容

**文件**: `src/adapters/claude/session-manager.ts`

1. **修改 `validateSessionExists()`**: 
   - 改为始终返回 `true`，信任适配器自己的映射
   - 实际的会话有效性由 `--resume` 调用来验证（如果会话不存在，CLI 会返回错误）

2. **修改 `syncWithCLISessions()`**:
   - 当没有 CLI 会话文件时（headless 模式），跳过同步，不做清理
   - 只清理那些在 CLI 中有记录但 sessionId 不匹配的映射（交互模式下的场景）

### 修复代码

```typescript
/**
 * 验证会话是否存在于 CLI 中
 *
 * 注意：Claude Code 在使用 -p (headless) 模式时，不会在 ~/.claude/sessions/ 下
 * 创建持久化的会话文件。因此不能完全依赖 CLI 会话文件的存在性来判断。
 */
private async validateSessionExists(_sessionId: string): Promise<boolean> {
  // 在 headless 模式下，CLI 不会创建持久的会话文件
  // 所以我们信任自己的映射，让实际的 --resume 调用来验证会话有效性
  return true;
}
```

```typescript
/**
 * 同步 CLI 会话文件，清理过期映射
 *
 * 注意：Claude Code 在使用 -p (headless) 模式时，不会在 ~/.claude/sessions/ 下
 * 创建持久化的会话文件。
 */
private async syncWithCLISessions(): Promise<void> {
  try {
    const cliSessions = await this.loadCLISessions();

    // 如果没有 CLI 会话文件，可能是在 headless 模式下运行
    // 此时我们信任自己的映射，不做清理
    if (cliSessions.length === 0) {
      logger.debug('No CLI session files found, skipping sync (likely running in headless mode)');
      return;
    }

    // 只清理那些在 CLI 中有记录但 sessionId 不匹配的映射
    // ...
  } catch (error) {
    logger.debug({ err: error }, 'Failed to sync with CLI sessions');
  }
}
```

### 测试验证

- [x] 单元测试全部通过 (64 tests)
- [ ] 集成测试：普通消息流式输出
- [ ] 集成测试：图片附件 `@` 引用
- [ ] 集成测试：长文本上下文
- [ ] 集成测试：`/stop` 中断
- [ ] 集成测试：`/new` 新会话
- [ ] 集成测试：项目切换

## 参考文档

- `doc/claude-stream-format.md` - Stream JSON 格式说明
- `CLAUDE.md` - Claude Code 适配器设计文档
