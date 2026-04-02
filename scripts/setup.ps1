# Feishu CLI Bridge Installer for Windows
# Usage: powershell -ExecutionPolicy Bypass -Command "iex (irm https://raw.githubusercontent.com/403-Forbidde/feishu-cli-bridge/main/scripts/setup.ps1)"

param(
    [string]$RepoUrl = "https://github.com/403-Forbidde/feishu-cli-bridge.git",
    [string]$InstallDir = "$env:USERPROFILE\feishu-cli-bridge"
)

$ErrorActionPreference = "Stop"

$REQUIRED_NODE_MAJOR = 20

$NODE_DOWNLOAD_URL = "https://nodejs.org/en/download"
$GIT_DOWNLOAD_URL  = "https://git-scm.com/download/win"

function Write-Ok($msg)    { Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Info($msg)  { Write-Host "[*] $msg" -ForegroundColor Gray }
function Write-Warn($msg)  { Write-Host "[!] $msg" -ForegroundColor Yellow }
function Write-Error($msg) { Write-Host "[ERROR] $msg" -ForegroundColor Red }

function Get-NodeMajor {
    try {
        $v = (node -v 2>$null)
        if ($v) {
            return [int]($v -replace 'v(\d+)\..*', '$1')
        }
    } catch { }
    return 0
}

function Test-Node {
    $major = Get-NodeMajor
    if ($major -ge $REQUIRED_NODE_MAJOR) {
        Write-Ok "Node.js $(node -v) found"
        return $true
    }
    if ($major -gt 0) {
        Write-Warn "Node.js v$major found, but v${REQUIRED_NODE_MAJOR}+ required"
    } else {
        Write-Info "Node.js not found"
    }
    return $false
}

function Test-Git {
    try {
        $null = git --version
        Write-Ok "Git found"
        return $true
    } catch {
        Write-Info "Git not found"
        return $false
    }
}

# ===== Main flow =====
Write-Host ""
Write-Host "  Feishu CLI Bridge Installer for Windows" -ForegroundColor Cyan
Write-Host ""

# 1. Check Node.js
if (-not (Test-Node)) {
    Write-Error "Node.js >= v${REQUIRED_NODE_MAJOR} is required."
    Write-Host ""
    Write-Host "Please install Node.js manually from:" -ForegroundColor Yellow
    Write-Host "  $NODE_DOWNLOAD_URL"
    Write-Host ""
    Write-Host "Installation tips:" -ForegroundColor Yellow
    Write-Host "  - Download the LTS version (v${REQUIRED_NODE_MAJOR}+)"
    Write-Host "  - During installation, check 'Add to PATH'"
    Write-Host "  - Restart PowerShell / your terminal after installation"
    Write-Host ""
    exit 1
}

# 2. Check Git
if (-not (Test-Git)) {
    Write-Error "Git is required but not found."
    Write-Host ""
    Write-Host "Please install Git for Windows from:" -ForegroundColor Yellow
    Write-Host "  $GIT_DOWNLOAD_URL"
    Write-Host ""
    Write-Host "Installation tips:" -ForegroundColor Yellow
    Write-Host "  - Download the 64-bit standalone installer"
    Write-Host "  - Keep the default options (this ensures Git is added to PATH)"
    Write-Host "  - Restart PowerShell / your terminal after installation"
    Write-Host ""
    exit 1
}

# 3. Clone / update
Write-Info "Cloning repository..."
if (Test-Path $InstallDir) {
    Write-Info "Directory exists, pulling latest..."
    Set-Location $InstallDir
    git pull
} else {
    git clone $RepoUrl $InstallDir
    Set-Location $InstallDir
}

# 4. Install deps
Write-Info "Installing npm dependencies..."
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Error "npm install failed"
    exit 1
}

# 5. Run wizard
Write-Host ""
Write-Ok "Dependencies installed"
Write-Host ""
Write-Ok "Launching interactive setup wizard..."
npm run setup:dev
if ($LASTEXITCODE -ne 0) {
    Write-Error "Setup wizard failed"
    exit 1
}

Write-Host ""
Write-Host "Feishu CLI Bridge installed successfully!" -ForegroundColor Green
Write-Host "Project directory: $InstallDir"
Write-Host "To start, run:"
Write-Host "    cd \"$InstallDir\""
Write-Host "    npm start"
Write-Host ""
Write-Host "Tip: If 'npm' is not recognized after installing Node.js, restart your PowerShell / terminal." -ForegroundColor Yellow
Write-Host ""
