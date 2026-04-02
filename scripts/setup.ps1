#Requires -Version 5.1
# Feishu CLI Bridge Windows 一键安装脚本
# 自动检测/安装 Node.js，拉取代码，运行交互式安装向导

$ErrorActionPreference = "Stop"

$REQUIRED_NODE_VERSION = [Version]"20.0.0"
$REPO_URL = if ($env:REPO_URL) { $env:REPO_URL } else { "https://github.com/ERROR403/feishu-cli-bridge.git" }
$INSTALL_DIR = if ($env:INSTALL_DIR) { $env:INSTALL_DIR } else { "$env:USERPROFILE\feishu-cli-bridge" }

function Write-Color($Text, $Color = "White") {
    Write-Host $Text -ForegroundColor $Color
}

function Test-NodeInstalled {
    try {
        $nodeVersionStr = (node --version 2>$null)
        if ($LASTEXITCODE -eq 0 -and $nodeVersionStr) {
            $clean = $nodeVersionStr.Trim().TrimStart("v")
            $current = [Version]$clean
            return @{ Installed = $true; Version = $current; VersionString = $clean }
        }
    } catch { }
    return @{ Installed = $false; Version = $null; VersionString = $null }
}

function Install-NodeJS {
    Write-Color "⚠️ Node.js 未安装或版本过低，尝试自动安装..." "Yellow"

    # 方案 1: winget
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        Write-Color "📦 使用 winget 安装 Node.js LTS..." "Cyan"
        try {
            winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
            Refresh-EnvPath
            $recheck = Test-NodeInstalled
            if ($recheck.Installed -and $recheck.Version -ge $REQUIRED_NODE_VERSION) {
                Write-Color "✅ Node.js v$($recheck.VersionString) 安装成功" "Green"
                return
            }
        } catch {
            Write-Color "winget 安装失败，尝试其他方式..." "Yellow"
        }
    }

    # 方案 2: 下载 MSI 静默安装
    Write-Color "📥 正在下载 Node.js LTS 安装包..." "Cyan"
    $msiUrl = "https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi"
    $msiPath = "$env:TEMP\node-installer.msi"
    try {
        Invoke-WebRequest -Uri $msiUrl -OutFile $msiPath -UseBasicParsing
        Write-Color "🔧 正在安装 Node.js（需要管理员权限，若弹出 UAC 请允许）..." "Yellow"
        Start-Process msiexec.exe -ArgumentList "/i `"$msiPath`" /qn /norestart" -Wait -Verb RunAs
        Refresh-EnvPath
        $recheck = Test-NodeInstalled
        if ($recheck.Installed -and $recheck.Version -ge $REQUIRED_NODE_VERSION) {
            Write-Color "✅ Node.js v$($recheck.VersionString) 安装成功" "Green"
            return
        }
    } catch {
        Write-Color "MSI 安装失败。" "Red"
    }

    Write-Color "❌ 自动安装 Node.js 失败。请手动前往 https://nodejs.org/ 下载安装 LTS 版本（>= 20.0.0），安装时勾选 'Add to PATH'，然后重新运行本脚本。" "Red"
    pause
    exit 1
}

function Refresh-EnvPath {
    # 刷新当前会话的 PATH 环境变量
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
}

# ===== 主流程 =====
Write-Color "🚀 Feishu CLI Bridge Windows 一键安装脚本" "Green"
Write-Host ""

# 1. 检查 Node.js
$nodeStatus = Test-NodeInstalled
if ($nodeStatus.Installed) {
    if ($nodeStatus.Version -ge $REQUIRED_NODE_VERSION) {
        Write-Color "✅ Node.js v$($nodeStatus.VersionString) 已安装" "Green"
    } else {
        Write-Color "⚠️ Node.js v$($nodeStatus.VersionString) 版本过低，需要 >= $($REQUIRED_NODE_VERSION)" "Yellow"
        Install-NodeJS
    }
} else {
    Write-Color "⚠️ Node.js 未安装" "Yellow"
    Install-NodeJS
}

# 2. 检查 git
$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $git) {
    Write-Color "❌ 未检测到 git。请先安装 Git for Windows: https://git-scm.com/download/win" "Red"
    pause
    exit 1
}

# 3. 克隆/更新项目
Write-Host ""
Write-Color "📥 下载项目..." "Green"
if (Test-Path $INSTALL_DIR) {
    Write-Color "目录已存在，更新代码..." "Yellow"
    Set-Location $INSTALL_DIR
    git pull
} else {
    git clone $REPO_URL $INSTALL_DIR
    Set-Location $INSTALL_DIR
}

# 4. 安装依赖
Write-Host ""
Write-Color "📦 安装依赖..." "Green"
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Color "❌ 依赖安装失败" "Red"
    pause
    exit 1
}

# 5. 运行交互式安装向导
Write-Host ""
Write-Color "🧙 启动交互式安装向导..." "Green"
npm run setup:dev
if ($LASTEXITCODE -ne 0) {
    Write-Color "❌ 安装向导执行失败" "Red"
    pause
    exit 1
}

Write-Host ""
Write-Color "🎉 安装完成！" "Green"
Write-Color "项目目录: $INSTALL_DIR" "Yellow"
Write-Color "启动命令: cd `"$INSTALL_DIR`" ; npm start" "Yellow"
Write-Host ""
pause
