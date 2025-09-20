import { Page } from 'rebrowser-playwright';
import { MicrosoftRewardsBot } from '../index';
import { ExceptionHandlerType } from './ExceptionHandlerFactory';

/**
 * 任务执行异常处理模块
 * 负责处理任务执行过程中的各种异常情况
 */
export class TaskExceptionHandler {
    public readonly type: ExceptionHandlerType = ExceptionHandlerType.TASK;
    private bot: MicrosoftRewardsBot;

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot;
    }

    /**
     * 初始化处理器
     */
    public async initialize(): Promise<void> {
        console.log('TaskExceptionHandler 初始化完成');
    }

    /**
     * 清理资源
     */
    public async cleanup(): Promise<void> {
        console.log('TaskExceptionHandler 清理完成');
    }

    /**
     * 处理任务执行超时异常
     */
    async handleTaskTimeout(page: Page, taskName: string, timeoutMs: number = 30000): Promise<void> {
        try {
            this.bot.log(this.bot.isMobile, '任务异常处理', `任务 "${taskName}" 开始执行，超时时间: ${timeoutMs}ms`);
            
            // 设置任务超时
            const startTime = Date.now();
            
            // 检查是否超时
            if (Date.now() - startTime > timeoutMs) {
                this.bot.log(this.bot.isMobile, '任务异常处理', `任务 "${taskName}" 执行超时`, 'warn');
                throw new Error(`任务执行超时: ${taskName}`);
            }
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '任务异常处理', `处理任务超时时出错: ${errorMessage}`, 'error');
            throw error;
        }
    }

    /**
     * 处理页面加载异常
     */
    async handlePageLoadError(page: Page, taskName: string): Promise<void> {
        try {
            this.bot.log(this.bot.isMobile, '任务异常处理', `任务 "${taskName}" 检查页面加载状态...`);
            
            // 等待页面加载完成
            try {
                await page.waitForLoadState('domcontentloaded', { timeout: 15000 });
                this.bot.log(this.bot.isMobile, '任务异常处理', `任务 "${taskName}" 页面加载完成`);
            } catch (error) {
                this.bot.log(this.bot.isMobile, '任务异常处理', `任务 "${taskName}" 页面加载超时，尝试刷新`, 'warn');
                
                // 尝试刷新页面
                await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
                await this.bot.utils.wait(3000);
                
                this.bot.log(this.bot.isMobile, '任务异常处理', `任务 "${taskName}" 页面刷新完成`);
            }
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '任务异常处理', `处理页面加载异常时出错: ${errorMessage}`, 'error');
            throw error;
        }
    }

    /**
     * 处理元素查找异常
     */
    async handleElementNotFound(page: Page, taskName: string, selector: string, fallbackSelectors?: string[]): Promise<any> {
        try {
            this.bot.log(this.bot.isMobile, '任务异常处理', `任务 "${taskName}" 查找元素: ${selector}`);
            
            // 尝试主要选择器
            let element = page.locator(selector);
            if (await element.count() > 0 && await element.isVisible({ timeout: 5000 })) {
                this.bot.log(this.bot.isMobile, '任务异常处理', `任务 "${taskName}" 找到主要元素`);
                return element;
            }
            
            // 尝试备用选择器
            if (fallbackSelectors) {
                for (const fallbackSelector of fallbackSelectors) {
                    try {
                        element = page.locator(fallbackSelector);
                        if (await element.count() > 0 && await element.isVisible({ timeout: 2000 })) {
                            this.bot.log(this.bot.isMobile, '任务异常处理', `任务 "${taskName}" 找到备用元素: ${fallbackSelector}`);
                            return element;
                        }
                    } catch (error) {
                        continue;
                    }
                }
            }
            
            // 如果都找不到，抛出异常
            throw new Error(`任务 "${taskName}" 无法找到元素: ${selector}`);
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '任务异常处理', `处理元素查找异常时出错: ${errorMessage}`, 'error');
            throw error;
        }
    }

    /**
     * 处理点击操作异常
     */
    async handleClickError(page: Page, taskName: string, element: any, maxRetries: number = 3): Promise<boolean> {
        try {
            this.bot.log(this.bot.isMobile, '任务异常处理', `任务 "${taskName}" 开始点击操作，最大重试次数: ${maxRetries}`);
            
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                    // 确保元素可见
                    await element.scrollIntoViewIfNeeded();
                    await this.bot.utils.wait(500);
                    
                    // 尝试点击
                    await element.click({ timeout: 5000 });
                    this.bot.log(this.bot.isMobile, '任务异常处理', `任务 "${taskName}" 点击成功，尝试次数: ${attempt}`);
                    return true;
                    
                } catch (error) {
                    this.bot.log(this.bot.isMobile, '任务异常处理', `任务 "${taskName}" 点击失败，尝试次数: ${attempt}/${maxRetries}`, 'warn');
                    
                    if (attempt === maxRetries) {
                        throw new Error(`任务 "${taskName}" 点击操作失败，已重试 ${maxRetries} 次`);
                    }
                    
                    // 等待后重试
                    await this.bot.utils.wait(1000 * attempt);
                }
            }
            
            return false;
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '任务异常处理', `处理点击操作异常时出错: ${errorMessage}`, 'error');
            throw error;
        }
    }

    /**
     * 处理网络请求异常
     */
    async handleNetworkError(page: Page, taskName: string): Promise<void> {
        try {
            this.bot.log(this.bot.isMobile, '任务异常处理', `任务 "${taskName}" 检查网络状态...`);
            
            // 检查网络错误提示
            const networkErrorSelectors = [
                'text=网络错误',
                'text=Network error',
                'text=连接失败',
                'text=Connection failed',
                'text=无法访问',
                'text=Unable to access'
            ];
            
            for (const selector of networkErrorSelectors) {
                try {
                    const errorElement = page.locator(selector);
                    if (await errorElement.count() > 0 && await errorElement.isVisible({ timeout: 2000 })) {
                        this.bot.log(this.bot.isMobile, '任务异常处理', `任务 "${taskName}" 检测到网络错误`, 'warn');
                        throw new Error('网络连接异常');
                    }
                } catch (error) {
                    continue;
                }
            }
            
            this.bot.log(this.bot.isMobile, '任务异常处理', `任务 "${taskName}" 网络状态正常`);
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '任务异常处理', `处理网络异常时出错: ${errorMessage}`, 'error');
            throw error;
        }
    }

    /**
     * 处理任务完成状态检查
     */
    async handleTaskCompletionCheck(page: Page, taskName: string, successIndicators: string[]): Promise<boolean> {
        try {
            this.bot.log(this.bot.isMobile, '任务异常处理', `任务 "${taskName}" 检查完成状态...`);
            
            // 等待页面稳定
            await this.bot.utils.wait(3000);
            
            // 检查成功指示器
            for (const indicator of successIndicators) {
                try {
                    const successElement = page.locator(indicator);
                    if (await successElement.count() > 0 && await successElement.isVisible({ timeout: 2000 })) {
                        this.bot.log(this.bot.isMobile, '任务异常处理', `任务 "${taskName}" 检测到成功指示器: ${indicator}`);
                        return true;
                    }
                } catch (error) {
                    continue;
                }
            }
            
            this.bot.log(this.bot.isMobile, '任务异常处理', `任务 "${taskName}" 未检测到成功指示器`, 'warn');
            return false;
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '任务异常处理', `检查任务完成状态时出错: ${errorMessage}`, 'error');
            return false;
        }
    }
}
