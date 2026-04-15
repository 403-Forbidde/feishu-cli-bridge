# 更新日志

## v0.3.1 - OpenCode 1.4.4 兼容优化版（2026-04-15）

### 里程碑

- **2026-04-15** - **feat: OpenCode 1.4.4 兼容性优化**
  - 适配新版服务器 API 变化（`/global/health`、空 `/models`、Agent 名称零宽字符）
  - `/model` 命令支持动态读取 `~/.cache/opencode/models.json` 中的 opencode 官方免费模型
  - 严格过滤：仅显示 `status !== 'deprecated'` 且 ID 以 `-free` 结尾或 `big-pickle` 的免费模型

### 新增功能

- **2026-04-15** - OpenCode 服务器访问密码支持
  - `OpenCodeConfig` 新增 `serverPassword?` 字段
  - HTTP 客户端自动注入 `Authorization: Bearer` 请求头
  - 服务器管理器启动时注入 `OPENCODE_SERVER_PASSWORD` 环境变量
- **2026-04-15** - 模型能力标签展示
  - `buildModelSelectCard()` 中显示 reasoning、attachment、toolcall 等能力标签
- **2026-04-15** - Claude Code 模型能力标签
  - `ClaudeCodeAdapter.listModels()` 为内置模型补充 `capabilities`（推理、工具、识图）
  - `auto` 模式及未知检测模型默认展示完整能力标签
- **2026-04-15** - 会话统计展示
  - 会话列表卡片新增 `+additions / -deletions · files` 变更统计
- **2026-04-15** - Agent 名称规范化
  - `listAgents()` 添加 `normalizeAgentName()` 和 `cleanAgentName()` 处理零宽字符
- **2026-04-15** - oh-my-openagent `/mode` 适配
  - 检测到 oh-my-openagent 时 `/mode` 仅展示 4 个主编排 Agent（Sisyphus、Hephaestus、Prometheus、Atlas）
  - 为每个 Agent 绑定品牌色卡片展示（turquoise / orange / red / green）
  - `AgentInfo` 扩展 `color` 字段，`buildModeSelectCard` 支持按自定义颜色渲染名称

### 修复

- **2026-04-15** - 修复 OpenCode 1.4.4 `/models` 端点返回空数组导致模型列表无法获取的问题
- **2026-04-15** - 修复 `/model` 卡片因模型数量过多导致 JSON 过大触发飞书 400 错误的问题
- **2026-04-15** - 修复 OpenCode `/model` 卡片中"当前激活"模型不显示能力标签的问题
  - 根因：`listModels()` 中 HTTP 客户端未初始化，`/provider` API 调用失败
  - 修复：在 `listModels()` 开头调用 `ensureServer()` 保证客户端已就绪
- **2026-04-15** - 修复 OpenCode `config.yaml` 配置的模型缺少能力标签的问题
  - 优先从 `/provider` API 补充 capabilities
  - API 失败时从本地缓存 `~/.cache/opencode/models.json` 回补充
- **2026-04-15** - 统一视觉能力标签文案为 `🖼️ 识图`（原 `🖼️ 图片`）

---

## v0.3.0 - Claude Code 适配器支持版（2026-04-03）

### 里程碑

- **2026-04-03** - **feat: 新增 Claude Code 适配器支持（生产就绪）**
  - 完整实现 Claude Code CLI 适配器，支持流式对话
  - 子进程管理：`spawn` + JSON Lines 流式解析
  - 会话管理：`--session-id` + `--resume` + `--fork-session`
  - 停止生成：`SIGINT` 信号优雅终止
  - 模型动态检测：从 `result.modelUsage` 自动读取实际模型（支持 Kimi 等第三方 Provider）
  - 附件处理：临时文件 + `@filepath` 引用
  - **测试覆盖**：61 个单元测试全部通过

### 新增功能

- **2026-04-03** - Claude Code 适配器核心实现
  - `ClaudeCodeAdapter` 主类，继承 `BaseCLIAdapter`
  - `ClaudeCodeProcessManager` 子进程生命周期管理
  - `ClaudeCodeStreamParser` stream-json 解析器（28 个单元测试）
  - `ClaudeCodeSessionManager` 会话 ID 映射与持久化
- **2026-04-03** - 配置系统扩展
  - 新增 `cli.claude` 配置段，支持 `auto` 模式动态检测模型
  - 环境变量支持：`CLAUDE_ENABLED`, `CLAUDE_CMD`, `CLAUDE_MODEL` 等
- **2026-04-03** - 设置向导扩展
  - 安装向导支持 Claude Code 检测与配置
  - 多 CLI 工具同时配置支持（OpenCode + Claude）
- **2026-04-03** - 完整单元测试覆盖
  - `stream-parser.test.ts`: 28 个测试用例
  - `process-manager.test.ts`: 15 个测试用例
  - `adapter.test.ts`: 18 个测试用例

### 修复

- **2026-04-03** - 修复 `adapter.ts` 中 `buildFullPrompt` 先于 `prepareAttachments` 调用导致附件 `@path` 缺失的 bug
- **2026-04-03** - 修复 `session-manager.ts` 中会话验证过于严格导致 headless 模式下会话映射被错误清理的问题

### 文档

- **2026-04-03** - 创建 `doc/claude-stream-format.md` 流格式说明文档
- **2026-04-03** - 创建 `doc/issues/001-claude-session-not-persisting.md` 问题记录

---

## v0.2.1 - TypeScript/Node.js 全面迁移版

### 里程碑

- **2026-04-01** `30ace6a` - **feat: 全面迁移至 TypeScript/Node.js (v0.2.1)**
  - 完成从 Python 到 TypeScript/Node.js 的全量重构
  - 实现 100% 功能与旧版对齐
  - 引入严格类型安全、分层架构、安全加固等重大改进

### 新增功能

- **2026-04-02** — 交互式安装向导 (`feishu-bridge-setup`)
  - 一站式环境检测：Node.js、OpenCode CLI、系统服务管理器
  - 自动凭据验证：App ID 格式校验、飞书 API 在线验证
  - 跨平台服务配置：systemd (Linux) / launchd (macOS) 用户级服务
  - 交互式模型选择、npm 镜像切换、登录引导
- **2026-04-01** `68b3efa` - `/model` 命令支持交互式模型切换卡片
- **2026-04-02** `82f7304` - 优化项目管理卡片，添加分页功能
- **2026-04-02** `c13de06` - 统一所有 TUI 命令回复为卡片消息
- **2026-04-02** `b131dff` - 统一会话管理卡片按钮尺寸并补充取消按钮图标
- **2026-04-02** `0a8715e` - 项目管理删除操作添加确认步骤

### 修复

- **2026-04-02** `07ee8cd` - 调整项目管理卡片操作按钮为左对齐紧凑排列

### 重构

- **2026-04-02** `42c20a8` - 统一默认配置目录名为 `feishu-cli-bridge`

### 文档

- **2026-04-01** `c87a878` - 创建中英双语 README，添加 doc 文档目录
- **2026-04-01** `5095925` - 移动中文 README 到 doc 目录，更新致谢部分
- **2026-04-02** `a944f46` - 添加交互式安装向导设计文档 `SETUP_WIZARD_DESIGN.md`
- **2026-04-02** `b96b6f8` - 更新 README、AGENTS.md 和 CLAUDE.md
- **2026-04-02** `97a6d13` - 美化 README 文档排版和视觉效果

### 杂项

- **2026-04-02** `82a2935` - 删除 doc/.gitkeep 并添加 push_github.sh
