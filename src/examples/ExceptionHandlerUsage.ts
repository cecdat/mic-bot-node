import { Page } from 'rebrowser-playwright';
import { MicrosoftRewardsBot } from '../index';
import { ExceptionHandlerManager } from '../handlers/ExceptionHandlerFactory';
import { ExceptionHandlerConfigManager } from '../config/ExceptionHandlerConfig';
import { ExceptionMonitor } from '../monitoring/ExceptionMonitor';
import { Logger } from '../utils/Logger';

/**
 * 异常处理器使用示例
 * 展示如何使用重构后的异常处理系统
 */
export class ExceptionHandlerUsage {
    private bot: MicrosoftRewardsBot;
    private exceptionManager: ExceptionHandlerManager;
    private configManager: ExceptionHandlerConfigManager;
    private monitor: ExceptionMonitor;
    private logger: Logger;
    
    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot;
        this.exceptionManager = new ExceptionHandlerManager(bot);
        this.configManager = ExceptionHandlerConfigManager.getInstance();
        this.monitor = ExceptionMonitor.getInstance();
        this.logger = Logger.getInstance();
        
        // 配置监控告警
        this.setupMonitoring();
    }
    
    /**
     * 设置监控告警
     */
    private setupMonitoring(): void {
        // 添加告警回调
        this.monitor.addAlertCallback((alert) => {
            this.logger.warn('监控告警', `检测到告警: ${alert.type}`, alert);
            
            // 这里可以添加告警处理逻辑，比如发送邮件、短信等
            if (alert.severity === 'HIGH' || alert.severity === 'CRITICAL') {
                this.handleCriticalAlert(alert);
            }
        });
    }
    
    /**
     * 处理关键告警
     */
    private handleCriticalAlert(alert: any): void {
        this.logger.error('关键告警处理', `处理关键告警: ${alert.type}`, alert);
        
        // 可以在这里添加自动恢复逻辑
        // 比如重启服务、切换备用系统等
    }
    
    /**
     * 登录流程示例
     */
    public async loginExample(page: Page, email: string): Promise<boolean> {
        try {
            this.logger.info('登录示例', `开始登录流程: ${email}`);
            
            // 获取登录异常处理器
            const loginHandler = await this.exceptionManager.getLoginHandler();
            
            // 处理各种登录异常
            await loginHandler.handleCookiesConsent(page, email);
            await loginHandler.handleAccountLocked(page, email);
            await loginHandler.handleVerificationPage(page, email);
            await loginHandler.handleNetworkError(page, email);
            
            this.logger.info('登录示例', `登录流程完成: ${email}`);
            return true;
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error('登录示例', `登录流程失败: ${errorMessage}`);
            return false;
        }
    }
    
    /**
     * 任务执行示例
     */
    public async taskExecutionExample(page: Page, taskName: string): Promise<boolean> {
        try {
            this.logger.info('任务执行示例', `开始执行任务: ${taskName}`);
            
            // 获取任务异常处理器
            const taskHandler = await this.exceptionManager.getTaskHandler();
            
            // 处理各种任务异常
            await taskHandler.handlePageLoadError(page, taskName);
            await taskHandler.handleNetworkError(page, taskName);
            
            // 执行任务逻辑
            const success = await this.executeTaskLogic(page, taskName);
            
            // 检查任务完成状态
            const successIndicators = ['text=任务完成', 'text=Task completed'];
            const isCompleted = await taskHandler.handleTaskCompletionCheck(page, taskName, successIndicators);
            
            if (isCompleted) {
                this.logger.info('任务执行示例', `任务执行成功: ${taskName}`);
            } else {
                this.logger.warn('任务执行示例', `任务执行状态不明确: ${taskName}`);
            }
            
            return success;
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error('任务执行示例', `任务执行失败: ${errorMessage}`);
            return false;
        }
    }
    
    /**
     * 批量异常处理示例
     */
    public async batchExceptionHandlingExample(): Promise<void> {
        try {
            this.logger.info('批量异常处理示例', '开始批量异常处理');
            
            // 模拟多个异常
            const exceptions = [
                { type: 'login' as any, data: { email: 'user1@example.com', error: 'cookies_consent' } },
                { type: 'task' as any, data: { taskName: 'Task1', error: 'page_load_timeout' } },
                { type: 'login' as any, data: { email: 'user2@example.com', error: 'verification_required' } }
            ];
            
            // 批量处理异常
            const results = await this.exceptionManager.handleMultipleExceptions(exceptions);
            
            this.logger.info('批量异常处理示例', '批量异常处理完成', { results });
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error('批量异常处理示例', `批量异常处理失败: ${errorMessage}`);
        }
    }
    
    /**
     * 配置管理示例
     */
    public async configurationExample(): Promise<void> {
        try {
            this.logger.info('配置管理示例', '开始配置管理示例');
            
            // 获取当前配置
            const currentConfig = this.configManager.getConfig();
            this.logger.info('配置管理示例', '当前配置', currentConfig);
            
            // 更新配置
            const newConfig = {
                login: {
                    cookiesConsent: {
                        waitAfterClick: 3000, // 增加等待时间
                        maxAttempts: 5,       // 增加重试次数
                        selectors: [
                            ...currentConfig.login.cookiesConsent.selectors,
                            'button:has-text("确认")' // 添加新的选择器
                        ]
                    },
                    accountLocked: currentConfig.login.accountLocked,
                    verification: currentConfig.login.verification
                }
            };
            
            this.configManager.updateConfig(newConfig);
            this.logger.info('配置管理示例', '配置已更新', newConfig);
            
            // 重置为默认配置
            this.configManager.resetToDefault();
            this.logger.info('配置管理示例', '配置已重置为默认值');
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error('配置管理示例', `配置管理失败: ${errorMessage}`);
        }
    }
    
    /**
     * 监控统计示例
     */
    public async monitoringExample(): Promise<void> {
        try {
            this.logger.info('监控统计示例', '开始监控统计示例');
            
            // 获取异常统计
            const stats = this.monitor.getStats();
            this.logger.info('监控统计示例', '异常统计', stats);
            
            // 获取最近的异常记录
            const recentExceptions = this.monitor.getRecentExceptions(5);
            this.logger.info('监控统计示例', '最近异常记录', { count: recentExceptions.length });
            
            // 获取异常趋势
            const trend = this.monitor.getExceptionTrend(24);
            this.logger.info('监控统计示例', '24小时异常趋势', trend);
            
            // 按类型获取异常
            const loginExceptions = this.monitor.getExceptionsByType('LOGIN');
            const taskExceptions = this.monitor.getExceptionsByType('TASK');
            
            this.logger.info('监控统计示例', '按类型统计', {
                login: loginExceptions.length,
                task: taskExceptions.length
            });
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error('监控统计示例', `监控统计失败: ${errorMessage}`);
        }
    }
    
    /**
     * 执行任务逻辑（模拟）
     */
    private async executeTaskLogic(page: Page, taskName: string): Promise<boolean> {
        try {
            // 模拟任务执行
            await this.bot.utils.wait(2000);
            
            // 模拟随机成功或失败
            const success = Math.random() > 0.3; // 70%成功率
            
            if (success) {
                this.logger.info('任务逻辑', `任务 "${taskName}" 执行成功`);
            } else {
                this.logger.warn('任务逻辑', `任务 "${taskName}" 执行失败`);
            }
            
            return success;
            
        } catch (error) {
            this.logger.error('任务逻辑', `任务 "${taskName}" 执行出错: ${error}`);
            return false;
        }
    }
    
    /**
     * 运行所有示例
     */
    public async runAllExamples(): Promise<void> {
        try {
            this.logger.info('示例运行器', '开始运行所有示例');
            
            // 运行配置管理示例
            await this.configurationExample();
            
            // 运行监控统计示例
            await this.monitoringExample();
            
            // 运行批量异常处理示例
            await this.batchExceptionHandlingExample();
            
            this.logger.info('示例运行器', '所有示例运行完成');
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error('示例运行器', `运行示例时出错: ${errorMessage}`);
        }
    }
}
