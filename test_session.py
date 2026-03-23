#!/usr/bin/env python3
"""会话管理功能测试脚本"""

import asyncio
import sys
from pathlib import Path

# 添加项目根目录到 Python 路径
sys.path.insert(0, str(Path(__file__).parent))

from src.adapters.opencode import OpenCodeAdapter
from src.config import get_config


async def test_session_management():
    """测试会话管理功能"""
    print("=" * 60)
    print("会话管理功能测试")
    print("=" * 60)

    config = get_config()
    opencode_config = config.cli.get("opencode")
    if opencode_config is None:
        opencode_config = type(
            "obj",
            (object,),
            {
                "command": "opencode",
                "default_model": "opencode/mimo-v2",
                "default_agent": "build",
                "timeout": 300,
                "port": 4096,
                "models": [],
            },
        )()

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
    print(f"\n测试工作目录: {working_dir}")

    # 测试 1: 创建新会话
    print("\n--- 测试 1: 创建新会话 (/new) ---")
    try:
        session_info = await adapter.create_new_session(working_dir=working_dir)
        if session_info:
            print(f"✅ 创建成功!")
            print(f"   会话 ID: {session_info['id']}")
            print(f"   标题: {session_info['title']}")
            print(f"   创建时间: {session_info['created_at']}")
        else:
            print("❌ 创建失败")
            return
    except Exception as e:
        print(f"❌ 异常: {e}")
        return

    # 测试 2: 列出会话
    print("\n--- 测试 2: 列出会话 (/session) ---")
    try:
        sessions = await adapter.list_sessions(limit=10)
        print(f"✅ 获取到 {len(sessions)} 个会话:")
        for i, session in enumerate(sessions, 1):
            display_id = f"FSB-{session['id'][-8:].upper()}"
            print(f"   {i}. {display_id} - {session['title']}")
            print(f"      目录: {session.get('directory', 'N/A')}")
    except Exception as e:
        print(f"❌ 异常: {e}")

    # 测试 3: 重命名会话
    print("\n--- 测试 3: 重命名会话 (/session rename) ---")
    try:
        new_title = "测试重命名会话"
        success = await adapter.rename_session(session_info["id"], new_title)
        if success:
            print(f"✅ 重命名成功!")
            print(f"   新标题: {new_title}")
        else:
            print("❌ 重命名失败")
    except Exception as e:
        print(f"❌ 异常: {e}")

    # 测试 4: 再次列出确认重命名
    print("\n--- 测试 4: 验证重命名结果 ---")
    try:
        sessions = await adapter.list_sessions(limit=10)
        for session in sessions:
            if session["id"] == session_info["id"]:
                print(f"✅ 验证成功! 当前标题: {session['title']}")
                break
    except Exception as e:
        print(f"❌ 异常: {e}")

    # 测试 5: 切换会话
    print("\n--- 测试 5: 切换会话 ---")
    try:
        success = await adapter.switch_session(session_info["id"], working_dir)
        if success:
            print(f"✅ 切换成功!")
        else:
            print("❌ 切换失败")
    except Exception as e:
        print(f"❌ 异常: {e}")

    # 测试 6: 删除会话
    print("\n--- 测试 6: 删除会话 (/session delete) ---")
    try:
        success = await adapter.delete_session(session_info["id"])
        if success:
            print(f"✅ 删除成功!")
        else:
            print("❌ 删除失败")
    except Exception as e:
        print(f"❌ 异常: {e}")

    # 测试 7: 验证删除
    print("\n--- 测试 7: 验证删除结果 ---")
    try:
        sessions = await adapter.list_sessions(limit=10)
        found = any(s["id"] == session_info["id"] for s in sessions)
        if not found:
            print("✅ 验证成功! 会话已删除")
        else:
            print("❌ 验证失败! 会话仍存在")
    except Exception as e:
        print(f"❌ 异常: {e}")

    print("\n" + "=" * 60)
    print("测试完成")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(test_session_management())
