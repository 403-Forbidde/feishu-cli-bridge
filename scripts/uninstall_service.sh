#!/bin/bash
# 卸载 cli-feishu-bridge systemd 用户服务

SERVICE_NAME="cli-feishu-bridge"
SYSTEMD_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
SERVICE_FILE="$SYSTEMD_DIR/${SERVICE_NAME}.service"

echo "=== cli-feishu-bridge 服务卸载 ==="

# ---- 检查是否在 Linux 上运行 ----
if [ "$(uname -s)" != "Linux" ]; then
    echo "❌ 服务模式当前仅支持 Linux (systemd)"
    exit 1
fi

# ---- 停止服务 ----
if systemctl --user is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
    systemctl --user stop "$SERVICE_NAME"
    echo "✅ 服务已停止"
else
    echo "   服务未在运行，跳过停止"
fi

# ---- 禁用服务 ----
if systemctl --user is-enabled --quiet "$SERVICE_NAME" 2>/dev/null; then
    systemctl --user disable "$SERVICE_NAME"
    echo "✅ 服务已禁用（不再开机自启）"
else
    echo "   服务未启用自启，跳过禁用"
fi

# ---- 删除 service 文件 ----
if [ -f "$SERVICE_FILE" ]; then
    rm "$SERVICE_FILE"
    echo "✅ 已删除: $SERVICE_FILE"
else
    echo "   服务文件不存在，跳过"
fi

# ---- 重载 systemd ----
systemctl --user daemon-reload 2>/dev/null && echo "✅ systemd 已重载" || true

echo ""
echo "=== 卸载完成 ==="
echo ""
echo "配置文件和会话数据未删除，如需清理请手动执行:"
echo "  rm -rf ${XDG_CONFIG_HOME:-$HOME/.config}/cli-feishu-bridge"
