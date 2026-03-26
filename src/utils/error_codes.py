"""错误代码体系

定义飞书桥接器中所有错误的分类代码，便于问题诊断和监控。
"""

from enum import Enum
from typing import Optional


class ErrorCode(Enum):
    """错误代码枚举

    格式: XXXNNN
    - XXX: 错误类别
    - NNN: 具体错误编号
    """

    # CardKit 错误 (CDK)
    CARDKIT_RATE_LIMIT = "CDK001"
    CARDKIT_SEQ_CONFLICT = "CDK002"
    CARDKIT_CARD_NOT_FOUND = "CDK003"
    CARDKIT_AUTH_FAILED = "CDK004"
    CARDKIT_INVALID_PARAM = "CDK005"

    # 网络错误 (NET)
    NETWORK_TIMEOUT = "NET001"
    NETWORK_CONNECTION_ERROR = "NET002"
    NETWORK_DNS_ERROR = "NET003"
    NETWORK_SSL_ERROR = "NET004"

    # 服务器错误 (SRV)
    SERVER_START_FAILED = "SRV001"
    SERVER_NOT_RESPONDING = "SRV002"
    SERVER_INTERNAL_ERROR = "SRV003"

    # 会话错误 (SES)
    SESSION_NOT_FOUND = "SES001"
    SESSION_EXPIRED = "SES002"
    SESSION_CREATE_FAILED = "SES003"
    SESSION_DELETE_FAILED = "SES004"

    # 消息错误 (MSG)
    MESSAGE_SEND_FAILED = "MSG001"
    MESSAGE_PARSE_FAILED = "MSG002"
    MESSAGE_TOO_LARGE = "MSG003"

    # 配置错误 (CFG)
    CONFIG_INVALID = "CFG001"
    CONFIG_MISSING = "CFG002"
    CONFIG_DEPRECATED = "CFG003"

    # 未知错误
    UNKNOWN = "UNKNOWN"


class FeishuBridgeError(Exception):
    """飞书桥接器基础异常

    Attributes:
        message: 错误信息
        code: 错误代码
        details: 额外详情（可选）
    """

    def __init__(
        self,
        message: str,
        code: ErrorCode = ErrorCode.UNKNOWN,
        details: Optional[dict] = None,
    ):
        super().__init__(message)
        self.message = message
        self.code = code
        self.details = details or {}

    def __str__(self) -> str:
        if self.code != ErrorCode.UNKNOWN:
            return f"[{self.code.value}] {self.message}"
        return self.message


class TransientError(FeishuBridgeError):
    """可重试错误

    网络超时、临时不可用等可以通过重试解决的问题。
    """

    def __init__(
        self,
        message: str,
        code: ErrorCode = ErrorCode.UNKNOWN,
        details: Optional[dict] = None,
        retry_after: Optional[float] = None,
    ):
        super().__init__(message, code, details)
        self.retry_after = retry_after  # 建议重试等待时间（秒）


class PermanentError(FeishuBridgeError):
    """不可恢复错误

    配置错误、权限不足等无法通过重试解决的问题。
    """

    pass


class ValidationError(FeishuBridgeError):
    """验证错误

    输入参数验证失败。
    """

    pass
