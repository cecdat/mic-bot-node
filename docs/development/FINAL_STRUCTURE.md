# mic-bot-node 最终目录结构

## 调整后的目录架构

根据你的要求，已将目录结构调整为每个节点目录包含 `config.json` 和 `sessions` 目录：

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
│   │       ├── account1@email.com/
│   │       ├── account2@email.com/
│   │       └── ...
│   ├── node-2/                   # 节点2
│   │   ├── config.json           # 节点2配置
│   │   └── sessions/             # 节点2会话数据
│   ├── node-3/                   # 节点3
│   │   ├── config.json           # 节点3配置
│   │   └── sessions/             # 节点3会话数据
│   └── node-4/                   # 节点4
│       ├── config.json           # 节点4配置
│       └── sessions/             # 节点4会话数据
├── deployments/                  # 部署相关文件
│   ├── docker/                   # Docker 相关
│   │   ├── Dockerfile
│   │   └── .dockerignore
│   ├── compose/                  # Docker Compose 文件
│   └── scripts/                  # 部署脚本
├── docs/                         # 文档目录
├── scripts/                      # 工具脚本
├── start.bat                     # Windows 启动脚本
├── start.ps1                     # PowerShell 启动脚本
├── start.sh                      # Linux 启动脚本
└── README.md                     # 项目说明
```

## 节点目录结构

每个节点目录 (`node/node-X/`) 包含：

### config.json
节点配置文件，包含：
- API 服务器配置
- 浏览器配置
- 任务配置
- 日志配置

### sessions/
会话数据目录，包含：
- 账户登录状态
- Cookie 信息
- 任务快照
- 积分数据

## 使用方法

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
- `node/node-3/config.json`
- `node/node-4/config.json`

### 3. 启动服务
```bash
./start.sh start
```

## 优势

### 1. 节点完整性
- 每个节点的配置和数据都在同一个目录中
- 便于节点级别的备份和迁移
- 节点之间完全独立

### 2. 便于管理
- 可以轻松复制整个节点目录
- 节点配置和数据一目了然
- 便于节点级别的升级和维护

### 3. 部署灵活
- 支持节点级别的部署
- 可以独立管理每个节点
- 便于扩展和缩容

## 升级指南

### 业务代码升级
1. 备份当前 `app/` 目录
2. 替换新的 `app/` 目录
3. 重启服务：`./start.sh restart`

### 节点配置升级
1. 备份 `node/` 目录
2. 更新配置文件
3. 重启服务：`./start.sh restart`

### 节点数据迁移
1. 备份整个 `node/node-X/` 目录
2. 停止服务：`./start.sh stop`
3. 替换节点目录
4. 启动服务：`./start.sh start`

## 总结

调整后的目录结构更加符合你的预期：
- ✅ 每个节点目录包含 `config.json` 和 `sessions/`
- ✅ 节点配置和数据集中管理
- ✅ 便于节点级别的操作和维护
- ✅ 保持了业务代码的独立性

现在目录结构更加清晰和实用！🎉
