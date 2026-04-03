# 已知问题记录

## Windows 平台配置文件换行符问题

**状态：** 已修复  
**优先级：** 高  
**创建时间：** 2026-04-03  
**修复时间：** 2026-04-03

### 问题描述

Windows 平台下，配置文件生成时保留了 `\r\n` 换行符，导致解析后的路径值包含 `\r`，进而导致 `opencode` 命令执行失败。

### 错误日志

```
{"level":60,"time":1775146130145,"pid":8348,"error":{"errno":-4058,"code":"ENOENT","syscall":"spawn C:\\Users\\error403\\AppData\\Roaming\\npm\\opencode\r","path":"C:\\Users\\error403\\AppData\\Roaming\\npm\\opencode\r","spawnargs":["serve","--port","4096"]},"msg":"未捕获的异常"}
```

注意 `path` 字段中的 `\r`（ `"opencode\r"`）。

### 根因分析

1. `config-file.ts` 使用 `\n` 拼接 YAML 内容
2. 但 Windows 上某些场景可能导致配置值本身带有 `\r`
3. `cleanString()` 可能没有被调用到所有路径，或者配置写入时就有问题

### 修复计划

- [x] 检查 `config-file.ts` 的 YAML 生成逻辑
- [x] 确保所有字符串值在写入前清理 `\r`
- [x] 验证 `cleanString()` 在 `loadConfig()` 中被正确应用到所有字段

### 修复内容

在 `src/setup/writers/config-file.ts` 的 `quote()` 函数中添加 `\r` 清理逻辑，确保所有写入配置文件的字符串值都不包含 Windows 换行符：

```typescript
function quote(value: string): string {
  // 清理 Windows 换行符 \r（输入可能来自 Windows 环境变量或文件）
  const cleanValue = value.replace(/\r/g, '');
  // ... 后续处理
}
```

### 相关文件

- `src/setup/writers/config-file.ts` - 配置文件生成
- `src/core/config.ts` - 配置文件加载

### 临时解决方案

手动编辑配置文件 `C:\Users\<username>\AppData\Roaming\feishu-cli-bridge\config.yaml`，确保使用 LF 换行符而非 CRLF。
