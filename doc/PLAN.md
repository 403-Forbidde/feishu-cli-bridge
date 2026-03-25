# 代码修复计划

**制定日期**: 2026-03-25
**计划周期**: 2 轮修复，预计 4-6 天
**目标**: 消除安全风险、优化架构、提升代码质量

---

## 执行策略

### 总体原则

1. **安全优先**: 高安全风险问题必须立即修复
2. **架构先行**: 先稳定基础架构，再优化细节
3. **增量提交**: 每个修复点独立提交，便于回滚
4. **测试验证**: 每个阶段结束后进行功能验证

### 分支策略

**当前分支**: `fix/code-review-issues`

```bash
# 开发流程
git checkout fix/code-review-issues
# ... 进行修复 ...
git add .
git commit -m "fix: 具体修复描述"
git push origin fix/code-review-issues

# 修复完成后合并到 main
git checkout main
git merge fix/code-review-issues
git push origin main

# 清理分支（可选）
git branch -d fix/code-review-issues
git push origin --delete fix/code-review-issues
```

**注意**: 此分支仅推送至 Gitea（origin），不上传 GitHub。

### 执行顺序

```
第一轮（核心修复）
├── 阶段 1: 安全修复（半天）
├── 阶段 2: 架构拆分（1-2 天）
└── 阶段 3: 性能修复（半天）

第二轮（质量优化）
├── 阶段 4: 代码规范（1 天）
├── 阶段 5: 依赖清理（半天）
└── 阶段 6: 错误处理增强（1 天）
```

---

## 第一轮：核心修复

### 阶段 1: 安全修复

**目标**: 消除安全风险
**预计时间**: 0.5 天
**优先级**: 🔴 最高

#### 任务 1.1: 移除硬编码凭证

**文件**: `config.yaml`
**问题**: 包含真实的 `app_id` 和 `app_secret`
**修复方案**:
```yaml
# 修改前
feishu:
  app_id: "cli_a930eddaa5ba5bc8"
  app_secret: "QOCIoUkwQCWz7jcxpi9ZIb7hMc6ziLfp"

# 修改后
feishu:
  app_id: ""      # 通过环境变量 FEISHU_APP_ID 设置
  app_secret: ""  # 通过环境变量 FEISHU_APP_SECRET 设置
```

**验证步骤**:
1. 修改配置
2. 设置环境变量测试
3. 验证应用正常启动

#### 任务 1.2: 修复命令注入风险

**文件**: `src/adapters/codex.py:55`
**问题**: `prompt` 直接拼接到命令列表
**修复方案**:
```python
# 修改 build_command 方法
def build_command(self, prompt: str, history_file: Optional[str] = None) -> List[str]:
    cmd = [self.config.command]

    if self.config.default_model:
        cmd.extend(["--model", self.config.default_model])

    if history_file:
        cmd.extend(["--context", history_file])

    # 使用 -- 分隔符防止选项注入
    cmd.append("--")
    cmd.append(prompt)

    return cmd
```

**验证步骤**:
1. 修改代码
2. 测试包含特殊字符的 prompt（如 `-h`、`--help`）
3. 验证命令正确执行而非显示帮助信息

#### 阶段 1 交付标准

- [ ] `config.yaml` 中无硬编码凭证
- [ ] `codex.py` 使用 `--` 分隔符
- [ ] 功能测试通过
- [ ] 代码审查通过

---

### 阶段 2: 架构拆分

**目标**: 拆分臃肿的 MessageHandler
**预计时间**: 1-2 天
**优先级**: 🔴 最高

#### 任务 2.1: 提取 MessageParser

**新文件**: `src/feishu/message_parser.py`
**职责**: 解析飞书事件数据

```python
# 待实现的核心方法
class MessageParser:
    def parse_event_data(self, event_data: dict) -> ParsedMessage
    def extract_message_content(self, message_data: dict) -> str
    def parse_attachment(self, attachment_data: dict) -> Attachment
```

**从 handler.py 提取代码**:
- `_parse_event_data()` 方法（约 50 行）
- `_extract_message_content()` 方法（约 80 行）
- 相关数据类定义

#### 任务 2.2: 提取 CommandRouter

**新文件**: `src/feishu/command_router.py`
**职责**: 路由命令到对应处理器

```python
# 待实现的核心方法
class CommandRouter:
    def is_project_command(self, content: str) -> bool
    def is_tui_command(self, content: str) -> bool
    def route(self, content: str, message: ParsedMessage) -> CommandType
```

**从 handler.py 提取代码**:
- 命令识别逻辑（约 100 行）
- 路由分发逻辑（约 150 行）

#### 任务 2.3: 提取 CardCallbackHandler

**新文件**: `src/feishu/card_callback_handler.py`
**职责**: 处理卡片回调事件

```python
# 待实现的核心方法
class CardCallbackHandler:
    def handle_switch_project(self, action_value: dict) -> dict
    def handle_switch_session(self, action_value: dict) -> dict
    def handle_delete_session(self, action_value: dict) -> dict
    # 其他 15+ 个 action 处理方法
```

**从 handler.py 提取代码**:
- `_handle_card_callback()` 主方法（约 100 行）
- 15+ 个 action 处理方法（约 600 行）

#### 任务 2.4: 重构 MessageHandler

**文件**: `src/feishu/handler.py`
**目标**: 保持对外接口不变，内部委托给新组件

```python
class MessageHandler:
    def __init__(self, ...):
        self.parser = MessageParser()
        self.router = CommandRouter(self.tui_router, self.project_manager)
        self.callback_handler = CardCallbackHandler(...)

    async def handle_message(self, event_data: dict):
        message = self.parser.parse_event_data(event_data)
        command_type = self.router.route(message.content, message)
        # 根据 command_type 分发处理
```

**目标代码行数**: 从 1500 行减少到 300-400 行

#### 阶段 2 交付标准

- [ ] `message_parser.py` 创建并测试通过
- [ ] `command_router.py` 创建并测试通过
- [ ] `card_callback_handler.py` 创建并测试通过
- [ ] `handler.py` 重构后功能正常
- [ ] 所有单元测试通过

---

### 阶段 3: 性能修复

**目标**: 修复事件循环绑定问题
**预计时间**: 0.5 天
**优先级**: 🟡 中等

#### 任务 3.1: 重构 OpenCodeServerManager 生命周期

**文件**: `src/adapters/opencode.py:288-344`
**问题**: 运行时重试处理 "bound to a different event loop"
**修复方案**:

```python
# 修改前：懒加载 + 运行时重试
@property
async def _http_client(self) -> httpx.AsyncClient:
    if self._client is None:
        self._client = httpx.AsyncClient(...)
    return self._client

# 修改后：应用启动时初始化
class OpenCodeServerManager:
    def __init__(self):
        self._client: Optional[httpx.AsyncClient] = None
        self._init_lock = asyncio.Lock()

    async def initialize(self):
        """在应用启动时调用"""
        async with self._init_lock:
            if self._client is None:
                self._client = httpx.AsyncClient(...)
```

**需要修改的文件**:
- `opencode.py`: 添加 `initialize()` 方法
- `main.py`: 启动时调用 `await opencode_adapter.initialize()`

#### 任务 3.2: 文件 I/O 异步化

**文件**: `src/adapters/opencode.py:635`
**修复方案**:
```python
# 修改前
with open(att["path"], "rb") as f:
    raw = f.read()

# 修改后
raw = await asyncio.to_thread(Path(att["path"]).read_bytes)
```

#### 阶段 3 交付标准

- [ ] 事件循环绑定问题修复
- [ ] 文件 I/O 使用异步方式
- [ ] 无运行时重试日志
- [ ] 性能测试通过

---

## 第二轮：质量优化

### 阶段 4: 代码规范

**目标**: 修复代码规范问题
**预计时间**: 1 天
**优先级**: 🟢 低

#### 任务 4.1: 修复裸 except 子句

**文件**:
- `card_builder.py:2077`
- `client.py:364`
- `handler.py:399`

**修复示例**:
```python
# 修改前
except:
    content_obj = {"text": content_str}

# 修改后
except json.JSONDecodeError:
    content_obj = {"text": content_str}
```

#### 任务 4.2: 提取重复代码

**任务 4.2.1: Toast 构造辅助函数**

**新文件**: `src/feishu/toast_helper.py`

```python
def error_toast(message: str) -> dict:
    return {
        "toast": {
            "type": "error",
            "content": message,
            "i18n": {"zh_cn": message}
        }
    }

def success_toast(message: str) -> dict:
    return {
        "toast": {
            "type": "success",
            "content": message,
            "i18n": {"zh_cn": message}
        }
    }
```

**替换位置**: `handler.py` 中 4+ 处 Toast 构造代码

**任务 4.2.2: Token 估算统一**

**文件**: `src/adapters/base.py`、`src/adapters/opencode.py`

**方案**: 提取到 `base.py` 作为通用方法，移除 `opencode.py` 中的重复实现

#### 任务 4.3: 拆分超大文件

**任务 4.3.1: 拆分 card_builder.py**

**当前**: 2,248 行
**拆分方案**:
```
card_builder/
├── __init__.py          # 导出公共接口
├── base.py              # 基础卡片构建
├── text_card.py         # 文本卡片
├── list_card.py         # 列表卡片
├── interactive_card.py  # 交互卡片
└── utils.py             # 工具函数
```

**任务 4.3.2: 拆分 opencode.py**

**当前**: 1,626 行
**拆分方案**:
```
opencode/
├── __init__.py          # 导出 OpenCodeAdapter
├── adapter.py           # 主适配器类（简化版）
├── server_manager.py    # 服务器生命周期管理（从现有提取）
├── session_manager.py   # 会话管理
├── model_manager.py     # 模型管理
├── tui_commands.py      # TUI 命令处理
└── stream_parser.py     # SSE 流解析
```

#### 阶段 4 交付标准

- [ ] 3 处裸 except 子句修复
- [ ] Toast 辅助函数提取并使用
- [ ] Token 估算逻辑统一
- [ ] `card_builder.py` 拆分完成
- [ ] `opencode.py` 拆分完成

---

### 阶段 5: 依赖清理

**目标**: 移除未使用依赖，优化版本约束
**预计时间**: 0.5 天
**优先级**: 🟢 低

#### 任务 5.1: 移除未使用依赖

**文件**: `requirements.txt`

```txt
# 移除
aiofiles>=23.0
pydantic>=2.0

# 保留
lark-oapi>=2.0.0      # 升级版本
pyyaml>=6.0
rich>=13.0
httpx>=0.27.0,<1.0.0  # 添加上限
httpx-sse>=0.4.0,<1.0.0
```

#### 任务 5.2: 清理过时配置项

**文件**: `config.yaml`

```yaml
session:
  # 移除以下配置（已废弃）
  # storage_dir: ".sessions"

  # 保留
  max_sessions: 15
  max_history: 20
```

#### 任务 5.3: 统一环境变量默认值

**文件**: `src/config.py`

```python
# 修改前
"OPENCODE_MODEL": ("cli.opencode.default_model", "gpt-4"),

# 修改后
"OPENCODE_MODEL": ("cli.opencode.default_model", "kimi-for-coding/k2p5"),
```

#### 阶段 5 交付标准

- [ ] `requirements.txt` 移除未使用依赖
- [ ] `config.yaml` 移除过时配置
- [ ] 环境变量默认值统一
- [ ] 应用正常启动并测试通过

---

### 阶段 6: 错误处理增强

**目标**: 增强错误处理机制
**预计时间**: 1 天
**优先级**: 🟡 中等

#### 任务 6.1: 实现指数退避重试

**新文件**: `src/utils/retry.py`

```python
import asyncio
from typing import Callable, TypeVar, Tuple, Type

T = TypeVar('T')

async def retry_with_backoff(
    func: Callable[[], T],
    max_retries: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 30.0,
    retryable_exceptions: Tuple[Type[Exception], ...] = (Exception,),
) -> T:
    """指数退避重试

    Args:
        func: 要重试的异步函数
        max_retries: 最大重试次数
        base_delay: 基础延迟（秒）
        max_delay: 最大延迟（秒）
        retryable_exceptions: 可重试的异常类型
    """
    for attempt in range(max_retries):
        try:
            return await func()
        except retryable_exceptions as e:
            if attempt == max_retries - 1:
                raise

            delay = min(base_delay * (2 ** attempt), max_delay)
            await asyncio.sleep(delay)
```

**应用位置**:
- `api.py`: 卡片创建、消息发送
- `cardkit_client.py`: CardKit 实体更新

#### 任务 6.2: 添加错误代码体系

**新文件**: `src/utils/error_codes.py`

```python
from enum import Enum

class ErrorCode(Enum):
    # CardKit 错误
    CARDKIT_RATE_LIMIT = "230020"
    CARDKIT_SEQ_CONFLICT = "300317"
    CARDKIT_CARD_NOT_FOUND = "300301"

    # 网络错误
    NETWORK_TIMEOUT = "NET001"
    NETWORK_CONNECTION_ERROR = "NET002"

    # 服务器错误
    SERVER_START_FAILED = "SRV001"
    SERVER_NOT_RESPONDING = "SRV002"

    # 会话错误
    SESSION_NOT_FOUND = "SES001"
    SESSION_EXPIRED = "SES002"

class FeishuBridgeError(Exception):
    """基础异常"""
    def __init__(self, message: str, code: ErrorCode = None):
        super().__init__(message)
        self.code = code
        self.message = message

class TransientError(FeishuBridgeError):
    """可重试错误（网络超时等）"""
    pass

class PermanentError(FeishuBridgeError):
    """不可恢复错误（配置错误等）"""
    pass
```

#### 任务 6.3: 优化错误日志

**文件**: `src/adapters/opencode.py:700-706`

```python
# 修改前
if self.logger:
    event_preview = raw_data[:150] if len(raw_data) > 150 else raw_data
    self.logger.info(f"DEBUG SSE RAW: {event_preview}")

# 修改后
if self.logger and self.logger.isEnabledFor(logging.DEBUG):
    event_preview = raw_data[:150] if len(raw_data) > 150 else raw_data
    self.logger.debug(f"SSE RAW: {event_preview}")
```

**添加采样机制**（可选）:
```python
# 每 100 条记录一次
self._sse_event_counter += 1
if self._sse_event_counter % 100 == 0:
    self.logger.info(f"SSE events processed: {self._sse_event_counter}")
```

#### 阶段 6 交付标准

- [ ] `retry.py` 实现并应用到关键操作
- [ ] `error_codes.py` 创建并使用
- [ ] SSE 日志优化
- [ ] 错误处理测试通过

---

## 验证计划

### 单元测试

每个阶段完成后运行：
```bash
ruff check src/
mypy src/
python -m pytest tests/ -v
```

### 集成测试

第二轮结束后进行：
```bash
# 启动服务
python -m src.main

# 测试场景
1. 发送普通消息 → 验证流式回复
2. 发送图片 → 验证图片处理
3. 使用 TUI 命令 (/new, /session) → 验证交互
4. 切换项目 → 验证项目隔离
5. 长对话（>50轮）→ 验证稳定性
```

### 安全检查

```bash
# 检查硬编码凭证
grep -r "cli_" config.yaml

# 检查裸 except
grep -rn "except:" src/ | grep -v "except Exception" | grep -v "except json"

# 检查日志中的敏感信息
grep -rn "logger.info.*cmd" src/adapters/
```

---

## 回滚计划

如果修复过程中出现严重问题：

```bash
# 查看提交历史
git log --oneline -20

# 回滚到指定提交
git reset --hard <commit_hash>

# 或者回滚单个文件
git checkout HEAD -- src/feishu/handler.py
```

---

## 后续计划

修复完成后：

1. **新 CLI 工具对接**: 在稳定的架构基础上开发
2. **性能优化**: 根据实际使用情况进行针对性优化
3. **监控增强**: 添加更多指标和告警
4. **文档更新**: 更新架构文档，反映新的代码结构

---

*本计划由 Claude Code 制定*
*文档仅上传本地代码库（Gitea），不上传 GitHub*
