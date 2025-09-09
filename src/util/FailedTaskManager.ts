import fs from 'fs';
import path from 'path';

export interface FailedTask {
    id: string;
    accountEmail: string;
    taskType: 'search' | 'mobile' | 'desktop';
    reason: string;
    timestamp: number;
    retryCount: number;
    maxRetries: number;
    taskData?: any;
}

export class FailedTaskManager {
    private failedTasks: Map<string, FailedTask> = new Map();
    private filePath: string;
    private maxRetries: number = 3;

    constructor(sessionPath: string, maxRetries: number = 3) {
        this.filePath = path.join(sessionPath, 'failed_tasks.json');
        this.maxRetries = maxRetries;
        this.loadFailedTasks();
    }

    /**
     * 添加失败任务
     */
    addFailedTask(task: Omit<FailedTask, 'id' | 'timestamp' | 'retryCount'>): string {
        const id = `${task.accountEmail}_${task.taskType}_${Date.now()}`;
        const failedTask: FailedTask = {
            ...task,
            id,
            timestamp: Date.now(),
            retryCount: 0
        };
        
        this.failedTasks.set(id, failedTask);
        this.saveFailedTasks();
        
        console.log(`[失败任务管理] 添加失败任务: ${id} - ${task.reason}`);
        return id;
    }

    /**
     * 获取指定账户的失败任务
     */
    getFailedTasksForAccount(accountEmail: string): FailedTask[] {
        return Array.from(this.failedTasks.values())
            .filter(task => task.accountEmail === accountEmail);
    }

    /**
     * 获取所有失败任务
     */
    getAllFailedTasks(): FailedTask[] {
        return Array.from(this.failedTasks.values());
    }

    /**
     * 重试失败任务
     */
    async retryFailedTask(taskId: string, retryFunction: (task: FailedTask) => Promise<boolean>): Promise<boolean> {
        const task = this.failedTasks.get(taskId);
        if (!task) {
            console.log(`[失败任务管理] 任务不存在: ${taskId}`);
            return false;
        }

        if (task.retryCount >= task.maxRetries) {
            console.log(`[失败任务管理] 任务已达到最大重试次数: ${taskId}`);
            this.removeFailedTask(taskId);
            return false;
        }

        task.retryCount++;
        console.log(`[失败任务管理] 重试任务: ${taskId} (第${task.retryCount}次)`);

        try {
            const success = await retryFunction(task);
            if (success) {
                console.log(`[失败任务管理] 任务重试成功: ${taskId}`);
                this.removeFailedTask(taskId);
                return true;
            } else {
                console.log(`[失败任务管理] 任务重试失败: ${taskId}`);
                this.saveFailedTasks();
                return false;
            }
        } catch (error) {
            console.log(`[失败任务管理] 任务重试异常: ${taskId} - ${error}`);
            this.saveFailedTasks();
            return false;
        }
    }

    /**
     * 重试指定账户的所有失败任务
     */
    async retryFailedTasksForAccount(accountEmail: string, retryFunction: (task: FailedTask) => Promise<boolean>): Promise<{ success: number; failed: number }> {
        const tasks = this.getFailedTasksForAccount(accountEmail);
        let success = 0;
        let failed = 0;

        console.log(`[失败任务管理] 开始重试账户 ${accountEmail} 的 ${tasks.length} 个失败任务`);

        for (const task of tasks) {
            const result = await this.retryFailedTask(task.id, retryFunction);
            if (result) {
                success++;
            } else {
                failed++;
            }
        }

        console.log(`[失败任务管理] 账户 ${accountEmail} 重试完成: 成功 ${success} 个，失败 ${failed} 个`);
        return { success, failed };
    }

    /**
     * 重试所有失败任务
     */
    async retryAllFailedTasks(retryFunction: (task: FailedTask) => Promise<boolean>): Promise<{ success: number; failed: number }> {
        const tasks = this.getAllFailedTasks();
        let success = 0;
        let failed = 0;

        console.log(`[失败任务管理] 开始重试所有 ${tasks.length} 个失败任务`);

        for (const task of tasks) {
            const result = await this.retryFailedTask(task.id, retryFunction);
            if (result) {
                success++;
            } else {
                failed++;
            }
        }

        console.log(`[失败任务管理] 所有任务重试完成: 成功 ${success} 个，失败 ${failed} 个`);
        return { success, failed };
    }

    /**
     * 移除失败任务
     */
    removeFailedTask(taskId: string): void {
        this.failedTasks.delete(taskId);
        this.saveFailedTasks();
    }

    /**
     * 清理过期的失败任务（超过24小时）
     */
    cleanupExpiredTasks(): void {
        const now = Date.now();
        const expiredTime = 24 * 60 * 60 * 1000; // 24小时

        const expiredTasks = Array.from(this.failedTasks.values())
            .filter(task => now - task.timestamp > expiredTime);

        for (const task of expiredTasks) {
            this.failedTasks.delete(task.id);
            console.log(`[失败任务管理] 清理过期任务: ${task.id}`);
        }

        if (expiredTasks.length > 0) {
            this.saveFailedTasks();
            console.log(`[失败任务管理] 清理了 ${expiredTasks.length} 个过期任务`);
        }
    }

    /**
     * 获取失败任务统计
     */
    getFailedTaskStats(): { total: number; byAccount: Record<string, number>; byType: Record<string, number> } {
        const tasks = this.getAllFailedTasks();
        const byAccount: Record<string, number> = {};
        const byType: Record<string, number> = {};

        for (const task of tasks) {
            byAccount[task.accountEmail] = (byAccount[task.accountEmail] || 0) + 1;
            byType[task.taskType] = (byType[task.taskType] || 0) + 1;
        }

        return {
            total: tasks.length,
            byAccount,
            byType
        };
    }

    /**
     * 从文件加载失败任务
     */
    private loadFailedTasks(): void {
        try {
            if (fs.existsSync(this.filePath)) {
                const data = fs.readFileSync(this.filePath, 'utf8');
                const tasks = JSON.parse(data) as FailedTask[];
                
                for (const task of tasks) {
                    this.failedTasks.set(task.id, task);
                }
                
                console.log(`[失败任务管理] 加载了 ${tasks.length} 个失败任务`);
            }
        } catch (error) {
            console.log(`[失败任务管理] 加载失败任务文件失败: ${error}`);
        }
    }

    /**
     * 保存失败任务到文件
     */
    private saveFailedTasks(): void {
        try {
            const tasks = Array.from(this.failedTasks.values());
            fs.writeFileSync(this.filePath, JSON.stringify(tasks, null, 2));
        } catch (error) {
            console.log(`[失败任务管理] 保存失败任务文件失败: ${error}`);
        }
    }
}
