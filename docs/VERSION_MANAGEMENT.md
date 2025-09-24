# Mic-Bot Node 版本管理系统

## 概述

Mic-Bot Node 现在包含了一个完整的版本管理系统，支持：
- 自动递增版本号
- 启动时显示版本信息
- 构建时自动生成版本号
- Docker 构建时版本管理

## 功能特性

### 1. 版本号显示
- 启动时自动显示版本信息
- 包含版本号、构建号、构建时间、Node.js 版本等信息
- 美观的表格格式显示

### 2. 自动版本递增
- 支持多种版本递增方式：构建号、修订版本、次版本、主版本
- 每次构建自动递增构建号
- 生成详细的构建信息文件

### 3. 构建脚本集成
- 集成到 npm scripts 中
- 支持 Docker 构建时自动版本管理
- 提供便捷的构建命令

## 使用方法

### 1. 查看当前版本
```bash
# 在应用目录中
cd app
npm run version:show
```

### 2. 构建项目（自动递增构建号）
```bash
# 在应用目录中
cd app
npm run build
```

### 3. 手动递增版本号
```bash
# 递增构建号（默认）
npm run version:bump

# 递增修订版本号 (1.5.3 -> 1.5.4)
npm run version:bump:patch

# 递增次版本号 (1.5.3 -> 1.6.0)
npm run version:bump:minor

# 递增主版本号 (1.5.3 -> 2.0.0)
npm run version:bump:major
```

### 4. 使用构建脚本
```bash
# Linux/macOS
./build.sh

# Windows
build.bat
```

### 5. Docker 构建
```bash
# Docker 构建时会自动递增版本号
docker build -t mic-bot-node .
```

## 版本号格式

### 完整版本号格式
```
<主版本>.<次版本>.<修订版本>.<构建号>
```

例如：`1.5.3.42`

### 版本号说明
- **主版本号**：重大功能更新或架构变更
- **次版本号**：新功能添加或重要改进
- **修订版本号**：Bug 修复或小功能改进
- **构建号**：每次构建自动递增

## 文件结构

### 版本管理相关文件
```
mic-bot-node/
├── app/
│   ├── src/util/Version.ts          # 版本管理核心类
│   ├── scripts/version-bump.js      # 版本递增脚本
│   ├── package.json                 # 包含版本号
│   ├── version.json                 # 构建号记录
│   └── build-info.json              # 构建信息（构建时生成）
├── build.sh                         # Linux/macOS 构建脚本
├── build.bat                        # Windows 构建脚本
└── deployments/docker/Dockerfile    # Docker 构建文件
```

### 生成的文件
- `version.json`：记录当前构建号
- `build-info.json`：详细的构建信息

## 启动时版本信息显示

启动时会显示如下格式的版本信息：
```
╔══════════════════════════════════════════════════════════════╗
║                    Mic-Bot Node 版本信息                      ║
╠══════════════════════════════════════════════════════════════╣
║  版本号: 1.5.3.42                                            ║
║  构建号: 42                                                  ║
║  构建时间: 2024-12-19T10:30:00.000Z                          ║
║  Node版本: v20.10.0                                          ║
╚══════════════════════════════════════════════════════════════╝
```

## 环境变量支持

### 构建时环境变量
- `BUILD_NUMBER`：手动指定构建号
- `BUILD_TIME`：手动指定构建时间

### 使用示例
```bash
# 指定构建号
BUILD_NUMBER=100 npm run build

# 指定构建时间
BUILD_TIME="2024-12-19T10:30:00.000Z" npm run build
```

## 版本管理最佳实践

### 1. 版本号递增策略
- **日常开发**：使用 `npm run build` 自动递增构建号
- **Bug 修复**：使用 `npm run build:patch` 递增修订版本
- **新功能**：使用 `npm run build:minor` 递增次版本
- **重大更新**：使用 `npm run build:major` 递增主版本

### 2. 发布流程
1. 开发完成后运行相应的构建命令
2. 检查生成的 `build-info.json` 文件
3. 提交代码和版本文件
4. 构建 Docker 镜像
5. 部署到生产环境

### 3. 版本追踪
- 每次构建都会生成 `build-info.json` 文件
- 包含完整的构建信息，便于追踪和调试
- 建议将版本文件纳入版本控制

## 故障排除

### 常见问题

1. **版本号显示不正确**
   - 检查 `package.json` 中的版本号
   - 确认 `build-info.json` 文件是否存在
   - 重新运行构建命令

2. **构建号不递增**
   - 检查 `version.json` 文件权限
   - 确认构建脚本执行成功
   - 手动删除 `version.json` 重新构建

3. **Docker 构建失败**
   - 检查 Dockerfile 中的版本管理命令
   - 确认构建上下文包含所有必要文件
   - 查看构建日志中的错误信息

### 重置版本号
```bash
# 删除版本文件，重新开始
rm app/version.json app/build-info.json

# 重新构建
cd app && npm run build
```

## 技术实现

### 核心类：VersionManager
- 单例模式，确保全局唯一
- 自动加载版本信息
- 提供多种版本信息获取方法

### 版本递增脚本：version-bump.js
- 支持多种递增方式
- 自动更新相关文件
- 生成详细构建信息

### 构建集成
- 集成到 npm scripts
- Docker 构建时自动执行
- 支持环境变量配置

---

*文档版本: 1.0.0*
*最后更新: 2024-12-19*
