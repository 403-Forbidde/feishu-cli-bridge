# Feishu CLI Bridge Installer for Windows
# Usage: powershell -c "irm https://raw.githubusercontent.com/403-Forbidde/feishu-cli-bridge/main/scripts/setup.ps1 | iex"
#        powershell -ExecutionPolicy Bypass -Command "iex (irm https://raw.githubusercontent.com/403-Forbidde/feishu-cli-bridge/main/scripts/setup.ps1)"

param(
    [string]$RepoUrl = "https://github.com/403-Forbidde/feishu-cli-bridge.git",
    [string]$InstallDir = "$env:USERPROFILE\feishu-cli-bridge"
)

$ErrorActionPreference = "Stop"

$REQUIRED_NODE_MAJOR = 20

function Write-Ok($msg)    { Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Info($msg)  { Write-Host "[*] $msg" -ForegroundColor Gray }
function Write-Warn($msg)  { Write-Host "[!] $msg" -ForegroundColor Yellow }
function Write-Error($msg) { Write-Host "[ERROR] $msg" -ForegroundColor Red }

function Refresh-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
}

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

function Install-Node {
    Write-Info "Installing Node.js v${REQUIRED_NODE_MAJOR}+..."

    # 1. winget
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Info "Using winget..."
        winget install OpenJS.NodeJS.LTS --source winget --accept-package-agreements --accept-source-agreements
        Refresh-Path
        if (Test-Node) { return }
        Write-Warn "winget completed, but Node.js is still unavailable in this shell"
        Write-Warn "Restart PowerShell and re-run the installer if Node.js was installed successfully."
        exit 1
    }

    # 2. Chocolatey
    if (Get-Command choco -ErrorAction SilentlyContinue) {
        Write-Info "Using Chocolatey..."
        choco install nodejs-lts -y
        Refresh-Path
        if (Test-Node) { return }
    }

    # 3. Scoop
    if (Get-Command scoop -ErrorAction SilentlyContinue) {
        Write-Info "Using Scoop..."
        scoop install nodejs-lts
        if (Test-Node) { return }
    }

    # 4. MSI download fallback
    Write-Info "Downloading Node.js LTS installer..."
    $msiUrl = "https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi"
    $msiPath = "$env:TEMP\node-installer.msi"
    try {
        Invoke-WebRequest -Uri $msiUrl -OutFile $msiPath -UseBasicParsing
        Write-Warn "Installing Node.js MSI (UAC prompt may appear)..."
        $proc = Start-Process msiexec.exe -ArgumentList "/i `"$msiPath`" /qn /norestart" -Wait -PassThru
        if ($proc.ExitCode -ne 0) {
            throw "msiexec exited with code $($proc.ExitCode)"
        }
        Refresh-Path
        if (Test-Node) { return }
    } catch {
        Write-Error "MSI installation failed: $_"
    }

    Write-Error "Could not install Node.js automatically. Please install Node.js >= ${REQUIRED_NODE_MAJOR} manually from https://nodejs.org/"
    exit 1
}

function Test-Git {
    if (Get-Command git -ErrorAction SilentlyContinue) {
        Write-Ok "Git found"
        return $true
    }
    Write-Info "Git not found"
    return $false
}

# ===== Main flow =====
Write-Host ""
Write-Host "  🚀 Feishu CLI Bridge Installer" -ForegroundColor Cyan
Write-Host ""

# 1. Node.js
if (-not (Test-Node)) {
    Install-Node
    if (-not (Test-Node)) {
        Write-Error "Node.js installation may require a terminal restart"
        Write-Warn "Please close this terminal, open a new PowerShell window, and run the installer again."
        exit 1
    }
}

# 2. Git
if (-not (Test-Git)) {
    Write-Error "Git is required but not installed. Please install Git for Windows: https://git-scm.com/download/win"
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

# 5. Run wizard
Write-Ok "Dependencies installed"
Write-Host ""
Write-Ok "Launching interactive setup wizard..."
npm run setup:dev

Write-Host ""
Write-Host "🎉 Feishu CLI Bridge installed successfully!" -ForegroundColor Green
Write-Host "Project directory: $InstallDir"
Write-Host "Start command:     cd `"$InstallDir`" ; npm start"
Write-Host ""
