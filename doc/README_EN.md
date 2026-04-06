<div align="center">

<!-- Banner Image -->
<img src="../doc/img/feishu-cli-bridge-banner.png" width="100%" alt="Feishu CLI Bridge Banner">

<p align="center">
  <b>A Node.js/TypeScript bridge connecting Feishu (Lark) to CLI AI tools</b><br>
  <i>Delivering a streaming "typewriter" chat experience inside Feishu</i><br>
  <i>Supports OpenCode and Claude Code</i>
</p>

<!-- Badges -->
<p>
  <a href="#-changelog"><img src="https://img.shields.io/badge/version-v0.3.0-blue.svg" alt="Version"></a>
  <a href="#-license"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey.svg" alt="Platform">
  <img src="https://img.shields.io/badge/built%20with-TypeScript%205.0+-3178C6.svg" alt="TypeScript">
  <img src="https://img.shields.io/badge/Node.js-20+-339933.svg" alt="Node.js">
</p>

<!-- Language Switch -->
<p>
  <a href="../README.md">简体中文</a> | <a href="#-feishu-cli-bridge">English</a> | <a href="#-changelog">Changelog</a>
</p>

</div>

---

## 📸 Interface Preview

<div align="center">

| Project Management | Session Management | Agent Modes |
|:------------------:|:------------------:|:-----------:|
| ![Project Management](../screenshot/1.png) | ![Session Management](../screenshot/2.png) | ![Agent Modes](../screenshot/3.png) |
| `/pl` Interactive Project Card | `/session` Session List | `/mode` Mode Switching |

| Model Switching | Help Card | AI Streaming Output |
|:---------------:|:---------:|:-------------------:|
| ![Model Switching](../screenshot/4.png) | ![Help Card](../screenshot/5.png) | ![AI Output](../screenshot/6.png) |
| `/model` One-click Switch | `/help` Command List | Typewriter Effect + Token Stats |

</div>

---

## 📑 Table of Contents

- [📸 Interface Preview](#-interface-preview)
- [🎯 Use Cases](#-use-cases)
- [✨ Features](#-features)
- [⚡ Quick Start](#-quick-start)
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

### 🎭 **Claude Code Integration**
`child_process.spawn` + JSON Lines streaming, supports `@filepath` file references, dynamic model detection (compatible with third-party providers like Kimi)

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

## ⚡ Quick Start

### Prerequisites (All Platforms)

Before starting, ensure you have the following installed:

| Dependency | Minimum Version | Purpose | Installation |
|:-----------|:----------------|:--------|:-------------|
| **Node.js** | 20+ LTS | Runtime | [Download](https://nodejs.org/) or package manager |
| **Git** | Any | Clone repository | [Download](https://git-scm.com/) or package manager |
| **OpenCode CLI** (optional) | 0.5.0+ | AI coding assistant | `npm install -g opencode-ai` |
| **Claude Code** (optional) | Latest | AI coding assistant | `npm install -g @anthropic-ai/claude-code` |

> 💡 **Important**: This project is a **bridge tool** connecting Feishu to local CLI tools. It **does NOT automatically install** OpenCode/Claude or other CLI tools. The wizard only detects and guides. You need to **install at least one** CLI tool to use this bridge.

<details>
<summary><b>🐧 Linux — Install Prerequisites</b></summary>

```bash
# 1. Install Node.js LTS
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. Verify Node.js version
node --version  # Should show v20.x.x or higher

# 3. Install CLI tools (manual installation, choose at least one)
npm install -g opencode-ai          # OpenCode
npm install -g @anthropic-ai/claude-code  # Claude Code (optional)

# 4. Verify installation
opencode --version  # If OpenCode is installed
claude --version    # If Claude Code is installed
```

**Troubleshooting**:
- If `npm` shows permission errors, try: `sudo npm install -g opencode-ai`
- Or change npm global directory: [npm docs](https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally)

</details>

<details>
<summary><b>🍎 macOS — Install Prerequisites</b></summary>

```bash
# 1. Install Homebrew (if not installed)
# Visit https://brew.sh for installation command

# 2. Install Node.js
brew install node

# 3. Verify version
node --version  # Should show v20.x.x or higher

# 4. Install CLI tools (manual installation, choose at least one)
npm install -g opencode-ai          # OpenCode
npm install -g @anthropic-ai/claude-code  # Claude Code (optional)

# 5. Verify
opencode --version  # If OpenCode is installed
claude --version    # If Claude Code is installed
```

</details>

<details>
<summary><b>🪟 Windows — Install Prerequisites</b></summary>

**Install in the following order:**

1. **[Node.js LTS (v20+)](https://nodejs.org/en/download)**
   - Download Windows Installer (.msi)
   - **Important**: Check "**Add to PATH**" during installation

2. **[Git for Windows](https://git-scm.com/download/win)**
   - Download 64-bit Git for Windows Setup
   - Use default options for installation

3. **CLI Tools (install at least one)**
   ```powershell
   # OpenCode
   npm install -g opencode-ai
   
   # Claude Code (optional)
   npm install -g @anthropic-ai/claude-code
   ```

**Important Step**:
> After installation, **restart PowerShell** (or CMD) for environment variables to take effect.

Verify installation:
```powershell
node --version      # Should show v20.x.x
opencode --version  # If OpenCode is installed
claude --version    # If Claude Code is installed
```

</details>

---

### Installation Methods

Choose the method that suits you:

| Method | Use Case | Complexity |
|:-------|:---------|:-----------|
| **One-line Install Script** | Quick start, automated configuration | ⭐ Easy |
| **Manual Clone & Install** | Developers, custom configuration | ⭐⭐ Medium |

#### Option 1: One-line Install Script (Recommended 🌟)

Copy and paste **one line** into your terminal. The script **checks** prerequisites (does NOT auto-install), clones the repo, installs dependencies, and launches the interactive wizard.

> ⚠️ **Prerequisites Required**: Node.js 20+ and Git must be installed **before** running this script.

<details>
<summary><b>🐧 Linux / 🍎 macOS</b></summary>

```bash
curl -fsSL -o /tmp/setup.sh https://raw.githubusercontent.com/403-Forbidde/feishu-cli-bridge/main/scripts/setup.sh
bash /tmp/setup.sh
```

The script will:
1. **Check** Node.js version (required: 20+)
2. **Check** if Git is installed
3. Clone repository to `~/feishu-cli-bridge`
4. Install npm dependencies
5. Launch interactive setup wizard

> If prerequisites are missing, the script will display installation instructions and exit.

</details>

<details>
<summary><b>🪟 Windows (PowerShell)</b></summary>

```powershell
powershell -ExecutionPolicy Bypass -Command "iex (irm https://raw.githubusercontent.com/403-Forbidde/feishu-cli-bridge/main/scripts/setup.ps1)"
```

> `-ExecutionPolicy Bypass` applies only to the current process, allowing remote script execution.

The script will:
1. **Check** if Node.js and Git are installed (required before running)
2. Clone the repository
3. Install npm dependencies
4. Launch interactive setup wizard

> If prerequisites are missing, the script will display installation instructions and exit.

</details>

**Wizard Flow**:

```
┌─────────────────────────────────────────────────────────┐
│  1. CLI Tool Detection                                   │
│     └─ Not installed → Show install command → Wait for   │
│        manual install → Re-detect                        │
│     └─ Installed → Check login status → Prompt login     │
│        (if not logged in)                                │
│                                                          │
│  2. Model Selection (REQUIRED)                           │
│     ├─ Read user OpenCode config → Has default model?    │
│     │   ├─ Yes → Ask use existing or select new          │
│     │   └─ No  → Fetch available models from OpenCode    │
│     └─ User must select a model (no hardcoded default)   │
│                                                          │
│  3. Feishu Configuration                                 │
│     └─ Enter App ID / App Secret → Validate format       │
│                                                          │
│  4. Service Configuration (Optional)                     │
│     └─ Generate systemd/launchd/Windows service config   │
└─────────────────────────────────────────────────────────┘
```

> 💡 **Note**: The wizard **does NOT automatically install CLI tools**, only detects and guides. If not detected, it displays installation commands for manual execution.
>
> 💡 **Model Selection**: The wizard will first check your existing OpenCode default model configuration. If not set, you **must** select from the current available models. The free model list is fetched dynamically and may change over time - no hardcoded default is used.

> 💡 **Tip**: The generated config is saved to `~/.config/feishu-cli-bridge/config.yaml` (Linux/macOS) or `%APPDATA%\feishu-cli-bridge\config.yaml` (Windows).

---

#### Option 2: Manual Clone & Install

For developers or those who need custom configuration. Follow the steps below.

##### Step 1: Clone & Install Dependencies

```bash
# Clone repository from GitHub
git clone https://github.com/403-Forbidde/feishu-cli-bridge.git
cd feishu-cli-bridge

# Install dependencies
npm install
```

> 💡 **About the setup wizard**: If you want to run the same interactive setup wizard as the one-line installer, execute `npm run setup:dev`. Alternatively, you can manually edit `config.yaml`.

> 💡 **About CLI tools**: This project is a bridge tool and does **NOT** automatically install OpenCode or other CLI tools. The wizard only detects and guides based on your existing local environment.

---

##### Step 2: Create Feishu Enterprise Custom App & Enable Bot

1. **Create Enterprise Custom App**
   - Go to [Feishu Developer Console](https://open.feishu.cn/app), create an **Enterprise Custom App**
   - Fill in basic information (app name, description, icon)

2. **Add App Capability → Bot**
   - In the app details page, select **Add App Capability** from the left menu
   - Click the **Bot** card and follow the prompts to enable the bot capability
   - Once enabled, you will see **App ID** and **App Secret** on the **Credentials & Basic Info** page

3. **Configure Permissions**

   **Option A: Import from JSON (Recommended)**

   The repository includes a pre-configured permission file. Download [`doc/feishu_permissions.json`](./feishu_permissions.json) from this repo, then in the Developer Console:

   ```
   Permission Management → Import from JSON → Select feishu_permissions.json
   ```

   **Option B: Manual Configuration**

   If you prefer manual setup, enable these required permissions:

   | Permission Scope | Purpose | Required |
   |:-----------------|:--------|:--------:|
   | `im:message` | Read messages | ✅ |
   | `im:message:send_as_bot` | Send messages as bot | ✅ |
   | `im:message.reactions:read` | ✏️ Typing indicator | ✅ |
   | `im:message.reactions:write_only` | Add/remove reactions | ✅ |
   | `im:resource` | Download images/files | ✅ |
   | `contact:user.id:readonly` | Read user ID | ✅ |
   | `cardkit:card:read` / `cardkit:card:write` | CardKit streaming cards | ❌ |

   > ⚠️ **Note**: If CardKit permissions are not granted, the system will automatically fall back to IM Patch mode with 1500ms update intervals. Core functionality still works.

4. **Configure Event Subscription**

   **Events & Callbacks** → Connection mode: "**Long Connection**" → Add event `im.message.receive_v1`

   > Do not fill in card callback URL, long connection automatically receives card button callbacks.

5. **Publish Application**

   **Version Management & Release** → Create version → Release

   > Internal apps don't require review and are effective immediately.

6. **Record Credentials**

   From "Credentials & Basic Info", record:
   - **App ID** (format: `cli_xxxxxxxxxxxxxxxx`)
   - **App Secret**

> 📝 **Important**: Every time you change permissions or event subscriptions in the console, you must create a new version and release it for changes to take effect.

---

##### Step 3: Manual Configuration (Manual install only)

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

##### Step 4: Start (Choose based on install method)

If you used the **one-line install script**, you can start the service directly after the wizard finishes.  
If you used **manual clone & install**, start with one of the following:

###### Development mode (hot reload)

```bash
npm run dev
```

###### Production mode

```bash
npm run build
npm start
```

On successful startup, logs will show `🚀 Feishu CLI Bridge started successfully!`. Upon receiving the first Feishu message, the bridge will automatically start `opencode serve`, no manual operation needed.

---

### Background Running (Optional)

<details>
<summary><b>🐧 Linux — systemd user service (recommended, auto-start on boot)</b></summary>

Create `~/.config/systemd/user/feishu-cli-bridge.service`:

```ini
[Unit]
Description=Feishu CLI Bridge
After=network.target

[Service]
Type=simple
WorkingDirectory=%h/feishu-cli-bridge
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

Then run:

```bash
systemctl --user daemon-reload
systemctl --user enable --now feishu-cli-bridge
systemctl --user status feishu-cli-bridge
journalctl --user -u feishu-cli-bridge -f
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
schtasks /create /tn "FeiShuBridge" /tr "cmd /c cd /d C:\path\to\feishu-cli-bridge && npm start" /sc onlogon /ru %USERNAME% /f
schtasks /end    /tn "FeiShuBridge"   & REM Stop
schtasks /delete /tn "FeiShuBridge" /f  & REM Uninstall
```

> Run `chcp 65001` before `npm start` in CMD/PowerShell to prevent Chinese garbled text.

</details>

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
│   │   ├── opencode/          # OpenCode adapter
│   │   │   ├── adapter.ts
│   │   │   ├── http-client.ts
│   │   │   ├── sse-parser.ts
│   │   │   ├── server-manager.ts
│   │   │   ├── session-manager.ts
│   │   │   └── types.ts
│   │   └── claude/            # Claude Code adapter
│   │       ├── adapter.ts
│   │       ├── process-manager.ts
│   │       ├── stream-parser.ts
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
├── README.md                  # Chinese documentation
└── doc/                       # Documentation directory
    ├── CHANGELOG.md           # Version changelog
    ├── README_EN.md           # English documentation (this file)
    ├── ROADMAP.md             # Project roadmap
    └── feishu_permissions.json # Feishu bot permissions (import in Developer Console)
```

---

## 🔧 Development Commands

```bash
# 📦 Install dependencies
npm install

# 🔥 Development mode (hot reload)
npm run dev

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

### v0.3.0 (2026-04-03) — Claude Code Support (Current Version)

- 🤖 **Claude Code Support** — Brand new Claude Code CLI adapter, production-ready
- 🔄 **Dual CLI Support** — Support both OpenCode and Claude Code with seamless switching
- 📝 **File References** — Support `@filepath` syntax for referencing images/files
- 🎯 **Dynamic Model Detection** — Automatically detect actual model used by Claude Code (supports third-party providers like Kimi)
- 🧪 **Comprehensive Testing** — 61 unit tests covering Claude Code adapter

### v0.2.1 (2026-04-02) — TypeScript Rewrite

- 🔧 **Full Migration** — Migrated from Python to TypeScript/Node.js
- 🏗️ **Architecture Upgrade** — Layered architecture: Core → Platform → Adapter
- 🔒 **Type Safety** — Strict TypeScript type definitions
- ⚡ **Performance Optimization** — HTTP connection pooling, smart throttling
- 🛡️ **Security Hardening** — Path traversal protection, input validation
- 🎯 **Feature Complete** — 100% parity with Python version
- 🎴 **Unified TUI Cards** — All TUI commands (`/session`, `/model`, `/pl`, etc.) reply as interactive cards
- 📁 **Project Management Improvements** — Pagination and delete confirmation in `/pl` cards
- 🧙 **Interactive Setup Wizard** — One-command setup for environment, credentials, and system services

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
