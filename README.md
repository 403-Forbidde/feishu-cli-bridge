<div align="center">

<!-- Logo/Title -->
<img src="https://img.shields.io/badge/Feishu-CLI%20Bridge-1677FF?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik0xMiAybDIuNCA3LjJoNy42bC02IDQuOCAyLjQgNy4yLTYtNC44LTYgNC44IDIuNC03LjItNi00LjhoNy42eiIvPjwvc3ZnPg==&logoColor=white" height="40" alt="Feishu CLI Bridge">

<h1>
  <img src="https://img.shields.io/badge/🚀-Feishu%20CLI%20Bridge-FF6B6B?style=flat-square&colorA=2d3436&colorB=FF6B6B" height="28">
</h1>

<p align="center">
  <b>A Node.js/TypeScript bridge connecting Feishu (Lark) to OpenCode CLI</b><br>
  <i>Delivering a streaming "typewriter" chat experience inside Feishu</i>
</p>

<!-- Language Switch -->
<p>
  <a href="#-feishu-cli-bridge">
    <img src="https://img.shields.io/badge/🇬🇧-English-white?style=flat-square&color=3498db" height="20">
  </a>
  <a href="doc/README_CN.md">
    <img src="https://img.shields.io/badge/🇨🇳-简体中文-white?style=flat-square&color=2ecc71" height="20">
  </a>
</p>

<!-- Status Badges -->
<p>
  <img src="https://img.shields.io/badge/version-v0.2.0-FF6B6B?style=flat-square&logo=semver&logoColor=white" alt="Version">
  <img src="https://img.shields.io/badge/license-MIT-4ECDC4?style=flat-square&logo=opensourceinitiative&logoColor=white" alt="License">
  <img src="https://img.shields.io/badge/TypeScript-5.0+-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Node.js-20+-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js">
</p>

<!-- Platform Support -->
<p>
  <img src="https://img.shields.io/badge/Windows-0078D6?style=flat-square&logo=windows&logoColor=white" alt="Windows">
  <img src="https://img.shields.io/badge/Linux-FCC624?style=flat-square&logo=linux&logoColor=black" alt="Linux">
  <img src="https://img.shields.io/badge/macOS-000000?style=flat-square&logo=apple&logoColor=white" alt="macOS">
</p>

<!-- Last Updated -->
<p>
  <img src="https://img.shields.io/badge/Updated-2026--04--02-9b59b6?style=flat-square" alt="Updated">
</p>

</div>

---

## 📑 Table of Contents

- [🎯 Use Cases](#-use-cases)
- [✨ Features](#-features)
- [🗺️ Roadmap](#️-roadmap)
- [⚡ Quick Start](#-quick-start)
- [📖 Usage](#-usage)
- [⚙️ Configuration](#️-configuration)
- [🏗️ Project Structure](#️-project-structure)
- [🔧 Development Commands](#-development-commands)
- [📝 Changelog](#-changelog)
- [📄 License](#-license)

---

## 🎯 Use Cases

**Personal programming assistant.** Send programming instructions to your bot via Feishu private chat from any device, and the bridge forwards commands to local CLI AI tools, streaming results back.

**Supported Platforms**: Windows, Linux, macOS (Apple Silicon / Intel)

### Typical Scenarios

| Scenario | Description |
|:---------|:------------|
| 📱 **Mobile Review** | Review code or ask AI for explanations on your phone |
| 💼 **Meeting Tasks** | Initiate background refactoring tasks during meetings |
| 🔄 **Context Switching** | Switch between project directories for AI context-aware work |
| 🪟 **Windows Access** | Access local OpenCode through Feishu in Windows development environments |

---

## ✨ Features

<table>
<tr>
<td width="50%">

### 🤖 **OpenCode Integration**
HTTP/SSE protocol, auto-start and manage `opencode serve`, pre-authorize external directory access (no blocking in headless mode)

### 🎭 **Agent Modes**
Built-in Build / Plan modes; auto-detect oh-my-openagent, switch to 7 professional agents when installed, `/mode` card for quick switching

### 🔀 **Model Switching**
`/model` card displays models from `config.yaml`, click to switch instantly without restart

### 💬 **CardKit Streaming**
True typewriter effect, 100ms throttled updates; auto-fallback to IM Patch (1500ms) when CardKit unavailable

### 💭 **Thinking Process**
Collapsible thinking panel, real-time AI reasoning display, continues waiting for text replies after tool calls

</td>
<td width="50%">

### 📊 **Token Statistics**
Right-aligned footer displaying elapsed time, token usage, context percentage, and model name

### 🖼️ **Image/File Input**
Automatic download and base64 encoding of images/files sent, passed as FilePart for vision model recognition

### 📁 **Project Management**
`/pl` interactive card for managing multiple working directories, with pagination, "Switch" button, and delete confirmation

### 🔄 **Working Directory Isolation**
Each project has independent OpenCode session (via `directory` parameter), tool calls execute in precise CWD isolation

### ⚡ **Smart Throttling**
Batch processing after long gaps to avoid sparse initial updates

</td>
</tr>
</table>

---

## 🗺️ Roadmap

### Milestone Overview

| Milestone | Core Deliverables | Status |
|:----------|:------------------|:------:|
| **v0.2.0** | TypeScript Rewrite · Architecture Optimization · Performance Improvements | ✅ Completed |
| **v0.3.0** | Claude Code Adapter | 🔜 Planned |
| **v0.4.0** | Kimi CLI Adapter (Wire Protocol) | 🔜 Planned |
| **v0.5.0** | Codex CLI Adapter | 🔜 Planned |
| **v1.0.0** | First Stable Release | 🔜 Planned |

---

### ✅ v0.2.0 (Current) — TypeScript Rewrite Complete

- [x] Full migration to TypeScript/Node.js stack
- [x] Layered architecture: Core → Platform → Adapter
- [x] Type safety: Strict TypeScript type definitions
- [x] Performance optimization: HTTP connection pooling, smart throttling
- [x] Security hardening: Path traversal protection, input validation
- [x] Feature complete: 100% parity with Python version
- [x] CardKit streaming (typewriter effect + loading animation, 100ms throttle)
- [x] IM Patch fallback (auto-switch when CardKit unavailable, 1500ms throttle)
- [x] Collapsible thinking panel (real-time reasoning display)
- [x] Image / file input (base64 FilePart, vision model recognition)
- [x] Multi-project management (`/pl` interactive card with pagination and delete confirmation)
- [x] TUI commands (`/new` `/session` `/model` `/mode` `/reset` `/help` `/stop`), all replied as interactive cards
- [x] OpenCode Server session management (fully delegated to OpenCode server, zero local persistence)
- [x] Cross-platform support: Windows / Linux / macOS

---

### 🔜 v0.3.0 — Claude Code Adapter

**Goal**: Integrate Claude Code CLI via subprocess mode, invoked with `@claude` prefix.

| Feature | Description |
|:--------|:------------|
| Subprocess Streaming Output | Real-time stdout/stderr parsing for streaming responses |
| Session Management | Isolated sessions from OpenCode, LRU-based reuse |
| Dual Parallel Enablement | `@opencode` / `@claude` free switching |
| Image Input Support | Unified attachment preprocessing pipeline |

---

### 🔜 v0.4.0 — Kimi CLI Adapter (Wire Protocol)

**Goal**: Integrate [Kimi CLI](https://kimi.moonshot.cn) via Wire protocol, invoked with `@kimi` prefix.

| Feature | Description |
|:--------|:------------|
| Wire Protocol (JSON-RPC 2.0 over stdin/stdout) | Lower latency than HTTP/SSE, no standalone HTTP server needed |
| Persistent Subprocess Pool | Each session corresponds to a long-running kimi process, full context retention |
| Thinking Chain Streaming | `--thinking` mode reasoning displayed in real-time in collapsible panel |
| `--yolo` Fully Automatic Mode | Tool calls without manual confirmation, controlled by config switch |
| Triple Parallel Enablement | `@opencode` / `@claude` / `@kimi` free switching |

---

### 🔜 v0.5.0 — Codex CLI Adapter

**Goal**: Integrate [Codex CLI](https://github.com/openai/codex) via subprocess mode, invoked with `@codex` prefix.

| Feature | Description |
|:--------|:------------|
| Subprocess Streaming Output | `codex --stream` mode, line-by-line stdout parsing |
| Independent Session Management | Isolated from other CLI sessions, LRU reuse |
| Quadruple Parallel Enablement | `@opencode` / `@claude` / `@kimi` / `@codex` free switching |
| Image Input Support | Aligned with OpenCode path, unified attachment preprocessing |

---

### 🔜 v1.0.0 — First Stable Release

**Goal**: Production-ready stable release after extensive testing and refinement.

| Focus Area | Description |
|:-----------|:------------|
| Stability & Reliability | Comprehensive error handling, graceful degradation |
| Performance Optimization | Connection pooling, caching, memory optimization |
| Documentation | Complete API docs, deployment guides, troubleshooting |
| Testing | High test coverage, integration tests, E2E validation |

---

## ⚡ Quick Start

### Step 1: Install Prerequisites

Requires **Node.js 20+ LTS** and **opencode CLI**.

<details>
<summary><b>🐧 Linux (Ubuntu/Debian)</b></summary>

```bash
# Node.js LTS
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs

# opencode
npm install -g opencode-ai
```

</details>

<details>
<summary><b>🍎 macOS</b></summary>

```bash
brew install node    # Requires Homebrew: https://brew.sh
npm install -g opencode-ai
```

</details>

<details>
<summary><b>🪟 Windows (CMD)</b></summary>

- [Node.js LTS](https://nodejs.org/) — Check "**Add to PATH**" during installation
- After installation: `npm install -g opencode-ai`

</details>

<details>
<summary><b>✅ Verification</b></summary>

```bash
node --version      # Requires 20+
npm --version
opencode --version
```

</details>

---

### Step 2: Clone Project & Install Dependencies

```bash
git clone <repo_url>
cd feishu-cli-bridge
npm install
```

---

### Step 3: Create Feishu Custom App

1. Go to [Feishu Developer Console](https://open.feishu.cn/app), create an **Enterprise Custom App**

2. **Permission Management** — Enable the following permissions:

   | Permission Scope | Purpose |
   |:-----------------|:--------|
   | `im:message` | Read messages |
   | `im:message:send_as_bot` | Send messages as bot |
   | `im:message.reactions:read` | ✏️ Typing indicator |
   | `im:message.reactions:write_only` | Add/remove reactions |
   | `im:resource` | Download images/files |
   | `contact:user.id:readonly` | Read user ID |
   | `cardkit:card:read` / `cardkit:card:write` | CardKit streaming cards (optional, auto-fallback if disabled) |

   > ⚠️ **Note**: If CardKit permissions are not granted, the system will automatically fall back to IM Patch mode with 1500ms update intervals.

3. **Events & Callbacks** → Connection mode: "**Long Connection**" → Add event `im.message.receive_v1`
   
   > Do not fill in card callback URL, long connection automatically receives card button callbacks.

4. **Version Management & Release** → Create version → Release (internal apps don't require review, effective immediately)

5. Record **App ID** and **App Secret** from "Credentials & Basic Info"

> 📝 Every time you change permissions or event subscriptions in the console, you must create a new version and release it for changes to take effect.

---

### Step 4: Configuration

```bash
cp config.example.yaml config.yaml   # Windows: copy config.example.yaml config.yaml
```

Open `config.yaml` and fill in Feishu credentials (**only these two are required**):

```yaml
feishu:
  app_id: "cli_xxxxxxxxxxxxxxxx"
  app_secret: "xxxxxxxxxxxxxx"
```

Or use environment variables instead of config file:

<details>
<summary><b>🐧 Linux / macOS</b></summary>

```bash
export FEISHU_APP_ID="cli_xxx"
export FEISHU_APP_SECRET="xxx"
```

</details>

<details>
<summary><b>🪟 Windows CMD (temporary)</b></summary>

```cmd
set FEISHU_APP_ID=cli_xxx
set FEISHU_APP_SECRET=xxx
```

</details>

---

### Step 5: Start

#### Development mode (hot reload)

```bash
npm run dev
```

#### Production mode

```bash
npm run build
npm start
```

On successful startup, logs will show `🚀 Feishu CLI Bridge started successfully!`. Upon receiving the first Feishu message, the bridge will automatically start `opencode serve`, no manual operation needed.

---

### Background Running (Optional)

<details>
<summary><b>🐧 Linux — systemd user service (recommended, auto-start on boot)</b></summary>

```bash
# Create service file ~/.config/systemd/user/feishu-cli-bridge.service
# Refer to pm2 or manual npm start configuration

systemctl --user enable --now feishu-cli-bridge   # Start and enable auto-start
systemctl --user status  feishu-cli-bridge        # Check status
systemctl --user restart feishu-cli-bridge        # Restart
journalctl --user -u feishu-cli-bridge -f         # Real-time logs
```

</details>

<details>
<summary><b>📦 Using PM2</b></summary>

```bash
npm install -g pm2
pm2 start npm --name "feishu-bridge" -- start
pm2 save
pm2 startup
```

</details>

<details>
<summary><b>🍎 macOS — nohup (recommended with tmux)</b></summary>

```bash
npm run build
nohup npm start > bridge.log 2>&1 &
```

</details>

<details>
<summary><b>🪟 Windows — Task Scheduler (auto-start on boot)</b></summary>

```cmd
schtasks /create /tn "FeiShuBridge" /tr "npm start" /sc onlogon /ru %USERNAME% /sd C:\path\to\feishu-cli-bridge /f
schtasks /end    /tn "FeiShuBridge"   & REM Stop
schtasks /delete /tn "FeiShuBridge" /f  & REM Uninstall
```

</details>

---

## 📖 Usage

Open a **private chat** with the bot in Feishu, send messages directly:

```
Help me write a Python script to process CSV files
```

### Specify CLI Tool

Use `@` prefix to specify tool (defaults to OpenCode):

```
@codex Generate a React component
```

---

### 🎮 TUI Commands

#### Session & Model

| Command | Description |
|:--------|:------------|
| `/new` | Create new session |
| `/session` | List recent sessions as an interactive card with switch/rename/delete buttons |
| `/model` | List available models (card), click button to switch; model list maintained in `config.yaml` |
| `/mode` | List agent modes, click card button to switch (Build / Plan / oh-my-openagent) |
| `/mode <agent>` | Directly switch to specified agent mode |
| `/reset` or `/clear` | Clear current session context |
| `/stop` | Force stop current AI output |
| `/help` | Display help |

#### Project Management

| Command | Description |
|:--------|:------------|
| `/pa <path> [name]` | Add existing directory as project |
| `/pc <path> [name]` | Create new directory and add as project |
| `/pl` | List all projects (interactive card with pagination and switch button) |
| `/ps <identifier>` | Switch to specified project |
| `/prm <identifier>` | Remove project from list (does not delete directory) |
| `/pi [identifier]` | View project info |

After switching projects, all AI tool calls (bash/read_file etc.) execute in that directory. `/pl` returns an interactive card, click buttons to switch directly without manual command input.

**Example:**

```
/pa ~/code/my-app myapp My Application   # Add and name
/pl                                      # View project list (card with switch button)
/ps myapp                                # Command line switch
/pi                                      # View current project info
```

---

## ⚙️ Configuration

Complete `config.yaml` example:

```yaml
# ═══════════════════════════════════════════════════════════════
# Feishu Configuration
# ═══════════════════════════════════════════════════════════════
feishu:
  app_id: "your_app_id"
  app_secret: "your_app_secret"

# ═══════════════════════════════════════════════════════════════
# Session Configuration
# ═══════════════════════════════════════════════════════════════
session:
  max_sessions: 15          # Max sessions to retain (LRU, local memory cache)
  max_history: 20           # Max history rounds per session

# ═══════════════════════════════════════════════════════════════
# CLI Tool Configuration
# ═══════════════════════════════════════════════════════════════
cli:
  opencode:
    enabled: true
    command: "opencode"
    default_model: "kimi-for-coding/k2p5"
    default_agent: "build"
    timeout: 300
    models:                        # Model list for /model command
      - id: "kimi-for-coding/k2p5"
        name: "Kimi K2.5"
      - id: "opencode/mimo-v2-pro-free"
        name: "MiMo V2 Pro Free"

# ═══════════════════════════════════════════════════════════════
# Project Management
# ═══════════════════════════════════════════════════════════════
project:
  storage_path: ""    # Leave empty for default ~/.config/feishu-cli-bridge/projects.json
  max_projects: 50

# ═══════════════════════════════════════════════════════════════
# Security Configuration
# ═══════════════════════════════════════════════════════════════
security:
  allowed_project_root: ""    # Allowed project root directory (empty = user home)
  max_attachment_size: 52428800   # Max attachment size (50MB)
  max_prompt_length: 100000       # Max prompt length

# ═══════════════════════════════════════════════════════════════
# Debug Configuration
# ═══════════════════════════════════════════════════════════════
debug:
  log_level: "info"       # debug | info | warn | error
  save_logs: true         # Whether to save logs to file
  log_dir: ""            # Log directory (empty = default)
```

---

## 🏗️ Project Structure

```
feishu-cli-bridge/
├── src/
│   ├── core/                  # 🔧 Core infrastructure
│   │   ├── config.ts          # Configuration (YAML + env)
│   │   ├── logger.ts          # Pino logging
│   │   ├── retry.ts           # Exponential backoff retry
│   │   └── types/             # Shared type definitions
│   │       ├── config.ts
│   │       ├── stream.ts
│   │       └── index.ts
│   │
│   ├── adapters/              # 🔌 CLI Adapter layer
│   │   ├── interface/         # Abstract interface
│   │   │   ├── base-adapter.ts
│   │   │   └── types.ts
│   │   ├── factory.ts         # Adapter factory
│   │   ├── index.ts           # Adapter registration
│   │   └── opencode/          # OpenCode adapter
│   │       ├── adapter.ts
│   │       ├── http-client.ts
│   │       ├── sse-parser.ts
│   │       ├── server-manager.ts
│   │       ├── session-manager.ts
│   │       └── types.ts
│   │
│   ├── platform/              # 📱 Feishu platform layer
│   │   ├── feishu-client.ts   # WebSocket client
│   │   ├── feishu-api.ts      # HTTP API wrapper
│   │   ├── message-processor/ # Message processing
│   │   │   ├── index.ts
│   │   │   ├── router.ts
│   │   │   ├── ai-processor.ts
│   │   │   ├── command-processor.ts
│   │   │   └── attachment-processor.ts
│   │   ├── streaming/         # Streaming system
│   │   │   ├── controller.ts
│   │   │   ├── flush-controller.ts
│   │   │   └── types.ts
│   │   └── cards/             # Card builder
│   │       ├── streaming.ts
│   │       ├── complete.ts
│   │       ├── session-cards.ts
│   │       ├── project-cards.ts
│   │       ├── error.ts
│   │       └── utils.ts
│   │
│   ├── card-builder/          # 🎨 TUI card builder
│   │   ├── base.ts
│   │   ├── interactive-cards.ts
│   │   ├── project-cards.ts
│   │   ├── session-cards.ts
│   │   ├── constants.ts
│   │   └── utils.ts
│   │
│   ├── tui-commands/          # ⌨️ TUI commands
│   │   ├── index.ts
│   │   ├── base.ts
│   │   ├── opencode.ts
│   │   └── project.ts
│   │
│   ├── project/               # 📁 Project management
│   │   ├── manager.ts
│   │   ├── types.ts
│   │   └── index.ts
│   │
│   ├── session/               # 💾 Session management
│   │   ├── manager.ts
│   │   ├── types.ts
│   │   └── index.ts
│   │
│   └── main.ts                # 🚀 Entry point
│
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── README.md                  # This file (English)
└── doc/                       # Documentation directory
    ├── CHANGELOG.md           # Version changelog
    └── README_CN.md           # Chinese version
```

---

## 🔧 Development Commands

```bash
# 📦 Install dependencies
npm install

# 🔥 Development mode (hot reload)
npm run dev

# 🔄 Development mode (IM Patch fallback)
npm run dev:legacy

# ✅ Type checking
npm run typecheck

# 🔍 Linting
npm run lint

# 🏗️ Build
npm run build

# 🚀 Production run
npm start

# 🧪 Tests
npm run test
```

---

## 📝 Changelog

### v0.2.0 (2026-04-02) — TypeScript Rewrite

- 🔧 **Full Migration** — Migrated from Python to TypeScript/Node.js
- 🏗️ **Architecture Upgrade** — Layered architecture: Core → Platform → Adapter
- 🔒 **Type Safety** — Strict TypeScript type definitions
- ⚡ **Performance Optimization** — HTTP connection pooling, smart throttling
- 🛡️ **Security Hardening** — Path traversal protection, input validation
- 🎯 **Feature Complete** — 100% parity with Python version
- 🎴 **Unified TUI Cards** — All TUI commands (`/session`, `/model`, `/pl`, etc.) reply as interactive cards
- 📁 **Project Management Improvements** — Pagination and delete confirmation in `/pl` cards

---

## 🌐 Environment Variables

| Variable | Description |
|:---------|:------------|
| `FEISHU_APP_ID` | Feishu App ID |
| `FEISHU_APP_SECRET` | Feishu App Secret |
| `CONFIG_FILE` | Explicit config file path (overrides auto-discovery) |
| `LOG_LEVEL` | Log level (default: info) |
| `LOG_DIR` | Log directory (empty = default `logs/` next to config) |
| `DISABLE_CARDKIT` | Set to `1` to force IM Patch mode |

---

## 📄 License

<p align="center">
  <img src="https://img.shields.io/badge/License-MIT-4ECDC4?style=for-the-badge&logo=opensourceinitiative&logoColor=white" alt="MIT License">
</p>

---

## 🙏 Acknowledgements

<table>
<tr>
<td align="center">
  <a href="https://github.com/larksuite/oapi-sdk-nodejs">
    <img src="https://img.shields.io/badge/Feishu-OpenAPI_SDK-1677FF?style=flat-square" alt="Feishu SDK">
  </a>
</td>
<td>
  <a href="https://github.com/larksuite/oapi-sdk-nodejs">Feishu OpenAPI SDK</a> — Feishu Node.js SDK
</td>
</tr>
<tr>
<td align="center">
  <a href="https://github.com/larksuite/openclaw-lark">
    <img src="https://img.shields.io/badge/OpenClaw-Feishu_Plugin-FF6B6B?style=flat-square" alt="OpenClaw">
  </a>
</td>
<td>
  <a href="https://github.com/larksuite/openclaw-lark">OpenClaw Feishu Plugin</a> — Reference implementation for Feishu card interactions
</td>
</tr>
<tr>
<td align="center">
  <a href="https://opencode.ai">
    <img src="https://img.shields.io/badge/OpenCode-AI_Assistant-339933?style=flat-square" alt="OpenCode">
  </a>
</td>
<td>
  <a href="https://opencode.ai">OpenCode</a> — AI Programming Assistant
</td>
</tr>
</table>

---

<div align="center">

<p>
  <img src="https://img.shields.io/badge/Made%20with%20❤️%20by-ERROR403-FF6B6B?style=flat-square" alt="Author">
</p>

<p><i>⭐ Star this repo if you find it helpful!</i></p>

</div>
