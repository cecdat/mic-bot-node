# mic-bot-node 目录重构计划

## 当前目录结构问题
- 业务代码 (`src/`) 和部署文件混在一起
- 配置文件散落在各个 `node-*` 目录中
- 升级时需要处理多个目录的同步
- 项目结构不够清晰

## 新的目录架构设计

```
mic-bot-node/
├── app/                          # 业务代码目录
│   ├── src/                      # 源代码
│   │   ├── browser/
│   │   ├── config/
│   │   ├── examples/
│   │   ├── functions/
│   │   ├── handlers/
│   │   ├── interface/
│   │   ├── monitoring/
│   │   ├── scheduler/
│   │   ├── search_terms/
│   │   ├── strategies/
│   │   ├── util/
│   │   ├── utils/
│   │   ├── index.ts
│   │   └── worker.ts
│   ├── package.json              # 应用依赖
│   ├── package-lock.json
│   ├── tsconfig.json
│   ├── accounts.example.json
│   ├── accounts.json
│   └── requirements.txt
├── node/                      # 配置文件目录
│   ├── node-*/
├   ├   └── sessions/
│   │   └── config.json

├── deployments/                  # 部署相关文件
│   ├── docker/
│   │   ├── Dockerfile
│   │   └── .dockerignore
│   ├── compose/
│   │   ├── compose-1.yaml
│   │   └── docker-compose.yaml
│   └── scripts/
│       ├── start.bat
│       ├── start.ps1
│       ├── start.sh
│       ├── create-node.bat
│       └── create-node.ps1
├── docs/                         # 文档目录
│   ├── README.md
│   ├── README_WINDOWS.md
│   ├── QUICK_START_LINUX.md
│   ├── QUICK_START_WINDOWS.md
│   └── DOCKER_BUILD_FIX.md
├── scripts/                      # 工具脚本
│   └── get_all_hots.py
└── test_hot_search.py            # 测试脚本
```

## 重构优势

### 1. 清晰的职责分离
- **app/**: 纯业务代码，便于版本管理和升级
- **configs/**: 配置文件集中管理
- **sessions/**: 会话数据独立存储
- **deployments/**: 部署相关文件统一管理
- **docs/**: 文档集中存放

### 2. 便于升级维护
- 业务代码更新只需替换 `app/` 目录
- 配置文件和数据保持不变
- 部署脚本独立，便于定制

### 3. 更好的版本控制
- 业务代码和配置分离
- 减少不必要的文件变更
- 便于回滚和备份

### 4. 部署灵活性
- 支持多种部署方式
- 配置文件可独立管理
- 便于容器化部署

## 迁移步骤

1. **创建新目录结构**
2. **移动业务代码到 app/ 目录**
3. **重新组织配置文件**
4. **更新部署脚本路径**
5. **更新 Dockerfile**
6. **测试验证**
7. **更新文档**

## 兼容性考虑

- 保持现有功能不变
- 配置文件格式不变
- 部署脚本功能不变
- 向后兼容现有部署
