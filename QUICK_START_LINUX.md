# mic-bot-node Linux 快速开始指南

## 3分钟快速部署

### 一键部署（推荐）
```bash
# 一键部署，自动创建节点、构建镜像
chmod +x start.sh
./start.sh
```

脚本会提示您输入要部署的节点数量，然后自动完成所有配置。

## 完整示例

```bash
# 1. 给脚本执行权限
chmod +x start.sh

# 2. 运行部署脚本
./start.sh

# 3. 按提示输入节点数量（例如：3）

# 4. 等待部署完成

# 5. 编辑配置文件（重要！）
nano node-1/config.json
nano node-2/config.json
nano node-3/config.json

# 6. 启动服务
docker-compose -f docker-compose.generated.yaml up -d

# 7. 查看日志
docker-compose -f docker-compose.generated.yaml logs -f
```

## 常用命令

```bash
# 查看帮助
./start.sh

# 启动服务
docker-compose -f docker-compose.generated.yaml up -d

# 查看日志
docker-compose -f docker-compose.generated.yaml logs -f

# 停止服务
docker-compose -f docker-compose.generated.yaml stop

# 重启服务
docker-compose -f docker-compose.generated.yaml restart

# 删除服务
docker-compose -f docker-compose.generated.yaml down

# 查看状态
docker-compose -f docker-compose.generated.yaml ps
```

## 配置说明

### 重要配置项

部署完成后，需要编辑每个节点的配置文件：

```bash
# 编辑配置文件
nano node-1/config.json
```

主要修改项：
- `token`: 设置正确的认证令牌
- `updateUrl`: 设置正确的服务器地址
- `nodeName`: 节点名称（通常不需要修改）

### 配置文件位置

```
mic-bot-node/
├── node-1/
│   ├── config.json      # 节点1配置
│   └── sessions/        # 节点1会话数据
├── node-2/
│   ├── config.json      # 节点2配置
│   └── sessions/        # 节点2会话数据
└── docker-compose.generated.yaml  # 自动生成的配置文件
```

## 故障排除

### 常见问题

1. **权限错误**
   ```bash
   chmod +x start.sh
   ```

2. **Docker 未运行**
   ```bash
   sudo systemctl start docker
   ```

3. **端口冲突**
   - 检查端口使用情况
   - 修改配置文件中的端口设置

4. **配置文件错误**
   - 检查 JSON 格式是否正确
   - 确保 token 和服务器地址正确

### 日志查看

```bash
# 查看所有节点日志
docker-compose -f docker-compose.generated.yaml logs -f

# 查看指定节点日志
docker-compose -f docker-compose.generated.yaml logs -f node-1

# 查看最近100行日志
docker-compose -f docker-compose.generated.yaml logs --tail=100
```

### 服务管理

```bash
# 查看容器状态
docker ps

# 查看服务状态
docker-compose -f docker-compose.generated.yaml ps

# 查看资源使用情况
docker stats
```

## 更新和维护

### 更新镜像

```bash
# 重新构建镜像
docker build -t local/bot-node-base:latest .

# 重启服务
docker-compose -f docker-compose.generated.yaml restart
```

### 清理资源

```bash
# 停止并删除容器
docker-compose -f docker-compose.generated.yaml down

# 删除镜像
docker rmi local/bot-node-base:latest

# 删除生成的配置文件
rm docker-compose.generated.yaml
```

### 备份配置

```bash
# 备份配置文件
cp -r node-* backup/

# 备份会话数据
cp -r node-*/sessions backup/
```
