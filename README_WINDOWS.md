# mic-bot-node Windows 部署指南

本文档介绍如何在 Windows 系统上部署和运行 mic-bot-node。

## 系统要求

- Windows 10/11
- Docker Desktop for Windows
- PowerShell 5.0+ 或命令提示符

## 快速开始

### 1. 准备环境

确保已安装并启动 Docker Desktop。

### 2. 创建节点配置

使用节点创建脚本快速创建新的节点：

#### PowerShell 版本（推荐）
```powershell
# 创建节点1
.\create-node.ps1 -NodeName 1

# 创建节点2并设置token
.\create-node.ps1 -NodeName 2 -Token "your-token-here"

# 创建测试节点并设置完整配置
.\create-node.ps1 -NodeName test -Token "your-token" -ServerUrl "https://your-server.com/"
```

#### 批处理版本
```cmd
# 创建节点1
create-node.bat 1

# 创建节点2并设置token
create-node.bat 2 your-token-here

# 创建测试节点并设置完整配置
create-node.bat test your-token https://your-server.com/
```

### 3. 选择部署脚本

我们提供了两种 Windows 部署脚本：

- **PowerShell 脚本** (`start.ps1`) - 功能完整，支持参数
- **批处理脚本** (`start.bat`) - 简化版本，易于使用

### 4. 使用 PowerShell 脚本（推荐）

```powershell
# 构建镜像并生成配置文件
.\start.ps1 -Build

# 启动所有节点
.\start.ps1 -Start

# 查看日志
.\start.ps1 -Logs

# 停止服务
.\start.ps1 -Stop
```

### 4. 使用批处理脚本

```cmd
# 构建镜像并生成配置文件
start.bat build

# 启动所有节点
start.bat start

# 查看日志
start.bat logs

# 停止服务
start.bat stop
```

## 详细使用说明

### 节点创建脚本

#### PowerShell 版本 (`create-node.ps1`)

```powershell
# 基本用法
.\create-node.ps1 -NodeName <节点名称> [参数]

# 必需参数
-NodeName    节点名称 (例如: 1, 2, test)

# 可选参数
-Token       服务端认证令牌
-ServerUrl   服务端地址 (默认: http://host.docker.internal:2003/)
-Help        显示帮助信息

# 示例
.\create-node.ps1 -NodeName 1
.\create-node.ps1 -NodeName 2 -Token "your-token-here"
.\create-node.ps1 -NodeName test -Token "your-token" -ServerUrl "https://your-server.com/"
```

#### 批处理版本 (`create-node.bat`)

```cmd
# 基本用法
create-node.bat <节点名称> [token] [server_url]

# 示例
create-node.bat 1
create-node.bat 2 your-token-here
create-node.bat test your-token https://your-server.com/
```

### PowerShell 脚本功能

#### 基本命令

```powershell
# 构建镜像
.\start.ps1 -Build

# 启动所有节点
.\start.ps1 -Start

# 启动指定节点
.\start.ps1 -Start -NodeName node-1

# 停止所有节点
.\start.ps1 -Stop

# 停止指定节点
.\start.ps1 -Stop -NodeName node-1

# 重启所有节点
.\start.ps1 -Restart

# 查看所有节点日志
.\start.ps1 -Logs

# 查看指定节点日志
.\start.ps1 -Logs -NodeName node-1

# 清理所有资源
.\start.ps1 -Clean
```

#### 组合使用

```powershell
# 构建并启动
.\start.ps1 -Build -Start

# 重启并查看日志
.\start.ps1 -Restart -Logs
```

### 批处理脚本功能

```cmd
# 构建镜像
start.bat build

# 启动服务
start.bat start

# 停止服务
start.bat stop

# 重启服务
start.bat restart

# 查看日志
start.bat logs

# 查看状态
start.bat status

# 清理资源
start.bat clean

# 显示帮助
start.bat help
```

## 项目结构

部署脚本会自动扫描 `node-*` 目录并生成相应的 Docker Compose 配置：

```
mic-bot-node/
├── start.ps1              # PowerShell 部署脚本
├── start.bat              # 批处理部署脚本
├── Dockerfile             # Docker 构建文件
├── node-1/                # 节点1配置
│   ├── config.json        # 节点配置文件
│   └── sessions/          # 会话数据目录
├── node-2/                # 节点2配置
│   ├── config.json
│   └── sessions/
└── docker-compose.generated.yaml  # 自动生成的配置文件
```

## 配置说明

### 节点配置文件

每个节点目录下的 `config.json` 文件包含节点特定配置：

```json
{
    "apiServer": {
        "enabled": true,
        "updateUrl": "http://host.docker.internal:2003/",
        "token": "your-token-here",
        "nodeName": "Node-1",
        "heartbeatInterval": "45s",
        "heartbeatTimeout": "10m"
    }
}
```

### 自动生成的 Docker Compose 配置

脚本会自动为每个 `node-*` 目录生成对应的服务配置，包括：

- 镜像使用：`local/bot-node-base:latest`
- 配置文件挂载：`./node-X/config.json:/app/dist/config.json:ro`
- 会话数据挂载：`./node-X/sessions:/app/sessions`
- 环境变量：时区、生产环境等
- 资源限制：内存 2GB，CPU 2核
- DNS 配置：8.8.8.8, 1.1.1.1

## 故障排除

### 常见问题

1. **PowerShell 执行策略错误**
   ```powershell
   # 临时允许脚本执行
   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
   ```

2. **Docker 未运行**
   ```
   ❌ 错误: Docker 未运行或未安装，请先启动 Docker Desktop
   ```
   解决：启动 Docker Desktop

3. **配置文件不存在**
   ```
   ⚠️ 警告: 节点 node-1 的配置文件不存在
   ```
   解决：确保每个 `node-*` 目录下都有 `config.json` 文件

4. **端口冲突**
   ```
   ❌ 错误: 端口已被占用
   ```
   解决：检查端口使用情况，修改配置文件中的端口设置

### 日志查看

```powershell
# 查看所有节点日志
.\start.ps1 -Logs

# 查看指定节点日志
.\start.ps1 -Logs -NodeName node-1

# 查看实时日志
docker-compose -f docker-compose.generated.yaml logs -f
```

### 服务状态检查

```powershell
# 查看容器状态
docker ps

# 查看服务状态
docker-compose -f docker-compose.generated.yaml ps

# 查看资源使用情况
docker stats
```

## 高级用法

### 自定义配置

1. 修改 `start.ps1` 或 `start.bat` 中的配置变量
2. 调整 Docker Compose 模板
3. 添加自定义环境变量

### 多环境部署

```powershell
# 开发环境
.\start.ps1 -Build -Start

# 生产环境（需要修改配置）
$env:NODE_ENV="production"
.\start.ps1 -Build -Start
```

### 监控和日志

```powershell
# 查看资源使用
docker stats

# 查看详细日志
docker-compose -f docker-compose.generated.yaml logs --tail=100

# 导出日志
docker-compose -f docker-compose.generated.yaml logs > logs.txt
```

## 更新和维护

### 更新镜像

```powershell
# 重新构建镜像
.\start.ps1 -Build

# 重启服务
.\start.ps1 -Restart
```

### 清理资源

```powershell
# 清理所有资源
.\start.ps1 -Clean
```

### 备份配置

```powershell
# 备份配置文件
Copy-Item -Path "node-*" -Destination "backup\" -Recurse
```

## 支持

如果遇到问题，请检查：

1. Docker Desktop 是否正常运行
2. 配置文件格式是否正确
3. 端口是否被占用
4. 系统资源是否充足

更多帮助信息：

```powershell
# PowerShell 脚本帮助
.\start.ps1

# 批处理脚本帮助
start.bat help
```
