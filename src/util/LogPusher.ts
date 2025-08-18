import axios from 'axios';
import { log } from './Logger';
import { logManager } from './LogManager';

interface LogPushConfig {
    enabled: boolean;
    serverUrl: string;
    token: string;
    interval: number;
}

class LogPusher {
    private config: LogPushConfig;
    private intervalId: NodeJS.Timeout | null = null;
    private isRunning = false;

    constructor(config: LogPushConfig) {
        this.config = config;
    }

    start(): void {
        if (!this.config.enabled || this.isRunning) {
            return;
        }

        if (!this.config.serverUrl || !this.config.token) {
            log('main', '日志推送', '日志推送配置不完整，跳过启动', 'warn');
            return;
        }

        this.isRunning = true;
        this.intervalId = setInterval(() => {
            this.pushLogs();
        }, this.config.interval * 1000);

        log('main', '日志推送', `日志推送服务已启动，推送间隔: ${this.config.interval}秒`);
    }

    stop(): void {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.isRunning = false;
        log('main', '日志推送', '日志推送服务已停止');
    }

    private async pushLogs(): Promise<void> {
        try {
            // 获取最近的日志
            const logs = logManager.getRecentLogs(100);
            
            if (logs.length === 0) {
                return; // 没有日志需要推送
            }

            // 准备推送数据
            const pushData = {
                logs: logs.map(log => ({
                    id: log.id,
                    timestamp: log.timestamp,
                    level: log.level,
                    platform: log.platform,
                    title: log.title,
                    message: log.message,
                    pid: log.pid
                }))
            };

            // 发送到Service端
            const response = await axios.post(this.config.serverUrl, pushData, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.config.token}`
                },
                timeout: 10000 // 10秒超时
            });

            if (response.status === 200) {
                log('main', '日志推送', `成功推送 ${logs.length} 条日志到Service端`);
            } else {
                log('main', '日志推送', `推送日志失败，状态码: ${response.status}`, 'warn');
            }

        } catch (error: any) {
            log('main', '日志推送', `推送日志失败: ${error.message}`, 'error');
        }
    }

    // 手动推送日志（用于重要日志的即时推送）
    async pushImportantLogs(): Promise<void> {
        if (!this.config.enabled || !this.isRunning) {
            return;
        }

        try {
            // 获取最近的错误和警告日志
            const allLogs = logManager.getRecentLogs(50);
            const importantLogs = allLogs.filter(log => log.level === 'error' || log.level === 'warn');

            if (importantLogs.length === 0) {
                return;
            }

            const pushData = {
                logs: importantLogs.map(log => ({
                    id: log.id,
                    timestamp: log.timestamp,
                    level: log.level,
                    platform: log.platform,
                    title: log.title,
                    message: log.message,
                    pid: log.pid
                }))
            };

            await axios.post(this.config.serverUrl, pushData, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.config.token}`
                },
                timeout: 5000 // 5秒超时
            });

            log('main', '日志推送', `成功推送 ${importantLogs.length} 条重要日志到Service端`);

        } catch (error: any) {
            log('main', '日志推送', `推送重要日志失败: ${error.message}`, 'error');
        }
    }

    updateConfig(newConfig: LogPushConfig): void {
        const wasRunning = this.isRunning;
        
        if (wasRunning) {
            this.stop();
        }

        this.config = newConfig;

        if (wasRunning && this.config.enabled) {
            this.start();
        }
    }
}

export { LogPusher };
