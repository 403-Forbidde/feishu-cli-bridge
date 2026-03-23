"""会话管理模块 (v0.3.0)

从 v0.3.0 开始，会话管理完全委托给 OpenCode 服务器。
本地不再保留任何状态。OpenCodeAdapter._get_or_create_session()
在内存 miss 时自动从服务器恢复最近一次的会话。
"""
