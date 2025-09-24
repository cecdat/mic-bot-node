# 热搜词获取逻辑修复说明

## 问题描述

从日志分析发现热搜词获取脚本存在配置文件路径错误：

```
[2025-09-22 06:29:49] 使用配置文件: /app/dist/config.json
[2025-09-22 06:29:49] 读取配置文件失败: [Errno 2] No such file or directory: '/app/dist/config.json'
```

## 问题分析

### 1. 配置文件路径错误
- **热搜词脚本** (`get_all_hots.py`) 中硬编码了错误的配置文件路径：`/app/dist/config.json`
- **实际配置文件位置**：`/app/config.json`（容器环境）
- **调用逻辑问题**：`runHotSearchScript` 函数传递的配置文件路径不正确

### 2. 路径不一致
- TypeScript 代码中 `baseDir = __dirname` 指向 `/app/dist`
- 但实际配置文件在 `/app/config.json`
- 导致热搜词脚本无法找到配置文件

## 修复方案

### 1. 修复热搜词脚本的默认路径

**文件**: `mic-bot-node/scripts/get_all_hots.py`

**修复前**:
```python
CONFIG_FILE_PATH = '/app/dist/config.json'
```

**修复后**:
```python
CONFIG_FILE_PATH = '/app/config.json'  # 修复：使用正确的配置文件路径
```

### 2. 修复 TypeScript 调用逻辑

**文件**: `mic-bot-node/app/src/index.ts`

**修复前**:
```typescript
const configPath = path.join(baseDir, 'config.json');
```

**修复后**:
```typescript
// 使用正确的配置文件路径
let configPath: string;
try {
    const config = loadConfig();
    // 尝试多个可能的配置文件路径
    const possiblePaths = [
        path.join('/app', 'config.json'),            // 容器环境
        path.join(process.cwd(), 'config.json'),     // 当前工作目录
        path.join(baseDir, 'config.json'),           // dist目录
        'config.json'                                 // 相对路径
    ];
    
    configPath = possiblePaths.find(p => fs.existsSync(p)) || possiblePaths[0];
    log('main', '热搜脚本', `使用配置文件路径: ${configPath}`);
} catch (error) {
    // 如果loadConfig失败，使用默认路径
    configPath = path.join('/app', 'config.json');
    log('main', '热搜脚本', `配置文件加载失败，使用默认路径: ${configPath}`, 'warn');
}
```

## 修复效果预期

### 修复前的日志
```
[2025-09-22 06:29:49] 使用配置文件: /app/dist/config.json
[2025-09-22 06:29:49] 读取配置文件失败: [Errno 2] No such file or directory: '/app/dist/config.json'
```

### 修复后的预期日志
```
[LOG] 主进程 [热搜脚本] 使用配置文件路径: /app/config.json
[2025-09-22 06:29:49] 使用配置文件: /app/config.json
[2025-09-22 06:29:49] 使用账户文件: /app/dist/accounts.temp.json
[2025-09-22 06:29:49] 输出目录: /app/dist/search_terms
[2025-09-22 06:29:49] 成功从API [hot] 获取 20 条热搜。
```

## 技术细节

### 配置文件路径检测逻辑
1. **优先级顺序**：
   - `/app/config.json`（容器环境）
   - `process.cwd()/config.json`（当前工作目录）
   - `/app/dist/config.json`（dist目录）
   - `config.json`（相对路径）

2. **错误处理**：
   - 如果 `loadConfig()` 失败，使用默认路径
   - 提供详细的日志记录
   - 确保脚本能够继续执行

3. **兼容性**：
   - 支持容器环境和开发环境
   - 支持不同的部署配置
   - 向后兼容现有配置

### 热搜词脚本改进
- **路径修复**：使用正确的默认配置文件路径
- **参数传递**：通过命令行参数正确传递路径
- **错误处理**：提供清晰的错误信息

## 部署步骤

1. **重新构建镜像**:
   ```bash
   cd mic-bot-node
   docker-compose build
   ```

2. **重启节点容器**:
   ```bash
   docker-compose restart
   ```

3. **验证修复效果**:
   - 观察日志中配置文件路径是否正确
   - 确认热搜词脚本能够成功读取配置文件
   - 检查热搜词文件是否正常生成

## 测试建议

1. **配置文件测试**：确认配置文件路径检测逻辑正确
2. **热搜词获取测试**：验证热搜词脚本能够正常执行
3. **API调用测试**：确认热搜词API调用正常
4. **文件生成测试**：检查热搜词文件是否正确生成

## 监控要点

1. **配置文件加载**：确认配置文件正确加载
2. **热搜词获取**：监控热搜词获取成功率
3. **API调用状态**：观察API调用是否正常
4. **文件生成状态**：检查热搜词文件是否正常生成

---

*修复完成时间: 2024-12-19*
*修复版本: v1.5.3*
*影响范围: 热搜词获取脚本*
