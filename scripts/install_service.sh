#!/bin/bash
# 安装 cli-feishu-bridge 为 systemd 用户服务
# 代码目录预期: ~/cli-feishu-bridge

set -e

# ---- 路径计算 ----
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/cli-feishu-bridge"
SYSTEMD_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
SERVICE_FILE="$SYSTEMD_DIR/cli-feishu-bridge.service"

echo "=== cli-feishu-bridge 服务安装 ==="
echo "代码目录: $APP_DIR"
echo "配置目录: $CONFIG_DIR"
echo "服务文件: $SERVICE_FILE"
echo ""

# ---- 检查是否在 Linux 上运行 ----
if [ "$(uname -s)" != "Linux" ]; then
    echo "❌ 服务模式当前仅支持 Linux (systemd)"
    exit 1
fi

# ---- 检测 python3 路径 ----
PYTHON3="$(command -v python3 || true)"
if [ -z "$PYTHON3" ]; then
    echo "❌ 未找到 python3，请先安装 Python 3"
    exit 1
fi
echo "✅ Python3: $PYTHON3"

# ---- 创建配置目录 ----
mkdir -p "$CONFIG_DIR"

# ---- 复制配置模板（若不存在）----
if [ ! -f "$CONFIG_DIR/config.yaml" ]; then
    if [ -f "$APP_DIR/config.example.yaml" ]; then
        cp "$APP_DIR/config.example.yaml" "$CONFIG_DIR/config.yaml"
        echo "✅ 已创建配置文件: $CONFIG_DIR/config.yaml"
        echo "   ⚠️  请编辑配置文件，填写飞书凭据后再启动服务"
    else
        echo "⚠️  未找到 config.example.yaml，请手动创建: $CONFIG_DIR/config.yaml"
    fi
else
    echo "✅ 配置文件已存在: $CONFIG_DIR/config.yaml"
fi

# ---- 创建 systemd 用户目录 ----
mkdir -p "$SYSTEMD_DIR"

# ---- 写入 service unit ----
cat > "$SERVICE_FILE" << EOF
[Unit]
Description=Feishu CLI Bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=%h
Environment=PYTHONPATH=$APP_DIR
ExecStart=$PYTHON3 -m src.main
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
EOF

echo "✅ 服务文件已写入: $SERVICE_FILE"

# ---- 重载 systemd ----
if systemctl --user daemon-reload 2>/dev/null; then
    echo "✅ systemd 用户守护进程已重载"
else
    echo "⚠️  无法执行 systemctl --user，请确认 systemd 用户实例正在运行"
    echo "   如需在 SSH 会话中开机自启，运行: loginctl enable-linger $USER"
fi

# ---- 完成提示 ----
echo ""
echo "=== 安装完成 ==="
echo ""
echo "后续步骤："
echo ""
echo "  1. 编辑配置文件，填写飞书 App ID 和 App Secret:"
echo "     \$EDITOR $CONFIG_DIR/config.yaml"
echo ""
echo "  2. 启动服务并设为开机自启:"
echo "     systemctl --user enable --now cli-feishu-bridge"
echo ""
echo "  3. 查看运行状态:"
echo "     systemctl --user status cli-feishu-bridge"
echo ""
echo "  4. 实时查看日志:"
echo "     journalctl --user -u cli-feishu-bridge -f"
echo ""
echo "  其他常用命令:"
echo "     systemctl --user start   cli-feishu-bridge  # 启动"
echo "     systemctl --user stop    cli-feishu-bridge  # 停止"
echo "     systemctl --user restart cli-feishu-bridge  # 重启"
echo "     systemctl --user disable cli-feishu-bridge  # 取消开机自启"
