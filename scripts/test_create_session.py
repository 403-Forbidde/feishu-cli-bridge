#!/usr/bin/env python3
"""测试创建会话时 directory 参数的传递"""

import asyncio
import json
import os
import sys

sys.path.insert(0, '/code/feishu-cli-bridge')

import httpx

async def test_create_session():
    """测试创建会话时的 directory 参数"""
    base_url = "http://127.0.0.1:4096"

    print("=" * 60)
    print("测试创建会话的 directory 参数传递")
    print("=" * 60)

    async with httpx.AsyncClient() as client:
        # 测试1: 使用 query 参数传递 directory
        print("\n测试1: POST /session?directory=/code/test")
        response = await client.post(
            f"{base_url}/session",
            json={"title": "Test Query Dir"},
            params={"directory": "/code/test"}
        )
        if response.status_code == 200:
            data = response.json()
            print(f"  ✓ 创建成功")
            print(f"  返回的 directory: '{data.get('directory', 'NOT SET')}'")
        else:
            print(f"  ✗ 失败: {response.status_code}")
            print(f"  响应: {response.text}")

        # 测试2: 在 body 中传递 directory
        print("\n测试2: POST /session (body 中包含 directory)")
        response = await client.post(
            f"{base_url}/session",
            json={"title": "Test Body Dir", "directory": "/code/test2"},
        )
        if response.status_code == 200:
            data = response.json()
            print(f"  ✓ 创建成功")
            print(f"  返回的 directory: '{data.get('directory', 'NOT SET')}'")
        else:
            print(f"  ✗ 失败: {response.status_code}")
            print(f"  响应: {response.text}")

        # 测试3: 不带 directory 创建
        print("\n测试3: POST /session (不带 directory)")
        response = await client.post(
            f"{base_url}/session",
            json={"title": "Test No Dir"},
        )
        if response.status_code == 200:
            data = response.json()
            print(f"  ✓ 创建成功")
            print(f"  返回的 directory: '{data.get('directory', 'NOT SET')}'")
        else:
            print(f"  ✗ 失败: {response.status_code}")
            print(f"  响应: {response.text}")

        # 列出所有 /code/test 的会话
        print("\n列出 /code/test 的会话:")
        response = await client.get(f"{base_url}/session")
        if response.status_code == 200:
            data = response.json()
            sessions = data if isinstance(data, list) else data.get("items", [])
            test_sessions = [s for s in sessions if s.get('directory') == '/code/test']
            print(f"  找到 {len(test_sessions)} 个 /code/test 的会话")
            for s in test_sessions:
                print(f"    - {s.get('title')}: {s.get('directory')}")

    print("\n" + "=" * 60)
    print("测试完成")
    print("=" * 60)

if __name__ == "__main__":
    asyncio.run(test_create_session())
