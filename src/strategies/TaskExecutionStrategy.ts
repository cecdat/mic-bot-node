import { Page } from 'rebrowser-playwright';
import { MicrosoftRewardsBot } from '../index';
import { TaskExceptionHandler } from '../handlers/TaskExceptionHandler';
import { ExceptionHandlerLogger } from '../utils/Logger';

/**
 * 任务类型枚举
 */
export enum TaskType {
    DAILY_SET = 'daily_set',
    MORE_PROMOTIONS = 'more_promotions',
    PUNCH_CARDS = 'punch_cards',
    DESKTOP_SEARCH = 'desktop_search',
    MOBILE_SEARCH = 'mobile_search',
    DAILY_CHECK_IN = 'daily_check_in',
    READ_TO_EARN = 'read_to_earn',
    URL_REWARD = 'url_reward',
    QUIZ = 'quiz',
    POLL = 'poll'
}

/**
 * 任务执行状态
 */
export enum TaskExecutionStatus {
    PENDING = 'pending',
    IN_PROGRESS = 'in_progress',
    COMPLETED = 'completed',
    FAILED = 'failed',
    SKIPPED = 'skipped'
}

/**
 * 任务执行结果
 */
export interface TaskExecutionResult {
    taskId: string;
    taskType: TaskType;
    status: TaskExecutionStatus;
    pointsEarned: number;
    executionTime: number;
    error?: string;
    details?: any;
}

/**
 * 任务执行策略接口
 */
export interface ITaskExecutionStrategy {
    readonly taskType: TaskType;
    readonly priority: number;
    readonly maxRetries: number;
    readonly timeout: number;
    
    canExecute(page: Page): Promise<boolean>;
    execute(page: Page, taskData: any): Promise<TaskExecutionResult>;
    validateCompletion(page: Page): Promise<boolean>;
    cleanup(page: Page): Promise<void>;
}

/**
 * 基础任务执行策略
 */
export abstract class BaseTaskExecutionStrategy implements ITaskExecutionStrategy {
    public abstract readonly taskType: TaskType;
    public abstract readonly priority: number;
    public abstract readonly maxRetries: number;
    public abstract readonly timeout: number;
    
    protected bot: MicrosoftRewardsBot;
    protected exceptionHandler: TaskExceptionHandler;
    protected logger: ExceptionHandlerLogger;
    
    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot;
        this.exceptionHandler = new TaskExceptionHandler(bot);
        this.logger = new ExceptionHandlerLogger();
    }
    
    /**
     * 检查是否可以执行任务
     */
    public abstract canExecute(page: Page): Promise<boolean>;
    
    /**
     * 执行任务
     */
    public async execute(page: Page, taskData: any): Promise<TaskExecutionResult> {
        const startTime = Date.now();
        const taskId = this.generateTaskId();
        
        try {
            this.logger.logTaskException(taskData.title || this.taskType, '开始执行', `任务类型: ${this.taskType}`);
            
            // 检查是否可以执行
            if (!(await this.canExecute(page))) {
                return {
                    taskId,
                    taskType: this.taskType,
                    status: TaskExecutionStatus.SKIPPED,
                    pointsEarned: 0,
                    executionTime: Date.now() - startTime,
                    details: { reason: '任务不可执行' }
                };
            }
            
            // 执行任务
            const result = await this.executeTask(page, taskData);
            
            // 验证完成状态
            const isCompleted = await this.validateCompletion(page);
            
            const executionResult: TaskExecutionResult = {
                taskId,
                taskType: this.taskType,
                status: isCompleted ? TaskExecutionStatus.COMPLETED : TaskExecutionStatus.FAILED,
                pointsEarned: result.pointsEarned || 0,
                executionTime: Date.now() - startTime,
                details: result
            };
            
            if (isCompleted) {
                this.logger.logTaskException(taskData.title || this.taskType, '执行成功', `获得积分: ${result.pointsEarned}`);
            } else {
                this.logger.logTaskException(taskData.title || this.taskType, '执行失败', '任务完成状态验证失败');
            }
            
            return executionResult;
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.logError('任务执行', `任务执行出错: ${errorMessage}`);
            
            return {
                taskId,
                taskType: this.taskType,
                status: TaskExecutionStatus.FAILED,
                pointsEarned: 0,
                executionTime: Date.now() - startTime,
                error: errorMessage
            };
        } finally {
            // 清理资源
            await this.cleanup(page);
        }
    }
    
    /**
     * 验证任务完成状态
     */
    public abstract validateCompletion(page: Page): Promise<boolean>;
    
    /**
     * 清理资源
     */
    public async cleanup(page: Page): Promise<void> {
        try {
            // 关闭可能打开的标签页
            const context = page.context();
            if (context) {
                const pages = context.pages();
                if (pages.length > 1) {
                    for (let i = 1; i < pages.length; i++) {
                        const pageToClose = pages[i];
                        if (pageToClose) {
                            await pageToClose.close();
                        }
                    }
                }
            }
        } catch (error) {
            this.logger.logWarning('任务清理', '清理资源时出错', error);
        }
    }
    
    /**
     * 执行具体任务逻辑（子类实现）
     */
    protected abstract executeTask(page: Page, taskData: any): Promise<any>;
    
    /**
     * 生成任务ID
     */
    protected generateTaskId(): string {
        return `${this.taskType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    /**
     * 等待页面加载
     */
    protected async waitForPageLoad(page: Page, timeout: number = 10000): Promise<void> {
        try {
            await page.waitForLoadState('networkidle', { timeout });
        } catch (error) {
            this.logger.logWarning('页面加载', '等待页面加载超时', { timeout });
        }
    }
    
    /**
     * 安全点击元素
     */
    protected async safeClick(page: Page, selector: string, timeout: number = 5000): Promise<boolean> {
        try {
            const element = page.locator(selector);
            if (await element.count() > 0 && await element.isVisible({ timeout: 2000 })) {
                await element.scrollIntoViewIfNeeded();
                await this.bot.utils.wait(500);
                await element.click({ timeout });
                return true;
            }
            return false;
        } catch (error) {
            this.logger.logWarning('安全点击', `点击元素失败: ${selector}`, error);
            return false;
        }
    }
    
    /**
     * 检查元素是否存在
     */
    protected async elementExists(page: Page, selector: string, timeout: number = 2000): Promise<boolean> {
        try {
            const element = page.locator(selector);
            return await element.count() > 0 && await element.isVisible({ timeout });
        } catch (error) {
            return false;
        }
    }
    
    /**
     * 获取元素文本
     */
    protected async getElementText(page: Page, selector: string): Promise<string> {
        try {
            const element = page.locator(selector);
            if (await element.count() > 0) {
                return await element.textContent() || '';
            }
            return '';
        } catch (error) {
            return '';
        }
    }
}

/**
 * 每日任务执行策略
 */
export class DailySetStrategy extends BaseTaskExecutionStrategy {
    public readonly taskType = TaskType.DAILY_SET;
    public readonly priority = 1;
    public readonly maxRetries = 3;
    public readonly timeout = 60000;
    
    public async canExecute(page: Page): Promise<boolean> {
        // 检查是否有每日任务可用
        const dailySetSelectors = [
            'text=每日任务',
            'text=Daily Set',
            '[data-testid="daily-set"]',
            '.daily-set'
        ];
        
        for (const selector of dailySetSelectors) {
            if (await this.elementExists(page, selector)) {
                return true;
            }
        }
        
        return false;
    }
    
    protected async executeTask(page: Page, taskData: any): Promise<any> {
        // 实现每日任务执行逻辑
        // 这里可以参考原始项目的具体实现
        return { pointsEarned: 0 };
    }
    
    public async validateCompletion(page: Page): Promise<boolean> {
        // 验证每日任务是否完成
        const completionSelectors = [
            'text=已完成',
            'text=Completed',
            '[data-testid="completed"]'
        ];
        
        for (const selector of completionSelectors) {
            if (await this.elementExists(page, selector)) {
                return true;
            }
        }
        
        return false;
    }
}

/**
 * 搜索任务执行策略
 */
export class SearchStrategy extends BaseTaskExecutionStrategy {
    public readonly taskType = TaskType.DESKTOP_SEARCH;
    public readonly priority = 2;
    public readonly maxRetries = 2;
    public readonly timeout = 30000;
    
    public async canExecute(page: Page): Promise<boolean> {
        // 检查是否可以进行搜索
        const searchBoxSelectors = [
            'input[name="q"]',
            'input[type="search"]',
            '#sb_form_q',
            '[data-testid="search-input"]'
        ];
        
        for (const selector of searchBoxSelectors) {
            if (await this.elementExists(page, selector)) {
                return true;
            }
        }
        
        return false;
    }
    
    protected async executeTask(page: Page, taskData: any): Promise<any> {
        // 实现搜索任务执行逻辑
        // 这里可以参考原始项目的搜索实现
        return { pointsEarned: 0 };
    }
    
    public async validateCompletion(page: Page): Promise<boolean> {
        // 验证搜索是否完成
        return true;
    }
}

/**
 * 任务执行策略工厂
 */
export class TaskExecutionStrategyFactory {
    private static strategies: Map<TaskType, ITaskExecutionStrategy> = new Map();
    
    /**
     * 注册策略
     */
    public static registerStrategy(strategy: ITaskExecutionStrategy): void {
        this.strategies.set(strategy.taskType, strategy);
    }
    
    /**
     * 获取策略
     */
    public static getStrategy(taskType: TaskType): ITaskExecutionStrategy | undefined {
        return this.strategies.get(taskType);
    }
    
    /**
     * 获取所有策略
     */
    public static getAllStrategies(): ITaskExecutionStrategy[] {
        return Array.from(this.strategies.values());
    }
    
    /**
     * 按优先级排序的策略
     */
    public static getPrioritizedStrategies(): ITaskExecutionStrategy[] {
        return this.getAllStrategies().sort((a, b) => a.priority - b.priority);
    }
}
