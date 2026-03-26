# 问题追踪

## 活跃问题（待修复）

| Issue | 描述 | 优先级 | 相关文件 |
|-------|------|--------|----------|
| #55 | 每个工作目录会话列表最多显示最新10条 | 中 | `src/tui_commands/interactive.py`, `src/feishu/card_builder.py` |
| #54 | Session 名称自动更新为首次对话内容 | 中 | `src/feishu/handler.py`, `src/session/manager.py` |
| #53 | `/pl` 命令显示工作目录和项目信息 | 中 | `src/tui_commands/interactive.py`, `src/feishu/card_builder.py` |
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

## Issue #55 详情（新增）

**标题**: 每个工作目录会话列表最多显示最新10条

**状态**: ⏳ 待处理

**优先级**: 中

**描述**:
当前使用 `/session` 或 `/pl` 命令显示会话列表时，如果一个工作目录下有大量会话，会一次性全部展示，导致卡片过长、信息过载。需要限制每个工作目录最多只显示最新的10条会话。

**期望行为**:
1. 每个工作目录的会话列表最多显示10条最新的会话
2. 按最后更新时间倒序排列（最新的在前）
3. 如果超过10条，在列表底部显示提示："还有 N 条历史会话未显示"
4. 可选：提供 `/session all` 或翻页按钮查看全部会话

**使用场景**:
- 长期使用后某个项目积累了几十个会话，列表不会变得冗长
- 用户最关心的是最近的会话历史
- 保持卡片界面整洁，提升可读性

**相关代码**:
- `src/tui_commands/interactive.py` - `/session` 和 `/pl` 命令处理逻辑
- `src/feishu/card_builder.py` - 会话列表卡片构建
- `src/session/manager.py` - 会话列表获取和排序

**实现思路**:
```python
# 获取会话列表时限制数量
sessions = session_manager.get_sessions(working_dir)
sessions_sorted = sorted(sessions, key=lambda s: s.updated_at, reverse=True)
display_sessions = sessions_sorted[:10]
remaining_count = len(sessions_sorted) - 10

# 构建卡片时显示提示
if remaining_count > 0:
    footer_text = f"还有 {remaining_count} 条历史会话未显示"
```

---

## Issue #54 详情（新增）

**标题**: Session 名称自动更新为首次对话内容

**状态**: ⏳ 待处理

**优先级**: 中

**描述**:
当前 Session 名称默认为空或使用工作目录名称，用户难以区分不同会话的用途。需要在用户第一次发送消息时，自动将 Session 名称更新为用户首次发送的消息内容（或摘要）。

**期望行为**:
1. 用户创建新会话后首次发送消息时，自动将该 Session 的名称更新为消息内容
2. 如果消息过长，截取前 20-30 个字符作为名称
3. 更新后的名称在 `/session` 列表和 `/pl` 项目列表中可见
4. 用户可以后续通过 `/session` 命令手动改名

**使用场景**:
- 用户发送 "帮我写一个 Python 爬虫"，Session 自动命名为 "帮我写一个 Python 爬虫"（或截取）
- 用户发送 "分析这段代码的性能问题"，Session 自动命名对应内容
- 方便用户在会话列表中快速识别不同会话的用途

**相关代码**:
- `src/feishu/handler.py` - 首次消息处理逻辑
- `src/session/manager.py` - Session 创建和更新方法
- `src/adapters/opencode.py` - 可能需要更新 OpenCode 端的会话名称

**实现思路**:
```python
# 在 handler.py 中检测首次消息
if session.is_new or not session.name:
    # 更新 session 名称为用户消息前 N 字符
    new_name = prompt[:30] + "..." if len(prompt) > 30 else prompt
    await session_manager.rename_session(session.id, new_name)
```

---

## Issue #53 详情（新增）

**标题**: `/pl` 命令显示工作目录和项目信息

**状态**: ⏳ 待处理

**优先级**: 中

**描述**:
当前使用 `/pl`（项目列表）命令时，只显示会话列表，缺少当前工作目录和项目相关信息的展示，用户难以快速识别会话对应的项目。

**期望行为**:
`/pl` 命令返回的卡片应包含以下信息：
1. 当前工作目录路径（绝对路径）
2. 项目名称（可从目录名推断或显示 Git 仓库名）
3. 如果是 Git 仓库，显示当前分支名
4. 会话数量统计（该项目下有多少个会话）

**当前行为**:
仅显示会话列表，无工作目录和项目上下文信息。

**相关代码**:
- `src/tui_commands/interactive.py` - `/pl` 命令处理逻辑
- `src/feishu/card_builder.py` - 项目列表卡片构建
- `src/session/manager.py` - 获取会话列表和工作目录信息

**实现思路**:
```python
# 在 interactive.py 中处理 /pl 命令
def handle_project_list():
    working_dir = session.working_dir
    project_name = os.path.basename(working_dir)
    git_branch = get_git_branch(working_dir)  # 如果是 git 仓库
    session_count = len(sessions)

    # 构建包含这些信息的卡片
```

---

## Issue #52 详情（已修复）

**标题**: 需要 `/stop` 命令强制停止模型输出

**状态**: ✅ 已修复

**优先级**: 中

**描述**:
当用户发送了错误的指令或模型正在生成不期望的输出时，需要一个 `/stop` 命令来强制中断模型的思考和输出过程。

**期望行为**:
- 发送 `/stop` 后立即中断当前进行中的 AI 流式输出
- 停止显示"打字中"状态
- 可选：发送一个 Toast 通知或简短文本确认已停止
- 停止后可以继续发送新消息开始新的对话

**实现方案**:
使用 `asyncio.Event` 作为取消信号，在 handler 层跟踪当前生成任务，用户发送 `/stop` 时设置事件并取消任务。

**修改文件**:
- `src/adapters/opencode/core.py`:
  - 添加 `_cancel_event: Optional[asyncio.Event]` 实例变量
  - 添加 `stop_generation()` 方法设置取消事件
  - 在 `_listen_events()` SSE 循环中检查取消事件
  - 在 `execute_stream()` 开始/结束时初始化和重置事件
  - 添加 "stop" 到 `supported_tui_commands`

- `src/tui_commands/__init__.py`:
  - 添加 "stop" 到 `SUPPORTED_COMMANDS` 列表

- `src/feishu/handler.py`:
  - 添加 `_current_generation_lock`, `_current_generation_task`, `_stop_event` 跟踪状态
  - 修改 `_handle_ai_message()` 使用 `tracked_stream()` 包装流以支持停止检测
  - 添加 `_handle_stop()` 方法处理停止命令
  - 修改 `_handle_tui_command()` 优先检测 `/stop` 命令
  - 更新帮助文本添加 `/stop` 说明

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
