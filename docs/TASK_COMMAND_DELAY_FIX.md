# 任务指令接收延迟修复

## 问题描述

在节点管理页面点击"运行"按钮后，mic-bot-node 不会立即执行任务，需要重启 mic-bot-node 后才能收到任务信息。这是一个严重的响应性问题，影响任务的及时执行。

## 问题分析

### 根本原因
mic-bot-node 的 WebSocket 客户端缺少对任务指令的监听处理：

1. **WebSocket 事件缺失**：WebSocket 客户端只监听了 `upgrade_command` 事件，但没有监听 `new_task` 事件
2. **任务指令无法通过 WebSocket 接收**：当 WebSocket 连接时，节点无法接收任务执行指令
3. **依赖长轮询延迟**：只能通过长轮询机制接收指令，存在30秒的轮询间隔

### 影响范围
- 节点管理页面的"运行"按钮响应延迟
- 任务调度系统的实时性
- 用户体验严重下降

## 修复方案

### 1. 添加 WebSocket 任务指令监听

#### 修复前的问题
```typescript
// WebSocket 客户端只处理升级命令
this.socket.on('upgrade_command', (data: any) => {
    // 处理升级命令
});
// 缺少 new_task 事件监听
```

#### 修复后的逻辑
```typescript
this.socket.on('upgrade_command', (data: any) => {
    log('main', 'WebSocket', `🔄 收到升级命令: ${JSON.stringify(data)}`);
    globalWebSocketTask = {
        task_id: data.upgrade_id,
        command: 'UPGRADE',
        command_data: data,
        node_name: this.config.apiServer?.nodeName || 'unknown'
    };
});

// 新增：监听任务指令
this.socket.on('new_task', (data: any) => {
    log('main', 'WebSocket', `📋 收到新任务: ${JSON.stringify(data)}`);
    globalWebSocketTask = {
        task_id: data.task_id,
        command: data.command,
        command_data: data.command_data,
        node_name: this.config.apiServer?.nodeName || 'unknown'
    };
});
```

### 2. 优化任务处理响应性

#### 主循环任务处理优化
```typescript
// 检查是否有WebSocket任务需要处理
if (globalWebSocketTask) {
    const task = globalWebSocketTask;
    globalWebSocketTask = null; // 清除任务
    
    log('main', '主流程', `📋 收到WebSocket任务: ${task.task_id} (${task.command})`);
    
    // 检查是否与当前正在执行的任务冲突
    if (isTaskRunning) {
        log('main', '主流程', `⚠️ 有任务正在执行中，将WebSocket任务加入队列: ${task.task_id}`, 'warn');
        taskExecutionQueue.push(task);
    } else {
        // 立即执行WebSocket任务
        log('main', '主流程', `🚀 立即执行WebSocket任务: ${task.task_id} (${task.command})`);
        executeTaskIsolated(task);
    }
}
```

### 3. 减少 WebSocket 调度等待时间

#### 修复前
```typescript
// 如果使用WebSocket调度，跳过轮询
if (useWebSocketScheduling && wsClient && wsClient.connected) {
    await new Promise(resolve => setTimeout(resolve, 5000)); // 等待5秒
    continue;
}
```

#### 修复后
```typescript
// 如果使用WebSocket调度，跳过轮询
if (useWebSocketScheduling && wsClient && wsClient.connected) {
    await new Promise(resolve => setTimeout(resolve, 1000)); // 减少等待时间到1秒，提高响应性
    continue;
}
```

### 4. 优化任务队列处理

#### 任务完成后自动处理队列
```typescript
// 任务完成 - 尝试发送完成状态
if (wsClient && wsClient.connected) {
    wsClient.emitTaskStatusUpdate(task.task_id, 'completed', task.node_name, taskResult);
}

log('main', '任务隔离', `✅ 隔离任务完成: ${task.task_id}`);

// 立即处理队列中的下一个任务
if (taskExecutionQueue.length > 0) {
    const nextTask = taskExecutionQueue.shift();
    log('main', '任务隔离', `🔄 处理队列中的下一个任务: ${nextTask.task_id}`);
    // 递归处理下一个任务
    setTimeout(() => executeTaskIsolated(nextTask), 1000);
}
```

## 修复效果

### 修复前的问题
- 点击"运行"按钮后，节点不会立即执行任务
- 需要等待长轮询间隔（最多30秒）
- 需要重启节点才能收到任务指令
- 用户体验极差

### 修复后的效果
- 点击"运行"按钮后，节点立即接收并执行任务
- WebSocket 实时通信，响应时间 < 1秒
- 无需重启节点
- 任务队列自动处理，支持连续任务

## 技术细节

### WebSocket 事件流程
1. **mic-bot-service** 发送 `new_task` 事件到节点房间
2. **mic-bot-node** WebSocket 客户端接收事件
3. 任务数据存储到 `globalWebSocketTask` 全局变量
4. 主循环检测到任务，立即执行
5. 任务状态通过 WebSocket 实时更新

### 任务执行优先级
1. **WebSocket 任务**：最高优先级，立即执行
2. **长轮询任务**：备用机制，确保可靠性
3. **任务队列**：处理并发任务，避免冲突

### 容错机制
- WebSocket 连接断开时自动降级到长轮询
- 任务执行失败时自动重试
- 任务队列防止任务丢失

## 测试验证

### 测试步骤
1. 确保 mic-bot-node 正常运行且 WebSocket 连接正常
2. 在节点管理页面点击"运行"按钮
3. 观察节点日志，确认任务立即开始执行
4. 验证任务状态实时更新

### 预期结果
```
[2024-12-19 10:30:00] [LOG] 主进程 [WebSocket] 📋 收到新任务: {"task_id":"task_23_1703056200","command":"RUN_TASKS",...}
[2024-12-19 10:30:00] [LOG] 主进程 [主流程] 📋 收到WebSocket任务: task_23_1703056200 (RUN_TASKS)
[2024-12-19 10:30:00] [LOG] 主进程 [主流程] 🚀 立即执行WebSocket任务: task_23_1703056200 (RUN_TASKS)
[2024-12-19 10:30:00] [LOG] 主进程 [任务隔离] 🚀 开始执行隔离任务: task_23_1703056200 (RUN_TASKS)
```

## 部署说明

### 部署步骤
1. 更新 mic-bot-node 代码
2. 重新构建容器镜像
3. 重启 mic-bot-node 容器
4. 验证 WebSocket 连接和任务响应

### 验证命令
```bash
# 重新构建
cd mic-bot-node
docker-compose build

# 重启服务
docker-compose restart

# 查看日志
docker-compose logs -f mic-bot-node
```

## 相关文件

### 修改文件
- `mic-bot-node/app/src/index.ts`：WebSocket 事件监听和任务处理逻辑

### 相关文件
- `mic-bot-service/project/websocket_events.py`：WebSocket 事件发送逻辑
- `mic-bot-service/project/api_web.py`：节点管理 API

## 注意事项

1. **向后兼容**：修复不影响现有的长轮询机制
2. **容错性**：WebSocket 断开时自动降级到长轮询
3. **性能优化**：减少等待时间，提高响应性
4. **任务队列**：支持并发任务处理，避免任务冲突

---

*修复日期: 2024-12-19*
*修复版本: 1.5.3.3*
