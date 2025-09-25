# 浏览器缓存管理功能实现总结

## 问题描述

用户报告 `mic-bot-node` 在执行过程中出现 `chrome-error://chromewebdata/` 错误，导致搜索结果页面加载超时和任务执行失败。

## 解决方案

我们为 `mic-bot-node` 添加了完整的浏览器缓存管理功能，包括：

### 1. 浏览器启动参数优化

在 `Browser.ts` 中添加了更多缓存清理相关的启动参数：

```typescript
// 缓存清理相关参数
'--disable-background-timer-throttling',
'--disable-backgrounding-occluded-windows',
'--disable-renderer-backgrounding',
'--disable-background-networking',
'--disable-default-apps',
'--disable-extensions',
'--disable-sync',
'--disable-plugins',
'--disable-plugins-discovery',
'--disable-preconnect',
'--disable-hang-monitor',
'--disable-prompt-on-repost',
'--disable-domain-reliability',
'--disable-component-extensions-with-background-pages',
'--disable-background-downloads',
'--disable-client-side-phishing-detection',
'--disable-component-update',
'--disable-features=TranslateUI,BlinkGenPropertyTrees',
'--disable-ipc-flooding-protection',
'--disable-logging',
'--disable-permissions-api',
'--disable-popup-blocking',
'--disable-prompt-on-repost',
'--disable-sync-preferences',
'--disable-web-resources',
'--disable-features=VizDisplayCompositor,TranslateUI',
'--aggressive-cache-discard',
'--memory-pressure-off',
'--max_old_space_size=4096'
```

### 2. 智能缓存清理机制

在 `Browser.ts` 的 `createContext` 方法中添加了启动时缓存清理：

```typescript
// 根据配置清理浏览器缓存和存储
const cacheConfig = this.bot.config.cacheManagement;
if (cacheConfig?.clearCacheOnStart) {
    // 清理页面级别的存储
    await page.evaluate(() => {
        // 清理 localStorage, sessionStorage, IndexedDB, Cache API
    });
    
    // 清理浏览器上下文级别的数据
    if (cacheConfig.clearCookies) {
        await context.clearCookies();
    }
    if (cacheConfig.clearPermissions) {
        await context.clearPermissions();
    }
}
```

### 3. Chrome-Error 检测和处理

在 `BrowserFunc.ts` 中添加了专门的错误处理机制：

#### `clearPageCache` 方法
- 清理页面级别的所有存储数据
- 支持选择性清理（根据配置）
- 包含错误处理和日志记录

#### `handleChromeError` 方法
- 自动检测 `chrome-error://` 和 `chromewebdata` 页面
- 根据配置决定是否自动清理缓存
- 尝试重新导航到原始URL
- 验证恢复是否成功

#### `gotoWithRetry` 方法增强
- 在页面导航后检查是否出现 chrome-error
- 自动触发缓存清理和重试机制

### 4. 搜索任务中的错误检测

在 `index.ts` 的搜索任务中添加了 chrome-error 检测：

```typescript
// 检测并处理 chrome-error 页面
const currentUrl = page.url();
if (currentUrl.includes('chrome-error://') || currentUrl.includes('chromewebdata')) {
    log('main', '主流程', `[${account.email}] 检测到 chrome-error 页面: ${currentUrl}，尝试恢复...`, 'warn');
    const recovered = await bot.browser.func.handleChromeError(page, 'https://www.bing.com');
    if (!recovered) {
        log('main', '主流程', `[${account.email}] 无法从 chrome-error 页面恢复，跳过此账户`, 'error');
        return false;
    }
}
```

### 5. 配置系统

在 `Config.ts` 中添加了 `ConfigCacheManagement` 接口：

```typescript
export interface ConfigCacheManagement {
    clearCacheOnStart: boolean;           // 启动时清理缓存
    autoClearOnChromeError: boolean;      // 检测到错误时自动清理
    clearLocalStorage: boolean;           // 清理 localStorage
    clearSessionStorage: boolean;         // 清理 sessionStorage
    clearIndexedDB: boolean;              // 清理 IndexedDB
    clearCacheAPI: boolean;               // 清理 Cache API
    clearCookies: boolean;                // 清理 Cookies
    clearPermissions: boolean;            // 清理权限
}
```

## 使用方法

### 1. 配置文件设置

在 `config.json` 中添加缓存管理配置：

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

### 2. 自动处理

系统会自动：
- 在启动时清理缓存（如果启用）
- 检测 chrome-error 页面
- 自动清理缓存并重试
- 记录详细的处理日志

## 预期效果

1. **减少 chrome-error 错误**: 通过主动清理缓存，减少浏览器缓存损坏导致的错误
2. **提高任务成功率**: 自动检测和恢复机制确保任务能够正常执行
3. **更好的稳定性**: 预防性缓存清理提高整体系统稳定性
4. **详细的日志**: 完整的日志记录便于问题诊断和调试

## 注意事项

1. **性能影响**: 频繁的缓存清理可能会影响性能，建议根据实际情况调整配置
2. **会话保持**: 清理 Cookies 可能会影响登录状态，请谨慎配置
3. **调试模式**: 在调试时可以禁用某些清理选项来保留调试信息

## 相关文件

- `mic-bot-node/app/src/browser/Browser.ts` - 浏览器启动和上下文创建
- `mic-bot-node/app/src/browser/BrowserFunc.ts` - 缓存清理和错误处理
- `mic-bot-node/app/src/interface/Config.ts` - 配置接口定义
- `mic-bot-node/app/src/index.ts` - 搜索任务中的错误检测
- `mic-bot-node/docs/CACHE_MANAGEMENT.md` - 详细配置说明
