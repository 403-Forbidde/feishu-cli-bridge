"""
StreamingCardController - 流式卡片控制器

管理 CardKit 卡片的完整生命周期：
  idle → creating → streaming → completed / aborted / terminated

将节流调度委托给 FlushController，业务逻辑与调度逻辑完全分离。

参考：
- OpenClaw-Lark (MIT License, Copyright 2026 ByteDance)
- kimibridge StreamingCardControllerV2
"""

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Optional

from .cardkit_client import CardKitClient
from .card_builder import build_card_content, optimize_markdown_style
from .flush_controller import FlushController, THROTTLE_CONSTANTS

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------

# CardKit 元素 ID（流式打字机目标元素）
STREAMING_ELEMENT_ID = "streaming_content"

# 状态机定义
TERMINAL_PHASES = {"completed", "aborted", "terminated", "creation_failed"}

PHASE_TRANSITIONS: Dict[str, set] = {
    "idle": {"creating", "aborted", "terminated"},
    "creating": {"streaming", "creation_failed", "aborted", "terminated"},
    "streaming": {"completed", "aborted", "terminated"},
    "completed": set(),
    "aborted": set(),
    "terminated": set(),
    "creation_failed": set(),
}

# loading_icon 元素 ID（流式进行中的动画图标）
LOADING_ELEMENT_ID = "loading_icon"

# OpenClaw 官方 loading 动画图片 key（飞书 CDN 内部资源）
_LOADING_ICON_IMG_KEY = "img_v3_02vb_496bec09-4b43-4773-ad6b-0cdd103cd2bg"

# 流式初始卡片（CardKit 2.0 格式，streaming_mode=True）
# 结构：
#   [0] streaming_content — 打字机更新目标，初始为空
#   [1] loading_icon      — 左下角动态加载动画（CardKit streaming_mode 下显示）
STREAMING_THINKING_CARD = {
    "schema": "2.0",
    "config": {
        "streaming_mode": True,
        "summary": {"content": "思考中..."},
    },
    "body": {
        "elements": [
            {
                "tag": "markdown",
                "content": "",
                "text_align": "left",
                "text_size": "normal_v2",
                "margin": "0px 0px 0px 0px",
                "element_id": STREAMING_ELEMENT_ID,
            },
            {
                # 左下角加载动画图标，在 streaming_mode=True 时显示动态效果
                "tag": "markdown",
                "content": " ",
                "icon": {
                    "tag": "custom_icon",
                    "img_key": _LOADING_ICON_IMG_KEY,
                    "size": "16px 16px",
                },
                "element_id": LOADING_ELEMENT_ID,
            },
        ],
    },
}


# ---------------------------------------------------------------------------
# 状态数据类
# ---------------------------------------------------------------------------


@dataclass
class CardKitState:
    """CardKit API 状态"""

    card_kit_card_id: Optional[str] = None
    original_card_kit_card_id: Optional[str] = None  # 用于最终更新的原始 ID
    card_kit_sequence: int = 0
    card_message_id: Optional[str] = None


@dataclass
class TextState:
    """
    正式回复文本状态

    accumulatedText  完整的累积文本（用于显示和最终卡片）
    completedText    deliver() 回调累积的文本（多轮时拼接）
    streamingPrefix  多轮回复时已完成部分的前缀
    lastPartialText  上次 onPartialReply 收到的文本（用于边界检测）
    """

    accumulated_text: str = ""
    completed_text: str = ""
    streaming_prefix: str = ""
    last_partial_text: str = ""

    # 统计
    total_chars_received: int = 0
    token_stats: Optional[Dict] = field(default=None)


@dataclass
class ReasoningState:
    """思考过程状态"""

    accumulated_reasoning_text: str = ""
    reasoning_start_time: Optional[float] = None
    reasoning_elapsed_ms: int = 0
    is_reasoning_phase: bool = False


# ---------------------------------------------------------------------------
# StreamingCardController
# ---------------------------------------------------------------------------


class StreamingCardController:
    """
    流式卡片控制器

    管理 CardKit 卡片生命周期，实现打字机效果流式输出。

    设计原则（对齐 OpenClaw-Lark）：
    - 节流调度委托给 FlushController（纯调度原语）
    - CardKit 模式用 100ms 节流；IM Patch 回退用 1500ms 节流
    - 长间隙（工具调用/LLM 思考）后延迟批处理，避免首次更新内容过少
    - 状态机严格控制转换，防止非法状态
    - CardKit 失败时无缝降级到 IM Patch
    """

    def __init__(
        self,
        chat_id: str,
        cardkit_client: CardKitClient,
        feishu_client: Any,
        reply_to_message_id: Optional[str] = None,
    ):
        self.chat_id = chat_id
        self.cardkit_client = cardkit_client
        self.feishu_client = feishu_client
        self.reply_to_message_id = reply_to_message_id

        # 状态机
        self.phase: str = "idle"

        # 结构化状态
        self.card_kit = CardKitState()
        self.text = TextState()
        self.reasoning = ReasoningState()

        # 子控制器
        self.flush = FlushController(lambda: self._perform_flush())

        # 生命周期
        self.create_epoch: int = 0
        self._terminal_reason: Optional[str] = None
        self.dispatch_fully_complete: bool = False
        self.card_creation_task: Optional[asyncio.Task] = None
        self.dispatch_start_time: float = time.time() * 1000

        # 立即启动卡片创建（不等待，后续按需 await）
        asyncio.create_task(self._ensure_card_created())

    # ------------------------------------------------------------------
    # 公共属性
    # ------------------------------------------------------------------

    def elapsed(self) -> int:
        """已流逝时间（毫秒）"""
        return int(time.time() * 1000 - self.dispatch_start_time)

    @property
    def card_message_id(self) -> Optional[str]:
        return self.card_kit.card_message_id

    @property
    def is_terminal_phase(self) -> bool:
        return self.phase in TERMINAL_PHASES

    @property
    def terminal_reason(self) -> Optional[str]:
        return self._terminal_reason

    def should_proceed(self, source: str = "") -> bool:
        """回调保护 —— 检查流水线是否活跃。"""
        return not self.is_terminal_phase

    # ------------------------------------------------------------------
    # 状态机
    # ------------------------------------------------------------------

    def _is_stale_create(self, epoch: int) -> bool:
        return epoch != self.create_epoch

    def _transition(self, to: str, source: str, reason: Optional[str] = None) -> bool:
        """尝试状态转换，不合法的转换被拒绝。"""
        from_phase = self.phase
        if from_phase == to:
            return False

        allowed = PHASE_TRANSITIONS.get(from_phase, set())
        if to not in allowed:
            logger.warning(f"状态转换被拒绝: {from_phase} -> {to}, source={source}")
            return False

        self.phase = to
        logger.info(f"状态转换: {from_phase} -> {to}, source={source}")

        if to in TERMINAL_PHASES:
            self._terminal_reason = reason
            self._on_enter_terminal_phase()

        return True

    def _on_enter_terminal_phase(self):
        """进入终止阶段时的清理。"""
        self.create_epoch += 1
        self.flush.cancel_pending_flush()
        self.flush.complete()

    # ------------------------------------------------------------------
    # SDK 回调绑定
    # ------------------------------------------------------------------

    async def on_reasoning_stream(self, text: str):
        """
        处理思考流式输出。

        思考过程实时显示，使用 CardKit 节流间隔（100ms）。
        """
        if not self.should_proceed("on_reasoning_stream"):
            return
        if not text:
            return

        await self._ensure_card_created()

        if not self.should_proceed("on_reasoning_stream.postCreate"):
            return
        if not self.card_kit.card_message_id:
            return

        if not self.reasoning.reasoning_start_time:
            self.reasoning.reasoning_start_time = time.time() * 1000

        self.reasoning.is_reasoning_phase = True
        self.reasoning.accumulated_reasoning_text = text

        await self._throttled_card_update()

    async def on_content_stream(self, text: str):
        """
        处理正式回复流式输出（delta 追加模式）。

        OpenCode 适配器发送的是增量 delta，每次调用追加到 accumulated_text。
        """
        if not self.should_proceed("on_content_stream"):
            return
        if not text:
            return

        if not self.reasoning.reasoning_start_time:
            self.reasoning.reasoning_start_time = time.time() * 1000

        # 检测思考阶段结束
        if self.reasoning.is_reasoning_phase:
            self.reasoning.is_reasoning_phase = False
            if self.reasoning.reasoning_start_time:
                self.reasoning.reasoning_elapsed_ms = int(
                    time.time() * 1000 - self.reasoning.reasoning_start_time
                )

        # 追加增量内容
        self.text.accumulated_text += text
        self.text.total_chars_received = len(self.text.accumulated_text)

        await self._ensure_card_created()

        if not self.should_proceed("on_content_stream.postCreate"):
            return
        if not self.card_kit.card_message_id:
            return

        await self._throttled_card_update()

    async def on_complete(
        self,
        stats_provider: Optional[Callable] = None,
        model: str = "",
    ):
        """
        处理完成 —— 关闭流式模式，更新最终卡片。
        """
        logger.info(f"on_complete 被调用，当前阶段: {self.phase}")

        if self.is_terminal_phase and self.phase != "creation_failed":
            logger.info(f"已处于终止阶段 {self.phase}，跳过 on_complete")
            return

        self.dispatch_fully_complete = True

        # 等待任何进行中的刷新完成
        await self.flush.wait_for_flush()

        # 等待卡片创建完成
        if self.card_creation_task and not self.card_creation_task.done():
            try:
                await self.card_creation_task
            except asyncio.CancelledError:
                pass

        # 再次等待，卡片创建后可能触发了刷新
        await asyncio.sleep(0)
        await self.flush.wait_for_flush()

        self._transition("completed", "on_complete", "normal")

        if not self.card_kit.card_message_id:
            # 卡片创建失败，降级为文本消息
            logger.warning("卡片未创建，发送文本消息作为 fallback")
            try:
                display_text = self.text.accumulated_text or "暂无回复"
                await self.feishu_client.send_text(self.chat_id, display_text)
            except Exception as e:
                logger.error(f"发送 fallback 文本消息失败: {e}")
            return

        try:
            display_text = self.text.accumulated_text or "暂无回复"

            # 获取 token 统计
            token_stats = None
            if stats_provider:
                try:
                    token_stats = stats_provider(display_text)
                except Exception as e:
                    logger.warning(f"获取统计信息失败: {e}")

            complete_card = build_card_content(
                "complete",
                {
                    "text": display_text,
                    "reasoning_text": self.reasoning.accumulated_reasoning_text or None,
                    "reasoning_elapsed_ms": self.reasoning.reasoning_elapsed_ms or None,
                    "elapsed_ms": self.elapsed(),
                    "token_stats": token_stats,
                    "model": model,
                },
            )

            effective_card_id = (
                self.card_kit.card_kit_card_id
                or self.card_kit.original_card_kit_card_id
            )

            if effective_card_id:
                await self._close_streaming_and_update(
                    effective_card_id, complete_card, "on_complete"
                )
            else:
                await self.feishu_client.update_card_message(
                    self.card_kit.card_message_id, complete_card
                )

            logger.info(f"回复完成，卡片已最终化，耗时 {self.elapsed()}ms")

        except Exception as e:
            logger.error(f"最终卡片更新失败: {e}")

    def mark_fully_complete(self):
        """标记流式输出完全完成（外部调用）。"""
        logger.debug(
            f"markFullyComplete: accumulated={len(self.text.accumulated_text)}"
        )
        self.dispatch_fully_complete = True

    async def on_error(self, error: str):
        """处理错误 —— 更新卡片显示错误状态。"""
        logger.error(f"回复失败: {error}")
        self._transition("completed", "on_error", "error")

        await self.flush.wait_for_flush()

        if self.card_creation_task:
            try:
                await self.card_creation_task
            except asyncio.CancelledError:
                pass

        if not self.card_kit.card_message_id:
            return

        try:
            error_text = (
                f"{self.text.accumulated_text}\n\n---\n**错误**: 生成回复时发生错误"
                if self.text.accumulated_text
                else "**错误**: 生成回复时发生错误"
            )

            error_card = build_card_content(
                "complete",
                {
                    "text": error_text,
                    "reasoning_text": self.reasoning.accumulated_reasoning_text or None,
                    "reasoning_elapsed_ms": self.reasoning.reasoning_elapsed_ms or None,
                    "elapsed_ms": self.elapsed(),
                    "is_error": True,
                },
            )

            effective_card_id = (
                self.card_kit.card_kit_card_id
                or self.card_kit.original_card_kit_card_id
            )

            if effective_card_id:
                await self._close_streaming_and_update(
                    effective_card_id, error_card, "on_error"
                )
            else:
                await self.feishu_client.update_card_message(
                    self.card_kit.card_message_id, error_card
                )

        except Exception:
            pass

    # ------------------------------------------------------------------
    # 内部：卡片创建
    # ------------------------------------------------------------------

    async def _ensure_card_created(self):
        """确保卡片已创建（幂等，多次调用安全）。"""
        if (
            self.card_kit.card_message_id
            or self.phase == "creation_failed"
            or self.is_terminal_phase
        ):
            return

        if self.card_creation_task:
            try:
                await self.card_creation_task
            except asyncio.CancelledError:
                pass
            return

        if not self._transition("creating", "_ensure_card_created"):
            return

        self.create_epoch += 1
        epoch = self.create_epoch

        self.card_creation_task = asyncio.create_task(self._create_card_task(epoch))
        try:
            await self.card_creation_task
        except asyncio.CancelledError:
            pass

    async def _create_card_task(self, epoch: int):
        """执行卡片创建流程。CardKit 失败时自动降级到 IM 卡片。"""
        try:
            try:
                # 步骤 1: 创建 CardKit 实体
                logger.info("开始创建 CardKit 实体...")
                card_id = await asyncio.wait_for(
                    self.cardkit_client.create_card_entity(STREAMING_THINKING_CARD),
                    timeout=10.0,
                )

                if self._is_stale_create(epoch):
                    logger.info(f"创建后 epoch 过期，退出: epoch={epoch}")
                    return

                if not card_id:
                    raise Exception("card.create 返回空 card_id")

                self.card_kit.card_kit_card_id = card_id
                self.card_kit.original_card_kit_card_id = card_id
                self.card_kit.card_kit_sequence = 1
                logger.info(f"CardKit 实体创建成功: card_id={card_id}")

                # 步骤 2: 发送引用 card_id 的 IM 消息
                result = await self.feishu_client.send_card_by_card_id(
                    to=self.chat_id,
                    card_id=card_id,
                    reply_to_message_id=self.reply_to_message_id,
                )

                if self._is_stale_create(epoch):
                    return

                self.card_kit.card_message_id = result.get("message_id")
                self.flush.set_card_message_ready(True)

                if not self._transition("streaming", "_ensure_card_created.cardkit"):
                    return

                logger.info(
                    f"CardKit 卡片发送成功: message_id={self.card_kit.card_message_id}"
                )

            except Exception as cardkit_err:
                if self._is_stale_create(epoch):
                    return

                logger.warning(f"CardKit 流程失败，降级到 IM 卡片: {cardkit_err}")

                # 清除 CardKit 引用
                self.card_kit.card_kit_card_id = None
                self.card_kit.original_card_kit_card_id = None

                # 发送普通思考中卡片（传入 reply_to 以显示引用气泡）
                fallback_card = build_card_content("thinking")
                message_id = await self.feishu_client.send_card_message(
                    self.chat_id, fallback_card, reply_to=self.reply_to_message_id
                )

                if self._is_stale_create(epoch):
                    return

                self.card_kit.card_message_id = message_id
                self.flush.set_card_message_ready(True)

                if not self._transition("streaming", "_ensure_card_created.imFallback"):
                    return

                logger.info(
                    f"IM 回退卡片发送成功: message_id={self.card_kit.card_message_id}"
                )

        except Exception as err:
            if self._is_stale_create(epoch):
                return

            logger.error(f"卡片创建完全失败: {err}", exc_info=True)
            self._transition(
                "creation_failed", "_ensure_card_created.outer", "creation_failed"
            )

    # ------------------------------------------------------------------
    # 内部：刷新
    # ------------------------------------------------------------------

    async def _throttled_card_update(self):
        """
        节流卡片更新。

        根据当前模式选择节流间隔：
        - CardKit 模式: 100ms（流式 API，低节流）
        - IM Patch 模式: 1500ms（严格限流，保守间隔）
        """
        throttle_ms = (
            THROTTLE_CONSTANTS.CARDKIT_MS
            if self.card_kit.card_kit_card_id
            else THROTTLE_CONSTANTS.PATCH_MS
        )
        await self.flush.throttled_update(throttle_ms)

    async def _perform_flush(self):
        """
        执行实际的卡片内容更新。

        由 FlushController 的 do_flush 回调调用，确保互斥执行。
        """
        if not self.card_kit.card_message_id or self.is_terminal_phase:
            return

        # CardKit 2.0 卡片不能走 IM Patch 中间更新：
        # 如果流式 CardKit 已禁用但 original_card_kit_card_id 仍在，
        # 说明卡片通过 CardKit 发出 —— 跳过中间更新，等终态用 original_id 收尾。
        if (
            not self.card_kit.card_kit_card_id
            and self.card_kit.original_card_kit_card_id
        ):
            logger.debug("_perform_flush: 跳过（CardKit 流式已禁用，等待最终更新）")
            return

        display_text = self._build_display_text()

        try:
            if self.card_kit.card_kit_card_id:
                # CardKit 流式更新 —— 打字机效果
                prev_seq = self.card_kit.card_kit_sequence
                self.card_kit.card_kit_sequence += 1
                logger.debug(
                    f"_perform_flush: CardKit seq {prev_seq} -> {self.card_kit.card_kit_sequence}"
                )

                await self.cardkit_client.stream_card_content(
                    self.card_kit.card_kit_card_id,
                    STREAMING_ELEMENT_ID,
                    optimize_markdown_style(display_text),
                    self.card_kit.card_kit_sequence,
                )

            else:
                # IM Patch 回退
                logger.debug("_perform_flush: IM Patch 回退")
                card = build_card_content(
                    "streaming",
                    {
                        "text": ""
                        if self.reasoning.is_reasoning_phase
                        else display_text,
                        "reasoning_text": (
                            self.reasoning.accumulated_reasoning_text
                            if self.reasoning.is_reasoning_phase
                            else None
                        ),
                    },
                )
                await self.feishu_client.update_card_message(
                    self.card_kit.card_message_id, card
                )

        except Exception as err:
            error_str = str(err)

            # 限流错误静默处理
            if "230020" in error_str:
                logger.info(
                    f"_perform_flush: 被限流 (230020)，跳过 seq={self.card_kit.card_kit_sequence}"
                )
                return

            # 序列号冲突静默处理
            if "300317" in error_str:
                logger.warning(
                    f"_perform_flush: 序列号冲突 (300317)，跳过 seq={self.card_kit.card_kit_sequence}"
                )
                return

            logger.error(f"卡片流式更新失败: {err}")

            # CardKit 失败 → 禁用 CardKit 流式，回退到 IM Patch
            if self.card_kit.card_kit_card_id:
                logger.warning("禁用 CardKit 流式，回退到 im.message.patch")
                self.card_kit.card_kit_card_id = None

    def _build_display_text(self) -> str:
        """构建当前要显示的文本。"""
        if (
            self.reasoning.is_reasoning_phase
            and self.reasoning.accumulated_reasoning_text
        ):
            reasoning_display = (
                f"💭 **Thinking...**\n\n{self.reasoning.accumulated_reasoning_text}"
            )
            return (
                self.text.accumulated_text + "\n\n" + reasoning_display
                if self.text.accumulated_text
                else reasoning_display
            )
        return self.text.accumulated_text

    # ------------------------------------------------------------------
    # 内部：生命周期辅助
    # ------------------------------------------------------------------

    async def _close_streaming_and_update(self, card_id: str, card: dict, label: str):
        """关闭流式模式，然后更新卡片为最终内容。"""
        # 关闭流式模式
        try:
            seq_before = self.card_kit.card_kit_sequence
            self.card_kit.card_kit_sequence += 1
            logger.info(
                f"{label}: 关闭流式模式 seq {seq_before} -> {self.card_kit.card_kit_sequence}"
            )
            await self.cardkit_client.set_streaming_mode(
                card_id, False, self.card_kit.card_kit_sequence
            )
        except Exception as e:
            logger.warning(f"{label}: 关闭流式模式失败: {e}")

        # 更新最终卡片
        try:
            seq_before = self.card_kit.card_kit_sequence
            self.card_kit.card_kit_sequence += 1
            logger.info(
                f"{label}: 更新最终卡片 seq {seq_before} -> {self.card_kit.card_kit_sequence}"
            )
            await self.cardkit_client.update_card(
                card_id, card, self.card_kit.card_kit_sequence
            )
        except Exception as e:
            logger.warning(f"{label}: CardKit 更新失败，回退到 IM Patch: {e}")
            if self.card_kit.card_message_id:
                await self.feishu_client.update_card_message(
                    self.card_kit.card_message_id, card
                )
