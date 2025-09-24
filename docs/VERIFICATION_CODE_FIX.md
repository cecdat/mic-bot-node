# 辅助邮箱验证码逻辑修复说明

## 问题描述

从日志分析发现 mic-bot-node 的辅助邮箱验证码逻辑存在以下问题：

1. **配置文件路径错误**：`Cannot find module '../config.json'`
2. **重复处理验证码**：移动端和桌面端同时处理同一个账户的验证码
3. **验证码请求失败**：无法正确创建验证码请求

## 修复内容

### 1. 修复配置文件路径问题

**问题**：在 `VerificationCodeHandler.ts` 中使用了错误的路径加载配置文件
```typescript
// 错误的代码
const config = require('../config.json');
```

**修复**：使用正确的配置加载方法
```typescript
// 修复后的代码
const { loadConfig } = require('./Load');
const config = loadConfig();
```

### 2. 添加验证码处理互斥锁

**问题**：移动端和桌面端同时处理同一个账户的验证码，导致冲突

**修复**：添加全局验证码处理锁机制
```typescript
// 全局验证码处理锁，防止多个端同时处理同一个账户的验证码
const verificationLocks = new Map<string, boolean>();

// 在验证码处理方法中添加锁检查
const lockKey = `${accountEmail}_verification`;

if (verificationLocks.has(lockKey)) {
    log('main', '验证码处理', `账户 ${accountEmail} 的验证码正在被其他端处理，跳过当前处理`, 'warn');
    return false;
}

// 设置锁
verificationLocks.set(lockKey, true);

try {
    // 验证码处理逻辑
} finally {
    // 释放锁
    verificationLocks.delete(lockKey);
}
```

## 修复效果

### 修复前的问题日志
```
[2025/9/22 06:41:52] [PID: 4331] [ERROR] 主进程 [验证码处理] 请求验证码失败: Error: Cannot find module '../config.json'
[2025/9/22 06:41:52] [PID: 4331] [LOG] 主进程 [验证码处理] 创建验证码请求失败
[2025/9/22 06:41:52] [PID: 4331] [LOG] 主进程 [验证码处理] 未能获取到验证码，验证失败
```

### 修复后的预期效果
```
[2025/9/22 06:41:52] [PID: 4331] [LOG] 主进程 [验证码处理] [pc] 开始处理账户 hezimu66@outlook.com 的辅助邮箱验证码
[2025/9/22 06:41:52] [PID: 4414] [LOG] 主进程 [验证码处理] 账户 hezimu66@outlook.com 的验证码正在被其他端处理，跳过当前处理
[2025/9/22 06:41:52] [PID: 4331] [LOG] 主进程 [验证码处理] 成功创建验证码请求，ID: 12345
[2025/9/22 06:41:52] [PID: 4331] [LOG] 主进程 [验证码处理] 等待验证码输入...300s
```

## 技术细节

### 互斥锁机制
- 使用 `Map<string, boolean>` 存储验证码处理锁
- 锁的键格式：`${accountEmail}_verification`
- 确保同一时间只有一个端处理特定账户的验证码
- 使用 `try-finally` 确保锁的正确释放

### 配置文件加载
- 使用 `loadConfig()` 方法替代直接 require
- 支持多种配置文件路径的自动检测
- 兼容容器环境和开发环境

### 错误处理
- 添加详细的日志记录
- 区分不同设备类型的日志
- 提供清晰的错误信息

## 测试建议

1. **单端测试**：测试桌面端或移动端单独处理验证码
2. **双端测试**：测试移动端和桌面端同时遇到验证码的情况
3. **配置测试**：测试不同配置文件路径的加载
4. **错误恢复测试**：测试验证码处理失败后的恢复机制

## 部署说明

1. 重新构建 mic-bot-node 镜像
2. 重启所有节点容器
3. 观察日志确认修复效果
4. 测试验证码处理功能

---

*修复时间：2024-12-19*
*修复版本：v1.5.3*
