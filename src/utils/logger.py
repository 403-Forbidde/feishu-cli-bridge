"""日志工具"""
import logging
import sys
from pathlib import Path
from datetime import datetime
from typing import Optional, Union
from rich.logging import RichHandler


def setup_logger(
    name: str = "feishu_cli_bridge",
    level: str = "INFO",
    save_logs: bool = True,
    log_dir: Optional[Union[str, Path]] = None,
) -> logging.Logger:
    """设置日志记录器

    Args:
        log_dir: 日志目录，None 时使用当前目录下的 logs/
    """
    logger = logging.getLogger(name)
    logger.setLevel(getattr(logging, level.upper()))

    # 避免重复添加处理器
    if logger.handlers:
        return logger

    # Rich 控制台处理器（美观输出）
    console_handler = RichHandler(
        rich_tracebacks=True,
        show_time=True,
        show_path=False
    )
    console_handler.setLevel(logging.DEBUG)
    console_format = logging.Formatter("%(message)s")
    console_handler.setFormatter(console_format)
    logger.addHandler(console_handler)

    # 文件处理器
    if save_logs:
        log_path = Path(log_dir) if log_dir else Path("logs")
        log_path.mkdir(parents=True, exist_ok=True)

        log_file = log_path / f"{datetime.now().strftime('%Y%m%d')}.log"
        file_handler = logging.FileHandler(log_file, encoding='utf-8')
        file_handler.setLevel(logging.DEBUG)
        file_format = logging.Formatter(
            "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
        )
        file_handler.setFormatter(file_format)
        logger.addHandler(file_handler)
    
    return logger
