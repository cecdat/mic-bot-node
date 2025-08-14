import { Page } from 'rebrowser-playwright'
import * as crypto from 'crypto'
import { AxiosRequestConfig } from 'axios'
import fs from 'fs'
import path from 'path'
import { MicrosoftRewardsBot } from '../index'
import { saveSessionData } from '../util/Load'
import { OAuth } from '../interface/OAuth'

export const LoginStatusCode = {
    Success: 0,
    PasswordError: 1,
    Locked: 2,
    VerificationRequired: 3,
    AuthorizationRequired: 4, // 2FA
    GenericFailure: 99
};

export class Login {
    private bot: MicrosoftRewardsBot

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot
    }

    private async gotoWithRetry(page: Page, url: string, retries = 3) {
        for (let i = 0; i < retries; i++) {
            try {
                const navigationTimeoutMs = this.bot.utils.stringToMs(this.bot.config.navigationTimeout);
                await page.goto(url, { timeout: navigationTimeoutMs, waitUntil: 'domcontentloaded' });
                return;
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                this.bot.log(this.bot.isMobile, '页面导航', `导航到 ${url} 失败，尝试次数 ${i + 1}/${retries}。错误: ${errorMessage}`, 'warn');
                if (i === retries - 1) throw error;
                await this.bot.utils.wait(3000);
            }
        }
    }

    async login(page: Page, email: string, password: string) {
        const platformType = this.bot.isMobile ? 'mobile' : 'pc';
        try {
            this.bot.log(this.bot.isMobile, '登录', `[${email}] 开始登录流程！`);
            await this.gotoWithRetry(page, 'https://rewards.bing.com/signin');
            await page.waitForLoadState('domcontentloaded').catch(() => { });
            // 截图：初始登录页面
            await this.saveSnapshot(page, email, `initial_login_page_${Date.now()}.html`);
            await this.bot.browser.utils.reloadBadPage(page);
            await this.checkAccountLocked(page, email);
            const isLoggedIn = await page.waitForSelector('html[data-role-name="RewardsPortal"]', { timeout: 10000 }).then(() => true).catch(() => false);

            if (isLoggedIn) {
                this.bot.log(this.bot.isMobile, '登录', `[${email}] 会话有效，已经处于登录状态`);
                await this.bot.sendStatusUpdate(platformType, true, LoginStatusCode.Success, '会话有效');
                await this.checkAccountLocked(page, email);
            } else {
                await this.execLogin(page, email, password);
            }
            await saveSessionData(this.bot.config.sessionPath, page.context(), email, this.bot.isMobile);
            this.bot.log(this.bot.isMobile, '登录', `[${email}] 登录流程成功，并已保存登录会话！`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '登录', `[${email}] 登录流程发生错误: ${errorMessage}`, 'error');
            
            let code = LoginStatusCode.GenericFailure;
            if (errorMessage.includes('密码不正确')) code = LoginStatusCode.PasswordError;
            if (errorMessage.includes('此账户已被锁定')) code = LoginStatusCode.Locked;
            
            await this.bot.sendStatusUpdate(platformType, false, code, errorMessage);
            throw new Error(errorMessage);
        }
    }

    private async execLogin(page: Page, email: string, password: string) {
        const platformType = this.bot.isMobile ? 'mobile' : 'pc';
        try {
            await this.enterEmail(page, email);
            // 截图：邮箱输入后页面
            await this.saveSnapshot(page, email, `email_entered_page_${Date.now()}.html`);
            await this.bot.utils.wait(3000);
            await this.bot.browser.utils.reloadBadPage(page);
            await this.bot.utils.wait(2000);

            // [最终修复方案 - 基于HTML快照分析]
            this.bot.log(this.bot.isMobile, '登录', '正在检查“Use your password”登录选项...');
            
            // 根据快照，按钮的文本是英文的 "Use your password"
            const usePasswordButton = page.getByRole('button', { name: 'Use your password', exact: true });
            
            try {
                // 等待按钮出现，如果7秒内没出现则认为不需要此步骤
                await usePasswordButton.waitFor({ state: 'visible', timeout: 7000 });
                
                this.bot.log(this.bot.isMobile, '登录', '检测到“Use your password”选项，正在点击...');
                await usePasswordButton.click();
                await this.bot.utils.wait(3000); // 等待页面跳转

            } catch (e) {
                // 如果按钮未出现，这是正常情况，直接继续
                this.bot.log(this.bot.isMobile, '登录', '未找到“Use your password”按钮，将直接尝试输入密码。');
            }
            // [修复结束]

            await this.enterPassword(page, password);
            // 截图：密码输入后页面
            await this.saveSnapshot(page, email, `password_entered_page_${Date.now()}.html`);
            await this.checkLoggedIn(page, email);
            await this.bot.sendStatusUpdate(platformType, true, LoginStatusCode.Success, '登录成功');
            this.bot.log(this.bot.isMobile, '登录', `[${email}] 成功登录到微软账户`);
        } catch (error) {
            throw error;
        }
    }

    private async enterEmail(page: Page, email: string) {
        const emailInputSelector = 'input[type="email"]';
        try {
            const emailField = await page.waitForSelector(emailInputSelector, { state: 'visible', timeout: 2000 }).catch(() => null);
            if (!emailField) {
                this.bot.log(this.bot.isMobile, '登录', `[${email}] 未找到邮箱输入框`, 'warn');
                return;
            }
            await this.bot.utils.wait(1000);
            const emailPrefilled = await page.waitForSelector('#userDisplayName', { timeout: 5000 }).catch(() => null);
            if (emailPrefilled) {
                this.bot.log(this.bot.isMobile, '登录', `[${email}] 邮箱已被微软预填`);
            } else {
                await page.fill(emailInputSelector, '');
                await this.bot.utils.wait(500);
                await page.fill(emailInputSelector, email);
                await this.bot.utils.wait(1000);
            }
            const nextButton = await page.waitForSelector('button[type="submit"]', { timeout: 2000 }).catch(() => null);
            if (nextButton) {
                await nextButton.click();
                await this.bot.utils.wait(3000);
                await this.handleVerifyEmailPage(page, email);
                this.bot.log(this.bot.isMobile, '登录', `[${email}] 邮箱输入成功`);
            } else {
                this.bot.log(this.bot.isMobile, '登录', `[${email}] 输入邮箱后未找到“下一步”按钮`, 'warn');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '登录', `[${email}] 邮箱输入失败: ${errorMessage}`, 'error');
        }
    }

    private async enterPassword(page: Page, password: string) {
        const passwordInputSelector = 'input[type="password"]';
        try {
            const passwordField = await page.waitForSelector(passwordInputSelector, { state: 'visible', timeout: 5000 }).catch(() => null);
            if (!passwordField) {
                this.bot.log(this.bot.isMobile, '登录', '未找到密码输入框，可能需要2FA验证。', 'warn');
                await this.handle2FA(page);
                return;
            }
            await this.bot.utils.wait(1000);
            await page.fill(passwordInputSelector, '');
            await this.bot.utils.wait(500);
            await page.fill(passwordInputSelector, password);
            await this.bot.utils.wait(1000);
            const nextButton = await page.waitForSelector('button[type="submit"]', { timeout: 2000 }).catch(() => null);
            if (nextButton) {
                await nextButton.click();
                await this.bot.utils.wait(2000);
                this.bot.log(this.bot.isMobile, '登录', '密码输入成功');
            } else {
                this.bot.log(this.bot.isMobile, '登录', '输入密码后未找到“下一步”按钮', 'warn');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '登录', `密码输入失败: ${errorMessage}`, 'error');
            await this.handle2FA(page);
        }
    }

    private async handle2FA(page: Page) {
        const platformType = this.bot.isMobile ? 'mobile' : 'pc';
        try {
            await this.bot.sendStatusUpdate(platformType, false, LoginStatusCode.AuthorizationRequired, '需要2FA/授权');
            const numberToPress = await this.get2FACode(page);
            await this.authAppVerification(page, numberToPress);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '登录', `2FA处理失败: ${errorMessage}`, 'error');
        }
    }

    private async get2FACode(page: Page): Promise<string | null> {
        this.bot.log(this.bot.isMobile, '登录', '正在尝试捕获无密码登录授权码...');
        try {
            const codeHandle = await page.waitForFunction(() => {
                const element = document.querySelector('[data-testid="displaySign"] span');
                if (element && element.textContent && element.textContent.trim() !== '') {
                    return element.textContent.trim();
                }
                return false;
            }, { timeout: 15000 });
            const code = await codeHandle.jsonValue() as string;
            this.bot.log(this.bot.isMobile, '登录', `成功捕获到授权码: ${code}`);
            return code;
        } catch (error) {
            this.bot.log(this.bot.isMobile, '登录', `未能自动捕获到授权码。`, 'warn');
            return null;
        }
    }
    
    private async authAppVerification(page: Page, numberToPress: string | null) {
        if (!numberToPress) {
            this.bot.log(this.bot.isMobile, '登录', '无法自动读取验证码，等待用户手动批准...');
        } else {
            const accountEmail = await page.evaluate(() => (document.querySelector('#bannerText') as HTMLElement | null)?.innerText || '未知账号');
            this.bot.log(this.bot.isMobile, '登录', `账号: ${accountEmail}，请在您的 Authenticator 应用中按下数字 ${numberToPress} 以批准登录`);
        }

        while (true) {
            let approvalSuccess = false;
            const startTime = Date.now();
            const timeout = 60000;

            this.bot.log(this.bot.isMobile, '登录', '正在等待应用批准... (超时时间60秒)');

            while (Date.now() - startTime < timeout) {
                if (page.url().includes('rewards.bing.com')) {
                    this.bot.log(this.bot.isMobile, '登录', '检测到URL已跳转，登录已批准！');
                    approvalSuccess = true;
                    break;
                }
                await this.bot.utils.wait(2000);
            }

            if (approvalSuccess) {
                break;
            }

            this.bot.log(this.bot.isMobile, '登录', '等待批准超时。将尝试获取新验证码...', 'warn');
            await page.click('[data-testid="viewFooter"] span').catch(() => {});
            const newNumber = await this.get2FACode(page);
            if(newNumber) {
                numberToPress = newNumber;
                const accountEmail = await page.evaluate(() => (document.querySelector('#bannerText') as HTMLElement | null)?.innerText || '未知账号');
                this.bot.log(this.bot.isMobile, '登录', `账号: ${accountEmail}，新的验证码: ${newNumber}。请在应用中输入。`);
            } else {
                 this.bot.log(this.bot.isMobile, '登录', '无法获取新的验证码，请检查手机或手动操作。', 'error');
                 break; 
            }
        }
    }

    async getMobileAccessToken(page: Page, email: string): Promise<string> {
        const authorizeUrl = new URL('https://login.live.com/oauth20_authorize.srf');
        authorizeUrl.searchParams.append('response_type', 'code');
        authorizeUrl.searchParams.append('client_id', '0000000040170455');
        authorizeUrl.searchParams.append('redirect_uri', 'https://login.live.com/oauth20_desktop.srf');
        authorizeUrl.searchParams.append('scope', 'service::prod.rewardsplatform.microsoft.com::MBI_SSL');
        authorizeUrl.searchParams.append('state', crypto.randomBytes(16).toString('hex'));
        authorizeUrl.searchParams.append('access_type', 'offline_access');
        authorizeUrl.searchParams.append('login_hint', email);
        
        await this.gotoWithRetry(page, authorizeUrl.href);

        let currentUrl = new URL(page.url());
        let code: string;
        this.bot.log(this.bot.isMobile, '登录-APP', '等待授权...');
        while (true) {
            if (currentUrl.hostname === 'login.live.com' && currentUrl.pathname === '/oauth20_desktop.srf') {
                code = currentUrl.searchParams.get('code')!;
                break;
            }
            await this.bot.utils.wait(5000);
            currentUrl = new URL(page.url());
        }
        const body = new URLSearchParams();
        body.append('grant_type', 'authorization_code');
        body.append('client_id', '0000000040170455');
        body.append('code', code);
        body.append('redirect_uri', 'https://login.live.com/oauth20_desktop.srf');
        const tokenRequest: AxiosRequestConfig = {
            url: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            data: body.toString()
        };
        const tokenResponse = await this.bot.axios.request(tokenRequest);
        const tokenData: OAuth = await tokenResponse.data;
        this.bot.log(this.bot.isMobile, '登录-APP', '授权成功');
        return tokenData.access_token;
    }

    private async checkLoggedIn(page: Page, email: string) {
        this.bot.log(this.bot.isMobile, '登录', `[${email}] 正在验证登录后状态...`);
        try {
            // 增强导航等待逻辑，增加更多成功条件
            const navigationPromise = page.waitForURL(url => {
                return url.href.includes('rewards.bing.com') || 
                       url.href.includes('bing.com/rewards') || 
                       url.href.includes('login.live.com/oauth20_desktop.srf');
            }, {
                timeout: 90000,  // 增加超时时间
                waitUntil: 'domcontentloaded'  // 修复类型不匹配问题
            });
    
            const intermediatePageHandler = (async () => {
                while (!page.isClosed() && !page.url().includes('rewards.bing.com')) {
                    await this.dismissLoginMessages(page, email);
                    await this.handleVerifyEmailPage(page, email);
                    await this.handleOtherVerificationPages(page, email);  // 增加新的验证页面处理
                    await this.bot.utils.wait(1000);
                }
            })();

            await Promise.race([navigationPromise, intermediatePageHandler]);

            // 截图：登录成功后页面
            await this.saveSnapshot(page, email, `post_login_snapshot_${Date.now()}.html`);
            await page.waitForSelector('html[data-role-name="RewardsPortal"]', { timeout: 10000 });
            this.bot.log(this.bot.isMobile, '登录', `[${email}] 成功登录到奖励门户`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '登录', `[${email}] 验证登录状态时超时或失败: ${errorMessage}`, 'error');
            // 截图：登录失败页面
            await this.saveSnapshot(page, email, `login_failure_snapshot_${Date.now()}.html`);
            throw new Error(`[${email}] 验证登录状态失败: ${errorMessage}`);
        }
    }

    private async dismissLoginMessages(page: Page, email: string) {
        // 处理"保持登录状态"弹窗
        const staySignedInButton = page.locator('[data-testid="primaryButton"]');
        if (await staySignedInButton.isVisible({ timeout: 1000 })) {
            await staySignedInButton.click();
            this.bot.log(this.bot.isMobile, '关闭消息', `[${email}] 点击了“保持登录状态”弹窗中的“是”`);
            await page.waitForTimeout(500);
        }
        
        // 处理"使用Passkey"弹窗
        const usePasskeyButton = page.locator('[data-testid="secondaryButton"]');
        if (await usePasskeyButton.isVisible({ timeout: 1000 })) {
            await usePasskeyButton.click();
            this.bot.log(this.bot.isMobile, '关闭消息', `[${email}] 关闭了 "使用Passekey" 弹窗`);
            await page.waitForTimeout(500);
        }
        
        // 处理"更新个人资料"弹窗
        const updateProfileButton = page.locator('button:has-text("以后再说"), button:has-text("Remind me later")');
        if (await updateProfileButton.isVisible({ timeout: 1000 })) {
            await updateProfileButton.click();
            this.bot.log(this.bot.isMobile, '关闭消息', `[${email}] 关闭了 "更新个人资料" 弹窗`);
            await page.waitForTimeout(500);
        }
        
        // 处理"通知权限"弹窗
        const notificationButton = page.locator('button:has-text("拒绝"), button:has-text("Deny")');
        if (await notificationButton.isVisible({ timeout: 1000 })) {
            await notificationButton.click();
            this.bot.log(this.bot.isMobile, '关闭消息', `[${email}] 关闭了 "通知权限" 弹窗`);
            await page.waitForTimeout(500);
        }
        
        // 处理Cookie同意弹窗
        const acceptCookiesButton = page.locator('button:has-text("接受"), button:has-text("Accept")');
        if (await acceptCookiesButton.isVisible({ timeout: 1000 })) {
            await acceptCookiesButton.click();
            this.bot.log(this.bot.isMobile, '关闭消息', `[${email}] 关闭了 "Cookie同意" 弹窗`);
            await page.waitForTimeout(500);
        }
    }
    
    private async handleVerifyEmailPage(page: Page, email: string) {
        const platformType = this.bot.isMobile ? 'mobile' : 'pc';
        // 同时检测页面标题和h1标签
        const pageTitle = await page.title();
        const verifyEmailTitle = page.locator('h1:has-text("验证你的电子邮件"), h1:has-text("Verify your email")');
        
        if (pageTitle.includes("验证你的电子邮件") || await verifyEmailTitle.isVisible({ timeout: 2000 })) {
            // 截图：验证电子邮件页面
            await this.saveSnapshot(page, email, `verify_email_page_${Date.now()}.html`);
            this.bot.log(this.bot.isMobile, '登录', `[${email}] 检测到“验证电子邮件”页面`);
            await this.bot.sendStatusUpdate(platformType, false, LoginStatusCode.VerificationRequired, '需要邮件验证');
            // 尝试找到并点击"使用密码"选项（支持多种元素类型和文本变体）
            // 1. 首先尝试直接匹配包含'使用密码'的所有可见元素
            // 扩大匹配范围，包含更多可能的文本变体和元素类型
            const usePasswordOptions = page.locator(
                'div:has-text("已收到代码？") + div >> *, '
                + 'div:has-text("Already have a code?") + div >> *, '
                + '*:has-text("使用密码"), *:has-text("Use your password"), '
                + '*:has-text("密码登录"), *:has-text("Password login"), '
                + '*:has-text("账号密码登录"), *:has-text("Sign in with password")'
            ).filter({ visible: true });

            // 增加超时时间并添加详细日志
            if (await usePasswordOptions.isVisible({ timeout: 8000 })) {
                // 输出所有匹配元素的文本，用于调试
                const optionsCount = await usePasswordOptions.count();
                for (let i = 0; i < optionsCount; i++) {
                    const text = await usePasswordOptions.nth(i).textContent();
                    this.bot.log(this.bot.isMobile, '登录', `[${email}] 找到匹配元素 ${i+1}/${optionsCount}: ${text}`, 'log');
                }
                // 确保元素在视口中
                await usePasswordOptions.first().scrollIntoViewIfNeeded();
                await usePasswordOptions.first().click();
                this.bot.log(this.bot.isMobile, '登录', `[${email}] 点击了匹配的'使用密码'选项`, 'log');
                await this.bot.utils.wait(3000);
                return;
            } else {
                const optionsCount = await usePasswordOptions.count();
                this.bot.log(this.bot.isMobile, '登录', `[${email}] 未找到可见的'使用密码'相关选项，共找到 ${optionsCount} 个潜在匹配元素`, 'warn');
            }
            
            // 2. 如果直接匹配失败，尝试使用包含文本的方式查找按钮和链接
            this.bot.log(this.bot.isMobile, '登录', `[${email}] 尝试使用包含文本方式查找"使用密码"选项`, 'log');
            
            // 查找所有按钮
            const allButtons = page.locator('button');
            const buttonCount = await allButtons.count();
            
            for (let i = 0; i < buttonCount; i++) {
                const button = allButtons.nth(i);
                const text = await button.textContent();
                
                if (text && (text.includes('密码') || text.toLowerCase().includes('password'))) {
                    this.bot.log(this.bot.isMobile, '登录', `[${email}] 找到可能的密码登录按钮: ${text}`, 'log');
                    // 确保按钮可见
                    await button.waitFor({ state: 'visible', timeout: 1000 });
                    // 滚动到按钮
                    await button.scrollIntoViewIfNeeded();
                    await button.click();
                    await this.bot.utils.wait(3000);
                    return;
                }
            }
            
            // 查找所有链接
            const allLinks = page.locator('a');
            const linkCount = await allLinks.count();
            
            for (let i = 0; i < linkCount; i++) {
                const link = allLinks.nth(i);
                const text = await link.textContent();
                
                if (text && (text.includes('密码') || text.toLowerCase().includes('password'))) {
                    this.bot.log(this.bot.isMobile, '登录', `[${email}] 找到可能的密码登录链接: ${text}`, 'log');
                    // 确保链接可见
                    await link.waitFor({ state: 'visible', timeout: 1000 });
                    // 滚动到链接
                    await link.scrollIntoViewIfNeeded();
                    await link.click();
                    await this.bot.utils.wait(3000);
                    return;
                }
            }
            
            this.bot.log(this.bot.isMobile, '登录', `[${email}] 未找到任何包含密码相关文本的选项`, 'warn');
        }
    }

    /**
     * 处理其他类型的验证页面
     */
    private async handleOtherVerificationPages(page: Page, email: string) {
        const platformType = this.bot.isMobile ? 'mobile' : 'pc';
        
        // 检测是否有密码错误
        const invalidPassword = page.locator(':text("That password isn\'t correct"), :text("密码不正确")');
        if (await invalidPassword.isVisible({ timeout: 1000 })) {
            // 截图：密码错误页面
            await this.saveSnapshot(page, email, `invalid_password_page_${Date.now()}.html`);
            this.bot.log(this.bot.isMobile, '登录', `[${email}] 检测到密码错误`);
            await this.bot.sendStatusUpdate(platformType, false, LoginStatusCode.PasswordError, '密码不正确');
            throw new Error(`[${email}] 密码不正确`);
        }

        // 检测是否有安全验证页面
        const securityVerificationTitle = page.locator('h1:has-text("安全验证"), h1:has-text("Security Verification")');
        if (await securityVerificationTitle.isVisible({ timeout: 1000 })) {
            // 截图：安全验证页面
            await this.saveSnapshot(page, email, `security_verification_page_${Date.now()}.html`);
            this.bot.log(this.bot.isMobile, '登录', `[${email}] 检测到“安全验证”页面`);
            await this.bot.sendStatusUpdate(platformType, false, LoginStatusCode.VerificationRequired, '需要安全验证');
            
            // 尝试找到并点击"使用其他方式"链接
            const useOtherMethodLink = page.locator('a:has-text("使用其他方式"), a:has-text("Use another method")');
            if (await useOtherMethodLink.isVisible()) {
                await useOtherMethodLink.click();
                await this.bot.utils.wait(2000);
            }
        }
        
        // 检测是否有账号恢复页面
        const accountRecoveryTitle = page.locator('h1:has-text("恢复你的账户"), h1:has-text("Recover your account")');
        if (await accountRecoveryTitle.isVisible({ timeout: 1000 })) {
            // 截图：账户恢复页面
            await this.saveSnapshot(page, email, `account_recovery_page_${Date.now()}.html`);
            this.bot.log(this.bot.isMobile, '登录', `[${email}] 检测到“账户恢复”页面`);
            await this.bot.sendStatusUpdate(platformType, false, LoginStatusCode.Locked, '账户需要恢复');
        }
        
        // 检测是否有验证码输入页面
        const captchaInput = page.locator('input[id*="captcha"], input[aria-label*="验证码"]');
        if (await captchaInput.isVisible({ timeout: 1000 })) {
            // 截图：验证码页面
            await this.saveSnapshot(page, email, `captcha_page_${Date.now()}.html`);
            this.bot.log(this.bot.isMobile, '登录', `[${email}] 检测到验证码页面`);
            await this.bot.sendStatusUpdate(platformType, false, LoginStatusCode.VerificationRequired, '需要输入验证码');
            
            // 在调试模式下保存快照
            if (this.bot.config.debug) {
                await this.saveSnapshot(page, email, 'captcha_snapshot.html');
            }
        }
    }

    private async saveSnapshot(page: Page, email: string, filename: string) {
        // 提取文件名（不含扩展名）
        const baseFilename = filename.replace(/\.html$/, '');
        this.bot.log(this.bot.isMobile, '调试模式', `[${email}] 正在保存页面快照...`, 'warn');
        try {
            await this.bot.utils.wait(2000);
            const sessionDir = path.join(__dirname, '..', '..', this.bot.config.sessionPath, email);
            if (!fs.existsSync(sessionDir)) {
                fs.mkdirSync(sessionDir, { recursive: true });
            }

            // 保存HTML格式（保持原有功能）
            const htmlContent = await page.content();
            const htmlSnapshotPath = path.join(sessionDir, `${baseFilename}.html`);
            fs.writeFileSync(htmlSnapshotPath, htmlContent);
            this.bot.log(this.bot.isMobile, '调试模式', `HTML快照已成功保存到: ${htmlSnapshotPath}`, 'log', 'green');

            // 保存图片格式（新增功能）
            const imageSnapshotPath = path.join(sessionDir, `${baseFilename}.png`);
            await page.screenshot({
                path: imageSnapshotPath,
                fullPage: true
            });
            this.bot.log(this.bot.isMobile, '调试模式', `图片快照已成功保存到: ${imageSnapshotPath}`, 'log', 'green');
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            this.bot.log(this.bot.isMobile, '调试模式', `保存页面快照失败: ${errorMessage}`, 'error');
        }
    }

    private async checkAccountLocked(page: Page, email: string) {
        await this.bot.utils.wait(2000);
        const isLocked = await page.waitForSelector('#serviceAbuseLandingTitle', { state: 'visible', timeout: 1000 }).then(() => true).catch(() => false);
        if (isLocked) {
            const errorMsg = `[${email}] 此账户已被锁定！`;
            this.bot.log(this.bot.isMobile, '检查锁定', errorMsg, 'error');
            throw new Error(errorMsg);
        }
    }
}