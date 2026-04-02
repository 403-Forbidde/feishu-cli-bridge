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

function Find-NodeExe {
    $candidates = @(
        "C:\Program Files\nodejs\node.exe"
        "C:\Program Files (x86)\nodejs\node.exe"
        "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS*\node.exe"
        "$env:LOCALAPPDATA\Microsoft\WinGet\Links\node.exe"
        "$env:LOCALAPPDATA\Programs\nodejs\node.exe"
        "$env:ProgramFiles\nodejs\node.exe"
        "$env:ProgramFiles(x86)\nodejs\node.exe"
    )
    foreach ($pattern in $candidates) {
        $found = Get-Item -Path $pattern -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($found) { return $found.FullName }
    }
    return $null
}

function Inject-NodePath {
    $nodeExe = Find-NodeExe
    if ($nodeExe) {
        $nodeDir = Split-Path -Parent $nodeExe
        if ($env:Path -notlike "*$nodeDir*") {
            $env:Path = "$nodeDir;$env:Path"
            Write-Info "Injected Node.js path: $nodeDir"
        }
        return $true
    }
    return $false
}

function Test-IsAdmin {
    return ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")
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

function Test-NodeInstall {
    Refresh-Path
    if (Test-Node) { return $true }
    if (Inject-NodePath) {
        if (Test-Node) { return $true }
    }
    return $false
}

function Install-NodeZip {
    param([string]$Version = "v22.14.0")
    $zipUrl = "https://nodejs.org/dist/$Version/node-$Version-win-x64.zip"
    $zipPath = "$env:TEMP\node-portable.zip"
    $nodeDir = "$env:LOCALAPPDATA\feishu-cli-bridge-node"

    Write-Info "Downloading portable Node.js $Version..."
    try {
        Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
        if (Test-Path $nodeDir) { Remove-Item -Recurse -Force $nodeDir }
        Expand-Archive -Path $zipPath -DestinationPath "$env:TEMP\node-portable" -Force
        Move-Item -Path "$env:TEMP\node-portable\node-$Version-win-x64" -Destination $nodeDir -Force
        $env:Path = "$nodeDir;$env:Path"
        Write-Ok "Portable Node.js installed to $nodeDir"
        if (Test-Node) { return $true }
    } catch {
        Write-Warn "Portable Node.js installation failed: $_"
    }
    return $false
}

function Install-Node {
    Write-Info "Installing Node.js v${REQUIRED_NODE_MAJOR}+..."

    # 1. MSI download (most reliable with admin rights)
    Write-Info "Trying Node.js MSI installer..."
    $msiUrl = "https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi"
    $msiPath = "$env:TEMP\node-installer.msi"
    try {
        Invoke-WebRequest -Uri $msiUrl -OutFile $msiPath -UseBasicParsing
        $proc = Start-Process msiexec.exe -ArgumentList "/i `"$msiPath`" /qn /norestart" -Wait -PassThru
        if ($proc.ExitCode -ne 0) {
            throw "msiexec exited with code $($proc.ExitCode)"
        }
        if (Test-NodeInstall) { return }
    } catch {
        Write-Warn "MSI installation failed: $_. Trying next method..."
    }

    # 2. winget
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Info "Trying winget..."
        winget install --id OpenJS.NodeJS.LTS --source winget --accept-package-agreements --accept-source-agreements -e
        if (Test-NodeInstall) { return }
        Write-Warn "winget could not install Node.js. Trying next method..."
    }

    # 3. Chocolatey
    if (Get-Command choco -ErrorAction SilentlyContinue) {
        Write-Info "Trying Chocolatey..."
        choco install nodejs-lts -y
        if (Test-NodeInstall) { return }
    }

    # 4. Scoop
    if (Get-Command scoop -ErrorAction SilentlyContinue) {
        Write-Info "Trying Scoop..."
        scoop install nodejs-lts
        if (Test-NodeInstall) { return }
    }

    # 5. Portable ZIP fallback
    if (Install-NodeZip) { return }

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

# 0. Admin check
if (-not (Test-IsAdmin)) {
    Write-Error "This installer requires Administrator privileges."
    Write-Warn "Please right-click PowerShell and select 'Run as administrator', then re-run:"
    Write-Warn "    powershell -c `"irm https://raw.githubusercontent.com/403-Forbidde/feishu-cli-bridge/main/scripts/setup.ps1 | iex`""
    exit 1
}

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
