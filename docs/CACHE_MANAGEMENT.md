# 浏览器缓存管理配置

## 概述

`mic-bot-node` 现在支持智能的浏览器缓存管理，可以有效解决 `chrome-error://chromewebdata/` 错误和页面加载问题。

## 配置选项

在 `config.json` 中添加 `cacheManagement` 配置段：

```json
{
  "cacheManagement": {
    "clearCacheOnStart": true,
    "autoClearOnChromeError": true,
    "clearLocalStorage": true,
    "clearSessionStorage": true,
    "clearIndexedDB": true,
    "clearCacheAPI": true,
    "clearCookies": true,
    "clearPermissions": true
  }
}
```

## 配置说明

### `clearCacheOnStart`
- **类型**: `boolean`
- **默认值**: `true`
- **说明**: 是否在启动浏览器时清理缓存和存储数据

### `autoClearOnChromeError`
- **类型**: `boolean`
- **默认值**: `true`
- **说明**: 是否在检测到 `chrome-error://` 页面时自动清理缓存

### `clearLocalStorage`
- **类型**: `boolean`
- **默认值**: `true`
- **说明**: 是否清理 localStorage 数据

### `clearSessionStorage`
- **类型**: `boolean`
- **默认值**: `true`
- **说明**: 是否清理 sessionStorage 数据

### `clearIndexedDB`
- **类型**: `boolean`
- **默认值**: `true`
- **说明**: 是否清理 IndexedDB 数据库

### `clearCacheAPI`
- **类型**: `boolean`
- **默认值**: `true`
- **说明**: 是否清理 Cache API 缓存

### `clearCookies`
- **类型**: `boolean`
- **默认值**: `true`
- **说明**: 是否清理浏览器 Cookies

### `clearPermissions`
- **类型**: `boolean`
- **默认值**: `true`
- **说明**: 是否清理浏览器权限设置

## 使用场景

### 1. 解决 chrome-error 问题
当遇到 `chrome-error://chromewebdata/` 错误时，系统会：
1. 自动检测错误页面
2. 清理相关缓存和存储
3. 重新导航到目标页面
4. 验证恢复是否成功

### 2. 预防性缓存清理
在启动时清理缓存可以：
- 避免旧缓存数据干扰
- 确保页面加载的稳定性
- 减少内存占用

### 3. 选择性清理
可以根据需要选择性地清理特定类型的缓存：
```json
{
  "cacheManagement": {
    "clearCacheOnStart": true,
    "autoClearOnChromeError": true,
    "clearLocalStorage": true,
    "clearSessionStorage": false,
    "clearIndexedDB": true,
    "clearCacheAPI": false,
    "clearCookies": true,
    "clearPermissions": false
  }
}
```

## 日志输出

系统会输出详细的缓存清理日志：

```
[2025/9/25 14:30:00] [LOG] 浏览器 [缓存清理] 开始清理页面缓存和存储数据...
[2025/9/25 14:30:01] [LOG] 浏览器 [缓存清理] 页面缓存和存储数据清理完成
[2025/9/25 14:30:02] [LOG] 浏览器 [错误处理] 检测到 chrome-error 页面: chrome-error://chromewebdata/，尝试恢复...
[2025/9/25 14:30:05] [LOG] 浏览器 [错误处理] 成功从 chrome-error 页面恢复，当前URL: https://www.bing.com
```

## 注意事项

1. **性能影响**: 频繁的缓存清理可能会影响性能，建议根据实际情况调整配置
2. **会话保持**: 清理 Cookies 可能会影响登录状态，请谨慎配置
3. **调试模式**: 在调试时可以禁用某些清理选项来保留调试信息

## 故障排除

### 问题：仍然出现 chrome-error
**解决方案**:
1. 确保 `autoClearOnChromeError` 设置为 `true`
2. 检查所有清理选项是否启用
3. 查看日志确认清理过程是否正常执行

### 问题：登录状态丢失
**解决方案**:
1. 将 `clearCookies` 设置为 `false`
2. 或者确保在清理后重新执行登录流程

### 问题：性能下降
**解决方案**:
1. 将 `clearCacheOnStart` 设置为 `false`
2. 只保留必要的清理选项
3. 调整清理频率
