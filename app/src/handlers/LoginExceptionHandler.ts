import { Page } from 'rebrowser-playwright';
import { MicrosoftRewardsBot } from '../index';
import { ExceptionHandlerConfigManager } from '../config/ExceptionHandlerConfig';
import { ExceptionHandlerLogger } from '../utils/Logger';

import { ExceptionHandlerType } from './ExceptionHandlerFactory';

/**
 * 登录异常处理模块
 * 负责处理登录过程中的各种异常情况
 */
export class LoginExceptionHandler {
    public readonly type: ExceptionHandlerType = ExceptionHandlerType.LOGIN;
    private bot: MicrosoftRewardsBot;
    private configManager: ExceptionHandlerConfigManager;
    private logger: ExceptionHandlerLogger;

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot;
        this.configManager = ExceptionHandlerConfigManager.getInstance();
        this.logger = new ExceptionHandlerLogger();
        // monitor 可以在需要时获取，避免不必要的实例化
    }

    /**
     * 初始化处理器
     */
    public async initialize(): Promise<void> {
        this.logger.logLoginException('system', '初始化', 'LoginExceptionHandler 初始化完成');
    }

    /**
     * 清理资源
     */
    public async cleanup(): Promise<void> {
        this.logger.logLoginException('system', '清理', 'LoginExceptionHandler 清理完成');
    }

    /**
     * 处理cookies授权弹窗
     */
    async handleCookiesConsent(page: Page, email: string): Promise<void> {
        try {
            const config = this.configManager.getConfig();
            const cookiesConfig = config.login.cookiesConsent;
            
            this.logger.logLoginException(email, 'cookies授权弹窗', '开始检测cookies授权弹窗');
            
            // 等待页面完全加载
            await this.bot.utils.wait(3000);
            
            let cookiesAccepted = false;
            
            // 尝试使用配置的选择器
            for (const selector of cookiesConfig.selectors) {
                try {
                    const button = page.locator(selector);
                    if (await button.count() > 0 && await button.isVisible({ timeout: 2000 })) {
                        this.logger.logLoginException(email, 'cookies授权弹窗', `找到cookies授权按钮: ${selector}`);
                        
                        await button.scrollIntoViewIfNeeded();
                        await this.bot.utils.wait(500);
                        await button.click({ timeout: 5000 });
                        
                        this.logger.logLoginException(email, 'cookies授权弹窗', '已点击cookies授权按钮');
                        cookiesAccepted = true;
                        await this.bot.utils.wait(cookiesConfig.waitAfterClick);
                        break;
                    }
                } catch (error) {
                    continue;
                }
            }
            
            if (cookiesAccepted) {
                this.logger.logLoginException(email, 'cookies授权弹窗', 'cookies授权弹窗已处理');
            } else {
                this.logger.logWarning('登录异常处理', `[${email}] 未找到cookies授权弹窗`);
            }
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.logError('登录异常处理', `[${email}] 处理cookies授权弹窗时出错: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * 处理账户锁定异常
     */
    async handleAccountLocked(page: Page, email: string): Promise<void> {
        try {
            const config = this.configManager.getConfig();
            const lockedConfig = config.login.accountLocked;
            
            this.logger.logLoginException(email, '账户锁定检查', '检查账户锁定状态');
            
            for (const selector of lockedConfig.selectors) {
                try {
                    const lockedElement = page.locator(selector);
                    if (await lockedElement.count() > 0 && await lockedElement.isVisible({ timeout: lockedConfig.checkTimeout })) {
                        this.logger.logWarning('登录异常处理', `[${email}] 检测到账户锁定`);
                        throw new Error('账户已被锁定');
                    }
                } catch (error) {
                    continue;
                }
            }
            
            this.logger.logLoginException(email, '账户锁定检查', '账户状态正常');
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.logError('登录异常处理', `[${email}] 检查账户锁定状态时出错: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * 处理验证码页面异常
     */
    async handleVerificationPage(page: Page, email: string): Promise<void> {
        try {
            const config = this.configManager.getConfig();
            const verificationConfig = config.login.verification;
            
            this.logger.logLoginException(email, '验证码检查', '检查验证码页面');
            
            for (const selector of verificationConfig.selectors) {
                try {
                    const element = page.locator(selector);
                    if (await element.count() > 0 && await element.isVisible({ timeout: verificationConfig.checkTimeout })) {
                        this.logger.logWarning('登录异常处理', `[${email}] 检测到验证码页面`);
                        throw new Error('VERIFICATION_REQUIRED');
                    }
                } catch (error) {
                    continue;
                }
            }
            
            this.logger.logLoginException(email, '验证码检查', '无需验证码验证');
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (errorMessage === 'VERIFICATION_REQUIRED') {
                throw error;
            }
            this.logger.logWarning('登录异常处理', `[${email}] 检查验证码页面时出错: ${errorMessage}`);
        }
    }

    /**
     * 处理网络连接异常
     */
    async handleNetworkError(page: Page, email: string): Promise<void> {
        try {
            this.logger.logLoginException(email, '网络检查', '检查网络连接状态');
            
            // 检查网络错误提示
            const networkErrorSelectors = [
                'text=网络错误',
                'text=Network error',
                'text=连接失败',
                'text=Connection failed'
            ];
            
            for (const selector of networkErrorSelectors) {
                try {
                    const errorElement = page.locator(selector);
                    if (await errorElement.count() > 0 && await errorElement.isVisible({ timeout: 2000 })) {
                        this.logger.logWarning('登录异常处理', `[${email}] 检测到网络错误`);
                        throw new Error('网络连接异常');
                    }
                } catch (error) {
                    continue;
                }
            }
            
            this.logger.logLoginException(email, '网络检查', '网络连接正常');
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.logError('登录异常处理', `[${email}] 检查网络状态时出错: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * 处理生物识别页面异常
     */
    async handleBiometricPage(page: Page, email: string): Promise<boolean> {
        try {
            this.logger.logLoginException(email, '生物识别页面检查', '检查生物识别页面');
            
            // 检查是否是生物识别页面 - 更全面的检测
            const biometricSelectors = [
                'text=使用人脸、指纹或PIN',
                'text=使用人脸、指纹或PIN更快地登录',
                'text=Use face, fingerprint or PIN',
                'text=Use face, fingerprint or PIN to sign in faster',
                'h1:has-text("使用人脸、指纹或PIN")',
                'h1:has-text("Use face, fingerprint or PIN")',
                '[data-testid="title"]:has-text("使用人脸、指纹或PIN")',
                '[data-testid="title"]:has-text("Use face, fingerprint or PIN")'
            ];
            
            for (const selector of biometricSelectors) {
                if (await page.locator(selector).count() > 0) {
                    this.logger.logLoginException(email, '生物识别页面', '检测到生物识别页面，尝试点击"暂时跳过"');
                    
                    // 尝试多种"暂时跳过"按钮选择器
                    const skipButtonSelectors = [
                        'button:has-text("暂时跳过")',
                        'button:has-text("Skip for now")',
                        '[data-testid="secondaryButton"]:has-text("暂时跳过")',
                        '[data-testid="secondaryButton"]:has-text("Skip for now")',
                        'button[data-testid="secondaryButton"]'
                    ];
                    
                    for (const buttonSelector of skipButtonSelectors) {
                        if (await page.locator(buttonSelector).count() > 0) {
                            try {
                                await page.locator(buttonSelector).click();
                                await this.bot.utils.wait(3000);
                                this.logger.logLoginException(email, '生物识别页面', '成功点击"暂时跳过"按钮');
                                return true;
                            } catch (clickError) {
                                this.logger.logWarning('登录异常处理', `[${email}] 点击按钮失败: ${clickError}`);
                                continue;
                            }
                        }
                    }
                    
                    // 如果所有按钮都失败，尝试查找任何包含"跳过"或"skip"的按钮
                    const anySkipButton = page.locator('button').filter({ hasText: /跳过|skip/i });
                    if (await anySkipButton.count() > 0) {
                        await anySkipButton.first().click();
                        await this.bot.utils.wait(3000);
                        this.logger.logLoginException(email, '生物识别页面', '通过文本匹配找到并点击了跳过按钮');
                        return true;
                    }
                }
            }
            
            return false;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.logError('登录异常处理', `[${email}] 处理生物识别页面时出错: ${errorMessage}`);
            return false;
        }
    }

    /**
     * 处理登录超时异常
     */
    async handleLoginTimeout(page: Page, email: string, timeoutMs: number = 120000): Promise<void> {
        try {
            this.logger.logLoginException(email, '登录超时检查', `开始登录流程，超时时间: ${timeoutMs}ms`);
            
            const startTime = Date.now();
            
            // 检查是否超时
            if (Date.now() - startTime > timeoutMs) {
                this.logger.logWarning('登录异常处理', `[${email}] 登录流程超时`);
                throw new Error(`登录超时: ${email}`);
            }
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.logError('登录异常处理', `[${email}] 处理登录超时时出错: ${errorMessage}`);
            throw error;
        }
    }
}
