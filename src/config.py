"""配置管理模块"""

import os
import sys
import yaml
from dataclasses import dataclass, field
from typing import Dict, Optional
from pathlib import Path


@dataclass
class FeishuConfig:
    app_id: str = ""
    app_secret: str = ""
    encrypt_key: str = ""
    verification_token: str = ""


@dataclass
class SessionConfig:
    max_sessions: int = 10
    max_history: int = 20
    storage_dir: str = ""  # 已弃用：v0.1.7+ 会话管理完全委托 OpenCode 服务器


@dataclass
class CLIConfig:
    enabled: bool = True
    command: str = ""
    default_model: str = ""
    timeout: int = 300
    models: list = field(default_factory=list)  # 常用模型列表，每项为 "provider/model" 或 {id, name}


@dataclass
class StreamingConfig:
    update_interval: float = 0.3
    min_chunk_size: int = 20
    max_message_length: int = 8000


@dataclass
class DebugConfig:
    log_level: str = "INFO"
    save_logs: bool = True
    log_dir: str = ""  # 留空则使用 <config_dir>/logs/


@dataclass
class ProjectConfig:
    storage_path: str = ""  # 留空则使用默认 ~/.config/cli-feishu-bridge/projects.json
    max_projects: int = 50


@dataclass
class Config:
    feishu: FeishuConfig = field(default_factory=FeishuConfig)
    session: SessionConfig = field(default_factory=SessionConfig)
    cli: Dict[str, CLIConfig] = field(default_factory=dict)
    streaming: StreamingConfig = field(default_factory=StreamingConfig)
    debug: DebugConfig = field(default_factory=DebugConfig)
    project: ProjectConfig = field(default_factory=ProjectConfig)


# 已加载的配置文件路径（用于相对路径解析）
_config_path: Optional[Path] = None


def get_config_dir() -> Path:
    """返回配置文件所在目录，用于解析相对路径。
    未找到配置文件时回退到当前工作目录。
    """
    if _config_path is not None:
        return _config_path.parent
    return Path.cwd()


def _find_config_file() -> Optional[Path]:
    """按优先级查找配置文件：
    1. CONFIG_FILE 环境变量
    2. $XDG_CONFIG_HOME/cli-feishu-bridge/config.yaml（默认 ~/.config/...）
    3. ./config.yaml（当前工作目录，开发模式）
    """
    # 1. 显式环境变量
    env_path = os.environ.get("CONFIG_FILE")
    if env_path:
        p = Path(env_path).expanduser()
        if p.exists():
            return p

    # 2. 平台配置目录
    if sys.platform == 'win32':
        # Windows: %APPDATA%\cli-feishu-bridge\config.yaml
        appdata = Path(os.environ.get('APPDATA', Path.home())).expanduser()
        win_config = appdata / "cli-feishu-bridge" / "config.yaml"
        if win_config.exists():
            return win_config
    else:
        # Linux/macOS: XDG_CONFIG_HOME (~/.config)
        config_home = Path(os.environ.get("XDG_CONFIG_HOME", "~/.config")).expanduser()
        xdg_config = config_home / "cli-feishu-bridge" / "config.yaml"
        if xdg_config.exists():
            return xdg_config

    # 3. 当前工作目录（开发模式）
    cwd_config = Path("config.yaml")
    if cwd_config.exists():
        return cwd_config

    return None


def load_config(config_path: Optional[str] = None) -> Config:
    """加载配置文件"""
    global _config_path

    if config_path is not None:
        config_file: Optional[Path] = Path(config_path).expanduser()
    else:
        config_file = _find_config_file()

    if config_file is None or not config_file.exists():
        # 没有找到配置文件，从环境变量加载
        _config_path = None
        return _load_from_env()

    _config_path = config_file.resolve()

    with open(config_file, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)

    return _parse_config(data)


def _load_from_env() -> Config:
    """从环境变量加载配置"""
    return Config(
        feishu=FeishuConfig(
            app_id=os.getenv("FEISHU_APP_ID", ""),
            app_secret=os.getenv("FEISHU_APP_SECRET", ""),
            encrypt_key=os.getenv("FEISHU_ENCRYPT_KEY", ""),
            verification_token=os.getenv("FEISHU_VERIFICATION_TOKEN", ""),
        ),
        session=SessionConfig(
            max_sessions=int(os.getenv("MAX_SESSIONS", "15")),
            max_history=int(os.getenv("MAX_HISTORY", "20")),
            storage_dir=os.getenv("SESSION_DIR", ""),  # 已弃用：v0.1.7+ 不再本地存储会话
        ),
        cli={
            "opencode": CLIConfig(
                enabled=os.getenv("OPENCODE_ENABLED", "true").lower() == "true",
                command=os.getenv("OPENCODE_CMD", "opencode"),
                default_model=os.getenv("OPENCODE_MODEL", "gpt-4"),
                timeout=int(os.getenv("OPENCODE_TIMEOUT", "300")),
            ),
            "codex": CLIConfig(
                enabled=os.getenv("CODEX_ENABLED", "false").lower() == "true",
                command=os.getenv("CODEX_CMD", "codex"),
                default_model=os.getenv("CODEX_MODEL", "gpt-5-codex"),
                timeout=int(os.getenv("CODEX_TIMEOUT", "300")),
            ),
        },
        streaming=StreamingConfig(
            update_interval=float(os.getenv("STREAM_INTERVAL", "0.3")),
            min_chunk_size=int(os.getenv("MIN_CHUNK_SIZE", "20")),
            max_message_length=int(os.getenv("MAX_MSG_LENGTH", "8000")),
        ),
        debug=DebugConfig(
            log_level=os.getenv("LOG_LEVEL", "INFO"),
            save_logs=os.getenv("SAVE_LOGS", "true").lower() == "true",
            log_dir=os.getenv("LOG_DIR", ""),
        ),
        project=ProjectConfig(
            storage_path=os.getenv("PROJECT_STORAGE_PATH", ""),
            max_projects=int(os.getenv("MAX_PROJECTS", "50")),
        ),
    )


def _parse_config(data: dict) -> Config:
    """解析配置字典"""
    feishu_data = data.get("feishu", {})
    session_data = data.get("session", {})
    cli_data = data.get("cli", {})
    streaming_data = data.get("streaming", {})
    debug_data = data.get("debug", {})
    project_data = data.get("project", {})

    cli_configs = {}
    for name, c in cli_data.items():
        cli_configs[name] = CLIConfig(
            enabled=c.get("enabled", True),
            command=c.get("command", name),
            default_model=c.get("default_model", ""),
            timeout=c.get("timeout", 300),
            models=c.get("models", []),
        )

    return Config(
        feishu=FeishuConfig(
            app_id=feishu_data.get("app_id", ""),
            app_secret=feishu_data.get("app_secret", ""),
            encrypt_key=feishu_data.get("encrypt_key", ""),
            verification_token=feishu_data.get("verification_token", ""),
        ),
        session=SessionConfig(
            max_sessions=session_data.get("max_sessions", 15),
            max_history=session_data.get("max_history", 20),
            storage_dir=session_data.get("storage_dir", ""),  # 已弃用：v0.1.7+ 不再本地存储会话
        ),
        cli=cli_configs,
        streaming=StreamingConfig(
            update_interval=streaming_data.get("update_interval", 0.3),
            min_chunk_size=streaming_data.get("min_chunk_size", 20),
            max_message_length=streaming_data.get("max_message_length", 8000),
        ),
        debug=DebugConfig(
            log_level=debug_data.get("log_level", "INFO"),
            save_logs=debug_data.get("save_logs", True),
            log_dir=debug_data.get("log_dir", ""),
        ),
        project=ProjectConfig(
            storage_path=project_data.get("storage_path", ""),
            max_projects=project_data.get("max_projects", 50),
        ),
    )


# 全局配置实例
_config: Optional[Config] = None


def get_config() -> Config:
    """获取全局配置"""
    global _config
    if _config is None:
        _config = load_config()
    return _config
