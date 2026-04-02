#!/usr/bin/env bash
set -euo pipefail

# Feishu CLI Bridge Installer for Linux and macOS
# Usage: curl -fsSL https://raw.githubusercontent.com/ERROR403/feishu-cli-bridge/main/scripts/setup.sh | bash

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
GRAY='\033[0;90m'
NC='\033[0m'

REQUIRED_NODE_MAJOR=20
REPO_URL="${REPO_URL:-https://github.com/ERROR403/feishu-cli-bridge.git}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/feishu-cli-bridge}"
TMPFILES=()

cleanup_tmpfiles() {
    local f
    for f in "${TMPFILES[@]:-}"; do
        rm -rf "$f" 2>/dev/null || true
    done
}
trap cleanup_tmpfiles EXIT

mktempfile() {
    local f
    f="$(mktemp)"
    TMPFILES+=("$f")
    echo "$f"
}

ui_ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
ui_info()  { echo -e "${GRAY}[*]${NC} $*"; }
ui_warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
ui_error() { echo -e "${RED}[ERROR]${NC} $*"; }

detect_downloader() {
    if command -v curl &>/dev/null; then
        echo "curl"
        return 0
    fi
    if command -v wget &>/dev/null; then
        echo "wget"
        return 0
    fi
    ui_error "Missing downloader (curl or wget required)"
    exit 1
}

download_file() {
    local url="$1"
    local output="$2"
    local downloader
    downloader="$(detect_downloader)"
    if [[ "$downloader" == "curl" ]]; then
        curl -fsSL --proto '=https' --tlsv1.2 --retry 3 --retry-delay 1 -o "$output" "$url"
    else
        wget -q --https-only --secure-protocol=TLSv1_2 --tries=3 --timeout=20 -O "$output" "$url"
    fi
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
    ui_info "Node.js not found"
    return 1
}

refresh_shell_command_cache() {
    hash -r 2>/dev/null || true
}

prepend_path_dir() {
    local dir="${1%/}"
    [[ -n "$dir" && -d "$dir" ]] || return 1
    local current=":${PATH:-}:"
    current="${current//:${dir}:/:}"
    current="${current#:}"
    current="${current%:}"
    if [[ -n "$current" ]]; then
        export PATH="${dir}:${current}"
    else
        export PATH="${dir}"
    fi
    refresh_shell_command_cache
}

ensure_supported_node_on_path() {
    if check_node; then
        return 0
    fi

    local -a candidates=()
    local candidate=""
    while IFS= read -r candidate; do
        [[ -n "$candidate" ]] && candidates+=("$candidate")
    done < <(type -aP node 2>/dev/null || true)
    candidates+=(
        "/usr/bin/node"
        "/usr/local/bin/node"
        "/opt/homebrew/bin/node"
        "$HOME/.nvm/versions/node/v22.14.0/bin/node"
        "$HOME/.nvm/versions/node/v20.19.0/bin/node"
    )

    local seen=":"
    for candidate in "${candidates[@]}"; do
        [[ -n "$candidate" && -x "$candidate" ]] || continue
        case "$seen" in *":$candidate:"*) continue ;; esac
        seen="${seen}${candidate}:"

        local major
        major="$($candidate -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)"
        if [[ "$major" =~ ^[0-9]+$ && "$major" -ge $REQUIRED_NODE_MAJOR ]]; then
            prepend_path_dir "$(dirname "$candidate")"
            ui_ok "Using Node.js runtime at ${candidate}"
            return 0
        fi
    done
    return 1
}

resolve_brew_bin() {
    local brew_bin=""
    brew_bin="$(command -v brew 2>/dev/null || true)"
    [[ -n "$brew_bin" ]] && { echo "$brew_bin"; return 0; }
    [[ -x "/opt/homebrew/bin/brew" ]] && { echo "/opt/homebrew/bin/brew"; return 0; }
    [[ -x "/usr/local/bin/brew" ]] && { echo "/usr/local/bin/brew"; return 0; }
    return 1
}

install_node() {
    ui_info "Installing Node.js v${REQUIRED_NODE_MAJOR}+..."

    local os
    os="$(uname -s)"

    if [[ "$os" == "Darwin" ]]; then
        local brew_bin
        brew_bin="$(resolve_brew_bin || true)"
        if [[ -n "$brew_bin" ]]; then
            ui_info "Using Homebrew..."
            if ! $brew_bin list node@22 &>/dev/null; then
                $brew_bin install node@22 2>/dev/null || $brew_bin install node 2>/dev/null || true
            fi
            local brew_prefix
            brew_prefix="$($brew_bin --prefix node@22 2>/dev/null || true)"
            [[ -n "$brew_prefix" && -d "$brew_prefix/bin" ]] && prepend_path_dir "$brew_prefix/bin"
            if ensure_supported_node_on_path; then
                return 0
            fi
        fi
    fi

    if command -v apt-get &>/dev/null; then
        ui_info "Using apt..."
        local tmp_script
        tmp_script="$(mktempfile)"
        download_file "https://deb.nodesource.com/setup_${REQUIRED_NODE_MAJOR}.x" "$tmp_script"
        if command -v sudo &>/dev/null; then
            bash "$tmp_script"
            sudo apt-get install -y nodejs
        else
            bash "$tmp_script"
            apt-get install -y nodejs
        fi
        refresh_shell_command_cache
        if ensure_supported_node_on_path; then
            return 0
        fi
    fi

    if command -v dnf &>/dev/null; then
        ui_info "Using dnf..."
        if command -v sudo &>/dev/null; then
            sudo dnf module reset nodejs -y
            sudo dnf module install nodejs:${REQUIRED_NODE_MAJOR}/common -y
        else
            dnf module reset nodejs -y
            dnf module install nodejs:${REQUIRED_NODE_MAJOR}/common -y
        fi
        refresh_shell_command_cache
        if ensure_supported_node_on_path; then
            return 0
        fi
    fi

    if command -v yum &>/dev/null; then
        ui_info "Using yum..."
        local tmp_script
        tmp_script="$(mktempfile)"
        download_file "https://rpm.nodesource.com/setup_${REQUIRED_NODE_MAJOR}.x" "$tmp_script"
        if command -v sudo &>/dev/null; then
            bash "$tmp_script"
            sudo yum install -y nodejs
        else
            bash "$tmp_script"
            yum install -y nodejs
        fi
        refresh_shell_command_cache
        if ensure_supported_node_on_path; then
            return 0
        fi
    fi

    if command -v pacman &>/dev/null; then
        ui_info "Using pacman..."
        if command -v sudo &>/dev/null; then
            sudo pacman -S nodejs npm --noconfirm
        else
            pacman -S nodejs npm --noconfirm
        fi
        refresh_shell_command_cache
        if ensure_supported_node_on_path; then
            return 0
        fi
    fi

    ui_error "Could not install Node.js automatically. Please install Node.js >= ${REQUIRED_NODE_MAJOR} manually."
    exit 1
}

is_root() {
    [[ "$(id -u)" -eq 0 ]]
}

check_git() {
    if command -v git &>/dev/null; then
        ui_ok "Git found"
        return 0
    fi
    ui_info "Git not found, installing..."
    return 1
}

install_git() {
    local os
    os="$(uname -s)"
    if [[ "$os" == "Darwin" ]]; then
        local brew_bin
        brew_bin="$(resolve_brew_bin || true)"
        if [[ -n "$brew_bin" ]]; then
            $brew_bin install git
        else
            ui_error "Homebrew not available; cannot install Git"
            exit 1
        fi
    elif [[ "$os" == "Linux" ]]; then
        if command -v apt-get &>/dev/null; then
            if is_root; then
                apt-get update -qq && apt-get install -y -qq git
            else
                sudo apt-get update -qq && sudo apt-get install -y -qq git
            fi
        elif command -v dnf &>/dev/null; then
            if is_root; then sudo dnf install -y -q git; else sudo dnf install -y -q git; fi
        elif command -v yum &>/dev/null; then
            if is_root; then yum install -y -q git; else sudo yum install -y -q git; fi
        elif command -v pacman &>/dev/null; then
            if is_root; then pacman -S git --noconfirm; else sudo pacman -S git --noconfirm; fi
        else
            ui_error "Could not detect package manager for Git"
            exit 1
        fi
    fi
    refresh_shell_command_cache
    ui_ok "Git installed"
}

# ===== Main flow =====
echo ""
echo -e "${CYAN}  🚀 Feishu CLI Bridge Installer${NC}"
echo ""

# 1. Node.js
if ! ensure_supported_node_on_path; then
    install_node
    if ! ensure_supported_node_on_path; then
        ui_error "Node.js installation may require a terminal restart"
        ui_warn "Please close this terminal, open a new one, and run the installer again."
        exit 1
    fi
fi

# 2. Git
if ! check_git; then
    install_git
    if ! command -v git &>/dev/null; then
        ui_error "Git installation failed"
        exit 1
    fi
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
