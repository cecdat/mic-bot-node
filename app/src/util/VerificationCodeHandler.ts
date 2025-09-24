import { Page } from 'playwright';
import { log } from './Logger';

export interface VerificationCodeConfig {
    auxiliary_email?: string;
    main_account_email?: string;  // 主账户邮箱
    max_retries?: number;
    retry_interval?: number;
    timeout?: number;
}

// 全局验证码处理锁，防止多个端同时处理同一个账户的验证码
const verificationLocks = new Map<string, boolean>();

export class VerificationCodeHandler {
    private config: VerificationCodeConfig;
    private currentVerificationId: number | null = null;

    constructor(config: VerificationCodeConfig) {
        this.config = {
            max_retries: 10,
            retry_interval: 30000, // 30秒
            timeout: 300000, // 5分钟
            ...config
        };
    }

    /**
     * 处理辅助邮箱验证码
     * @param page Playwright页面对象
     * @param accountEmail 主账户邮箱
     * @param deviceType 设备类型 ('pc' | 'mobile')
     * @returns 是否成功处理验证码
     */
    async handleAuxiliaryEmailVerification(page: Page, accountEmail: string, deviceType: string = 'pc'): Promise<boolean> {
        if (!this.config.auxiliary_email) {
            log('main', '验证码处理', `账户 ${accountEmail} 未配置辅助邮箱，跳过验证码处理`);
            return false;
        }

        // 创建验证码处理锁的键
        const lockKey = `${accountEmail}_verification`;
        
        // 检查是否已有其他端在处理验证码
        if (verificationLocks.has(lockKey)) {
            log('main', '验证码处理', `账户 ${accountEmail} 的验证码正在被其他端处理，跳过当前处理`, 'warn');
            return false;
        }

        // 设置锁
        verificationLocks.set(lockKey, true);
        log('main', '验证码处理', `[${deviceType}] 开始处理账户 ${accountEmail} 的辅助邮箱验证码`);

        try {
            // 等待验证码输入页面加载
            await this.waitForVerificationPage(page, deviceType);

            // 检查是否需要发送验证码
            if (await this.needsToSendCode(page)) {
                await this.sendVerificationCode(page, accountEmail);
            }

            // 等待并获取验证码
            const verificationCode = await this.waitForVerificationCode();
            if (!verificationCode) {
                log('main', '验证码处理', `未能获取到验证码，验证失败`);
                return false;
            }

            // 填入验证码
            await this.enterVerificationCode(page, verificationCode, deviceType);

            // 等待验证结果
            const success = await this.waitForVerificationResult(page, deviceType);
            if (success) {
                log('main', '验证码处理', `[${deviceType}] 账户 ${accountEmail} 验证码验证成功`);
                return true;
            } else {
                log('main', '验证码处理', `[${deviceType}] 账户 ${accountEmail} 验证码验证失败`);
                return false;
            }

        } catch (error) {
            log('main', '验证码处理', `[${deviceType}] 处理验证码时出错: ${error}`, 'error');
            return false;
        } finally {
            // 释放锁
            verificationLocks.delete(lockKey);
            log('main', '验证码处理', `[${deviceType}] 释放账户 ${accountEmail} 的验证码处理锁`);
        }
    }

    /**
     * 等待验证码页面加载
     */
    private async waitForVerificationPage(page: Page, deviceType: string = 'pc'): Promise<void> {
        try {
            // 首先检查是否在身份验证选择页面
            const isIdentityVerificationPage = await this.isIdentityVerificationPage(page);
            if (isIdentityVerificationPage) {
                log('main', '验证码处理', '检测到身份验证选择页面，准备发送验证码');
                await this.handleIdentityVerificationPage(page, deviceType);
                return;
            }

            // 检查是否在"Sign in another way"页面
            const isSignInAnotherWayPage = await this.isSignInAnotherWayPage(page);
            if (isSignInAnotherWayPage) {
                log('main', '验证码处理', '检测到Sign in another way页面，准备点击Use your password');
                await this.handleSignInAnotherWayPage(page, deviceType);
                return;
            }

            // 检查是否在"即将完成"页面
            const isAlmostDonePage = await this.isAlmostDonePage(page);
            if (isAlmostDonePage) {
                log('main', '验证码处理', '检测到即将完成页面，准备点击发送验证码链接');
                await this.handleAlmostDonePage(page, deviceType);
                return;
            }

            // 检查是否在"验证你的电子邮件"页面
            const isEmailVerificationPage = await this.isEmailVerificationPage(page);
            if (isEmailVerificationPage) {
                log('main', '验证码处理', '检测到验证你的电子邮件页面，准备处理辅助邮箱输入');
                await this.handleAuxiliaryEmailInputPage(page, deviceType);
                return;
            }

            // 等待页面包含验证相关的元素
            await page.waitForSelector('input[type="text"], input[name="otc"], #otc, [data-testid*="otc"]', {
                timeout: 10000
            });
            log('main', '验证码处理', '验证码页面已加载');
        } catch (error) {
            log('main', '验证码处理', '等待验证码页面超时，可能不需要验证码', 'warn');
            throw new Error('验证码页面未找到');
        }
    }

    /**
     * 检查是否在身份验证选择页面
     */
    private async isIdentityVerificationPage(page: Page): Promise<boolean> {
        try {
            // 检查页面标题是否包含"验证你的身份"
            const title = await page.title();
            log('main', '验证码处理', `页面标题: ${title}`);
            
            if (title.includes('验证你的身份') || title.includes('Verify your identity')) {
                log('main', '验证码处理', '通过页面标题检测到身份验证页面');
                return true;
            }

            // 检查页面内容是否包含相关文本
            const pageText = await page.textContent('body');
            if (pageText) {
                const verificationKeywords = [
                    '验证你的身份',
                    'Verify your identity',
                    '发送电子邮件',
                    'Send email',
                    'he*****@qq.com',
                    '@qq.com',
                    '@gmail.com',
                    '@outlook.com'
                ];

                for (const keyword of verificationKeywords) {
                    if (pageText.includes(keyword)) {
                        log('main', '验证码处理', `通过关键词 "${keyword}" 检测到身份验证页面`);
                        return true;
                    }
                }
            }

            // 检查URL是否包含验证相关路径
            const currentUrl = page.url();
            if (currentUrl.includes('login.live.com') || currentUrl.includes('account.microsoft.com')) {
                log('main', '验证码处理', '通过URL检测到可能的身份验证页面');
                return true;
            }

            log('main', '验证码处理', '未检测到身份验证选择页面');
            return false;
        } catch (error) {
            log('main', '验证码处理', `检查身份验证页面时出错: ${error}`, 'error');
            return false;
        }
    }

    /**
     * 处理身份验证选择页面
     */
    private async handleIdentityVerificationPage(page: Page, deviceType: string = 'pc'): Promise<void> {
        try {
            log('main', '验证码处理', '正在处理身份验证选择页面');

            // 查找并点击"发送电子邮件"选项
            const emailOption = await this.findEmailVerificationOption(page);
            if (emailOption) {
                await emailOption.click();
                log('main', '验证码处理', '已点击发送电子邮件选项');
                
                // 等待页面跳转到辅助邮箱输入页面
                await page.waitForTimeout(3000);
                
                // 保存点击后的页面快照
                await this.savePageSnapshot(page, 'verification_after_click', deviceType);
                log('main', '验证码处理', `已保存点击后页面快照`);
                
                // 检查是否跳转到辅助邮箱输入页面
                const isAuxiliaryEmailPage = await this.isAuxiliaryEmailInputPage(page);
                if (isAuxiliaryEmailPage) {
                    log('main', '验证码处理', '已跳转到辅助邮箱输入页面');
                    await this.handleAuxiliaryEmailInputPage(page, deviceType);
                } else {
                    log('main', '验证码处理', '未跳转到辅助邮箱输入页面，尝试其他方法', 'warn');
                    // 保存当前页面状态用于调试
                    await this.savePageSnapshot(page, 'verification_debug', deviceType);
                    log('main', '验证码处理', `已保存调试页面快照`);
                }
            } else {
                log('main', '验证码处理', '未找到发送电子邮件选项', 'error');
                throw new Error('未找到发送电子邮件选项');
            }
        } catch (error) {
            log('main', '验证码处理', `处理身份验证选择页面失败: ${error}`, 'error');
            throw error;
        }
    }

    /**
     * 查找发送电子邮件选项
     */
    private async findEmailVerificationOption(page: Page): Promise<any> {
        try {
            // 首先获取页面内容进行调试
            const pageText = await page.textContent('body');
            log('main', '验证码处理', `页面内容预览: ${pageText?.substring(0, 500)}...`);

            // 方法1：查找包含"发送电子邮件"文本的元素
            const emailOption = await page.$('text="发送电子邮件", text="Send email"');
            if (emailOption) {
                // 移除找到方法1的发送电子邮件选项的日志，减少非关键信息输出
                return emailOption;
            }

            // 方法2：查找包含邮箱地址的元素（更宽松的匹配）
            const emailWithAddress = await page.$('text=/向.*@.*发送电子邮件/, text=/Send email to.*@.*/');
            if (emailWithAddress) {
                // 移除找到方法2的发送电子邮件选项的日志，减少非关键信息输出
                return emailWithAddress;
            }

            // 方法3：查找包含"@qq.com"等邮箱域名的元素
            const emailDomainOption = await page.$('text=/@qq\.com/, text=/@gmail\.com/, text=/@outlook\.com/, text=/@163\.com/');
            if (emailDomainOption) {
                // 移除找到方法3的邮箱域名选项的日志，减少非关键信息输出
                return emailDomainOption;
            }

            // 方法4：查找包含信封图标的元素
            const envelopeIcon = await page.$('[data-testid*="email"], [aria-label*="email"], .email-icon, [class*="email"], [class*="mail"]');
            if (envelopeIcon) {
                log('main', '验证码处理', '找到方法4的信封图标选项');
                return envelopeIcon;
            }

            // 方法5：查找可点击的按钮或链接
            const clickableElements = await page.$$('button, a, [role="button"], [tabindex]');
            for (const element of clickableElements) {
                const text = await element.textContent();
                if (text && (text.includes('@') || text.includes('邮件') || text.includes('email'))) {
                    log('main', '验证码处理', `找到方法5的可点击元素: ${text}`);
                    return element;
                }
            }

            // 方法6：使用JavaScript查找所有包含邮箱相关文本的元素
            const jsResult = await page.evaluate(() => {
                const elements = Array.from(document.querySelectorAll('*')).filter(el => {
                    const text = el.textContent || '';
                    return text.includes('发送电子邮件') || 
                           text.includes('Send email') || 
                           text.includes('@') ||
                           text.includes('邮件') ||
                           text.includes('email');
                });
                
                const visibleElements = elements.filter(el => {
                    const htmlEl = el as HTMLElement;
                    return htmlEl.offsetWidth > 0 && htmlEl.offsetHeight > 0;
                });

                if (visibleElements.length > 0) {
                    const firstElement = visibleElements[0] as HTMLElement;
                    return { 
                        found: true, 
                        tagName: firstElement.tagName,
                        text: firstElement.textContent?.substring(0, 100) || '',
                        className: firstElement.className || ''
                    };
                }
                return { found: false, tagName: '', text: '', className: '' };
            });

            if (jsResult.found) {
                log('main', '验证码处理', `JavaScript找到元素: ${jsResult.tagName}, 文本: ${jsResult.text}, 类名: ${jsResult.className}`);
                // 尝试多种选择器
                const selectors = [
                    `${jsResult.tagName}:has-text("发送电子邮件")`,
                    `${jsResult.tagName}:has-text("Send email")`,
                    `${jsResult.tagName}:has-text("@")`,
                    jsResult.className ? `${jsResult.tagName}.${jsResult.className.split(' ')[0]}` : jsResult.tagName,
                    jsResult.tagName
                ];

                for (const selector of selectors) {
                    try {
                        const element = await page.$(selector);
                        if (element) {
                            log('main', '验证码处理', `使用选择器 ${selector} 找到元素`);
                            return element;
                        }
                    } catch (e) {
                        // 忽略选择器错误，继续尝试下一个
                    }
                }
            }

            log('main', '验证码处理', '所有方法都未找到发送电子邮件选项');
            return null;
        } catch (error) {
            log('main', '验证码处理', `查找发送电子邮件选项失败: ${error}`, 'error');
            return null;
        }
    }

    /**
     * 检查是否在"验证你的电子邮件"页面
     */
    private async isEmailVerificationPage(page: Page): Promise<boolean> {
        try {
            // 检查页面标题
            const title = await page.title();
            log('main', '验证码处理', `检查验证你的电子邮件页面，标题: ${title}`);
            
            if (title.includes('验证你的电子邮件') || title.includes('Verify your email')) {
                log('main', '验证码处理', '通过页面标题检测到验证你的电子邮件页面');
                return true;
            }

            // 检查页面内容
            const pageText = await page.textContent('body');
            if (pageText) {
                const emailVerificationKeywords = [
                    '验证你的电子邮件',
                    'Verify your email',
                    '发送代码',
                    'Send code',
                    '我们将向',
                    'We will send a code to'
                ];

                for (const keyword of emailVerificationKeywords) {
                    if (pageText.includes(keyword)) {
                        log('main', '验证码处理', `通过关键词 "${keyword}" 检测到验证你的电子邮件页面`);
                        return true;
                    }
                }
            }

            // 检查是否包含邮箱输入框
            const emailInput = await page.$('input[type="email"], input[name="email"], #proof-confirmation-email-input');
            if (emailInput) {
                log('main', '验证码处理', '通过输入框检测到验证你的电子邮件页面');
                return true;
            }

            return false;
        } catch (error) {
            log('main', '验证码处理', `检查验证你的电子邮件页面时出错: ${error}`, 'error');
            return false;
        }
    }

    /**
     * 检查是否在"Sign in another way"页面
     */
    private async isSignInAnotherWayPage(page: Page): Promise<boolean> {
        try {
            // 检查页面标题
            const title = await page.title();
            if (title.includes('Sign in another way') || title.includes('另一种方式登录')) {
                log('main', '验证码处理', '通过页面标题检测到Sign in another way页面');
                return true;
            }

            // 检查页面内容
            const pageText = await page.textContent('body');
            if (pageText && (pageText.includes('Sign in another way') || pageText.includes('Use your password') || pageText.includes('Use your face'))) {
                log('main', '验证码处理', '通过页面内容检测到Sign in another way页面');
                return true;
            }

            return false;
        } catch (error) {
            log('main', '验证码处理', `检查Sign in another way页面时出错: ${error}`, 'error');
            return false;
        }
    }

    /**
     * 处理"Sign in another way"页面
     */
    private async handleSignInAnotherWayPage(page: Page, deviceType: string = 'pc'): Promise<void> {
        try {
            log('main', '验证码处理', '正在处理Sign in another way页面');
            
            // 等待页面稳定
            await page.waitForTimeout(2000);
            
            // 检查并移除可能阻止点击的覆盖层
            await this.removeBlockingOverlays(page);
            
            // 点击"Use your password"选项
            const passwordOptionTexts = [
                'Use your password',
                '使用密码',
                'Use password',
                'Password'
            ];
            
            for (const text of passwordOptionTexts) {
                try {
                    const link = await page.locator(`text*="${text}"`).first();
                    if (await link.isVisible({ timeout: 3000 }).catch(() => false)) {
                        // 滚动到链接位置
                        await link.scrollIntoViewIfNeeded();
                        await page.waitForTimeout(500);
                        
                        // 尝试点击
                        try {
                            await link.click({ timeout: 5000, force: true });
                            log('main', '验证码处理', `已点击密码选项: ${text}`);
                        } catch (clickError) {
                            // 如果普通点击失败，尝试JavaScript点击
                            log('main', '验证码处理', '普通点击失败，尝试JavaScript点击', 'warn');
                            await link.evaluate((element: HTMLElement) => element.click());
                            log('main', '验证码处理', `已通过JavaScript点击密码选项: ${text}`);
                        }
                        return;
                    }
                } catch (error) {
                    // 继续尝试下一个文本
                }
            }
            
            log('main', '验证码处理', '未找到密码选项', 'warn');
        } catch (error) {
            log('main', '验证码处理', `处理Sign in another way页面时出错: ${error}`, 'error');
        }
    }

    /**
     * 检查是否在"即将完成"页面
     */
    private async isAlmostDonePage(page: Page): Promise<boolean> {
        try {
            // 检查页面标题
            const title = await page.title();
            if (title.includes('即将完成') || title.includes('Almost done')) {
                log('main', '验证码处理', '通过页面标题检测到即将完成页面');
                return true;
            }

            // 检查页面内容
            const pageText = await page.textContent('body');
            if (pageText && (pageText.includes('即将完成') || pageText.includes('Almost done'))) {
                log('main', '验证码处理', '通过页面内容检测到即将完成页面');
                return true;
            }

            return false;
        } catch (error) {
            log('main', '验证码处理', `检查即将完成页面时出错: ${error}`, 'error');
            return false;
        }
    }

    /**
     * 处理"即将完成"页面
     */
    private async handleAlmostDonePage(page: Page, deviceType: string = 'pc'): Promise<void> {
        try {
            log('main', '验证码处理', '正在处理即将完成页面');
            
            // 等待页面稳定
            await page.waitForTimeout(2000);
            
            // 检查并移除可能阻止点击的覆盖层
            await this.removeBlockingOverlays(page);
            
            // 统一的链接文本列表（移动端和桌面端使用相同的逻辑）
            const linkTexts = [
                '向 cs*****@139.com 发送电子邮件',  // 实际页面显示的文本
                '向',
                '发送电子邮件',
                '将代码发送到',
                '将代码发送',
                'Send code to',
                'Send the code to',
                'Send verification code to',
                'Send email',
                'Email me',
                'Send me an email'
            ];
            
            for (const text of linkTexts) {
                try {
                    // 尝试多种选择器：按钮、链接、span等
                    const selectors = [
                        `button:has-text("${text}")`,
                        `a:has-text("${text}")`,
                        `span:has-text("${text}")`,
                        `text*="${text}"`
                    ];
                    
                    for (const selector of selectors) {
                        try {
                            const element = await page.locator(selector).first();
                            if (await element.isVisible({ timeout: 3000 }).catch(() => false)) {
                                // 滚动到元素位置
                                await element.scrollIntoViewIfNeeded();
                                await page.waitForTimeout(500);
                                
                                // 尝试点击
                                try {
                                    await element.click({ timeout: 5000, force: true });
                                    log('main', '验证码处理', `${deviceType}端已点击: ${text} (选择器: ${selector})`);
                                } catch (clickError) {
                                    // 如果普通点击失败，尝试JavaScript点击
                                    log('main', '验证码处理', '普通点击失败，尝试JavaScript点击', 'warn');
                                    await element.evaluate((el: HTMLElement) => el.click());
                                    log('main', '验证码处理', `${deviceType}端已通过JavaScript点击: ${text} (选择器: ${selector})`);
                                }
                                return;
                            }
                        } catch (error) {
                            // 继续尝试下一个选择器
                            continue;
                        }
                    }
                } catch (error) {
                    // 继续尝试下一个文本
                }
            }
            
            log('main', '验证码处理', '未找到发送验证码的链接', 'warn');
        } catch (error) {
            log('main', '验证码处理', `处理即将完成页面时出错: ${error}`, 'error');
        }
    }

    /**
     * 检查是否在辅助邮箱输入页面
     */
    private async isAuxiliaryEmailInputPage(page: Page): Promise<boolean> {
        try {
            // 检查页面标题
            const title = await page.title();
            if (title.includes('验证你的电子邮件') || title.includes('Verify your email')) {
                log('main', '验证码处理', '通过页面标题检测到辅助邮箱输入页面');
                return true;
            }

            // 检查页面是否包含邮箱输入框
            const emailInput = await page.$('input[type="email"], input[name="email"], #proof-confirmation-email-input');
            if (emailInput) {
                log('main', '验证码处理', '通过输入框检测到辅助邮箱输入页面');
                return true;
            }

            // 检查页面内容
            const pageText = await page.textContent('body');
            if (pageText && (pageText.includes('验证你的电子邮件') || pageText.includes('发送代码'))) {
                log('main', '验证码处理', '通过页面内容检测到辅助邮箱输入页面');
                return true;
            }

            return false;
        } catch (error) {
            log('main', '验证码处理', `检查辅助邮箱输入页面时出错: ${error}`, 'error');
            return false;
        }
    }

    /**
     * 处理辅助邮箱输入页面
     */
    private async handleAuxiliaryEmailInputPage(page: Page, deviceType: string = 'pc'): Promise<void> {
        try {
            log('main', '验证码处理', '正在处理辅助邮箱输入页面');

            // 查找邮箱输入框（多种选择器）
            const emailInput = await page.$('#proof-confirmation-email-input, input[type="email"], input[name="email"], input[type="text"]');
            if (!emailInput) {
                throw new Error('未找到邮箱输入框');
            }

            // 清空输入框并填入辅助邮箱
            await emailInput.fill('');
            await emailInput.type(this.config.auxiliary_email!);
            log('main', '验证码处理', `已填入辅助邮箱: ${this.config.auxiliary_email}`);

            // 等待一下确保输入完成
            await page.waitForTimeout(1000);

            // 检查并移除可能阻止点击的覆盖层
            await this.removeBlockingOverlays(page);
            
            // 查找并点击发送按钮
            const sendButton = await page.locator('button[type="submit"], button:has-text("发送验证码"), button:has-text("Send"), [data-testid="primaryButton"]').first();
            if (await sendButton.isVisible({ timeout: 5000 }).catch(() => false)) {
                // 滚动到按钮位置
                await sendButton.scrollIntoViewIfNeeded();
                
                // 等待按钮稳定
                await page.waitForTimeout(500);
                
                // 尝试点击按钮，使用force选项绕过覆盖层
                try {
                    await sendButton.click({ timeout: 10000, force: true });
                    log('main', '验证码处理', '已点击发送验证码按钮');
                } catch (clickError) {
                    // 如果普通点击失败，尝试使用JavaScript点击
                    log('main', '验证码处理', '普通点击失败，尝试JavaScript点击', 'warn');
                    await sendButton.evaluate((button: HTMLButtonElement) => button.click());
                    log('main', '验证码处理', '已通过JavaScript点击发送验证码按钮');
                }
                
                // 等待发送确认
                await page.waitForTimeout(3000);
                
                // 创建验证码请求
                const verificationId = await this.requestVerificationCode(this.config.main_account_email!);
                if (verificationId) {
                    log('main', '验证码处理', `验证码请求已创建，ID: ${verificationId}`);
                    this.currentVerificationId = verificationId;
                } else {
                    log('main', '验证码处理', '创建验证码请求失败，但继续流程');
                }
            } else {
                log('main', '验证码处理', '未找到发送按钮', 'warn');
            }
        } catch (error) {
            log('main', '验证码处理', `处理辅助邮箱输入页面失败: ${error}`, 'error');
            throw error;
        }
    }

    /**
     * 检查是否需要发送验证码
     */
    private async needsToSendCode(page: Page): Promise<boolean> {
        try {
            // 如果已经有验证码ID，说明已经发送过验证码了
            if (this.currentVerificationId) {
                log('main', '验证码处理', '已有验证码ID，跳过发送验证码');
                return false;
            }
            
            // 检查是否有发送验证码的按钮
            const sendButton = await page.$('button[data-testid*="send"], button:has-text("发送"), button:has-text("Send")');
            return !!sendButton;
        } catch {
            return false;
        }
    }

    /**
     * 移除阻止点击的覆盖层
     */
    private async removeBlockingOverlays(page: Page): Promise<void> {
        try {
            // 检查并移除lightbox-cover覆盖层
            const lightboxCover = await page.$('#lightbox-cover');
            if (lightboxCover) {
                log('main', '验证码处理', '检测到lightbox-cover覆盖层，尝试移除');
                await lightboxCover.evaluate((element: HTMLElement) => {
                    element.style.display = 'none';
                    element.remove();
                });
                log('main', '验证码处理', '已移除lightbox-cover覆盖层');
            }
            
            // 检查并移除其他可能的覆盖层
            const overlays = await page.$$('[class*="overlay"], [class*="modal"], [class*="lightbox"], [class*="cover"]');
            for (const overlay of overlays) {
                const isVisible = await overlay.isVisible().catch(() => false);
                if (isVisible) {
                    const className = await overlay.getAttribute('class').catch(() => '');
                    if (className.includes('cover') || className.includes('overlay')) {
                        log('main', '验证码处理', `检测到覆盖层: ${className}，尝试移除`);
                        await overlay.evaluate((element: HTMLElement) => {
                            element.style.display = 'none';
                            element.remove();
                        });
                    }
                }
            }
            
            // 等待页面稳定
            await page.waitForTimeout(500);
        } catch (error) {
            log('main', '验证码处理', `移除覆盖层时出错: ${error}`, 'warn');
        }
    }

    /**
     * 发送验证码
     */
    private async sendVerificationCode(page: Page, mainAccountEmail: string): Promise<void> {
        try {
            // 等待页面稳定
            await page.waitForTimeout(1000);
            
            // 检查并移除可能阻止点击的覆盖层
            await this.removeBlockingOverlays(page);
            
            // 查找发送验证码按钮
            const sendButton = await page.locator('button[data-testid*="send"], button:has-text("发送"), button:has-text("Send")').first();
            
            if (await sendButton.isVisible({ timeout: 5000 }).catch(() => false)) {
                // 滚动到按钮位置
                await sendButton.scrollIntoViewIfNeeded();
                
                // 等待按钮稳定
                await page.waitForTimeout(500);
                
                // 尝试点击按钮，使用force选项绕过覆盖层
                try {
                    await sendButton.click({ timeout: 10000, force: true });
                    log('main', '验证码处理', '已点击发送验证码按钮');
                } catch (clickError) {
                    // 如果普通点击失败，尝试使用JavaScript点击
                    log('main', '验证码处理', '普通点击失败，尝试JavaScript点击', 'warn');
                    await sendButton.evaluate((button: HTMLButtonElement) => button.click());
                    log('main', '验证码处理', '已通过JavaScript点击发送验证码按钮');
                }
            } else {
                throw new Error('未找到发送验证码按钮');
            }
            
            // 等待发送确认
            await page.waitForTimeout(2000);
            
            // 调用Service端创建验证码请求
            const verificationId = await this.requestVerificationCode(mainAccountEmail);
            if (verificationId) {
                log('main', '验证码处理', `验证码请求已创建，ID: ${verificationId}`);
                // 存储验证码ID供后续使用
                this.currentVerificationId = verificationId;
            } else {
                log('main', '验证码处理', '创建验证码请求失败，但继续流程');
            }
        } catch (error) {
            log('main', '验证码处理', `发送验证码失败: ${error}`, 'error');
            throw error;
        }
    }

    /**
     * 等待并获取验证码
     */
    private async waitForVerificationCode(): Promise<string | null> {
        try {
            log('main', '验证码处理', '开始等待验证码...');
            
            // 获取最新的验证码请求ID（从sendVerificationCode方法中创建）
            const verificationId = await this.getLatestVerificationId();
            if (!verificationId) {
                log('main', '验证码处理', '未找到验证码请求，尝试创建新的请求');
                if (!this.config.main_account_email) {
                    log('main', '验证码处理', '未配置主账户邮箱，无法创建验证码请求');
                    return null;
                }
                const newVerificationId = await this.requestVerificationCode(this.config.main_account_email);
                if (!newVerificationId) {
                    log('main', '验证码处理', '创建验证码请求失败');
                    return null;
                }
                return await this.waitForVerificationCodeWithId(newVerificationId);
            }
            
            return await this.waitForVerificationCodeWithId(verificationId);
        } catch (error) {
            log('main', '验证码处理', `等待验证码时出错: ${error}`, 'error');
            return null;
        }
    }

    /**
     * 使用指定ID等待验证码
     */
    private async waitForVerificationCodeWithId(verificationId: number): Promise<string | null> {
        log('main', '验证码处理', `开始等待验证码，ID: ${verificationId}`);
        
        // 循环检查验证码状态，最多等待300秒
        const maxWaitTime = 300 * 1000; // 300秒
        const checkInterval = 3000; // 每3秒检查一次
        const startTime = Date.now();
        
        while (Date.now() - startTime < maxWaitTime) {
            const result = await this.checkVerificationCode(verificationId);
            
            if (result.status === 'completed' && result.code) {
                log('main', '验证码处理', `成功获取验证码: ${result.code}`);
                return result.code;
            } else if (result.status === 'expired') {
                log('main', '验证码处理', '验证码已过期');
                return null;
            }
            
            // 计算剩余时间并显示倒计时
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            const remaining = Math.max(0, 300 - elapsed);
            log('main', '验证码处理', `等待验证码输入...${remaining}s`);
            
            await new Promise(resolve => setTimeout(resolve, checkInterval));
        }
        
        log('main', '验证码处理', '等待验证码超时');
        return null;
    }

    /**
     * 获取最新的验证码请求ID
     */
    private async getLatestVerificationId(): Promise<number | null> {
        return this.currentVerificationId;
    }



    /**
     * 填入验证码
     */
    private async enterVerificationCode(page: Page, code: string, deviceType: string = 'pc'): Promise<void> {
        try {
            // 输入验证码前保存快照
            await this.savePageSnapshot(page, 'before_verification_input', deviceType);
            
            // 查找验证码输入框
            const codeInput = await page.$('input[type="text"], input[name="otc"], #otc, [data-testid*="otc"]');
            if (!codeInput) {
                throw new Error('未找到验证码输入框');
            }

            // 清空并填入验证码
            await codeInput.fill('');
            await codeInput.type(code);
            log('main', '验证码处理', `已填入验证码: ${code}`);

            // 点击提交按钮
            await page.click('button[type="submit"], button:has-text("验证"), button:has-text("Verify")');
            
            // 输入验证码后保存快照
            await this.savePageSnapshot(page, 'after_verification_input', deviceType);
            
        } catch (error) {
            log('main', '验证码处理', `填入验证码失败: ${error}`, 'error');
            throw error;
        }
    }

    /**
     * 等待验证结果
     */
    private async waitForVerificationResult(page: Page, deviceType: string = 'pc'): Promise<boolean> {
        try {
            // 等待页面跳转或显示成功信息
            await page.waitForTimeout(5000);

            // 验证结果后保存快照
            await this.savePageSnapshot(page, 'verification_result', deviceType);

            // 检查是否验证成功（页面URL变化或显示成功信息）
            const currentUrl = page.url();
            log('main', '验证码处理', `验证后页面URL: ${currentUrl}`);
            
            // 检查是否已经登录成功（跳转到rewards页面或其他成功页面）
            if (currentUrl.includes('rewards.bing.com') || 
                currentUrl.includes('account.microsoft.com') ||
                currentUrl.includes('bing.com') ||
                currentUrl.includes('microsoft.com')) {
                log('main', '验证码处理', '验证成功：页面已跳转到目标网站');
                return true;
            }

            // 检查是否有错误信息
            const errorElement = await page.$('[data-testid*="error"], .error, .alert-error');
            if (errorElement) {
                const errorText = await errorElement.textContent();
                log('main', '验证码处理', `验证失败: ${errorText}`, 'error');
                return false;
            }

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
                
                log('main', '验证码处理', '验证可能失败：仍在登录页面');
                return false;
            }

            log('main', '验证码处理', '验证结果：页面状态未知，假设成功');
            return true;
        } catch (error) {
            log('main', '验证码处理', `等待验证结果时出错: ${error}`, 'error');
            return false;
        }
    }

    /**
     * 保存页面快照
     */
    private async savePageSnapshot(page: Page, snapshotName: string, deviceType: string = 'pc'): Promise<void> {
        // 正式环境禁用验证码快照保存
        return;
    }

    /**
     * 请求Service端创建验证码请求
     */
    private async requestVerificationCode(mainAccountEmail: string): Promise<number | null> {
        try {
            const axios = require('axios');
            const { loadConfig } = require('./Load');
            const config = loadConfig();
            
            if (!config.apiServer?.enabled || !config.apiServer?.updateUrl || !config.apiServer?.token) {
                log('main', '验证码处理', 'API配置不完整，无法请求验证码');
                return null;
            }
            
            const apiUrl = new URL(config.apiServer.updateUrl);
            apiUrl.pathname = '/web_api/verification/request';
            
            const response = await axios.post(apiUrl.toString(), {
                main_account_email: mainAccountEmail,  // 主账户邮箱（正在执行登录的账户）
                auxiliary_email: this.config.auxiliary_email  // 辅助邮箱（用于接收验证码）
            }, {
                headers: {
                    'Authorization': `Bearer ${config.apiServer.token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.data.success) {
                return response.data.verification_id;
            } else {
                log('main', '验证码处理', `创建验证码请求失败: ${response.data.message}`);
                return null;
            }
        } catch (error) {
            log('main', '验证码处理', `请求验证码失败: ${error}`, 'error');
            return null;
        }
    }

    /**
     * 检查验证码状态
     */
    private async checkVerificationCode(verificationId: number): Promise<{status: string, code?: string}> {
        try {
            const axios = require('axios');
            const { loadConfig } = require('./Load');
            const config = loadConfig();
            
            const apiUrl = new URL(config.apiServer!.updateUrl);
            apiUrl.pathname = `/web_api/verification/check/${verificationId}`;
            
            const response = await axios.get(apiUrl.toString(), {
                headers: {
                    'Authorization': `Bearer ${config.apiServer!.token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.data.success) {
                return {
                    status: response.data.status,
                    code: response.data.code
                };
            } else {
                log('main', '验证码处理', `检查验证码状态失败: ${response.data.message}`);
                return { status: 'error' };
            }
        } catch (error) {
            log('main', '验证码处理', `检查验证码状态失败: ${error}`, 'error');
            return { status: 'error' };
        }
    }
}
