"""
CardKit Client - 飞书 CardKit API 客户端

使用 lark_oapi Python SDK 实现真正的流式卡片更新：
- card.create: 创建卡片实体
- cardElement.content: 流式更新卡片元素内容（打字机效果）
- card.update: 更新整个卡片
- card.settings: 设置流式模式

参考 OpenClaw 实现:
https://github.com/bytedance/openclaw/blob/main/extensions/openclaw-lark/src/card/cardkit.ts
"""

import json
import logging
from typing import Optional, Dict, Any

import lark_oapi as lark
from lark_oapi.client import Client

logger = logging.getLogger(__name__)


class CardKitClient:
    """
    飞书 CardKit API 客户端

    使用 lark_oapi SDK 实现真正的流式卡片更新，包含打字机动画效果。
    """

    def __init__(self, app_id: str, app_secret: str):
        self.app_id = app_id
        self.app_secret = app_secret

        # 使用 lark_oapi SDK 创建客户端
        self._client = Client.builder().app_id(app_id).app_secret(app_secret).build()

    async def create_card_entity(self, card: Dict[str, Any]) -> Optional[str]:
        """
        通过 CardKit API 创建卡片实体

        Args:
            card: 卡片 JSON 内容

        Returns:
            card_id: 卡片 ID
        """
        try:
            # 使用 SDK 构造请求
            req = (
                lark.cardkit.v1.CreateCardRequest.builder()
                .request_body(
                    lark.cardkit.v1.CreateCardRequestBody.builder()
                    .type("card_json")
                    .data(json.dumps(card))
                    .build()
                )
                .build()
            )

            # 发送请求（使用异步方法）
            resp = await self._client.cardkit.v1.card.acreate(req)

            # 检查响应
            if resp.code != 0:
                logger.error(f"创建 CardKit 实体失败: code={resp.code}, msg={resp.msg}")
                raise Exception(f"创建 CardKit 实体失败: {resp.msg}")

            card_id = resp.data.card_id if resp.data else None
            logger.info(f"创建 CardKit 实体成功: card_id={card_id}")
            return card_id

        except Exception as e:
            logger.error(f"创建 CardKit 实体异常: {e}")
            raise

    async def stream_card_content(
        self, card_id: str, element_id: str, content: str, sequence: int
    ) -> None:
        """
        使用 CardKit API 流式传输文本内容到特定卡片元素

        卡片会自动将新内容与之前内容做 diff，并使用打字机动画渲染增量变化。

        Args:
            card_id: CardKit 卡片 ID
            element_id: 要更新的元素 ID (如 'streaming_content')
            content: 完整的累积文本（不是 delta）
            sequence: 单调递增的序列号
        """
        try:
            # 使用 SDK 构造请求
            req = (
                lark.cardkit.v1.ContentCardElementRequest.builder()
                .card_id(card_id)
                .element_id(element_id)
                .request_body(
                    lark.cardkit.v1.ContentCardElementRequestBody.builder()
                    .content(content)
                    .sequence(sequence)
                    .build()
                )
                .build()
            )

            # 发送请求（使用异步方法）
            resp = await self._client.cardkit.v1.card_element.acontent(req)

            # 检查响应
            if resp.code != 0:
                logger.warning(
                    f"流式更新卡片内容失败: code={resp.code}, msg={resp.msg}"
                )
                raise Exception(f"流式更新失败: {resp.msg}")

            logger.debug(f"流式更新卡片内容成功: seq={sequence}, len={len(content)}")

        except Exception as e:
            logger.error(f"流式更新卡片内容异常: {e}")
            raise

    async def update_card(
        self, card_id: str, card: Dict[str, Any], sequence: int
    ) -> None:
        """
        使用 CardKit API 完整替换卡片

        用于流式完成后的最终"完成"状态更新（带操作按钮、绿色标题等）

        Args:
            card_id: CardKit 卡片 ID
            card: 新的卡片 JSON 内容
            sequence: 单调递增的序列号
        """
        try:
            # 构造 card 数据
            card_data = (
                lark.cardkit.v1.Card.builder()
                .type("card_json")
                .data(json.dumps(card))
                .build()
            )

            # 使用 SDK 构造请求
            req = (
                lark.cardkit.v1.UpdateCardRequest.builder()
                .card_id(card_id)
                .request_body(
                    lark.cardkit.v1.UpdateCardRequestBody.builder()
                    .card(card_data)
                    .sequence(sequence)
                    .build()
                )
                .build()
            )

            # 发送请求（使用异步方法）
            resp = await self._client.cardkit.v1.card.aupdate(req)

            # 检查响应
            if resp.code != 0:
                logger.warning(
                    f"更新 CardKit 卡片失败: code={resp.code}, msg={resp.msg}"
                )
                raise Exception(f"更新卡片失败: {resp.msg}")

            logger.info(f"更新 CardKit 卡片成功: card_id={card_id}, seq={sequence}")

        except Exception as e:
            logger.error(f"更新 CardKit 卡片异常: {e}")
            raise

    async def set_streaming_mode(
        self, card_id: str, streaming_mode: bool, sequence: int
    ) -> None:
        """
        关闭（或开启）CardKit 卡片的流式模式

        流式完成后必须调用，以恢复正常卡片行为（转发、交互回调等）

        Args:
            card_id: CardKit 卡片 ID
            streaming_mode: 是否开启流式模式
            sequence: 单调递增的序列号
        """
        try:
            # 使用 SDK 构造请求
            req = (
                lark.cardkit.v1.SettingsCardRequest.builder()
                .card_id(card_id)
                .request_body(
                    lark.cardkit.v1.SettingsCardRequestBody.builder()
                    .settings(json.dumps({"streaming_mode": streaming_mode}))
                    .sequence(sequence)
                    .build()
                )
                .build()
            )

            # 发送请求（使用异步方法）
            resp = await self._client.cardkit.v1.card.asettings(req)

            # 检查响应
            if resp.code != 0:
                logger.warning(
                    f"设置卡片流式模式失败: code={resp.code}, msg={resp.msg}"
                )
                raise Exception(f"设置流式模式失败: {resp.msg}")

            logger.info(
                f"设置卡片流式模式成功: card_id={card_id}, streaming={streaming_mode}, seq={sequence}"
            )

        except Exception as e:
            logger.error(f"设置卡片流式模式异常: {e}")
            raise
