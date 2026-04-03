# Issue: Claude Code CLI `-p` 模式不支持图片多模态输入

**状态**: 已知限制，已采用降级方案处理  
**发现时间**: 2026-04-03  
**相关文件**: `src/adapters/claude/adapter.ts`, `src/adapters/claude/process-manager.ts`  

## 现象

当用户在 Feishu 中发送带图片的消息并调用 Claude Code 适配器时：
- 若尝试通过 `@filepath` 将图片路径拼入 prompt，Claude Code CLI 会尝试使用 `Read` 工具读取该文件
- 由于 `-p` headless 模式下 CLI 将图片视为普通文本文件读取，得到的是二进制乱码
- 用户可能收到「图片损坏」「无法识别」「一堆乱码字符」之类的回复，或触发权限拒绝而没有任何有效输出

## 根本原因

Claude Code CLI 当前没有为 `-p` / `--print` 模式提供**真正的多模态图片输入通道**。其官方文档提到的 `@filepath` 语法在交互式 TUI 中可以正确调用视觉模型处理图片，但在 headless 模式下，CLI 内部的行为是：

1. 解析 `@filepath` 为文件引用
2. 通过 `Read` 工具读取文件内容
3. 将读取到的原始字节直接拼入上下文

对于文本文件这没有问题，但对于图片 filetype，CLI 并不会自动发起 vision/multi-modal API 调用，而是把二进制数据当作文本输入给模型，导致模型无法识别。

### 权限与 bypass 的额外说明

- 在 `permissionMode=default/acceptEdits` 时，`Read` 工具读取图片会触发权限拒绝，result 中会包含 `permission_denials`
- 即使改为 `bypassPermissions`，权限问题消失，但**乱码/无法识别的问题依然存在**，因为本质上是 headless 模式不支持多模态图片

## 当前处理方案（已合并）

在 `src/adapters/claude/adapter.ts` 的 `buildFullPrompt` 中，对附件类型做了区分：

- **文本文件 (`resourceType='file'`)**：继续使用 `@filepath` 引用，可被 `Read` 工具正常读取
- **图片文件 (`resourceType='image'`)**：仅追加文字说明，不再使用 `@filepath` 引用

示例 prompt 输出：

```
描述图片

图片附件（当前 CLI 模式暂不支持图片内容识别）：
- screenshot.png
```

这避免了子进程因尝试读取图片而产生的权限拒绝、乱码输出或完全静默的问题。

## 影响范围

- 仅影响 **Claude Code 适配器** 的图片消息处理
- OpenCode 适配器不受此影响（OpenCode 使用 HTTP + base64 的多模态 API）
- 普通文本消息和文本文件附件不受影响

## 长期可能的解决方向

1. **等待 Claude Code CLI 官方支持 headless 多模态输入**
   - 例如通过新参数（如 `--image /path/to/img.png` 或 `--file` 的多模态扩展）直接传入图片
   - 目前 `--file` 参数的格式为 `file_id:relative_path`，没有公开的图片 file_id 生成/上传机制

2. **在适配器层引入图像描述预处理**
   - 在调用 Claude Code 之前，先用一个支持视觉的模型（或本地 OCR）生成图片的文字描述
   - 将该描述作为文本 prompt 的一部分传给 Claude Code
   - 这会增加架构复杂度，需要额外的模型配置和成本

3. **路由策略：图片消息自动降级到 OpenCode**
   - 如果用户同时配置了 OpenCode 和 Claude Code，可以在消息含图片时自动选择 OpenCode 处理
   - 需要在 `MessageRouter` 或 `AIProcessor` 中增加基于附件类型的路由逻辑

## 相关文档

- `doc/claude-stream-format.md` 六、文件引用语法
- `doc/issues/002-claude-image-attachment-not-working.md`
- Claude Code CLI `--help` 中关于 `-p, --print` 和 `--file` 的说明
