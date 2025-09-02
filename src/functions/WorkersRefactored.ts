import { Page } from 'rebrowser-playwright'
import { MicrosoftRewardsBot } from '../index'
import { TaskExceptionHandler } from '../handlers/TaskExceptionHandler'

export class WorkersRefactored {
    private bot: MicrosoftRewardsBot
    private exceptionHandler: TaskExceptionHandler

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot
        this.exceptionHandler = new TaskExceptionHandler(bot)
    }

    async smartActivityClick(page: Page, activityElement: any, activityTitle: string): Promise<boolean> {
        try {
            this.bot.log(this.bot.isMobile, '智能点击', `开始执行活动: ${activityTitle}`);
            
            await this.exceptionHandler.handlePageLoadError(page, activityTitle);
            
            const href = await activityElement.getAttribute('href');
            if (!href) {
                this.bot.log(this.bot.isMobile, '智能点击', `活动 "${activityTitle}" 没有找到链接`, 'warn');
                return false;
            }
            
            const newPage = await this.openActivityInNewTab(page, href, activityTitle);
            if (!newPage) return false;
            
            try {
                const isLoggedIn = await this.checkLoginStatusInNewTab(newPage, activityTitle);
                if (!isLoggedIn) {
                    await this.reAuthenticateInNewTab(newPage, activityTitle);
                }
                
                const result = await this.executeActivityByType(newPage, activityTitle);
                
                const successIndicators = ['text=任务完成', 'text=Task completed'];
                const isCompleted = await this.exceptionHandler.handleTaskCompletionCheck(newPage, activityTitle, successIndicators);
                
                if (isCompleted) {
                    this.bot.log(this.bot.isMobile, '智能点击', `活动 "${activityTitle}" 执行成功`);
                }
                
                return result;
                
            } finally {
                await newPage.close();
            }
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '智能点击', `执行活动 "${activityTitle}" 时出错: ${errorMessage}`, 'error');
            return false;
        }
    }

    private async openActivityInNewTab(page: Page, href: string, activityTitle: string): Promise<Page | null> {
        try {
            await page.click(`a[href="${href}"]`);
            await this.bot.utils.wait(3000);
            
            const pages = page.context().pages();
            const newPage = pages[pages.length - 1];
            
            if (!newPage || newPage === page) return null;
            
            await newPage.waitForLoadState('networkidle', { timeout: 10000 });
            return newPage;
            
        } catch (error) {
            return null;
        }
    }

    private async checkLoginStatusInNewTab(page: Page, activityTitle: string): Promise<boolean> {
        try {
            await this.exceptionHandler.handlePageLoadError(page, activityTitle);
            return await this.checkLoginStatus(page);
        } catch (error) {
            return false;
        }
    }

    private async reAuthenticateInNewTab(page: Page, activityTitle: string): Promise<void> {
        try {
            await page.goto('https://rewards.bing.com', { waitUntil: 'networkidle' });
            await this.bot.utils.wait(3000);
        } catch (error) {
            // 忽略错误
        }
    }

    private async checkLoginStatus(page: Page): Promise<boolean> {
        try {
            const loginButton = page.locator('a[href*="login"], button:has-text("登录")');
            if (await loginButton.count() > 0 && await loginButton.isVisible({ timeout: 2000 })) {
                return false;
            }
            return true;
        } catch (error) {
            return false;
        }
    }

    private async executeActivityByType(page: Page, activityTitle: string): Promise<boolean> {
        try {
            await this.exceptionHandler.handlePageLoadError(page, activityTitle);
            await this.bot.utils.wait(5000);
            return true;
        } catch (error) {
            return false;
        }
    }
}
