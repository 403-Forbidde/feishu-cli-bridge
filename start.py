#!/usr/bin/env python3
"""启动脚本"""
import sys
import os

# 添加 src 到路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from src.main import run

if __name__ == "__main__":
    run()
