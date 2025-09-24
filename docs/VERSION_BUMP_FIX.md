# 版本号递增修复说明

## 问题描述

mic-bot-node 构建之后版本号没有增加，始终显示相同的版本号。

## 问题分析

### 根本原因
1. **缺少版本文件**：`version.json` 文件不存在，导致版本号无法正确递增
2. **构建号未初始化**：构建号从 0 开始，但版本文件不存在时无法正确读取和递增

### 版本管理流程
1. **构建时**：`npm run build` → `npm run version:bump` → 递增构建号
2. **版本文件**：`version.json` 存储构建号和最后构建时间
3. **构建信息**：`build-info.json` 存储完整的构建信息
4. **运行时**：从 `build-info.json` 读取版本信息并显示

### 影响
- 版本号无法正确递增
- 无法区分不同的构建版本
- 版本管理功能失效

## 修复方案

### 1. 创建版本文件

**创建 `version.json`：**
```json
{
  "buildNumber": 0,
  "lastBuildTime": "2024-12-19T00:00:00.000Z",
  "version": "1.5.3"
}
```

### 2. 版本递增逻辑

**版本递增脚本 (`scripts/version-bump.js`)：**
- 读取 `package.json` 中的基础版本号
- 读取 `version.json` 中的构建号
- 递增构建号并保存到 `version.json`
- 生成 `build-info.json` 包含完整构建信息

### 3. 版本显示逻辑

**版本管理器 (`src/util/Version.ts`)：**
- 优先从 `build-info.json` 读取版本信息
- 如果不存在，从 `package.json` 读取基础版本号
- 从环境变量获取构建号（如果可用）

## 修复效果

### 预期改善
1. **版本递增**：每次构建时构建号自动递增
2. **版本显示**：启动时显示正确的版本信息
3. **构建追踪**：能够区分不同的构建版本

### 版本格式
- **基础版本**：`1.5.3`（来自 package.json）
- **构建号**：`1, 2, 3...`（每次构建递增）
- **完整版本**：`1.5.3.1, 1.5.3.2, 1.5.3.3...`

## 测试验证

### 测试场景
1. **首次构建**：验证版本文件创建和构建号递增
2. **多次构建**：验证构建号连续递增
3. **版本显示**：验证启动时显示正确的版本信息

### 验证命令
```bash
# 本地构建测试
cd mic-bot-node/app
npm run build

# 检查版本文件
cat version.json
cat build-info.json

# 查看版本信息
npm run version:show

# Docker 构建测试
docker-compose build mic-bot-node

# 查看容器版本信息
docker-compose run mic-bot-node npm run version:show
```

### 预期输出

**构建时：**
```
🔄 开始版本递增...
✅ 构建号已递增: 1.5.3.1
📋 构建信息:
   版本号: 1.5.3
   构建号: 1
   完整版本: 1.5.3.1
   构建时间: 2024-12-19T10:30:00.000Z
```

**启动时：**
```
╔══════════════════════════════════════════════════════════════╗
║                    Mic-Bot Node 版本信息                      ║
╠══════════════════════════════════════════════════════════════╣
║  版本号: 1.5.3.1                                            ║
║  构建号: 1                                                  ║
║  构建时间: 2024-12-19T10:30:00.000Z                        ║
║  Node版本: v20.10.0                                         ║
╚══════════════════════════════════════════════════════════════╝
```

## 相关文件

### 新增文件
- `mic-bot-node/app/version.json` - 版本文件（构建号存储）

### 修改文件
- `mic-bot-node/app/scripts/version-bump.js` - 版本递增脚本
- `mic-bot-node/app/src/util/Version.ts` - 版本管理器
- `mic-bot-node/app/package.json` - 构建脚本配置

### 生成文件
- `mic-bot-node/app/build-info.json` - 构建信息文件（构建时生成）

## 注意事项

1. **文件权限**：确保构建过程有权限创建和修改版本文件
2. **Git 忽略**：考虑将 `version.json` 和 `build-info.json` 添加到 `.gitignore`
3. **构建环境**：确保在不同构建环境中版本文件能够正确创建

## 预防措施

1. **版本文件检查**：在构建前检查版本文件是否存在
2. **构建验证**：构建后验证版本号是否正确递增
3. **版本同步**：确保所有环境中的版本文件格式一致

## 回滚方案

如果修复后出现问题，可以回滚：

```bash
# 删除版本文件
rm mic-bot-node/app/version.json
rm mic-bot-node/app/build-info.json

# 回滚到固定版本
echo '{"version": "1.5.3", "buildNumber": 0}' > mic-bot-node/app/version.json
```

---

*修复说明版本: 1.0*
*创建日期: 2024-12-19*
*最后更新: 2024-12-19*
