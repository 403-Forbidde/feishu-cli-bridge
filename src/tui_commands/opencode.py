"""OpenCode TUI 命令实现

实现 OpenCode CLI 专用的 TUI 命令。
"""

from typing import Any, Dict, List, Optional

from .base import TUIBaseCommand, TUIResult, CommandContext, TUIResultType


class OpenCodeTUICommands(TUIBaseCommand):
    """OpenCode TUI 命令实现类

    支持命令:
    - /new: 新建会话
    - /session: 列出会话
    - /model: 列出或切换模型
    - /reset: 重置当前会话
    """

    @property
    def supported_commands(self) -> List[str]:
        """返回支持的命令列表"""
        return ["new", "session", "model", "reset"]

    async def execute(
        self, command: str, args: Optional[str], context: CommandContext
    ) -> TUIResult:
        """执行 TUI 命令

        Args:
            command: 命令名称
            args: 命令参数
            context: 执行上下文

        Returns:
            TUIResult: 命令执行结果
        """
        if command == "new":
            return await self._handle_new(context)
        elif command == "session":
            return await self._handle_session(args, context)
        elif command == "model":
            return await self._handle_model(args, context)
        elif command == "reset":
            return await self._handle_reset(context)
        else:
            return TUIResult.error(f"未知命令: {command}")

    async def _handle_new(self, context: CommandContext) -> TUIResult:
        """处理 /new 命令 - 新建会话

        调用适配器创建新会话，返回新会话信息卡片。
        """
        try:
            # 调用适配器创建新会话
            if hasattr(self.adapter, "create_new_session"):
                session_info = await self.adapter.create_new_session()
                if session_info:
                    from ..feishu.card_builder import build_new_session_card
                    card = build_new_session_card(
                        session_id=session_info.get("id", ""),
                        session_title=session_info.get("title", "新会话"),
                        working_dir=context.working_dir,
                        model=context.current_model,
                        cli_type=context.cli_type,
                        project_name=context.project_name,
                        project_display_name=context.project_display_name,
                    )
                    return TUIResult.card("", metadata={"card_json": card})

            return TUIResult.error("创建会话失败: 适配器不支持 create_new_session")

        except Exception as e:
            if self.logger:
                self.logger.error(f"创建会话失败: {e}")
            return TUIResult.error(f"创建会话失败: {str(e)}")

    async def _handle_session(
        self, args: Optional[str], context: CommandContext
    ) -> TUIResult:
        """处理 /session 命令 - 列出或切换会话

        - 无参数: 列出最近 10 个会话
        - 有参数: 切换到指定会话
        """
        try:
            if args:
                # 切换会话
                return await self._switch_session(args, context)
            else:
                # 列出会话
                return await self._list_sessions(context)

        except Exception as e:
            if self.logger:
                self.logger.error(f"处理会话命令失败: {e}")
            return TUIResult.error(f"处理会话命令失败: {str(e)}")

    async def _list_sessions(self, context: CommandContext) -> TUIResult:
        """列出最近 10 个会话"""
        try:
            # 调用适配器获取会话列表
            if hasattr(self.adapter, "list_sessions"):
                sessions = await self.adapter.list_sessions(limit=10)

                if not sessions:
                    return TUIResult.text("ℹ️ 暂无历史会话")

                # 格式化会话列表
                content = self._format_session_list(sessions, context.session_id)

                # 创建交互式选项
                options = []
                for i, session in enumerate(sessions[:10], 1):
                    session_id = session.get("id", "")
                    display_id = self._generate_session_display_id(session_id)
                    options.append(
                        {
                            "label": f"{i}",
                            "value": session_id,
                            "display": display_id,
                        }
                    )

                return TUIResult.interactive(
                    content=content,
                    interactive_id="session_select",
                    options=options,
                    metadata={"command": "session", "sessions": sessions[:10]},
                )

            return TUIResult.error("列出会话失败: 适配器不支持 list_sessions")

        except Exception as e:
            if self.logger:
                self.logger.error(f"列出会话失败: {e}")
            return TUIResult.error(f"列出会话失败: {str(e)}")

    async def _switch_session(self, args: str, context: CommandContext) -> TUIResult:
        """切换到指定会话"""
        try:
            # 解析参数（可能是数字索引或会话ID）
            session_id = args.strip()

            # 如果是纯数字，可能是列表中的索引
            if session_id.isdigit():
                index = int(session_id) - 1  # 转换为0-based索引
                if hasattr(self.adapter, "list_sessions"):
                    sessions = await self.adapter.list_sessions(limit=10)
                    if 0 <= index < len(sessions):
                        session_id = sessions[index].get("id", "")
                    else:
                        return TUIResult.error(f"无效的会话索引: {session_id}")

            # 调用适配器切换会话
            if hasattr(self.adapter, "switch_session"):
                success = await self.adapter.switch_session(session_id)
                if success:
                    display_id = self._generate_session_display_id(session_id)
                    return TUIResult.text(
                        f"✅ **已切换到会话**\n\n"
                        f"**ID:** `{display_id}`\n"
                        f"💡 可以继续之前的对话了"
                    )
                else:
                    return TUIResult.error(f"切换会话失败: 会话不存在或无法访问")

            return TUIResult.error("切换会话失败: 适配器不支持 switch_session")

        except Exception as e:
            if self.logger:
                self.logger.error(f"切换会话失败: {e}")
            return TUIResult.error(f"切换会话失败: {str(e)}")

    async def _handle_model(
        self, args: Optional[str], context: CommandContext
    ) -> TUIResult:
        """处理 /model 命令 - 列出或切换模型

        - 无参数: 列出可用模型
        - 有参数: 切换到指定模型
        """
        try:
            if args:
                # 切换模型
                return await self._switch_model(args, context)
            else:
                # 列出模型
                return await self._list_models(context)

        except Exception as e:
            if self.logger:
                self.logger.error(f"处理模型命令失败: {e}")
            return TUIResult.error(f"处理模型命令失败: {str(e)}")

    async def _list_models(self, context: CommandContext) -> TUIResult:
        """列出可用模型"""
        try:
            # 调用适配器获取模型列表
            if hasattr(self.adapter, "list_models"):
                models = await self.adapter.list_models()

                if not models:
                    return TUIResult.text("ℹ️ 暂无可用模型")

                # 格式化模型列表
                content = self._format_model_list(models, context.current_model)

                # 创建交互式消息，支持回复模型ID切换
                return TUIResult.interactive(
                    content=content,
                    interactive_id="model_select",
                    options=[],  # 模型不需要选项列表，直接回复ID
                    metadata={"command": "model", "models": models},
                )

            return TUIResult.error("列出模型失败: 适配器不支持 list_models")

        except Exception as e:
            if self.logger:
                self.logger.error(f"列出模型失败: {e}")
            return TUIResult.error(f"列出模型失败: {str(e)}")

    async def _switch_model(self, args: str, context: CommandContext) -> TUIResult:
        """切换到指定模型"""
        try:
            model_id = args.strip()

            # 验证模型格式 (provider/model)
            if "/" not in model_id:
                return TUIResult.error(
                    f"模型 ID 格式错误，应为 provider/model 格式\n"
                    f"例如: opencode/mimo-v2, anthropic/claude-sonnet-4-20250514"
                )

            # 调用适配器切换模型
            if hasattr(self.adapter, "switch_model"):
                success = await self.adapter.switch_model(model_id)
                if success:
                    return TUIResult.text(
                        f"✅ **已切换到模型**\n\n"
                        f"**模型:** `{model_id}`\n"
                        f"💡 新消息将使用此模型"
                    )
                else:
                    return TUIResult.error(f"切换模型失败: 模型不可用")

            return TUIResult.error("切换模型失败: 适配器不支持 switch_model")

        except Exception as e:
            if self.logger:
                self.logger.error(f"切换模型失败: {e}")
            return TUIResult.error(f"切换模型失败: {str(e)}")

    async def _handle_reset(self, context: CommandContext) -> TUIResult:
        """处理 /reset 命令 - 重置当前会话"""
        try:
            # 调用适配器重置会话
            if hasattr(self.adapter, "reset_session"):
                success = await self.adapter.reset_session()
                if success:
                    return TUIResult.text(
                        f"✅ **已重置当前会话**\n\n"
                        f"🗑️ 对话历史已清空\n"
                        f"💡 可以开始新的对话了"
                    )
                else:
                    return TUIResult.error("重置会话失败")

            return TUIResult.error("重置会话失败: 适配器不支持 reset_session")

        except Exception as e:
            if self.logger:
                self.logger.error(f"重置会话失败: {e}")
            return TUIResult.error(f"重置会话失败: {str(e)}")

    async def handle_interactive_reply(
        self,
        interactive_id: str,
        reply: str,
        metadata: Dict[str, Any],
        context: CommandContext,
    ) -> TUIResult:
        """处理交互式消息的回复

        Args:
            interactive_id: 交互式消息 ID
            reply: 用户回复内容
            metadata: 原始消息的元数据
            context: 执行上下文

        Returns:
            TUIResult: 处理结果
        """
        if interactive_id == "session_select":
            # 处理会话选择回复
            return await self._switch_session(reply, context)
        elif interactive_id == "model_select":
            # 处理模型选择回复
            return await self._switch_model(reply, context)

        return TUIResult.error(f"未知的交互式消息: {interactive_id}")
