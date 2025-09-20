# mic-bot-node

Microsoft Rewards Bot Node - 微软奖励机器人节点

## 项目结构

```
mic-bot-node/
├── app/                          # 业务代码目录
│   ├── src/                      # 源代码
│   ├── package.json              # 应用依赖
│   ├── tsconfig.json             # TypeScript 配置
│   └── requirements.txt          # Python 依赖
├── node/                         # 节点目录
│   ├── node-1/                   # 节点1
│   │   ├── config.json           # 节点1配置
│   │   └── sessions/             # 节点1会话数据
│   ├── node-2/                   # 节点2
│   │   ├── config.json           # 节点2配置
│   │   └── sessions/             # 节点2会话数据
│   └── ...
├── deployments/                  # 部署相关文件
│   ├── docker/                   # Docker 相关
│   │   ├── Dockerfile
│   │   └── .dockerignore
│   ├── compose/                  # Docker Compose 文件
│   └── scripts/                  # 部署脚本
├── docs/                         # 文档目录
├── scripts/                      # 工具脚本
└── start.*                       # 项目启动脚本
```

## 快速开始

### 1. 部署节点

```bash
# Linux/macOS
./start.sh deploy

# Windows
start.bat deploy

# PowerShell
.\start.ps1 deploy
```

### 2. 配置节点

编辑配置文件：
- `node/node-1/config.json`
- `node/node-2/config.json`
- ...

主要配置项：
- `apiServer.token`: API 认证令牌
- `apiServer.updateUrl`: 服务器地址
- `apiServer.nodeName`: 节点名称

### 3. 启动服务

```bash
# 启动所有节点
./start.sh start

# 查看日志
./start.sh logs

# 停止服务
./start.sh stop
```

## 目录说明

### app/ - 业务代码
包含所有业务逻辑代码，升级时只需替换此目录。

### node/ - 节点目录
每个节点包含配置文件和会话数据：
- `config.json`: 节点配置文件
  - API 服务器配置
  - 浏览器配置
  - 任务配置
  - 日志配置
- `sessions/`: 会话数据目录
  - 登录状态
  - Cookie 信息
  - 任务快照
  - 积分数据

### deployments/ - 部署文件
- `docker/`: Docker 构建文件
- `compose/`: Docker Compose 配置
- `scripts/`: 部署和管理脚本

## 升级指南

### 业务代码升级
1. 备份当前 `app/` 目录
2. 替换新的 `app/` 目录
3. 重启服务：`./start.sh restart`

### 配置升级
1. 备份 `node/` 目录
2. 更新配置文件
3. 重启服务：`./start.sh restart`

### 数据迁移
1. 备份 `node/` 目录
2. 停止服务：`./start.sh stop`
3. 替换数据文件
4. 启动服务：`./start.sh start`

## 常用命令

```bash
# 完整部署
./start.sh deploy

# 构建镜像
./start.sh build

# 启动服务
./start.sh start

# 停止服务
./start.sh stop

# 重启服务
./start.sh restart

# 查看日志
./start.sh logs

# 清理资源
./start.sh clean

# 查看状态
./start.sh status
```

## 故障排除

### 1. 节点无法连接服务器
- 检查 `configs/node-*/config.json` 中的 `updateUrl` 和 `token`
- 确认服务器地址正确且可访问

### 2. 任务执行失败
- 检查浏览器配置
- 查看日志：`./start.sh logs`
- 检查网络连接

### 3. 镜像构建失败
- 检查 Docker 是否运行
- 检查网络连接
- 查看构建日志

## 开发指南

### 本地开发
1. 进入 `app/` 目录
2. 安装依赖：`npm install`
3. 编译代码：`npm run build`
4. 运行测试：`npm test`

### 代码结构
- `src/index.ts`: 主入口文件
- `src/browser/`: 浏览器相关
- `src/functions/`: 任务功能
- `src/util/`: 工具函数
- `src/interface/`: 类型定义

## 许可证

本项目仅供学习和研究使用，请遵守相关法律法规。
