"""主程序入口"""
import asyncio
import logging
import signal
import sys
from pathlib import Path

from .config import load_config, get_config, get_config_dir
from .utils.logger import setup_logger
from .feishu import FeishuClient, FeishuAPI, MessageHandler
from .project import ProjectManager

async def main():
    """主函数"""
    # 在运行中的事件循环内创建 Event，避免 Python 3.9 跨循环问题
    shutdown_event = asyncio.Event()

    # 加载配置
    config = get_config()

    # 解析路径（相对路径基于配置文件目录，支持服务模式）
    config_dir = get_config_dir()

    # 会话存储目录（v0.1.7+ 已弃用，使用 OpenCode 服务器管理会话）
    storage_dir_str = config.session.storage_dir
    if storage_dir_str:
        storage_dir = Path(storage_dir_str)
        if not storage_dir.is_absolute():
            storage_dir = config_dir / storage_dir
        # 创建会话存储目录（仅当配置了存储目录时）
        storage_dir.mkdir(parents=True, exist_ok=True)
        config.session.storage_dir = str(storage_dir)
    else:
        storage_dir = None  # v0.1.7+ 不使用本地会话存储

    if config.debug.log_dir:
        log_dir: Path = Path(config.debug.log_dir).expanduser()
        if not log_dir.is_absolute():
            log_dir = config_dir / log_dir
    else:
        log_dir = config_dir / "logs"

    # 设置日志
    logger = setup_logger(
        level=config.debug.log_level,
        save_logs=config.debug.save_logs,
        log_dir=log_dir,
    )

    logger.info("=" * 50)
    logger.info("Feishu CLI Bridge 启动中...")
    logger.info(f"配置目录: {config_dir}")
    logger.info(f"日志级别: {config.debug.log_level}")
    logger.info(f"最大会话数: {config.session.max_sessions}")
    logger.info("=" * 50)
    
    # 检查配置
    if not config.feishu.app_id or not config.feishu.app_secret:
        logger.error("❌ 飞书配置不完整！请检查 config.yaml 或环境变量")
        logger.error("需要: FEISHU_APP_ID 和 FEISHU_APP_SECRET")
        sys.exit(1)
    
    # 检查可用的 CLI 工具
    import shutil
    available_clis = []
    for cli_type, cli_config in config.cli.items():
        if cli_config.enabled:
            if shutil.which(cli_config.command):
                available_clis.append(cli_type)
                logger.info(f"✅ CLI 工具可用: {cli_type} ({cli_config.command})")
            else:
                logger.warning(f"⚠️ CLI 工具未安装: {cli_type} ({cli_config.command})")
    
    if not available_clis:
        logger.error("❌ 没有可用的 CLI 工具！请至少安装一个：opencode 或 codex")
        sys.exit(1)

    # v0.1.7+ 会话管理委托给 OpenCode 服务器，不再使用本地存储
    
    # 创建飞书 API 客户端
    feishu_api = FeishuAPI(
        app_id=config.feishu.app_id,
        app_secret=config.feishu.app_secret
    )

    # 创建项目管理器
    project_manager = ProjectManager(
        config_path=Path(config.project.storage_path) if config.project.storage_path else None,
        max_projects=config.project.max_projects,
    )
    logger.info(f"项目管理器已启动，当前项目: {project_manager.current_project_name or '无'}")

    # 创建消息处理器
    handler = MessageHandler(config, feishu_api, project_manager=project_manager)
    
    # 创建飞书 WebSocket 客户端
    feishu_client = FeishuClient(
        app_id=config.feishu.app_id,
        app_secret=config.feishu.app_secret,
        encrypt_key=config.feishu.encrypt_key,
        verification_token=config.feishu.verification_token
    )
    feishu_client.on_message(handler.handle_message)
    feishu_client.on_card_callback(handler.handle_card_callback)
    
    # 设置信号处理
    def signal_handler(sig, frame):
        logger.info("\n收到退出信号，正在关闭...")
        shutdown_event.set()
    
    signal.signal(signal.SIGINT, signal_handler)
    if hasattr(signal, 'SIGTERM'):  # Windows 无 SIGTERM
        signal.signal(signal.SIGTERM, signal_handler)
    
    try:
        # 启动飞书客户端
        logger.info("🚀 正在连接飞书...")
        
        # 使用 asyncio 运行 WebSocket 客户端
        client_task = asyncio.create_task(feishu_client.start())
        
        # 等待关闭信号
        await shutdown_event.wait()
        
        # 取消客户端任务
        client_task.cancel()
        try:
            await client_task
        except asyncio.CancelledError:
            pass
        
        await feishu_client.stop()
        logger.info("👋 已安全退出")
        
    except Exception as e:
        logger.exception(f"运行时错误: {e}")
        sys.exit(1)


def run():
    """入口函数"""
    # Python 3.11 及以下 Windows 需显式设置 ProactorEventLoop 以支持子进程
    # Python 3.12+ Windows 上已是默认值，无需设置
    if sys.platform == 'win32' and sys.version_info < (3, 12):
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n已中断")
    except Exception as e:
        print(f"错误: {e}")
        sys.exit(1)


if __name__ == "__main__":
    run()
