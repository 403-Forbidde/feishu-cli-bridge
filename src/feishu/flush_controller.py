"""
FlushController - 通用节流刷新控制器

纯调度原语，管理基于定时器的节流、互斥刷新和冲突时的 reflush。
不含任何业务逻辑 —— 实际刷新工作通过回调函数提供。

参考 OpenClaw-Lark 实现:
https://github.com/bytedance/openclaw (MIT License, Copyright 2026 ByteDance)
"""

import asyncio
import logging
import time
from typing import Awaitable, Callable, List, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# 节流常量
# ---------------------------------------------------------------------------


class ThrottleConstants:
    """
    卡片更新节流间隔常量。

    - CARDKIT_MS: CardKit cardElement.content() — 专为流式设计，低节流即可。
    - PATCH_MS: im.message.patch — 严格限流（230020 错误），需要保守间隔。
    - LONG_GAP_THRESHOLD_MS: 长间隙阈值（工具调用/LLM思考后），超过此值则
      认为存在长间隙，延迟首次刷新以批量收集内容。
    - BATCH_AFTER_GAP_MS: 长间隙后的批处理窗口，等待这么久再刷新，确保
      首次可见更新包含有意义的内容而不是1-2个字符。
    """

    CARDKIT_MS: int = 100
    PATCH_MS: int = 1500
    LONG_GAP_THRESHOLD_MS: int = 2000
    BATCH_AFTER_GAP_MS: int = 300


THROTTLE_CONSTANTS = ThrottleConstants()


# ---------------------------------------------------------------------------
# FlushController
# ---------------------------------------------------------------------------


class FlushController:
    """
    通用节流刷新控制器

    调度原语，管理：
    - 定时器节流
    - 互斥刷新（防并发）
    - 冲突时的 reflush 标记
    - 等待进行中刷新完成的接口

    不含任何业务逻辑 —— 实际刷新工作通过 do_flush 回调提供。
    """

    def __init__(self, do_flush: Callable[[], Awaitable[None]]):
        """
        初始化刷新控制器

        Args:
            do_flush: 执行实际刷新工作的异步回调函数
        """
        self.do_flush = do_flush

        # 互斥状态
        self.flush_in_progress: bool = False
        self.flush_resolvers: List[asyncio.Future] = []
        self.needs_reflush: bool = False
        self.pending_flush_timer: Optional[asyncio.TimerHandle] = None

        # 时间戳（毫秒）
        self.last_update_time: float = 0
        self.is_completed: bool = False

        # 卡片是否已准备好（由外部设置）
        self._card_message_ready: bool = False

    # ------------------------------------------------------------------
    # 公共接口
    # ------------------------------------------------------------------

    def complete(self):
        """标记控制器为已完成 —— 当前刷新之后不再有新刷新。"""
        self.is_completed = True

    def cancel_pending_flush(self):
        """取消任何待处理的延迟刷新定时器。"""
        if self.pending_flush_timer:
            self.pending_flush_timer.cancel()
            self.pending_flush_timer = None

    async def wait_for_flush(self):
        """等待任何进行中的刷新完成。"""
        if not self.flush_in_progress:
            return
        loop = asyncio.get_event_loop()
        future = loop.create_future()
        self.flush_resolvers.append(future)
        await future

    async def flush(self):
        """
        执行刷新（互斥保护，冲突时标记 reflush）。

        如果刷新已在进行中，标记 needs_reflush，使当前刷新完成后
        立即安排下一次刷新。
        """
        if not self.card_message_ready() or self.flush_in_progress or self.is_completed:
            if self.flush_in_progress and not self.is_completed:
                self.needs_reflush = True
            return

        self.flush_in_progress = True
        self.needs_reflush = False

        # 在 API 调用前更新时间戳，防止并发调用者也进入 flush（竞态修复）
        self.last_update_time = time.time() * 1000

        try:
            await self.do_flush()
            self.last_update_time = time.time() * 1000
        except Exception as e:
            logger.error(f"flush 执行失败: {e}")
        finally:
            self.flush_in_progress = False

            # 通知所有等待者
            resolvers = self.flush_resolvers
            self.flush_resolvers = []
            for resolver in resolvers:
                if not resolver.done():
                    resolver.set_result(None)

            # 如果 API 调用期间有新事件到达，安排立即的后续刷新
            if (
                self.needs_reflush
                and not self.is_completed
                and not self.pending_flush_timer
            ):
                self.needs_reflush = False
                loop = asyncio.get_event_loop()
                self.pending_flush_timer = loop.call_later(
                    0,
                    lambda: asyncio.create_task(self._flush_and_clear_timer()),
                )

    async def _flush_and_clear_timer(self):
        """清除定时器引用后执行刷新。"""
        self.pending_flush_timer = None
        await self.flush()

    async def throttled_update(self, throttle_ms: int):
        """
        节流更新入口点。

        根据 throttle_ms 决定是立即刷新还是安排延迟刷新。
        同时处理长间隙场景：长时间没有更新后，先延迟一小段时间
        批量收集内容再刷新，避免首次更新内容过少。

        Args:
            throttle_ms: 两次刷新之间的最小间隔（毫秒）。
                         由调用方传入，以便控制器本身保持业务无关。
        """
        if not self.card_message_ready():
            return

        now = time.time() * 1000
        elapsed = now - self.last_update_time

        if elapsed >= throttle_ms:
            self.cancel_pending_flush()

            if elapsed > THROTTLE_CONSTANTS.LONG_GAP_THRESHOLD_MS:
                # 长间隙后：短暂批处理，确保首次可见更新有实质内容
                self.last_update_time = now
                loop = asyncio.get_event_loop()
                self.pending_flush_timer = loop.call_later(
                    THROTTLE_CONSTANTS.BATCH_AFTER_GAP_MS / 1000,
                    lambda: asyncio.create_task(self._flush_and_clear_timer()),
                )
            else:
                await self.flush()

        elif not self.pending_flush_timer:
            # 在节流窗口内 —— 安排延迟刷新
            delay = (throttle_ms - elapsed) / 1000
            loop = asyncio.get_event_loop()
            self.pending_flush_timer = loop.call_later(
                delay,
                lambda: asyncio.create_task(self._flush_and_clear_timer()),
            )

    # ------------------------------------------------------------------
    # 卡片就绪状态（由外部控制）
    # ------------------------------------------------------------------

    def card_message_ready(self) -> bool:
        """卡片消息是否已准备好（可以发起更新）。"""
        return self._card_message_ready

    def set_card_message_ready(self, ready: bool):
        """
        设置卡片消息准备状态。

        Args:
            ready: True 表示卡片已创建并可接受更新
        """
        self._card_message_ready = ready
        if ready:
            # 初始化时间戳，使第一次 throttled_update 看到较小的 elapsed
            self.last_update_time = time.time() * 1000
