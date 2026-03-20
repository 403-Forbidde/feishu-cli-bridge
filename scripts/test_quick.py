#!/usr/bin/env python3
"""
快速测试脚本 - 验证基本流程
"""

import asyncio
import sys

sys.path.insert(0, "/code/cli-feishu-bridge")


async def test_streaming_controller():
    """测试流式控制器的基本流程"""
    print("=" * 60)
    print("测试 StreamingCardController 流程")
    print("=" * 60)

    from src.feishu.streaming_controller import (
        StreamingCardController,
        TextState,
        ReasoningState,
    )

    # 测试 TextState
    print("\n1. 测试 TextState...")
    text_state = TextState()
    text_state.append("Hello")
    text_state.append("Hello World")
    print(f"   Accumulated: {text_state.accumulated_text}")
    print(f"   Pending: {text_state.pending_text}")
    print(f"   ✓ TextState 工作正常")

    # 测试 ReasoningState
    print("\n2. 测试 ReasoningState...")
    reasoning_state = ReasoningState()
    reasoning_state.append("Thinking...")
    print(f"   Accumulated: {reasoning_state.accumulated_reasoning_text}")
    print(f"   ✓ ReasoningState 工作正常")

    print("\n✅ 基本流程测试通过")


async def test_api_import():
    """测试 API 导入"""
    print("\n" + "=" * 60)
    print("测试 API 导入")
    print("=" * 60)

    try:
        from src.feishu.api import FeishuAPI, _convert_stats
        from src.adapters.base import TokenStats

        print("✅ FeishuAPI 导入成功")

        # 测试 _convert_stats
        stats = TokenStats(
            total_tokens=1000,
            context_used=500,
            context_window=128000,
            context_percent=0.4,
            model="test",
        )

        result = _convert_stats(stats)
        print(f"✅ _convert_stats 工作正常: {result}")

    except Exception as e:
        print(f"❌ 错误: {e}")
        import traceback

        traceback.print_exc()


def main():
    print("\n" + "=" * 60)
    print("CardKit 快速测试")
    print("=" * 60)

    asyncio.run(test_streaming_controller())
    asyncio.run(test_api_import())

    print("\n" + "=" * 60)
    print("测试完成")
    print("=" * 60)


if __name__ == "__main__":
    main()
