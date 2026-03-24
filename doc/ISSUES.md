# 问题追踪

## 活跃问题（待修复）

| Issue | 描述 | 优先级 | 相关文件 |
|-------|------|--------|----------|
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
