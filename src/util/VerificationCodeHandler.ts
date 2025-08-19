import { Page } from 'playwright';
import { log } from './Logger';

export interface VerificationCodeConfig {
    auxiliary_email?: string;
    max_retries?: number;
    retry_interval?: number;
    timeout?: number;
}

export class VerificationCodeHandler {
    private config: VerificationCodeConfig;

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
     * @returns 是否成功处理验证码
     */
    async handleAuxiliaryEmailVerification(page: Page, accountEmail: string): Promise<boolean> {
        if (!this.config.auxiliary_email) {
            log('main', '验证码处理', `账户 ${accountEmail} 未配置辅助邮箱，跳过验证码处理`);
            return false;
        }

        try {
            log('main', '验证码处理', `开始处理账户 ${accountEmail} 的辅助邮箱验证码`);

            // 等待验证码输入页面加载
            await this.waitForVerificationPage(page);

            // 检查是否需要发送验证码
            if (await this.needsToSendCode(page)) {
                await this.sendVerificationCode(page);
            }

            // 等待并获取验证码
            const verificationCode = await this.waitForVerificationCode();
            if (!verificationCode) {
                log('main', '验证码处理', `未能获取到验证码，验证失败`);
                return false;
            }

            // 填入验证码
            await this.enterVerificationCode(page, verificationCode);

            // 等待验证结果
            const success = await this.waitForVerificationResult(page);
            if (success) {
                log('main', '验证码处理', `账户 ${accountEmail} 验证码验证成功`);
                return true;
            } else {
                log('main', '验证码处理', `账户 ${accountEmail} 验证码验证失败`);
                return false;
            }

        } catch (error) {
            log('main', '验证码处理', `处理验证码时出错: ${error}`, 'error');
            return false;
        }
    }

    /**
     * 等待验证码页面加载
     */
    private async waitForVerificationPage(page: Page): Promise<void> {
        try {
            // 首先检查是否在身份验证选择页面
            const isIdentityVerificationPage = await this.isIdentityVerificationPage(page);
            if (isIdentityVerificationPage) {
                log('main', '验证码处理', '检测到身份验证选择页面，准备发送验证码');
                await this.handleIdentityVerificationPage(page);
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
    private async handleIdentityVerificationPage(page: Page): Promise<void> {
        try {
            log('main', '验证码处理', '正在处理身份验证选择页面');

            // 查找并点击"发送电子邮件"选项
            const emailOption = await this.findEmailVerificationOption(page);
            if (emailOption) {
                await emailOption.click();
                log('main', '验证码处理', '已点击发送电子邮件选项');
                
                // 等待页面跳转到辅助邮箱输入页面
                await page.waitForTimeout(3000);
                
                // 检查是否跳转到辅助邮箱输入页面
                const isAuxiliaryEmailPage = await this.isAuxiliaryEmailInputPage(page);
                if (isAuxiliaryEmailPage) {
                    log('main', '验证码处理', '已跳转到辅助邮箱输入页面');
                    await this.handleAuxiliaryEmailInputPage(page);
                } else {
                    log('main', '验证码处理', '未跳转到辅助邮箱输入页面，尝试其他方法', 'warn');
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
                log('main', '验证码处理', '找到方法1的发送电子邮件选项');
                return emailOption;
            }

            // 方法2：查找包含邮箱地址的元素（更宽松的匹配）
            const emailWithAddress = await page.$('text=/向.*@.*发送电子邮件/, text=/Send email to.*@.*/');
            if (emailWithAddress) {
                log('main', '验证码处理', '找到方法2的发送电子邮件选项');
                return emailWithAddress;
            }

            // 方法3：查找包含"@qq.com"等邮箱域名的元素
            const emailDomainOption = await page.$('text=/@qq\.com/, text=/@gmail\.com/, text=/@outlook\.com/, text=/@163\.com/');
            if (emailDomainOption) {
                log('main', '验证码处理', '找到方法3的邮箱域名选项');
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
     * 检查是否在辅助邮箱输入页面
     */
    private async isAuxiliaryEmailInputPage(page: Page): Promise<boolean> {
        try {
            // 检查页面是否包含邮箱输入框
            const emailInput = await page.$('input[type="email"], input[name="email"]');
            return !!emailInput;
        } catch {
            return false;
        }
    }

    /**
     * 处理辅助邮箱输入页面
     */
    private async handleAuxiliaryEmailInputPage(page: Page): Promise<void> {
        try {
            log('main', '验证码处理', '正在处理辅助邮箱输入页面');

            // 查找邮箱输入框
            const emailInput = await page.$('input[type="email"], input[name="email"]');
            if (!emailInput) {
                throw new Error('未找到邮箱输入框');
            }

            // 填入辅助邮箱
            await emailInput.fill(this.config.auxiliary_email!);
            log('main', '验证码处理', `已填入辅助邮箱: ${this.config.auxiliary_email}`);

            // 查找并点击发送按钮
            const sendButton = await page.$('button[type="submit"], button:has-text("发送"), button:has-text("Send")');
            if (sendButton) {
                await sendButton.click();
                log('main', '验证码处理', '已点击发送按钮');
                
                // 等待发送确认
                await page.waitForTimeout(3000);
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
            // 检查是否有发送验证码的按钮
            const sendButton = await page.$('button[data-testid*="send"], button:has-text("发送"), button:has-text("Send")');
            return !!sendButton;
        } catch {
            return false;
        }
    }

    /**
     * 发送验证码
     */
    private async sendVerificationCode(page: Page): Promise<void> {
        try {
            // 点击发送验证码按钮
            await page.click('button[data-testid*="send"], button:has-text("发送"), button:has-text("Send")');
            log('main', '验证码处理', '已发送验证码到辅助邮箱');
            
            // 等待发送确认
            await page.waitForTimeout(2000);
        } catch (error) {
            log('main', '验证码处理', `发送验证码失败: ${error}`, 'error');
            throw error;
        }
    }

    /**
     * 等待并获取验证码
     */
    private async waitForVerificationCode(): Promise<string | null> {
        const startTime = Date.now();
        const maxWaitTime = this.config.timeout!;

        while (Date.now() - startTime < maxWaitTime) {
            try {
                // 这里需要实现从辅助邮箱获取验证码的逻辑
                // 由于不同邮箱服务商的API不同，这里提供一个框架
                const code = await this.getCodeFromAuxiliaryEmail();
                if (code) {
                    log('main', '验证码处理', `成功获取验证码: ${code}`);
                    return code;
                }
            } catch (error) {
                log('main', '验证码处理', `获取验证码失败: ${error}`, 'warn');
            }

            // 等待一段时间后重试
            await new Promise(resolve => setTimeout(resolve, this.config.retry_interval!));
        }

        log('main', '验证码处理', '等待验证码超时');
        return null;
    }

    /**
     * 从辅助邮箱获取验证码
     * 这个方法需要根据具体的邮箱服务商来实现
     */
    private async getCodeFromAuxiliaryEmail(): Promise<string | null> {
        // TODO: 实现从辅助邮箱获取验证码的逻辑
        // 这里需要根据不同的邮箱服务商来实现：
        // 1. Gmail API
        // 2. Outlook/Hotmail API
        // 3. QQ邮箱 API
        // 4. 163邮箱 API
        // 等等

        // 临时返回null，等待具体实现
        return null;
    }

    /**
     * 填入验证码
     */
    private async enterVerificationCode(page: Page, code: string): Promise<void> {
        try {
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
            
        } catch (error) {
            log('main', '验证码处理', `填入验证码失败: ${error}`, 'error');
            throw error;
        }
    }

    /**
     * 等待验证结果
     */
    private async waitForVerificationResult(page: Page): Promise<boolean> {
        try {
            // 等待页面跳转或显示成功信息
            await page.waitForTimeout(5000);

            // 检查是否验证成功（页面URL变化或显示成功信息）
            const currentUrl = page.url();
            if (currentUrl.includes('rewards.bing.com') || currentUrl.includes('account.microsoft.com')) {
                return true;
            }

            // 检查是否有错误信息
            const errorElement = await page.$('[data-testid*="error"], .error, .alert-error');
            if (errorElement) {
                const errorText = await errorElement.textContent();
                log('main', '验证码处理', `验证失败: ${errorText}`, 'error');
                return false;
            }

            return true;
        } catch (error) {
            log('main', '验证码处理', `等待验证结果时出错: ${error}`, 'error');
            return false;
        }
    }
}
