"""OpenAI Codex CLI 适配器"""
import asyncio
import json
import os
import tempfile
from typing import Optional, List, Dict, AsyncIterator

from .base import BaseCLIAdapter, StreamChunk, StreamChunkType, Message


class CodexAdapter(BaseCLIAdapter):
    """OpenAI Codex CLI 适配器"""
    
    @property
    def name(self) -> str:
        return "codex"
    
    @property
    def default_model(self) -> str:
        return self.config.get("default_model", "gpt-5-codex")
    
    @property
    def context_window(self) -> int:
        # Codex 默认上下文窗口
        model = self.default_model.lower()
        if "5.3" in model or "5-3" in model:
            return 128000  # GPT-5.3 128K
        elif "5.2" in model or "5-2" in model:
            return 128000
        else:
            return 128000  # 默认 128K
    
    def build_command(
        self,
        prompt: str,
        context_file: Optional[str] = None
    ) -> List[str]:
        """构建 Codex 命令"""
        cmd = [self.config.get("command", "codex")]
        
        # 非交互模式
        cmd.extend(["exec", "-q"])  # exec -q 表示非交互执行
        
        # JSON 输出
        cmd.extend(["--json"])
        
        # 全自动化模式
        cmd.extend(["--full-auto"])
        
        # 模型选择
        if self.default_model:
            cmd.extend(["--model", self.default_model])
        
        # 提示词
        cmd.append(prompt)
        
        return cmd
    
    def parse_chunk(self, raw_line: bytes) -> Optional[StreamChunk]:
        """解析 Codex JSON 输出"""
        try:
            line = raw_line.decode('utf-8', errors='ignore').strip()
            if not line:
                return None
            
            # Codex 输出 JSON Lines 格式
            data = json.loads(line)
            
            # 处理响应内容
            if "response" in data:
                response = data["response"]
                if isinstance(response, str):
                    return StreamChunk(
                        type=StreamChunkType.CONTENT,
                        data=response
                    )
                elif isinstance(response, dict):
                    content = response.get("content", "")
                    if content:
                        return StreamChunk(
                            type=StreamChunkType.CONTENT,
                            data=content
                        )
            
            # 处理增量内容（如果支持流式）
            if "delta" in data:
                delta = data["delta"]
                if isinstance(delta, str):
                    return StreamChunk(
                        type=StreamChunkType.CONTENT,
                        data=delta
                    )
                elif isinstance(delta, dict):
                    content = delta.get("content", "")
                    if content:
                        return StreamChunk(
                            type=StreamChunkType.CONTENT,
                            data=content
                        )
            
            # 处理命令执行
            if "command" in data:
                command = data["command"]
                return StreamChunk(
                    type=StreamChunkType.TOOL_USE,
                    data=f"",
                    metadata={"command": command}
                )
            
            # 处理输出
            if "output" in data:
                output = data["output"]
                return StreamChunk(
                    type=StreamChunkType.TOOL_RESULT,
                    data=f"\n```\n{output}\n```\n"
                )
            
            # 处理完成
            if data.get("done") or data.get("finished"):
                return StreamChunk(
                    type=StreamChunkType.DONE,
                    data=""
                )
            
            # 处理错误
            if "error" in data:
                error_msg = data["error"]
                return StreamChunk(
                    type=StreamChunkType.ERROR,
                    data=f"\n\n[Error] {error_msg}"
                )
                
        except json.JSONDecodeError:
            # 不是 JSON，可能是纯文本
            text = raw_line.decode('utf-8', errors='ignore')
            if text.strip():
                return StreamChunk(
                    type=StreamChunkType.CONTENT,
                    data=text
                )
        except Exception as e:
            if self.logger:
                self.logger.debug(f"Parse error: {e}")
        
        return None
    
    async def execute_stream(
        self,
        prompt: str,
        context: List[Message],
        working_dir: str,
        attachments: Optional[List[Dict]] = None,
    ) -> AsyncIterator[StreamChunk]:
        """执行 Codex 并流式返回输出"""
        # Codex 支持通过 --history 参数传递历史
        # 或通过文件传递
        
        history_file = None
        if context:
            # 转换为 Codex 格式
            history = []
            for msg in context:
                history.append({
                    "role": msg.role,
                    "content": msg.content
                })
            
            with tempfile.NamedTemporaryFile(
                mode='w',
                suffix='.json',
                delete=False,
                encoding='utf-8'
            ) as f:
                json.dump(history, f)
                history_file = f.name
        
        try:
            cmd = self.build_command(prompt, history_file)
            
            # 如果有历史文件，添加参数
            if history_file:
                cmd.insert(-1, "--history")
                cmd.insert(-1, history_file)
            
            if self.logger:
                self.logger.info(f"Executing: {' '.join(cmd)}")
                self.logger.info(f"Working directory: {working_dir}")
            
            # 启动子进程
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=working_dir,
                env=os.environ.copy()
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
                error_msg = stderr.decode('utf-8', errors='ignore')
                if self.logger:
                    self.logger.error(f"Codex error: {error_msg}")
                yield StreamChunk(
                    type=StreamChunkType.ERROR,
                    data=f"\n\n[Error] Codex exited with code {proc.returncode}: {error_msg[:200]}"
                )
            else:
                yield StreamChunk(type=StreamChunkType.DONE, data="")
                
        except Exception as e:
            if self.logger:
                self.logger.exception("Codex execution failed")
            yield StreamChunk(
                type=StreamChunkType.ERROR,
                data=f"\n\n[Error] Failed to execute Codex: {str(e)}"
            )
        finally:
            # 清理临时文件
            if history_file and os.path.exists(history_file):
                os.unlink(history_file)
