# 问题追踪

## 活跃问题（待修复）

**状态**: 📋 待修复
**优先级**: 高

**问题描述**:
`FeishuClient._parse_message` 解析完消息后结果被丢弃，随后调用 `_event_to_dict` 将事件转回字典，再由 `handler.py` 重新解析一遍。两套逻辑对附件处理能力不对等。

**修复方案**:
删除 `client.py` 中的 `_parse_message` 方法，统一由 `handler.py` 的 `_parse_event_data` 负责解析。

**相关文件**: `src/feishu/client.py`, `src/feishu/handler.py`

---

### Issue #17: `_stream_reply_legacy` 丢失 reply_to 参数

**状态**: 📋 待修复
**优先级**: 高

**问题描述**:
`api.py:609` 在 IM Patch 回退路径中调用 `send_card_message` 时未传 `reply_to` 参数，导致回复不显示原生引用气泡。

**修复方案**:
补传 `reply_to=reply_to_message_id`。

**相关文件**: `src/feishu/api.py`

---

### Issue #18: `SessionManager._save_session` 在事件循环中同步阻塞

**状态**: 📋 待修复
**优先级**: 高

**问题描述**:
`session/manager.py:109` 的同步文件写入在异步上下文中被直接调用，每条消息触发 2-3 次，阻塞 asyncio 事件循环。

**修复方案**:
改用 `await asyncio.to_thread(self._save_session, session)`。

**相关文件**: `src/session/manager.py`

---

### Issue #19: `_patch_card` 每次回调重建 SDK Client

**状态**: 📋 待修复
**优先级**: 高

**问题描述**:
`client.py:183` 在每次卡片回调时重建 `lark.Client`，不复用已有客户端，导致连接池无法复用。

**修复方案**:
直接使用 `FeishuAPI` 中已初始化的 `self.client` 实例。

**相关文件**: `src/feishu/client.py`

---

### Issue #20: handler.py 重复 TUI 命令检测（死代码）

**状态**: 📋 待修复
**优先级**: 高

**问题描述**:
`handler.py:167-177` 存在两段相同的 `is_tui_command` 检测逻辑，第二段永远不会执行。

**修复方案**:
删除第二段重复检测。

**相关文件**: `src/feishu/handler.py`

---

### Issue #21: 附件保存存在路径穿越风险

**状态**: 📋 待修复
**优先级**: 中

**问题描述**:
`api.py:432` 直接使用飞书 SDK 返回的 `response.file_name` 构造保存路径，若含 `../` 可能写入目录之外。

**修复方案**:
`save_path = save_dir / Path(filename).name`

**相关文件**: `src/feishu/api.py`

---

### Issue #24: `_beautify_list_items` 是完全空操作

**状态**: 📋 待修复
**优先级**: 中

**问题描述**:
`card_builder.py:977-1002` 的 `_beautify_list_items` 函数无任何可观测副作用，是完全空操作。

**修复方案**:
删除此函数及所有调用点。

**相关文件**: `src/feishu/card_builder.py`

---

### Issue #25: `formatter.py` 大量死代码待清理

**状态**: 📋 待修复
**优先级**: 低

**问题描述**:
`formatter.py` 中以下代码已被 `card_builder.py` 取代：
- `optimize_markdown_style`
- `_simplify_model_name`
- `format_with_metadata`（无调用方）
- `parse_mention`（无调用方）

**修复方案**:
删除死代码；若文件为空则删除整个文件。

**相关文件**: `src/feishu/formatter.py`, `src/feishu/card_builder.py`

---

## 近期已修复（保留参考）

### Issue #32: 会话管理改名交互失败

**状态**: ✅ 已修复
**时间**: 2026-03-23
**影响版本**: v0.1.7+

**问题描述**:
点击改名按钮后，系统发送提示卡片让用户回复新名称。但用户回复后，消息被当作普通用户输入处理，AI 直接回复该内容，而非执行重命名操作。

**根本原因**:
当用户直接发送消息（而不是点击「回复」按钮）时，`parent_id` 为空。此时系统使用内容启发式匹配（纯数字 1-10 或 `provider/model` 格式）来判断是否是交互式回复。但用户输入的新名称不符合这些格式，因此被当作普通消息处理。

**修复方案**:
在 `handler.py` 中增加对 `rename_session` 交互类型的特殊处理：当检测到用户有待处理的改名交互时，接受任何非命令内容作为回复。

**相关文件**: `src/feishu/handler.py`, `src/tui_commands/__init__.py`

---

### Issue #25 (原): 改名交互改进

**状态**: ⚠️ 方案失败，见 Issue #32
**时间**: 2026-03-23

原方案使用 Schema 2.0 `input` + `action` 组件实现卡片内改名，但飞书 Schema 2.0 不支持 `action` 标签。需重新设计。

---

### Issue #27: OpenCode 外部目录权限对话框导致阻塞

**状态**: ✅ 已修复
**时间**: 2026-03-22

**问题描述**:
OpenCode 访问工作目录外路径时弹出 TUI 权限对话框，Bridge 以无头模式运行无法响应，工具调用永久阻塞。

**修复方案**:
启动 `opencode serve` 时注入 `OPENCODE_PERMISSION` 环境变量：
```python
env["OPENCODE_PERMISSION"] = json.dumps({"external_directory": "allow"})
```

**相关文件**: `src/adapters/opencode.py`

---

### Issue #28: 工具调用后无文字回复（流提前终止）

**状态**: ✅ 已修复（六次修复）
**时间**: 2026-03-22

**问题描述**:
模型调用工具后，飞书卡片显示"✅ 已完成"但无文字回复。

**根本原因**:
`session.idle` 在每个步骤完成后都会触发（非一次性信号），导致在工具调用步骤就提前终止流，未等待文字回复生成。

**最终修复方案**:
1. 将状态封装为局部变量 `StreamState`，每轮对话独立
2. 通过内容 hash 匹配识别用户输入（而非顺序启发式）
3. `session.idle` 时检查 `seen_assistant_message`，仅在有文字内容时才发出 DONE

**相关文件**: `src/adapters/opencode.py`

---

## 已知问题

### LSP 类型检查误报

**状态**: ⚠️ 已知，不影响运行
**优先级**: 低

VS Code / LSP 显示大量类型错误（如 `"v1" is not a known attribute of "None"`），系 lark_oapi SDK 类型定义不完整所致。仅影响开发体验，不影响实际运行。

---

## 技术决策记录

### Issue #10: /session 命令在飞书客户端下作用有限

**状态**: 🔍 待讨论
**优先级**: 低

**问题描述**:
`/session` 命令返回纯文本会话列表，用户回复数字切换。在飞书客户端中存在局限：
1. 使用场景稀少 — 飞书用户通常只维护一个对话上下文
2. 列表不美观 — 纯文本格式，与卡片化命令风格不一致
3. `/new` 已覆盖"开启新会话"的核心需求

**暂定决策**:
不做修改，保留现状，等待进一步使用反馈后再决定去留。
