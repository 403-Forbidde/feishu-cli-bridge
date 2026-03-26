# Card Builder 模块拆分计划

## 文档信息

- **版本**: 1.0
- **制定日期**: 2026-03-26
- **目标文件**: `src/feishu/card_builder/core.py` (2300 行)
- **拆分策略**: 功能聚合（方案 C）

---

## 1. 概述

### 1.1 拆分目标

将 `card_builder/core.py` (2300 行) 按业务领域拆分为 5 个模块，每个模块职责单一，代码量控制在 300-600 行之间。

### 1.2 拆分原则

1. **功能内聚**: 相同业务领域的函数聚合在一起
2. **依赖清晰**: 模块间依赖关系单向，避免循环依赖
3. **接口稳定**: `__init__.py` 导出保持不变，外部调用无需修改
4. **渐进迁移**: 支持分阶段实施，每阶段保持功能可用

---

## 2. 新模块结构

```
card_builder/
├── __init__.py          # 保持现有导出（无需修改外部调用）
├── constants.py         # 常量和配置（30行）
├── utils.py             # 通用工具函数（450行）
├── base.py              # 核心流式卡片（400行）
├── session_cards.py     # 会话相关卡片（700行）
├── project_cards.py     # 项目相关卡片（400行）
└── interactive_cards.py # 交互式卡片（400行）
```

---

## 3. 详细拆分方案

### 3.1 constants.py - 常量模块

**职责**: 集中管理所有常量定义

**包含内容**:
```python
# 元素 ID 常量
STREAMING_ELEMENT_ID = "streaming_content"
REASONING_ELEMENT_ID = "reasoning_content"

# 其他常量（如需要）
```

**依赖关系**: 无依赖，被所有其他模块导入

**预估行数**: 30 行

---

### 3.2 utils.py - 工具函数模块

**职责**: Markdown 优化和格式化工具函数

**包含函数**:

| 函数 | 依赖 | 说明 |
|------|------|------|
| `optimize_markdown_style()` | 调用 `_optimize_*` | 主入口，带异常保护 |
| `_optimize_markdown_style()` | 无 | Markdown 样式优化核心 |
| `_strip_invalid_image_keys()` | `_IMAGE_RE` | 移除无效图片 key |
| `_add_category_emojis()` | 无 | 自动添加分类 emoji |
| `_beautify_list_items()` | 无 | 美化列表项显示 |
| `_format_reasoning_duration()` | `_format_elapsed` | 格式化思考耗时 |
| `_format_elapsed()` | 无 | 格式化毫秒为可读时间 |
| `_simplify_model_name()` | 无 | 简化模型名称显示 |

**依赖关系**:
- 依赖: `constants` (如需要)
- 被依赖: `base.py`, `session_cards.py`, `project_cards.py`, `interactive_cards.py`

**预估行数**: 450 行

---

### 3.3 base.py - 核心流式卡片模块

**职责**: 流式输出相关的核心卡片构建

**包含函数**:

| 函数 | 依赖 | 说明 |
|------|------|------|
| `build_card_content()` | 调用 `_build_*` | 主入口，路由到不同状态卡片 |
| `_build_thinking_card()` | 无 | 思考中卡片（IM 回退） |
| `_build_streaming_card()` | `utils.optimize_markdown_style` | 流式输出卡片 |
| `_deduplicate_reasoning()` | 无 | 移除重复推理内容 |
| `_build_complete_card()` | `utils._format_reasoning_duration`, `utils._simplify_model_name`, `_append_token_stats*` | 完成状态卡片 |
| `_append_token_stats()` | 无 | 添加 Token 统计（完整版） |
| `_append_token_stats_compact()` | 无 | 添加 Token 统计（紧凑版） |

**依赖关系**:
- 依赖: `constants`, `utils`
- 被依赖: `__init__.py` 导出

**预估行数**: 400 行

---

### 3.4 session_cards.py - 会话卡片模块

**职责**: 会话相关的所有卡片构建

**包含函数**:

| 函数 | 依赖 | 说明 |
|------|------|------|
| `build_new_session_card()` | 无 | 新建会话成功卡片 |
| `build_session_list_card()` | 无 | 会话列表卡片 |
| `build_session_info_card()` | 无 | 单个会话信息卡片 |

**内部辅助函数**:
- `_kv()` (内嵌在 `build_new_session_card` 中的局部函数，考虑提取为模块私有函数)

**依赖关系**:
- 依赖: `constants` (如需要)
- 被依赖: `__init__.py` 导出

**预估行数**: 700 行

---

### 3.5 project_cards.py - 项目卡片模块

**职责**: 项目相关的所有卡片构建

**包含函数**:

| 函数 | 依赖 | 说明 |
|------|------|------|
| `build_project_list_card()` | 无 | 项目列表交互式卡片 |
| `build_project_info_card()` | 无 | 项目信息卡片 |

**内部辅助函数**:
- `_build_project_rows()` (从原函数提取)
- `_build_confirm_section()` (从原函数提取)

**依赖关系**:
- 依赖: `constants` (如需要)
- 被依赖: `__init__.py` 导出

**预估行数**: 400 行

---

### 3.6 interactive_cards.py - 交互式卡片模块

**职责**: 交互式工具卡片（模型选择、模式选择、帮助、重置、测试卡片）

**包含函数**:

| 函数 | 依赖 | 说明 |
|------|------|------|
| `build_mode_select_card()` | 无 | Agent 模式选择卡片 |
| `build_model_select_card()` | 无 | 模型选择卡片 |
| `build_help_card()` | 无 | 帮助卡片 |
| `build_reset_success_card()` | 无 | 重置成功卡片 |
| `build_test_card_v2_initial()` | 无 | 测试卡片 v2 初始状态 |
| `build_test_card_v2_details()` | 无 | 测试卡片 v2 详情 |
| `build_test_card_v2_data()` | 无 | 测试卡片 v2 数据 |
| `build_test_card_v2_closed()` | 无 | 测试卡片 v2 关闭状态 |

**依赖关系**:
- 依赖: `constants` (如需要)
- 被依赖: `__init__.py` 导出

**预估行数**: 400 行

---

## 4. 依赖关系图

```
                    ┌─────────────────┐
                    │   __init__.py   │
                    │   (导出接口)     │
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│  constants    │   │   base.py     │    │  utils.py     │
│  (常量)        │◄───│  (核心卡片)    │───►│  (工具函数)    │
└───────┬───────┘    └───────┬───────┘    └───────┬───────┘
        │                    │                    │
        │    ┌───────────────┴────────────────────┘
        │    │
        ▼    ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│session_cards  │    │project_cards  │    │interactive    │
│(会话卡片)      │    │(项目卡片)      │    │_cards (交互式) │
└───────────────┘    └───────────────┘    └───────────────┘
```

**依赖规则**:
- `constants`: 无依赖，被所有模块依赖
- `utils`: 仅依赖 `constants`
- `base`: 依赖 `constants`, `utils`
- `session_cards`, `project_cards`, `interactive_cards`: 仅依赖 `constants` (可选)

---

## 5. 实施计划

### 5.1 阶段一：准备（第 1 天）

**目标**: 创建基础模块，保持 `core.py` 不变

**任务清单**:
1. [ ] 创建 `constants.py`，迁移常量定义
2. [ ] 创建 `utils.py`，迁移工具函数
3. [ ] 更新 `__init__.py`，添加对新模块的导入
4. [ ] 单元测试：验证 `constants` 和 `utils` 导出正常

**验证命令**:
```bash
python -c "from src.feishu.card_builder import constants, utils; print('✓ 基础模块导入成功')"
python -c "from src.feishu.card_builder.utils import optimize_markdown_style; print('✓ 工具函数可用')"
```

---

### 5.2 阶段二：核心模块迁移（第 2 天）

**目标**: 创建 `base.py`，迁移核心流式卡片

**任务清单**:
1. [ ] 创建 `base.py`
2. [ ] 从 `core.py` 复制 `_build_thinking/streaming/complete_card` 等函数
3. [ ] 修改导入路径（从相对导入改为从 `utils` 导入）
4. [ ] 单元测试：验证 `build_card_content` 各状态正常

**验证命令**:
```bash
python -c "
from src.feishu.card_builder.base import build_card_content
# 测试各状态
c1 = build_card_content('thinking')
c2 = build_card_content('streaming', {'text': 'test'})
c3 = build_card_content('complete', {'text': 'done', 'elapsed_ms': 1000})
print('✓ base.py 各状态卡片构建成功')
"
```

---

### 5.3 阶段三：业务卡片迁移（第 3 天）

**目标**: 创建业务模块，逐个迁移

**任务清单**:
1. [ ] 创建 `session_cards.py`，迁移会话相关函数
2. [ ] 创建 `project_cards.py`，迁移项目相关函数
3. [ ] 创建 `interactive_cards.py`，迁移交互式卡片函数
4. [ ] 逐个模块验证

**验证命令**:
```bash
# 会话卡片
python -c "from src.feishu.card_builder.session_cards import build_new_session_card; print('✓ session_cards OK')"

# 项目卡片
python -c "from src.feishu.card_builder.project_cards import build_project_list_card; print('✓ project_cards OK')"

# 交互式卡片
python -c "from src.feishu.card_builder.interactive_cards import build_help_card; print('✓ interactive_cards OK')"
```

---

### 5.4 阶段四：整合与清理（第 4 天）

**目标**: 更新 `__init__.py`，删除 `core.py`

**任务清单**:
1. [ ] 更新 `__init__.py`，从各模块导入而非 `core`
2. [ ] 运行完整功能测试
3. [ ] 删除 `core.py`
4. [ ] 运行集成测试

**完整导入测试**:
```bash
python -c "
from src.feishu.card_builder import (
    build_card_content,
    build_new_session_card,
    build_session_list_card,
    build_session_info_card,
    build_project_list_card,
    build_project_info_card,
    build_model_select_card,
    build_mode_select_card,
    build_help_card,
    build_reset_success_card,
    build_test_card_v2_initial,
    optimize_markdown_style,
)
print('✓ 所有导出函数导入成功')
"
```

---

## 6. 风险评估与回滚策略

### 6.1 风险点

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| 导入循环 | 高 | 低 | 严格遵循依赖图，单向依赖 |
| 函数遗漏 | 中 | 中 | 使用 `grep` 检查所有函数迁移 |
| 导入路径错误 | 中 | 中 | 每个阶段完成后运行导入测试 |
| 功能回退 | 高 | 低 | 完整集成测试覆盖所有卡片 |

### 6.2 回滚策略

如果拆分过程中出现严重问题：

```bash
# 1. 保留 core.py，直到验证完成
# 2. 如发现问题，恢复 __init__.py 导入
git checkout src/feishu/card_builder/__init__.py

# 3. 删除新模块（如需要）
rm -f src/feishu/card_builder/constants.py \
    src/feishu/card_builder/utils.py \
    src/feishu/card_builder/base.py \
    src/feishu/card_builder/session_cards.py \
    src/feishu/card_builder/project_cards.py \
    src/feishu/card_builder/interactive_cards.py

# 4. 验证恢复
python -c "from src.feishu.card_builder import build_card_content; print('✓ 已回滚')"
```

---

## 7. 代码迁移示例

### 7.1 utils.py 迁移示例

**原代码** (core.py 1624-1812):
```python
def optimize_markdown_style(text: str, card_version: int = 2) -> str:
    try:
        result = _optimize_markdown_style(text, card_version)
        result = _strip_invalid_image_keys(result)
        result = _add_category_emojis(result)
        result = _beautify_list_items(result)
        return result
    except Exception:
        return text

def _optimize_markdown_style(text: str, card_version: int = 2) -> str:
    ...
```

**新代码** (utils.py):
```python
"""Markdown 优化和格式化工具函数"""
import re
import logging
from typing import Optional

logger = logging.getLogger(__name__)

def optimize_markdown_style(text: str, card_version: int = 2) -> str:
    """优化 Markdown 样式以适配飞书卡片显示"""
    try:
        result = _optimize_markdown_style(text, card_version)
        result = _strip_invalid_image_keys(result)
        result = _add_category_emojis(result)
        result = _beautify_list_items(result)
        return result
    except Exception:
        return text

def _optimize_markdown_style(text: str, card_version: int = 2) -> str:
    ...
# ... 其他函数
```

### 7.2 base.py 迁移示例

**原代码** (core.py 1171-1209):
```python
def _build_streaming_card(
    text: str,
    reasoning_text: Optional[str] = None,
) -> Dict[str, Any]:
    elements: List[Dict[str, Any]] = []
    if not text and reasoning_text:
        elements.append(...)
    elif text:
        elements.append({
            "tag": "markdown",
            "content": optimize_markdown_style(text),  # ← 需修改导入
        })
    return {...}
```

**新代码** (base.py):
```python
"""核心流式卡片构建"""
from typing import Dict, Any, List, Optional
from .constants import STREAMING_ELEMENT_ID, REASONING_ELEMENT_ID
from .utils import optimize_markdown_style, _format_reasoning_duration, _simplify_model_name

def _build_streaming_card(
    text: str,
    reasoning_text: Optional[str] = None,
) -> Dict[str, Any]:
    elements: List[Dict[str, Any]] = []
    if not text and reasoning_text:
        elements.append(...)
    elif text:
        elements.append({
            "tag": "markdown",
            "content": optimize_markdown_style(text),  # ← 从 .utils 导入
        })
    return {...}
```

### 7.3 __init__.py 最终状态

```python
"""飞书卡片构建工具"""

# 常量
from .constants import (
    STREAMING_ELEMENT_ID,
    REASONING_ELEMENT_ID,
)

# 工具函数
from .utils import (
    optimize_markdown_style,
    _format_elapsed,
    _format_reasoning_duration,
    _simplify_model_name,
)

# 核心卡片
from .base import (
    build_card_content,
)

# 会话卡片
from .session_cards import (
    build_new_session_card,
    build_session_list_card,
    build_session_info_card,
)

# 项目卡片
from .project_cards import (
    build_project_list_card,
    build_project_info_card,
)

# 交互式卡片
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
```

---

## 8. 测试验证清单

### 8.1 单元测试

每个模块创建后运行：

```bash
# 1. 导入测试
python -c "from src.feishu.card_builder import XXX; print('OK')"

# 2. 函数签名测试
python -c "
import inspect
from src.feishu.card_builder.XXX import YYY
sig = inspect.signature(YYY)
print(f'{YYY.__name__}{sig}')
"
```

### 8.2 集成测试

全部迁移完成后运行：

```bash
# 启动服务
python -m src.main

# 测试场景（在 Feishu 中执行）
1. 发送普通消息 → 验证流式回复卡片
2. 发送 /new → 验证新建会话卡片
3. 发送 /session → 验证会话列表卡片
4. 发送 /pl → 验证项目列表卡片
5. 发送 /model → 验证模型选择卡片
6. 发送 /mode → 验证模式选择卡片
7. 发送 /help → 验证帮助卡片
8. 发送 /reset → 验证重置成功卡片
```

---

## 9. 附录

### 9.1 函数清单

| 函数名 | 原行号 | 目标模块 | 依赖 |
|--------|--------|----------|------|
| `build_card_content` | 38 | base.py | `_build_thinking_card`, `_build_streaming_card`, `_build_complete_card` |
| `build_new_session_card` | 79 | session_cards.py | 无 |
| `build_project_list_card` | 194 | project_cards.py | 无 |
| `build_project_info_card` | 379 | project_cards.py | 无 |
| `build_mode_select_card` | 476 | interactive_cards.py | 无 |
| `build_model_select_card` | 556 | interactive_cards.py | 无 |
| `build_help_card` | 643 | interactive_cards.py | 无 |
| `build_reset_success_card` | 749 | interactive_cards.py | 无 |
| `build_test_card_v2_initial` | 783 | interactive_cards.py | 无 |
| `build_test_card_v2_details` | 894 | interactive_cards.py | 无 |
| `build_test_card_v2_data` | 996 | interactive_cards.py | 无 |
| `build_test_card_v2_closed` | 1111 | interactive_cards.py | 无 |
| `_build_thinking_card` | 1154 | base.py | 无 |
| `_build_streaming_card` | 1171 | base.py | `optimize_markdown_style` |
| `_deduplicate_reasoning` | 1212 | base.py | 无 |
| `_build_complete_card` | 1259 | base.py | `_format_reasoning_duration`, `_simplify_model_name`, `_append_token_stats*` |
| `_append_token_stats` | 1381 | base.py | 无 |
| `_append_token_stats_compact` | 1429 | base.py | 无 |
| `_add_category_emojis` | 1557 | utils.py | 无 |
| `_beautify_list_items` | 1596 | utils.py | 无 |
| `optimize_markdown_style` | 1629 | utils.py | `_optimize_*`, `_strip_invalid_image_keys`, `_add_category_emojis`, `_beautify_list_items` |
| `_optimize_markdown_style` | 1659 | utils.py | 无 |
| `_strip_invalid_image_keys` | 1735 | utils.py | `_IMAGE_RE` |
| `_format_reasoning_duration` | 1763 | utils.py | `_format_elapsed` |
| `_format_elapsed` | 1770 | utils.py | 无 |
| `_simplify_model_name` | 1778 | utils.py | 无 |
| `build_session_list_card` | 1815 | session_cards.py | 无 |
| `build_session_info_card` | 2099 | session_cards.py | 无 |

### 9.2 代码行数统计

| 模块 | 预估行数 | 实际行数（迁移后更新） |
|------|----------|------------------------|
| constants.py | 30 | - |
| utils.py | 450 | - |
| base.py | 400 | - |
| session_cards.py | 700 | - |
| project_cards.py | 400 | - |
| interactive_cards.py | 400 | - |
| __init__.py | 62 | - |
| **总计** | **~2442** | **2300 (原 core.py)** |

---

*文档版本: 1.0*
*制定日期: 2026-03-26*
*作者: Claude Code*
