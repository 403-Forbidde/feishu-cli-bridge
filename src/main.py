"""主程序入口"""
import asyncio
import logging
import signal
import sys
from pathlib import Path

from .config import load_config, get_config
from .utils.logger import setup_logger
from .feishu import FeishuClient, FeishuAPI, MessageHandler

# 全局变量用于信号处理
shutdown_event = asyncio.Event()


async def main():
    """主函数"""
    # 加载配置
    config = get_config()
    
    # 设置日志
    logger = setup_logger(
        level=config.debug.log_level,
        save_logs=config.debug.save_logs
    )
    
    logger.info("=" * 50)
    logger.info("Feishu CLI Bridge 启动中...")
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
        logger.error("❌ 没有可用的 CLI 工具！请至少安装一个：opencode、claudecode 或 codex")
        sys.exit(1)
    
    # 创建会话存储目录
    Path(config.session.storage_dir).mkdir(exist_ok=True)
    
    # 创建飞书 API 客户端
    feishu_api = FeishuAPI(
        app_id=config.feishu.app_id,
        app_secret=config.feishu.app_secret
    )
    
    # 创建消息处理器
    handler = MessageHandler(config, feishu_api)
    
    # 创建飞书 WebSocket 客户端
    feishu_client = FeishuClient(
        app_id=config.feishu.app_id,
        app_secret=config.feishu.app_secret,
        encrypt_key=config.feishu.encrypt_key,
        verification_token=config.feishu.verification_token
    )
    feishu_client.on_message(handler.handle_message)
    
    # 设置信号处理
    def signal_handler(sig, frame):
        logger.info("\n收到退出信号，正在关闭...")
        shutdown_event.set()
    
    signal.signal(signal.SIGINT, signal_handler)
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
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n已中断")
    except Exception as e:
        print(f"错误: {e}")
        sys.exit(1)


if __name__ == "__main__":
    run()
