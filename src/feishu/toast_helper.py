"""Toast 辅助函数模块

提供标准化的 Toast 响应构造函数。
"""

from typing import Dict


def error_toast(message: str) -> Dict[str, Dict[str, str]]:
    """构建错误 toast 响应

    Args:
        message: 错误消息内容

    Returns:
        Toast 响应字典
    """
    return {
        "toast": {
            "type": "error",
            "content": message,
            "i18n": {"zh_cn": message},
        }
    }


def success_toast(message: str) -> Dict[str, Dict[str, str]]:
    """构建成功 toast 响应

    Args:
        message: 成功消息内容

    Returns:
        Toast 响应字典
    """
    return {
        "toast": {
            "type": "success",
            "content": message,
            "i18n": {"zh_cn": message},
        }
    }


def warning_toast(message: str) -> Dict[str, Dict[str, str]]:
    """构建警告 toast 响应

    Args:
        message: 警告消息内容

    Returns:
        Toast 响应字典
    """
    return {
        "toast": {
            "type": "warning",
            "content": message,
            "i18n": {"zh_cn": message},
        }
    }


def info_toast(message: str) -> Dict[str, Dict[str, str]]:
    """构建信息 toast 响应

    Args:
        message: 信息消息内容

    Returns:
        Toast 响应字典
    """
    return {
        "toast": {
            "type": "info",
            "content": message,
            "i18n": {"zh_cn": message},
        }
    }


def toast_with_card(
    toast_type: str, toast_message: str, card: Dict
) -> Dict[str, Dict]:
    """构建带卡片更新的 toast 响应

    Args:
        toast_type: toast 类型 (success/error/warning/info)
        toast_message: toast 消息内容
        card: 卡片数据字典，包含 message_id 和 card

    Returns:
        组合响应字典
    """
    return {
        "toast": {
            "type": toast_type,
            "content": toast_message,
            "i18n": {"zh_cn": toast_message},
        },
        "update_card": card,
    }
