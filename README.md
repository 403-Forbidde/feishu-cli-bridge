# Feishu CLI Bridge

通过飞书控制 OpenCode、Claude Code、Codex 等 CLI 工具的个人 AI 助手，实现与 OpenClaw 飞书插件一致的交互体验。

**版本**: v0.0.2  
**开发**: ERROR403  
**更新日期**: 2026-03-20

## 功能特性

- 🤖 **多 CLI 支持** - 支持 OpenCode、Claude Code、Codex 等主流 AI CLI 工具
- 💬 **CardKit 流式输出** - 真正的打字机效果，逐字动画显示，左下角 loading 动画
- 📊 **Token 统计** - 消息右下角显示上下文长度、Token 消耗、占用率
- 💭 **思考过程展示** - 可折叠思考面板，实时显示 AI 思考过程
- 📝 **会话管理** - 自动维护对话上下文，LRU 策略保留最近 10 个会话
- 🎯 **群聊支持** - @机器人即可触发对话，显示原生引用气泡
- 🔄 **上下文隔离** - 每个工作目录独立会话，避免混淆
- ⚡ **智能节流** - CardKit 100ms / IM Patch 1500ms 双模式，长间隙批处理优化
- 🎮 **TUI 命令** - 通过斜杠命令管理会话和切换模型（/new、/session、/model）

## 快速开始

### 1. 安装依赖

```bash
# 克隆仓库
cd feishu-cli-bridge

# 安装 Python 依赖
pip install -r requirements.txt

# 或使用 uv（推荐）
uv pip install -r requirements.txt
```

### 2. 配置飞书机器人

编辑 `config.yaml`：

```yaml
feishu:
  app_id: "YOUR_APP_ID_HERE"
  app_secret: "YOUR_APP_SECRET_HERE"
```

或通过环境变量配置：

```bash
export FEISHU_APP_ID="YOUR_APP_ID_HERE"
export FEISHU_APP_SECRET="YOUR_APP_SECRET_HERE"
```

### 3. 启动服务

```bash
python -m src.main
```

## 使用指南

### 私聊

直接在飞书私聊中发送消息即可：

```
帮我写一个 Python 脚本来处理 CSV 文件
```

### 群聊

在群聊中需要 @机器人：

```
@机器人 解释一下这段代码的作用
```

AI 回复会显示引用气泡："回复 ERROR403: 解释一下这段代码的作用"

### 切换 CLI 工具

可以通过 @ 指定使用特定的 CLI 工具：

```
@claude 帮我重构这个函数
@codex 生成一个 React 组件
```

默认优先级：OpenCode > Claude Code > Codex

### 命令

| 命令 | 说明 |
|-----|------|
| `/new` | 创建新会话 |
| `/session` | 列出最近 10 个会话，回复数字或 ID 切换 |
| `/model` | 列出可用模型，回复模型 ID 切换 |
| `/reset` 或 `/clear` | 清空当前会话的上下文 |
| `/help` | 显示帮助信息 |

#### TUI 命令使用示例

**会话管理：**
```
/session           # 显示会话列表
回复: 1            # 切换到第 1 个会话
回复: FSB-abc123   # 切换到指定 ID 的会话
/new               # 创建新会话
```

**模型切换：**
```
/model                              # 显示可用模型列表
回复: opencode/mimo-v2             # 切换到 Mimo V2
回复: anthropic/claude-sonnet-4    # 切换到 Claude Sonnet 4
```

## 配置文件

完整的 `config.yaml` 示例：

```yaml
# 飞书配置
feishu:
  app_id: "YOUR_APP_ID_HERE"
  app_secret: "YOUR_APP_SECRET_HERE"

# 会话配置
session:
  max_sessions: 10          # 最大保留会话数
  max_history: 20           # 单会话最大历史轮数
  storage_dir: ".sessions"  # 会话存储目录

# CLI 工具配置
cli:
  opencode:
    enabled: true
    command: "opencode"
    default_model: "kimi-for-coding/k2p5"
    timeout: 300
  
  claudecode:
    enabled: true
    command: "claude"
    default_model: "claude-3-5-sonnet-20241022"
    timeout: 300

# 流式输出配置（可选，使用默认值即可）
streaming:
  cardkit_throttle_ms: 100      # CardKit 刷新间隔
  patch_throttle_ms: 1500       # IM Patch 刷新间隔
  long_gap_threshold_ms: 2000   # 长间隙检测阈值
  batch_after_gap_ms: 300       # 长间隙后批处理窗口
```

## 消息格式

### AI 回复消息结构

```
┌─────────────────────────────────────────┐
│ 回复 ERROR403: 把你的skill列一下          │  ← 飞书原生引用气泡
├─────────────────────────────────────────┤
│ 💭 Thought for 3.2s  [展开/折叠]         │  ← 可折叠思考面板
├─────────────────────────────────────────┤
│ 这是 AI 的回复内容...                    │  ← 主回答内容（打字机效果）
│ ...                                     │
├─────────────────────────────────────────┤
│ ...                                     │  ← 左下角 loading 动画（流式中）
├─────────────────────────────────────────┤
│ ✅ 已完成 · 耗时 3.2s · 📊 1.2K/8K (15%) │  ← 右对齐 Footer 元数据
└─────────────────────────────────────────┘
```

### Footer 元数据说明

- **✅ 已完成** - 状态标识（出错时显示 ❌ 出错）
- **耗时 3.2s** - 总响应时间
- **📊 1.2K/8K (15%)** - 已用 Token / 上下文窗口 (占用率)
- **💰 2.4K tokens** - 本次对话消耗 Token
- **🤖 Claude-Sonnet** - 使用的 AI 模型

## 会话管理

### 存储位置

会话数据存储在 `.sessions/` 目录下的 JSON 文件中：

```
.sessions/
├── a1b2c3d4e5f6.json
├── b2c3d4e5f6g7.json
└── ...
```

### LRU 淘汰

- 最多保留 **10** 个会话（可配置）
- 当超过限制时，自动删除最久未使用的会话
- 每个工作目录 + CLI 类型组合对应一个独立会话

## 开发

### 项目结构

```
feishu-cli-bridge/
├── src/
│   ├── adapters/              # CLI 适配器
│   │   ├── base.py            # 适配器基类
│   │   ├── opencode.py        # OpenCode 适配器（优化 REASONING 去重）
│   │   ├── claudecode.py      # Claude Code 适配器
│   │   └── codex.py           # Codex 适配器
│   ├── feishu/                # 飞书模块
│   │   ├── client.py          # WebSocket 客户端
│   │   ├── api.py             # API 封装（ReplyMessageRequest 引用支持）
│   │   ├── handler.py         # 消息处理器
│   │   ├── cardkit_client.py  # CardKit API 客户端
│   │   ├── streaming_controller.py  # 流式卡片控制器
│   │   ├── card_builder.py    # 卡片构建器（Schema 2.0）
│   │   ├── flush_controller.py # 节流刷新控制器
│   │   └── formatter.py       # 消息格式化
│   ├── session/               # 会话管理
│   │   └── manager.py         # 会话管理器
│   ├── config.py              # 配置管理
│   └── main.py                # 主程序入口
├── doc/
│   ├── CHANGELOG.md           # 更新日志
│   └── ISSUES.md              # 问题追踪
├── config.yaml                # 配置文件
├── requirements.txt           # 依赖列表
└── README.md
```

### 技术亮点

#### 1. FlushController（节流调度）

```python
# 参考 OpenClaw-Lark 实现
class FlushController:
    - 互斥刷新保护
    - 双模式节流：CardKit 100ms / IM Patch 1500ms
    - 长间隙检测：>2000ms 后延迟 300ms 批处理
    - 冲突自动 reflush
```

#### 2. CardKit 流式流程

```
用户消息
    ↓
添加 ✏️ Typing Reaction（用户消息上的打字动画）
    ↓
懒创建 CardKit 实体（第一个数据包到来时才创建）
    ↓
发送 IM 消息引用 card_id（ReplyMessageRequest，带引用气泡）
    ↓
流式更新内容（cardElement.content，100ms 节流）
    │   • 思考阶段：显示"💭 Thinking...\n{reasoning}"（loading 动画继续）
    │   • 回答阶段：打字机效果渐增内容
    ↓
关闭流式模式（setCardStreamingMode(false)）
    ↓
更新最终卡片（可折叠思考面板 + 正文 + Footer 元数据）
    ↓
移除 Typing Reaction
```

#### 3. Schema 2.0 卡片格式

所有卡片统一使用飞书 Schema 2.0：
```json
{
  "schema": "2.0",
  "config": {"wide_screen_mode": true, "update_multi": true},
  "body": {"elements": [...]}
}
```

### 添加新的 CLI 适配器

1. 在 `src/adapters/` 下创建新的适配器类，继承 `BaseCLIAdapter`：

```python
from .base import BaseCLIAdapter, StreamChunk, StreamChunkType

class MyCLIAdapter(BaseCLIAdapter):
    @property
    def name(self) -> str:
        return "mycli"
    
    @property
    def default_model(self) -> str:
        return "my-model"
    
    async def execute_stream(self, prompt, context, working_dir):
        # 实现流式执行逻辑
        pass
    
    def parse_chunk(self, raw_line):
        # 解析 CLI 输出
        pass
```

2. 在 `src/adapters/__init__.py` 中注册适配器：

```python
from .mycli import MyCLIAdapter

_ADAPTER_REGISTRY = {
    # ... 其他适配器
    "mycli": MyCLIAdapter,
}
```

3. 在 `config.yaml` 中添加配置：

```yaml
cli:
  mycli:
    enabled: true
    command: "mycli"
    default_model: "my-model"
    timeout: 300
```

## 更新日志

### v0.0.2 (2026-03-20)

- ✅ TUI 命令系统（`/new`、`/session`、`/model`、`/reset`）
- ✅ 交互式消息支持（回复数字/模型 ID 切换）
- ✅ 会话管理功能（创建、列出、切换、重置）
- ✅ 模型切换功能（只显示已配置 API key 的模型）
- ✅ 消息格式美化（Markdown 加粗、代码块）

### v0.0.1 (2026-03-20)

- ✅ CardKit 流式输出实现（打字机效果 + loading 动画）
- ✅ 飞书原生引用气泡支持（ReplyMessageRequest）
- ✅ 可折叠思考面板 + Footer 元数据右对齐
- ✅ Schema 2.0 卡片格式（修复 CardKit/IM Patch 错误）
- ✅ FlushController 节流调度（100ms/1500ms 双模式）
- ✅ OpenCode REASONING 去重优化
- ✅ Markdown 样式优化（标题降级、代码块间距、图片过滤）

完整日志见 [doc/CHANGELOG.md](doc/CHANGELOG.md)

## 环境变量

所有配置项都支持通过环境变量设置：

| 环境变量 | 说明 | 默认值 |
|---------|------|--------|
| `FEISHU_APP_ID` | 飞书 App ID | - |
| `FEISHU_APP_SECRET` | 飞书 App Secret | - |
| `MAX_SESSIONS` | 最大会话数 | 15 |
| `MAX_HISTORY` | 最大历史轮数 | 20 |
| `SESSION_DIR` | 会话存储目录 | .sessions |
| `OPENCODE_ENABLED` | 启用 OpenCode | true |
| `OPENCODE_CMD` | OpenCode 命令 | opencode |
| `OPENCODE_MODEL` | OpenCode 默认模型 | gpt-4 |
| `CLAUDECODE_ENABLED` | 启用 Claude Code | true |
| `CLAUDECODE_CMD` | Claude Code 命令 | claude |
| `CLAUDECODE_MODEL` | Claude Code 默认模型 | claude-3-5-sonnet |
| `LOG_LEVEL` | 日志级别 | INFO |

## 日志

日志文件保存在 `logs/` 目录下，按日期命名：

```
logs/
├── 20260320.log
└── ...
```

## 许可证

MIT License

## 致谢

- [Lark OpenAPI SDK](https://github.com/larksuite/oapi-sdk-python)
- OpenClaw-Lark: ByteDance 官方飞书插件（体验参考）
- kimibridge: 流式输出实现参考

## 问题反馈

如有问题请查看 [doc/ISSUES.md](doc/ISSUES.md) 或提交 Issue。
