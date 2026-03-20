# 问题追踪

## 已修复

### Issue #1: CardKit 更新失败 `code=200610 body is nil`

**状态**: ✅ 已修复  
**时间**: 2026-03-20  
**影响版本**: v0.0.0 → v0.0.1

**问题描述**:  
流式输出完成后，调用 CardKit `update_card()` 更新最终卡片时失败，返回错误 `code=200610, msg=ErrMsg: body is nil`。

**根本原因**:  
`card_builder.py` 中的 `complete` 卡片输出的是旧格式 Schema 1.0（`{"config":..., "elements":[...]}}`），而 CardKit API 要求 Schema 2.0 格式（`{"schema":"2.0", "body":{"elements":[...]}}}`）。

**修复方案**:  
将所有卡片（`thinking`/`streaming`/`complete`）统一改为 Schema 2.0 格式：
```python
{
    "schema": "2.0",
    "config": {"wide_screen_mode": True, "update_multi": True},
    "body": {"elements": [...]}
}
```

**相关文件**: `src/feishu/card_builder.py`

---

### Issue #2: IM Patch 跨 Schema 失败 `code=230099 schemaV2 card can not change schemaV1`

**状态**: ✅ 已修复  
**时间**: 2026-03-20  
**影响版本**: v0.0.0 → v0.0.1

**问题描述**:  
CardKit 失败回退到 IM Patch 模式时，`update_card_message` 返回错误 `code=230099 schemaV2 card can not change schemaV1`。

**根本原因**:  
CardKit 使用 Schema 2.0 创建卡片，但 IM Patch 回退时发送的是 Schema 1.0 格式的更新内容，飞书不允许跨 Schema 版本 patch。

**修复方案**:  
与 Issue #1 一同修复，所有卡片统一使用 Schema 2.0 格式。

**相关文件**: `src/feishu/card_builder.py`

---

### Issue #3: 流式输出内容截断/乱码

**状态**: ✅ 已修复  
**时间**: 2026-03-20  
**影响版本**: v0.0.0 → v0.0.1

**问题描述**:  
流式输出时，内容显示不完整或乱码（如 "isely based on my actual capabilities"），然后突然全部出现。

**根本原因**:  
`streaming_controller.py` 的 `on_content_stream` 将 OpenCode 适配器发送的 delta（增量）当作全量文本处理：
```python
# 错误代码
self.text.accumulated_text = text  # text 是 delta，如 "Hello"
```
导致每次新 delta 到来时覆盖已有内容。

**修复方案**:  
改为累积追加模式：
```python
# 正确代码
self.text.accumulated_text += text  # 累积追加
```

**相关文件**: `src/feishu/streaming_controller.py`

---

### Issue #4: 思考阶段空白/无内容显示

**状态**: ✅ 已修复  
**时间**: 2026-03-20  
**影响版本**: v0.0.0 → v0.0.1

**问题描述**:  
AI 思考时卡片只显示空白，没有思考内容，然后突然跳到回答。

**根本原因**:  
1. `STREAMING_THINKING_CARD` 缺少 `loading_icon` 元素，没有动态加载动画
2. OpenCode 适配器的 REASONING 事件高频重复触发，造成无效更新

**修复方案**:  
1. 在 `STREAMING_THINKING_CARD` 中加入 `loading_icon` 元素（飞书 CDN 官方图标）
2. OpenCode 适配器添加 REASONING 去重逻辑，只在文本实际变化时 yield

**相关文件**: 
- `src/feishu/streaming_controller.py`
- `src/adapters/opencode.py`

---

### Issue #5: 消息无引用气泡

**状态**: ✅ 已修复  
**时间**: 2026-03-20  
**影响版本**: v0.0.0 → v0.0.1

**问题描述**:  
AI 回复的卡片不显示"回复 XXX: 内容"引用气泡，用户无法看出是回复哪条消息。

**根本原因**:  
使用 `im.v1.message.create` API 发送消息，该 API 不支持引用回复功能。

**修复方案**:  
改用 `im.v1.message.reply` API：
- 新增 `ReplyMessageRequest` 支持
- `send_card_message()` 和 `send_card_by_card_id()` 在有 `reply_to` 时使用 reply 接口
- `handler.py` 将 `message.message_id` 作为 `reply_to_message_id` 传入

**相关文件**: 
- `src/feishu/api.py`
- `src/feishu/handler.py`
- `src/feishu/streaming_controller.py`

---

## 已知问题

### LSP 类型检查误报

**状态**: ⚠️ 已知，不影响运行  
**优先级**: 低

**问题描述**:  
VS Code / LSP 显示大量类型错误，如：
- `"v1" is not a known attribute of "None"`
- `"message_id" is not a known attribute of "None"`

**根本原因**:  
lark_oapi SDK 的类型定义不完整，导致 LSP 无法正确推断响应类型。

**影响**:  
仅影响开发体验，不影响实际运行。所有 API 调用在运行时正常工作。

**缓解措施**:  
运行时验证通过，所有功能测试正常。

---

## 待优化

### 1. 适配器类型注解统一

**描述**:  
`BaseCLIAdapter.execute_stream` 返回类型声明为 `AsyncIterator[StreamChunk]`，但子类实现返回 `CoroutineType[Any, Any, AsyncIterator[StreamChunk]]`，造成 LSP 警告。

**建议**:  
统一改为异步生成器函数签名，消除类型警告。

---

### 2. 心跳和连接稳定性

**描述**:  
WebSocket 长连接在弱网环境下可能断开，当前重连逻辑较简单。

**建议**:  
- 添加指数退避重连
- 心跳检测
- 断线恢复后自动续传

---

## 功能建议

### 1. 多轮对话历史显示优化

当前历史以纯文本存储，建议添加结构化显示（如折叠、时间戳）。

### 2. 支持图片和文件输入

飞书支持图片/文件消息，当前仅处理文本，建议扩展支持多模态输入。

### 3. 会话持久化到云端

当前会话存储在本地 `.sessions/` 目录，建议支持云存储或数据库。

