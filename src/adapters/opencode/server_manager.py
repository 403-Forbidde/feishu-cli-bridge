"""OpenCode 服务器管理模块

提供 OpenCode Server 进程的生命周期管理。
"""

import asyncio
import json
import os
import shutil
import time
from typing import Optional

import httpx


class OpenCodeServerManager:
    """OpenCode Server 进程管理器（单实例，工作目录隔离通过 session directory 参数实现）

    Note: 此类不管理自己的并发锁，调用者（OpenCodeAdapter）负责并发控制。
    Issue #45: 移除内部锁避免嵌套锁绑定到不同事件循环的问题。
    """

    def __init__(self, port: int = 4096, hostname: str = "127.0.0.1", logger=None):
        self.port = port
        self.hostname = hostname
        self.base_url = f"http://{hostname}:{port}"
        self.process: Optional[asyncio.subprocess.Process] = None
        self._is_running = False
        self._logger = logger

    async def start(self) -> bool:
        """启动 OpenCode Server（调用者负责并发控制）"""
        if self._is_running:
            return True

        # 检查是否已有实例在运行
        if await self._check_health():
            self._is_running = True
            return True

        # 用 shutil.which 拿到完整路径，避免 Windows 子进程不走 shell PATH
        opencode_bin = shutil.which("opencode")
        if not opencode_bin:
            if self._logger:
                self._logger.error(
                    "找不到 opencode 可执行文件，请确认已安装并加入 PATH"
                )
            return False

        cmd = [opencode_bin, "serve", "--port", str(self.port)]

        # 注入 OPENCODE_PERMISSION 环境变量，预授权所有外部目录访问。
        # 全局配置文件 (~/.config/opencode/opencode.json) 可能被项目级配置覆盖，
        # 或在 opencode serve 已启动后写入（对已运行进程无效），而环境变量在进程
        # 启动时即生效，是无头模式下最可靠的方式（Issue #27）。
        env = os.environ.copy()
        env["OPENCODE_PERMISSION"] = json.dumps({"external_directory": "allow"})

        try:
            self.process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                start_new_session=True,
                env=env,
            )

            # 等待服务启动，使用指数退避策略（100ms -> 200ms -> 400ms ... 最大1s）
            start_time = time.time()
            delay = 0.1  # 初始延迟 100ms
            timeout = 10.0  # 总超时 10 秒

            while time.time() - start_time < timeout:
                # 进程已退出 → 立即读取 stderr 并报错
                if self.process.returncode is not None:
                    stderr_bytes = b""
                    if self.process.stderr:
                        try:
                            stderr_bytes = await asyncio.wait_for(
                                self.process.stderr.read(), timeout=1.0
                            )
                        except Exception:
                            pass
                    if self._logger:
                        self._logger.error(
                            f"opencode serve 进程意外退出 (code={self.process.returncode}): "
                            f"{stderr_bytes.decode(errors='replace').strip()}"
                        )
                    return False

                # 检查服务健康状态
                if await self._check_health():
                    self._is_running = True
                    if self._logger:
                        self._logger.info(
                            f"opencode serve 启动成功，耗时 {(time.time() - start_time)*1000:.0f}ms"
                        )
                    return True

                # 指数退避等待
                await asyncio.sleep(delay)
                delay = min(delay * 2, 1.0)  # 翻倍，但不超过 1 秒

            # 超时：读取 stderr 帮助诊断
            stderr_bytes = b""
            if self.process.stderr:
                try:
                    stderr_bytes = await asyncio.wait_for(
                        self.process.stderr.read(4096), timeout=1.0
                    )
                except Exception:
                    pass
            if self._logger:
                self._logger.error(
                    f"opencode serve 启动超时（10s）。stderr: "
                    f"{stderr_bytes.decode(errors='replace').strip() or '(无输出)'}"
                )
            return False
        except Exception as e:
            if self._logger:
                self._logger.error(f"启动 opencode serve 失败: {e}")
            return False

    async def stop(self):
        """停止 OpenCode Server（调用者负责并发控制）"""
        if self.process and self.process.returncode is None:
            self.process.terminate()
            try:
                await asyncio.wait_for(self.process.wait(), timeout=5.0)
            except asyncio.TimeoutError:
                self.process.kill()
        self._is_running = False

    async def _check_health(self) -> bool:
        """检查服务健康状态（兼容不同 opencode 版本的 health 路径）"""
        endpoints = ["/global/health", "/health", "/api/health"]
        try:
            async with httpx.AsyncClient() as client:
                for path in endpoints:
                    try:
                        response = await client.get(
                            f"{self.base_url}{path}", timeout=1.0
                        )
                        if response.status_code == 200:
                            return True
                    except Exception:
                        continue
        except Exception:
            pass
        return False
