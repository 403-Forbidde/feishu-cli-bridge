"""飞书客户端模块 - 参考 KimiBridge 实现"""

import asyncio
import json
import logging
import threading
import time
from typing import Optional, Callable, Awaitable, Dict, Any, List
from dataclasses import dataclass, field

import lark_oapi as lark
from lark_oapi.ws import Client as WSClient
from lark_oapi.api.im.v1 import P2ImMessageReceiveV1
from lark_oapi.event.callback.model.p2_card_action_trigger import (
    P2CardActionTrigger,
    P2CardActionTriggerResponse,
    CallBackToast,
)

logger = logging.getLogger(__name__)


# 调整 lark-oapi SDK 的日志级别，减少噪音
def _silence_noisy_loggers():
    """静默 SDK 的噪音日志"""
    noisy_loggers = [
        "Lark",
        "lark_oapi.ws.client",
        "lark_oapi.core.log",
    ]
    for name in noisy_loggers:
        log = logging.getLogger(name)
        log.setLevel(logging.CRITICAL)


_silence_noisy_loggers()


@dataclass
class FeishuMessage:
    """飞书消息对象"""

    message_id: str
    chat_id: str
    chat_type: str  # "p2p" | "group"
    sender_id: str
    sender_name: str
    content: str
    msg_type: str
    thread_id: Optional[str] = None
    mention_users: list = None
    parent_id: Optional[str] = None  # 回复的消息 ID
    attachments: Optional[List[Dict]] = None  # [{path, mime_type, filename}]

    def __post_init__(self):
        if self.mention_users is None:
            self.mention_users = []


class FeishuClient:
    """飞书 WebSocket 客户端 - 基于 KimiBridge 实现"""

    def __init__(
        self,
        app_id: str,
        app_secret: str,
        encrypt_key: str = "",
        verification_token: str = "",
    ):
        self.app_id = app_id
        self.app_secret = app_secret
        self.encrypt_key = encrypt_key
        self.verification_token = verification_token

        self._ws_client: Optional[WSClient] = None
        self._event_handler: Optional[lark.EventDispatcherHandler] = None
        self._message_handler: Optional[Callable[[FeishuMessage], Awaitable[None]]] = (
            None
        )
        self._card_callback_handler: Optional[Callable[[Dict[str, Any]], Awaitable[Dict[str, Any]]]] = None
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def on_message(self, handler: Callable[[Dict[str, Any]], Awaitable[None]]):
        """注册消息处理器

        Args:
            handler: 处理函数，接收字典格式的事件数据
        """
        self._message_handler = handler
        return handler

    def on_card_callback(self, handler: Callable[[Dict[str, Any]], Awaitable[Dict[str, Any]]]):
        """注册卡片按钮点击回调处理器

        Args:
            handler: 异步处理函数，接收回调数据字典，返回响应字典
        """
        self._card_callback_handler = handler
        return handler

    def _create_event_handler(self) -> lark.EventDispatcherHandler:
        """创建事件处理器 - 参考 KimiBridge"""
        builder = lark.EventDispatcherHandler.builder(
            encrypt_key=self.encrypt_key, verification_token=self.verification_token
        )

        # 注册消息接收事件处理器
        builder.register_p2_im_message_receive_v1(self._on_message_received)

        # 注册卡片按钮点击回调
        builder.register_p2_card_action_trigger(self._on_card_action_trigger)

        # 注册其他事件处理器（静默处理，避免日志噪音）
        builder.register_p2_im_message_reaction_created_v1(self._on_reaction_event)
        builder.register_p2_im_message_reaction_deleted_v1(self._on_reaction_event)
        builder.register_p2_im_message_message_read_v1(self._on_read_event)
        builder.register_p2_im_chat_access_event_bot_p2p_chat_entered_v1(self._on_p2p_chat_entered)

        return builder.build()

    def _on_p2p_chat_entered(self, event) -> None:
        """处理用户进入 P2P 会话事件（静默忽略）"""
        pass

    def _on_reaction_event(self, event) -> None:
        """处理 reaction 事件（静默忽略）"""
        pass

    def _on_read_event(self, event) -> None:
        """处理消息已读事件（静默忽略）"""
        pass

    def _on_card_action_trigger(self, event: P2CardActionTrigger) -> P2CardActionTriggerResponse:
        """处理卡片按钮点击回调（WebSocket 线程，必须 3s 内同步返回）"""
        response = P2CardActionTriggerResponse()

        if not self._card_callback_handler or not self._loop:
            logger.warning("卡片回调处理器或事件循环未设置")
            _set_toast(response, "error", "功能未启用")
            return response

        try:
            event_data = _extract_card_event_data(event)
            # 在主 asyncio 事件循环中执行异步处理器
            future = asyncio.run_coroutine_threadsafe(
                self._card_callback_handler(event_data), self._loop
            )
            result = future.result(timeout=2.5)

            # 提取 update_card 指令，单独发起 patch（无法在响应中内联更新）
            if result and "update_card" in result:
                update_info = result.pop("update_card")
                msg_id = update_info.get("message_id")
                card = update_info.get("card")
                if msg_id and card:
                    asyncio.run_coroutine_threadsafe(
                        self._patch_card(msg_id, card), self._loop
                    )

            # 设置 Toast 响应
            toast_data = result.get("toast") if result else None
            if toast_data:
                _set_toast(response, toast_data.get("type", "info"),
                           toast_data.get("i18n", {}).get("zh_cn", toast_data.get("content", "")))

        except Exception as e:
            logger.error(f"卡片回调处理异常: {e}")
            _set_toast(response, "error", f"处理失败: {e}")

        return response

    async def _patch_card(self, message_id: str, card: Dict[str, Any]) -> None:
        """用 IM Patch 方式更新卡片消息内容"""
        import json
        from lark_oapi.api.im.v1 import PatchMessageRequest, PatchMessageRequestBody

        body = PatchMessageRequestBody.builder().content(
            json.dumps(card, ensure_ascii=False)
        ).build()
        request = (
            PatchMessageRequest.builder()
            .message_id(message_id)
            .request_body(body)
            .build()
        )
        client = lark.Client.builder().app_id(self.app_id).app_secret(self.app_secret).build()
        try:
            resp = await asyncio.to_thread(client.im.v1.message.patch, request)
            if not resp.success():
                logger.warning(f"卡片更新失败: {resp.code} - {resp.msg}")
            else:
                logger.info(f"卡片已更新: {message_id}")
        except Exception as e:
            logger.error(f"卡片更新异常: {e}")

    def _on_message_received(self, event: P2ImMessageReceiveV1) -> None:
        """
        处理 IM 消息接收事件 - 参考 KimiBridge

        注意：此方法在 WebSocket 线程中被调用，需要小心处理事件循环
        """
        try:
            logger.info(
                f"📝 收到原始消息事件: event_id={event.header.event_id if event.header else 'unknown'}"
            )

            # 解析消息
            message = self._parse_message(event)
            if not message:
                logger.warning("⚠️ 消息解析失败，跳过处理")
                return

            logger.info(
                f"✅ 消息解析成功 from {message.sender_id}: {message.content[:50]}..."
            )

            # 调用用户处理函数
            if self._message_handler:
                # 将事件转换为字典格式，与 handler 期望的格式一致
                event_data = self._event_to_dict(event)
                self._dispatch_to_handler(event_data)
            else:
                logger.warning("⚠️ 消息处理器未设置")

        except Exception as e:
            logger.exception(f"❌ 处理消息事件异常: {e}")

    def _event_to_dict(self, event: P2ImMessageReceiveV1) -> Dict[str, Any]:
        """将事件对象转换为字典格式"""
        return {
            "header": {
                "event_type": "im.message.receive_v1",
                "event_id": event.header.event_id if event.header else "",
                "create_time": event.header.create_time if event.header else "",
            },
            "event": {
                "sender": {
                    "sender_id": {
                        "open_id": event.event.sender.sender_id.open_id
                        if event.event.sender.sender_id
                        else ""
                    },
                    "sender_type": event.event.sender.sender_type
                    if event.event.sender
                    else "user",
                },
                "message": {
                    "message_id": event.event.message.message_id
                    if event.event.message
                    else "",
                    "chat_id": event.event.message.chat_id
                    if event.event.message
                    else "",
                    "chat_type": event.event.message.chat_type
                    if event.event.message
                    else "",
                    "message_type": event.event.message.message_type
                    if event.event.message
                    else "",
                    "content": event.event.message.content
                    if event.event.message
                    else "{}",
                    "parent_id": event.event.message.parent_id
                    if event.event.message
                    else None,
                    "root_id": event.event.message.root_id
                    if event.event.message
                    else None,
                },
            },
        }

    def _dispatch_to_handler(self, event_data: Dict[str, Any]):
        """将事件分发给处理器"""
        try:
            # 尝试获取当前运行中的事件循环
            try:
                loop = asyncio.get_running_loop()
                if loop.is_running():
                    # 在主事件循环中创建任务
                    asyncio.create_task(self._async_dispatch(event_data))
                    logger.debug("✅ 已调度消息处理任务到主事件循环")
                    return
            except RuntimeError:
                pass

            # 如果没有运行中的事件循环，创建新线程处理
            logger.debug("🔄 创建新线程处理消息")
            threading.Thread(
                target=self._sync_dispatch, args=(event_data,), daemon=True
            ).start()

        except Exception as e:
            logger.exception(f"❌ 调度消息处理失败: {e}")

    def _sync_dispatch(self, event_data: Dict[str, Any]):
        """同步分发事件"""
        try:
            if self._message_handler:
                # 创建新的事件循环
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                loop.run_until_complete(self._async_dispatch(event_data))
                loop.close()
        except Exception as e:
            logger.exception(f"❌ 同步分发事件失败: {e}")

    async def _async_dispatch(self, event_data: Dict[str, Any]):
        """异步分发事件"""
        try:
            if self._message_handler:
                await self._message_handler(event_data)
        except Exception as e:
            logger.exception(f"❌ 异步分发事件失败: {e}")

    def _parse_message(self, event: P2ImMessageReceiveV1) -> Optional[FeishuMessage]:
        """
        解析飞书消息事件 - 参考 KimiBridge
        """
        try:
            # 安全获取嵌套属性
            header = event.header
            event_data = event.event

            sender = event_data.sender if event_data else None
            message = event_data.message if event_data else None

            if not message:
                logger.warning("消息数据为空")
                return None

            # 获取发送者信息
            sender_id_obj = sender.sender_id if sender else None
            sender_id = sender_id_obj.open_id if sender_id_obj else ""

            # 获取消息内容
            msg_type = message.message_type or ""
            content_str = message.content or "{}"

            # 解析 content JSON
            try:
                content_obj = json.loads(content_str)
            except:
                content_obj = {"text": content_str}

            # 提取文本内容
            text = ""
            if msg_type == "text":
                text = (
                    content_obj.get("text", "")
                    if isinstance(content_obj, dict)
                    else str(content_obj)
                )
            elif msg_type == "post":
                text = self._extract_text_from_post(content_obj)

            # 解析 mentions
            mentions = []
            # mentions 信息可能需要从其他字段获取

            return FeishuMessage(
                message_id=message.message_id or "",
                chat_id=message.chat_id or "",
                chat_type=message.chat_type or "",
                sender_id=sender_id,
                sender_name=sender_id,  # 暂时用 ID 代替
                content=text,
                msg_type=msg_type,
                thread_id=message.thread_id,
                mention_users=mentions,
                parent_id=message.parent_id or message.root_id,
            )

        except Exception as e:
            logger.exception(f"解析消息失败: {e}")
            return None

    def _extract_text_from_post(self, content: dict) -> str:
        """从富文本消息中提取文本"""
        texts = []
        content_list = content.get("content", [])
        for item in content_list:
            if isinstance(item, list):
                for sub_item in item:
                    if isinstance(sub_item, dict):
                        tag = sub_item.get("tag", "")
                        if tag == "text":
                            texts.append(sub_item.get("text", ""))
                        elif tag == "at":
                            texts.append(f"@{sub_item.get('user_name', 'user')}")
        return " ".join(texts)

    async def _async_handle_message(self, message: FeishuMessage):
        """异步处理消息"""
        try:
            if self._message_handler:
                await self._message_handler(message)
        except Exception as e:
            logger.exception(f"处理消息异常: {e}")

    def start_sync(self) -> bool:
        """
        启动 WebSocket 连接（同步版本）

        在后台线程中启动 WebSocket 连接，非阻塞
        返回是否启动成功
        """
        try:
            # 保存主事件循环引用（供卡片回调线程使用）
            try:
                self._loop = asyncio.get_running_loop()
            except RuntimeError:
                self._loop = asyncio.get_event_loop()

            logger.info("🚀 正在启动飞书 WebSocket 长连接订阅...")

            # 创建事件处理器
            self._event_handler = self._create_event_handler()

            # 创建 WebSocket 客户端
            self._ws_client = WSClient(
                app_id=self.app_id,
                app_secret=self.app_secret,
                event_handler=self._event_handler,
                domain=lark.FEISHU_DOMAIN,  # 国内版
                log_level=lark.LogLevel.INFO,
                auto_reconnect=True,
            )

            # 在后台线程中启动 WebSocket 连接
            def run_ws():
                try:
                    logger.info("🔄 WebSocket 连接线程已启动")
                    # 在新线程中创建新的事件循环，避免与主循环冲突
                    loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(loop)
                    self._ws_client.start()
                except RuntimeError as e:
                    if "event loop" in str(e).lower():
                        logger.debug(f"WebSocket 事件循环信息: {e}")
                    else:
                        logger.error(f"WebSocket 运行异常: {e}", exc_info=True)
                except Exception as e:
                    logger.error(f"WebSocket 运行异常: {e}", exc_info=True)

            self._thread = threading.Thread(target=run_ws, daemon=True)
            self._thread.start()

            self._running = True
            logger.info("✅ 飞书 WebSocket 长连接订阅已启动")

            return True

        except Exception as e:
            logger.exception(f"❌ 启动 WebSocket 失败: {e}")
            return False

    async def start(self):
        """启动 WebSocket 连接 - 异步包装"""
        success = self.start_sync()
        if not success:
            raise RuntimeError("启动 WebSocket 失败")

        # 保持运行
        while self._running:
            await asyncio.sleep(1)

    async def stop(self):
        """停止连接"""
        logger.info("正在停止飞书客户端...")
        self._running = False
        # WSClient 没有显式的 stop 方法，会自动处理

    @property
    def is_connected(self) -> bool:
        return self._running


# ---------------------------------------------------------------------------
# 模块级辅助函数
# ---------------------------------------------------------------------------


def _extract_card_event_data(event: P2CardActionTrigger) -> Dict[str, Any]:
    """将 P2CardActionTrigger 对象转换为统一的字典格式"""
    ev = event.event or {}
    action = getattr(ev, "action", None)
    operator = getattr(ev, "operator", None)
    context = getattr(ev, "context", None)
    return {
        "open_id": getattr(operator, "open_id", "") if operator else "",
        "user_id": getattr(operator, "user_id", "") if operator else "",
        "token": getattr(ev, "token", ""),
        "action": {
            "tag": getattr(action, "tag", "") if action else "",
            "name": getattr(action, "name", "") if action else "",
            "value": getattr(action, "value", {}) if action else {},
        },
        "context": {
            "open_message_id": getattr(context, "open_message_id", "") if context else "",
            "open_chat_id": getattr(context, "open_chat_id", "") if context else "",
        },
    }


def _set_toast(response: P2CardActionTriggerResponse, toast_type: str, content: str) -> None:
    """为 P2CardActionTriggerResponse 设置 Toast 提示"""
    toast = CallBackToast()
    toast.type = toast_type
    toast.content = content
    toast.i18n = {"zh_cn": content}
    response.toast = toast
