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

---

## Issue #40 详情

**标题**: 上下文百分比计算不准确（Bridge 与 OpenCode CLI 显示不一致）

**状态**: ✅ **已修复** (2026-03-24) - Token 累加 Bug 已修复，SSE 返回的累计值直接替换而非累加

**优先级**: 高

### 现象（更新 - 2026-03-24 晚）

**API 解析修复后，出现新的 Bug**:

**第一轮对话**:
- ✅ **OpenCode CLI**: 显示 28.6%（75.0K tokens）
- ✅ **飞书 Bridge**: 显示 28.6%（75.0K tokens）
- **状态**: 完全一致 ✓

**第二轮对话**:
- ✅ **OpenCode CLI**: 显示 29%（74896 tokens）- 合理增长
- ❌ **飞书 Bridge**: 显示 57.2%（149.9K tokens）- **翻倍！**

**错误日志**: 无报错，但数据明显异常

---

### 新 Bug 根因分析（2026-03-24 晚）

**Token 累加逻辑错误**！

**问题代码位置**: `src/adapters/opencode.py:762-780`

**当前逻辑**:
```python
if state.current_stats:  # SSE 返回 step-finish 数据
    if self._current_stats:  # 已有上一轮统计
        # ❌ 错误！SSE 返回的是累计值，不是增量
        self._current_stats.total_tokens += state.current_stats.total_tokens
    else:
        self._current_stats = state.current_stats
```

**错误原因**:
1. **第一轮**: SSE 返回 75K（累计值）→ `_current_stats = 75K` ✓
2. **第二轮**: SSE 返回 **149.9K**（累计值，不是增量！）
   - 代码执行：`75K + 149.9K = 224.9K`
   - 但由于其他原因可能截断或处理成 149.9K
   - **实际显示的 149.9K 已经是翻倍了**

**关键发现**: OpenCode SSE 的 `step-finish` 事件返回的是**会话累计 token 总数**，不是**本轮新增 token 数**。

**对比 API 路径** (正确):
```python
else:  # SSE 未返回数据，走 API 路径
    stats_from_api = await self._fetch_stats_from_api(session.id)
    self._current_stats = stats_from_api  # ✅ 直接替换，正确！
```

### 历史问题记录

**原问题** (Issue #40 初始):
- OpenCode CLI: 16%（42886 tokens）
- 飞书 Bridge: 21.4%（42.9k tokens）
- 根因: Bridge 硬编码 context window 为 200k，实际应为 ~268k

**首次修复** (方案B - context window API):
- 实现从 OpenCode API 动态获取 context window
- 新增缓存机制
- 但由于 API 响应解析错误，实际未生效

**二次修复** (API 解析):
- 修复 `{"all": [...]}` 格式解析
- 现在 context window 获取正确
- 但发现 Token 累加 Bug

### 修复方案

**需要修复**: SSE 路径下的 token 统计处理逻辑

**修改位置**: `src/adapters/opencode.py:762-780`

**当前错误代码**:
```python
if state.current_stats:
    if self._current_stats:
        # ❌ 删除累加逻辑
        self._current_stats.prompt_tokens += state.current_stats.prompt_tokens
        self._current_stats.completion_tokens += state.current_stats.completion_tokens
        self._current_stats.total_tokens += state.current_stats.total_tokens
```

**修复后代码**:
```python
if state.current_stats:
    # ✅ 直接替换（SSE 返回的是累计值）
    self._current_stats = state.current_stats
    # 使用从 API 获取的准确 context_window
    self._current_stats.context_window = self.context_window
    self._current_stats.context_percent = min(
        100.0,
        round(self._current_stats.total_tokens / self.context_window * 100, 1)
    )
```

### 问题根因分析（2026-03-24 更新）

**API 响应结构错误**！

**当前代码假设** (`src/adapters/opencode.py:1283-1295`):
```python
providers = response.json()  # 期望: [{id: "...", models: {...}}, ...]
for provider in providers:   # 实际: 遍历字典的键 "all"
```

**实际 API 响应结构**:
```json
{
  "all": [
    {
      "id": "evroc",
      "models": {
        "nvidia/Llama-3.3-70B-Instruct-FP8": {
          "limit": {
            "context": 131072
          }
        }
      }
    }
  ]
}
```

**错误原因**:
1. 响应是字典 `{"all": [...]}`, 不是列表
2. 代码直接 `for provider in providers` 遍历字典，得到的是字符串 `"all"`
3. `"all".get("id")` 报错：`'str' object has no attribute 'get'`
4. 由于异常被捕获，API 调用失败，代码回退到硬编码值 200k
5. 实际值应为 ~268k，导致百分比计算仍然不准确

### 历史问题记录

**原问题** (Issue #40 初始):
- OpenCode CLI: 16%（42886 tokens）
- 飞书 Bridge: 21.4%（42.9k tokens）
- 根因: Bridge 硬编码 context window 为 200k，实际应为 ~268k

**首次修复** (方案B):
- 实现从 OpenCode API 动态获取 context window
- 新增缓存机制
- 但由于 API 响应解析错误，实际未生效

### 修复方案

**需要修复**: `_fetch_context_window_from_api` 方法的 API 响应解析逻辑

**修改位置**: `src/adapters/opencode.py:1283-1295`

**当前代码**:
```python
providers = response.json()
for provider in providers:  # ❌ 遍历字典得到的是 "all"
    if provider.get("id") == provider_id:  # ❌ 'str' has no 'get'
```

**修复后代码**:
```python
data = response.json()
# 处理 {"all": [...]} 或 [...] 两种格式
providers = data.get("all", []) if isinstance(data, dict) else data
for provider in providers:
    if provider.get("id") == provider_id:
```

**附加问题** - 模型 ID 匹配:
- API 中的模型 ID 是完整格式如 `nvidia/Llama-3.3-70B-Instruct-FP8`
- Bridge 配置的 model_id 可能是简写如 `k2p5`
- 需要确认 model_id 的映射关系

### 实施步骤

1. **修复 API 响应解析** (高优先级)
   - 修改 `_fetch_context_window_from_api` 处理 `{"all": [...]}` 结构
   - 添加对两种响应格式的兼容处理

2. **验证模型 ID 匹配** (中优先级)
   - 确认 API 返回的 model_id 与 Bridge 配置的关系
   - 可能需要处理 provider/model 格式的差异

3. **添加调试日志** (可选)
   - 记录 API 原始响应结构
   - 记录匹配的 provider/model 信息

### 相关代码

- `src/adapters/opencode.py:1265-1315` - `_fetch_context_window_from_api`
- `src/adapters/opencode.py:1317-1363` - `refresh_context_window_cache`

---

## Issue #33 详情

**标题**: 会话上下文百分比显示始终为 0%

**状态**: ✅ **已修复** - 使用正确的 Message API 获取 token 统计

**优先级**: 🟢 已解决

**现象**:
- AI 回复卡片 Footer 中显示的上下文占用百分比始终为 `0%`（如：📊 403 (0%)）
- OpenCode CLI 中可以看到正确的上下文占用（如 13%）
- Bridge 显示 `0%` 与实际不符

**修复**: 修改 `_fetch_stats_from_api` 方法，从 `GET /session/:id` 改为使用 `GET /session/:id/message`，遍历 assistant 消息累加 token 统计。

---

### 数据流分析

上下文百分比的完整数据流：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ OpenCode SSE Event                                                          │
│ {"type": "step-finish", "tokens": {...}}                                    │
└─────────────────────┬───────────────────────────────────────────────────────┘
                      │ parse_stream_chunk()
                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ opencode.py:412-431                                                          │
│ - 解析 tokens 字段                                                            │
│ - 创建 TokenStats 对象                                                        │
│ - 设置 state.current_stats                                                   │
└─────────────────────┬───────────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ opencode.py:655-656                                                          │
│ - 流结束后: self._current_stats = state.current_stats                        │
└─────────────────────┬───────────────────────────────────────────────────────┘
                      │ get_stats()
                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ api.py:525                                                                   │
│ stats_provider=lambda text: _convert_stats(stats_provider(text))            │
└─────────────────────┬───────────────────────────────────────────────────────┘
                      │ _convert_stats()
                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ api.py:679-687                                                               │
│ - 将 TokenStats 转为字典                                                      │
│ - 包含 context_percent 字段                                                   │
└─────────────────────┬───────────────────────────────────────────────────────┘
                      │ build_card_content("complete", {...})
                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ card_builder.py:60-69                                                        │
│ - _build_complete_card()                                                     │
└─────────────────────┬───────────────────────────────────────────────────────┘
                      │ _build_complete_card() -> _build_footer()
                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ card_builder.py:1294-1343                                                    │
│ - _append_token_stats_compact()                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### 已尝试的修复方案

#### 修复尝试 1: 更改 token 字段名
**文件**: `src/adapters/opencode.py:419`
```python
# 修改前
context_used=tokens.get("input", 0)
# 修改后
context_used=tokens.get("total", 0)
```
**结果**: ❌ 未生效

#### 修复尝试 2: get_stats 方法修复
**文件**: `src/adapters/opencode.py:653`
```python
# 修改前
context_used = self._current_stats.prompt_tokens
# 修改后
context_used = self._current_stats.context_used
```
**结果**: ❌ 未生效

#### 修复尝试 3: 完整 step-finish 事件处理重构
**文件**: `src/adapters/opencode.py:412-431`
- 添加防御式字段名处理（支持多种可能的字段名）
- 在 step-finish 中立即计算 context_percent
- 添加调试日志

```python
elif part_type == "step-finish":
    tokens = part.get("tokens", {})
    # OpenCode API 可能返回不同格式的 token 字段
    total_tokens = tokens.get("total") or tokens.get("total_tokens", 0)
    input_tokens = tokens.get("input") or tokens.get("input_tokens") or tokens.get("prompt_tokens", 0)
    output_tokens = tokens.get("output") or tokens.get("output_tokens") or tokens.get("completion_tokens", 0)
    context_window = self.context_window
    context_percent = min(100.0, round(total_tokens / context_window * 100, 1)) if context_window > 0 else 0.0
    state.current_stats = TokenStats(
        prompt_tokens=input_tokens,
        completion_tokens=output_tokens,
        total_tokens=total_tokens,
        context_window=context_window,
        context_used=total_tokens,
        context_percent=context_percent,
        model=self.default_model,
    )
    if self.logger:
        self.logger.info(f"step-finish: tokens={total_tokens}, context_percent={context_percent}%")
```
**结果**: ❌ 未生效

#### 修复尝试 4: 修复 falsy 检查问题
**文件**: `src/feishu/card_builder.py:1307`
```python
# 修改前
context_percent = token_stats.get("context_percent")
if not context_percent:  # 0 会被误判为 False
    ...

# 修改后
if "context_percent" in token_stats and token_stats["context_percent"] is not None:
    context_percent = float(token_stats["context_percent"])
    ...
```
**结果**: ❌ 未生效

---

### 可能的问题根源

#### 可能性 1: SSE 事件未到达或字段为空
**检查点**: `opencode.py:412-431`
- `step-finish` 事件可能未被触发
- `part.get("tokens", {})` 可能返回空字典
- OpenCode API 实际返回的字段名可能与预期不符

**诊断建议**:
```python
# 添加原始数据日志
if self.logger:
    self.logger.info(f"step-finish raw: {json.dumps(part)}")
```

#### 可能性 2: StreamState 数据未正确保存
**检查点**: `opencode.py:655-656`
```python
if state.current_stats:
    self._current_stats = state.current_stats
```
- `state.current_stats` 可能在流结束后为 None
- 异步迭代器可能异常退出，未执行到保存代码

**诊断建议**: 在 `_listen_events` 返回前和 `execute_stream` 结束前都添加日志

#### 可能性 3: get_stats 调用时机问题
**检查点**: `opencode.py:659-666`
```python
def get_stats(self, context: List[Message], completion_text: str) -> TokenStats:
    if self._current_stats:
        return self._current_stats
    return super().get_stats(context, completion_text)  # 可能走到这里
```
- `self._current_stats` 可能为 None
- `super().get_stats()` 使用估算而非真实数据

#### 可能性 4: TokenStats 数据类型问题
**检查点**: `src/adapters/base.py:38-48`
```python
@dataclass
class TokenStats:
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    context_window: int = 0
    context_used: int = 0
    context_percent: float = 0.0  # 确保是 float 类型
    model: str = ""
```
- 确保 `context_percent` 是 float 而不是字符串或其他类型

#### 可能性 5: CardKit 与普通卡片路径差异
**检查点**: `streaming_controller.py`
- CardKit 路径与 IM Patch 回退路径是否行为一致
- 最终卡片更新时 token_stats 是否正确传递

```python
# streaming_controller.py:350-371
token_stats = None
if stats_provider:
    try:
        token_stats = stats_provider(display_text)  # 这里返回什么？
    except Exception as e:
        logger.warning(f"获取统计信息失败: {e}")

complete_card = build_card_content(
    "complete",
    {
        ...
        "token_stats": token_stats,  # 确认这里传递了正确的数据
        ...
    },
)
```

#### 可能性 6: _convert_stats 转换问题
**检查点**: `api.py:679-687`
```python
def _convert_stats(token_stats: TokenStats) -> Dict[str, Any]:
    return {
        "total_tokens": token_stats.total_tokens,
        "context_used": token_stats.context_used,
        "context_window": token_stats.context_window,
        "context_percent": token_stats.context_percent,
    }
```
- 传入的 token_stats 可能不是 TokenStats 类型
- 可能是父类的估算数据

---

### 诊断步骤建议

1. **验证 SSE 事件到达情况**
   - 在 `opencode.py:412` 添加日志确认 step-finish 事件到达
   - 打印原始 part 数据查看实际字段名

2. **验证数据保存**
   - 在 `opencode.py:655` 添加日志确认 current_stats 被保存
   - 打印保存的 TokenStats 对象内容

3. **验证 get_stats 调用**
   - 在 `opencode.py:659` 添加日志确认 get_stats 被调用
   - 打印返回的数据内容

4. **验证卡片构建器接收数据**
   - 在 `card_builder.py:1294` 添加日志打印 token_stats 参数
   - 确认 context_percent 字段存在且值正确

5. **直接调试**
   - 在 `api.py:525` 打印 stats_provider 返回结果
   - 确认 _convert_stats 接收和返回的数据

6. **检查 OpenCode 实际响应**
   ```bash
   # 启动 opencode serve 后手动查询
   curl -s http://localhost:4096/event  # 或使用实际端口
   ```

---

### 🔍 深度分析（2026-03-24 更新）

经过多次修复尝试仍未解决，进行深度代码审查后发现以下关键问题：

#### 🔴 关键发现：异步生成器提前终止

**根本原因**：`api.py` 中的 `stream_reply` 方法在收到 DONE 信号后使用 `break` 提前结束循环，导致 `execute_stream` 异步生成器没有被正确耗尽，因此生成器中 `yield` 之后的代码（包括 `_fetch_stats_from_api` 调用）**根本不会执行**。

```python
# api.py 第514-516行（修复前）
elif chunk.type == StreamChunkType.DONE:
    logger.info(f"收到 DONE 信号，共 {chunk_count} 个 chunks")
    break  # ❌ 这里提前 break，导致生成器没有正确结束
```

**影响**：
- `_fetch_stats_from_api` 从未被调用
- `self._current_stats` 始终为 None
- `get_stats` 只能返回 fallback 估算值

#### ✅ 修复方案（2026-03-24 第三次修复）

**修改文件**：`src/feishu/api.py`

**修改内容**：
1. `stream_reply` 方法：移除 `break`，让生成器自然结束
2. `_stream_reply_legacy` 方法：同样移除 `break`

```python
# 修复后
elif chunk.type == StreamChunkType.DONE:
    logger.info(f"收到 DONE 信号，共 {chunk_count} 个 chunks")
    # 不 break，让生成器自然结束，这样 execute_stream 中的清理代码会被执行
```

**状态**：✅ 已修复（2026-03-24）

#### 📚 OpenCode SSE 文档参考

**待查找**：OpenCode SSE 事件流文档的官方地址
- 需要确认 `step-finish` 事件是否真实存在
- 确认是否有其他事件类型携带 token 统计
- 确认是否需要主动调用 API 获取统计（而非被动接收 SSE）

#### 🔴 根本原因推测

**1. OpenCode 不通过 SSE 发送 token 统计**

代码假设 OpenCode 会发送 `step-finish` 事件，但 CLI 显示统计存在而 Bridge 收不到，说明：
- OpenCode 可能在 CLI 内部计算，不通过 SSE 暴露
- 或者使用了完全不同的事件类型/字段名
- 或者需要通过 API 主动查询而非 SSE 推送

**2. 静默异常处理**

在 `opencode.py:462-463`：
```python
except (json.JSONDecodeError, Exception):
    pass  # 异常被完全吞掉，没有任何日志！
```

如果 `step-finish` 事件解析失败（字段名不匹配、类型错误、JSON 格式错误），**异常会被静默忽略**，我们无法得知问题所在。

**3. 数据保存时机问题**

数据流时序：
```
_parse_event (step-finish到达) 
  → state.current_stats = TokenStats(...)  # 只在事件到达时设置
  → _listen_events 返回
  → execute_stream 保存到 self._current_stats
  → get_stats() 被调用
```

如果 `step-finish` 在 `session.idle` **之后**到达，或在流结束后才发送，数据将丢失。

**4. 缺乏诊断日志**

`step-finish` 处理代码中**完全没有日志输出**，无法确认：
- 事件是否到达
- 到达时携带了什么数据
- 解析是否成功

---

#### 🔍 诊断步骤建议

**步骤 1：确认事件是否到达**
在 `_parse_event` 的 step-finish 处理块开头添加：
```python
self.logger.info(f"DEBUG step-finish: raw={json.dumps(part)}")
```

**步骤 2：确认数据保存成功**
在 `execute_stream` 流结束后：
```python
if state.current_stats:
    self.logger.info(f"DEBUG: Saving stats: {state.current_stats}")
    self._current_stats = state.current_stats
else:
    self.logger.warning("DEBUG: No stats to save! state.current_stats is None")
```

**步骤 3：确认 get_stats 被调用且有数据**
```python
def get_stats(self, context, completion_text):
    self.logger.info(f"DEBUG: get_stats called, has stats: {self._current_stats is not None}")
    if self._current_stats:
        self.logger.info(f"DEBUG: returning stats: {self._current_stats}")
        return self._current_stats
    fallback = super().get_stats(...)
    self.logger.info(f"DEBUG: returning fallback: {fallback}")
    return fallback
```

**步骤 4：确认 OpenCode CLI 与 Bridge 的差异**
- 在 OpenCode CLI 中完成一个对话
- 观察 CLI 是否显示 token 统计（如：61,069 tokens，23% used）
- 如果 CLI 显示但 Bridge 没有，说明需要通过 API 而非 SSE 获取统计

**步骤 5：测试 API 获取 token 统计**
```bash
# 完成对话后，查询 session 详情
curl -s http://localhost:4096/session/{session_id} | jq .
# 检查返回 JSON 中是否有 tokens/usage/cost 等字段
```

**步骤 6：手动检查 SSE 事件流**
```bash
# 在 Bridge 运行时，手动监听事件流
curl -N http://localhost:4096/event | tee events.log
# 查看是否有 step-finish 事件，以及其格式
```

---

#### 💡 修复方案建议（待验证后实施）

**方案 0：通过 API 获取真实统计**（优先级：🔴 最高）

基于观察（CLI 有统计但 SSE 无事件），OpenCode 可能需要在流结束后**主动查询 API** 获取真实统计：

```python
async def get_stats(self, context: List[Message], completion_text: str, working_dir: str = "") -> TokenStats:
    """获取 Token 统计"""
    # 1. 先尝试从 _current_stats 获取（SSE 事件）
    if self._current_stats:
        return self._current_stats
    
    # 2. 如果 SSE 没有，主动查询 API 获取真实统计
    session = self._sessions.get(working_dir)
    if session:
        detail = await self.get_session_detail(session.id)
        if detail:
            # 从 detail 中提取真实的 token 统计
            # 字段名需要根据实际 API 响应确定
            tokens = detail.get("tokens") or detail.get("usage") or detail.get("cost")
            if tokens:
                return TokenStats(
                    prompt_tokens=tokens.get("input", 0),
                    completion_tokens=tokens.get("output", 0),
                    total_tokens=tokens.get("total", 0),
                    context_window=self.context_window,
                    context_used=tokens.get("total", 0),
                    context_percent=min(100.0, tokens.get("total", 0) / self.context_window * 100),
                    model=self.default_model,
                )
    
    # 3. 兜底估算
    return super().get_stats(context, completion_text)
```

**待确认**：需要验证 `GET /session/{id}` 是否返回 token 统计字段。

**方案 1：修复异常处理**（优先级：高）
```python
except (json.JSONDecodeError, Exception) as e:
    if self.logger:
        self.logger.error(f"Failed to parse step-finish event: {e}, raw={line}")
```

**方案 2：添加兜底计算**（优先级：中）
如果 `step-finish` 未到达，在 `get_stats()` 中基于实际内容长度估算：
```python
def get_stats(self, context, completion_text):
    if self._current_stats:
        return self._current_stats
    # 兜底：基于 completion_text 长度估算
    estimated_tokens = len(completion_text) // 4  # 粗略估算
    return TokenStats(
        prompt_tokens=0,
        completion_tokens=estimated_tokens,
        total_tokens=estimated_tokens,
        context_window=self.context_window,
        context_used=estimated_tokens,
        context_percent=min(100.0, estimated_tokens / self.context_window * 100),
        model=self.default_model,
    )
```

**方案 3：探索替代事件源**（优先级：低）
如果 `step-finish` 确实不存在，考虑：
- 监听其他可能携带 token 信息的事件
- 在流结束后主动查询 OpenCode API 获取统计
- 完全依赖客户端估算

---

### 临时调试方案

在 `src/feishu/card_builder.py` 的 `_append_token_stats_compact` 函数开头添加：

```python
def _append_token_stats_compact(parts: List[str], token_stats: Dict) -> None:
    # 临时调试 - 打印完整的 token_stats
    import json
    logger.info(f"_append_token_stats_compact: token_stats={json.dumps(token_stats, default=str)}")
    ...
```

在 `src/adapters/opencode.py` 的 `get_stats` 方法添加：

```python
def get_stats(self, context: List[Message], completion_text: str) -> TokenStats:
    import json
    if self._current_stats:
        logger.info(f"get_stats: returning real stats - {self._current_stats}")
        return self._current_stats
    fallback = super().get_stats(context, completion_text)
    logger.info(f"get_stats: returning fallback stats - {fallback}")
    return fallback
```

---

### ✅ 已实施的修复方案（2026-03-24）

**修复思路**：OpenCode CLI 显示 token 统计，但不通过 SSE 发送 `step-finish` 事件。解决方案是在流结束后主动查询 OpenCode API 获取真实统计。

**修改文件**：`src/adapters/opencode.py`

**修改内容**：

1. **新增 `_fetch_stats_from_api` 方法**（约第 1129 行）
   - 通过 `GET /session/{id}` API 获取会话详情
   - 支持多种可能的字段名：`tokens`, `usage`, `cost`, `tokenUsage`, `token_usage`
   - 支持多种 token 字段名：`total`, `total_tokens`, `input`, `output` 等
   - 返回 `TokenStats` 对象或 `None`

2. **修改 `execute_stream` 方法**（约第 760 行）
   - 流结束后，如果 SSE 没有 `step-finish` 事件（`state.current_stats` 为空）
   - 等待 0.3 秒后调用 `_fetch_stats_from_api` 获取真实统计
   - 将获取的统计保存到 `self._current_stats`

**代码片段**：

```python
# execute_stream 方法中，流结束后的处理
else:
    if self.logger:
        self.logger.warning(
            "execute_stream: no stats from SSE (step-finish not received), "
            "fetching from API..."
        )
    await asyncio.sleep(0.3)  # 等待 API 更新
    stats_from_api = await self._fetch_stats_from_api(session.id)
    if stats_from_api:
        # 保存或累加统计
        ...
```

**待验证**：
- OpenCode `GET /session/{id}` API 是否返回 token 统计字段
- 字段名是否与代码中假设的一致
- 0.3 秒延迟是否足够等待 API 更新

**日志关键字**（用于诊断）：
- `_fetch_stats_from_api: session detail keys=...` - API 返回的字段列表
- `_fetch_stats_from_api: tokens_data=...` - 提取的 token 数据
- `_fetch_stats_from_api: success - total=..., percent=...%` - 成功获取统计

---

### OpenCode 官方文档分析（2026-03-24 更新）

通过查询 OpenCode 官方文档（https://opencode.ai/docs/server/）和本地 OpenAPI 规范（http://localhost:4096/doc），发现关键问题：

#### 📋 核心发现

**API 查询路径错误！**

| API 端点 | 是否包含 Token 统计 | 实际返回字段 |
|---------|------------------|------------|
| `GET /session/:id` | ❌ **不包含** | id, slug, directory, title, version, summary（仅文件变更统计） |
| `GET /session/:id/message` | ✅ **包含** | 每条 AssistantMessage 包含 `tokens` 和 `cost` 字段 |

**OpenAPI 规范确认**：
- `Session` schema 定义中**没有 token/cost 字段**
- `AssistantMessage` schema 包含：
  ```yaml
  tokens:
    total: number
    input: number
    output: number
    reasoning: number
    cache: { read: number, write: number }
  cost: number
  ```

#### 🔴 问题根因

**代码查询了错误的 API！**

`_fetch_stats_from_api` 方法调用 `GET /session/:id`，但 Session 详情根本不包含 token 统计。
应该调用 `GET /session/:id/message` 获取所有消息，然后累加每条 assistant 消息的 token。

**实际测试结果**：
```bash
curl -s http://localhost:4096/session/ses_xxx
# 返回：
{
  "id": "ses_xxx",
  "summary": { "additions": 784, "deletions": 74, "files": 3 },
  // ❌ 没有 tokens/usage/cost 字段！
}
```

#### ✅ 修复方案（已实施）

修改 `_fetch_stats_from_api` 方法：
1. 直接调用 `GET /session/:id/message` API 获取消息列表
2. 遍历所有消息，累加 `assistant` 角色的 `tokens` 字段
3. 计算 `context_percent`

**修改文件**：`src/adapters/opencode.py`（第 1129-1241 行）

**关键变更**：
- 从使用 `get_session_detail()` 改为直接使用 HTTP Client 调用 Message API
- 遍历消息列表，累加所有 `assistant` 消息的 `tokens` 字段
- 支持多种可能的 token 字段名（`input`/`prompt`, `output`/`completion`）
- 添加详细的调试日志便于诊断

**2026-03-24 第二次修复**：
- **问题**：API 返回的已经是会话所有历史消息的 token 总和，但代码在 `_current_stats` 存在时还在累加，导致重复计算
- **解决**：API 返回的统计直接替换 `_current_stats`，不再累加
- **影响**：修复了百分比显示不正确且每次请求变化的问题

**状态**：✅ 已修复（2026-03-24）

---

### 已知问题

#### LSP 类型检查误报

**状态**: ⚠️ 已知，不影响运行

VS Code / LSP 显示大量类型错误（如 `"v1" is not a known attribute of "None"`），系 lark_oapi SDK 类型定义不完整所致。仅影响开发体验，不影响实际运行。

---

## 技术决策记录

### Issue #10: /session 命令在飞书客户端下作用有限

**状态**: 🔍 待讨论

**问题描述**: `/session` 命令返回纯文本会话列表，用户回复数字切换。在飞书客户端中存在局限：使用场景稀少、列表不美观、`/new` 已覆盖核心需求。

**暂定决策**: 不做修改，保留现状，等待进一步使用反馈后再决定去留。

---

## 近期已修复（见 CHANGELOG.md 详情）

- **v0.1.8** - Issue #45: `asyncio.Lock` 事件循环绑定错误（修复 FeishuClient 事件调度逻辑）
- **v0.1.8** - Issue #40: 上下文百分比计算不准确（修复 API 解析 + Token 累加 + API 端点）
- **v0.1.8** - Issue #32/#33: 会话改名交互失败、交互式回复卡片空白（修复卡片 Schema + ID 匹配）
- **v0.1.7** - Issue #34-#39: Session 管理重构相关问题（`reset_session` 空目录保护、`storage_dir` 移除、封装修复、代码重复清理等）
- **v0.1.6** - `parse_chunk` 签名修复、`asyncio.get_event_loop()` 弃用用法
- **v0.1.5** - Issue #27-#28: 外部目录权限阻塞、工具调用后无文字回复

---

## Issue #45 详情

**标题**: `asyncio.Lock` 事件循环绑定错误

**状态**: ✅ **已修复** (2026-03-24) - 修复事件调度逻辑

**优先级**: 低（功能正常，仅日志报错）

**相关文件**: `src/feishu/client.py`（修复位置），`src/adapters/opencode.py`（症状位置）

### 现象

执行 `/mode` 命令（调用 `list_agents`）时，日志中出现警告：

```
list_agents 失败: <asyncio.locks.Event object at 0x...> is bound to a different event loop
```

**注意**: 功能正常（模式切换卡片正常显示），但日志有报错。

### 根因分析（4次修复尝试均失败）

**问题表面是 asyncio.Lock 绑定到不同事件循环，但多次修复尝试均未能解决**。

**历次修复尝试**：

#### v0.1.0 - 懒初始化锁
- **思路**: 不在 `__init__` 中创建锁，延迟到第一次使用时创建
- **结果**: ❌ 失败，错误依旧

#### v0.2.0 - 异常捕获+重试
- **思路**: 捕获 `RuntimeError`，检测 "bound to a different event loop"，重新创建锁
- **代码**: `_ensure_server()` 和 `_get_or_create_session()` 中增加重试循环
- **结果**: ❌ 失败，错误依旧

#### v0.3.0 - 移除嵌套锁
- **思路**: 问题可能是嵌套锁导致，`OpenCodeServerManager` 不再维护内部锁，统一由 `OpenCodeAdapter._server_lock` 管理
- **修改**: 移除 `OpenCodeServerManager._lock`，简化 `start()`/`stop()`
- **结果**: ❌ 失败，错误依旧

#### v0.4.0 - 同时重置 httpx.AsyncClient
- **思路**: 发现 `httpx.AsyncClient` 内部也使用 `asyncio.Event`（错误信息中的 `asyncio.locks.Event`），可能也绑定到旧事件循环
- **代码**:
  ```python
  except RuntimeError as e:
      if "bound to a different event loop" in str(e):
          self._server_lock = None
          if self._client:
              await self._client.aclose()
              self._client = None
          continue
  ```
- **结果**: ❌ 失败，错误依旧

### 真正的根因（已查明）

**问题不在 `OpenCodeAdapter`，而在 `FeishuClient._dispatch_to_handler`**。

#### 事件循环调用链

```
main.py asyncio.run(main())          ← 主事件循环 A (Adapter 在此创建)
    ↓
FeishuClient.start_sync()
    ↓
创建 WebSocket 后台线程              ← 事件循环 B
    ↓
lark-oapi SDK 内部线程池处理消息
    ↓
_on_message_received() 被调用        ← SDK 内部线程 (无事件循环)
    ↓
_dispatch_to_handler()
    ↓
检测到无运行中事件循环
    ↓
创建新线程 _sync_dispatch()          ← 事件循环 C (消息处理实际在此执行!)
    ↓
调用 list_agents() → _ensure_server()
    ↓
尝试获取 _server_lock                ← 锁绑定到事件循环 A，但当前是 C!
```

**关键问题**: `_dispatch_to_handler` 方法在 WebSocket 回调线程中检测不到运行中的事件循环（因为 lark-oapi 使用自己的线程池），于是它创建了新线程和新事件循环来执行消息处理。这导致后续所有操作都在**不同的事件循环**中执行。

### 修复方案（2026-03-24）

**修改文件**: `src/feishu/client.py`

**修改内容**: 使用 `self._loop`（主事件循环）通过 `asyncio.run_coroutine_threadsafe()` 调度消息处理，确保所有异步操作在同一事件循环中执行。

```python
def _dispatch_to_handler(self, event_data: Dict[str, Any]):
    """将事件分发给处理器

    使用主事件循环调度，确保所有异步操作在同一事件循环中执行。
    修复 Issue #45: asyncio.Lock 绑定到不同事件循环的问题。
    """
    try:
        # 优先使用已保存的主事件循环（线程安全调度）
        if self._loop is not None:
            try:
                future = asyncio.run_coroutine_threadsafe(
                    self._async_dispatch(event_data), self._loop
                )
                future.add_done_callback(...)
                logger.debug("✅ 已调度消息处理任务到主事件循环")
                return
            except Exception as e:
                logger.warning(f"主事件循环调度失败: {e}")

        # 兜底方案保留...
```

**修复后效果**:
- 消息处理始终在主事件循环中执行
- `OpenCodeAdapter` 的锁在正确的循环中创建和使用
- 不再出现 `bound to a different event loop` 错误

### 历史修复尝试（均未成功）

| 版本 | 方案 | 修改内容 | 结果 | 失败原因 |
|------|------|----------|------|----------|
| v0.1.0 | 懒初始化 | `__init__` 中不创建锁，首次使用时创建 | ❌ 失败 | 锁创建位置正确，但使用位置错误 |
| v0.2.0 | 异常重试 | 捕获 `RuntimeError`，重置锁后重试 | ❌ 失败 | 治标不治本，每次消息都触发错误 |
| v0.3.0 | 移除嵌套锁 | `OpenCodeServerManager` 不再维护内部锁 | ❌ 失败 | 问题不在嵌套锁 |
| v0.4.0 | 重置 client | 同时重置锁和 `httpx.AsyncClient` | ❌ 失败 | 错误来源是调用方，不是 Adapter 本身 |

**结论**: 真正的根因是事件调度机制问题，而非锁的管理问题。

### 相关代码

- `src/adapters/opencode.py:40-190` - `OpenCodeServerManager` 类（已移除内部锁）
- `src/adapters/opencode.py:291-342` - `_ensure_server()` 方法（外层锁保护）
