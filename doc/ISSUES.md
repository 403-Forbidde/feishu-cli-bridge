# 问题追踪

## 活跃问题（待修复）

| Issue | 描述 | 优先级 | 相关文件 |
|-------|------|--------|----------|
| #55 | 每个工作目录会话列表最多显示最新10条 | 中 | `src/tui_commands/interactive.py`, `src/feishu/card_builder.py` |
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

## Issue #55 详情

Session 列表每工作目录最多显示10条，超出时提示"还有 N 条历史会话未显示"。

**实现思路**:
```python
sessions = session_manager.get_sessions(working_dir)
sessions_sorted = sorted(sessions, key=lambda s: s.updated_at, reverse=True)[:10]
```

---

## Issue #54 详情

**问题**: 用户首次发送消息后，Session 名称未自动更新为消息内容。

**根本原因**: `list_sessions()` 从 OpenCode 服务器获取的会话详情中可能不包含 `title` 字段，导致无法判断会话是否是临时生成的名称（以 "Feishu Bridge " 开头）。日志显示 `current_session_id not found in 20 sessions`。

**修复方案** (2026-03-26):
修改 `src/feishu/handler.py`，优先从适配器的本地缓存 `adapter._sessions` 获取会话标题，而不是依赖 `list_sessions()` 返回的数据：

```python
# Issue #54 Fix: 直接从适配器的本地缓存获取会话标题
if hasattr(adapter, "_sessions"):
    session_obj = adapter._sessions.get(working_dir)
    if session_obj:
        current_title = getattr(session_obj, "title", None)
```

**测试步骤**:
1. 发送一条消息给机器人
2. 检查日志是否显示 `Will auto-generate title for session ...`
3. 使用 `/session` 命令查看会话名称是否已更新为用户消息内容

---

## 已修复问题

| Issue | 标题 | 日期 |
|-------|------|------|
| #54 | Session 名称自动更新为首次对话内容 | 2026-03-26 |
| #53 | `/session` 命令显示工作目录和项目信息 | 2026-03-26 |
| #52 | `/stop` 命令强制停止模型输出 | 2026-03-26 |
| #51 | `/session` 命令无会话时格式优化 | 2026-03-26 |
| #40 | 上下文百分比计算不准确 | 2026-03-24 |
| #45 | `asyncio.Lock` 事件循环绑定错误 | 2026-03-24 |
| #32/#33 | 会话改名交互失败、交互式回复卡片空白 | 2026-03-24 |

完整记录见 `doc/CHANGELOG.md`

---

## 已知问题

### LSP 类型检查误报
VS Code 显示的 lark_oapi SDK 类型错误不影响运行，仅影响开发体验。
