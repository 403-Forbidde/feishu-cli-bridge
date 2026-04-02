@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

set "REQUIRED_NODE_VERSION=20.0.0"
set "INSTALL_DIR=%USERPROFILE%\feishu-cli-bridge"
set "REPO_URL=https://github.com/ERROR403/feishu-cli-bridge.git"

echo 🚀 Feishu CLI Bridge 一键安装脚本
echo.

:: 检查 Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo ⚠️ Node.js 未安装
    echo.
    echo 请前往 https://nodejs.org/ 下载安装 Node.js LTS (>= 20.0.0)
    echo 安装时务必勾选 "Add to PATH"
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%a in ('node --version') do set "NODE_VERSION=%%a"
set "NODE_VERSION=%NODE_VERSION:v=%"
echo ✅ Node.js v%NODE_VERSION% 已安装

:: 检查 git
git --version >nul 2>&1
if errorlevel 1 (
    echo ❌ 请先安装 git: https://git-scm.com/download/win
    pause
    exit /b 1
)

:: 克隆或更新项目
echo.
echo 📥 下载项目...
if exist "%INSTALL_DIR%" (
    echo 目录已存在，更新代码...
    cd /d "%INSTALL_DIR%"
    git pull
) else (
    git clone "%REPO_URL%" "%INSTALL_DIR%"
    cd /d "%INSTALL_DIR%"
)

:: 安装依赖
echo.
echo 📦 安装依赖...
call npm install
if errorlevel 1 (
    echo ❌ 依赖安装失败
    pause
    exit /b 1
)

:: 运行交互式安装向导
echo.
echo 🧙 启动交互式安装向导...
call npm run setup:dev
if errorlevel 1 (
    echo ❌ 安装向导执行失败
    pause
    exit /b 1
)

echo.
echo 🎉 安装完成！
echo 项目目录: %INSTALL_DIR%
echo 启动命令: cd "%INSTALL_DIR%" ^&^& npm start
pause
