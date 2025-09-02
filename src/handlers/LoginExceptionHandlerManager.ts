import { Page } from 'rebrowser-playwright';
import { MicrosoftRewardsBot } from '../index';
import { LoginExceptionHandler } from './LoginExceptionHandler';

export class LoginExceptionHandlerManager {
    private bot: MicrosoftRewardsBot;
    private loginHandler: LoginExceptionHandler | null = null;

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot;
    }

    /**
     * 处理登录异常的统一入口
     * @param exceptionType 异常类型
     * @param page 页面对象
     * @param email 邮箱
     * @returns 处理结果
     */
    async handleLoginException(exceptionType: string, page: Page, email: string): Promise<boolean> {
        try {
            // 延迟初始化，避免循环依赖
            if (!this.loginHandler) {
                this.loginHandler = new LoginExceptionHandler(this.bot);
                await this.loginHandler.initialize();
            }

            switch (exceptionType) {
                case 'biometricPage':
                    return await this.loginHandler.handleBiometricPage(page, email);
                case 'cookiesConsent':
                    await this.loginHandler.handleCookiesConsent(page, email);
                    return true; // 假设成功处理
                case 'verificationPage':
                    await this.loginHandler.handleVerificationPage(page, email);
                    return true; // 假设成功处理
                default:
                    this.bot.log(this.bot.isMobile, '异常处理', `[${email}] 未知的异常类型: ${exceptionType}`, 'warn');
                    return false;
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '异常处理', `[${email}] 处理登录异常时出错: ${errorMessage}`, 'error');
            return false;
        }
    }

    /**
     * 清理资源
     */
    async cleanup(): Promise<void> {
        if (this.loginHandler) {
            await this.loginHandler.cleanup();
            this.loginHandler = null;
        }
    }
}
