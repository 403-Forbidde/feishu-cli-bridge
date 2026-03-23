"""OpenCode TUI 命令实现 (v0.3.0)

实现 OpenCode CLI 专用的 TUI 命令。
从 v0.3.0 开始，会话管理完全委托给 OpenCode 服务器：
- /session: 直接从 OpenCode 获取会话列表，按当前项目 directory 过滤
- /new: 在 OpenCode 创建新会话
- /session rename: 调用 OpenCode API 重命名
- /session delete: 调用 OpenCode API 删除
本地不再保留任何会话映射文件。
"""

from typing import Any, Dict, List, Optional

from .base import TUIBaseCommand, TUIResult, CommandContext, TUIResultType


class OpenCodeTUICommands(TUIBaseCommand):
    """OpenCode TUI 命令实现类

    支持命令:
    - /new: 新建会话（在 OpenCode 创建）
    - /session: 列出当前项目的会话（从 OpenCode 获取，按 directory 过滤）
    - /session rename <ID> <名称>: 重命名会话
    - /session delete <ID>: 删除会话
    - /model: 列出或切换模型
    - /mode: 列出或切换 agent 模式
    - /reset: 重置当前会话
    """

    @property
    def supported_commands(self) -> List[str]:
        return ["new", "session", "model", "mode", "reset"]

    async def execute(
        self, command: str, args: Optional[str], context: CommandContext
    ) -> TUIResult:
        if command == "new":
            return await self._handle_new(context)
        elif command == "session":
            return await self._handle_session(args, context)
        elif command == "model":
            return await self._handle_model(args, context)
        elif command == "mode":
            return await self._handle_mode(args, context)
        elif command == "reset":
            return await self._handle_reset(context)
        else:
            return TUIResult.error(f"未知命令: {command}")

    # ── /new ─────────────────────────────────────────────────────────────────

    async def _handle_new(self, context: CommandContext) -> TUIResult:
        """处理 /new 命令 - 新建会话（在 OpenCode 创建）"""
        try:
            if not hasattr(self.adapter, "create_new_session"):
                return TUIResult.error("创建会话失败: 适配器不支持 create_new_session")

            session_info = await self.adapter.create_new_session(
                working_dir=context.working_dir
            )
            if not session_info:
                return TUIResult.error("创建会话失败: OpenCode 未返回会话信息")

            session_id = session_info.get("id", "")
            session_slug = session_info.get("slug", "")

            from ..feishu.card_builder import build_new_session_card

            card = build_new_session_card(
                session_id=session_id,
                session_title="",
                working_dir=context.working_dir,
                model=context.current_model,
                cli_type=context.cli_type,
                project_name=context.project_name,
                project_display_name=context.project_display_name,
                slug=session_slug,
            )
            return TUIResult.card("", metadata={"card_json": card})

        except Exception as e:
            if self.logger:
                self.logger.error(f"创建会话失败: {e}")
            return TUIResult.error(f"创建会话失败: {str(e)}")

    # ── /session ──────────────────────────────────────────────────────────────

    async def _handle_session(
        self, args: Optional[str], context: CommandContext
    ) -> TUIResult:
        try:
            if not args:
                return await self._list_sessions(context)

            args_parts = args.strip().split(None, 2)
            sub_command = args_parts[0].lower()

            if sub_command == "rename":
                if len(args_parts) < 3:
                    return TUIResult.error("用法: /session rename <会话ID> <新名称>")
                return await self._rename_session(args_parts[1], args_parts[2], context)
            elif sub_command == "delete":
                if len(args_parts) < 2:
                    return TUIResult.error("用法: /session delete <会话ID>")
                return await self._delete_session(args_parts[1], context)
            else:
                return await self._switch_session(args.strip(), context)

        except Exception as e:
            if self.logger:
                self.logger.error(f"处理会话命令失败: {e}")
            return TUIResult.error(f"处理会话命令失败: {str(e)}")

    async def _list_sessions(self, context: CommandContext) -> TUIResult:
        """列出当前项目的会话（按 directory 从服务器过滤）"""
        try:
            if not hasattr(self.adapter, "list_sessions"):
                return TUIResult.error("列出会话失败: 适配器不支持 list_sessions")

            # 从服务器获取所有会话，按当前项目目录过滤
            all_sessions = await self.adapter.list_sessions(limit=50)
            filtered = [
                s for s in all_sessions
                if s.get("directory") == context.working_dir
            ]

            # 当前活跃会话（内存缓存）
            current_session_id = (
                self.adapter.get_session_id(context.working_dir)
                if hasattr(self.adapter, "get_session_id")
                else None
            ) or ""

            if not filtered:
                return TUIResult.text(
                    f"ℹ️ 暂无历史会话\n\n"
                    f"**工作目录:** `{context.working_dir}`\n"
                    f"发送 `/new` 创建新会话"
                )

            # 当前会话排最前
            filtered.sort(
                key=lambda s: (s.get("id") != current_session_id,
                               -(s.get("updated_at") or s.get("created_at", 0)))
            )

            session_data_list = []
            for session in filtered[:10]:
                sid = session.get("id", "")
                slug = session.get("slug", "")
                # 使用 slug 作为显示ID，如果没有则使用短ID
                display_id = slug if slug else sid[-8:] if len(sid) >= 8 else sid
                session_data_list.append({
                    "session_id": sid,
                    "display_id": display_id,
                    "title": session.get("title", "未命名会话"),
                    "created_at": session.get("created_at", 0),
                    "updated_at": session.get("updated_at", 0),
                    "is_current": sid == current_session_id,
                })

            from ..feishu.card_builder import build_session_list_card

            card = build_session_list_card(
                sessions=session_data_list,
                current_session_id=current_session_id,
                cli_type=context.cli_type,
                working_dir=context.working_dir,
            )
            return TUIResult.card("", metadata={"card_json": card})

        except Exception as e:
            if self.logger:
                self.logger.error(f"列出会话失败: {e}")
            return TUIResult.error(f"列出会话失败: {str(e)}")

    async def _switch_session(self, args: str, context: CommandContext) -> TUIResult:
        """切换到指定会话"""
        try:
            if not hasattr(self.adapter, "switch_session"):
                return TUIResult.error("切换会话失败: 适配器不支持 switch_session")

            session_id = args.strip()

            # 纯数字：从当前项目会话列表取第 N 个
            if session_id.isdigit():
                index = int(session_id) - 1
                all_sessions = await self.adapter.list_sessions(limit=50)
                filtered = [s for s in all_sessions if s.get("directory") == context.working_dir]
                if 0 <= index < len(filtered):
                    session_id = filtered[index].get("id", "")
                else:
                    return TUIResult.error(f"无效的会话索引: {args}")

            # 验证会话属于当前项目
            session_detail = await self._get_session_detail(session_id)
            if session_detail:
                session_dir = session_detail.get("directory", "")
                if session_dir and session_dir != context.working_dir:
                    return TUIResult.error(
                        f"无法切换: 该会话属于其他项目\n"
                        f"**当前项目:** `{context.working_dir}`\n"
                        f"**会话项目:** `{session_dir}`"
                    )

            success = await self.adapter.switch_session(session_id, context.working_dir)
            if success:
                # 获取会话详情以显示 slug
                session_detail = await self._get_session_detail(session_id)
                slug = session_detail.get("slug", "") if session_detail else ""
                display_id = slug if slug else (session_id[-8:] if len(session_id) >= 8 else session_id)
                return TUIResult.text(
                    f"✅ **已切换到会话**\n\n"
                    f"**ID:** `{display_id}`\n"
                    f"💡 可以继续之前的对话了"
                )
            else:
                return TUIResult.error("切换会话失败: 会话不存在或无法访问")

        except Exception as e:
            if self.logger:
                self.logger.error(f"切换会话失败: {e}")
            return TUIResult.error(f"切换会话失败: {str(e)}")

    async def _rename_session(
        self, session_id_or_index: str, new_title: str, context: CommandContext
    ) -> TUIResult:
        """重命名会话"""
        try:
            if not hasattr(self.adapter, "rename_session"):
                return TUIResult.error("重命名失败: 适配器不支持 rename_session")

            session_id = session_id_or_index.strip()
            if session_id.isdigit():
                index = int(session_id) - 1
                all_sessions = await self.adapter.list_sessions(limit=50)
                filtered = [s for s in all_sessions if s.get("directory") == context.working_dir]
                if 0 <= index < len(filtered):
                    session_id = filtered[index].get("id", "")
                else:
                    return TUIResult.error(f"无效的会话索引: {session_id_or_index}")

            if len(new_title) > 50:
                return TUIResult.error("会话名称不能超过50个字符")
            if not new_title.strip():
                return TUIResult.error("会话名称不能为空")

            success = await self.adapter.rename_session(session_id, new_title.strip())
            if success:
                # 获取会话详情以显示 slug
                session_detail = await self._get_session_detail(session_id)
                slug = session_detail.get("slug", "") if session_detail else ""
                display_id = slug if slug else (session_id[-8:] if len(session_id) >= 8 else session_id)
                return TUIResult.text(
                    f"✅ **已重命名会话**\n\n"
                    f"**ID:** `{display_id}`\n"
                    f"**新名称:** {new_title}\n"
                    f"💡 使用 `/session` 查看列表"
                )
            else:
                return TUIResult.error("重命名会话失败")

        except Exception as e:
            if self.logger:
                self.logger.error(f"重命名会话失败: {e}")
            return TUIResult.error(f"重命名会话失败: {str(e)}")

    async def _delete_session(
        self, session_id_or_index: str, context: CommandContext
    ) -> TUIResult:
        """删除会话"""
        try:
            if not hasattr(self.adapter, "delete_session"):
                return TUIResult.error("删除失败: 适配器不支持 delete_session")

            session_id = session_id_or_index.strip()
            if session_id.isdigit():
                index = int(session_id) - 1
                all_sessions = await self.adapter.list_sessions(limit=50)
                filtered = [s for s in all_sessions if s.get("directory") == context.working_dir]
                if 0 <= index < len(filtered):
                    session_id = filtered[index].get("id", "")
                else:
                    return TUIResult.error(f"无效的会话索引: {session_id_or_index}")

            session_detail = await self._get_session_detail(session_id)
            if session_detail:
                session_dir = session_detail.get("directory", "")
                if session_dir and session_dir != context.working_dir:
                    return TUIResult.error("无法删除: 该会话属于其他项目")

            success = await self.adapter.delete_session(session_id)
            if success:
                # 获取会话详情以显示 slug
                session_detail = await self._get_session_detail(session_id)
                slug = session_detail.get("slug", "") if session_detail else ""
                display_id = slug if slug else (session_id[-8:] if len(session_id) >= 8 else session_id)
                return TUIResult.text(
                    f"✅ **已删除会话**\n\n"
                    f"**ID:** `{display_id}`\n"
                    f"🗑️ 该会话及其消息历史已永久删除"
                )
            else:
                return TUIResult.error("删除会话失败")

        except Exception as e:
            if self.logger:
                self.logger.error(f"删除会话失败: {e}")
            return TUIResult.error(f"删除会话失败: {str(e)}")

    async def _get_session_detail(self, session_id: str) -> Optional[Dict[str, Any]]:
        """获取会话详情（通过适配器公共方法）"""
        if hasattr(self.adapter, "get_session_detail"):
            return await self.adapter.get_session_detail(session_id)
        return None

    # ── /model ────────────────────────────────────────────────────────────────

    async def _handle_model(
        self, args: Optional[str], context: CommandContext
    ) -> TUIResult:
        try:
            if args:
                return await self._switch_model(args, context)
            else:
                return await self._list_models(context)
        except Exception as e:
            if self.logger:
                self.logger.error(f"处理模型命令失败: {e}")
            return TUIResult.error(f"处理模型命令失败: {str(e)}")

    async def _list_models(self, context: CommandContext) -> TUIResult:
        try:
            if hasattr(self.adapter, "list_models"):
                models = await self.adapter.list_models()
                if not models:
                    return TUIResult.text(
                        "ℹ️ 暂无可用模型，请在 config.yaml 的 cli.opencode.models 中添加"
                    )
                from ..feishu.card_builder import build_model_select_card

                card = build_model_select_card(
                    models=models,
                    current_model=context.current_model or "",
                    cli_type=context.cli_type,
                )
                return TUIResult.card("", metadata={"card_json": card})
            return TUIResult.error("列出模型失败: 适配器不支持 list_models")
        except Exception as e:
            if self.logger:
                self.logger.error(f"列出模型失败: {e}")
            return TUIResult.error(f"列出模型失败: {str(e)}")

    async def _switch_model(self, args: str, context: CommandContext) -> TUIResult:
        try:
            model_id = args.strip()
            if "/" not in model_id:
                return TUIResult.error(
                    f"模型 ID 格式错误，应为 provider/model 格式\n"
                    f"例如: opencode/mimo-v2, anthropic/claude-sonnet-4-20250514"
                )
            if hasattr(self.adapter, "switch_model"):
                success = await self.adapter.switch_model(model_id)
                if success:
                    return TUIResult.text(
                        f"✅ **已切换到模型**\n\n**模型:** `{model_id}`\n💡 新消息将使用此模型"
                    )
                else:
                    return TUIResult.error(f"切换模型失败: 模型不可用")
            return TUIResult.error("切换模型失败: 适配器不支持 switch_model")
        except Exception as e:
            if self.logger:
                self.logger.error(f"切换模型失败: {e}")
            return TUIResult.error(f"切换模型失败: {str(e)}")

    # ── /mode ─────────────────────────────────────────────────────────────────

    async def _handle_mode(
        self, args: Optional[str], context: CommandContext
    ) -> TUIResult:
        try:
            if args:
                return await self._switch_mode(args.strip(), context)
            return await self._list_modes(context)
        except Exception as e:
            if self.logger:
                self.logger.error(f"处理 mode 命令失败: {e}")
            return TUIResult.error(f"处理 mode 命令失败: {str(e)}")

    async def _list_modes(self, context: CommandContext) -> TUIResult:
        if not hasattr(self.adapter, "list_agents"):
            return TUIResult.error("适配器不支持 list_agents")
        agents = await self.adapter.list_agents()
        if not agents:
            return TUIResult.text("ℹ️ 暂无可用 agent 模式")
        current = (
            self.adapter.get_current_agent()
            if hasattr(self.adapter, "get_current_agent")
            else "build"
        )
        from ..feishu.card_builder import build_mode_select_card

        card = build_mode_select_card(agents, current, cli_type=context.cli_type)
        return TUIResult.card("", metadata={"card_json": card})

    async def _switch_mode(self, agent_id: str, context: CommandContext) -> TUIResult:
        if not hasattr(self.adapter, "switch_agent"):
            return TUIResult.error("适配器不支持 switch_agent")
        await self.adapter.switch_agent(agent_id)
        agents = (
            await self.adapter.list_agents()
            if hasattr(self.adapter, "list_agents")
            else []
        )
        from ..feishu.card_builder import build_mode_select_card

        card = build_mode_select_card(agents, agent_id, cli_type=context.cli_type)
        return TUIResult.card("", metadata={"card_json": card})

    # ── /reset ────────────────────────────────────────────────────────────────

    async def _handle_reset(self, context: CommandContext) -> TUIResult:
        try:
            if hasattr(self.adapter, "reset_session"):
                success = await self.adapter.reset_session()
                if success:
                    return TUIResult.text(
                        f"✅ **已重置当前会话**\n\n🗑️ 对话历史已清空\n💡 可以开始新的对话了"
                    )
                else:
                    return TUIResult.error("重置会话失败")
            return TUIResult.error("重置会话失败: 适配器不支持 reset_session")
        except Exception as e:
            if self.logger:
                self.logger.error(f"重置会话失败: {e}")
            return TUIResult.error(f"重置会话失败: {str(e)}")

    # ── 交互式回复处理 ───────────────────────────────────────────────────────

    async def handle_interactive_reply(
        self,
        interactive_id: str,
        reply: str,
        metadata: Dict[str, Any],
        context: CommandContext,
    ) -> TUIResult:
        """处理交互式消息的回复"""
        if interactive_id == "session_select":
            return await self._switch_session(reply, context)
        elif interactive_id == "model_select":
            return await self._switch_model(reply, context)
        elif interactive_id == "rename_session":
            return await self._handle_rename_reply(reply, metadata, context)
        return TUIResult.error(f"未知的交互式消息: {interactive_id}")

    async def _handle_rename_reply(
        self,
        new_title: str,
        metadata: Dict[str, Any],
        context: CommandContext,
    ) -> TUIResult:
        """处理改名交互回复：重命名后返回更新的会话列表卡片"""
        session_id = metadata.get("session_id", "")
        working_dir = metadata.get("working_dir", "") or context.working_dir
        cli_type = metadata.get("cli_type", context.cli_type)

        new_title = new_title.strip()
        if not new_title:
            return TUIResult.error("名称不能为空")
        if len(new_title) > 50:
            return TUIResult.error("名称不能超过50个字符")

        if not hasattr(self.adapter, "rename_session"):
            return TUIResult.error("适配器不支持 rename_session")

        success = await self.adapter.rename_session(session_id, new_title)
        if not success:
            return TUIResult.error("重命名失败")

        # 返回更新后的会话列表卡片
        current_session_id = (
            self.adapter.get_session_id(working_dir)
            if hasattr(self.adapter, "get_session_id")
            else ""
        ) or ""

        all_sessions = await self.adapter.list_sessions(limit=20)
        filtered = [s for s in all_sessions if s.get("directory") == working_dir]
        filtered.sort(
            key=lambda s: (s.get("id") != current_session_id,
                           -(s.get("updated_at") or s.get("created_at", 0)))
        )

        session_data_list = []
        for session in filtered[:10]:
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

        from ..feishu.card_builder import build_session_list_card

        card = build_session_list_card(
            sessions=session_data_list,
            current_session_id=current_session_id,
            cli_type=cli_type,
            working_dir=working_dir,
        )
        return TUIResult.card("", metadata={"card_json": card})
