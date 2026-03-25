"""卡片回调处理器

负责处理飞书卡片按钮点击回调（im.card.action.trigger_v1）。
"""

import logging
from typing import Dict, Optional, Any

logger = logging.getLogger(__name__)


class CardCallbackHandler:
    """卡片回调处理器"""

    def __init__(self, project_manager=None, adapters=None, api=None, tui_router=None):
        """
        初始化卡片回调处理器

        Args:
            project_manager: 项目管理器实例
            adapters: 适配器字典 {cli_type: adapter}
            api: FeishuAPI 实例
            tui_router: TUI 路由器实例
        """
        self.project_manager = project_manager
        self.adapters = adapters or {}
        self.api = api
        self.tui_router = tui_router

    async def handle(self, event_data: dict) -> dict:
        """
        处理卡片按钮点击回调

        Args:
            event_data: 卡片回调事件数据

        Returns:
            响应字典，可含 toast / update_card 字段
        """
        try:
            action = event_data.get("action", {})
            button_value = action.get("value", {})
            action_type = button_value.get("action")
            message_id = event_data.get("context", {}).get("open_message_id")

            logger.info(f"卡片回调: action={action_type}, message_id={message_id}")

            # 根据 action_type 分发到对应处理方法
            handler_map = {
                "switch_project": self._handle_switch_project,
                "delete_project_confirm": self._handle_delete_project_confirm,
                "delete_project_cancel": self._handle_delete_project_cancel,
                "delete_project_confirmed": self._handle_delete_project_confirmed,
                "switch_model": self._handle_switch_model,
                "switch_mode": self._handle_switch_mode,
                "test_card_action": self._handle_test_card_action,
                "create_new_session": self._handle_create_new_session,
                "switch_session": self._handle_switch_session,
                "list_sessions": self._handle_list_sessions,
                "rename_session_prompt": self._handle_rename_session_prompt,
                "delete_session_confirm": self._handle_delete_session_confirm,
                "delete_session_cancel": self._handle_delete_session_cancel,
                "delete_session_confirmed": self._handle_delete_session_confirmed,
            }

            handler = handler_map.get(action_type)
            if handler:
                return await handler(event_data, button_value, message_id)

            logger.warning(f"未知卡片回调 action: {action_type}")
            return self._error_toast("未知操作")

        except Exception as e:
            logger.exception("处理卡片回调异常")
            return self._error_toast(f"处理失败: {e}")

    # ==================== 项目相关回调 ====================

    async def _handle_switch_project(
        self, event_data: dict, button_value: dict, message_id: str
    ) -> dict:
        """处理切换项目"""
        if not self.project_manager:
            return self._error_toast("项目管理功能未启用")

        project_name = button_value.get("project_name")
        if not project_name:
            return self._error_toast("未指定项目")

        try:
            from ..project.models import ProjectError
            from .card_builder import build_project_list_card

            project = await self.project_manager.switch_project(project_name)
            logger.info(f"卡片回调切换项目成功: {project_name}")

            # 构建更新后的项目列表卡片
            projects = await self.project_manager.list_projects()
            updated_card = build_project_list_card(projects, project.name)

            return {
                "toast": {
                    "type": "success",
                    "content": f"✅ 已切换到: {project.display_name}",
                    "i18n": {"zh_cn": f"✅ 已切换到: {project.display_name}"},
                },
                "update_card": {
                    "message_id": message_id,
                    "card": updated_card,
                },
            }
        except ProjectError as e:
            return self._error_toast(e.message)

    async def _handle_delete_project_confirm(
        self, event_data: dict, button_value: dict, message_id: str
    ) -> dict:
        """处理删除项目确认（第一步）"""
        if not self.project_manager:
            return self._error_toast("项目管理功能未启用")

        project_name = button_value.get("project_name")
        if not project_name:
            return self._error_toast("未指定项目")

        from .card_builder import build_project_list_card

        projects = await self.project_manager.list_projects()
        current = await self.project_manager.get_current_project()
        current_name = current.name if current else None
        updated_card = build_project_list_card(
            projects, current_name, confirming_project=project_name
        )

        return {
            "toast": {
                "type": "warning",
                "content": f"⚠️ 确认删除项目 {project_name}？",
                "i18n": {"zh_cn": f"⚠️ 确认删除项目 {project_name}？"},
            },
            "update_card": {"message_id": message_id, "card": updated_card},
        }

    async def _handle_delete_project_cancel(
        self, event_data: dict, button_value: dict, message_id: str
    ) -> dict:
        """处理取消删除项目"""
        if not self.project_manager:
            return self._error_toast("项目管理功能未启用")

        from .card_builder import build_project_list_card

        projects = await self.project_manager.list_projects()
        current = await self.project_manager.get_current_project()
        current_name = current.name if current else None
        updated_card = build_project_list_card(projects, current_name)

        return {
            "toast": {
                "type": "info",
                "content": "已取消删除",
                "i18n": {"zh_cn": "已取消删除"},
            },
            "update_card": {"message_id": message_id, "card": updated_card},
        }

    async def _handle_delete_project_confirmed(
        self, event_data: dict, button_value: dict, message_id: str
    ) -> dict:
        """处理确认删除项目"""
        if not self.project_manager:
            return self._error_toast("项目管理功能未启用")

        project_name = button_value.get("project_name")
        if not project_name:
            return self._error_toast("未指定项目")

        try:
            from ..project.models import ProjectError
            from .card_builder import build_project_list_card

            project = await self.project_manager.get_project(project_name)
            display_name = project.display_name if project else project_name
            await self.project_manager.remove_project(project_name)
            logger.info(f"卡片回调删除项目成功: {project_name}")

            projects = await self.project_manager.list_projects()
            current = await self.project_manager.get_current_project()
            current_name = current.name if current else None
            updated_card = build_project_list_card(projects, current_name)

            return {
                "toast": {
                    "type": "success",
                    "content": f"✅ 已删除项目: {display_name}",
                    "i18n": {"zh_cn": f"✅ 已删除项目: {display_name}"},
                },
                "update_card": {
                    "message_id": message_id,
                    "card": updated_card,
                },
            }
        except ProjectError as e:
            return self._error_toast(e.message)

    # ==================== 模型相关回调 ====================

    async def _handle_switch_model(
        self, event_data: dict, button_value: dict, message_id: str
    ) -> dict:
        """处理切换模型"""
        model_id = button_value.get("model_id")
        cli_type = button_value.get("cli_type", "opencode")

        if not model_id:
            return self._error_toast("未指定模型")

        adapter = self.adapters.get(cli_type)
        if not adapter or not hasattr(adapter, "switch_model"):
            return self._error_toast("适配器不支持模型切换")

        await adapter.switch_model(model_id)
        logger.info(f"卡片回调切换模型成功: {model_id}")

        # 重绘卡片，高亮新选中的模型
        models = await adapter.list_models()
        from .card_builder import build_model_select_card

        updated_card = build_model_select_card(models, model_id, cli_type=cli_type)
        model_name = next(
            (m.get("name", model_id) for m in models if m.get("full_id") == model_id),
            model_id,
        )

        return {
            "toast": {
                "type": "success",
                "content": f"✅ 已切换到: {model_name}",
                "i18n": {"zh_cn": f"✅ 已切换到: {model_name}"},
            },
            "update_card": {
                "message_id": message_id,
                "card": updated_card,
            },
        }

    # ==================== Agent 模式相关回调 ====================

    async def _handle_switch_mode(
        self, event_data: dict, button_value: dict, message_id: str
    ) -> dict:
        """处理切换 Agent 模式"""
        agent_id = button_value.get("agent_id")
        cli_type = button_value.get("cli_type", "opencode")

        if not agent_id:
            return self._error_toast("未指定 agent")

        adapter = self.adapters.get(cli_type)
        if not adapter or not hasattr(adapter, "switch_agent"):
            return self._error_toast("适配器不支持模式切换")

        await adapter.switch_agent(agent_id)
        logger.info(f"卡片回调切换 agent 成功: {agent_id}")

        # 重绘卡片，高亮新选中的 agent
        agents = await adapter.list_agents()
        from .card_builder import build_mode_select_card

        updated_card = build_mode_select_card(agents, agent_id, cli_type=cli_type)

        return {
            "toast": {
                "type": "success",
                "content": f"✅ 已切换到: {agent_id}",
                "i18n": {"zh_cn": f"✅ 已切换到: {agent_id}"},
            },
            "update_card": {
                "message_id": message_id,
                "card": updated_card,
            },
        }

    # ==================== 测试卡片相关回调 ====================

    async def _handle_test_card_action(
        self, event_data: dict, button_value: dict, message_id: str
    ) -> dict:
        """处理测试卡片交互"""
        sub_action = button_value.get("sub_action")
        logger.info(f"测试卡片回调: sub_action={sub_action}, message_id={message_id}")

        from .card_builder import (
            build_test_card_v2_details,
            build_test_card_v2_data,
            build_test_card_v2_closed,
        )

        if sub_action == "show_details":
            updated_card = build_test_card_v2_details()
            return {
                "toast": {
                    "type": "success",
                    "content": "✅ 已切换到详情视图",
                    "i18n": {"zh_cn": "✅ 已切换到详情视图"},
                },
                "update_card": {
                    "message_id": message_id,
                    "card": updated_card,
                },
            }

        elif sub_action == "show_data":
            updated_card = build_test_card_v2_data()
            return {
                "toast": {
                    "type": "success",
                    "content": "✅ 已切换到数据视图",
                    "i18n": {"zh_cn": "✅ 已切换到数据视图"},
                },
                "update_card": {
                    "message_id": message_id,
                    "card": updated_card,
                },
            }

        elif sub_action == "close_test":
            updated_card = build_test_card_v2_closed()
            return {
                "toast": {
                    "type": "success",
                    "content": "✅ 测试已完成",
                    "i18n": {"zh_cn": "✅ 测试已完成"},
                },
                "update_card": {
                    "message_id": message_id,
                    "card": updated_card,
                },
            }

        return self._error_toast("未知操作")

    # ==================== 会话相关回调 ====================

    async def _handle_create_new_session(
        self, event_data: dict, button_value: dict, message_id: str
    ) -> dict:
        """处理创建新会话"""
        cli_type = button_value.get("cli_type", "opencode")
        adapter = self.adapters.get(cli_type)

        if not adapter or not hasattr(adapter, "create_new_session"):
            return self._error_toast("适配器不支持创建新会话")

        try:
            # 优先使用按钮中传递的 working_dir
            working_dir = button_value.get("working_dir", "")
            if not working_dir and self.project_manager:
                current_project = await self.project_manager.get_current_project()
                working_dir = str(current_project.path) if current_project else ""

            new_session = await adapter.create_new_session(working_dir=working_dir)
            new_session_id = new_session.get("id", "") if new_session else ""
            logger.info(f"卡片回调创建新会话成功: {new_session_id}")

            # 刷新会话列表卡片
            session_data_list = await self._build_session_data_list(
                adapter, working_dir, new_session_id
            )

            from .card_builder import build_session_list_card

            updated_card = build_session_list_card(
                sessions=session_data_list,
                current_session_id=new_session_id,
                cli_type=cli_type,
                working_dir=working_dir,
            )

            return {
                "toast": {
                    "type": "success",
                    "content": "✅ 已创建新会话",
                    "i18n": {"zh_cn": "✅ 已创建新会话"},
                },
                "update_card": {
                    "message_id": message_id,
                    "card": updated_card,
                },
            }
        except Exception as e:
            logger.exception("创建新会话失败")
            return self._error_toast(f"创建失败: {str(e)}")

    async def _handle_switch_session(
        self, event_data: dict, button_value: dict, message_id: str
    ) -> dict:
        """处理切换会话"""
        session_id = button_value.get("session_id")
        cli_type = button_value.get("cli_type", "opencode")
        working_dir = button_value.get("working_dir", "")

        if not session_id:
            return self._error_toast("未指定会话ID")

        adapter = self.adapters.get(cli_type)
        if not adapter or not hasattr(adapter, "switch_session"):
            return self._error_toast("适配器不支持切换会话")

        try:
            # 使用按钮中传递的 working_dir
            if not working_dir and self.project_manager:
                current_project = await self.project_manager.get_current_project()
                working_dir = str(current_project.path) if current_project else ""

            # 直接使用 session_id 进行切换
            success = await adapter.switch_session(session_id, working_dir)
            if success:
                logger.info(f"卡片回调切换会话成功: {session_id}")

                # 刷新会话列表卡片
                session_data_list = await self._build_session_data_list(
                    adapter, working_dir, session_id
                )

                from .card_builder import build_session_list_card

                updated_card = build_session_list_card(
                    sessions=session_data_list,
                    current_session_id=session_id,
                    cli_type=cli_type,
                    working_dir=working_dir,
                )

                return {
                    "toast": {
                        "type": "success",
                        "content": "✅ 已切换会话",
                        "i18n": {"zh_cn": "✅ 已切换会话"},
                    },
                    "update_card": {
                        "message_id": message_id,
                        "card": updated_card,
                    },
                }
            else:
                return self._error_toast("切换会话失败")
        except Exception as e:
            logger.exception("切换会话失败")
            return self._error_toast(f"切换失败: {str(e)}")

    async def _handle_list_sessions(
        self, event_data: dict, button_value: dict, message_id: str
    ) -> dict:
        """处理刷新会话列表"""
        cli_type = button_value.get("cli_type", "opencode")

        try:
            adapter = self.adapters.get(cli_type)
            working_dir = ""
            current_session_id = ""

            if adapter and hasattr(adapter, "get_session_id"):
                if self.project_manager:
                    current_project = await self.project_manager.get_current_project()
                    working_dir = str(current_project.path) if current_project else ""
                current_session_id = adapter.get_session_id(working_dir) or ""

            session_data_list = await self._build_session_data_list(
                adapter, working_dir, current_session_id
            )

            from .card_builder import build_session_list_card

            updated_card = build_session_list_card(
                sessions=session_data_list,
                current_session_id=current_session_id,
                cli_type=cli_type,
                working_dir=working_dir,
            )

            return {
                "toast": {
                    "type": "success",
                    "content": "✅ 已刷新会话列表",
                    "i18n": {"zh_cn": "✅ 已刷新会话列表"},
                },
                "update_card": {
                    "message_id": message_id,
                    "card": updated_card,
                },
            }
        except Exception as e:
            logger.exception("刷新会话列表失败")
            return self._error_toast(f"刷新失败: {str(e)}")

    async def _handle_rename_session_prompt(
        self, event_data: dict, button_value: dict, message_id: str
    ) -> dict:
        """处理重命名会话提示"""
        session_id = button_value.get("session_id", "")
        session_title = button_value.get("session_title", "")
        cli_type = button_value.get("cli_type", "opencode")
        working_dir = button_value.get("working_dir", "")

        # 从 event_data 提取 chat_id 和 user_id
        chat_id = event_data.get("context", {}).get("open_chat_id", "")
        user_id = event_data.get("open_id", "")

        if not session_id:
            return self._error_toast("未指定会话ID")

        if not chat_id:
            return self._error_toast("无法获取聊天ID")

        if not self.api or not self.tui_router:
            return self._error_toast("功能未启用")

        # 发送提示消息，并注册为交互式消息
        display_id = session_id[-8:] if len(session_id) >= 8 else session_id
        prompt_text = (
            f"📝 **重命名会话**\n\n"
            f"会话ID：`{display_id}`\n"
            f"当前名称：{session_title or '未命名会话'}\n\n"
            f"请直接回复新的会话名称（不超过50字）："
        )

        from .card_builder import build_card_content

        card_data = build_card_content(
            "complete",
            {"text": prompt_text, "metadata": {}},
        )
        msg_id = await self.api.send_card_message(chat_id, card_data)

        if msg_id:
            self.tui_router.register_interactive(
                message_id=msg_id,
                interactive_id="rename_session",
                user_id=user_id,
                chat_id=chat_id,
                cli_type=cli_type,
                metadata={
                    "session_id": session_id,
                    "working_dir": working_dir,
                    "cli_type": cli_type,
                },
            )

        return {
            "toast": {"type": "info", "content": "请回复新名称", "i18n": {"zh_cn": "请回复新名称"}}
        }

    async def _handle_delete_session_confirm(
        self, event_data: dict, button_value: dict, message_id: str
    ) -> dict:
        """处理删除会话确认"""
        session_id = button_value.get("session_id", "")
        cli_type = button_value.get("cli_type", "opencode")

        if not session_id:
            return self._error_toast("未指定会话ID")

        adapter = self.adapters.get(cli_type)
        working_dir_override = button_value.get("working_dir", "")
        working_dir = working_dir_override
        current_session_id = ""

        if adapter and hasattr(adapter, "get_session_id"):
            if not working_dir and self.project_manager:
                current_project = await self.project_manager.get_current_project()
                working_dir = str(current_project.path) if current_project else ""
            current_session_id = adapter.get_session_id(working_dir) or ""

        session_data_list = await self._build_session_data_list(
            adapter, working_dir, current_session_id
        )

        from .card_builder import build_session_list_card

        updated_card = build_session_list_card(
            sessions=session_data_list,
            current_session_id=current_session_id,
            cli_type=cli_type,
            deleting_session_id=session_id,
            working_dir=working_dir,
        )

        return {
            "toast": {"type": "warning", "content": "⚠️ 确认删除会话？", "i18n": {"zh_cn": "⚠️ 确认删除会话？"}},
            "update_card": {"message_id": message_id, "card": updated_card},
        }

    async def _handle_delete_session_cancel(
        self, event_data: dict, button_value: dict, message_id: str
    ) -> dict:
        """处理取消删除会话"""
        cli_type = button_value.get("cli_type", "opencode")
        adapter = self.adapters.get(cli_type)

        working_dir = ""
        current_session_id = ""

        if adapter and hasattr(adapter, "get_session_id"):
            if self.project_manager:
                current_project = await self.project_manager.get_current_project()
                working_dir = str(current_project.path) if current_project else ""
            current_session_id = adapter.get_session_id(working_dir) or ""

        session_data_list = await self._build_session_data_list(
            adapter, working_dir, current_session_id
        )

        from .card_builder import build_session_list_card

        updated_card = build_session_list_card(
            sessions=session_data_list,
            current_session_id=current_session_id,
            cli_type=cli_type,
            working_dir=working_dir,
        )

        return {
            "toast": {"type": "info", "content": "已取消删除", "i18n": {"zh_cn": "已取消删除"}},
            "update_card": {"message_id": message_id, "card": updated_card},
        }

    async def _handle_delete_session_confirmed(
        self, event_data: dict, button_value: dict, message_id: str
    ) -> dict:
        """处理确认删除会话"""
        session_id = button_value.get("session_id", "")
        cli_type = button_value.get("cli_type", "opencode")

        if not session_id:
            return self._error_toast("未指定会话ID")

        adapter = self.adapters.get(cli_type)
        if not adapter or not hasattr(adapter, "delete_session"):
            return self._error_toast("适配器不支持删除会话")

        working_dir = ""
        if self.project_manager:
            current_project = await self.project_manager.get_current_project()
            working_dir = str(current_project.path) if current_project else ""

        success = await adapter.delete_session(session_id)
        if not success:
            return self._error_toast("删除会话失败")

        current_session_id = ""
        if hasattr(adapter, "get_session_id"):
            current_session_id = adapter.get_session_id(working_dir) or ""

        session_data_list = await self._build_session_data_list(
            adapter, working_dir, current_session_id
        )

        from .card_builder import build_session_list_card

        updated_card = build_session_list_card(
            sessions=session_data_list,
            current_session_id=current_session_id,
            cli_type=cli_type,
            working_dir=working_dir,
        )

        return {
            "toast": {"type": "success", "content": "✅ 已删除会话", "i18n": {"zh_cn": "✅ 已删除会话"}},
            "update_card": {"message_id": message_id, "card": updated_card},
        }

    # ==================== 辅助方法 ====================

    async def _build_session_data_list(
        self, adapter, working_dir: str, current_session_id: str
    ) -> list:
        """构建会话数据列表"""
        session_data_list = []
        if adapter and hasattr(adapter, "list_sessions"):
            all_sessions = await adapter.list_sessions(limit=20)
            for session in [s for s in all_sessions if s.get("directory") == str(working_dir)]:
                sid = session.get("id", "")
                slug = session.get("slug", "")
                display_id = slug if slug else sid[-8:] if len(sid) >= 8 else sid
                session_data_list.append({
                    "session_id": sid,
                    "display_id": display_id,
                    "title": session.get("title", "未命名会话"),
                    "created_at": session.get("created_at", 0),
                    "updated_at": session.get("updated_at", 0),
                    "is_current": sid == current_session_id,
                })
        return session_data_list

    def _error_toast(self, message: str) -> dict:
        """构建错误 toast 响应"""
        return {
            "toast": {
                "type": "error",
                "content": message,
                "i18n": {"zh_cn": message},
            }
        }
