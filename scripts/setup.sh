#!/usr/bin/env bash
set -euo pipefail

# Feishu CLI Bridge Installer for Linux and macOS
# Recommended usage:
#   curl -fsSL -o /tmp/setup.sh https://raw.githubusercontent.com/403-Forbidde/feishu-cli-bridge/main/scripts/setup.sh
#   bash /tmp/setup.sh
#
# This script ONLY checks prerequisites and does NOT auto-install Node.js or Git.
# Users must manually install them before running this script.

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
GRAY='\033[0;90m'
NC='\033[0m'

REQUIRED_NODE_MAJOR=20
REPO_URL="${REPO_URL:-https://github.com/403-Forbidde/feishu-cli-bridge.git}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/feishu-cli-bridge}"

ui_ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
ui_info()  { echo -e "${GRAY}[*]${NC} $*"; }
ui_warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
ui_error() { echo -e "${RED}[ERROR]${NC} $*"; }

print_prerequisites() {
    echo ""
    echo -e "${CYAN}📋 Prerequisites Check${NC}"
    echo "This script requires the following to be installed manually:"
    echo ""
    echo "  1. Node.js ${REQUIRED_NODE_MAJOR}+ LTS"
    echo "     Download: https://nodejs.org/"
    echo "     Ubuntu/Debian: curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -"
    echo "     macOS: brew install node"
    echo ""
    echo "  2. Git"
    echo "     Ubuntu/Debian: sudo apt-get install git"
    echo "     macOS: brew install git"
    echo "     Or download from: https://git-scm.com/downloads"
    echo ""
    echo "  3. OpenCode CLI (will be detected by the setup wizard)"
    echo "     Install: npm install -g opencode-ai"
    echo ""
}

node_major_version() {
    if ! command -v node &>/dev/null; then
        return 1
    fi
    local version major
    version="$(node -v 2>/dev/null || true)"
    major="${version#v}"
    major="${major%%.*}"
    if [[ "$major" =~ ^[0-9]+$ ]]; then
        echo "$major"
        return 0
    fi
    return 1
}

check_node() {
    if command -v node &>/dev/null; then
        local major
        major="$(node_major_version || true)"
        if [[ -n "$major" && "$major" -ge $REQUIRED_NODE_MAJOR ]]; then
            ui_ok "Node.js $(node -v) found"
            return 0
        else
            ui_warn "Node.js $(node -v) found, but v${REQUIRED_NODE_MAJOR}+ required"
            return 1
        fi
    fi
    ui_error "Node.js not found"
    return 1
}

check_git() {
    if command -v git &>/dev/null; then
        ui_ok "Git $(git --version | awk '{print $3}') found"
        return 0
    fi
    ui_error "Git not found"
    return 1
}

# ===== TTY check =====
# This script launches an interactive wizard; stdin must be a TTY.
if [ ! -t 0 ]; then
    ui_error "Interactive setup requires a terminal."
    echo ""
    echo -e "${YELLOW}Please download the script first, then run it:${NC}"
    echo ""
    echo "  curl -fsSL -o /tmp/setup.sh https://raw.githubusercontent.com/403-Forbidde/feishu-cli-bridge/main/scripts/setup.sh"
    echo "  bash /tmp/setup.sh"
    echo ""
    exit 1
fi

# ===== Main flow =====
echo ""
echo -e "${CYAN}  🚀 Feishu CLI Bridge Installer${NC}"
echo ""

print_prerequisites

# 1. Check Node.js
if ! check_node; then
    echo ""
    ui_error "Node.js v${REQUIRED_NODE_MAJOR}+ is required but not found."
    echo ""
    echo -e "${YELLOW}Please install Node.js manually:${NC}"
    echo "  • Linux (Ubuntu/Debian): curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt-get install -y nodejs"
    echo "  • macOS: brew install node"
    echo "  • Or download from: https://nodejs.org/"
    echo ""
    echo -e "${GRAY}After installation, restart your terminal and run this script again.${NC}"
    exit 1
fi

# 2. Check Git
if ! check_git; then
    echo ""
    ui_error "Git is required but not found."
    echo ""
    echo -e "${YELLOW}Please install Git manually:${NC}"
    echo "  • Linux (Ubuntu/Debian): sudo apt-get install -y git"
    echo "  • macOS: brew install git"
    echo "  • Or download from: https://git-scm.com/downloads"
    echo ""
    echo -e "${GRAY}After installation, restart your terminal and run this script again.${NC}"
    exit 1
fi

# 3. Clone / update
ui_info "Cloning repository..."
if [[ -d "$INSTALL_DIR" ]]; then
    ui_info "Directory exists, pulling latest..."
    cd "$INSTALL_DIR"
    git pull
else
    git clone "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

# 4. Install deps
ui_info "Installing npm dependencies..."
npm install

# 5. Run wizard
ui_ok "Dependencies installed"
echo ""
ui_ok "Launching interactive setup wizard..."
npm run setup:dev

echo ""
echo -e "${GREEN}🎉 Feishu CLI Bridge installed successfully!${NC}"
echo -e "${GRAY}Project directory:${NC} ${CYAN}$INSTALL_DIR${NC}"
echo -e "${GRAY}Start command:${NC}   ${CYAN}cd $INSTALL_DIR && npm start${NC}"
echo ""
