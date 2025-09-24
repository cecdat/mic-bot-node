# 登录成功检测逻辑修复

## 问题描述

桌面端和移动端在验证码输入后，虽然实际上已经登录成功，但系统仍然判断为登录失败，导致进程强制退出。

### 具体问题

1. **验证码验证后判断错误**：验证码输入后，页面跳转到 `login.live.com` 的中间页面，系统误判为仍在登录页面
2. **登录状态验证超时**：`checkLoggedIn` 方法等待页面跳转到 `rewards.bing.com` 超时
3. **中间跳转处理不当**：没有正确处理登录过程中的中间跳转页面

## 修复方案

### 1. 优化验证码验证结果判断 (`VerificationCodeHandler.ts`)

#### 修复前的问题
```typescript
// 检查是否还在登录页面，如果是则可能验证失败
if (currentUrl.includes('login.live.com') || currentUrl.includes('login.microsoftonline.com')) {
    log('main', '验证码处理', '验证可能失败：仍在登录页面');
    return false;
}
```

#### 修复后的逻辑
```typescript
// 检查页面标题和内容来判断验证是否成功
const pageTitle = await page.title();
log('main', '验证码处理', `验证后页面标题: ${pageTitle}`);

// 如果页面标题包含成功相关的关键词，认为验证成功
if (pageTitle.includes('Microsoft Rewards') || 
    pageTitle.includes('Bing Rewards') ||
    pageTitle.includes('Rewards') ||
    pageTitle.includes('Dashboard') ||
    pageTitle.includes('Account')) {
    log('main', '验证码处理', '验证成功：页面标题显示已登录状态');
    return true;
}

// 检查是否还在登录页面，但需要更精确的判断
if (currentUrl.includes('login.live.com') || currentUrl.includes('login.microsoftonline.com')) {
    // 检查URL参数，如果包含route参数，可能是正常的跳转过程
    if (currentUrl.includes('route=') || currentUrl.includes('opid=')) {
        log('main', '验证码处理', '验证可能成功：URL包含跳转参数，等待进一步跳转');
        // 等待更长时间看是否会跳转
        await page.waitForTimeout(10000);
        const newUrl = page.url();
        if (newUrl !== currentUrl) {
            log('main', '验证码处理', `页面已跳转到: ${newUrl}`);
            if (newUrl.includes('rewards.bing.com') || newUrl.includes('bing.com')) {
                log('main', '验证码处理', '验证成功：页面已跳转到目标网站');
                return true;
            }
        }
    }
    
    // 如果页面标题不是登录相关，可能已经成功
    if (!pageTitle.toLowerCase().includes('sign in') && 
        !pageTitle.toLowerCase().includes('login') && 
        !pageTitle.toLowerCase().includes('登录')) {
        log('main', '验证码处理', '验证可能成功：页面标题不包含登录关键词');
        return true;
    }
}
```

### 2. 优化登录状态验证逻辑 (`Login.ts`)

#### 修复前的问题
```typescript
// 使用 Promise.race 等待导航，但可能超时
const navigationPromise = page.waitForURL((url: URL) => {
    return url.href.includes('rewards.bing.com') || 
           url.href.includes('bing.com/rewards') || 
           url.href.includes('login.live.com/oauth20_desktop.srf');
}, {
    timeout: 90000,
    waitUntil: 'domcontentloaded'
});
```

#### 修复后的逻辑
```typescript
// 首先等待一段时间让页面稳定
await page.waitForTimeout(3000);

// 检查当前页面状态
const currentUrl = page.url();
const pageTitle = await page.title();
this.bot.log(this.bot.isMobile, '登录', `[${email}] 当前页面URL: ${currentUrl}`);
this.bot.log(this.bot.isMobile, '登录', `[${email}] 当前页面标题: ${pageTitle}`);

// 如果已经在目标页面，直接返回成功
if (currentUrl.includes('rewards.bing.com') || currentUrl.includes('bing.com/rewards')) {
    this.bot.log(this.bot.isMobile, '登录', `[${email}] 已在目标页面，登录成功`);
    return;
}

// 处理中间页面和弹窗
let attempts = 0;
const maxAttempts = 30; // 最多等待30秒

while (attempts < maxAttempts && !page.isClosed()) {
    const url = page.url();
    const title = await page.title();
    
    // 检查是否已经到达目标页面
    if (url.includes('rewards.bing.com') || url.includes('bing.com/rewards')) {
        this.bot.log(this.bot.isMobile, '登录', `[${email}] 已跳转到目标页面: ${url}`);
        break;
    }
    
    // 处理各种中间页面和弹窗
    await this.dismissLoginMessages(page, email);
    await this.handleVerifyEmailPage(page, email);
    await this.handleOtherVerificationPages(page, email);
    
    // 检查页面是否包含成功登录的迹象
    if (title.includes('Microsoft Rewards') || 
        title.includes('Bing Rewards') || 
        title.includes('Rewards') ||
        title.includes('Dashboard')) {
        this.bot.log(this.bot.isMobile, '登录', `[${email}] 页面标题显示已登录: ${title}`);
        break;
    }
    
    // 如果URL包含跳转参数，说明正在跳转过程中
    if (url.includes('route=') || url.includes('opid=') || url.includes('contextid=')) {
        this.bot.log(this.bot.isMobile, '登录', `[${email}] 检测到跳转参数，等待跳转完成...`);
        await page.waitForTimeout(2000);
        attempts++;
        continue;
    }
    
    // 如果页面标题不包含登录相关关键词，可能已经成功
    if (!title.toLowerCase().includes('sign in') && 
        !title.toLowerCase().includes('login') && 
        !title.toLowerCase().includes('登录') &&
        !url.includes('login.live.com')) {
        this.bot.log(this.bot.isMobile, '登录', `[${email}] 页面状态显示可能已登录: ${title}`);
        break;
    }
    
    await this.bot.utils.wait(1000);
    attempts++;
}

// 最终检查：尝试访问rewards页面
if (!page.url().includes('rewards.bing.com')) {
    this.bot.log(this.bot.isMobile, '登录', `[${email}] 尝试直接访问rewards页面...`);
    try {
        await page.goto('https://rewards.bing.com', { 
            waitUntil: 'domcontentloaded', 
            timeout: 30000 
        });
        await page.waitForTimeout(3000);
    } catch (gotoError) {
        this.bot.log(this.bot.isMobile, '登录', `[${email}] 直接访问rewards页面失败: ${gotoError}`, 'warn');
    }
}
```

### 3. 增强登录状态检查 (`Workers.ts`)

现有的 `checkLoginStatus` 方法已经比较完善，包含多种检查方式：
- 检查用户头像或账户信息
- 检查Microsoft Rewards特定的用户信息元素
- 检查用户邮箱信息
- 检查注销链接
- 检查URL中的用户信息
- 检查积分信息
- 检查Microsoft账户相关元素
- 检查活动相关元素

## 修复效果

### 修复前的问题
```
[2025/9/22 13:50:14] [PID: 20] [LOG] 主进程 [验证码处理] 验证后页面URL: https://login.live.com/ppsecure/post.srf?client_id=...
[2025/9/22 13:50:14] [PID: 20] [LOG] 主进程 [验证码处理] 验证可能失败：仍在登录页面
[2025/9/22 13:50:14] [PID: 20] [LOG] 主进程 [验证码处理] [pc] 账户 hezimu66@outlook.com 验证码验证失败
```

### 修复后的预期效果
```
[2025/9/22 13:50:14] [PID: 20] [LOG] 主进程 [验证码处理] 验证后页面URL: https://login.live.com/ppsecure/post.srf?client_id=...
[2025/9/22 13:50:14] [PID: 20] [LOG] 主进程 [验证码处理] 验证后页面标题: Microsoft Rewards
[2025/9/22 13:50:14] [PID: 20] [LOG] 主进程 [验证码处理] 验证成功：页面标题显示已登录状态
[2025/9/22 13:50:14] [PID: 20] [LOG] 主进程 [验证码处理] [pc] 账户 hezimu66@outlook.com 验证码验证成功
```

## 关键改进点

1. **更智能的页面状态判断**：不仅检查URL，还检查页面标题和内容
2. **中间跳转处理**：正确处理登录过程中的中间跳转页面
3. **多重验证机制**：使用多种方式验证登录状态
4. **容错性增强**：即使某些检查失败，也会尝试其他方式
5. **详细日志记录**：提供更详细的调试信息

## 测试建议

1. **桌面端测试**：测试完整的登录流程，包括验证码输入
2. **移动端测试**：测试移动端的登录流程
3. **边界情况测试**：测试各种网络条件和页面加载情况
4. **日志监控**：观察修复后的日志输出，确认判断逻辑正确

## 部署说明

1. 更新代码到远程服务器
2. 重新构建 mic-bot-node 容器
3. 重启容器服务
4. 观察登录流程日志，确认修复效果

---

*修复日期: 2024-12-19*
*修复版本: 1.5.3.1*
