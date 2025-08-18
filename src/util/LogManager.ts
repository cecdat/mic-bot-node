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
    private maxLogs: number = 1000; // 最大保存日志条数
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

        this.logs.push(logEntry);

        // 保持日志数量在限制范围内
        if (this.logs.length > this.maxLogs) {
            this.logs = this.logs.slice(-this.maxLogs);
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
    }

    /**
     * 获取日志统计信息
     */
    getLogStats(): {
        total: number;
        byLevel: { log: number; warn: number; error: number };
        byPlatform: { [key: string]: number };
    } {
        const byLevel = { log: 0, warn: 0, error: 0 };
        const byPlatform: { [key: string]: number } = {};

        this.logs.forEach(log => {
            byLevel[log.level]++;
            byPlatform[log.platform] = (byPlatform[log.platform] || 0) + 1;
        });

        return {
            total: this.logs.length,
            byLevel,
            byPlatform
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
