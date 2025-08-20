# Node端更新策略

## 概述

由于Node端运行在Docker容器中，且使用多阶段构建（Builder + Runtime），无法在运行时执行代码构建。因此采用**镜像更新**策略。

## 更新流程

### 1. Service端构建新镜像

```bash
# 在Service端执行
git clone <repository>
cd mic-bot-node
git checkout <target_branch_or_commit>
docker build -t mic-bot-node:<version> .
docker push <registry>/mic-bot-node:<version>
```

### 2. Node端拉取新镜像

```bash
# 在Node端容器内执行
docker pull <registry>/mic-bot-node:<version>
```

### 3. 重启容器

```bash
# 在宿主机执行
docker-compose down
docker-compose up -d
```

## 当前实现

### UpdateManager类

- **版本检查**: 通过 `/bot_api/check_version` 接口检查更新
- **镜像拉取**: 使用 `docker pull` 拉取新镜像
- **文件备份**: 备份 `src/config.json` 和 `sessions/` 目录
- **版本更新**: 更新 `package.json` 中的版本号
- **进程重启**: 退出进程，由外部重启容器

### 限制

1. **容器内无法构建**: 运行时只有编译后的代码，没有构建工具
2. **需要宿主机权限**: 拉取镜像和重启容器需要Docker权限
3. **镜像必须预构建**: Service端需要提前构建并推送镜像

## 推荐方案

### 方案A: 完全自动化（推荐）

1. Service端集成CI/CD，自动构建和推送镜像
2. Node端自动拉取镜像并重启
3. 使用Docker Compose或Kubernetes管理容器生命周期

### 方案B: 半自动化

1. Service端提供镜像构建脚本
2. 管理员手动执行构建和推送
3. Node端自动检测和拉取

### 方案C: 手动更新

1. 管理员手动在Node端执行更新命令
2. 完全控制更新时机和过程

## 配置文件保护

更新过程中会保护以下文件：

- `src/config.json` - 节点配置
- `sessions/` - 会话数据
- 其他运行时生成的数据

## 注意事项

1. **网络要求**: Node端需要能访问Docker Registry
2. **权限要求**: 容器需要Docker权限
3. **存储空间**: 需要足够的空间存储新镜像
4. **回滚机制**: 更新失败时自动恢复备份
