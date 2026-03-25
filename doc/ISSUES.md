# 问题追踪

## 活跃问题（待修复）

| Issue | 描述 | 优先级 | 相关文件 |
|-------|------|--------|----------|
| #52 | 需要 `/stop` 命令强制停止模型输出 | 中 | `src/feishu/handler.py`, `src/feishu/api.py`, `src/adapters/opencode.py` |
| #51 | `/session` 命令在无会话时返回格式难看 | 低 | `src/feishu/handler.py`, `src/feishu/card_builder.py` |
| #16 | `FeishuClient._parse_message` 解析结果丢弃，重复解析 | 高 | `src/feishu/client.py`, `src/feishu/handler.py` |
| #17 | `_stream_reply_legacy` 丢失 `reply_to` 参数 | 高 | `src/feishu/api.py` |
| #18 | `SessionManager._save_session` 同步阻塞事件循环 | 高 | `src/session/manager.py` |
| #19 | `_patch_card` 每次回调重建 SDK Client | 高 | `src/feishu/client.py` |
| #20 | `handler.py` 重复 TUI 命令检测（死代码） | 高 | `src/feishu/handler.py` |
| #21 | 附件保存路径穿越风险 | 中 | `src/feishu/api.py` |
| #24 | `_beautify_list_items` 是完全空操作 | 中 | `src/feishu/card_builder.py` |
| #25 | `formatter.py` 大量死代码待清理 | 低 | `src/feishu/formatter.py` |
| #50 | 测试卡片代码待删除 | 低 | `src/tui_commands/testcard.py`, `src/feishu/card_builder.py:779-1200+` |

---

## Issue #52 详情（新增）

**标题**: 需要 `/stop` 命令强制停止模型输出

**状态**: ⏳ 待处理

**优先级**: 中

**描述**:
当用户发送了错误的指令或模型正在生成不期望的输出时，需要一个 `/stop` 命令来强制中断模型的思考和输出过程。

**使用场景**:
1. 用户发送了错误/不完整的 prompt，想立即中断而不是等待完成
2. 模型进入了无限循环或冗长输出
3. 用户意识到问题提错了，想快速终止当前会话

**期望行为**:
- 发送 `/stop` 后立即中断当前进行中的 AI 流式输出
- 停止显示"打字中"状态
- 可选：发送一个 Toast 通知或简短文本确认已停止
- 停止后可以继续发送新消息开始新的对话

**技术难点**:
1. **流式输出中断**: 需要与 `api.stream_reply()` 协作，传入一个可取消的标识
2. **适配器层支持**: OpenCode HTTP/SSE 流需要支持中断连接或发送取消信号
3. **多并发处理**: 需要确保停止的是当前用户的请求，不影响其他用户
4. **状态同步**: 需要同步更新卡片状态（如果使用了 CardKit 流式卡片）

**相关代码**:
- `src/feishu/api.py` - `stream_reply()` 方法需要支持取消机制
- `src/feishu/handler.py` - `_handle_ai_message()` 需要处理 stop 信号
- `src/adapters/opencode.py` - SSE 流需要支持中断
- `src/feishu/streaming_controller.py` - 流式卡片状态管理

**实现思路**:
```python
# 方案1: 使用 asyncio.Event 作为取消信号
stop_event = asyncio.Event()

async def execute_stream(...):
    async for chunk in sse_stream:
        if stop_event.is_set():
            break
        yield chunk

# 方案2: 使用 asyncio.Task.cancel()
task = asyncio.create_task(stream_reply(...))
task.cancel()
```

**备注**: 这是一个功能性增强需求，非紧急修复。

---

## Issue #51 详情（新增）

**标题**: `/session` 命令在无会话时返回格式难看

**状态**: ⏳ 待处理

**优先级**: 低

**描述**:
切换到一个新项目目录后，使用 `/session` 命令显示会话，如果该项目没有会话，会返回一个格式不美观的纯文本消息：

```
ℹ️ 暂无历史会话

**工作目录:** `/code/test`
发送 `/new` 创建新会话
```

**问题**:
1. 消息使用纯文本格式，在飞书卡片中显示不美观
2. 缺少适当的引导性UI元素
3. 与项目列表卡片（`/pl`）的视觉风格不一致

**期望行为**:
返回一个美观的卡片消息，包含：
- 清晰的空状态提示图标
- 当前工作目录信息
- 明显的 `/new` 命令引导按钮或链接

**相关代码**:
- `src/feishu/handler.py` - `_handle_tui_command` 或 `_build_session_data_list` 方法
- `src/feishu/card_builder.py` - 可能需要新增空状态卡片构建函数

**截图**:
见 `doc/erro.png`

---

## Issue #50 详情（新增）

**标题**: Schema 2.0 测试卡片代码待删除

**状态**: ⏳ 待处理（不影响运行，后期清理）

**优先级**: 低

**描述**:
`/testcard2` 命令及相关测试卡片代码为开发调试用途，共 4 个状态函数：
- `build_test_card_v2_initial()` - 初始状态
- `build_test_card_v2_details()` - 详情状态
- `build_test_card_v2_data()` - 数据展示状态
- `build_test_card_v2_closed()` - 结束状态

**待删除文件/代码**:
- `src/tui_commands/testcard.py` - 整个文件
- `src/feishu/card_builder.py` - 第 779 行起所有 `build_test_card_v2_*` 函数
- `src/feishu/handler.py` - 第 897-961 行 `test_card_action` 处理逻辑

**备注**: 当前不影响项目运行，可在后续重构时清理。

---

## 已修复问题摘要

| Issue | 标题 | 修复版本 | 修复日期 |
|-------|------|----------|----------|
| #40 | 上下文百分比计算不准确 | v0.1.8 | 2026-03-24 |
| #45 | `asyncio.Lock` 事件循环绑定错误 | v0.1.8 | 2026-03-24 |
| #32/#33 | 会话改名交互失败、交互式回复卡片空白 | v0.1.8 | 2026-03-24 |
| #34-#39 | Session 管理重构相关问题 | v0.1.7 | - |
| #27-#28 | 外部目录权限阻塞、工具调用后无文字回复 | v0.1.5 | - |

**详细修复记录**: 见 `doc/CHANGELOG.md`

---

## 已知问题

### LSP 类型检查误报

**状态**: ⚠️ 已知，不影响运行

VS Code / LSP 显示大量类型错误（如 `"v1" is not a known attribute of "None"`），系 lark_oapi SDK 类型定义不完整所致。仅影响开发体验，不影响实际运行。

---

## 技术决策记录

### Issue #10: /session 命令在飞书客户端下作用有限

**状态**: 🔍 待讨论

**问题描述**: `/session` 命令返回纯文本会话列表，用户回复数字切换。在飞书客户端中存在局限：使用场景稀少、列表不美观、`/new` 已覆盖核心需求。

**暂定决策**: 不做修改，保留现状，等待进一步使用反馈后再决定去留。
