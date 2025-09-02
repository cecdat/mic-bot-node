import { ExceptionHandlerLogger } from '../utils/Logger';

/**
 * 性能指标接口
 */
export interface PerformanceMetrics {
    timestamp: Date;
    cpuUsage: number;
    memoryUsage: number;
    memoryTotal: number;
    memoryFree: number;
    networkLatency: number;
    responseTime: number;
    throughput: number;
    errorRate: number;
}

/**
 * 性能阈值配置
 */
export interface PerformanceThresholds {
    cpuUsage: number;
    memoryUsage: number;
    networkLatency: number;
    responseTime: number;
    errorRate: number;
}

/**
 * 性能监控器
 * 监控系统性能和资源使用情况
 */
export class PerformanceMonitor {
    private static instance: PerformanceMonitor;
    private logger: ExceptionHandlerLogger;
    private thresholds: PerformanceThresholds;
    private metrics: PerformanceMetrics[] = [];
    private maxMetricsHistory: number = 1000;
    private monitoringInterval?: NodeJS.Timeout;
    private isMonitoring: boolean = false;
    
    private constructor() {
        this.logger = new ExceptionHandlerLogger();
        this.thresholds = {
            cpuUsage: 80,        // CPU使用率阈值
            memoryUsage: 85,     // 内存使用率阈值
            networkLatency: 1000, // 网络延迟阈值(ms)
            responseTime: 5000,   // 响应时间阈值(ms)
            errorRate: 0.1        // 错误率阈值(10%)
        };
    }
    
    /**
     * 获取单例实例
     */
    public static getInstance(): PerformanceMonitor {
        if (!PerformanceMonitor.instance) {
            PerformanceMonitor.instance = new PerformanceMonitor();
        }
        return PerformanceMonitor.instance;
    }
    
    /**
     * 配置性能阈值
     */
    public configureThresholds(newThresholds: Partial<PerformanceThresholds>): void {
        this.thresholds = { ...this.thresholds, ...newThresholds };
        this.logger.logTaskException('性能监控', '阈值配置已更新', JSON.stringify(this.thresholds));
    }
    
    /**
     * 开始性能监控
     */
    public startMonitoring(intervalMs: number = 5000): void {
        if (this.isMonitoring) {
            this.logger.logWarning('性能监控', '性能监控已在运行中');
            return;
        }
        
        this.isMonitoring = true;
        this.logger.logTaskException('性能监控', '启动', `监控间隔: ${intervalMs}ms`);
        
        this.monitoringInterval = setInterval(async () => {
            await this.collectMetrics();
        }, intervalMs);
    }
    
    /**
     * 停止性能监控
     */
    public stopMonitoring(): void {
        if (!this.isMonitoring) {
            return;
        }
        
        this.isMonitoring = false;
        
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = undefined;
        }
        
        this.logger.logTaskException('性能监控', '停止', '性能监控已停止');
    }
    
    /**
     * 收集性能指标
     */
    private async collectMetrics(): Promise<void> {
        try {
            const metrics = await this.gatherMetrics();
            this.metrics.push(metrics);
            
            // 限制历史记录数量
            if (this.metrics.length > this.maxMetricsHistory) {
                this.metrics = this.metrics.slice(-this.maxMetricsHistory);
            }
            
            // 检查性能阈值
            this.checkPerformanceThresholds(metrics);
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.logError('性能监控', `收集性能指标时出错: ${errorMessage}`);
        }
    }
    
    /**
     * 收集性能指标
     */
    private async gatherMetrics(): Promise<PerformanceMetrics> {
        const timestamp = new Date();
        
        // 获取系统性能指标
        const cpuUsage = await this.getCpuUsage();
        const memoryInfo = await this.getMemoryInfo();
        const networkLatency = await this.getNetworkLatency();
        
        return {
            timestamp,
            cpuUsage,
            memoryUsage: memoryInfo.usage,
            memoryTotal: memoryInfo.total,
            memoryFree: memoryInfo.free,
            networkLatency,
            responseTime: 0, // 这里可以从其他地方获取
            throughput: 0,   // 这里可以从其他地方获取
            errorRate: 0     // 这里可以从其他地方获取
        };
    }
    
    /**
     * 获取CPU使用率
     */
    private async getCpuUsage(): Promise<number> {
        try {
            // 这里应该实现实际的CPU使用率获取逻辑
            // 暂时返回模拟值
            return Math.random() * 100;
        } catch (error) {
            return 0;
        }
    }
    
    /**
     * 获取内存信息
     */
    private async getMemoryInfo(): Promise<{ usage: number; total: number; free: number }> {
        try {
            // 这里应该实现实际的内存信息获取逻辑
            // 暂时返回模拟值
            const total = 8 * 1024 * 1024 * 1024; // 8GB
            const free = Math.random() * total;
            const usage = ((total - free) / total) * 100;
            
            return { usage, total, free };
        } catch (error) {
            return { usage: 0, total: 0, free: 0 };
        }
    }
    
    /**
     * 获取网络延迟
     */
    private async getNetworkLatency(): Promise<number> {
        try {
            // 这里应该实现实际的网络延迟测试
            // 暂时返回模拟值
            return Math.random() * 1000;
        } catch (error) {
            return 0;
        }
    }
    
    /**
     * 检查性能阈值
     */
    private checkPerformanceThresholds(metrics: PerformanceMetrics): void {
        const alerts: string[] = [];
        
        if (metrics.cpuUsage > this.thresholds.cpuUsage) {
            alerts.push(`CPU使用率过高: ${metrics.cpuUsage.toFixed(2)}% > ${this.thresholds.cpuUsage}%`);
        }
        
        if (metrics.memoryUsage > this.thresholds.memoryUsage) {
            alerts.push(`内存使用率过高: ${metrics.memoryUsage.toFixed(2)}% > ${this.thresholds.memoryUsage}%`);
        }
        
        if (metrics.networkLatency > this.thresholds.networkLatency) {
            alerts.push(`网络延迟过高: ${metrics.networkLatency.toFixed(2)}ms > ${this.thresholds.networkLatency}ms`);
        }
        
        if (metrics.responseTime > this.thresholds.responseTime) {
            alerts.push(`响应时间过长: ${metrics.responseTime.toFixed(2)}ms > ${this.thresholds.responseTime}ms`);
        }
        
        if (metrics.errorRate > this.thresholds.errorRate) {
            alerts.push(`错误率过高: ${(metrics.errorRate * 100).toFixed(2)}% > ${(this.thresholds.errorRate * 100).toFixed(2)}%`);
        }
        
        if (alerts.length > 0) {
            this.logger.logWarning('性能监控', '检测到性能问题', { alerts, metrics });
        }
    }
    
    /**
     * 获取当前性能指标
     */
    public getCurrentMetrics(): PerformanceMetrics | undefined {
        if (this.metrics.length === 0) {
            return undefined;
        }
        return this.metrics[this.metrics.length - 1];
    }
    
    /**
     * 获取性能指标历史
     */
    public getMetricsHistory(limit: number = 100): PerformanceMetrics[] {
        return this.metrics.slice(-limit);
    }
    
    /**
     * 获取性能趋势
     */
    public getPerformanceTrend(hours: number = 24): {
        cpuUsage: number[];
        memoryUsage: number[];
        networkLatency: number[];
        timestamps: Date[];
    } {
        const now = new Date();
        const cutoff = new Date(now.getTime() - hours * 60 * 60 * 1000);
        
        const recentMetrics = this.metrics.filter(m => m.timestamp >= cutoff);
        
        return {
            cpuUsage: recentMetrics.map(m => m.cpuUsage),
            memoryUsage: recentMetrics.map(m => m.memoryUsage),
            networkLatency: recentMetrics.map(m => m.networkLatency),
            timestamps: recentMetrics.map(m => m.timestamp)
        };
    }
    
    /**
     * 获取性能统计
     */
    public getPerformanceStats(): {
        averageCpuUsage: number;
        averageMemoryUsage: number;
        averageNetworkLatency: number;
        peakCpuUsage: number;
        peakMemoryUsage: number;
        peakNetworkLatency: number;
    } {
        if (this.metrics.length === 0) {
            return {
                averageCpuUsage: 0,
                averageMemoryUsage: 0,
                averageNetworkLatency: 0,
                peakCpuUsage: 0,
                peakMemoryUsage: 0,
                peakNetworkLatency: 0
            };
        }
        
        const cpuUsage = this.metrics.map(m => m.cpuUsage);
        const memoryUsage = this.metrics.map(m => m.memoryUsage);
        const networkLatency = this.metrics.map(m => m.networkLatency);
        
        return {
            averageCpuUsage: cpuUsage.reduce((sum, val) => sum + val, 0) / cpuUsage.length,
            averageMemoryUsage: memoryUsage.reduce((sum, val) => sum + val, 0) / memoryUsage.length,
            averageNetworkLatency: networkLatency.reduce((sum, val) => sum + val, 0) / networkLatency.length,
            peakCpuUsage: Math.max(...cpuUsage),
            peakMemoryUsage: Math.max(...memoryUsage),
            peakNetworkLatency: Math.max(...networkLatency)
        };
    }
    
    /**
     * 检查系统健康状态
     */
    public getSystemHealth(): {
        status: 'healthy' | 'warning' | 'critical';
        issues: string[];
        recommendations: string[];
    } {
        const currentMetrics = this.getCurrentMetrics();
        if (!currentMetrics) {
            return {
                status: 'healthy',
                issues: [],
                recommendations: []
            };
        }
        
        const issues: string[] = [];
        const recommendations: string[] = [];
        
        if (currentMetrics.cpuUsage > this.thresholds.cpuUsage) {
            issues.push('CPU使用率过高');
            recommendations.push('考虑优化代码逻辑或增加计算资源');
        }
        
        if (currentMetrics.memoryUsage > this.thresholds.memoryUsage) {
            issues.push('内存使用率过高');
            recommendations.push('检查内存泄漏或增加内存资源');
        }
        
        if (currentMetrics.networkLatency > this.thresholds.networkLatency) {
            issues.push('网络延迟过高');
            recommendations.push('检查网络连接或优化网络请求');
        }
        
        let status: 'healthy' | 'warning' | 'critical' = 'healthy';
        
        if (issues.length > 2) {
            status = 'critical';
        } else if (issues.length > 0) {
            status = 'warning';
        }
        
        return { status, issues, recommendations };
    }
    
    /**
     * 清理历史数据
     */
    public clearHistory(): void {
        this.metrics = [];
        this.logger.logTaskException('性能监控', '历史数据已清理', '性能指标历史记录已清空');
    }
    
    /**
     * 导出性能数据
     */
    public exportMetrics(): PerformanceMetrics[] {
        return [...this.metrics];
    }
}
