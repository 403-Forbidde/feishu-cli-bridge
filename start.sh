#!/bin/bash
# 启动 Feishu CLI Bridge

# 检查是否要禁用 CardKit
if [ "$1" == "--legacy" ] || [ "$1" == "-l" ]; then
    echo "使用传统 IM Patch 模式启动..."
    export DISABLE_CARDKIT=1
elif [ "$1" == "--help" ] || [ "$1" == "-h" ]; then
    echo "用法: $0 [选项]"
    echo ""
    echo "选项:"
    echo "  --legacy, -l    使用传统 IM Patch 模式（禁用 CardKit）"
    echo "  --help, -h      显示帮助"
    echo ""
    echo "默认使用 CardKit 流式模式"
    exit 0
else
    echo "使用 CardKit 流式模式启动..."
fi

# 启动应用（切换到脚本所在目录，强制使用本地 config.yaml 避免加载服务配置）
cd "$(dirname "$0")"
export CONFIG_FILE="$(pwd)/config.yaml"

# 自动激活虚拟环境（macOS/Linux 通用，存在 .venv 时生效）
if [ -f ".venv/bin/activate" ]; then
    source ".venv/bin/activate"
fi

python3 -m src.main
