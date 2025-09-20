import { Page } from 'playwright';
import { MicrosoftRewardsBot } from '../index';

export interface PageExceptionResult {
    detected: boolean;
    pageType: string;
    action?: string;
    message?: string;
}

export class PageExceptionDetector {
    private bot: MicrosoftRewardsBot;

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot;
    }

    /**
     * 检测页面异常情况并执行相应的处理
     * @param page 页面对象
     * @param email 账户邮箱
     * @param timeout 检测超时时间（毫秒）
     * @returns 检测结果
     */
    async detectAndHandle(page: Page, email: string, timeout: number = 10000): Promise<PageExceptionResult> {
        try {
            this.bot.log(this.bot.isMobile, '页面检测', `[${email}] 开始检测页面异常情况...`);
            
            // 等待页面稳定
            await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
            
            // 1. 检测身份验证页面（即将完成）- 优先级最高，避免误识别
            const verificationResult = await this.detectVerificationPage(page, email);
            if (verificationResult.detected) {
                return verificationResult;
            }

            // 2. 检测生物识别页面
            const biometricResult = await this.detectBiometricPage(page, email);
            if (biometricResult.detected) {
                return biometricResult;
            }

            // 3. 检测辅助邮箱验证页面
            const emailVerificationResult = await this.detectEmailVerificationPage(page, email);
            if (emailVerificationResult.detected) {
                return emailVerificationResult;
            }

            // 4. 检测登录保持页面
            const staySignedInResult = await this.detectStaySignedInPage(page, email);
            if (staySignedInResult.detected) {
                return staySignedInResult;
            }

            // 5. 检测Cookie同意页面
            const cookieConsentResult = await this.detectCookieConsentPage(page, email);
            if (cookieConsentResult.detected) {
                return cookieConsentResult;
            }

            // 6. 检测账户锁定页面
            const accountLockResult = await this.detectAccountLockPage(page, email);
            if (accountLockResult.detected) {
                return accountLockResult;
            }

            // 7. 检测两步验证页面
            const twoFactorResult = await this.detectTwoFactorPage(page, email);
            if (twoFactorResult.detected) {
                return twoFactorResult;
            }

            // 8. 检测网络错误页面
            const networkErrorResult = await this.detectNetworkErrorPage(page, email);
            if (networkErrorResult.detected) {
                return networkErrorResult;
            }

            this.bot.log(this.bot.isMobile, '页面检测', `[${email}] 未检测到已知的页面异常`);
            return {
                detected: false,
                pageType: 'unknown',
                message: '未检测到已知的页面异常'
            };

        } catch (error) {
            this.bot.log(this.bot.isMobile, '页面检测', `[${email}] 页面异常检测出错: ${error}`, 'error');
            return {
                detected: false,
                pageType: 'error',
                message: `检测出错: ${error}`
            };
        }
    }

    /**
     * 检测生物识别页面（使用人脸、指纹或PIN更快登录）
     */
    private async detectBiometricPage(page: Page, email: string): Promise<PageExceptionResult> {
        try {
            // 更精确的检测文本，包含更多变体，特别是移动端
            const biometricTexts = [
                '使用人脸、指纹或PIN更快登录',
                '使用人脸、指纹或PIN',
                '使用人脸、指纹或 PIN',
                '使用人脸、指纹或PIN更快地登录',  // 新增：移动端精确匹配（无空格）
                '使用人脸、指纹或 PIN 更快地登录',
                '使用人脸、指纹或 PIN 更快地',
                '使用人脸、指纹或PIN更快地',
                'Use face, fingerprint, or PIN for faster sign-in',
                'Use face, fingerprint, or PIN',
                'Use Windows Hello or a security key',
                '使用 Windows Hello 或安全密钥',
                '人脸、指纹、PIN',
                'Face, fingerprint, or PIN',
                'Windows Hello',
                '安全密钥',
                'Security key'
            ];

            // 首先检查页面标题和内容
            const pageTitle = await page.title();
            const pageText = await page.textContent('body');
            
            let isBiometricPage = false;
            let detectedText = '';

            // 检查页面标题
            for (const text of biometricTexts) {
                if (pageTitle.toLowerCase().includes(text.toLowerCase())) {
                    isBiometricPage = true;
                    detectedText = text;
                    break;
                }
            }

            // 如果标题中没有找到，检查页面内容
            if (!isBiometricPage && pageText) {
                for (const text of biometricTexts) {
                    if (pageText.toLowerCase().includes(text.toLowerCase())) {
                        isBiometricPage = true;
                        detectedText = text;
                        break;
                    }
                }
            }

            // 如果仍然没有找到，使用更宽松的匹配（移动端可能需要）
            if (!isBiometricPage) {
                const looseTexts = [
                    '人脸',
                    '指纹', 
                    'PIN',
                    'face',
                    'fingerprint',
                    'biometric',
                    '生物识别',
                    '更快地登录',
                    'faster sign-in'
                ];
                
                for (const text of looseTexts) {
                    if (pageTitle.toLowerCase().includes(text.toLowerCase()) || 
                        (pageText && pageText.toLowerCase().includes(text.toLowerCase()))) {
                        // 额外检查：确保不是验证页面
                        if (pageText && !this.isVerificationPage(pageText)) {
                            isBiometricPage = true;
                            detectedText = text;
                            break;
                        }
                    }
                }
            }

            // 额外检查：如果页面包含"即将完成"或"验证你的身份"等文本，则不是生物识别页面
            if (isBiometricPage && pageText) {
                if (this.isVerificationPage(pageText)) {
                    this.bot.log(this.bot.isMobile, '页面检测', `[${email}] 页面包含验证文本，排除生物识别页面`);
                    return { detected: false, pageType: 'biometric' };
                }
            }

            if (isBiometricPage) {
                this.bot.log(this.bot.isMobile, '页面检测', `[${email}] 检测到生物识别页面: "${detectedText}"，尝试点击"暂时跳过"`);
                
                // 尝试多种方式查找"暂时跳过"按钮
                let skipClicked = false;
                
                // 方法1：使用data-testid选择器
                try {
                    const skipButton = page.locator('[data-testid="secondaryButton"]');
                    if (await skipButton.isVisible({ timeout: 2000 })) {
                        const buttonText = await skipButton.textContent();
                        this.bot.log(this.bot.isMobile, '页面检测', `[${email}] 找到"暂时跳过"按钮: ${buttonText}`);
                        await skipButton.scrollIntoViewIfNeeded();
                        await skipButton.click({ timeout: 5000 });
                        skipClicked = true;
                        this.bot.log(this.bot.isMobile, '页面检测', `[${email}] 成功点击"暂时跳过"按钮`);
                    }
                } catch (error) {
                    this.bot.log(this.bot.isMobile, '页面检测', `[${email}] 方法1失败: ${error}`, 'warn');
                }

                // 方法2：使用文本选择器
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
                                this.bot.log(this.bot.isMobile, '页面检测', `[${email}] 找到"暂时跳过"按钮: ${selector}`);
                                await element.scrollIntoViewIfNeeded();
                                await element.click({ timeout: 5000 });
                                skipClicked = true;
                                this.bot.log(this.bot.isMobile, '页面检测', `[${email}] 成功点击"暂时跳过"按钮`);
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
                        this.bot.log(this.bot.isMobile, '页面检测', `[${email}] 尝试使用JavaScript点击"暂时跳过"按钮`);
                        
                        const jsResult = await page.evaluate(() => {
                            const elements = Array.from(document.querySelectorAll('*')).filter(el => {
                                const text = el.textContent || '';
                                return text.includes('暂时跳过') || 
                                       text.includes('Skip for now') || 
                                       text.includes('跳过') || 
                                       text.includes('Skip');
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
                            skipClicked = true;
                            this.bot.log(this.bot.isMobile, '页面检测', `[${email}] JavaScript点击"暂时跳过"成功: ${jsResult.element} - ${jsResult.text}`);
                        } else {
                            this.bot.log(this.bot.isMobile, '页面检测', `[${email}] JavaScript点击"暂时跳过"失败: ${jsResult.reason}`, 'warn');
                        }
                    } catch (error) {
                        this.bot.log(this.bot.isMobile, '页面检测', `[${email}] JavaScript点击"暂时跳过"异常: ${error}`, 'warn');
                    }
                }

                if (skipClicked) {
                    // 等待页面跳转
                    await this.bot.utils.wait(3000);
                    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
                    
                    return {
                        detected: true,
                        pageType: 'biometric',
                        action: 'skip_clicked',
                        message: '已点击暂时跳过按钮'
                    };
                } else {
                    this.bot.log(this.bot.isMobile, '页面检测', `[${email}] 无法找到"暂时跳过"按钮，需要手动处理`, 'warn');
                    return {
                        detected: true,
                        pageType: 'biometric',
                        action: 'manual_required',
                        message: '检测到生物识别页面但无法自动点击跳过按钮，需要手动处理'
                    };
                }
            }

            return { detected: false, pageType: 'biometric' };
        } catch (error) {
            this.bot.log(this.bot.isMobile, '页面检测', `[${email}] 生物识别页面检测出错: ${error}`, 'error');
            return { detected: false, pageType: 'biometric', message: `检测出错: ${error}` };
        }
    }

    /**
     * 检测辅助邮箱验证页面
     */
    private async detectEmailVerificationPage(page: Page, email: string): Promise<PageExceptionResult> {
        try {
            const emailTexts = [
                '验证你的身份',
                'Verify your identity',
                '我们需要验证你的身份',
                'We need to verify your identity',
                '向备用电子邮件发送代码',
                'Send code to alternate email'
            ];

            let isEmailVerificationPage = false;
            let detectedText = '';

            // 检查页面标题和内容
            const pageTitle = await page.title();
            const pageText = await page.textContent('body');

            // 检查页面标题
            for (const text of emailTexts) {
                if (pageTitle.toLowerCase().includes(text.toLowerCase())) {
                    isEmailVerificationPage = true;
                    detectedText = text;
                    break;
                }
            }

            // 如果标题中没有找到，检查页面内容
            if (!isEmailVerificationPage && pageText) {
                for (const text of emailTexts) {
                    if (pageText.toLowerCase().includes(text.toLowerCase())) {
                        isEmailVerificationPage = true;
                        detectedText = text;
                        break;
                    }
                }
            }

            if (isEmailVerificationPage) {
                this.bot.log(this.bot.isMobile, '页面检测', `[${email}] 检测到邮箱验证页面: ${detectedText}`);
                
                // 查找并点击"向 [辅助邮箱] 发送电子邮件"链接
                let emailLinkClicked = false;
                
                // 方法1：使用更精确的选择器查找并点击
                const emailLinkSelectors = [
                    // 精确匹配包含"向"和"发送电子邮件"的元素
                    'text*="向" >> text*="发送电子邮件"',
                    'text*="向" >> text*="send email"',
                    'text*="Send email to"',
                    'text*="Email to"',
                    // 查找包含"向"的元素
                    'text*="向"',
                    'text*="Send email to"',
                    'text*="Email to"'
                ];
                
                for (const selector of emailLinkSelectors) {
                    try {
                        const link = await page.locator(selector).first();
                        if (await link.isVisible({ timeout: 2000 }).catch(() => false)) {
                            const linkText = await link.textContent();
                            this.bot.log(this.bot.isMobile, '页面检测', `[${email}] 找到发送电子邮件链接: ${linkText}`);
                            
                            await link.scrollIntoViewIfNeeded();
                            await link.click({ timeout: 5000 });
                            this.bot.log(this.bot.isMobile, '页面检测', `[${email}] 已点击发送电子邮件链接: ${linkText}`);
                            emailLinkClicked = true;
                            break;
                        }
                    } catch (error) {
                        // 继续尝试下一个选择器
                    }
                }

                // 方法2：使用多种CSS选择器
                if (!emailLinkClicked) {
                    const cssSelectors = [
                        'button:has-text("向")',
                        'a:has-text("向")',
                        '[role="button"]:has-text("向")',
                        'span:has-text("向")',
                        'div:has-text("向")',
                        'button:has-text("Send email to")',
                        'a:has-text("Send email to")',
                        '[role="button"]:has-text("Send email to")',
                        // 查找包含"发送电子邮件"的元素
                        'button:has-text("发送电子邮件")',
                        'a:has-text("发送电子邮件")',
                        '[role="button"]:has-text("发送电子邮件")'
                    ];
                    
                    for (const selector of cssSelectors) {
                        try {
                            const element = await page.locator(selector);
                            if (await element.isVisible({ timeout: 2000 }).catch(() => false)) {
                                const elementText = await element.textContent();
                                this.bot.log(this.bot.isMobile, '页面检测', `[${email}] 找到发送电子邮件元素: ${selector} - ${elementText}`);
                                
                                await element.scrollIntoViewIfNeeded();
                                await element.click({ timeout: 5000 });
                                this.bot.log(this.bot.isMobile, '页面检测', `[${email}] 已点击发送电子邮件元素: ${elementText}`);
                                emailLinkClicked = true;
                                break;
                            }
                        } catch (error) {
                            continue;
                        }
                    }
                }

                // 方法3：使用改进的JavaScript查找并点击
                if (!emailLinkClicked) {
                    try {
                        this.bot.log(this.bot.isMobile, '页面检测', `[${email}] 尝试使用JavaScript点击发送电子邮件链接`);
                        
                        const jsResult = await page.evaluate(() => {
                            // 更精确的元素查找策略
                            const targetTexts = [
                                '向',
                                'Send email to',
                                'Email to',
                                '发送电子邮件',
                                'send email'
                            ];
                            
                            // 按优先级查找元素
                            const selectors = [
                                'button', 'a', '[role="button"]', 'span', 'div'
                            ];
                            
                            for (const selector of selectors) {
                                const elements = Array.from(document.querySelectorAll(selector));
                                for (const el of elements) {
                                    const htmlEl = el as HTMLElement;
                                    const text = htmlEl.textContent || '';
                                    
                                    // 检查是否包含目标文本且元素可见
                                    const hasTargetText = targetTexts.some(target => 
                                        text.toLowerCase().includes(target.toLowerCase())
                                    );
                                    
                                    if (hasTargetText &&
                                        htmlEl.offsetWidth > 0 && 
                                        htmlEl.offsetHeight > 0 &&
                                        htmlEl.style.display !== 'none' &&
                                        htmlEl.style.visibility !== 'hidden' &&
                                        htmlEl.style.opacity !== '0') {
                                        
                                        // 模拟真实的点击操作
                                        try {
                                            htmlEl.focus();
                                            htmlEl.click();
                                            return { 
                                                success: true, 
                                                element: htmlEl.tagName, 
                                                text: htmlEl.textContent?.trim(),
                                                method: 'click'
                                            };
                                        } catch (clickError) {
                                            // 如果直接点击失败，尝试触发事件
                                            try {
                                                const clickEvent = new MouseEvent('click', {
                                                    bubbles: true,
                                                    cancelable: true,
                                                    view: window
                                                });
                                                htmlEl.dispatchEvent(clickEvent);
                                                return { 
                                                    success: true, 
                                                    element: htmlEl.tagName, 
                                                    text: htmlEl.textContent?.trim(),
                                                    method: 'event'
                                                };
                                            } catch (eventError) {
                                                continue;
                                            }
                                        }
                                    }
                                }
                            }
                            return { success: false, reason: 'No suitable elements found' };
                        });
                        
                        if (jsResult.success) {
                            emailLinkClicked = true;
                            this.bot.log(this.bot.isMobile, '页面检测', `[${email}] JavaScript点击发送电子邮件链接成功: ${jsResult.element} - ${jsResult.text} (方法: ${jsResult.method})`);
                        } else {
                            this.bot.log(this.bot.isMobile, '页面检测', `[${email}] JavaScript点击发送电子邮件链接失败: ${jsResult.reason}`, 'warn');
                        }
                    } catch (error) {
                        this.bot.log(this.bot.isMobile, '页面检测', `[${email}] JavaScript点击发送电子邮件链接异常: ${error}`, 'warn');
                    }
                }
                
                if (emailLinkClicked) {
                    // 等待页面跳转
                    await this.bot.utils.wait(3000);
                    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
                    
                    return {
                        detected: true,
                        pageType: 'email_verification',
                        action: 'email_sent',
                        message: '已点击发送电子邮件到辅助邮箱链接'
                    };
                } else {
                    return {
                        detected: true,
                        pageType: 'email_verification',
                        action: 'manual_required',
                        message: '检测到邮箱验证页面但无法自动点击发送电子邮件链接，需要手动处理'
                    };
                }
            }

            return { detected: false, pageType: 'email_verification' };
        } catch (error) {
            this.bot.log(this.bot.isMobile, '页面检测', `[${email}] 邮箱验证页面检测出错: ${error}`, 'error');
            return { detected: false, pageType: 'email_verification', message: `检测出错: ${error}` };
        }
    }

    /**
     * 检测登录保持页面
     */
    private async detectStaySignedInPage(page: Page, email: string): Promise<PageExceptionResult> {
        try {
            const staySignedInTexts = [
                '保持登录状态',
                'Stay signed in',
                '是否保持登录',
                'Do this to reduce the number of times'
            ];

            for (const text of staySignedInTexts) {
                const element = await page.locator(`text*="${text}"`).first();
                if (await element.isVisible({ timeout: 2000 }).catch(() => false)) {
                    this.bot.log(this.bot.isMobile, '页面检测', `[${email}] 检测到登录保持页面: ${text}`);
                    
                    // 尝试点击"是"或"Yes"
                    const yesButton = await page.locator('text="是"').or(page.locator('text="Yes"')).or(page.locator('input[value="Yes"]')).first();
                    if (await yesButton.isVisible({ timeout: 3000 }).catch(() => false)) {
                        await yesButton.click();
                        this.bot.log(this.bot.isMobile, '页面检测', `[${email}] 已点击"是"按钮保持登录状态`);
                        
                        // 等待页面跳转
                        await this.bot.utils.wait(3000);
                        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
                        
                        return {
                            detected: true,
                            pageType: 'stay_signed_in',
                            action: 'yes_clicked',
                            message: '已点击是按钮保持登录状态'
                        };
                    }
                }
            }

            return { detected: false, pageType: 'stay_signed_in' };
        } catch (error) {
            this.bot.log(this.bot.isMobile, '页面检测', `[${email}] 登录保持页面检测出错: ${error}`, 'error');
            return { detected: false, pageType: 'stay_signed_in', message: `检测出错: ${error}` };
        }
    }

    /**
     * 检测Cookie同意页面
     */
    private async detectCookieConsentPage(page: Page, email: string): Promise<PageExceptionResult> {
        try {
            const cookieTexts = [
                '接受',
                'Accept',
                '同意',
                'Agree',
                'Accept all',
                '接受全部'
            ];

            for (const text of cookieTexts) {
                const element = await page.locator(`button:has-text("${text}")`).first();
                if (await element.isVisible({ timeout: 2000 }).catch(() => false)) {
                    // 确保这是Cookie相关的按钮
                    const pageContent = await page.content();
                    if (pageContent.toLowerCase().includes('cookie') || pageContent.toLowerCase().includes('隐私')) {
                        this.bot.log(this.bot.isMobile, '页面检测', `[${email}] 检测到Cookie同意页面`);
                        
                        await element.click();
                        this.bot.log(this.bot.isMobile, '页面检测', `[${email}] 已点击Cookie同意按钮`);
                        
                        // 等待页面跳转
                        await this.bot.utils.wait(2000);
                        
                        return {
                            detected: true,
                            pageType: 'cookie_consent',
                            action: 'accept_clicked',
                            message: '已点击Cookie同意按钮'
                        };
                    }
                }
            }

            return { detected: false, pageType: 'cookie_consent' };
        } catch (error) {
            this.bot.log(this.bot.isMobile, '页面检测', `[${email}] Cookie同意页面检测出错: ${error}`, 'error');
            return { detected: false, pageType: 'cookie_consent', message: `检测出错: ${error}` };
        }
    }

    /**
     * 检测账户锁定页面
     */
    private async detectAccountLockPage(page: Page, email: string): Promise<PageExceptionResult> {
        try {
            const lockTexts = [
                '账户已锁定',
                'Account locked',
                '账户被锁定',
                'Your account has been locked',
                '暂时无法访问你的账户',
                'temporarily unable to access your account'
            ];

            for (const text of lockTexts) {
                const element = await page.locator(`text*="${text}"`).first();
                if (await element.isVisible({ timeout: 2000 }).catch(() => false)) {
                    this.bot.log(this.bot.isMobile, '页面检测', `[${email}] 检测到账户锁定页面: ${text}`, 'error');
                    
                    return {
                        detected: true,
                        pageType: 'account_locked',
                        action: 'manual_required',
                        message: '账户已锁定，需要手动处理'
                    };
                }
            }

            return { detected: false, pageType: 'account_locked' };
        } catch (error) {
            this.bot.log(this.bot.isMobile, '页面检测', `[${email}] 账户锁定页面检测出错: ${error}`, 'error');
            return { detected: false, pageType: 'account_locked', message: `检测出错: ${error}` };
        }
    }

    /**
     * 检测两步验证页面
     */
    private async detectTwoFactorPage(page: Page, email: string): Promise<PageExceptionResult> {
        try {
            const twoFactorTexts = [
                '输入代码',
                'Enter code',
                '验证码',
                'verification code',
                '我们向你发送了代码',
                'We sent a code to'
            ];

            for (const text of twoFactorTexts) {
                const element = await page.locator(`text*="${text}"`).first();
                if (await element.isVisible({ timeout: 2000 }).catch(() => false)) {
                    this.bot.log(this.bot.isMobile, '页面检测', `[${email}] 检测到两步验证页面: ${text}`);
                    
                    return {
                        detected: true,
                        pageType: 'two_factor',
                        action: 'manual_required',
                        message: '需要输入验证码，需要手动处理'
                    };
                }
            }

            return { detected: false, pageType: 'two_factor' };
        } catch (error) {
            this.bot.log(this.bot.isMobile, '页面检测', `[${email}] 两步验证页面检测出错: ${error}`, 'error');
            return { detected: false, pageType: 'two_factor', message: `检测出错: ${error}` };
        }
    }

    /**
     * 检测身份验证页面（即将完成）
     */
    private async detectVerificationPage(page: Page, email: string): Promise<PageExceptionResult> {
        try {
            // 检测两种类型的身份验证页面
            
            // 类型1：即将完成页面
            const titleTexts1 = [
                '即将完成',
                'Almost done',
                'Almost finished',
                'Almost completed'
            ];
            
            const subtitleTexts1 = [
                '只需再执行一步即可验证你的身份',
                'Just one more step to verify your identity',
                'One more step to verify your identity'
            ];

            // 类型2：验证你的身份页面
            const titleTexts2 = [
                '验证你的身份',
                'Verify your identity',
                'Verify your account',
                'Verify your email'
            ];

            let isVerificationPage = false;
            let pageType = '';
            let foundTitle = '';

            // 检查类型1：即将完成页面
            let title1Found = false;
            let subtitle1Found = false;
            
            for (const text of titleTexts1) {
                const element = await page.locator(`text*="${text}"`).first();
                if (await element.isVisible({ timeout: 2000 }).catch(() => false)) {
                    title1Found = true;
                    foundTitle = text;
                    break;
                }
            }
            
            if (title1Found) {
                for (const text of subtitleTexts1) {
                    const element = await page.locator(`text*="${text}"`).first();
                    if (await element.isVisible({ timeout: 2000 }).catch(() => false)) {
                        subtitle1Found = true;
                        break;
                    }
                }
                
                if (subtitle1Found) {
                    isVerificationPage = true;
                    pageType = 'almost_done';
                }
            }

            // 检查类型2：验证你的身份页面
            if (!isVerificationPage) {
                for (const text of titleTexts2) {
                    const element = await page.locator(`text*="${text}"`).first();
                    if (await element.isVisible({ timeout: 2000 }).catch(() => false)) {
                        isVerificationPage = true;
                        pageType = 'verify_identity';
                        foundTitle = text;
                        break;
                    }
                }
            }

            if (isVerificationPage) {
                this.bot.log(this.bot.isMobile, '页面检测', `[${email}] 检测到身份验证页面: ${foundTitle} (类型: ${pageType})`);
                
                if (pageType === 'almost_done') {
                    // 处理"即将完成"页面
                    return await this.handleAlmostDonePage(page, email);
                } else if (pageType === 'verify_identity') {
                    // 处理"验证你的身份"页面
                    return await this.handleVerifyIdentityPage(page, email);
                }
            }

            return { detected: false, pageType: 'verification' };
        } catch (error) {
            this.bot.log(this.bot.isMobile, '页面检测', `[${email}] 身份验证页面检测出错: ${error}`, 'error');
            return { detected: false, pageType: 'verification', message: `检测出错: ${error}` };
        }
    }

    /**
     * 处理"即将完成"页面
     */
    private async handleAlmostDonePage(page: Page, email: string): Promise<PageExceptionResult> {
        // 根据设备类型点击相应的链接
        if (this.bot.isMobile) {
            // 移动端：点击包含"发送电子邮件"的链接
            const mobileLinkTexts = [
                '发送电子邮件',
                'Send email',
                'Email me',
                'Send me an email'
            ];
            
            let mobileLinkClicked = false;
            for (const text of mobileLinkTexts) {
                try {
                    const link = await page.locator(`text*="${text}"`).first();
                    if (await link.isVisible({ timeout: 2000 }).catch(() => false)) {
                        await link.click();
                        this.bot.log(this.bot.isMobile, '页面检测', `[${email}] 移动端已点击: ${text}`);
                        mobileLinkClicked = true;
                        break;
                    }
                } catch (error) {
                    // 继续尝试下一个文本
                }
            }
            
            if (mobileLinkClicked) {
                return {
                    detected: true,
                    pageType: 'verification',
                    action: 'email_sent',
                    message: '移动端已点击发送电子邮件链接'
                };
            } else {
                return {
                    detected: true,
                    pageType: 'verification',
                    action: 'manual_required',
                    message: '移动端未找到发送电子邮件链接，需要手动处理'
                };
            }
        } else {
            // 桌面端：点击包含"将代码发送"的链接
            const desktopLinkTexts = [
                '将代码发送',
                'Send code to',
                'Send the code to',
                'Send verification code to'
            ];
            
            let desktopLinkClicked = false;
            for (const text of desktopLinkTexts) {
                try {
                    const link = await page.locator(`text*="${text}"`).first();
                    if (await link.isVisible({ timeout: 2000 }).catch(() => false)) {
                        await link.click();
                        this.bot.log(this.bot.isMobile, '页面检测', `[${email}] 桌面端已点击: ${text}`);
                        desktopLinkClicked = true;
                        break;
                    }
                } catch (error) {
                    // 继续尝试下一个文本
                }
            }
            
            if (desktopLinkClicked) {
                return {
                    detected: true,
                    pageType: 'verification',
                    action: 'code_sent',
                    message: '桌面端已点击将代码发送链接'
                };
            } else {
                return {
                    detected: true,
                    pageType: 'verification',
                    action: 'manual_required',
                    message: '桌面端未找到将代码发送链接，需要手动处理'
                };
            }
        }
    }

    /**
     * 处理"验证你的身份"页面
     */
    private async handleVerifyIdentityPage(page: Page, email: string): Promise<PageExceptionResult> {
        // 查找并点击"向 [辅助邮箱] 发送电子邮件"链接
        const emailLinkTexts = [
            '向',
            'Send email to',
            'Email to',
            'Send verification email to',
            '发送电子邮件',
            'send email'
        ];
        
        let emailLinkClicked = false;
        
        // 方法1：使用Playwright选择器查找
        for (const text of emailLinkTexts) {
            try {
                // 查找包含"向"或类似文本的链接
                const link = await page.locator(`text*="${text}"`).first();
                if (await link.isVisible({ timeout: 2000 }).catch(() => false)) {
                    await link.click();
                    this.bot.log(this.bot.isMobile, '页面检测', `[${email}] 已点击发送电子邮件链接: ${text}`);
                    emailLinkClicked = true;
                    break;
                }
            } catch (error) {
                // 继续尝试下一个文本
            }
        }
        
        // 方法2：如果方法1失败，尝试使用更宽松的选择器
        if (!emailLinkClicked) {
            try {
                const selectors = [
                    'button:has-text("向")',
                    'a:has-text("向")',
                    '[role="button"]:has-text("向")',
                    'button:has-text("发送电子邮件")',
                    'a:has-text("发送电子邮件")',
                    '[role="button"]:has-text("发送电子邮件")',
                    'button:has-text("Send email")',
                    'a:has-text("Send email")',
                    '[role="button"]:has-text("Send email")'
                ];
                
                for (const selector of selectors) {
                    try {
                        const element = await page.locator(selector).first();
                        if (await element.isVisible({ timeout: 2000 }).catch(() => false)) {
                            await element.click();
                            // 移除使用选择器成功点击的日志，减少非关键信息输出
                            emailLinkClicked = true;
                            break;
                        }
                    } catch (error) {
                        // 继续尝试下一个选择器
                    }
                }
            } catch (error) {
                // 移除选择器方法失败的日志，减少非关键信息输出
            }
        }
        
        // 方法3：如果前两种方法都失败，使用JavaScript点击
        if (!emailLinkClicked) {
            try {
                const jsResult = await page.evaluate(() => {
                    const targetTexts = ['向', 'Send email to', 'Email to', '发送电子邮件', 'send email'];
                    const selectors = ['button', 'a', '[role="button"]', 'span', 'div'];
                    
                    for (const selector of selectors) {
                        const elements = Array.from(document.querySelectorAll(selector));
                        for (const el of elements) {
                            const htmlEl = el as HTMLElement;
                            const text = htmlEl.textContent || '';
                            const hasTargetText = targetTexts.some(target => 
                                text.toLowerCase().includes(target.toLowerCase())
                            );
                            
                            if (hasTargetText && 
                                htmlEl.offsetWidth > 0 && 
                                htmlEl.offsetHeight > 0 && 
                                htmlEl.style.display !== 'none' && 
                                htmlEl.style.visibility !== 'hidden' && 
                                htmlEl.style.opacity !== '0') {
                                
                                try {
                                    htmlEl.focus();
                                    htmlEl.click();
                                    return { success: true, method: 'click', text: text.substring(0, 50) };
                                } catch (clickError) {
                                    // 如果直接点击失败，尝试事件分发
                                    try {
                                        const clickEvent = new MouseEvent('click', {
                                            bubbles: true,
                                            cancelable: true,
                                            view: window
                                        });
                                        htmlEl.dispatchEvent(clickEvent);
                                        return { success: true, method: 'event', text: text.substring(0, 50) };
                                    } catch (eventError) {
                                        // 继续尝试下一个元素
                                    }
                                }
                            }
                        }
                    }
                    return { success: false, reason: 'No suitable elements found' };
                });
                
                if (jsResult.success) {
                    this.bot.log(this.bot.isMobile, '页面检测', `[${email}] JavaScript点击成功: ${jsResult.method}, 文本: ${jsResult.text}`);
                    emailLinkClicked = true;
                } else {
                    this.bot.log(this.bot.isMobile, '页面检测', `[${email}] JavaScript点击失败: ${jsResult.reason}`, 'warn');
                }
            } catch (error) {
                this.bot.log(this.bot.isMobile, '页面检测', `[${email}] JavaScript点击出错: ${error}`, 'error');
            }
        }
        
        if (emailLinkClicked) {
            return {
                detected: true,
                pageType: 'verification',
                action: 'email_sent',
                message: '已点击发送电子邮件到辅助邮箱链接'
            };
        } else {
            return {
                detected: true,
                pageType: 'verification',
                action: 'manual_required',
                message: '未找到发送电子邮件链接，需要手动处理'
            };
        }
    }

    /**
     * 检测网络错误页面
     */
    private async detectNetworkErrorPage(page: Page, email: string): Promise<PageExceptionResult> {
        try {
            const errorTexts = [
                '无法访问此网站',
                'This site can\'t be reached',
                '网络连接错误',
                'Network connection error',
                '页面无法加载',
                'Page could not be loaded'
            ];

            for (const text of errorTexts) {
                const element = await page.locator(`text*="${text}"`).first();
                if (await element.isVisible({ timeout: 2000 }).catch(() => false)) {
                    this.bot.log(this.bot.isMobile, '页面检测', `[${email}] 检测到网络错误页面: ${text}`, 'error');
                    
                    return {
                        detected: true,
                        pageType: 'network_error',
                        action: 'retry_required',
                        message: '网络错误，建议重试'
                    };
                }
            }

            return { detected: false, pageType: 'network_error' };
        } catch (error) {
            this.bot.log(this.bot.isMobile, '页面检测', `[${email}] 网络错误页面检测出错: ${error}`, 'error');
            return { detected: false, pageType: 'network_error', message: `检测出错: ${error}` };
        }
    }

    /**
     * 辅助方法：判断页面内容是否包含验证相关文本
     */
    private isVerificationPage(pageText: string): boolean {
        const verificationTexts = [
            '即将完成',
            'Almost done',
            'Almost finished',
            'Almost completed',
            '验证你的身份',
            'Verify your identity',
            'Verify your account',
            'Verify your email',
            '只需再执行一步即可验证你的身份',
            'Just one more step to verify your identity',
            'One more step to verify your identity'
        ];

        for (const text of verificationTexts) {
            if (pageText.toLowerCase().includes(text.toLowerCase())) {
                return true;
            }
        }
        return false;
    }
}
