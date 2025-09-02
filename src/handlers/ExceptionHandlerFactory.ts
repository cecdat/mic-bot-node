import { MicrosoftRewardsBot } from '../index';
import { LoginExceptionHandler } from './LoginExceptionHandler';
import { TaskExceptionHandler } from './TaskExceptionHandler';

/**
 * 异常处理器类型枚举
 */
export enum ExceptionHandlerType {
    LOGIN = 'login',
    TASK = 'task'
}

/**
 * 异常处理器接口
 */
export interface IExceptionHandler {
    readonly type: ExceptionHandlerType;
    initialize(): Promise<void>;
    cleanup(): Promise<void>;
}

/**
 * 异常处理器工厂
 * 负责创建和管理不同类型的异常处理器
 */
export class ExceptionHandlerFactory {
    private static instance: ExceptionHandlerFactory;
    private handlers: Map<ExceptionHandlerType, IExceptionHandler> = new Map();
    private bot: MicrosoftRewardsBot;

    private constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot;
    }
    
    /**
     * 获取单例实例
     */
    public static getInstance(bot: MicrosoftRewardsBot): ExceptionHandlerFactory {
        if (!ExceptionHandlerFactory.instance) {
            ExceptionHandlerFactory.instance = new ExceptionHandlerFactory(bot);
        }
        return ExceptionHandlerFactory.instance;
    }
    
    /**
     * 获取或创建异常处理器
     */
    public async getHandler(type: ExceptionHandlerType): Promise<IExceptionHandler> {
        if (!this.handlers.has(type)) {
            const handler = await this.createHandler(type);
            this.handlers.set(type, handler);
        }
        
        return this.handlers.get(type)!;
    }
    
    /**
     * 创建异常处理器
     */
    private async createHandler(type: ExceptionHandlerType): Promise<IExceptionHandler> {
        switch (type) {
            case ExceptionHandlerType.LOGIN:
                const loginHandler = new LoginExceptionHandler(this.bot);
                await loginHandler.initialize();
                return loginHandler;
            case ExceptionHandlerType.TASK:
                const taskHandler = new TaskExceptionHandler(this.bot);
                await taskHandler.initialize();
                return taskHandler;
            default:
                throw new Error(`不支持的异常处理器类型: ${type}`);
        }
    }
    
    /**
     * 获取所有已创建的处理器
     */
    public getAllHandlers(): Map<ExceptionHandlerType, IExceptionHandler> {
        return new Map(this.handlers);
    }
    
    /**
     * 清理所有处理器
     */
    public async cleanupAll(): Promise<void> {
        const cleanupPromises = Array.from(this.handlers.values()).map(handler => handler.cleanup());
        await Promise.all(cleanupPromises);
        this.handlers.clear();
    }
    
    /**
     * 检查处理器是否存在
     */
    public hasHandler(type: ExceptionHandlerType): boolean {
        return this.handlers.has(type);
    }
    
    /**
     * 移除特定处理器
     */
    public async removeHandler(type: ExceptionHandlerType): Promise<boolean> {
        const handler = this.handlers.get(type);
        if (handler) {
            await handler.cleanup();
            this.handlers.delete(type);
            return true;
        }
        return false;
    }
}

/**
 * 异常处理器管理器
 * 提供高级的异常处理管理功能
 */
export class ExceptionHandlerManager {
    private factory: ExceptionHandlerFactory;

    constructor(bot: MicrosoftRewardsBot) {
        this.factory = ExceptionHandlerFactory.getInstance(bot);
    }
    
    /**
     * 获取登录异常处理器
     */
    public async getLoginHandler(): Promise<LoginExceptionHandler> {
        const handler = await this.factory.getHandler(ExceptionHandlerType.LOGIN);
        return handler as LoginExceptionHandler;
    }

    /**
     * 获取任务异常处理器
     */
    public async getTaskHandler(): Promise<TaskExceptionHandler> {
        const handler = await this.factory.getHandler(ExceptionHandlerType.TASK);
        return handler as TaskExceptionHandler;
    }
    
    /**
     * 批量处理异常
     */
    public async handleMultipleExceptions(
        exceptions: Array<{ type: ExceptionHandlerType; data: any }>
    ): Promise<Array<{ success: boolean; error?: string }>> {
        const results = [];
        
        for (const exception of exceptions) {
            try {
                await this.factory.getHandler(exception.type);
                // 这里可以根据异常类型调用相应的处理方法
                results.push({ success: true });
            } catch (error) {
                results.push({ 
                    success: false, 
                    error: error instanceof Error ? error.message : String(error) 
                });
            }
        }
        
        return results;
    }
    
    /**
     * 获取处理器状态
     */
    public getHandlerStatus(): Record<string, boolean> {
        const status: Record<string, boolean> = {};
        
        for (const [type, handler] of this.factory.getAllHandlers()) {
            status[type] = handler !== null;
        }
        
        return status;
    }
    
    /**
     * 重新初始化所有处理器
     */
    public async reinitializeAll(): Promise<void> {
        await this.factory.cleanupAll();
        // 重新创建处理器会在下次获取时自动进行
    }
}
