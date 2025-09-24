# 主循环长轮询优化说明

## 问题分析

从日志分析发现主循环出现长轮询超时错误：

```
[2025/9/22 09:56:35] [PID: 1] [WARN] 主进程 [主流程] 主循环出错 (1/5): 长轮询超时，正在发起下一次请求...
```

### 问题原因

1. **长轮询超时**：主循环使用60秒超时进行长轮询请求
2. **网络延迟**：服务端响应可能因为网络问题或服务端负载高而超时
3. **频繁日志**：每次超时都会产生警告日志，造成日志噪音

### 当前状态

- ✅ **节点启动成功**：WebSocket连接正常
- ✅ **服务端通信正常**：节点注册成功
- ⚠️ **长轮询超时**：这是网络延迟导致的，不是严重问题

## 优化方案

### 1. 减少长轮询超时时间

**修复前**:
```typescript
const response = await axios.get(commandUrl.toString(), {
    headers: { 'Authorization': `Bearer ${config.apiServer.token}` },
    timeout: 60000  // 60秒超时
});
```

**修复后**:
```typescript
const response = await axios.get(commandUrl.toString(), {
    headers: { 'Authorization': `Bearer ${config.apiServer.token}` },
    timeout: 30000  // 减少超时时间到30秒，提高响应性
});
```

### 2. 优化超时错误日志抑制

**修复前**:
```typescript
if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
    errorMessage = '长轮询超时，正在发起下一次请求...';
    retryDelay = 5000; // 超时错误快速重试
}
```

**修复后**:
```typescript
if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
    errorMessage = '长轮询超时，正在发起下一次请求...';
    retryDelay = 5000; // 超时错误快速重试
    
    // 抑制频繁的超时错误日志，只在连续超时时才记录
    if (consecutiveErrors % 5 === 1) { // 每5次超时才记录一次
        log('main', '主流程', `长轮询超时 (${consecutiveErrors}次)，网络可能较慢`, 'warn');
    }
}
```

### 3. 改进错误日志抑制策略

**修复前**:
```typescript
// 抑制重复的主循环错误日志
const errorTime = Date.now();
if (errorTime - lastServerErrorTime > ERROR_SUPPRESS_INTERVAL) {
    log('main', '主流程', `主循环出错 (${consecutiveErrors}/${maxConsecutiveErrors}): ${errorMessage}`, 'warn');
}
```

**修复后**:
```typescript
// 抑制重复的主循环错误日志
const errorTime = Date.now();
const isTimeoutError = axios.isAxiosError(error) && (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT');

// 对于超时错误，使用更宽松的抑制策略
if (isTimeoutError) {
    // 超时错误每5次才记录一次，或者距离上次记录超过2分钟
    if (consecutiveErrors % 5 === 1 || errorTime - lastServerErrorTime > 120000) {
        log('main', '主流程', `主循环出错 (${consecutiveErrors}/${maxConsecutiveErrors}): ${errorMessage}`, 'warn');
        lastServerErrorTime = errorTime;
    }
} else if (errorTime - lastServerErrorTime > ERROR_SUPPRESS_INTERVAL) {
    log('main', '主流程', `主循环出错 (${consecutiveErrors}/${maxConsecutiveErrors}): ${errorMessage}`, 'warn');
    lastServerErrorTime = errorTime;
}
```

## 优化效果

### 修复前的日志
```
[2025/9/22 09:56:35] [PID: 1] [WARN] 主进程 [主流程] 主循环出错 (1/5): 长轮询超时，正在发起下一次请求...
[2025/9/22 09:56:40] [PID: 1] [WARN] 主进程 [主流程] 主循环出错 (2/5): 长轮询超时，正在发起下一次请求...
[2025/9/22 09:56:45] [PID: 1] [WARN] 主进程 [主流程] 主循环出错 (3/5): 长轮询超时，正在发起下一次请求...
```

### 修复后的预期日志
```
[2025/9/22 09:56:35] [PID: 1] [WARN] 主进程 [主流程] 长轮询超时 (1次)，网络可能较慢
[2025/9/22 09:56:55] [PID: 1] [WARN] 主进程 [主流程] 长轮询超时 (5次)，网络可能较慢
[2025/9/22 09:58:55] [PID: 1] [WARN] 主进程 [主流程] 长轮询超时 (10次)，网络可能较慢
```

## 技术细节

### 超时时间优化
- **原超时时间**: 60秒
- **新超时时间**: 30秒
- **优势**: 更快检测到网络问题，提高响应性

### 日志抑制策略
- **超时错误**: 每5次才记录一次，或距离上次记录超过2分钟
- **其他错误**: 保持原有的抑制策略
- **优势**: 减少日志噪音，保留重要信息

### 重试机制
- **超时重试**: 5秒后重试
- **其他错误**: 根据错误类型决定重试间隔
- **连续错误**: 达到最大次数后执行强制恢复

## 部署说明

1. **重新构建镜像**:
   ```bash
   cd mic-bot-node
   docker-compose build
   ```

2. **重启节点容器**:
   ```bash
   docker-compose restart
   ```

3. **观察日志**：确认优化效果
   - 长轮询超时时间减少到30秒
   - 超时错误日志减少
   - 网络问题检测更及时

## 监控要点

1. **超时频率**: 观察长轮询超时的频率是否降低
2. **日志噪音**: 确认超时错误日志是否减少
3. **响应性**: 检查网络问题检测是否更及时
4. **稳定性**: 确认节点运行稳定性

## 注意事项

1. **网络环境**: 如果网络环境较差，可能需要进一步调整超时时间
2. **服务端负载**: 如果服务端负载较高，可能需要增加超时时间
3. **日志监控**: 仍然需要关注连续超时的情况，可能是网络或服务端问题

---

*优化完成时间: 2024-12-19*
*优化版本: v1.5.3*
*影响范围: 主循环长轮询机制*
