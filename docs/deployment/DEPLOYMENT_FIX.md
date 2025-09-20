# 部署脚本路径修复说明

## 问题描述

目录结构调整后，部署脚本中的路径没有完全更新，导致以下问题：

1. **Dockerfile 路径错误**：脚本中的 `DOCKERFILE_PATH` 指向了错误的路径
2. **缺少 build 命令**：脚本不支持单独的 `build` 命令
3. **路径引用不一致**：不同脚本中的路径引用不统一

## 修复内容

### 1. 修复 Linux 脚本 (start.sh)

**修复前**：
```bash
DOCKERFILE_PATH="../docker/Dockerfile"
SIMPLE_DOCKERFILE_PATH="../docker/Dockerfile.simple"
```

**修复后**：
```bash
DOCKERFILE_PATH="deployments/docker/Dockerfile"
SIMPLE_DOCKERFILE_PATH="deployments/docker/Dockerfile.simple"
```

### 2. 添加 build 命令支持

**新增功能**：
```bash
case $action in
    "build")
        print_color $GREEN "🔨 构建 Docker 镜像..."
        build_image
        ;;
    # ... 其他命令
esac
```

**更新帮助信息**：
```bash
print_color $YELLOW "  action: deploy, build, start, stop, restart, logs, clean"
```

### 3. 增强构建函数

**新增功能**：
- 路径验证：检查 Dockerfile 是否存在
- 详细日志：显示当前目录和 Dockerfile 路径
- 备用方案：支持简化版 Dockerfile
- 错误处理：更详细的错误信息

```bash
build_image() {
    print_color $CYAN ">>> 构建 Docker 镜像: $IMAGE_NAME"
    
    # 切换到项目根目录
    cd ../../
    
    print_color $BLUE "   当前目录: $(pwd)"
    print_color $BLUE "   Dockerfile路径: $DOCKERFILE_PATH"
    
    # 检查 Dockerfile 是否存在
    if [ ! -f "$DOCKERFILE_PATH" ]; then
        print_color $RED "❌ Dockerfile 不存在: $DOCKERFILE_PATH"
        handle_error "Dockerfile 文件不存在"
    fi
    
    # 尝试使用标准 Dockerfile 构建
    if docker build -f "$DOCKERFILE_PATH" -t "$IMAGE_NAME" .; then
        print_color $GREEN "✅ 镜像构建成功"
    else
        print_color $YELLOW "⚠️ 标准 Dockerfile 构建失败，尝试简化版本..."
        # 检查简化版本是否存在
        if [ -f "$SIMPLE_DOCKERFILE_PATH" ]; then
            if docker build -f "$SIMPLE_DOCKERFILE_PATH" -t "$IMAGE_NAME" .; then
                print_color $GREEN "✅ 简化版本镜像构建成功"
            else
                handle_error "简化版本镜像构建失败"
            fi
        else
            handle_error "镜像构建失败，且简化版本不存在"
        fi
    fi
    
    # 返回脚本目录
    cd deployments/scripts/
}
```

### 4. 修复 PowerShell 脚本 (start.ps1)

**修复前**：
```powershell
$DOCKERFILE_PATH = ".\Dockerfile"
$SIMPLE_DOCKERFILE_PATH = ".\Dockerfile.simple"
```

**修复后**：
```powershell
$DOCKERFILE_PATH = "..\..\deployments\docker\Dockerfile"
$SIMPLE_DOCKERFILE_PATH = "..\..\deployments\docker\Dockerfile.simple"
```

### 5. 创建简化版 Dockerfile

创建了 `deployments/docker/Dockerfile.simple` 作为备用方案，当标准 Dockerfile 构建失败时使用。

## 使用方法

### Linux/macOS

```bash
# 构建镜像
./start.sh build

# 完整部署
./start.sh deploy

# 启动服务
./start.sh start

# 查看日志
./start.sh logs

# 停止服务
./start.sh stop

# 重启服务
./start.sh restart

# 清理资源
./start.sh clean
```

### Windows

```batch
# 构建镜像
start.bat build

# 完整部署
start.bat deploy

# 启动服务
start.bat start
```

### PowerShell

```powershell
# 构建镜像
.\start.ps1 -Build

# 完整部署
.\start.ps1 -Deploy

# 启动服务
.\start.ps1 -Start
```

## 目录结构

修复后的正确目录结构：

```
mic-bot-node/
├── app/                          # 业务代码
├── node/                         # 节点配置和数据
├── deployments/                  # 部署相关文件
│   ├── docker/                   # Docker 文件
│   │   ├── Dockerfile            # 标准 Dockerfile
│   │   ├── Dockerfile.simple     # 简化版 Dockerfile
│   │   └── .dockerignore
│   ├── compose/                  # Docker Compose 文件
│   └── scripts/                  # 部署脚本
│       ├── start.sh              # Linux 脚本
│       ├── start.bat             # Windows 脚本
│       └── start.ps1             # PowerShell 脚本
├── docs/                         # 文档
├── scripts/                      # 工具脚本
├── start.sh                      # 根目录入口脚本
├── start.bat                     # 根目录入口脚本
└── start.ps1                     # 根目录入口脚本
```

## 测试验证

### 1. 路径验证

```bash
# 检查 Dockerfile 是否存在
ls -la deployments/docker/Dockerfile

# 检查简化版 Dockerfile 是否存在
ls -la deployments/docker/Dockerfile.simple
```

### 2. 构建测试

```bash
# 测试构建命令
./start.sh build

# 预期输出
>>> 构建 Docker 镜像: local/bot-node-base:latest
   当前目录: /path/to/mic-bot-node
   Dockerfile路径: deployments/docker/Dockerfile
✅ 镜像构建成功
```

### 3. 部署测试

```bash
# 测试完整部署
./start.sh deploy 1

# 预期输出
🚀 开始部署 1 个节点...
>>> 创建节点 1: node-1
✅ 节点 1 配置创建完成
>>> 生成 Docker Compose 文件: ../../compose/docker-compose.yaml
✅ Docker Compose 文件生成完成
>>> 构建 Docker 镜像: local/bot-node-base:latest
✅ 镜像构建成功
>>> 启动 1 个节点服务
✅ 服务启动完成
🎉 部署完成！
```

## 注意事项

1. **路径一致性**：确保所有脚本中的路径引用都指向正确的目录
2. **权限问题**：确保脚本有执行权限 (`chmod +x start.sh`)
3. **Docker 环境**：确保 Docker 服务正在运行
4. **网络连接**：构建过程需要网络连接下载依赖

## 故障排除

### 1. Dockerfile 不存在

**错误**：`❌ Dockerfile 不存在: deployments/docker/Dockerfile`

**解决**：检查文件是否存在，确保在正确的目录中运行脚本

### 2. 构建失败

**错误**：`⚠️ 标准 Dockerfile 构建失败，尝试简化版本...`

**解决**：
- 检查网络连接
- 检查 Docker 服务状态
- 查看详细错误日志
- 使用简化版 Dockerfile

### 3. 权限问题

**错误**：`Permission denied`

**解决**：
```bash
chmod +x start.sh
chmod +x deployments/scripts/start.sh
```

## 总结

修复后的部署脚本现在能够：

- ✅ 正确找到 Dockerfile 文件
- ✅ 支持单独的 build 命令
- ✅ 提供详细的构建日志
- ✅ 支持备用构建方案
- ✅ 跨平台兼容（Linux/Windows/PowerShell）

现在可以正常使用 `./start.sh build` 和 `./start.sh deploy` 命令了！
