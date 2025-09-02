/**
 * 异常统计接口
 */
export interface ExceptionStats {
    totalExceptions: number;
    exceptionsByType: Record<string, number>;
    exceptionsByCategory: Record<string, number>;
    exceptionsByTime: Record<string, number>;
    lastException?: ExceptionRecord;
    averageResponseTime: number;
}

/**
 * 异常记录接口
 */
export interface ExceptionRecord {
    id: string;
    timestamp: Date;
    type: string;
    category: string;
    message: string;
    details?: any;
    responseTime: number;
    resolved: boolean;
    resolutionTime?: number;
}

/**
 * 监控配置接口
 */
export interface MonitorConfig {
    enableRealTimeMonitoring: boolean;
    enableStatistics: boolean;
    enableAlerting: boolean;
    alertThresholds: {
        exceptionsPerMinute: number;
        responseTimeThreshold: number;
        failureRateThreshold: number;
    };
    retentionPeriod: number; // 保留天数
}

/**
 * 异常监控器
 */
export class ExceptionMonitor {
    private static instance: ExceptionMonitor;
    private config: MonitorConfig;
    private exceptions: ExceptionRecord[] = [];
    private stats: ExceptionStats;
    private alertCallbacks: Array<(alert: any) => void> = [];
    
    private constructor() {
        this.config = {
            enableRealTimeMonitoring: true,
            enableStatistics: true,
            enableAlerting: true,
            alertThresholds: {
                exceptionsPerMinute: 10,
                responseTimeThreshold: 5000,
                failureRateThreshold: 0.1
            },
            retentionPeriod: 30
        };
        
        this.stats = this.initializeStats();
        
        // 启动定期清理
        this.startPeriodicCleanup();
    }
    
    /**
     * 获取单例实例
     */
    public static getInstance(): ExceptionMonitor {
        if (!ExceptionMonitor.instance) {
            ExceptionMonitor.instance = new ExceptionMonitor();
        }
        return ExceptionMonitor.instance;
    }
    
    /**
     * 配置监控器
     */
    public configure(config: Partial<MonitorConfig>): void {
        this.config = { ...this.config, ...config };
    }
    
    /**
     * 记录异常
     */
    public recordException(
        type: string,
        category: string,
        message: string,
        details?: any,
        responseTime: number = 0
    ): string {
        const exception: ExceptionRecord = {
            id: this.generateId(),
            timestamp: new Date(),
            type,
            category,
            message,
            details,
            responseTime,
            resolved: false
        };
        
        this.exceptions.push(exception);
        this.updateStats(exception);
        
        // 检查是否需要告警
        if (this.config.enableAlerting) {
            this.checkAlertConditions();
        }
        
        return exception.id;
    }
    
    /**
     * 标记异常为已解决
     */
    public markExceptionResolved(id: string): boolean {
        const exception = this.exceptions.find(ex => ex.id === id);
        if (exception) {
            exception.resolved = true;
            exception.resolutionTime = Date.now() - exception.timestamp.getTime();
            return true;
        }
        return false;
    }
    
    /**
     * 获取异常统计
     */
    public getStats(): ExceptionStats {
        return { ...this.stats };
    }
    
    /**
     * 获取最近的异常记录
     */
    public getRecentExceptions(limit: number = 10): ExceptionRecord[] {
        return this.exceptions
            .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
            .slice(0, limit);
    }
    
    /**
     * 按类型获取异常
     */
    public getExceptionsByType(type: string): ExceptionRecord[] {
        return this.exceptions.filter(ex => ex.type === type);
    }
    
    /**
     * 按类别获取异常
     */
    public getExceptionsByCategory(category: string): ExceptionRecord[] {
        return this.exceptions.filter(ex => ex.category === category);
    }
    
    /**
     * 获取异常趋势
     */
    public getExceptionTrend(hours: number = 24): Record<string, number> {
        const now = new Date();
        const cutoff = new Date(now.getTime() - hours * 60 * 60 * 1000);
        
        const recentExceptions = this.exceptions.filter(ex => ex.timestamp >= cutoff);
        const trend: Record<string, number> = {};
        
        // 按小时分组
        for (let i = 0; i < hours; i++) {
            const hourStart = new Date(now.getTime() - i * 60 * 60 * 1000);
            const hourEnd = new Date(hourStart.getTime() + 60 * 60 * 1000);
            
            const hourExceptions = recentExceptions.filter(ex => 
                ex.timestamp >= hourStart && ex.timestamp < hourEnd
            );
            
            const hourKey = hourStart.toISOString().substring(0, 13);
            trend[hourKey] = hourExceptions.length;
        }
        
        return trend;
    }
    
    /**
     * 添加告警回调
     */
    public addAlertCallback(callback: (alert: any) => void): void {
        this.alertCallbacks.push(callback);
    }
    
    /**
     * 初始化统计
     */
    private initializeStats(): ExceptionStats {
        return {
            totalExceptions: 0,
            exceptionsByType: {},
            exceptionsByCategory: {},
            exceptionsByTime: {},
            averageResponseTime: 0
        };
    }
    
    /**
     * 更新统计
     */
    private updateStats(exception: ExceptionRecord): void {
        this.stats.totalExceptions++;
        
        // 按类型统计
        this.stats.exceptionsByType[exception.type] = 
            (this.stats.exceptionsByType[exception.type] || 0) + 1;
        
        // 按类别统计
        this.stats.exceptionsByCategory[exception.category] = 
            (this.stats.exceptionsByCategory[exception.category] || 0) + 1;
        
        // 按时间统计（按小时）
        const hourKey = exception.timestamp.toISOString().substring(0, 13);
        this.stats.exceptionsByTime[hourKey] = 
            (this.stats.exceptionsByTime[hourKey] || 0) + 1;
        
        // 更新平均响应时间
        const totalResponseTime = this.exceptions.reduce((sum, ex) => sum + ex.responseTime, 0);
        this.stats.averageResponseTime = totalResponseTime / this.exceptions.length;
        
        // 更新最后异常记录
        this.stats.lastException = exception;
    }
    
    /**
     * 检查告警条件
     */
    private checkAlertConditions(): void {
        const now = new Date();
        const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);
        
        // 检查每分钟异常数量
        const recentExceptions = this.exceptions.filter(ex => ex.timestamp >= oneMinuteAgo);
        if (recentExceptions.length > this.config.alertThresholds.exceptionsPerMinute) {
            this.triggerAlert('HIGH_EXCEPTION_RATE', {
                current: recentExceptions.length,
                threshold: this.config.alertThresholds.exceptionsPerMinute,
                timeWindow: '1 minute'
            });
        }
        
        // 检查响应时间
        const slowExceptions = this.exceptions.filter(ex => 
            ex.responseTime > this.config.alertThresholds.responseTimeThreshold
        );
        if (slowExceptions.length > 0) {
            this.triggerAlert('SLOW_RESPONSE_TIME', {
                count: slowExceptions.length,
                threshold: this.config.alertThresholds.responseTimeThreshold,
                average: this.stats.averageResponseTime
            });
        }
        
        // 检查失败率
        if (this.stats.totalExceptions > 0) {
            const resolvedExceptions = this.exceptions.filter(ex => ex.resolved).length;
            const failureRate = (this.stats.totalExceptions - resolvedExceptions) / this.stats.totalExceptions;
            
            if (failureRate > this.config.alertThresholds.failureRateThreshold) {
                this.triggerAlert('HIGH_FAILURE_RATE', {
                    current: failureRate,
                    threshold: this.config.alertThresholds.failureRateThreshold,
                    total: this.stats.totalExceptions,
                    resolved: resolvedExceptions
                });
            }
        }
    }
    
    /**
     * 触发告警
     */
    private triggerAlert(type: string, data: any): void {
        const alert = {
            type,
            timestamp: new Date(),
            data,
            severity: this.getAlertSeverity(type)
        };
        
        // 调用所有告警回调
        this.alertCallbacks.forEach(callback => {
            try {
                callback(alert);
            } catch (error) {
                console.error('Error in alert callback:', error);
            }
        });
    }
    
    /**
     * 获取告警严重程度
     */
    private getAlertSeverity(type: string): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
        switch (type) {
            case 'HIGH_EXCEPTION_RATE':
            case 'HIGH_FAILURE_RATE':
                return 'HIGH';
            case 'SLOW_RESPONSE_TIME':
                return 'MEDIUM';
            default:
                return 'LOW';
        }
    }
    
    /**
     * 生成唯一ID
     */
    private generateId(): string {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }
    
    /**
     * 启动定期清理
     */
    private startPeriodicCleanup(): void {
        setInterval(() => {
            this.cleanupOldRecords();
        }, 60 * 60 * 1000); // 每小时清理一次
    }
    
    /**
     * 清理旧记录
     */
    private cleanupOldRecords(): void {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - this.config.retentionPeriod);
        
        const initialCount = this.exceptions.length;
        this.exceptions = this.exceptions.filter(ex => ex.timestamp >= cutoff);
        const removedCount = initialCount - this.exceptions.length;
        
        if (removedCount > 0) {
            console.log(`Cleaned up ${removedCount} old exception records`);
            // 重新计算统计
            this.recalculateStats();
        }
    }
    
    /**
     * 重新计算统计
     */
    private recalculateStats(): void {
        this.stats = this.initializeStats();
        this.exceptions.forEach(ex => this.updateStats(ex));
    }
}

/**
 * 异常监控装饰器
 */
export function MonitorException(type: string, category: string) {
    return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
        const method = descriptor.value;
        
        descriptor.value = async function (...args: any[]) {
            const monitor = ExceptionMonitor.getInstance();
            const startTime = Date.now();
            
            try {
                const result = await method.apply(this, args);
                const responseTime = Date.now() - startTime;
                
                // 记录成功执行
                monitor.recordException(type, category, 'Success', { 
                    method: propertyName,
                    args: args.length 
                }, responseTime);
                
                return result;
            } catch (error: unknown) {
                const responseTime = Date.now() - startTime;
                const errorInstance = error instanceof Error ? error : new Error(String(error));

                // 记录异常
                monitor.recordException(type, category, errorInstance.message, {
                    method: propertyName,
                    args: args.length,
                    error: errorInstance.stack
                }, responseTime);

                throw error;
            }
        };
        
        return descriptor;
    };
}
