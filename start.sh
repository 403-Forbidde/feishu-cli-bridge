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

# 启动应用
cd /code/cli-feishu-bridge
python3 -m src.main
