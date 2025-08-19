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
