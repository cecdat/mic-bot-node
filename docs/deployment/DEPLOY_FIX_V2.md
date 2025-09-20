# 部署脚本修复 V2

## 问题描述

在远程服务器上测试时发现以下问题：

1. **没有让用户输入节点数量**：直接使用默认值 1
2. **Docker Compose 路径问题**：构建上下文路径计算错误
3. **错误信息**：`lstat /vol1/code/deployments: no such file or directory`

## 修复内容

### 1. 添加节点数量选择功能

**修复前**：
```bash
./start.sh deploy  # 直接使用默认值 1
```

**修复后**：
```bash
./start.sh deploy  # 会提示用户选择节点数量
```

**新增功能**：
```bash
# 如果没有指定节点数量，询问用户
if [ "$node_count" = "1" ] && [ -z "$2" ]; then
    print_color $CYAN "请选择要部署的节点数量:"
    print_color $YELLOW "  1) 1 个节点"
    print_color $YELLOW "  2) 2 个节点"
    print_color $YELLOW "  3) 3 个节点"
    print_color $YELLOW "  4) 4 个节点"
    print_color $YELLOW "  5) 自定义数量"
    echo -n "请输入选择 (1-5, 默认: 1): "
    read -r choice
    
    case $choice in
        1) node_count=1 ;;
        2) node_count=2 ;;
        3) node_count=3 ;;
        4) node_count=4 ;;
        5) 
            echo -n "请输入节点数量 (1-10): "
            read -r custom_count
            if [[ "$custom_count" =~ ^[1-9]$|^10$ ]]; then
                node_count=$custom_count
            else
                print_color $RED "无效的节点数量，使用默认值 1"
                node_count=1
            fi
            ;;
        "") node_count=1 ;;
        *) 
            print_color $RED "无效选择，使用默认值 1"
            node_count=1
            ;;
    esac
fi
```

### 2. 修复 Docker Compose 路径问题

**问题分析**：
- `start.sh build` 成功 - 说明 Dockerfile 路径正确
- `start.sh deploy` 失败 - 问题在 Docker Compose 文件中的路径
- 错误信息显示 Docker 在寻找 `/vol1/code/deployments` 而不是 `/vol1/code/bot-node/deployments`

**修复方案**：使用绝对路径替代相对路径

**修复前**：
```yaml
  node-1:
    build:
      context: ../../
      dockerfile: deployments/docker/Dockerfile
    volumes:
      - ../../node/node-1/config.json:/app/config.json:ro
      - ../../node/node-1/sessions:/app/sessions
```

**修复后**：
```yaml
  node-1:
    build:
      context: /vol1/code/bot-node
      dockerfile: deployments/docker/Dockerfile
    volumes:
      - /vol1/code/bot-node/node/node-1/config.json:/app/config.json:ro
      - /vol1/code/bot-node/node/node-1/sessions:/app/sessions
```

**实现方式**：
```bash
# 获取项目根目录的绝对路径
local project_root=$(cd ../../ && pwd)
print_color $BLUE "   项目根目录: $project_root"

# 在 Docker Compose 文件中使用绝对路径
cat >> "$compose_file" << EOF
  $node_name:
    build:
      context: $project_root
      dockerfile: deployments/docker/Dockerfile
    volumes:
      - $project_root/node/$node_name/config.json:/app/config.json:ro
      - $project_root/node/$node_name/sessions:/app/sessions
EOF
```

### 3. 增强调试信息

**新增调试输出**：
```bash
# 在启动服务时显示详细信息
print_color $BLUE "   当前工作目录: $(pwd)"
print_color $BLUE "   Compose文件: $COMPOSE_FILE"
print_color $BLUE "   项目根目录: $project_root"
```

## 测试验证

### 1. 节点数量选择测试

```bash
# 测试交互式选择
./start.sh deploy

# 预期输出
请选择要部署的节点数量:
  1) 1 个节点
  2) 2 个节点
  3) 3 个节点
  4) 4 个节点
  5) 自定义数量
请输入选择 (1-5, 默认: 1): 2
🚀 开始部署 2 个节点...
```

### 2. 路径修复测试

```bash
# 测试部署
./start.sh deploy

# 预期输出
>>> 生成 Docker Compose 文件: ../../compose/docker-compose.yaml
   项目根目录: /vol1/code/bot-node
>>> 启动 1 个节点服务
   当前工作目录: /vol1/code/bot-node/deployments/compose
   Compose文件: docker-compose.yaml
✅ 服务启动完成
```

### 3. 生成的 Docker Compose 文件

**修复后的文件内容**：
```yaml
version: '3.8'

services:
  node-1:
    build:
      context: /vol1/code/bot-node
      dockerfile: deployments/docker/Dockerfile
    container_name: mic-bot-node-1
    restart: unless-stopped
    volumes:
      - /vol1/code/bot-node/node/node-1/config.json:/app/config.json:ro
      - /vol1/code/bot-node/node/node-1/sessions:/app/sessions
    environment:
      - NODE_ENV=production
    networks:
      - bot-network

networks:
  bot-network:
    driver: bridge
```

## 优势

### 1. 用户体验改善
- ✅ 交互式节点数量选择
- ✅ 清晰的选项提示
- ✅ 输入验证和错误处理

### 2. 路径问题解决
- ✅ 使用绝对路径避免相对路径计算错误
- ✅ 自动获取项目根目录路径
- ✅ 兼容不同的部署环境

### 3. 调试信息增强
- ✅ 显示当前工作目录
- ✅ 显示项目根目录路径
- ✅ 显示 Compose 文件信息

### 4. 兼容性提升
- ✅ 支持直接指定节点数量：`./start.sh deploy 3`
- ✅ 支持交互式选择：`./start.sh deploy`
- ✅ 支持自定义节点数量（1-10个）

## 使用方法

### 1. 交互式部署
```bash
./start.sh deploy
# 会提示选择节点数量
```

### 2. 直接指定节点数量
```bash
./start.sh deploy 3
# 直接部署 3 个节点
```

### 3. 其他命令
```bash
./start.sh build    # 构建镜像
./start.sh start    # 启动服务
./start.sh stop     # 停止服务
./start.sh logs     # 查看日志
```

## 注意事项

1. **路径兼容性**：使用绝对路径确保在不同环境下都能正常工作
2. **用户输入验证**：对用户输入进行验证，防止无效输入
3. **错误处理**：提供清晰的错误信息和回退机制
4. **调试信息**：增加详细的调试信息便于问题排查

## 总结

修复后的部署脚本现在能够：

- ✅ 交互式选择节点数量
- ✅ 正确处理 Docker Compose 路径
- ✅ 提供详细的调试信息
- ✅ 支持多种部署方式
- ✅ 兼容不同的部署环境

现在可以正常使用 `./start.sh deploy` 进行部署了！🎉
