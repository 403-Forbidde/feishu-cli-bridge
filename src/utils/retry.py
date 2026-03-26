"""指数退避重试机制

提供带指数退避的重试装饰器和函数，用于处理临时性错误。
"""

import asyncio
import functools
import logging
import random
from typing import Callable, TypeVar, Tuple, Type, Optional, Any

from .error_codes import TransientError, ErrorCode

T = TypeVar("T")
logger = logging.getLogger(__name__)


async def retry_with_backoff(
    func: Callable[[], Any],
    max_retries: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 30.0,
    retryable_exceptions: Tuple[Type[Exception], ...] = (Exception,),
    on_retry: Optional[Callable[[Exception, int, float], None]] = None,
    jitter: bool = True,
) -> Any:
    """指数退避重试

    使用指数退避策略重试函数调用，支持随机抖动避免 thundering herd。

    Args:
        func: 要重试的异步函数（无参数）
        max_retries: 最大重试次数（不含首次尝试）
        base_delay: 基础延迟（秒）
        max_delay: 最大延迟（秒）
        retryable_exceptions: 可重试的异常类型
        on_retry: 重试回调函数，参数为(异常, 尝试次数, 延迟时间)
        jitter: 是否添加随机抖动（0-25%）

    Returns:
        函数执行结果

    Raises:
        最后一次捕获的异常

    Example:
        >>> async def fetch_data():
        ...     return await http_client.get("/api/data")
        ...
        >>> result = await retry_with_backoff(
        ...     fetch_data,
        ...     max_retries=3,
        ...     retryable_exceptions=(httpx.NetworkError,)
        ... )
    """
    last_exception: Optional[Exception] = None

    for attempt in range(max_retries + 1):
        try:
            return await func()
        except retryable_exceptions as e:
            last_exception = e

            if attempt == max_retries:
                logger.warning(
                    f"重试耗尽 ({max_retries} 次)，放弃: {e}"
                )
                raise

            # 计算延迟：base * 2^attempt + jitter
            delay = min(base_delay * (2 ** attempt), max_delay)
            if jitter:
                delay *= (0.75 + random.random() * 0.25)

            if on_retry:
                try:
                    on_retry(e, attempt + 1, delay)
                except Exception:
                    pass

            logger.debug(f"第 {attempt + 1} 次失败，{delay:.2f}s 后重试: {e}")
            await asyncio.sleep(delay)

    # 不应该到达这里
    raise last_exception or RuntimeError("Unexpected retry loop exit")


def retry(
    max_retries: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 30.0,
    retryable_exceptions: Tuple[Type[Exception], ...] = (Exception,),
    jitter: bool = True,
) -> Callable:
    """重试装饰器

    为异步函数添加指数退避重试能力。

    Args:
        max_retries: 最大重试次数
        base_delay: 基础延迟（秒）
        max_delay: 最大延迟（秒）
        retryable_exceptions: 可重试的异常类型
        jitter: 是否添加随机抖动

    Example:
        >>> @retry(max_retries=3, retryable_exceptions=(httpx.NetworkError,))
        ... async def fetch_user(user_id: str) -> dict:
        ...     return await api.get_user(user_id)
    """
    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        @functools.wraps(func)
        async def wrapper(*args, **kwargs) -> T:
            async def _call() -> T:
                return await func(*args, **kwargs)

            return await retry_with_backoff(
                _call,
                max_retries=max_retries,
                base_delay=base_delay,
                max_delay=max_delay,
                retryable_exceptions=retryable_exceptions,
                jitter=jitter,
            )
        return wrapper
    return decorator


class RetryableOperation:
    """可重试操作封装

    用于需要精细控制重试逻辑的场景。

    Example:
        >>> op = RetryableOperation(
        ...     lambda: api.create_card(data),
        ...     max_retries=3,
        ...     retryable_exceptions=(httpx.HTTPStatusError,)
        ... )
        >>> result = await op.execute()
    """

    def __init__(
        self,
        func: Callable[[], Any],
        max_retries: int = 3,
        base_delay: float = 1.0,
        max_delay: float = 30.0,
        retryable_exceptions: Tuple[Type[Exception], ...] = (Exception,),
        jitter: bool = True,
    ):
        self.func = func
        self.max_retries = max_retries
        self.base_delay = base_delay
        self.max_delay = max_delay
        self.retryable_exceptions = retryable_exceptions
        self.jitter = jitter
        self.attempt_count = 0

    async def execute(self) -> Any:
        """执行操作，失败时自动重试"""
        self.attempt_count = 0

        for attempt in range(self.max_retries + 1):
            self.attempt_count = attempt + 1
            try:
                return await self.func()
            except self.retryable_exceptions as e:
                if attempt == self.max_retries:
                    raise TransientError(
                        f"操作失败，已重试 {self.max_retries} 次: {e}",
                        code=ErrorCode.NETWORK_TIMEOUT,
                    ) from e

                delay = min(self.base_delay * (2 ** attempt), self.max_delay)
                if self.jitter:
                    delay *= (0.75 + random.random() * 0.25)

                logger.debug(f"第 {attempt + 1} 次失败，{delay:.2f}s 后重试: {e}")
                await asyncio.sleep(delay)

        raise RuntimeError("Unexpected retry loop exit")


def is_retryable_error(error: Exception) -> bool:
    """判断错误是否值得重试

    Args:
        error: 异常对象

    Returns:
        是否值得重试
    """
    # 网络相关错误通常值得重试
    retryable_types = (
        "TimeoutError",
        "NetworkError",
        "ConnectError",
        "ReadError",
        "WriteError",
        "PoolTimeout",
    )

    error_type = type(error).__name__
    if error_type in retryable_types:
        return True

    # HTTP 状态码 429, 502, 503, 504 值得重试
    if hasattr(error, "response") and hasattr(error.response, "status_code"):
        status = error.response.status_code
        if status in (429, 502, 503, 504):
            return True

    return False
