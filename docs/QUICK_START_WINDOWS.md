# mic-bot-node Windows 快速开始指南

## 3分钟快速部署

### 方法1: 一键部署（推荐）
```powershell
# 一键部署，自动创建节点、构建镜像
.\start.ps1 -Deploy
```

### 方法2: 分步部署
```powershell
# 步骤1: 创建节点
.\create-node.ps1 -NodeName 1 -Token "your-token-here"

# 步骤2: 构建和启动
.\start.ps1 -Build -Start

# 步骤3: 查看日志
.\start.ps1 -Logs
```

## 完整示例

### PowerShell 版本
```powershell
# 方法1: 一键部署3个节点
.\start.ps1 -Deploy -NodeCount 3

# 方法2: 分步部署
# 1. 创建多个节点
.\create-node.ps1 -NodeName 1 -Token "token1"
.\create-node.ps1 -NodeName 2 -Token "token2"
.\create-node.ps1 -NodeName 3 -Token "token3"

# 2. 构建镜像
.\start.ps1 -Build

# 3. 启动所有节点
.\start.ps1 -Start

# 4. 查看状态
.\start.ps1 -Logs

# 5. 停止服务
.\start.ps1 -Stop

# 6. 清理资源
.\start.ps1 -Clean
```

### 批处理版本
```cmd
# 一键部署
start.bat deploy

# 分步操作
start.bat build
start.bat start
start.bat logs
start.bat stop
start.bat clean
```

## 常用命令

```powershell
# 查看帮助
.\start.ps1
.\create-node.ps1 -Help

# 重启服务
.\start.ps1 -Restart

# 查看指定节点日志
.\start.ps1 -Logs -NodeName node-1

# 启动指定节点
.\start.ps1 -Start -NodeName node-1
```

## 故障排除

1. **PowerShell 执行策略错误**
   ```powershell
   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
   ```

2. **Docker 未运行**
   - 启动 Docker Desktop

3. **配置文件错误**
   - 检查 `node-*/config.json` 文件格式
   - 确保 token 正确设置

4. **端口冲突**
   - 检查端口使用情况
   - 修改配置文件中的端口设置
