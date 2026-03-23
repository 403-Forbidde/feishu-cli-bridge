#!/usr/bin/env python3
"""查看当前会话上下文内容"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from src.adapters.opencode import OpenCodeAdapter
from src.config import get_config


async def view_session_context():
    """查看当前会话的上下文内容"""
    print("=" * 70)
    print("查看当前会话上下文")
    print("=" * 70)

    config = get_config()
    opencode_config = config.cli.get("opencode")
    if opencode_config is None:
        print("❌ 未找到 OpenCode 配置")
        return

    adapter = OpenCodeAdapter(
        {
            "command": getattr(opencode_config, "command", "opencode"),
            "default_model": getattr(
                opencode_config, "default_model", "opencode/mimo-v2"
            ),
            "default_agent": getattr(opencode_config, "default_agent", "build"),
            "timeout": getattr(opencode_config, "timeout", 300),
            "port": getattr(opencode_config, "port", 4096),
            "models": getattr(opencode_config, "models", []),
        }
    )

    working_dir = str(Path.cwd())

    # 获取当前会话 ID
    current_session_id = adapter.get_session_id(working_dir)
    if not current_session_id:
        print(f"\n⚠️  当前工作目录没有活跃会话: {working_dir}")
        print("\n请先创建会话或查看所有可用会话:")

    # 列出所有会话
    print(f"\n📋 工作目录: {working_dir}")
    print("\n所有会话列表:")
    print("-" * 70)

    sessions = await adapter.list_sessions(limit=10)
    if not sessions:
        print("暂无会话")
        return

    for i, session in enumerate(sessions, 1):
        sid = session["id"]
        display_id = f"FSB-{sid[-8:].upper()}"
        title = session.get("title", "未命名")
        is_current = " 🟢 当前" if sid == current_session_id else ""
        print(f"{i}. {display_id} - {title}{is_current}")

    # 如果有当前会话，显示其上下文
    if current_session_id:
        print(f"\n{'=' * 70}")
        print(f"📄 当前会话上下文 (FSB-{current_session_id[-8:].upper()})")
        print(f"{'=' * 70}\n")

        messages = await adapter.get_session_messages(current_session_id)
        if not messages:
            print("(会话为空，暂无消息)")
        else:
            for i, msg in enumerate(messages, 1):
                role_icon = "👤" if msg.role == "user" else "🤖"
                role_name = "用户" if msg.role == "user" else "助手"
                print(f"{role_icon} [{i}] {role_name}:")
                print(f"{msg.content}")
                print("-" * 70)
    else:
        print("\n💡 使用 `/new` 创建新会话，或回复会话序号切换")


if __name__ == "__main__":
    asyncio.run(view_session_context())
