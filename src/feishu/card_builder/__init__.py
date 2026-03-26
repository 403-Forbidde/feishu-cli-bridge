"""飞书卡片构建工具

构建用于不同状态的飞书交互式卡片消息。

卡片格式：飞书交互式卡片 Schema 2.0（body.elements 结构）
流式打字机：通过 CardKit card.create + cardElement.content 实现
"""

# 常量（优先从新模块导入，后续阶段删除 core 导入）
from .constants import (
    STREAMING_ELEMENT_ID,
    REASONING_ELEMENT_ID,
)

# 工具函数（优先从新模块导入）
from .utils import (
    optimize_markdown_style,
    _format_elapsed,
    _format_reasoning_duration,
    _simplify_model_name,
)

# 核心卡片（从新模块导入）
from .base import (
    build_card_content,
)

# 会话相关卡片（从新模块导入）
from .session_cards import (
    build_new_session_card,
    build_session_list_card,
    build_session_info_card,
)

# 项目相关卡片（从新模块导入）
from .project_cards import (
    build_project_list_card,
    build_project_info_card,
)

# 交互式卡片（从新模块导入）
from .interactive_cards import (
    build_model_select_card,
    build_mode_select_card,
    build_help_card,
    build_reset_success_card,
    build_test_card_v2_initial,
    build_test_card_v2_details,
    build_test_card_v2_data,
    build_test_card_v2_closed,
)

__all__ = [
    # 常量
    "STREAMING_ELEMENT_ID",
    "REASONING_ELEMENT_ID",
    # 主入口
    "build_card_content",
    # 会话
    "build_new_session_card",
    "build_session_list_card",
    "build_session_info_card",
    # 项目
    "build_project_list_card",
    "build_project_info_card",
    # 模型/模式
    "build_model_select_card",
    "build_mode_select_card",
    # 帮助/重置
    "build_help_card",
    "build_reset_success_card",
    # 测试卡片
    "build_test_card_v2_initial",
    "build_test_card_v2_details",
    "build_test_card_v2_data",
    "build_test_card_v2_closed",
    # 工具函数
    "optimize_markdown_style",
    "_format_elapsed",
    "_format_reasoning_duration",
    "_simplify_model_name",
]
