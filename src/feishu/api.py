"""飞书 API 封装模块 - CardKit 版本"""

import asyncio
import json
import logging
import tempfile
import time
from pathlib import Path
from typing import Optional, AsyncIterator, Callable, Dict, Any
from dataclasses import dataclass
from functools import partial

import lark_oapi as lark
from lark_oapi.api.im.v1 import (
    CreateMessageRequest,
    CreateMessageRequestBody,
    CreateMessageResponse,
    CreateMessageReactionRequest,
    CreateMessageReactionRequestBody,
    CreateMessageReactionResponse,
    DeleteMessageReactionRequest,
    DeleteMessageReactionResponse,
    GetMessageResourceRequest,
    GetMessageResourceResponse,
    PatchMessageRequest,
    PatchMessageRequestBody,
    PatchMessageResponse,
    ReplyMessageRequest,
    ReplyMessageRequestBody,
    ReplyMessageResponse,
)

from ..adapters.base import TokenStats, StreamChunk, StreamChunkType
from .card_builder import build_card_content
from .cardkit_client import CardKitClient
from .streaming_controller import StreamingCardController

logger = logging.getLogger(__name__)


@dataclass
class MessageResult:
    """消息发送结果"""

    message_id: str
    content: str
    chat_id: str


class FeishuAPI:
    """飞书 API 客户端（CardKit 版本）"""

    def __init__(self, app_id: str, app_secret: str):
        self.app_id = app_id
        self.app_secret = app_secret

        # 传统 IM 客户端
        self.client = (
            lark.Client.builder()
            .app_id(app_id)
            .app_secret(app_secret)
            .log_level(lark.LogLevel.WARNING)
            .build()
        )

        # CardKit 客户端
        self.cardkit_client = CardKitClient(app_id, app_secret)

        # 检查 Python 版本，使用合适的异步方式
        import sys

        self._use_to_thread = sys.version_info >= (3, 9)

    async def _run_sync(self, func, *args, **kwargs):
        """在线程池中运行同步函数"""
        if self._use_to_thread:
            return await asyncio.to_thread(func, *args, **kwargs)
        else:
            loop = asyncio.get_event_loop()
            return await loop.run_in_executor(None, partial(func, *args, **kwargs))

    async def send_text(
        self, chat_id: str, content: str, reply_to: Optional[str] = None
    ) -> MessageResult:
        """
        发送文本消息

        Args:
            chat_id: 聊天 ID
            content: 消息内容
            reply_to: 回复的消息 ID（可选）

        Returns:
            MessageResult
        """
        content_json = json.dumps({"text": content}, ensure_ascii=False)

        body = (
            CreateMessageRequestBody.builder()
            .receive_id(chat_id)
            .msg_type("text")
            .content(content_json)
            .build()
        )

        request = (
            CreateMessageRequest.builder()
            .receive_id_type("chat_id")
            .request_body(body)
            .build()
        )

        response: CreateMessageResponse = await self._run_sync(
            self.client.im.v1.message.create, request
        )

        if not response.success():
            logger.error(f"Failed to send message: {response.code} - {response.msg}")
            raise Exception(f"Send message failed: {response.msg}")

        message_id = response.data.message_id
        logger.debug(f"Sent message: {message_id}")

        return MessageResult(message_id=message_id, content=content, chat_id=chat_id)

    async def send_card_message(
        self, chat_id: str, card: Dict[str, Any], reply_to: Optional[str] = None
    ) -> str:
        """
        发送交互式卡片消息

        当提供 reply_to 时，使用 im.v1.message.reply 接口发送带引用气泡的回复；
        否则使用 im.v1.message.create 普通发送。

        Args:
            chat_id: 聊天 ID
            card: 卡片内容（JSON 对象）
            reply_to: 被回复的消息 ID，设置后飞书显示原生引用气泡

        Returns:
            message_id: 新消息 ID
        """
        content_json = json.dumps(card, ensure_ascii=False)

        if reply_to:
            # 使用 reply 接口 — 飞书显示原生"回复 XXX: 内容"引用气泡
            body = (
                ReplyMessageRequestBody.builder()
                .content(content_json)
                .msg_type("interactive")
                .build()
            )
            request = (
                ReplyMessageRequest.builder()
                .message_id(reply_to)
                .request_body(body)
                .build()
            )
            response: ReplyMessageResponse = await self._run_sync(
                self.client.im.v1.message.reply, request
            )
            if not response.success():
                logger.error(f"Failed to reply card: {response.code} - {response.msg}")
                raise Exception(f"Reply card failed: {response.msg}")
            message_id = response.data.message_id
        else:
            # 普通发送
            body_create = (
                CreateMessageRequestBody.builder()
                .receive_id(chat_id)
                .msg_type("interactive")
                .content(content_json)
                .build()
            )
            request_create = (
                CreateMessageRequest.builder()
                .receive_id_type("chat_id")
                .request_body(body_create)
                .build()
            )
            response_create: CreateMessageResponse = await self._run_sync(
                self.client.im.v1.message.create, request_create
            )
            if not response_create.success():
                logger.error(
                    f"Failed to send card: {response_create.code} - {response_create.msg}"
                )
                raise Exception(f"Send card failed: {response_create.msg}")
            message_id = response_create.data.message_id

        logger.debug(f"Sent card message: {message_id} (reply_to={reply_to})")
        return message_id

    async def send_card_by_card_id(
        self,
        to: str,
        card_id: str,
        reply_to_message_id: Optional[str] = None,
    ) -> Dict[str, str]:
        """
        发送引用 CardKit card_id 的 IM 消息（CardKit 流式模式核心步骤）

        当提供 reply_to_message_id 时，使用 im.v1.message.reply 发送，
        飞书会在卡片顶部显示原生"回复 XXX: 内容"引用气泡；
        否则使用 im.v1.message.create 普通发送。

        Args:
            to: 聊天 ID（无 reply_to_message_id 时用作接收者）
            card_id: CardKit 卡片 ID
            reply_to_message_id: 被回复的消息 ID，设置后飞书显示原生引用气泡

        Returns:
            {"message_id": str, "chat_id": str}
        """
        content_payload = json.dumps(
            {"type": "card", "data": {"card_id": card_id}}, ensure_ascii=False
        )

        if reply_to_message_id:
            # 使用 reply 接口 — 飞书显示原生引用气泡
            body = (
                ReplyMessageRequestBody.builder()
                .content(content_payload)
                .msg_type("interactive")
                .build()
            )
            request = (
                ReplyMessageRequest.builder()
                .message_id(reply_to_message_id)
                .request_body(body)
                .build()
            )
            response: ReplyMessageResponse = await self._run_sync(
                self.client.im.v1.message.reply, request
            )
            if not response.success():
                logger.error(
                    f"Failed to reply card by card_id: {response.code} - {response.msg}"
                )
                raise Exception(f"Reply card by card_id failed: {response.msg}")
            result = {
                "message_id": response.data.message_id,
                "chat_id": response.data.chat_id or to,
            }
        else:
            # 普通发送
            body_create = (
                CreateMessageRequestBody.builder()
                .receive_id(to)
                .msg_type("interactive")
                .content(content_payload)
                .build()
            )
            request_create = (
                CreateMessageRequest.builder()
                .receive_id_type("chat_id")
                .request_body(body_create)
                .build()
            )
            response_create: CreateMessageResponse = await self._run_sync(
                self.client.im.v1.message.create, request_create
            )
            if not response_create.success():
                logger.error(
                    f"Failed to send card by card_id: {response_create.code} - {response_create.msg}"
                )
                raise Exception(f"Send card by card_id failed: {response_create.msg}")
            result = {
                "message_id": response_create.data.message_id,
                "chat_id": response_create.data.chat_id or to,
            }

        logger.info(
            f"Sent card by card_id: card_id={card_id}, message_id={result['message_id']}"
        )

        return result

    async def update_card_message(self, message_id: str, card: Dict[str, Any]) -> bool:
        """
        更新交互式卡片消息（IM Patch 方式）

        作为 CardKit 失败的回退方案

        Args:
            message_id: 消息 ID
            card: 新的卡片内容

        Returns:
            是否更新成功
        """
        content_json = json.dumps(card, ensure_ascii=False)

        body = PatchMessageRequestBody.builder().content(content_json).build()

        request = (
            PatchMessageRequest.builder()
            .message_id(message_id)
            .request_body(body)
            .build()
        )

        response: PatchMessageResponse = await self._run_sync(
            self.client.im.v1.message.patch, request
        )

        if not response.success():
            # 限流错误不报错，但返回失败
            if "230020" in str(response.code):
                logger.debug(f"Rate limited updating card: {message_id}")
                return False
            logger.warning(f"Failed to update card: {response.code} - {response.msg}")
            return False

        return True

    async def add_typing_reaction(self, message_id: str) -> Optional[str]:
        """给用户消息添加"打字中"表情反应 (✏️ 动画)"""
        try:
            body = (
                CreateMessageReactionRequestBody.builder()
                .reaction_type({"emoji_type": "Typing"})
                .build()
            )

            request = (
                CreateMessageReactionRequest.builder()
                .message_id(message_id)
                .request_body(body)
                .build()
            )

            response: CreateMessageReactionResponse = await self._run_sync(
                self.client.im.v1.message_reaction.create, request
            )

            if response.success():
                reaction_id = response.data.reaction_id
                logger.debug(
                    f"Added typing reaction {reaction_id} to message {message_id}"
                )
                return reaction_id
            else:
                logger.warning(
                    f"Failed to add typing reaction: {response.code} - {response.msg}"
                )
                return None

        except Exception as e:
            logger.debug(f"Failed to add typing reaction: {e}")
            return None

    async def remove_typing_reaction(self, message_id: str, reaction_id: Optional[str]):
        """移除"打字中"表情反应"""
        if not reaction_id:
            return

        try:
            request = (
                DeleteMessageReactionRequest.builder()
                .message_id(message_id)
                .reaction_id(reaction_id)
                .build()
            )

            response: DeleteMessageReactionResponse = await self._run_sync(
                self.client.im.v1.message_reaction.delete, request
            )

            if response.success():
                logger.debug(
                    f"Removed typing reaction {reaction_id} from message {message_id}"
                )

        except Exception as e:
            logger.debug(f"Failed to remove typing reaction: {e}")

    async def download_message_resource(
        self,
        message_id: str,
        file_key: str,
        resource_type: str = "image",
        filename: str = "",
    ) -> Optional[str]:
        """
        下载飞书消息中的图片或文件到本地临时目录

        Args:
            message_id: 消息 ID
            file_key: 文件 key（image_key 或 file_key）
            resource_type: "image" 或 "file"
            filename: 保存的文件名（不含路径），空时自动生成

        Returns:
            本地文件绝对路径，失败返回 None
        """
        try:
            request = (
                GetMessageResourceRequest.builder()
                .message_id(message_id)
                .file_key(file_key)
                .type(resource_type)
                .build()
            )

            response: GetMessageResourceResponse = await self._run_sync(
                self.client.im.v1.message_resource.get, request
            )

            # GetMessageResourceResponse 直接挂载 .file 和 .file_name，
            # 不像其他接口嵌套在 .data 下；文件下载成功时 code 可能为 None
            file_content = response.file
            if file_content is None:
                logger.error(
                    f"Failed to download resource: {response.code} - {response.msg}"
                )
                return None

            # 准备保存目录
            save_dir = Path(tempfile.gettempdir()) / "feishu_images"
            save_dir.mkdir(exist_ok=True)

            # 清理超过 24h 的旧文件
            _cleanup_old_files(save_dir, max_age_hours=24)

            # 确定文件名（优先用 SDK 返回的 file_name）
            if not filename:
                filename = response.file_name or (
                    f"{file_key}.jpg" if resource_type == "image" else f"{file_key}.bin"
                )

            save_path = save_dir / filename

            # 写入文件（IO[Any] 对象直接 read）
            if hasattr(file_content, "read"):
                data = file_content.read()
            else:
                data = bytes(file_content)

            await asyncio.to_thread(save_path.write_bytes, data)

            logger.info(f"Downloaded resource to: {save_path}")
            return str(save_path)

        except Exception as e:
            logger.error(f"Failed to download message resource: {e}")
            return None

    async def stream_reply(
        self,
        chat_id: str,
        stream: AsyncIterator[StreamChunk],
        stats_provider: Callable[[str], TokenStats],
        model: str = "",
        reply_to_message_id: Optional[str] = None,
    ) -> str:
        """
        流式回复消息（CardKit 打字机效果）

        Args:
            chat_id: 聊天 ID
            stream: 流式输出
            stats_provider: 统计信息提供者
            model: 模型名称
            reply_to_message_id: 回复的消息 ID（可选）

        Returns:
            最终内容
        """
        import os

        # 检查是否禁用 CardKit
        if os.getenv("DISABLE_CARDKIT", "").lower() in ("1", "true", "yes"):
            logger.info("CardKit 被禁用，使用传统 IM Patch 模式")
            return await self._stream_reply_legacy(
                chat_id, stream, stats_provider, model, reply_to_message_id
            )

        start_time = time.time()
        logger.info(f"开始流式回复: chat_id={chat_id}, model={model}")

        # 创建流式卡片控制器（会立即开始创建 CardKit 卡片）
        controller = StreamingCardController(
            chat_id=chat_id,
            cardkit_client=self.cardkit_client,
            feishu_client=self,
            reply_to_message_id=reply_to_message_id,
        )

        # 给卡片创建一点时间
        await asyncio.sleep(0.1)

        try:
            chunk_count = 0
            content_chars = 0
            logger.info("开始接收流式数据...")

            async for chunk in stream:
                chunk_count += 1

                if chunk.type == StreamChunkType.ERROR:
                    # 错误内容 - 记录但不显示
                    logger.error(f"Stream error chunk: {chunk.data}")

                elif chunk.type == StreamChunkType.CONTENT:
                    # 正式回复内容
                    content_chars += len(chunk.data)
                    await controller.on_content_stream(chunk.data)

                elif chunk.type == StreamChunkType.REASONING:
                    # 思考过程
                    await controller.on_reasoning_stream(chunk.data)

                elif chunk.type == StreamChunkType.DONE:
                    logger.info(f"收到 DONE 信号，共 {chunk_count} 个 chunks")
                    break

            logger.info(f"流式接收完成: {chunk_count} chunks, {content_chars} 字符")

            # 标记流式输出完成
            controller.mark_fully_complete()

            # 完成处理
            await controller.on_complete(
                stats_provider=lambda text: _convert_stats(stats_provider(text)),
                model=model,
            )

            # 等待卡片创建任务完成
            if controller.card_creation_task:
                try:
                    await controller.card_creation_task
                except asyncio.CancelledError:
                    pass

            logger.info(
                f"流式回复完成: {len(controller.text.accumulated_text)} chars, "
                f"reasoning={len(controller.reasoning.accumulated_reasoning_text)} chars, "
                f"elapsed={time.time() - start_time:.1f}s"
            )

            return controller.text.accumulated_text

        except Exception as e:
            logger.exception(f"流式回复失败: {e}")
            await controller.on_error(str(e))
            raise

    async def _stream_reply_legacy(
        self,
        chat_id: str,
        stream: AsyncIterator[StreamChunk],
        stats_provider: Callable[[str], TokenStats],
        model: str = "",
        reply_to_message_id: Optional[str] = None,
    ) -> str:
        """
        传统流式回复（使用 IM Patch）- 作为 CardKit 失败的回退
        """
        start_time = time.time()
        full_content = ""
        full_reasoning = ""
        message_id: Optional[str] = None
        card_created = False

        # 思考阶段状态
        is_reasoning_phase = False
        reasoning_start_time: Optional[float] = None
        reasoning_elapsed_ms = 0

        # 使用简单节流
        last_update = 0
        update_interval = 0.5  # 0.5秒更新一次

        try:
            async for chunk in stream:
                if chunk.type == StreamChunkType.ERROR:
                    full_content += chunk.data
                elif chunk.type == StreamChunkType.CONTENT:
                    if is_reasoning_phase:
                        is_reasoning_phase = False
                        if reasoning_start_time:
                            reasoning_elapsed_ms = int(
                                (time.time() - reasoning_start_time) * 1000
                            )
                    full_content += chunk.data
                elif chunk.type == StreamChunkType.REASONING:
                    if not is_reasoning_phase:
                        is_reasoning_phase = True
                        reasoning_start_time = time.time()
                    full_reasoning += chunk.data
                elif chunk.type == StreamChunkType.DONE:
                    break

                # 创建或更新卡片
                now = time.time()
                if not card_created:
                    # 首次创建
                    initial_card = build_card_content(
                        "streaming",
                        {
                            "text": full_content,
                            "reasoning_text": full_reasoning
                            if full_reasoning
                            else None,
                        },
                    )
                    try:
                        message_id = await self.send_card_message(chat_id, initial_card)
                        card_created = True
                        last_update = now
                    except Exception as e:
                        logger.error(f"创建卡片失败: {e}")
                        continue
                elif now - last_update >= update_interval:
                    # 更新卡片
                    card = build_card_content(
                        "streaming",
                        {
                            "text": full_content,
                            "reasoning_text": full_reasoning
                            if full_reasoning
                            else None,
                        },
                    )
                    try:
                        await self.update_card_message(message_id, card)
                        last_update = now
                    except Exception:
                        pass  # 忽略更新失败

            # 发送最终卡片
            if message_id:
                elapsed = time.time() - start_time
                stats = stats_provider(full_content)

                final_card = build_card_content(
                    "complete",
                    {
                        "text": full_content,
                        "elapsed_ms": int(elapsed * 1000),
                        "reasoning_text": full_reasoning or None,
                        "reasoning_elapsed_ms": reasoning_elapsed_ms or None,
                        "token_stats": {
                            "total_tokens": stats.total_tokens,
                            "context_used": stats.context_used,
                            "context_window": stats.context_window,
                        },
                        "model": model,
                    },
                )
                await self.update_card_message(message_id, final_card)
            else:
                await self.send_text(chat_id, full_content or "（无回复）")

            logger.info(f"传统流式回复完成: {len(full_content)} chars")
            return full_content

        except Exception as e:
            logger.exception(f"传统流式回复失败: {e}")
            if message_id:
                error_card = build_card_content(
                    "complete",
                    {"text": full_content or "处理失败", "is_error": True},
                )
                await self.update_card_message(message_id, error_card)
            else:
                await self.send_text(chat_id, f"❌ 处理失败: {str(e)[:200]}")
            raise


def _cleanup_old_files(directory: Path, max_age_hours: int = 24):
    """删除目录中超过指定时间的文件"""
    cutoff = time.time() - max_age_hours * 3600
    try:
        for f in directory.iterdir():
            if f.is_file() and f.stat().st_mtime < cutoff:
                f.unlink(missing_ok=True)
    except Exception:
        pass


def _convert_stats(token_stats: TokenStats) -> Dict[str, Any]:
    """转换 TokenStats 为字典格式"""
    return {
        "total_tokens": token_stats.total_tokens,
        "context_used": token_stats.context_used,
        "context_window": token_stats.context_window,
        "context_percent": token_stats.context_percent,
    }
