import { MicrosoftRewardsBot } from '../index';
import { TaskType, TaskExecutionResult, TaskExecutionStatus } from '../strategies/TaskExecutionStrategy';
import { ExceptionHandlerLogger } from '../utils/Logger';

/**
 * 任务调度配置
 */
export interface TaskSchedulerConfig {
    maxConcurrentTasks: number;
    taskDelayRange: {
        min: number;
        max: number;
    };
    retryFailedTasks: boolean;
    maxRetries: number;
    enableTaskPrioritization: boolean;
    enableTaskParallelization: boolean;
}

/**
 * 任务队列项
 */
export interface TaskQueueItem {
    id: string;
    taskType: TaskType;
    taskData: any;
    priority: number;
    retryCount: number;
    maxRetries: number;
    createdAt: Date;
    scheduledFor: Date;
}

/**
 * 任务调度器
 * 负责管理和调度任务的执行
 */
export class TaskScheduler {
    private bot: MicrosoftRewardsBot;
    private logger: ExceptionHandlerLogger;
    private config: TaskSchedulerConfig;
    
    private taskQueue: TaskQueueItem[] = [];
    private runningTasks: Map<string, Promise<TaskExecutionResult>> = new Map();
    private completedTasks: TaskExecutionResult[] = [];
    private failedTasks: TaskExecutionResult[] = [];
    
    private isRunning: boolean = false;
    private schedulerInterval?: NodeJS.Timeout;
    
    constructor(bot: MicrosoftRewardsBot, config: Partial<TaskSchedulerConfig> = {}) {
        this.bot = bot;
        this.logger = new ExceptionHandlerLogger();
        
        this.config = {
            maxConcurrentTasks: 3,
            taskDelayRange: { min: 2000, max: 5000 },
            retryFailedTasks: true,
            maxRetries: 3,
            enableTaskPrioritization: true,
            enableTaskParallelization: true,
            ...config
        };
    }
    
    /**
     * 添加任务到队列
     */
    public addTask(taskType: TaskType, taskData: any, priority: number = 0): string {
        const taskId = this.generateTaskId();
        const now = new Date();
        
        const taskItem: TaskQueueItem = {
            id: taskId,
            taskType,
            taskData,
            priority,
            retryCount: 0,
            maxRetries: this.config.maxRetries,
            createdAt: now,
            scheduledFor: now
        };
        
        this.taskQueue.push(taskItem);
        
        // 按优先级排序
        if (this.config.enableTaskPrioritization) {
            this.sortQueueByPriority();
        }
        
        this.logger.logTaskException(taskData.title || taskType, '任务已添加', `任务ID: ${taskId}, 优先级: ${priority}`);
        
        return taskId;
    }
    
    /**
     * 启动调度器
     */
    public async start(): Promise<void> {
        if (this.isRunning) {
            this.logger.logWarning('任务调度器', '调度器已在运行中');
            return;
        }
        
        this.isRunning = true;
        this.logger.logTaskException('任务调度器', '启动', '开始执行任务调度');
        
        // 启动调度循环
        this.schedulerInterval = setInterval(async () => {
            await this.processTaskQueue();
        }, 1000);
    }
    
    /**
     * 停止调度器
     */
    public async stop(): Promise<void> {
        if (!this.isRunning) {
            return;
        }
        
        this.isRunning = false;
        
        if (this.schedulerInterval) {
            clearInterval(this.schedulerInterval);
            this.schedulerInterval = undefined;
        }
        
        // 等待所有运行中的任务完成
        await this.waitForRunningTasks();
        
        this.logger.logTaskException('任务调度器', '停止', '任务调度器已停止');
    }
    
    /**
     * 处理任务队列
     */
    private async processTaskQueue(): Promise<void> {
        if (!this.isRunning || this.taskQueue.length === 0) {
            return;
        }
        
        // 检查是否可以启动新任务
        if (this.runningTasks.size >= this.config.maxConcurrentTasks) {
            return;
        }
        
        // 获取下一个要执行的任务
        const nextTask = this.getNextTask();
        if (nextTask === undefined) {
            return;
        }
        
        // 从队列中移除任务
        this.taskQueue = this.taskQueue.filter(task => task.id !== nextTask.id);
        
        // 执行任务
        await this.executeTask(nextTask);
    }
    
    /**
     * 获取下一个要执行的任务
     */
    private getNextTask(): TaskQueueItem | undefined {
        if (this.taskQueue.length === 0) {
            return undefined;
        }
        
        const now = new Date();
        
        // 查找可以执行的任务（已到执行时间）
        const executableTasks = this.taskQueue.filter(task => task.scheduledFor <= now);
        
        if (executableTasks.length === 0) {
            return undefined;
        }
        
        // 按优先级返回第一个任务
        return executableTasks[0];
    }
    
    /**
     * 执行任务
     */
    private async executeTask(taskItem: TaskQueueItem): Promise<void> {
        try {
            this.logger.logTaskException(taskItem.taskData.title || taskItem.taskType, '开始执行', `任务ID: ${taskItem.id}`);
            
            // 创建任务执行Promise
            const taskPromise = this.runTask(taskItem);
            this.runningTasks.set(taskItem.id, taskPromise);
            
            // 等待任务完成
            const result = await taskPromise;
            
            // 处理任务结果
            await this.handleTaskResult(taskItem, result);
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.logError('任务执行', `执行任务时出错: ${errorMessage}`);
            
            // 记录失败的任务
            const failedResult: TaskExecutionResult = {
                taskId: taskItem.id,
                taskType: taskItem.taskType,
                status: TaskExecutionStatus.FAILED,
                pointsEarned: 0,
                executionTime: 0,
                error: errorMessage
            };
            
            this.failedTasks.push(failedResult);
        } finally {
            // 从运行中任务列表移除
            this.runningTasks.delete(taskItem.id);
        }
    }
    
    /**
     * 运行具体任务
     */
    private async runTask(taskItem: TaskQueueItem): Promise<TaskExecutionResult> {
        // 这里应该根据任务类型获取相应的策略并执行
        // 暂时返回模拟结果
        await this.bot.utils.wait(1000);
        
        return {
            taskId: taskItem.id,
            taskType: taskItem.taskType,
            status: TaskExecutionStatus.COMPLETED,
            pointsEarned: Math.floor(Math.random() * 10) + 1,
            executionTime: 1000,
            details: { message: '任务执行成功' }
        };
    }
    
    /**
     * 处理任务执行结果
     */
    private async handleTaskResult(taskItem: TaskQueueItem, result: TaskExecutionResult): Promise<void> {
        if (result.status === TaskExecutionStatus.COMPLETED) {
            this.completedTasks.push(result);
            this.logger.logTaskException(taskItem.taskData.title || taskItem.taskType, '执行完成', `获得积分: ${result.pointsEarned}`);
        } else if (result.status === TaskExecutionStatus.FAILED) {
            // 检查是否需要重试
            if (this.config.retryFailedTasks && taskItem.retryCount < taskItem.maxRetries) {
                await this.retryTask(taskItem);
            } else {
                this.failedTasks.push(result);
                this.logger.logError('任务执行', `任务执行失败，已达到最大重试次数: ${taskItem.id}`);
            }
        }
    }
    
    /**
     * 重试任务
     */
    private async retryTask(taskItem: TaskQueueItem): Promise<void> {
        taskItem.retryCount++;
        taskItem.scheduledFor = new Date(Date.now() + this.getRandomDelay());
        
        // 重新添加到队列末尾
        this.taskQueue.push(taskItem);
        
        this.logger.logWarning('任务重试', `任务将重试: ${taskItem.id}, 重试次数: ${taskItem.retryCount}`);
    }
    
    /**
     * 等待运行中的任务完成
     */
    private async waitForRunningTasks(): Promise<void> {
        if (this.runningTasks.size === 0) {
            return;
        }
        
        const runningTaskPromises = Array.from(this.runningTasks.values());
        await Promise.allSettled(runningTaskPromises);
    }
    
    /**
     * 按优先级排序队列
     */
    private sortQueueByPriority(): void {
        this.taskQueue.sort((a, b) => {
            // 优先级高的在前
            if (a.priority !== b.priority) {
                return b.priority - a.priority;
            }
            
            // 优先级相同时，创建时间早的在前
            return a.createdAt.getTime() - b.createdAt.getTime();
        });
    }
    
    /**
     * 获取随机延迟时间
     */
    private getRandomDelay(): number {
        const { min, max } = this.config.taskDelayRange;
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
    
    /**
     * 生成任务ID
     */
    private generateTaskId(): string {
        return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    /**
     * 获取调度器状态
     */
    public getStatus(): {
        isRunning: boolean;
        queueLength: number;
        runningTasks: number;
        completedTasks: number;
        failedTasks: number;
    } {
        return {
            isRunning: this.isRunning,
            queueLength: this.taskQueue.length,
            runningTasks: this.runningTasks.size,
            completedTasks: this.completedTasks.length,
            failedTasks: this.failedTasks.length
        };
    }
    
    /**
     * 获取任务统计
     */
    public getTaskStats(): {
        totalTasks: number;
        successRate: number;
        averageExecutionTime: number;
        pointsEarned: number;
    } {
        const totalTasks = this.completedTasks.length + this.failedTasks.length;
        const successRate = totalTasks > 0 ? this.completedTasks.length / totalTasks : 0;
        const averageExecutionTime = this.completedTasks.length > 0 
            ? this.completedTasks.reduce((sum, task) => sum + task.executionTime, 0) / this.completedTasks.length 
            : 0;
        const pointsEarned = this.completedTasks.reduce((sum, task) => sum + task.pointsEarned, 0);
        
        return {
            totalTasks,
            successRate,
            averageExecutionTime,
            pointsEarned
        };
    }
    
    /**
     * 清空队列
     */
    public clearQueue(): void {
        this.taskQueue = [];
        this.logger.logTaskException('任务调度器', '清空队列', '任务队列已清空');
    }
    
    /**
     * 暂停调度器
     */
    public pause(): void {
        if (this.schedulerInterval) {
            clearInterval(this.schedulerInterval);
            this.schedulerInterval = undefined;
        }
        this.logger.logTaskException('任务调度器', '暂停', '任务调度器已暂停');
    }
    
    /**
     * 恢复调度器
     */
    public resume(): void {
        if (!this.schedulerInterval && this.isRunning) {
            this.schedulerInterval = setInterval(async () => {
                await this.processTaskQueue();
            }, 1000);
            this.logger.logTaskException('任务调度器', '恢复', '任务调度器已恢复');
        }
    }
}
