import { Page } from 'rebrowser-playwright'
import * as crypto from 'crypto'
import { AxiosRequestConfig } from 'axios'
import fs from 'fs'
import path from 'path'
import { MicrosoftRewardsBot } from '../index'
import { saveSessionData } from '../util/Load'
import { OAuth } from '../interface/OAuth'
import { VerificationCodeHandler } from '../util/VerificationCodeHandler'

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
    private lastLoginStatus: Map<string, { status: boolean; code: number; message: string; timestamp: number }> = new Map()

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot
    }

    /**
     * 智能发送登录状态更新，避免重复推送
     */
    private async sendSmartStatusUpdate(platformType: 'pc' | 'mobile', status: boolean, code: number, message: string, email: string): Promise<void> {
        const key = `${email}_${platformType}`;
        const now = Date.now();
        const lastStatus = this.lastLoginStatus.get(key);
        
        // 如果状态没有变化，且距离上次推送不到5分钟，则跳过推送
        if (lastStatus && 
            lastStatus.status === status && 
            lastStatus.code === code && 
            lastStatus.message === message &&
            (now - lastStatus.timestamp) < 5 * 60 * 1000) { // 5分钟
            this.bot.log(this.bot.isMobile, '登录', `[${email}] 🔄 状态未变化，跳过重复推送`);
            return;
        }
        
        // 更新缓存并发送推送
        this.lastLoginStatus.set(key, { status, code, message, timestamp: now });
        await this.bot.sendStatusUpdate(platformType, status, code, message);
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

    private async checkSessionValidity(page: Page, email: string): Promise<boolean> {
        try {
            // 检查是否有保存的cookies
            const cookies = await page.context().cookies();
            if (cookies.length === 0) {
                this.bot.log(this.bot.isMobile, '登录', `[${email}] 🍪 无保存的cookies，需要重新登录`);
                return false;
            }

            // 检查是否有关键的Microsoft cookies
            const hasMicrosoftCookies = cookies.some((cookie: any) => 
                cookie.name.includes('WLSSC') || 
                cookie.name.includes('RPSSecAuth') || 
                cookie.name.includes('MUID') ||
                cookie.name.includes('_EDGE_S')
            );

            if (!hasMicrosoftCookies) {
                this.bot.log(this.bot.isMobile, '登录', `[${email}] 🍪 缺少关键Microsoft cookies，需要重新登录`);
                return false;
            }

            // 尝试访问rewards页面检查会话是否有效
            await this.gotoWithRetry(page, 'https://rewards.bing.com/');
            await page.waitForLoadState('domcontentloaded').catch(() => {});
            
            // 检查是否直接跳转到登录页面
            const currentUrl = page.url();
            if (currentUrl.includes('login.live.com') || currentUrl.includes('signin.live.com')) {
                this.bot.log(this.bot.isMobile, '登录', `[${email}] ⏰ 会话已过期，重定向到登录页面`);
                return false;
            }

            // 检查是否在rewards页面且已登录
            const isLoggedIn = await this.checkLoggedInStatus(page, email);
            if (isLoggedIn) {
                this.bot.log(this.bot.isMobile, '登录', `[${email}] ✅ 本地会话有效`);
                return true;
            }

            this.bot.log(this.bot.isMobile, '登录', `[${email}] ❌ 会话无效，需要重新登录`);
            return false;
        } catch (error) {
            this.bot.log(this.bot.isMobile, '登录', `[${email}] ⚠️ 检查会话有效性时出错: ${error}`, 'warn');
            return false;
        }
    }

    private async checkLoggedInStatus(page: Page, email: string): Promise<boolean> {
        try {
            // 等待页面完全加载
            await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
            
            // 检查当前URL
            const currentUrl = page.url();
            const title = await page.title();
            
            this.bot.log(this.bot.isMobile, '登录', `[${email}] 🔍 检查登录状态 - URL: ${currentUrl}, 标题: ${title}`);
            
            // 如果已经在rewards.bing.com且标题包含Microsoft Rewards相关关键词，说明已登录
            const rewardsTitleKeywords = [
                'Microsoft Rewards',
                'Bing Rewards', 
                'Rewards',
                'Microsoft 奖励',
                'Bing 奖励',
                '奖励'
            ];
            
            if (currentUrl.includes('rewards.bing.com') && 
                rewardsTitleKeywords.some(keyword => title.includes(keyword))) {
                this.bot.log(this.bot.isMobile, '登录', `[${email}] ✅ 检测到已在Microsoft Rewards页面，已登录`);
                return true;
            }

            // 首先检查是否在登录页面，如果是则直接返回未登录
            if (currentUrl.includes('login.live.com') || currentUrl.includes('login.microsoft.com')) {
                this.bot.log(this.bot.isMobile, '登录', `[${email}] 🔍 当前在登录页面，未登录`);
                return false;
            }

            // 检查是否有登录状态的DOM元素 - 增加更多检查条件（支持中英文）
            const loginIndicators = [
                'html[data-role-name="RewardsPortal"]',
                '[data-testid="user-avatar"]',
                '.user-avatar',
                '[aria-label*="账户"]',
                '[aria-label*="Account"]',
                '[aria-label*="Profile"]',
                '[id*="mectrl"]',
                '[class*="profile"]',
                '[class*="account"]',
                'a[href*="Signout"]',
                'a:has-text("注销")',
                'a:has-text("Sign out")',
                'a:has-text("Sign Out")',
                'button:has-text("Sign out")',
                'button:has-text("Sign Out")',
                '.account-info',
                '.profile_img',
                '#img_sec',
                '#redirect_info_link',
                'text=points',
                'text=积分',
                'text=Rewards',
                'text=奖励'
            ];

            for (const selector of loginIndicators) {
                try {
                    const element = await page.waitForSelector(selector, { timeout: 2000 });
                    if (element) {
                        this.bot.log(this.bot.isMobile, '登录', `[${email}] ✅ 检测到登录指示器: ${selector}，已登录`);
                        return true;
                    }
                } catch (error) {
                    // 继续检查下一个选择器
                    continue;
                }
            }

            // 特殊处理 identityBanner - 只有在 rewards.bing.com 页面才认为是登录状态
            try {
                const identityBanner = await page.waitForSelector('[data-testid="identityBanner"]', { timeout: 2000 });
                if (identityBanner && currentUrl.includes('rewards.bing.com')) {
                    this.bot.log(this.bot.isMobile, '登录', `[${email}] ✅ 检测到 identityBanner 且在 rewards 页面，已登录`);
                    return true;
                } else if (identityBanner) {
                    this.bot.log(this.bot.isMobile, '登录', `[${email}] ⚠️ 检测到 identityBanner 但不在 rewards 页面，忽略`);
                }
            } catch (error) {
                // identityBanner 不存在，继续其他检查
            }

            // 检查页面是否包含用户邮箱信息
            try {
                const userEmailElements = await page.$$('text=@outlook.com, text=@hotmail.com, text=@gmail.com, text=@live.com');
                if (userEmailElements.length > 0) {
                    this.bot.log(this.bot.isMobile, '登录', `[${email}] ✅ 检测到用户邮箱信息，已登录`);
                    return true;
                }
            } catch (error) {
                // 忽略错误
            }

            // 最后检查：如果页面包含"登录"按钮，说明未登录
            try {
                const loginButton = await page.waitForSelector('a[href*="login"], button:has-text("登录"), button:has-text("Sign in")', { timeout: 2000 });
                if (loginButton) {
                    this.bot.log(this.bot.isMobile, '登录', `[${email}] 🔐 检测到登录按钮，未登录`);
                    return false;
                }
            } catch (error) {
                // 没有找到登录按钮，可能已登录
            }

            this.bot.log(this.bot.isMobile, '登录', `[${email}] ❓ 登录状态检查完成，未找到明确的登录指示器`);
            return false;
        } catch (error) {
            this.bot.log(this.bot.isMobile, '登录', `[${email}] ⚠️ 检查登录状态时出错: ${error}`, 'warn');
            return false;
        }
    }

    async login(page: Page, email: string, password: string) {
        const platformType = this.bot.isMobile ? 'mobile' : 'pc';
        try {
            this.bot.log(this.bot.isMobile, '登录', `[${email}] 🚀 开始登录流程！`);
            
            // 第一步：检查本地会话是否有效
            const sessionValid = await this.checkSessionValidity(page, email);
            if (sessionValid) {
                this.bot.log(this.bot.isMobile, '登录', `[${email}] ✅ 本地会话有效，跳过登录流程`);
                await this.sendSmartStatusUpdate(platformType, true, LoginStatusCode.Success, '会话有效', email);
                await this.checkAccountLocked(page, email);
                await saveSessionData(this.bot.config.sessionPath, page.context(), email, this.bot.isMobile);
                return;
            }
            
            // 第二步：执行登录流程
            await this.gotoWithRetry(page, 'https://rewards.bing.com/signin');
            await page.waitForLoadState('domcontentloaded').catch(() => { });
            
            // 截图：初始登录页面（受 snapshots.login 开关控制）
            if (this.bot.config.snapshots?.login) {
                await this.saveSnapshot(page, email, `initial_login_page_${Date.now()}.html`);
            }
            
            await this.bot.browser.utils.reloadBadPage(page);
            await this.checkAccountLocked(page, email);
            
            // 第三步：检查是否已经登录
            const isLoggedIn = await this.checkLoggedInStatus(page, email);
            if (isLoggedIn) {
                this.bot.log(this.bot.isMobile, '登录', `[${email}] ✅ 检测到已登录状态，跳过登录流程`);
                await this.sendSmartStatusUpdate(platformType, true, LoginStatusCode.Success, '已登录', email);
                await this.checkAccountLocked(page, email);
            } else {
                await this.execLogin(page, email, password);
            }
            
            await saveSessionData(this.bot.config.sessionPath, page.context(), email, this.bot.isMobile);
            
            // 登录成功后，访问Microsoft Rewards主页并截图
            this.bot.log(this.bot.isMobile, '登录', `[${email}] 🎉 登录成功，正在访问Microsoft Rewards主页...`);
            await this.gotoWithRetry(page, 'https://rewards.bing.com');
            await page.waitForLoadState('domcontentloaded').catch(() => { });
            
            // 等待页面完全加载
            await this.bot.utils.wait(3000);
            
            // 处理cookies授权弹窗（在Microsoft Rewards页面出现）
            this.bot.log(this.bot.isMobile, '登录', `[${email}] 🍪 正在处理Microsoft Rewards页面的cookies授权弹窗...`);
            await this.handleCookiesConsent(page);
            
            // 再次等待确保cookies弹窗处理完成
            await this.bot.utils.wait(2000);
            
            // 检查是否是生物识别页面
            try {
                // 直接创建 LoginExceptionHandler 实例
                const { LoginExceptionHandler } = await import('../handlers/LoginExceptionHandler');
                const loginHandler = new LoginExceptionHandler(this.bot);
                await loginHandler.initialize();
                
                const biometricHandled = await loginHandler.handleBiometricPage(page, email);
                if (biometricHandled) {
                    this.bot.log(this.bot.isMobile, '登录', `[${email}] 已处理生物识别页面，等待页面跳转...`);
                    await this.bot.utils.wait(3000);
                    await page.waitForLoadState('networkidle', { timeout: 10000 });
                }
                
                await loginHandler.cleanup();
            } catch (biometricError) {
                this.bot.log(this.bot.isMobile, '登录', `[${email}] 处理生物识别页面时出错: ${biometricError}`, 'warn');
            }
            
            // 截图：登录成功后的Microsoft Rewards主页（受 snapshots.login 开关控制）
            if (this.bot.config.snapshots?.login) {
                await this.saveSnapshot(page, email, `rewards_homepage_after_login_${Date.now()}.html`);
                this.bot.log(this.bot.isMobile, '登录', `[${email}] 已保存登录成功后的Microsoft Rewards主页快照`);
            }
            
            this.bot.log(this.bot.isMobile, '登录', `[${email}] 登录流程成功，并已保存登录会话！`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '登录', `[${email}] 登录流程发生错误: ${errorMessage}`, 'error');
            
            let code = LoginStatusCode.GenericFailure;
            if (errorMessage.includes('密码不正确')) code = LoginStatusCode.PasswordError;
            if (errorMessage.includes('此账户已被锁定')) code = LoginStatusCode.Locked;
            
            await this.sendSmartStatusUpdate(platformType, false, code, errorMessage, email);
            throw new Error(errorMessage);
        }
    }

    private async execLogin(page: Page, email: string, password: string) {
        const platformType = this.bot.isMobile ? 'mobile' : 'pc';
        try {
            // 首先检查是否已经登录
            const isAlreadyLoggedIn = await this.checkLoggedInStatus(page, email);
            if (isAlreadyLoggedIn) {
                this.bot.log(this.bot.isMobile, '登录', `[${email}] 检测到已登录状态，跳过登录流程`);
                // 只有在明确需要状态更新时才发送推送，避免重复推送
                await this.sendSmartStatusUpdate(platformType, true, LoginStatusCode.Success, '已登录', email);
                return;
            }

            await this.enterEmail(page, email);
            // 截图：邮箱输入后页面
            if (this.bot.config.snapshots?.login) {
                await this.saveSnapshot(page, email, `email_entered_page_${Date.now()}.html`);
            }
            await this.bot.utils.wait(3000);
            await this.bot.browser.utils.reloadBadPage(page);
            await this.bot.utils.wait(2000);

            // 再次检查是否已经登录（邮箱输入后可能直接登录）
            const isLoggedInAfterEmail = await this.checkLoggedInStatus(page, email);
            if (isLoggedInAfterEmail) {
                this.bot.log(this.bot.isMobile, '登录', `[${email}] 邮箱输入后检测到已登录状态，跳过密码输入`);
                await this.sendSmartStatusUpdate(platformType, true, LoginStatusCode.Success, '已登录', email);
                return;
            }

            // [新增] 首先检查是否已经直接跳转到密码输入页面
            this.bot.log(this.bot.isMobile, '登录', '检查是否已直接跳转到密码输入页面...');
            const passwordInputDirect = await page.waitForSelector('input[type="password"]', { timeout: 5000 }).catch(() => null);
            if (passwordInputDirect) {
                this.bot.log(this.bot.isMobile, '登录', '检测到密码输入框，跳过"使用密码"步骤');
            } else {
                // [修复方案 - 支持中英文"使用密码"按钮]
                this.bot.log(this.bot.isMobile, '登录', '正在检查"使用密码"登录选项...');
                
                // 尝试多种方式查找"使用密码"按钮
                let clicked = false;
                
                // 方法1：使用role="button"选择器（支持中英文）
                try {
                    const usePasswordRoleButton = page.locator('[role="button"]:has-text("使用密码"), [role="button"]:has-text("Use your password")');
                    const count = await usePasswordRoleButton.count();
                    
                    if (count > 0) {
                        for (let i = 0; i < count && !clicked; i++) {
                            const element = usePasswordRoleButton.nth(i);
                            if (await element.isVisible({ timeout: 2000 })) {
                                this.bot.log(this.bot.isMobile, '登录', '检测到"使用密码"选项，正在点击...');
                                await element.scrollIntoViewIfNeeded();
                                await element.click({ timeout: 5000 });
                                clicked = true;
                                await this.bot.utils.wait(3000); // 等待页面跳转
                                break;
                            }
                        }
                    }
                } catch (e) {
                    this.bot.log(this.bot.isMobile, '登录', `方法1失败: ${e instanceof Error ? e.message : String(e)}`, 'warn');
                }
                
                // 方法2：使用span标签选择器
                if (!clicked) {
                    try {
                        const usePasswordSpan = page.locator('span:has-text("使用密码"), span:has-text("Use your password")');
                        const count = await usePasswordSpan.count();
                        
                        if (count > 0) {
                            for (let i = 0; i < count && !clicked; i++) {
                                const element = usePasswordSpan.nth(i);
                                if (await element.isVisible({ timeout: 2000 })) {
                                    this.bot.log(this.bot.isMobile, '登录', '检测到"使用密码"选项，正在点击...');
                                    await element.scrollIntoViewIfNeeded();
                                    await element.click({ timeout: 5000 });
                                    clicked = true;
                                    await this.bot.utils.wait(3000); // 等待页面跳转
                                    break;
                                }
                            }
                        }
                    } catch (e) {
                        this.bot.log(this.bot.isMobile, '登录', `方法2失败: ${e instanceof Error ? e.message : String(e)}`, 'warn');
                    }
                }
                
                // 方法3：使用JavaScript点击
                if (!clicked) {
                    try {
                        const jsResult = await page.evaluate(() => {
                            const elements = Array.from(document.querySelectorAll('*')).filter(el => {
                                const text = el.textContent || '';
                                return text.includes('使用密码') || text.includes('Use your password') || text.includes('密码登录') || text.includes('Password login');
                            });
                            
                            if (elements.length > 0) {
                                for (const el of elements) {
                                    const htmlEl = el as HTMLElement;
                                    if (htmlEl.offsetWidth > 0 && htmlEl.offsetHeight > 0) {
                                        htmlEl.click();
                                        return { success: true, element: htmlEl.tagName, text: htmlEl.textContent };
                                    }
                                }
                            }
                            return { success: false, reason: 'No visible elements found' };
                        });
                        
                        if (jsResult.success) {
                            clicked = true;
                            this.bot.log(this.bot.isMobile, '登录', `JavaScript点击成功: ${jsResult.element} - ${jsResult.text}`);
                            await this.bot.utils.wait(3000); // 等待页面跳转
                        }
                    } catch (e) {
                        this.bot.log(this.bot.isMobile, '登录', `JavaScript点击失败: ${e instanceof Error ? e.message : String(e)}`, 'warn');
                    }
                }
                
                if (!clicked) {
                    this.bot.log(this.bot.isMobile, '登录', '未找到"使用密码"按钮，将直接尝试输入密码。');
                }
            }

            // 检查是否需要处理辅助邮箱验证码（在密码输入之前）
            const verificationSuccess = await this.handleAuxiliaryEmailVerification(page, email);
            
            // 如果验证码处理成功，检查是否已经登录
            if (verificationSuccess) {
                this.bot.log(this.bot.isMobile, '登录', `[${email}] 验证码处理成功，检查登录状态...`);
                
                // 等待页面跳转
                await this.bot.utils.wait(3000);
                
                // 检查是否已经登录成功
                const currentUrl = page.url();
                if (currentUrl.includes('rewards.bing.com') || 
                    currentUrl.includes('account.microsoft.com') ||
                    currentUrl.includes('bing.com') ||
                    currentUrl.includes('microsoft.com')) {
                    this.bot.log(this.bot.isMobile, '登录', `[${email}] 验证码处理后已成功登录，跳过密码输入步骤`);
                    // 抛出特殊异常，表示验证码登录成功
                    throw new Error('VERIFICATION_LOGIN_SUCCESS');
                }
            }
            
            // 如果验证码处理失败或未处理，继续正常的密码输入流程
            await this.enterPassword(page, password, email);
            // 截图：密码输入后页面
            if (this.bot.config.snapshots?.login) {
                await this.saveSnapshot(page, email, `password_entered_page_${Date.now()}.html`);
            }
            
            await this.checkLoggedIn(page, email);
            await this.sendSmartStatusUpdate(platformType, true, LoginStatusCode.Success, '登录成功', email);
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
                try {
                    await this.handleVerifyEmailPage(page, email);
                    this.bot.log(this.bot.isMobile, '登录', `[${email}] 邮箱输入成功`);
                } catch (error) {
                    if (error instanceof Error && error.message === 'VERIFICATION_LOGIN_SUCCESS') {
                        this.bot.log(this.bot.isMobile, '登录', `[${email}] 验证码登录成功，邮箱输入流程完成`);
                        return; // 直接返回，不抛出异常
                    } else {
                        throw error; // 重新抛出其他异常
                    }
                }
            } else {
                this.bot.log(this.bot.isMobile, '登录', `[${email}] 输入邮箱后未找到"下一步"按钮`, 'warn');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '登录', `[${email}] 邮箱输入失败: ${errorMessage}`, 'error');
        }
    }

    private async enterPassword(page: Page, password: string, email: string) {
        const passwordInputSelector = 'input[type="password"]'
        const skip2FASelector = '#idA_PWD_SwitchToPassword'; 
        try {
            // 首先检查是否已经登录
            const currentUrl = page.url();
            const title = await page.title();
            if (currentUrl.includes('rewards.bing.com') && title.includes('Microsoft Rewards')) {
                this.bot.log(this.bot.isMobile, '登录', '检测到已在Microsoft Rewards页面，跳过密码输入');
                return;
            }

            const viewFooter = await page.waitForSelector('[data-testid="viewFooter"]', { timeout: 2000 }).catch(() => null)
            if (viewFooter) {
            const skip2FAButton = await page.waitForSelector(skip2FASelector, { timeout: 2000 }).catch(() => null)
            if (skip2FAButton) {
                await skip2FAButton.click()
                await this.bot.utils.wait(2000)
                this.bot.log(this.bot.isMobile, '登录', '已跳过2FA验证')
            } else {
                this.bot.log(this.bot.isMobile, '登录', '未找到2FA跳过按钮，继续密码输入流程')
            }
            const viewFooterElement = await page.waitForSelector('#view > div > span:nth-child(6)', { timeout: 2000 }).catch(() => null)
            const passwordField1 = await page.waitForSelector(passwordInputSelector, { timeout: 5000 }).catch(() => null)
            
            // 检查当前页面是否是"验证你的电子邮件"页面，如果是则跳过"获取登录验证码"检测
            const pageTitle = await page.title();
            const isEmailVerificationPage = pageTitle.includes('验证你的电子邮件') || pageTitle.includes('Verify your email');
            
            if (viewFooterElement && !passwordField1 && !isEmailVerificationPage) {
                this.bot.log(this.bot.isMobile, '登录', '通过"viewFooter"检测到"获取登录验证码"页面')
    
                const otherWaysButton = await viewFooterElement.$('span[role="button"]')
                if (otherWaysButton) {
                    await otherWaysButton.click()
                    await this.bot.utils.wait(2000)
    
                    const listItems = await page.$$('ul > li')
                    if (listItems.length >= 2) {
                        const secondListItem = listItems[1]
                        if (secondListItem && await secondListItem.isVisible()) {
                            await secondListItem.click()
                        }
                    }
                }
            }
            }
    
            const passwordField = await page.waitForSelector(passwordInputSelector, { state: 'visible', timeout: 5000 }).catch(() => null);
            if (!passwordField) {
                this.bot.log(this.bot.isMobile, '登录', '未找到密码输入框，可能需要2FA验证。', 'warn');
                await this.handle2FA(page, email);
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
                await this.bot.utils.wait(3000);
                this.bot.log(this.bot.isMobile, '登录', '密码输入成功');
                
                // 密码输入后检查页面异常情况
                try {
                    const exceptionResult = await this.bot.detectPageException(page, this.bot.account?.email || 'unknown', 8000);
                    if (exceptionResult.detected) {
                        this.bot.log(this.bot.isMobile, '登录', 
                            `密码输入后检测到页面异常: ${exceptionResult.pageType} - ${exceptionResult.message}`);
                        
                        // 如果检测到账户锁定，直接抛出错误
                        if (exceptionResult.pageType === 'account_locked') {
                            throw new Error('账户已锁定，无法继续登录');
                        }
                        
                        // 如果检测到邮箱验证页面，处理辅助邮箱验证
                        if (exceptionResult.pageType === 'email_verification') {
                            this.bot.log(this.bot.isMobile, '登录', '开始处理辅助邮箱验证...');
                            const verificationSuccess = await this.handleAuxiliaryEmailVerification(page, email);
                            if (verificationSuccess) {
                                this.bot.log(this.bot.isMobile, '登录', '辅助邮箱验证处理成功');
                            } else {
                                this.bot.log(this.bot.isMobile, '登录', '辅助邮箱验证处理失败', 'warn');
                            }
                        }
                    }
                } catch (exceptionError) {
                    this.bot.log(this.bot.isMobile, '登录', 
                        `密码输入后页面异常检测出错: ${exceptionError}`, 'warn');
                }
            } else {
                this.bot.log(this.bot.isMobile, '登录', '输入密码后未找到"下一步"按钮', 'warn');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '登录', `密码输入失败: ${errorMessage}`, 'error');
            await this.handle2FA(page, email);
        }
    }

    private async handleAuxiliaryEmailVerification(page: Page, email: string): Promise<boolean> {
        try {
            // 检查当前账户是否有辅助邮箱配置
            const account = this.bot.account;
            if (!account || !account.auxiliary_email) {
                this.bot.log(this.bot.isMobile, '登录', `账户 ${email} 未配置辅助邮箱，跳过验证码处理`);
                return false;
            }

            // 检查是否已经登录
            const isLoggedIn = await this.checkLoggedInStatus(page, email);
            if (isLoggedIn) {
                this.bot.log(this.bot.isMobile, '登录', `账户 ${email} 已登录，跳过验证码处理`);
                return false;
            }

            // 检查是否在验证码页面
            const isVerificationPage = await this.isVerificationPage(page);
            if (!isVerificationPage) {
                this.bot.log(this.bot.isMobile, '登录', `当前页面不是验证码页面，跳过验证码处理`);
                return false;
            }

            // 创建验证码处理器
            const verificationHandler = new VerificationCodeHandler({
                auxiliary_email: account.auxiliary_email,
                main_account_email: email  // 传递主账户邮箱
            });

            // 处理验证码
            const deviceType = this.bot.isMobile ? 'mobile' : 'pc';
            const success = await verificationHandler.handleAuxiliaryEmailVerification(page, email, deviceType);
            if (success) {
                this.bot.log(this.bot.isMobile, '登录', `账户 ${email} 辅助邮箱验证码处理成功`);
                return true;
            } else {
                this.bot.log(this.bot.isMobile, '登录', `账户 ${email} 辅助邮箱验证码处理失败`, 'error');
                return false;
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '登录', `处理辅助邮箱验证码时出错: ${errorMessage}`, 'error');
            return false;
        }
    }

    private async isVerificationPage(page: Page): Promise<boolean> {
        try {
            // 首先检查页面URL和标题，排除已经登录成功的情况
            const currentUrl = page.url();
            const title = await page.title();
            
            this.bot.log(this.bot.isMobile, '登录', `检查验证页面 - URL: "${currentUrl}", 标题: "${title}"`);
            
            // 如果已经在rewards.bing.com或Microsoft Rewards页面，说明已经登录成功
            // 注意：只检查URL是否以rewards.bing.com开头，避免匹配到redirect_uri参数
            if ((currentUrl.startsWith('https://rewards.bing.com') || currentUrl.startsWith('http://rewards.bing.com')) || 
                title.includes('Microsoft Rewards')) {
                this.bot.log(this.bot.isMobile, '登录', '检测到已在Microsoft Rewards页面，非验证页面');
                return false;
            }
            
            // 优先检查页面内容是否包含验证相关元素（更可靠）
            const pageText = await page.textContent('body');
            if (pageText && (pageText.includes('将代码发送到') || pageText.includes('发送电子邮件') || 
                pageText.includes('验证你的身份') || pageText.includes('只需再执行一步') ||
                pageText.includes('向') && pageText.includes('发送电子邮件'))) {
                this.bot.log(this.bot.isMobile, '登录', '通过页面内容检测到验证页面');
                return true;
            }
            
            // 检查页面标题（作为备用检查）
            if (title.includes('即将完成') || title.includes('Almost done') || 
                title.includes('验证你的身份') || title.includes('Verify your identity')) {
                this.bot.log(this.bot.isMobile, '登录', '通过页面标题检测到验证页面');
                return true;
            }
            
            const isLoggedIn = await this.checkLoggedInStatus(page, '');
            if (isLoggedIn) {
                this.bot.log(this.bot.isMobile, '登录', '检测到已登录状态，非验证页面');
                return false;
            }
            
            // 检查页面内容（pageText已在上面获取）
            
            // 检查是否是"验证你的电子邮件"页面
            if (title.includes('验证你的电子邮件') || title.includes('Verify your email')) {
                this.bot.log(this.bot.isMobile, '登录', '通过页面标题检测到验证你的电子邮件页面');
                return true;
            }
            
            // 检查是否是身份验证选择页面（更精确的判断）
            if (pageText && pageText.includes('验证你的身份') && (pageText.includes('发送电子邮件') || pageText.includes('@outlook.com'))) {
                this.bot.log(this.bot.isMobile, '登录', '通过页面内容检测到身份验证选择页面');
                return true;
            }

            // 检查是否有验证码输入框（更精确的选择器）
            const verificationSelectors = [
                'input[name="otc"]',
                '#otc',
                '[data-testid*="otc"]',
                '#proof-confirmation-email-input'
            ];

            for (const selector of verificationSelectors) {
                const element = await page.$(selector);
                if (element) {
                    this.bot.log(this.bot.isMobile, '登录', `通过选择器 "${selector}" 检测到验证页面`);
                    return true;
                }
            }

            // 检查页面内容是否包含"验证你的电子邮件"相关关键词（但排除已登录页面）
            if (pageText && !currentUrl.includes('rewards.bing.com') && 
                (pageText.includes('验证你的电子邮件') || pageText.includes('发送代码到') || pageText.includes('我们将向'))) {
                this.bot.log(this.bot.isMobile, '登录', '通过页面内容关键词检测到验证页面');
                return true;
            }

            this.bot.log(this.bot.isMobile, '登录', '未检测到验证页面');
            return false;
        } catch (error) {
            this.bot.log(this.bot.isMobile, '登录', `检查验证页面时出错: ${error}`, 'error');
            return false;
        }
    }

    private async handle2FA(page: Page, email: string) {
        const platformType = this.bot.isMobile ? 'mobile' : 'pc';
        try {
            await this.sendSmartStatusUpdate(platformType, false, LoginStatusCode.AuthorizationRequired, '需要2FA/授权', email);
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

        // 保存授权页面快照
        if (this.bot.config.snapshots?.login) {
            await this.saveSnapshot(page, email, `mobile_auth_page_${Date.now()}.html`);
        }

        let currentUrl = new URL(page.url());
        let code: string;
        this.bot.log(this.bot.isMobile, '登录-APP', '等待授权...');
        
        // 添加超时机制，避免无限等待
        const startTime = Date.now();
        const timeoutMs = 120000; // 2分钟超时
        
        while (true) {
            // 检查超时
            if (Date.now() - startTime > timeoutMs) {
                // 超时时保存页面快照
                if (this.bot.config.snapshots?.login) {
                    await this.saveSnapshot(page, email, `mobile_auth_timeout_${Date.now()}.html`);
                }
                throw new Error('移动端授权等待超时，请在2分钟内完成授权操作');
            }
            
            currentUrl = new URL(page.url());
            
            // 检查是否已获得授权码
            if (currentUrl.hostname === 'login.live.com' && currentUrl.pathname === '/oauth20_desktop.srf') {
                const authCode = currentUrl.searchParams.get('code');
                if (authCode) {
                    code = authCode;
                    this.bot.log(this.bot.isMobile, '登录-APP', '成功获取授权码');
                    break;
                }
            }
            
            // 检查是否有错误
            const error = currentUrl.searchParams.get('error');
            if (error) {
                const errorDescription = currentUrl.searchParams.get('error_description') || '未知错误';
                // 保存错误页面快照
                if (this.bot.config.snapshots?.login) {
                    await this.saveSnapshot(page, email, `mobile_auth_error_${Date.now()}.html`);
                }
                throw new Error(`移动端授权失败: ${error} - ${errorDescription}`);
            }
            
            // 每30秒保存一次页面快照，用于调试
            if (this.bot.config.snapshots?.login && (Date.now() - startTime) % 30000 < 5000) {
                await this.saveSnapshot(page, email, `mobile_auth_waiting_${Date.now()}.html`);
            }
            
            // 持续检查并处理页面异常情况（生物识别、验证等）
            try {
                this.bot.log(this.bot.isMobile, '登录-APP', `[${email}] 正在检测页面状态...`);
                const exceptionResult = await this.bot.detectPageException(page, email, 5000);
                
                if (exceptionResult.detected) {
                    this.bot.log(this.bot.isMobile, '登录-APP', 
                        `[${email}] 检测到页面异常: ${exceptionResult.pageType} - ${exceptionResult.message}`);
                    
                    // 根据检测结果执行相应操作
                    switch (exceptionResult.pageType) {
                        case 'biometric':
                            if (exceptionResult.action === 'skip_clicked') {
                                this.bot.log(this.bot.isMobile, '登录-APP', 
                                    `[${email}] 生物识别页面已处理，等待页面跳转...`);
                                // 等待页面跳转后重新检查URL
                                await this.bot.utils.wait(3000);
                                continue;
                            } else if (exceptionResult.action === 'manual_required') {
                                this.bot.log(this.bot.isMobile, '登录-APP', 
                                    `[${email}] ${exceptionResult.message}，继续等待授权完成...`, 'warn');
                            }
                            break;
                            
                        case 'email_verification':
                            this.bot.log(this.bot.isMobile, '登录-APP', 
                                `[${email}] 检测到邮箱验证页面，需要手动处理`, 'warn');
                            break;
                            
                        case 'stay_signed_in':
                            if (exceptionResult.action === 'yes_clicked') {
                                this.bot.log(this.bot.isMobile, '登录-APP', 
                                    `[${email}] 登录保持页面已处理，等待页面跳转...`);
                                await this.bot.utils.wait(3000);
                                continue;
                            }
                            break;
                            
                        case 'cookie_consent':
                            if (exceptionResult.action === 'accept_clicked') {
                                this.bot.log(this.bot.isMobile, '登录-APP', 
                                    `[${email}] Cookie同意页面已处理，等待页面跳转...`);
                                await this.bot.utils.wait(2000);
                                continue;
                            }
                            break;
                            
                        case 'account_locked':
                            throw new Error('账户已锁定，无法继续登录');
                            
                        case 'two_factor':
                            this.bot.log(this.bot.isMobile, '登录-APP', 
                                `[${email}] 检测到两步验证页面，需要手动处理`, 'warn');
                            break;
                            
                        case 'network_error':
                            this.bot.log(this.bot.isMobile, '登录-APP', 
                                `[${email}] 检测到网络错误，建议重试`, 'warn');
                            break;
                            
                        default:
                            this.bot.log(this.bot.isMobile, '登录-APP', 
                                `[${email}] 检测到未知页面异常: ${exceptionResult.pageType}`, 'warn');
                    }
                } else {
                    this.bot.log(this.bot.isMobile, '登录-APP', `[${email}] 页面状态正常，继续等待授权...`);
                }
            } catch (exceptionError) {
                this.bot.log(this.bot.isMobile, '登录-APP', 
                    `[${email}] 页面异常检测出错: ${exceptionError}`, 'warn');
            }
            
            // 检查页面是否已经跳转（可能通过其他方式完成授权）
            const newUrl = page.url();
            if (newUrl !== currentUrl.href) {
                this.bot.log(this.bot.isMobile, '登录-APP', `[${email}] 检测到页面URL变化: ${currentUrl.href} -> ${newUrl}`);
                currentUrl = new URL(newUrl);
                
                // 如果跳转到了授权成功页面，重新检查授权码
                if (currentUrl.hostname === 'login.live.com' && currentUrl.pathname === '/oauth20_desktop.srf') {
                    const authCode = currentUrl.searchParams.get('code');
                    if (authCode) {
                        code = authCode;
                        this.bot.log(this.bot.isMobile, '登录-APP', '页面跳转后成功获取授权码');
                        break;
                    }
                }
            }
            
            await this.bot.utils.wait(3000); // 减少等待时间，提高响应速度
        }
        
        // 使用授权码获取访问令牌
        try {
            // 确保code不为null
            if (!code) {
                throw new Error('未能获取有效的授权码');
            }
            
            // 类型断言，确保code是string类型
            const authCode: string = code;
            
            const body = new URLSearchParams();
            body.append('grant_type', 'authorization_code');
            body.append('client_id', '0000000040170455');
            body.append('code', authCode);
            body.append('redirect_uri', 'https://login.live.com/oauth20_desktop.srf');
            
            const tokenRequest: AxiosRequestConfig = {
                url: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                data: body.toString()
            };
            
            const tokenResponse = await this.bot.axios.request(tokenRequest);
            const tokenData: OAuth = await tokenResponse.data;
            this.bot.log(this.bot.isMobile, '登录-APP', '授权成功，已获取访问令牌');
            
            // 授权成功后，检查并处理cookies同意弹窗
            try {
                this.bot.log(this.bot.isMobile, '登录-APP', `[${email}] 授权成功后，检查cookies同意弹窗...`);
                
                // 等待页面加载完成
                await this.bot.utils.wait(2000);
                
                // 检查是否有cookies同意弹窗
                const cookiesResult = await this.bot.detectPageException(page, email, 5000);
                if (cookiesResult.detected && cookiesResult.pageType === 'cookie_consent') {
                    this.bot.log(this.bot.isMobile, '登录-APP', `[${email}] 检测到cookies同意弹窗，已自动处理`);
                } else {
                    this.bot.log(this.bot.isMobile, '登录-APP', `[${email}] 未检测到cookies同意弹窗或已处理`);
                }
            } catch (cookiesError) {
                this.bot.log(this.bot.isMobile, '登录-APP', `[${email}] 检查cookies同意弹窗时出错: ${cookiesError}`, 'warn');
            }
            
            return tokenData.access_token;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '登录-APP', `获取访问令牌失败: ${errorMessage}`, 'error');
            throw new Error(`获取移动端访问令牌失败: ${errorMessage}`);
        }
    }

    /**
     * @deprecated 此方法已被 PageExceptionDetector 替换，将在未来的版本中删除。
     * 处理生物识别页面（人脸/指纹/PIN）
     */
    public async handleBiometricPage(page: Page, email: string): Promise<void> {
        try {
            // 检查页面标题和内容，识别生物识别页面
            const pageTitle = await page.title();
            const pageText = await page.textContent('body');
            
            // 根据实际快照文件更新识别条件
            const isBiometricPage = pageTitle.includes('使用人脸、指纹或 PIN') || 
                                   pageTitle.includes('使用人脸') || 
                                   pageTitle.includes('指纹') || 
                                   pageTitle.includes('PIN') ||
                                   pageTitle.includes('通行密钥') ||
                                   (pageText && (pageText.includes('使用人脸、指纹或 PIN') ||
                                                pageText.includes('使用人脸') || 
                                                pageText.includes('指纹') || 
                                                pageText.includes('PIN') ||
                                                pageText.includes('生物识别') ||
                                                pageText.includes('通行密钥') ||
                                                pageText.includes('创建通行密钥')));
            
            if (isBiometricPage) {
                this.bot.log(this.bot.isMobile, '登录-APP', `[${email}] 检测到生物识别页面: "${pageTitle}"，尝试点击"暂时跳过"`);
                
                // 保存生物识别页面快照
                if (this.bot.config.snapshots?.login) {
                    await this.saveSnapshot(page, email, `mobile_auth_biometric_page_${Date.now()}.html`);
                }
                
                // 尝试多种方式查找"暂时跳过"按钮
                let skipClicked = false;
                
                // 安全检查：确保不会点击"下一步"按钮
                try {
                    const nextButton = page.locator('[data-testid="primaryButton"]');
                    if (await nextButton.isVisible({ timeout: 1000 })) {
                        const nextButtonText = await nextButton.textContent();
                        this.bot.log(this.bot.isMobile, '登录-APP', `[${email}] 检测到"下一步"按钮: ${nextButtonText}，将避免点击此按钮`);
                    }
                } catch (error) {
                    // 忽略错误，继续执行
                }
                
                // 方法1：使用data-testid选择器（根据快照文件中的实际按钮）
                try {
                    const skipButton = page.locator('[data-testid="secondaryButton"]');
                    if (await skipButton.isVisible({ timeout: 2000 })) {
                        const buttonText = await skipButton.textContent();
                        this.bot.log(this.bot.isMobile, '登录-APP', `[${email}] 找到"暂时跳过"按钮: ${buttonText}`);
                        await skipButton.scrollIntoViewIfNeeded();
                        await skipButton.click({ timeout: 5000 });
                        skipClicked = true;
                        this.bot.log(this.bot.isMobile, '登录-APP', `[${email}] 成功点击"暂时跳过"按钮`);
                        await this.bot.utils.wait(3000); // 等待页面跳转
                    }
                } catch (error) {
                    this.bot.log(this.bot.isMobile, '登录-APP', `[${email}] 方法1失败: ${error instanceof Error ? error.message : String(error)}`, 'warn');
                }
                
                // 方法2：使用文本选择器查找"暂时跳过"按钮
                if (!skipClicked) {
                    const skipButtonSelectors = [
                        'button:has-text("暂时跳过")',
                        'button:has-text("Skip for now")',
                        'a:has-text("暂时跳过")',
                        'a:has-text("Skip for now")',
                        '[role="button"]:has-text("暂时跳过")',
                        '[role="button"]:has-text("Skip for now")',
                        'span:has-text("暂时跳过")',
                        'span:has-text("Skip for now")'
                    ];
                    
                    for (const selector of skipButtonSelectors) {
                        try {
                            const element = page.locator(selector);
                            if (await element.isVisible({ timeout: 2000 })) {
                                this.bot.log(this.bot.isMobile, '登录-APP', `[${email}] 找到"暂时跳过"按钮: ${selector}`);
                                await element.scrollIntoViewIfNeeded();
                                await element.click({ timeout: 5000 });
                                skipClicked = true;
                                this.bot.log(this.bot.isMobile, '登录-APP', `[${email}] 成功点击"暂时跳过"按钮`);
                                await this.bot.utils.wait(3000); // 等待页面跳转
                                break;
                            }
                        } catch (error) {
                            continue;
                        }
                    }
                }
                
                // 方法3：使用JavaScript查找并点击
                if (!skipClicked) {
                    try {
                        this.bot.log(this.bot.isMobile, '登录-APP', `[${email}] 尝试使用JavaScript点击"暂时跳过"按钮`);
                        
                        const jsResult = await page.evaluate(() => {
                            // 查找包含"暂时跳过"或"Skip for now"文本的元素
                            const elements = Array.from(document.querySelectorAll('*')).filter(el => {
                                const text = el.textContent || '';
                                return text.includes('暂时跳过') || 
                                       text.includes('Skip for now') || 
                                       text.includes('跳过') || 
                                       text.includes('Skip');
                            });
                            
                            if (elements.length > 0) {
                                // 尝试点击第一个可见的元素
                                for (const el of elements) {
                                    const htmlEl = el as HTMLElement;
                                    if (htmlEl.offsetWidth > 0 && htmlEl.offsetHeight > 0) {
                                        htmlEl.click();
                                        return { success: true, element: htmlEl.tagName, text: htmlEl.textContent };
                                    }
                                }
                            }
                            return { success: false, reason: 'No visible elements found' };
                        });
                        
                        if (jsResult.success) {
                            skipClicked = true;
                            this.bot.log(this.bot.isMobile, '登录-APP', `[${email}] JavaScript点击"暂时跳过"成功: ${jsResult.element} - ${jsResult.text}`);
                            await this.bot.utils.wait(3000); // 等待页面跳转
                        } else {
                            this.bot.log(this.bot.isMobile, '登录-APP', `[${email}] JavaScript点击"暂时跳过"失败: ${jsResult.reason}`, 'warn');
                        }
                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        this.bot.log(this.bot.isMobile, '登录-APP', `[${email}] JavaScript点击"暂时跳过"异常: ${errorMessage}`, 'warn');
                    }
                }
                
                if (skipClicked) {
                    this.bot.log(this.bot.isMobile, '登录-APP', `[${email}] 已处理生物识别页面，等待继续授权流程`);
                } else {
                    this.bot.log(this.bot.isMobile, '登录-APP', `[${email}] 无法找到"暂时跳过"按钮，可能需要手动操作`, 'warn');
                }
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '登录-APP', `[${email}] 处理生物识别页面时出错: ${errorMessage}`, 'warn');
        }
    }

    private async checkLoggedIn(page: Page, email: string) {
        this.bot.log(this.bot.isMobile, '登录', `[${email}] 正在验证登录后状态...`);
        try {
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
                
                // 如果URL包含跳转参数，但页面标题是"即将完成"，说明需要处理辅助邮箱验证
                if ((url.includes('route=') || url.includes('opid=') || url.includes('contextid=')) && 
                    (title.includes('即将完成') || title.includes('Almost done'))) {
                    this.bot.log(this.bot.isMobile, '登录', `[${email}] 检测到辅助邮箱验证页面，停止等待跳转`);
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

            // 截图：登录成功后页面
            if (this.bot.config.snapshots?.login) {
                await this.saveSnapshot(page, email, `post_login_snapshot_${Date.now()}.html`);
            }
            
            // 尝试等待rewards门户元素，但不强制要求
            try {
                await page.waitForSelector('html[data-role-name="RewardsPortal"]', { timeout: 5000 });
                this.bot.log(this.bot.isMobile, '登录', `[${email}] 成功登录到奖励门户`);
            } catch (selectorError) {
                // 如果找不到rewards门户元素，检查页面是否包含rewards相关内容
                const pageContent = await page.textContent('body');
                if (pageContent && (pageContent.includes('Rewards') || pageContent.includes('Points') || pageContent.includes('积分'))) {
                    this.bot.log(this.bot.isMobile, '登录', `[${email}] 页面包含rewards内容，登录成功`);
                } else {
                    this.bot.log(this.bot.isMobile, '登录', `[${email}] 未找到rewards门户元素，但继续流程`, 'warn');
                }
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '登录', `[${email}] 验证登录状态时超时或失败: ${errorMessage}`, 'error');
            // 截图：登录失败页面
            if (this.bot.config.snapshots?.login) {
                await this.saveSnapshot(page, email, `login_failure_snapshot_${Date.now()}.html`);
            }
            throw new Error(`[${email}] 验证登录状态失败: ${errorMessage}`);
        }
    }

    private async dismissLoginMessages(page: Page, email: string) {
        // 处理"保持登录状态"弹窗
        const staySignedInButton = page.locator('[data-testid="primaryButton"]');
        if (await staySignedInButton.isVisible({ timeout: 1000 })) {
            await staySignedInButton.click();
            this.bot.log(this.bot.isMobile, '关闭消息', `[${email}] 点击了"保持登录状态"弹窗中的"是"`);
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
            if (this.bot.config.snapshots?.login) {
                await this.saveSnapshot(page, email, `verify_email_page_${Date.now()}.html`);
            }
            this.bot.log(this.bot.isMobile, '登录', `[${email}] 检测到"验证电子邮件"页面`);
            await this.sendSmartStatusUpdate(platformType, false, LoginStatusCode.VerificationRequired, '需要邮件验证', email);
            
            // 检查是否需要处理辅助邮箱验证码
            const verificationSuccess = await this.handleAuxiliaryEmailVerification(page, email);
            
            // 如果验证码处理成功，检查是否已经登录成功
            if (verificationSuccess) {
                this.bot.log(this.bot.isMobile, '登录', `[${email}] 验证码处理成功，检查登录状态...`);
                
                // 等待页面跳转
                await this.bot.utils.wait(3000);
                
                // 检查是否已经登录成功
                const currentUrl = page.url();
                if (currentUrl.includes('rewards.bing.com') || 
                    currentUrl.includes('account.microsoft.com') ||
                    currentUrl.includes('bing.com') ||
                    currentUrl.includes('microsoft.com')) {
                    this.bot.log(this.bot.isMobile, '登录', `[${email}] 验证码处理后已成功登录，跳过"使用密码"步骤`);
                    // 抛出特殊异常，表示验证码登录成功
                    throw new Error('VERIFICATION_LOGIN_SUCCESS');
                }
            }
            
            // 如果验证码处理失败或未处理，继续寻找"使用密码"选项
            this.bot.log(this.bot.isMobile, '登录', `[${email}] 正在寻找"使用密码"选项...`);
            
            // 方法1：使用role="button"选择器（针对HTML快照中看到的元素）
            const usePasswordRoleButton = page.locator('[role="button"]:has-text("使用密码"), [role="button"]:has-text("Use your password")');
            
            // 方法2：使用span标签选择器
            const usePasswordSpan = page.locator('span:has-text("使用密码"), span:has-text("Use your password")');
            
            // 方法3：使用更宽松的文本匹配
            const usePasswordAny = page.locator('*:has-text("使用密码"), *:has-text("Use your password"), *:has-text("密码登录"), *:has-text("Password login")');
            
            let clicked = false;
            
            // 尝试方法1：role="button"
            try {
                const count1 = await usePasswordRoleButton.count();
                this.bot.log(this.bot.isMobile, '登录', `[${email}] 找到 ${count1} 个role="button"类型的"使用密码"元素`);
                
                for (let i = 0; i < count1 && !clicked; i++) {
                    const element = usePasswordRoleButton.nth(i);
                    if (await element.isVisible({ timeout: 2000 })) {
                        this.bot.log(this.bot.isMobile, '登录', `[${email}] 尝试点击第 ${i+1} 个role="button"元素`);
                        await element.scrollIntoViewIfNeeded();
                        await element.click({ timeout: 5000 });
                        clicked = true;
                        this.bot.log(this.bot.isMobile, '登录', `[${email}] 成功点击role="button"类型的"使用密码"选项`);
                        break;
                    }
                }
            } catch (error) {
                this.bot.log(this.bot.isMobile, '登录', `[${email}] 方法1失败: ${error instanceof Error ? error.message : String(error)}`, 'warn');
            }
            
            // 如果方法1失败，尝试方法2：span标签
            if (!clicked) {
                try {
                    const count2 = await usePasswordSpan.count();
                    this.bot.log(this.bot.isMobile, '登录', `[${email}] 找到 ${count2} 个span类型的"使用密码"元素`);
                    
                    for (let i = 0; i < count2 && !clicked; i++) {
                        const element = usePasswordSpan.nth(i);
                        if (await element.isVisible({ timeout: 2000 })) {
                            this.bot.log(this.bot.isMobile, '登录', `[${email}] 尝试点击第 ${i+1} 个span元素`);
                            await element.scrollIntoViewIfNeeded();
                            await element.click({ timeout: 5000 });
                            clicked = true;
                            this.bot.log(this.bot.isMobile, '登录', `[${email}] 成功点击span类型的"使用密码"选项`);
                            break;
                        }
                    }
                } catch (error) {
                    this.bot.log(this.bot.isMobile, '登录', `[${email}] 方法2失败: ${error instanceof Error ? error.message : String(error)}`, 'warn');
                }
            }
            
            // 如果方法2失败，尝试方法3：宽松匹配
            if (!clicked) {
                try {
                    const count3 = await usePasswordAny.count();
                    this.bot.log(this.bot.isMobile, '登录', `[${email}] 找到 ${count3} 个宽松匹配的"使用密码"元素`);
                    
                    for (let i = 0; i < count3 && !clicked; i++) {
                        const element = usePasswordAny.nth(i);
                        if (await element.isVisible({ timeout: 2000 })) {
                            this.bot.log(this.bot.isMobile, '登录', `[${email}] 尝试点击第 ${i+1} 个宽松匹配元素`);
                            await element.scrollIntoViewIfNeeded();
                            await element.click({ timeout: 5000 });
                            clicked = true;
                            this.bot.log(this.bot.isMobile, '登录', `[${email}] 成功点击宽松匹配的"使用密码"选项`);
                            break;
                        }
                    }
                } catch (error) {
                    this.bot.log(this.bot.isMobile, '登录', `[${email}] 方法3失败: ${error instanceof Error ? error.message : String(error)}`, 'warn');
                }
            }
            
            // 如果所有方法都失败，尝试使用JavaScript点击
            if (!clicked) {
                try {
                    this.bot.log(this.bot.isMobile, '登录', `[${email}] 尝试使用JavaScript点击"使用密码"选项`);
                    
                    // 使用JavaScript查找并点击元素
                    const jsResult = await page.evaluate(() => {
                        // 查找包含"使用密码"文本的元素
                        const elements = Array.from(document.querySelectorAll('*')).filter(el => {
                            const text = el.textContent || '';
                            return text.includes('使用密码') || text.includes('Use your password') || text.includes('密码登录') || text.includes('Password login');
                        });
                        
                        if (elements.length > 0) {
                            // 尝试点击第一个可见的元素
                            for (const el of elements) {
                                const htmlEl = el as HTMLElement;
                                if (htmlEl.offsetWidth > 0 && htmlEl.offsetHeight > 0) {
                                    htmlEl.click();
                                    return { success: true, element: htmlEl.tagName, text: htmlEl.textContent };
                                }
                            }
                        }
                        return { success: false, reason: 'No visible elements found' };
                    });
                    
                    if (jsResult.success) {
                        clicked = true;
                        this.bot.log(this.bot.isMobile, '登录', `[${email}] JavaScript点击成功: ${jsResult.element} - ${jsResult.text}`);
                    } else {
                        this.bot.log(this.bot.isMobile, '登录', `[${email}] JavaScript点击失败: ${jsResult.reason}`, 'warn');
                    }
                } catch (error) {
                    this.bot.log(this.bot.isMobile, '登录', `[${email}] JavaScript点击异常: ${error instanceof Error ? error.message : String(error)}`, 'warn');
                }
            }
            
            if (clicked) {
                this.bot.log(this.bot.isMobile, '登录', `[${email}] 成功点击"使用密码"选项，等待页面加载...`, 'log');
                await this.bot.utils.wait(5000);
                
                // 验证是否成功跳转到密码输入页面
                try {
                    const passwordInput = await page.waitForSelector('input[type="password"]', { timeout: 10000 });
                    if (passwordInput) {
                        this.bot.log(this.bot.isMobile, '登录', `[${email}] 成功跳转到密码输入页面`);
                        return;
                    }
                } catch (error) {
                    this.bot.log(this.bot.isMobile, '登录', `[${email}] 等待密码输入框超时，可能页面跳转失败`, 'warn');
                }
            } else {
                this.bot.log(this.bot.isMobile, '登录', `[${email}] 所有方法都无法找到或点击"使用密码"选项`, 'error');
                
                // 保存最终页面状态用于调试
                const finalHtmlFilePath = path.join(this.bot.config.sessionPath, email, `verify_email_final_${Date.now()}.html`);
                await fs.promises.writeFile(finalHtmlFilePath, await page.content());
                this.bot.log(this.bot.isMobile, '登录', `[${email}] 最终验证页面HTML已保存到: ${finalHtmlFilePath}`, 'log');
                
                // 尝试继续流程，看看是否可以直接输入密码
                this.bot.log(this.bot.isMobile, '登录', `[${email}] 尝试直接查找密码输入框...`);
                const passwordInput = await page.waitForSelector('input[type="password"]', { timeout: 5000 }).catch(() => null);
                if (passwordInput) {
                    this.bot.log(this.bot.isMobile, '登录', `[${email}] 找到密码输入框，继续登录流程`);
                    return;
                }
            }
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
            if (this.bot.config.snapshots?.login) {
                await this.saveSnapshot(page, email, `invalid_password_page_${Date.now()}.html`);
            }
            this.bot.log(this.bot.isMobile, '登录', `[${email}] 检测到密码错误`);
            await this.sendSmartStatusUpdate(platformType, false, LoginStatusCode.PasswordError, '密码不正确', email);
            throw new Error(`[${email}] 密码不正确`);
        }

        // 检测是否有安全验证页面
        const securityVerificationTitle = page.locator('h1:has-text("安全验证"), h1:has-text("Security Verification")');
        if (await securityVerificationTitle.isVisible({ timeout: 1000 })) {
            // 截图：安全验证页面
            if (this.bot.config.snapshots?.login) {
                await this.saveSnapshot(page, email, `security_verification_page_${Date.now()}.html`);
            }
            this.bot.log(this.bot.isMobile, '登录', `[${email}] 检测到"安全验证"页面`);
            await this.sendSmartStatusUpdate(platformType, false, LoginStatusCode.VerificationRequired, '需要安全验证', email);
            
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
            if (this.bot.config.snapshots?.login) {
                await this.saveSnapshot(page, email, `account_recovery_page_${Date.now()}.html`);
            }
            this.bot.log(this.bot.isMobile, '登录', `[${email}] 检测到"账户恢复"页面`);
            await this.sendSmartStatusUpdate(platformType, false, LoginStatusCode.Locked, '账户需要恢复', email);
        }
        
        // 检测是否有验证码输入页面
        const captchaInput = page.locator('input[id*="captcha"], input[aria-label*="验证码"]');
        if (await captchaInput.isVisible({ timeout: 1000 })) {
            // 截图：验证码页面
            if (this.bot.config.snapshots?.login) {
                await this.saveSnapshot(page, email, `captcha_page_${Date.now()}.html`);
            }
            this.bot.log(this.bot.isMobile, '登录', `[${email}] 检测到验证码页面`);
            await this.sendSmartStatusUpdate(platformType, false, LoginStatusCode.VerificationRequired, '需要输入验证码', email);
            
            // 在调试模式下保存快照
            if (this.bot.config.debug) {
                await this.saveSnapshot(page, email, 'captcha_snapshot.html');
            }
        }
    }

    private async saveSnapshot(page: Page, email: string, filename: string) {
        // 根据配置决定是否保存快照
        if (!this.bot.config.snapshots?.login) {
            return;
        }
        
        // 提取文件名（不含扩展名）
        const baseFilename = filename.replace(/\.html$/, '');
        
        // 添加设备类型前缀
        const deviceType = this.bot.isMobile ? 'app' : 'pc';
        const prefixedFilename = `${deviceType}_${baseFilename}`;
        
        this.bot.log(this.bot.isMobile, '调试模式', `[${email}] 正在保存页面快照...`, 'warn');
        try {

            // 等待页面完全加载
            await this.bot.utils.wait(3000);
            
            // 等待页面网络空闲，确保内容完全加载
            try {
                await page.waitForLoadState('networkidle', { timeout: 10000 });
            } catch (error) {
                this.bot.log(this.bot.isMobile, '调试模式', `等待页面网络空闲超时，继续保存快照`, 'warn');
            }
            
            // 再次等待确保DOM完全渲染
            await this.bot.utils.wait(2000);
            
            const sessionDir = path.join(process.cwd(), this.bot.config.sessionPath, email);
            if (!fs.existsSync(sessionDir)) {
                fs.mkdirSync(sessionDir, { recursive: true });
            }

            // 保存HTML格式（保持原有功能）
            const htmlContent = await page.content();
            const htmlSnapshotPath = path.join(sessionDir, `${prefixedFilename}.html`);
            fs.writeFileSync(htmlSnapshotPath, htmlContent);
            this.bot.log(this.bot.isMobile, '调试模式', `HTML快照已成功保存到: ${htmlSnapshotPath}`, 'log', 'green');

            // 保存图片格式（新增功能）
            const imageSnapshotPath = path.join(sessionDir, `${prefixedFilename}.png`);
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

    private async handleCookiesConsent(page: Page) {
        try {
            this.bot.log(this.bot.isMobile, '登录', '开始检测Microsoft Rewards页面的cookies授权弹窗...');
            
            // 等待页面完全加载
            await this.bot.utils.wait(3000);
            
            // 方法1：查找模态弹窗中的"接受"按钮
            const acceptButtonSelectors = [
                // 中文按钮
                'button:has-text("接受")',
                'button:has-text("同意")',
                'button:has-text("允许")',
                'button:has-text("确定")',
                'button:has-text("是")',
                'button:has-text("好")',
                'button:has-text("好的")',
                
                // 英文按钮
                'button:has-text("Accept")',
                'button:has-text("Accept all")',
                'button:has-text("Accept All")',
                'button:has-text("Allow")',
                'button:has-text("Allow all")',
                'button:has-text("Allow All")',
                'button:has-text("I agree")',
                'button:has-text("I Accept")',
                'button:has-text("OK")',
                'button:has-text("Yes")',
                
                // 数据属性选择器
                '[data-testid="accept"]',
                '[data-testid="accept-all"]',
                '[data-testid="allow"]',
                '[data-testid="allow-all"]',
                '[data-testid="agree"]',
                '[data-testid="consent-accept"]',
                '[data-testid="cookie-accept"]',
                
                // 类名选择器
                '.accept',
                '.accept-all',
                '.allow',
                '.allow-all',
                '.agree',
                '.consent-accept',
                '.cookie-accept',
                '.accept-button',
                '.allow-button',
                '.agree-button',
                
                // ID选择器
                '#accept',
                '#accept-all',
                '#allow',
                '#allow-all',
                '#agree',
                '#consent-accept',
                '#cookie-accept',
                '#accept-button',
                '#allow-button',
                '#agree-button'
            ];
            
            let cookiesAccepted = false;
            
            // 尝试使用选择器查找"接受"按钮
            for (const selector of acceptButtonSelectors) {
                try {
                    const button = page.locator(selector);
                    if (await button.count() > 0 && await button.isVisible({ timeout: 2000 })) {
                        this.bot.log(this.bot.isMobile, '登录', `找到cookies授权"接受"按钮: ${selector}`);
                        
                        // 滚动到按钮位置，确保可见
                        await button.scrollIntoViewIfNeeded();
                        await this.bot.utils.wait(500);
                        
                        // 点击按钮
                        await button.click({ timeout: 5000 });
                        this.bot.log(this.bot.isMobile, '登录', '已点击cookies授权"接受"按钮');
                        cookiesAccepted = true;
                        await this.bot.utils.wait(2000); // 等待弹窗消失
                        break;
                    }
                } catch (error) {
                    continue;
                }
            }
            
            // 方法2：如果选择器方法失败，使用文本搜索方法
            if (!cookiesAccepted) {
                this.bot.log(this.bot.isMobile, '登录', '选择器方法未找到按钮，尝试文本搜索方法...');
                
                try {
                    // 查找页面中所有按钮
                    const allButtons = page.locator('button, input[type="button"], input[type="submit"], a[role="button"]');
                    const buttonCount = await allButtons.count();
                    
                    this.bot.log(this.bot.isMobile, '登录', `页面中共找到 ${buttonCount} 个按钮，正在检查文本内容...`);
                    
                    for (let i = 0; i < buttonCount; i++) {
                        try {
                            const button = allButtons.nth(i);
                            
                            // 检查按钮是否可见
                            if (!(await button.isVisible({ timeout: 1000 }))) {
                                continue;
                            }
                            
                            // 获取按钮文本
                            const buttonText = await button.textContent();
                            if (!buttonText || buttonText.trim() === '') {
                                continue;
                            }
                            
                            const buttonTextLower = buttonText.trim().toLowerCase();
                            
                            // 检查按钮文本是否包含"接受"、"允许"、"同意"等关键词
                            if (buttonTextLower.includes('接受') || 
                                buttonTextLower.includes('允许') || 
                                buttonTextLower.includes('同意') || 
                                buttonTextLower.includes('确定') || 
                                buttonTextLower.includes('是') ||
                                buttonTextLower.includes('好') ||
                                buttonTextLower.includes('accept') || 
                                buttonTextLower.includes('allow') || 
                                buttonTextLower.includes('agree') || 
                                buttonTextLower.includes('ok') || 
                                buttonTextLower.includes('yes')) {
                                
                                this.bot.log(this.bot.isMobile, '登录', `通过文本匹配找到可能的cookies授权按钮: "${buttonText}"`);
                                
                                // 滚动到按钮位置，确保可见
                                await button.scrollIntoViewIfNeeded();
                                await this.bot.utils.wait(500);
                                
                                // 点击按钮
                                await button.click({ timeout: 5000 });
                                this.bot.log(this.bot.isMobile, '登录', `已点击通过文本匹配找到的按钮: "${buttonText}"`);
                                cookiesAccepted = true;
                                await this.bot.utils.wait(2000); // 等待弹窗消失
                                break;
                            }
                        } catch (error) {
                            continue;
                        }
                    }
                } catch (error) {
                    this.bot.log(this.bot.isMobile, '登录', `文本搜索方法出错: ${error}`, 'warn');
                }
            }
            
            // 方法3：查找模态弹窗中的任何可点击元素
            if (!cookiesAccepted) {
                this.bot.log(this.bot.isMobile, '登录', '前两种方法都失败，尝试查找模态弹窗中的可点击元素...');
                
                try {
                    // 查找包含cookies相关文本的元素
                    const cookiesElements = page.locator('*:has-text("Cookie"), *:has-text("cookie"), *:has-text("Cookies"), *:has-text("cookies")');
                    const elementCount = await cookiesElements.count();
                    
                    this.bot.log(this.bot.isMobile, '登录', `找到 ${elementCount} 个包含cookies文本的元素`);
                    
                    for (let i = 0; i < elementCount; i++) {
                        try {
                            const element = cookiesElements.nth(i);
                            
                            // 检查元素是否可见
                            if (!(await element.isVisible({ timeout: 1000 }))) {
                                continue;
                            }
                            
                            // 检查元素是否可点击
                            const tagName = await element.evaluate((el: any) => el.tagName.toLowerCase());
                            if (tagName === 'button' || tagName === 'a' || tagName === 'input') {
                                const elementText = await element.textContent();
                                this.bot.log(this.bot.isMobile, '登录', `找到可点击的cookies相关元素: ${tagName}, 文本: "${elementText}"`);
                                
                                // 滚动到元素位置，确保可见
                                await element.scrollIntoViewIfNeeded();
                                await this.bot.utils.wait(500);
                                
                                // 点击元素
                                await element.click({ timeout: 5000 });
                                this.bot.log(this.bot.isMobile, '登录', `已点击cookies相关元素`);
                                cookiesAccepted = true;
                                await this.bot.utils.wait(2000); // 等待弹窗消失
                                break;
                            }
                        } catch (error) {
                            continue;
                        }
                    }
                } catch (error) {
                    this.bot.log(this.bot.isMobile, '登录', `查找cookies文本元素方法出错: ${error}`, 'warn');
                }
            }
            
            if (cookiesAccepted) {
                this.bot.log(this.bot.isMobile, '登录', 'Microsoft Rewards页面的cookies授权弹窗已成功处理');
            } else {
                this.bot.log(this.bot.isMobile, '登录', '未检测到Microsoft Rewards页面的cookies授权弹窗或已处理');
            }
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '登录', `处理Microsoft Rewards页面的cookies授权弹窗时出错: ${errorMessage}`, 'warn');
        }
    }
}