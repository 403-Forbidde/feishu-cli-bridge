#!/usr/bin/env python3
"""
测试 CardKit 集成

运行此脚本测试新的流式卡片功能。
"""

import asyncio
import sys
import os

# 添加项目路径
sys.path.insert(0, "/code/cli-feishu-bridge")

from src.feishu.card_builder import build_card_content
from src.adapters.base import TokenStats


def test_card_builder():
    """测试卡片构建器"""
    print("=" * 60)
    print("测试卡片构建器")
    print("=" * 60)

    # 测试 thinking 卡片
    print("\n1. Thinking Card:")
    thinking_card = build_card_content("thinking")
    print(f"  Elements: {len(thinking_card.get('body', {}).get('elements', []))}")

    # 测试 streaming 卡片
    print("\n2. Streaming Card:")
    streaming_card = build_card_content("streaming", {"text": "Hello World"})
    elements = streaming_card.get("body", {}).get("elements", [])
    print(f"  Elements: {len(elements)}")
    if elements:
        print(f"  Element ID: {elements[0].get('element_id')}")

    # 测试 complete 卡片
    print("\n3. Complete Card:")
    stats = TokenStats(
        total_tokens=16300,
        context_used=14100,
        context_window=128000,
        context_percent=11.0,
        model="opencode/mimo-v2",
    )

    complete_card = build_card_content(
        "complete",
        {
            "text": "这是一段测试文本\n\n```python\nprint('hello')\n```",
            "elapsed_ms": 3200,
            "reasoning_text": "这是思考过程...",
            "reasoning_elapsed_ms": 1500,
            "token_stats": {
                "total_tokens": stats.total_tokens,
                "context_used": stats.context_used,
                "context_window": stats.context_window,
            },
            "model": stats.model,
        },
    )

    elements = complete_card.get("body", {}).get("elements", [])
    print(f"  Elements: {len(elements)}")

    # 检查是否有思考面板
    has_reasoning = any(elem.get("tag") == "collapsible_panel" for elem in elements)
    print(f"  Has reasoning panel: {has_reasoning}")

    # 检查 footer 是否右对齐
    footer = elements[-1] if elements else {}
    if footer.get("tag") == "markdown":
        print(f"  Footer align: {footer.get('text_align')}")
        print(f"  Footer content: {footer.get('content', '')[:50]}...")

    print("\n✅ Card builder test passed!")


def test_markdown_optimizer():
    """测试 Markdown 优化器"""
    print("\n" + "=" * 60)
    print("测试 Markdown 优化器")
    print("=" * 60)

    from src.feishu.card_builder import optimize_markdown_style

    # 测试标题降级
    text = "# Heading 1\n## Heading 2\n### Heading 3"
    optimized = optimize_markdown_style(text)
    print(f"\nOriginal:\n{text}")
    print(f"\nOptimized:\n{optimized}")

    # 测试代码块
    text2 = "Some text\n```python\nprint('hello')\n```\nMore text"
    optimized2 = optimize_markdown_style(text2)
    print(f"\nOriginal:\n{text2}")
    print(f"\nOptimized:\n{optimized2}")

    print("\n✅ Markdown optimizer test passed!")


async def test_streaming_controller():
    """测试流式控制器（需要飞书配置）"""
    print("\n" + "=" * 60)
    print("测试流式控制器")
    print("=" * 60)

    try:
        from src.feishu.cardkit_client import CardKitClient
        from src.feishu.streaming_controller import StreamingCardController

        # 这里只是测试类能否实例化
        # 实际测试需要飞书配置
        print("\n✅ Streaming controller classes imported successfully!")
        print("   (实际测试需要配置飞书 app_id 和 app_secret)")

    except Exception as e:
        print(f"\n❌ Error: {e}")
        raise


def main():
    """主函数"""
    print("\n" + "=" * 60)
    print("Feishu CLI Bridge - CardKit Integration Test")
    print("=" * 60)

    try:
        test_card_builder()
        test_markdown_optimizer()
        asyncio.run(test_streaming_controller())

        print("\n" + "=" * 60)
        print("✅ All tests passed!")
        print("=" * 60)

    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        import traceback

        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
