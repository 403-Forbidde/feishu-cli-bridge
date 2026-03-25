"""飞书消息解析器

负责解析飞书事件数据为内部消息对象。
"""

import json
import logging
import mimetypes
from typing import Optional, List, Dict

from .client import FeishuMessage

logger = logging.getLogger(__name__)


class MessageParser:
    """飞书消息解析器"""

    def parse_event_data(self, event_data: dict) -> Optional[FeishuMessage]:
        """
        解析飞书事件数据为 FeishuMessage 对象

        Args:
            event_data: 飞书事件数据字典

        Returns:
            FeishuMessage 对象，解析失败返回 None
        """
        try:
            header = event_data.get("header", {})
            event = event_data.get("event", {})

            # 检查事件类型
            event_type = header.get("event_type", "")
            if event_type != "im.message.receive_v1":
                logger.debug(f"⏭️ 忽略非消息事件: {event_type}")
                return None

            sender = event.get("sender", {})
            message_data = event.get("message", {})

            # 获取发送者信息
            sender_id_obj = sender.get("sender_id", {})
            sender_id = sender_id_obj.get("open_id", "")

            # 获取消息内容
            msg_type = message_data.get("message_type", "")
            content_str = message_data.get("content", "{}")

            # 解析 content JSON
            try:
                content_obj = json.loads(content_str)
            except json.JSONDecodeError:
                content_obj = {"text": content_str}

            # 提取文本内容和附件元数据
            text = ""
            pending_attachments: List[Dict] = []

            if msg_type == "text":
                text = (
                    content_obj.get("text", "")
                    if isinstance(content_obj, dict)
                    else str(content_obj)
                )
            elif msg_type == "post":
                text = self._extract_text_from_post(content_obj)
                pending_attachments = self._extract_images_from_post(content_obj)
            elif msg_type == "image":
                image_key = content_obj.get("image_key", "")
                if image_key:
                    text = "[图片]"
                    pending_attachments = [
                        {
                            "file_key": image_key,
                            "resource_type": "image",
                            "filename": f"{image_key}.jpg",
                            "mime_type": "image/jpeg",
                        }
                    ]
            elif msg_type == "file":
                file_key = content_obj.get("file_key", "")
                file_name = content_obj.get("file_name", "attachment")
                if file_key:
                    mime_type, _ = mimetypes.guess_type(file_name)
                    mime_type = mime_type or "application/octet-stream"
                    text = f"[文件: {file_name}]"
                    pending_attachments = [
                        {
                            "file_key": file_key,
                            "resource_type": "file",
                            "filename": file_name,
                            "mime_type": mime_type,
                        }
                    ]

            # 获取回复的消息 ID
            parent_id = message_data.get("parent_id") or message_data.get("root_id")

            logger.debug(
                f"📄 解析消息: type={msg_type}, chat_type={message_data.get('chat_type', '')}, "
                f"parent_id={parent_id}, attachments={len(pending_attachments)}"
            )

            return FeishuMessage(
                message_id=message_data.get("message_id", ""),
                chat_id=message_data.get("chat_id", ""),
                chat_type=message_data.get("chat_type", ""),
                sender_id=sender_id,
                sender_name=sender_id,  # 暂时用 ID 代替
                content=text,
                msg_type=msg_type,
                thread_id=message_data.get("thread_id"),
                mention_users=[],
                parent_id=parent_id,
                attachments=pending_attachments if pending_attachments else None,
            )

        except Exception as e:
            logger.exception(f"❌ 解析事件数据失败: {e}")
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

    def _extract_images_from_post(self, content: dict) -> List[Dict]:
        """从富文本消息中提取嵌入图片"""
        attachments = []
        content_list = content.get("content", [])
        for item in content_list:
            if isinstance(item, list):
                for sub_item in item:
                    if isinstance(sub_item, dict) and sub_item.get("tag") == "img":
                        image_key = sub_item.get("image_key", "")
                        if image_key:
                            attachments.append(
                                {
                                    "file_key": image_key,
                                    "resource_type": "image",
                                    "filename": f"{image_key}.jpg",
                                    "mime_type": "image/jpeg",
                                }
                            )
        return attachments
