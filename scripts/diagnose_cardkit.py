#!/usr/bin/env python3
"""
诊断 CardKit 集成问题
"""

import asyncio
import sys
import os

sys.path.insert(0, "/code/cli-feishu-bridge")

from src.config import Config


async def test_opencode_server():
    """测试 OpenCode Server"""
    print("=" * 60)
    print("测试 OpenCode Server")
    print("=" * 60)

    try:
        from src.adapters.opencode import OpenCodeAdapter

        adapter = OpenCodeAdapter(
            {
                "command": "opencode",
                "timeout": 300,
            }
        )

        # 测试 Server 启动
        print("\n1. 启动 OpenCode Server...")
        from src.adapters.opencode import OpenCodeServerManager

        server_mgr = OpenCodeServerManager()
        success = await server_mgr.start()

        if success:
            print("✅ Server 启动成功")
            print(f"   URL: {server_mgr.base_url}")
        else:
            print("❌ Server 启动失败")
            return

        # 测试会话创建
        print("\n2. 创建会话...")
        import httpx

        async with httpx.AsyncClient() as client:
            resp = await client.post(f"{server_mgr.base_url}/session")
            if resp.status_code == 200:
                session_data = resp.json()
                session_id = session_data.get("id")
                print(f"✅ 会话创建成功: {session_id}")
            else:
                print(f"❌ 会话创建失败: {resp.status_code}")
                return

        # 测试发送消息
        print("\n3. 发送测试消息...")
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{server_mgr.base_url}/session/{session_id}/message",
                json={"content": "你好", "role": "user"},
            )
            if resp.status_code in [200, 201]:
                print("✅ 消息发送成功")
            else:
                print(f"❌ 消息发送失败: {resp.status_code} - {resp.text}")

        # 测试事件流
        print("\n4. 测试事件流 (5秒)...")
        import time

        start = time.time()
        chunk_count = 0

        async with httpx.AsyncClient() as client:
            async with client.stream("GET", f"{server_mgr.base_url}/event") as resp:
                async for line in resp.aiter_lines():
                    if line.startswith("data: "):
                        chunk_count += 1
                        if chunk_count <= 3:
                            print(f"   收到: {line[:80]}...")

                    if time.time() - start > 5:
                        break

        print(f"✅ 事件流测试完成，收到 {chunk_count} 个 chunk")

    except Exception as e:
        print(f"❌ 错误: {e}")
        import traceback

        traceback.print_exc()


async def test_cardkit_api():
    """测试 CardKit API"""
    print("\n" + "=" * 60)
    print("测试 CardKit API")
    print("=" * 60)

    try:
        from src.feishu.cardkit_client import CardKitClient
        from src.config import Config

        # 加载配置
        config = Config.from_yaml("config.yaml")

        if not config.feishu.app_id or not config.feishu.app_secret:
            print("❌ 飞书配置不完整")
            return

        print(f"\n1. 初始化 CardKitClient...")
        client = CardKitClient(
            app_id=config.feishu.app_id, app_secret=config.feishu.app_secret
        )
        print("✅ CardKitClient 初始化成功")

        # 测试创建卡片
        print("\n2. 创建 CardKit 实体...")
        test_card = {
            "schema": "2.0",
            "config": {"streaming_mode": True},
            "body": {
                "elements": [
                    {
                        "tag": "markdown",
                        "content": "测试内容",
                        "element_id": "streaming_content",
                    }
                ]
            },
        }

        try:
            card_id = await client.create_card_entity(test_card)
            print(f"✅ CardKit 实体创建成功: {card_id}")

            # 测试流式更新
            print("\n3. 测试流式更新...")
            await client.stream_card_content(
                card_id=card_id,
                element_id="streaming_content",
                content="测试流式内容",
                sequence=1,
            )
            print("✅ 流式更新成功")

        except Exception as e:
            print(f"❌ CardKit API 调用失败: {e}")
            print("   可能原因：")
            print("   - 飞书应用没有 CardKit 权限")
            print("   - App ID 或 App Secret 错误")
            print("   - 网络问题")

    except Exception as e:
        print(f"❌ 错误: {e}")
        import traceback

        traceback.print_exc()


async def main():
    print("\n" + "=" * 60)
    print("CardKit 集成诊断工具")
    print("=" * 60)

    await test_opencode_server()
    await test_cardkit_api()

    print("\n" + "=" * 60)
    print("诊断完成")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
