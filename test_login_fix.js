// 测试登录修复的脚本
// 这个脚本用于测试修复后的"使用密码"选项识别逻辑

const { chromium } = require('playwright');

async function testLoginFix() {
    console.log('🚀 开始测试登录修复...');
    
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();
    
    try {
        // 1. 导航到登录页面
        console.log('📱 导航到登录页面...');
        await page.goto('https://rewards.bing.com/signin');
        await page.waitForLoadState('domcontentloaded');
        
        // 2. 输入邮箱
        console.log('📧 输入邮箱...');
        const emailInput = await page.waitForSelector('input[type="email"]');
        await emailInput.fill('test@example.com');
        
        // 3. 点击下一步
        const nextButton = await page.waitForSelector('button[type="submit"]');
        await nextButton.click();
        
        // 4. 等待页面加载
        await page.waitForTimeout(3000);
        
        // 5. 检查是否在验证电子邮件页面
        const pageTitle = await page.title();
        console.log(`📄 当前页面标题: ${pageTitle}`);
        
        if (pageTitle.includes('验证你的电子邮件') || pageTitle.includes('Verify your email')) {
            console.log('✅ 成功进入验证电子邮件页面');
            
            // 6. 测试不同的选择器方法
            console.log('🔍 测试选择器方法...');
            
            // 方法1: role="button"
            const roleButtonElements = await page.locator('[role="button"]:has-text("使用密码"), [role="button"]:has-text("Use your password")').count();
            console.log(`📊 找到 ${roleButtonElements} 个role="button"类型的"使用密码"元素`);
            
            // 方法2: span标签
            const spanElements = await page.locator('span:has-text("使用密码"), span:has-text("Use your password")').count();
            console.log(`📊 找到 ${spanElements} 个span类型的"使用密码"元素`);
            
            // 方法3: 宽松匹配
            const anyElements = await page.locator('*:has-text("使用密码"), *:has-text("Use your password")').count();
            console.log(`📊 找到 ${anyElements} 个宽松匹配的"使用密码"元素`);
            
            // 7. 尝试点击第一个可见的元素
            if (roleButtonElements > 0) {
                console.log('🖱️ 尝试点击role="button"元素...');
                const firstElement = page.locator('[role="button"]:has-text("使用密码"), [role="button"]:has-text("Use your password")').first();
                
                if (await firstElement.isVisible()) {
                    await firstElement.click();
                    console.log('✅ 成功点击role="button"元素');
                    
                    // 等待页面跳转
                    await page.waitForTimeout(3000);
                    
                    // 检查是否跳转到密码输入页面
                    const passwordInput = await page.waitForSelector('input[type="password"]', { timeout: 5000 }).catch(() => null);
                    if (passwordInput) {
                        console.log('🎉 成功跳转到密码输入页面！');
                    } else {
                        console.log('❌ 页面跳转失败');
                    }
                } else {
                    console.log('⚠️ 元素不可见');
                }
            }
            
        } else {
            console.log('❌ 未进入验证电子邮件页面');
        }
        
    } catch (error) {
        console.error('❌ 测试过程中发生错误:', error.message);
    } finally {
        // 等待一段时间以便观察结果
        console.log('⏳ 等待10秒后关闭浏览器...');
        await new Promise(resolve => setTimeout(resolve, 10000));
        await browser.close();
    }
}

// 运行测试
testLoginFix().catch(console.error);
