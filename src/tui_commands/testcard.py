"""Schema 2.0 测试卡片命令

提供 /testcard2 命令用于测试飞书 Schema 2.0 交互卡片。
"""

from typing import Any, Dict, List, Optional

from .base import TUIBaseCommand, TUIResult, CommandContext, TUIResultType


class TestCardCommand(TUIBaseCommand):
    """Schema 2.0 测试卡片命令处理器

    实现 /testcard2 命令，发送 Schema 2.0 格式的交互式测试卡片。
    """

    def __init__(self, logger: Optional[Any] = None):
        # 不需要适配器，直接调用父类
        super().__init__(adapter=None, logger=logger)

    @property
    def supported_commands(self) -> List[str]:
        """返回支持的命令列表"""
        return ["testcard2"]

    async def execute(
        self, command: str, args: Optional[str], context: CommandContext
    ) -> TUIResult:
        """执行测试卡片命令

        Args:
            command: 命令名称（应为 "testcard2"）
            args: 命令参数（忽略）
            context: 执行上下文

        Returns:
            TUIResult: 卡片结果
        """
        from ..feishu.card_builder import build_test_card_v2_initial

        # 构建初始测试卡片
        card_json = build_test_card_v2_initial()

        # 返回卡片结果
        return TUIResult.card(
            content="Schema 2.0 交互测试卡片",
            metadata={"card_json": card_json},
        )
