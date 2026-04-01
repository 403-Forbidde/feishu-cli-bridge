# Feishu CLI Bridge

> [English](#feishu-cli-bridge) | [简体中文](doc/README_CN.md)

A Node.js/TypeScript bridge connecting Feishu (Lark) to OpenCode CLI, delivering a streaming "typewriter" chat experience inside Feishu.

**Version**: v0.2.0  
**Developer**: ERROR403  
**Updated**: 2026-04-01

---

## Table of Contents

- [Use Cases](#use-cases)
- [Features](#features)
- [Roadmap](#roadmap)
- [Quick Start](#quick-start)
- [Usage](#usage)
- [Configuration](#configuration)
- [Project Structure](#project-structure)
- [Development Commands](#development-commands)
- [Changelog](#changelog)
- [License](#license)

---

## Use Cases

Personal programming assistant. Send programming instructions to your bot via Feishu private chat from any device, and the bridge forwards commands to local CLI AI tools, streaming results back.

**Supported Platforms**: Windows, Linux, macOS (Apple Silicon / Intel)

Typical scenarios:
- Review code or ask AI for explanations on your phone
- Initiate background refactoring tasks during meetings
- Switch between project directories for AI context-aware work
- Access local OpenCode through Feishu in Windows development environments

---

## Features

- 🤖 **OpenCode Integration** — HTTP/SSE protocol, auto-start and manage `opencode serve`, pre-authorize external directory access (no blocking in headless mode)
- 🎭 **Agent Modes** — Built-in Build / Plan modes; auto-detect oh-my-openagent, switch to 7 professional agents when installed, `/mode` card for quick switching
- 🔀 **Model Switching** — `/model` card displays models from `config.yaml`, click to switch instantly without restart
- 💬 **CardKit Streaming** — True typewriter effect, 100ms throttled updates; auto-fallback to IM Patch (1500ms) when CardKit unavailable
- 💭 **Thinking Process** — Collapsible thinking panel, real-time AI reasoning display, continues waiting for text replies after tool calls
- 📊 **Token Statistics** — Right-aligned footer displaying elapsed time, token usage, context percentage, and model name
- 🖼️ **Image/File Input** — Automatic download and base64 encoding of images/files sent, passed as FilePart for vision model recognition
- 📁 **Project Management** — `/pl` interactive card for managing multiple working directories, click "Switch" button to change, with delete confirmation
- 🔄 **Working Directory Isolation** — Each project has independent OpenCode session (via `directory` parameter), tool calls execute in precise CWD isolation
- ⚡ **Smart Throttling** — Batch processing after long gaps to avoid sparse initial updates
- 🌐 **Cross-Platform** — Windows / Linux / macOS support

---

## Roadmap

### Milestone Overview

| Milestone | Core Deliverables | Status |
|-----------|-------------------|--------|
| **v0.2.0** | TypeScript Rewrite · Architecture Optimization · Performance Improvements | ✅ Completed |
| **v0.3.0** | Kimi CLI Adapter (Wire Protocol) | 🔜 Planned |
| **v1.0.0** | Codex CLI Adapter | 🔜 Planned |

### ✅ v0.2.0 — TypeScript Rewrite Complete

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
- [x] Multi-project management (`/pl` interactive card for directory switching)
- [x] TUI commands (`/new` `/session` `/model` `/mode` `/reset` `/help` `/stop`)
- [x] OpenCode Server session management (fully delegated to OpenCode server, zero local persistence)
- [x] Cross-platform support: Windows / Linux / macOS

### 🔜 v0.3.0 — Kimi CLI Adapter (Wire Protocol)

**Goal**: Integrate [Kimi CLI](https://kimi.moonshot.cn) via Wire protocol, invoked with `@kimi` prefix.

| Feature | Description |
|---------|-------------|
| Wire Protocol (JSON-RPC 2.0 over stdin/stdout) | Lower latency than HTTP/SSE, no standalone HTTP server needed |
| Persistent Subprocess Pool | Each session corresponds to a long-running kimi process, full context retention |
| Thinking Chain Streaming | `--thinking` mode reasoning displayed in real-time in collapsible panel |
| `--yolo` Fully Automatic Mode | Tool calls without manual confirmation, controlled by config switch |
| Parallel with OpenCode | `@kimi` / `@opencode` free switching, no default conflicts |

### 🔜 v1.0.0 — Codex CLI Adapter

**Goal**: Integrate [Codex CLI](https://github.com/openai/codex) via subprocess mode, invoked with `@codex` prefix.

| Feature | Description |
|---------|-------------|
| Subprocess Streaming Output | `codex --stream` mode, line-by-line stdout parsing |
| Independent Session Management | Isolated from OpenCode / Kimi sessions, LRU reuse |
| Triple Parallel Enablement | `@opencode` / `@kimi` / `@codex` free switching |
| Image Input Support | Aligned with OpenCode path, unified attachment preprocessing |

---

## Quick Start

### Step 1: Install Prerequisites

Requires **Node.js 20+ LTS** and **opencode CLI**.

**Linux (Ubuntu/Debian):**

```bash
# Node.js LTS
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs

# opencode
npm install -g opencode-ai
```

**macOS:**

```bash
brew install node    # Requires Homebrew: https://brew.sh
npm install -g opencode-ai
```

**Windows (CMD):**

- [Node.js LTS](https://nodejs.org/) — Check "**Add to PATH**" during installation
- After installation: `npm install -g opencode-ai`

**Verification:**

```bash
node --version      # Requires 20+
npm --version
opencode --version
```

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
   |-----------------|---------|
   | `im:message` | Read messages |
   | `im:message:send_as_bot` | Send messages as bot |
   | `im:message.reactions:read` | ✏️ Typing indicator |
   | `im:message.reactions:write_only` | Add/remove reactions |
   | `im:resource` | Download images/files |
   | `contact:user.id:readonly` | Read user ID |
   | `cardkit:card:read` / `cardkit:card:write` | CardKit streaming cards (optional, auto-fallback if disabled) |

3. **Events & Callbacks** → Connection mode: "**Long Connection**" → Add event `im.message.receive_v1`
   
   > Do not fill in card callback URL, long connection automatically receives card button callbacks.
4. **Version Management & Release** → Create version → Release (internal apps don't require review, effective immediately)
5. Record **App ID** and **App Secret** from "Credentials & Basic Info"

> Every time you change permissions or event subscriptions in the console, you must create a new version and release it for changes to take effect.

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

```bash
# Linux / macOS
export FEISHU_APP_ID="cli_xxx"
export FEISHU_APP_SECRET="xxx"
```

```cmd
REM Windows CMD (temporary)
set FEISHU_APP_ID=cli_xxx
set FEISHU_APP_SECRET=xxx
```

---

### Step 5: Start

**Development mode (hot reload):**

```bash
npm run dev
```

**Development mode (IM Patch fallback):**

```bash
npm run dev:legacy
```

**Production mode:**

```bash
npm run build
npm start
```

On successful startup, logs will show `🚀 Feishu CLI Bridge started successfully!`. Upon receiving the first Feishu message, the bridge will automatically start `opencode serve`, no manual operation needed.

---

### Background Running (Optional)

**Linux — systemd user service (recommended, auto-start on boot):**

```bash
# Create service file ~/.config/systemd/user/cli-feishu-bridge.service
# Refer to pm2 or manual npm start configuration

systemctl --user enable --now cli-feishu-bridge   # Start and enable auto-start
systemctl --user status  cli-feishu-bridge        # Check status
systemctl --user restart cli-feishu-bridge        # Restart
journalctl --user -u cli-feishu-bridge -f         # Real-time logs
```

**Using PM2:**

```bash
npm install -g pm2
pm2 start npm --name "feishu-bridge" -- start
pm2 save
pm2 startup
```

**macOS — nohup (recommended with tmux):**

```bash
npm run build
nohup npm start > bridge.log 2>&1 &
```

**Windows — Task Scheduler (auto-start on boot):**

```cmd
schtasks /create /tn "FeiShuBridge" /tr "npm start" /sc onlogon /ru %USERNAME% /sd C:\path\to\feishu-cli-bridge /f
schtasks /end    /tn "FeiShuBridge"   & REM Stop
schtasks /delete /tn "FeiShuBridge" /f  & REM Uninstall
```

---

## Usage

Open a **private chat** with the bot in Feishu, send messages directly:

```
Help me write a Python script to process CSV files
```

### Specify CLI Tool

Use `@` prefix to specify tool (defaults to OpenCode):

```
@codex Generate a React component
```

### TUI Commands

#### Session & Model

| Command | Description |
|---------|-------------|
| `/new` | Create new session |
| `/session` | List recent 10 sessions, reply with number to switch |
| `/model` | List available models (card), click button to switch; model list maintained in `config.yaml` |
| `/mode` | List agent modes, click card button to switch (Build / Plan / oh-my-openagent) |
| `/mode <agent>` | Directly switch to specified agent mode |
| `/reset` or `/clear` | Clear current session context |
| `/stop` | Force stop current AI output |
| `/help` | Display help |

#### Project Management

| Command | Description |
|---------|-------------|
| `/pa <path> [name]` | Add existing directory as project |
| `/pc <path> [name]` | Create new directory and add as project |
| `/pl` | List all projects (card with switch button) |
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

## Configuration

Complete `config.yaml` example:

```yaml
# Feishu Configuration
feishu:
  app_id: "your_app_id"
  app_secret: "your_app_secret"

# Session Configuration
session:
  max_sessions: 15          # Max sessions to retain (LRU, local memory cache)
  max_history: 20           # Max history rounds per session

# CLI Tool Configuration
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

# Project Management
project:
  storage_path: ""    # Leave empty for default ~/.config/feishu-cli-bridge/projects.json
  max_projects: 50

# Security Configuration
security:
  allowed_project_root: ""    # Allowed project root directory (empty = user home)
  max_attachment_size: 52428800   # Max attachment size (50MB)
  max_prompt_length: 100000       # Max prompt length

# Debug Configuration
debug:
  log_level: "info"       # debug | info | warn | error
  save_logs: true         # Whether to save logs to file
  log_dir: ""            # Log directory (empty = default)
```

---

## Project Structure

```
feishu-cli-bridge/
├── src/
│   ├── core/                  # Core infrastructure
│   │   ├── config.ts          # Configuration (YAML + env)
│   │   ├── logger.ts          # Pino logging
│   │   ├── retry.ts           # Exponential backoff retry
│   │   └── types/             # Shared type definitions
│   │       ├── config.ts
│   │       ├── stream.ts
│   │       └── index.ts
│   │
│   ├── adapters/              # CLI Adapter layer
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
│   ├── platform/              # Feishu platform layer
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
│   ├── card-builder/          # TUI card builder
│   │   ├── base.ts
│   │   ├── interactive-cards.ts
│   │   ├── project-cards.ts
│   │   ├── session-cards.ts
│   │   ├── constants.ts
│   │   └── utils.ts
│   │
│   ├── tui-commands/          # TUI commands
│   │   ├── index.ts
│   │   ├── base.ts
│   │   ├── opencode.ts
│   │   └── project.ts
│   │
│   ├── project/               # Project management
│   │   ├── manager.ts
│   │   ├── types.ts
│   │   └── index.ts
│   │
│   ├── session/               # Session management
│   │   ├── manager.ts
│   │   ├── types.ts
│   │   └── index.ts
│   │
│   └── main.ts                # Entry point
│
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── README.md                  # This file (English)
└── doc/                       # Documentation directory
    └── README_CN.md           # Chinese version
```

---

## Development Commands

```bash
# Install dependencies
npm install

# Development mode (hot reload)
npm run dev

# Development mode (IM Patch fallback)
npm run dev:legacy

# Type checking
npm run typecheck

# Linting
npm run lint

# Build
npm run build

# Production run
npm start

# Tests
npm run test
npm run test:unit
npm run test:integration
```

---

## Changelog

### v0.2.0 (2026-04-01) — TypeScript Rewrite

- 🔧 **Full Migration** — Migrated from Python to TypeScript/Node.js
- 🏗️ **Architecture Upgrade** — Layered architecture: Core → Platform → Adapter
- 🔒 **Type Safety** — Strict TypeScript type definitions
- ⚡ **Performance Optimization** — HTTP connection pooling, smart throttling
- 🛡️ **Security Hardening** — Path traversal protection, input validation
- 🎯 **Feature Complete** — 100% parity with Python version

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `FEISHU_APP_ID` | Feishu App ID |
| `FEISHU_APP_SECRET` | Feishu App Secret |
| `CONFIG_FILE` | Explicit config file path (overrides auto-discovery) |
| `LOG_LEVEL` | Log level (default: info) |
| `LOG_DIR` | Log directory (empty = default `logs/` next to config) |
| `DISABLE_CARDKIT` | Set to `1` to force IM Patch mode |

---

## License

MIT License

## Acknowledgements

- [Feishu OpenAPI SDK](https://github.com/larksuite/oapi-sdk-nodejs) — Feishu Node.js SDK
- [OpenClaw Feishu Plugin](https://github.com/larksuite/openclaw-lark) — Reference implementation for Feishu card interactions
- [OpenCode](https://opencode.ai) — AI Programming Assistant
