interface LogEntry {
    id: string;
    timestamp: string;
    level: 'log' | 'warn' | 'error';
    platform: string;
    title: string;
    message: string;
    pid: number;
}

class LogManager {
    private logs: LogEntry[] = [];
    private maxLogs: number = 5000; // 增加最大保存日志条数
    private maxLogSize: number = 40 * 1024 * 1024; // 40MB 最大日志大小
    private currentLogSize: number = 0; // 当前日志大小
    private logIdCounter: number = 0;
    private listeners: ((logEntry: LogEntry) => void)[] = [];

    /**
     * 添加日志条目
     */
    addLog(level: 'log' | 'warn' | 'error', platform: string, title: string, message: string, pid: number): void {
        const logEntry: LogEntry = {
            id: (++this.logIdCounter).toString(),
            timestamp: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }),
            level,
            platform,
            title,
            message,
            pid
        };

        // 估算日志条目大小（JSON字符串长度）
        const logEntrySize = JSON.stringify(logEntry).length;
        
        // 检查是否超过大小限制
        if (this.currentLogSize + logEntrySize > this.maxLogSize) {
            this.rotateLogs();
        }

        this.logs.push(logEntry);
        this.currentLogSize += logEntrySize;

        // 保持日志数量在限制范围内
        if (this.logs.length > this.maxLogs) {
            this.logs.splice(0, this.logs.length - this.maxLogs);
            // 重新计算大小
            this.currentLogSize = this.logs.reduce((size, log) => size + JSON.stringify(log).length, 0);
        }

        // 通知所有监听器
        this.listeners.forEach(listener => {
            try {
                listener(logEntry);
            } catch (error) {
                console.error('日志监听器错误:', error);
            }
        });
    }

    /**
     * 日志轮转：清理旧日志以保持大小在限制内
     */
    private rotateLogs(): void {
        // 清理最旧的日志，直到大小低于限制的80%
        const targetSize = this.maxLogSize * 0.8;
        
        while (this.currentLogSize > targetSize && this.logs.length > 0) {
            const removedLog = this.logs.shift();
            if (removedLog) {
                this.currentLogSize -= JSON.stringify(removedLog).length;
            }
        }
    }

    /**
     * 获取当前日志大小（MB）
     */
    getCurrentLogSizeMB(): number {
        return Math.round(this.currentLogSize / (1024 * 1024) * 100) / 100;
    }

    /**
     * 添加日志监听器
     */
    addListener(listener: (logEntry: LogEntry) => void): void {
        this.listeners.push(listener);
    }

    /**
     * 移除日志监听器
     */
    removeListener(listener: (logEntry: LogEntry) => void): void {
        const index = this.listeners.indexOf(listener);
        if (index > -1) {
            this.listeners.splice(index, 1);
        }
    }

    /**
     * 获取所有日志
     */
    getAllLogs(): LogEntry[] {
        return [...this.logs];
    }

    /**
     * 获取最近的日志
     */
    getRecentLogs(limit: number = 100): LogEntry[] {
        return this.logs.slice(-limit);
    }

    /**
     * 根据级别过滤日志
     */
    getLogsByLevel(level: 'log' | 'warn' | 'error'): LogEntry[] {
        return this.logs.filter(log => log.level === level);
    }

    /**
     * 根据标题过滤日志
     */
    getLogsByTitle(title: string): LogEntry[] {
        return this.logs.filter(log => log.title.toLowerCase().includes(title.toLowerCase()));
    }

    /**
     * 清空日志
     */
    clearLogs(): void {
        this.logs = [];
        this.logIdCounter = 0;
        this.currentLogSize = 0; // 清空当前日志大小
    }

    /**
     * 获取日志统计信息
     */
    getLogStats(): { totalLogs: number; currentSizeMB: number; maxSizeMB: number } {
        return {
            totalLogs: this.logs.length,
            currentSizeMB: this.getCurrentLogSizeMB(),
            maxSizeMB: Math.round(this.maxLogSize / (1024 * 1024))
        };
    }

    /**
     * 搜索日志
     */
    searchLogs(query: string): LogEntry[] {
        const lowerQuery = query.toLowerCase();
        return this.logs.filter(log => 
            log.message.toLowerCase().includes(lowerQuery) ||
            log.title.toLowerCase().includes(lowerQuery) ||
            log.platform.toLowerCase().includes(lowerQuery)
        );
    }
}

export const logManager = new LogManager();
