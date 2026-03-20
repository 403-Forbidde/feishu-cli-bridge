"""Claude Code CLI 适配器"""

import asyncio
import json
import os
import tempfile
from typing import Optional, List, AsyncIterator
from pathlib import Path

from .base import BaseCLIAdapter, StreamChunk, StreamChunkType, Message


class ClaudeCodeAdapter(BaseCLIAdapter):
    """Claude Code CLI 适配器"""

    @property
    def name(self) -> str:
        return "claudecode"

    @property
    def default_model(self) -> str:
        return self.config.get("default_model", "claude-3-5-sonnet-20241022")

    @property
    def context_window(self) -> int:
        # Claude 3.5 Sonnet: 200K
        model = self.default_model.lower()
        if "opus" in model:
            return 200000
        elif "sonnet" in model:
            return 200000
        elif "haiku" in model:
            return 200000
        else:
            return 200000  # 默认 200K

    def build_command(self, prompt: str, working_dir: str) -> List[str]:
        """构建 Claude Code 命令"""
        cmd = [self.config.get("command", "claude")]

        # 非交互模式 + JSON 流式输出
        cmd.extend(["--output-format", "stream-json", "--verbose"])

        # 权限模式（非交互使用 acceptEdits 或 bypassPermissions）
        cmd.extend(["--permission-mode", "acceptEdits"])

        # 提示词
        cmd.extend(["-p", prompt])

        return cmd

    def parse_chunk(self, raw_line: bytes) -> Optional[StreamChunk]:
        """解析 Claude Code stream-json 输出"""
        try:
            line = raw_line.decode("utf-8", errors="ignore").strip()
            if not line or not line.startswith("{"):
                return None

            data = json.loads(line)
            msg_type = data.get("type", "")

            # 处理助手消息
            if msg_type == "assistant":
                message = data.get("message", {})
                content = message.get("content", [])

                # 提取文本内容
                text_parts = []
                for item in content:
                    if isinstance(item, dict) and item.get("type") == "text":
                        text_parts.append(item.get("text", ""))
                    elif isinstance(item, str):
                        text_parts.append(item)

                if text_parts:
                    return StreamChunk(
                        type=StreamChunkType.CONTENT, data="".join(text_parts)
                    )

            # 处理工具使用
            elif msg_type == "tool_use":
                tool_name = data.get("name", "unknown")
                return StreamChunk(
                    type=StreamChunkType.TOOL_USE,
                    data=f"",
                    metadata={"tool": tool_name},
                )

            # 处理工具结果
            elif msg_type == "tool_result":
                return StreamChunk(type=StreamChunkType.TOOL_RESULT, data="")

            # 处理错误
            elif msg_type == "error":
                error_msg = data.get("error", "Unknown error")
                return StreamChunk(
                    type=StreamChunkType.ERROR, data=f"\n\n[Error] {error_msg}"
                )

            # 处理结果（结束标记）
            elif msg_type == "result":
                return StreamChunk(type=StreamChunkType.DONE, data="")

            # 处理部分消息（流式增量）
            elif msg_type == "partial":
                content = data.get("content", "")
                if content:
                    return StreamChunk(type=StreamChunkType.CONTENT, data=content)

        except json.JSONDecodeError:
            pass
        except Exception as e:
            if self.logger:
                self.logger.debug(f"Parse error: {e}")

        return None

    async def execute_stream(
        self, prompt: str, context: List[Message], working_dir: str
    ) -> AsyncIterator[StreamChunk]:
        """执行 Claude Code 并流式返回输出"""
        # Claude Code 通常通过 .claude/ 目录管理会话
        # 这里我们通过环境变量或临时文件传递上下文

        cmd = self.build_command(prompt)

        if self.logger:
            self.logger.info(f"Executing: {' '.join(cmd)}")
            self.logger.info(f"Working directory: {working_dir}")

        # 构建环境变量
        env = os.environ.copy()

        # 设置代理环境变量（用于绕过地区限制）
        # 优先使用已存在的环境变量，否则尝试常见的代理端口
        if "https_proxy" not in env and "HTTPS_PROXY" not in env:
            # 尝试常见代理端口
            for port in [7890, 1080, 8080, 20171, 20172]:
                import socket
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.settimeout(0.5)
                result = sock.connect_ex(('127.0.0.1', port))
                sock.close()
                if result == 0:
                    env["http_proxy"] = f"http://127.0.0.1:{port}"
                    env["https_proxy"] = f"http://127.0.0.1:{port}"
                    env["all_proxy"] = f"socks5://127.0.0.1:{port}"
                    if self.logger:
                        self.logger.info(f"Auto-detected proxy at port {port}")
                    break

        # 如果有上下文，添加到环境变量
        if context:
            context_text = self.format_context(context)
            # Claude Code 可能通过环境变量或文件读取上下文
            # 这里设置一个自定义环境变量（如果需要适配器支持）
            env["CLAUDE_CONTEXT"] = context_text[:10000]  # 限制长度

        try:
            # 启动子进程
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=working_dir,
                env=env,
            )

            # 读取流式输出
            while True:
                line = await proc.stdout.readline()
                if not line:
                    break

                chunk = self.parse_chunk(line)
                if chunk:
                    yield chunk

            # 等待进程结束
            await proc.wait()

            # 检查错误
            if proc.returncode != 0:
                stderr = await proc.stderr.read()
                error_msg = stderr.decode("utf-8", errors="ignore")
                if self.logger:
                    self.logger.error(f"Claude Code error: {error_msg}")
                yield StreamChunk(
                    type=StreamChunkType.ERROR,
                    data=f"\n\n[Error] Claude Code exited with code {proc.returncode}: {error_msg[:200]}",
                )
            else:
                yield StreamChunk(type=StreamChunkType.DONE, data="")

        except Exception as e:
            if self.logger:
                self.logger.exception("Claude Code execution failed")
            yield StreamChunk(
                type=StreamChunkType.ERROR,
                data=f"\n\n[Error] Failed to execute Claude Code: {str(e)}",
            )
