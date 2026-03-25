#!/usr/bin/env python3
"""诊断会话目录隔离问题"""

import asyncio
import json
import os
import sys

# 添加项目路径
sys.path.insert(0, '/code/feishu-cli-bridge')

import httpx

# 从 core.py 导入路径比较函数
def _normalize_path(path: str) -> str:
    """规范化路径，用于比较"""
    if not path:
        return ""
    try:
        expanded = os.path.expanduser(path)
        normalized = os.path.realpath(expanded)
        return normalized.rstrip("/") or "/"
    except (OSError, ValueError):
        return path.rstrip("/") or "/"

def _paths_equal(path1: str, path2: str) -> bool:
    """比较两个路径是否指向同一位置"""
    return _normalize_path(path1) == _normalize_path(path2)

async def diagnose():
    """诊断会话目录问题"""
    base_url = "http://127.0.0.1:4096"

    print("=" * 60)
    print("OpenCode 会话目录隔离诊断")
    print("=" * 60)

    async with httpx.AsyncClient() as client:
        # 1. 检查服务器健康状态
        print("\n1. 检查服务器健康状态...")
        try:
            response = await client.get(f"{base_url}/health", timeout=5.0)
            if response.status_code == 200:
                print(f"   ✓ 服务器运行正常")
            else:
                print(f"   ✗ 服务器返回错误: {response.status_code}")
                return
        except Exception as e:
            print(f"   ✗ 无法连接服务器: {e}")
            print(f"   请先启动 Bridge 或 opencode serve")
            return

        # 2. 获取所有会话
        print("\n2. 获取所有会话...")
        try:
            response = await client.get(f"{base_url}/session")
            if response.status_code == 200:
                data = response.json()
                sessions = data if isinstance(data, list) else data.get("items", [])
                print(f"   找到 {len(sessions)} 个会话")

                if not sessions:
                    print("   ⚠️ 服务器上没有会话")
                    return

                print("\n   会话详情:")
                print("   " + "-" * 56)
                for i, s in enumerate(sessions, 1):
                    sid = s.get("id", "")[:8] + "..."
                    title = s.get("title", "未命名")
                    directory = s.get("directory", "")
                    slug = s.get("slug", "")
                    print(f"   {i}. ID: {sid}")
                    print(f"      标题: {title}")
                    print(f"      Slug: {slug}")
                    print(f"      Directory: '{directory}'")
                    print(f"      规范化后: '{_normalize_path(directory)}'")
                    print()
            else:
                print(f"   ✗ 获取会话失败: {response.status_code}")
                return
        except Exception as e:
            print(f"   ✗ 获取会话出错: {e}")
            return

        # 3. 测试特定目录的过滤
        print("\n3. 测试目录过滤...")
        test_dirs = [
            "/code/test",
            "/code/feishu-cli-bridge",
            os.getcwd(),
        ]

        for test_dir in test_dirs:
            print(f"\n   测试目录: '{test_dir}'")
            print(f"   规范化后: '{_normalize_path(test_dir)}'")

            matching = [
                s for s in sessions
                if _paths_equal(s.get("directory", ""), test_dir)
            ]
            print(f"   匹配的会话数: {len(matching)}")

            if matching:
                for s in matching:
                    print(f"      - {s.get('title', '未命名')} ({s.get('id', '')[:8]}...)")
            else:
                # 显示为什么没匹配到
                print("   诊断信息:")
                norm_test = _normalize_path(test_dir)
                for s in sessions:
                    sess_dir = s.get("directory", "")
                    norm_sess = _normalize_path(sess_dir)
                    print(f"      与会话 '{s.get('title', '未命名')}' 比较:")
                    print(f"         会话 directory: '{sess_dir}'")
                    print(f"         规范化后:       '{norm_sess}'")
                    print(f"         测试目录:       '{norm_test}'")
                    print(f"         是否相等:       {norm_sess == norm_test}")

    print("\n" + "=" * 60)
    print("诊断完成")
    print("=" * 60)

if __name__ == "__main__":
    asyncio.run(diagnose())
