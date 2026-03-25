#!/usr/bin/env python3
"""测试 OpenCode 服务器实际的 API 响应"""

import asyncio
import json
import os
import sys

sys.path.insert(0, '/code/feishu-cli-bridge')

import httpx

async def test_opencode_api():
    """测试 OpenCode 服务器的实际响应"""
    base_url = "http://127.0.0.1:4096"

    print("=" * 60)
    print("OpenCode 服务器 API 测试")
    print("=" * 60)

    async with httpx.AsyncClient() as client:
        # 1. 检查服务器健康状态
        print("\n1. 检查服务器健康状态...")
        try:
            response = await client.get(f"{base_url}/health", timeout=5.0)
            if response.status_code == 200:
                print(f"   ✓ 服务器运行正常")
                print(f"   响应: {response.text}")
            else:
                print(f"   ✗ 服务器返回错误: {response.status_code}")
                return
        except Exception as e:
            print(f"   ✗ 无法连接服务器: {e}")
            print(f"   请先启动 Bridge 或 opencode serve")
            return

        # 2. 获取所有会话
        print("\n2. 获取所有会话 (GET /session)...")
        try:
            response = await client.get(f"{base_url}/session")
            if response.status_code == 200:
                data = response.json()
                sessions = data if isinstance(data, list) else data.get("items", [])
                print(f"   找到 {len(sessions)} 个会话")

                if sessions:
                    print("\n   会话详情:")
                    for i, s in enumerate(sessions, 1):
                        print(f"\n   {i}. ID: {s.get('id', 'N/A')[:20]}...")
                        print(f"      Title: {s.get('title', 'N/A')}")
                        print(f"      Slug: {s.get('slug', 'N/A')}")
                        print(f"      Directory: '{s.get('directory', '')}'")
                        # 打印所有字段，看是否有其他路径相关字段
                        other_path_fields = {k: v for k, v in s.items()
                                            if k not in ['id', 'title', 'slug', 'directory', 'time']
                                            and isinstance(v, str) and ('/' in v or 'path' in k.lower())}
                        if other_path_fields:
                            print(f"      其他路径字段: {other_path_fields}")
            else:
                print(f"   ✗ 获取会话失败: {response.status_code}")
                print(f"   响应: {response.text}")
        except Exception as e:
            print(f"   ✗ 获取会话出错: {e}")

        # 3. 创建测试会话（带 directory 参数）
        print("\n3. 创建测试会话 (POST /session?directory=/code/test)...")
        try:
            body = {"title": "API Test Session"}
            params = {"directory": "/code/test"}
            response = await client.post(f"{base_url}/session", json=body, params=params)
            if response.status_code == 200:
                data = response.json()
                print(f"   ✓ 会话创建成功")
                print(f"   ID: {data.get('id', 'N/A')}")
                print(f"   Title: {data.get('title', 'N/A')}")
                print(f"   Slug: {data.get('slug', 'N/A')}")
                print(f"   Directory (返回): '{data.get('directory', 'NOT SET')}'")
                session_id = data.get('id')

                # 4. 查询刚创建的会话详情
                print(f"\n4. 查询会话详情 (GET /session/{session_id[:8]}...)...")
                detail_response = await client.get(f"{base_url}/session/{session_id}")
                if detail_response.status_code == 200:
                    detail = detail_response.json()
                    print(f"   Directory (详情): '{detail.get('directory', 'NOT SET')}'")
                    # 打印所有字段
                    print(f"   完整响应:")
                    for key, value in detail.items():
                        print(f"      {key}: {value}")
                else:
                    print(f"   ✗ 获取详情失败: {detail_response.status_code}")

                # 5. 再次获取所有会话
                print("\n5. 再次获取所有会话 (验证 directory 是否保存)...")
                response = await client.get(f"{base_url}/session")
                if response.status_code == 200:
                    data = response.json()
                    sessions = data if isinstance(data, list) else data.get("items", [])
                    for s in sessions:
                        if s.get('id') == session_id:
                            print(f"   Directory (列表): '{s.get('directory', 'NOT SET')}'")
                            break
            else:
                print(f"   ✗ 创建会话失败: {response.status_code}")
                print(f"   响应: {response.text}")
        except Exception as e:
            print(f"   ✗ 创建会话出错: {e}")

    print("\n" + "=" * 60)
    print("测试完成")
    print("=" * 60)

if __name__ == "__main__":
    asyncio.run(test_opencode_api())
