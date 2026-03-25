#!/usr/bin/env python3
"""测试会话目录隔离的过滤逻辑"""

import os
import sys
sys.path.insert(0, '/code/feishu-cli-bridge')

from src.adapters.opencode.core import _normalize_path, _paths_equal

# 模拟从服务器返回的会话数据（与 OpenCode 服务器实际返回格式一致）
mock_sessions = [
    {
        "id": "session-001",
        "title": "Test Session 1",
        "slug": "test-1",
        "directory": "/code/test",
        "time": {"created": 1700000000000, "updated": 1700000100000}
    },
    {
        "id": "session-002",
        "title": "Feishu Bridge Session",
        "slug": "feishu-bridge",
        "directory": "/code/feishu-cli-bridge",
        "time": {"created": 1700001000000, "updated": 1700002000000}
    },
    {
        "id": "session-003",
        "title": "Another Test Session",
        "slug": "another-test",
        "directory": "/code/test",  # 同属于 /code/test
        "time": {"created": 1700003000000, "updated": 1700004000000}
    },
]

def test_filter_logic():
    """测试过滤逻辑"""
    print("=" * 60)
    print("会话目录隔离过滤逻辑测试")
    print("=" * 60)

    # 测试目录
    test_dirs = [
        "/code/test",
        "/code/feishu-cli-bridge",
        "/code/nonexistent",
    ]

    for test_dir in test_dirs:
        print(f"\n测试目录: '{test_dir}'")
        print(f"规范化后: '{_normalize_path(test_dir)}'")
        print("-" * 40)

        # 模拟 list_sessions 的过滤逻辑
        filtered = [
            s for s in mock_sessions
            if _paths_equal(s.get("directory", ""), test_dir)
        ]

        print(f"匹配到的会话数: {len(filtered)}")
        for s in filtered:
            print(f"  - {s['title']} ({s['directory']})")

    # 详细比较每个会话的 directory 字段
    print("\n" + "=" * 60)
    print("详细路径比较")
    print("=" * 60)

    for test_dir in ["/code/test", "/code/feishu-cli-bridge"]:
        norm_test = _normalize_path(test_dir)
        print(f"\n测试目录: '{test_dir}' -> '{norm_test}'")
        for s in mock_sessions:
            sess_dir = s.get("directory", "")
            norm_sess = _normalize_path(sess_dir)
            equal = _paths_equal(sess_dir, test_dir)
            status = "✓ 匹配" if equal else "✗ 不匹配"
            print(f"  会话 '{s['title']}'")
            print(f"    directory: '{sess_dir}' -> '{norm_sess}'")
            print(f"    结果: {status}")

if __name__ == "__main__":
    test_filter_logic()
