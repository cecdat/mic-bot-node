# Docker 构建问题修复说明

## 问题描述

在 Windows 和 Linux 环境下部署 `mic-bot-node` 时，可能会遇到以下 Docker 构建问题：

1. **镜像拉取失败**: 无法从华为云镜像仓库拉取 Playwright 镜像
2. **网络连接问题**: 访问外部镜像仓库时出现 EOF 错误
3. **镜像源不稳定**: 某些镜像源可能临时不可用

## 修复方案

### 1. 镜像源修复

**原始配置**:
```dockerfile
FROM swr.cn-north-4.myhuaweicloud.com/ddn-k8s/mcr.microsoft.com/playwright:v1.52.0-jammy
FROM docker.1ms.run/node:20-slim AS builder
```

**修复后**:
```dockerfile
FROM mcr.microsoft.com/playwright:v1.52.0-jammy
FROM node:20-slim AS builder
```

### 2. 备用 Dockerfile

创建了 `Dockerfile.simple` 作为备用方案：

- 使用标准的 `node:20-slim` 镜像
- 简化了构建过程，减少网络依赖
- 直接安装 Playwright 浏览器，不依赖预构建镜像

### 3. 智能构建逻辑

所有部署脚本现在都支持智能构建：

1. **首先尝试标准 Dockerfile** - 使用完整的构建配置
2. **失败时自动切换到简化版** - 使用 `Dockerfile.simple`
3. **提供详细的错误信息** - 帮助用户诊断问题

## 使用方法

### Windows (批处理脚本)
```batch
start.bat deploy
```

### Windows (PowerShell 脚本)
```powershell
.\start.ps1 -Deploy
```

### Linux
```bash
./start.sh deploy
```

## 构建过程

### 标准构建流程
1. 使用 `Dockerfile` 构建
2. 多阶段构建：TypeScript 编译 + Playwright 运行时
3. 使用国内镜像源加速

### 备用构建流程
1. 标准构建失败时自动触发
2. 使用 `Dockerfile.simple` 构建
3. 单阶段构建，直接安装依赖

## 故障排除

### 如果两个 Dockerfile 都失败

1. **检查网络连接**:
   ```bash
   ping mcr.microsoft.com
   ping registry.npmjs.org
   ```

2. **检查 Docker 状态**:
   ```bash
   docker version
   docker info
   ```

3. **手动构建测试**:
   ```bash
   # 测试标准 Dockerfile
   docker build -f Dockerfile -t test-image .
   
   # 测试简化版 Dockerfile
   docker build -f Dockerfile.simple -t test-image .
   ```

4. **清理 Docker 缓存**:
   ```bash
   docker system prune -a
   ```

### 常见错误及解决方案

#### 错误: `failed to resolve source metadata`
- **原因**: 网络连接问题或镜像源不可用
- **解决**: 脚本会自动尝试备用 Dockerfile

#### 错误: `EOF` 错误
- **原因**: 网络连接中断
- **解决**: 检查网络连接，重试构建

#### 错误: `npm install` 失败
- **原因**: npm 镜像源问题
- **解决**: 脚本已配置国内镜像源

## 配置说明

### 镜像源配置

**npm 镜像源**:
```dockerfile
RUN npm config set registry https://registry.npmmirror.com
```

**apt 镜像源**:
```dockerfile
RUN sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list
```

**pip 镜像源**:
```dockerfile
RUN pip3 install -i https://mirrors.cloud.tencent.com/pypi/simple/ playwright
```

## 性能优化

### 构建缓存
- 使用多阶段构建减少最终镜像大小
- 合理使用 Docker 层缓存
- 优化依赖安装顺序

### 网络优化
- 使用国内镜像源加速下载
- 配置重试机制
- 设置合理的超时时间

## 更新日志

- **2024-01-XX**: 修复华为云镜像源问题
- **2024-01-XX**: 添加备用 Dockerfile 支持
- **2024-01-XX**: 实现智能构建逻辑
- **2024-01-XX**: 优化网络配置和错误处理
