import http from 'http';
import { URL } from 'url';
import { logManager } from './LogManager';
import { log } from './Logger';

interface LogServerConfig {
    port: number;
    enabled: boolean;
}

class LogServer {
    private server: http.Server | null = null;
    private config: LogServerConfig;

    constructor(config: LogServerConfig) {
        this.config = config;
    }

    start(): void {
        if (!this.config.enabled) {
            log('main', '日志服务器', '日志服务器已禁用', 'warn');
            return;
        }

        this.server = http.createServer((req, res) => {
            this.handleRequest(req, res);
        });

        this.server.listen(this.config.port, () => {
            log('main', '日志服务器', `日志服务器已启动，监听端口 ${this.config.port}`);
        });

        this.server.on('error', (error) => {
            log('main', '日志服务器', `服务器错误: ${error.message}`, 'error');
        });
    }

    stop(): void {
        if (this.server) {
            this.server.close(() => {
                log('main', '日志服务器', '日志服务器已停止');
            });
            this.server = null;
        }
    }

    private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
        // 设置CORS头
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        // 处理预检请求
        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        try {
            const url = new URL(req.url || '/', `http://${req.headers.host}`);
            const pathname = url.pathname;

            // 设置响应头
            res.setHeader('Content-Type', 'application/json; charset=utf-8');

            switch (pathname) {
                case '/logs':
                    this.handleGetLogs(req, res, url);
                    break;
                case '/logs/recent':
                    this.handleGetRecentLogs(req, res, url);
                    break;
                case '/logs/stats':
                    this.handleGetLogStats(req, res);
                    break;
                case '/logs/search':
                    this.handleSearchLogs(req, res, url);
                    break;
                case '/logs/clear':
                    this.handleClearLogs(req, res);
                    break;
                default:
                    this.handleNotFound(res);
                    break;
            }
        } catch (error) {
            this.handleError(res, error);
        }
    }

    private handleGetLogs(req: http.IncomingMessage, res: http.ServerResponse, url: URL): void {
        const level = url.searchParams.get('level') as 'log' | 'warn' | 'error' | null;
        const title = url.searchParams.get('title');
        const limit = parseInt(url.searchParams.get('limit') || '100');

        let logs = logManager.getAllLogs();

        if (level) {
            logs = logs.filter(log => log.level === level);
        }

        if (title) {
            logs = logs.filter(log => log.title.toLowerCase().includes(title.toLowerCase()));
        }

        if (limit > 0) {
            logs = logs.slice(-limit);
        }

        res.writeHead(200);
        res.end(JSON.stringify({
            success: true,
            data: logs,
            count: logs.length
        }));
    }

    private handleGetRecentLogs(req: http.IncomingMessage, res: http.ServerResponse, url: URL): void {
        const limit = parseInt(url.searchParams.get('limit') || '100');
        const logs = logManager.getRecentLogs(limit);

        res.writeHead(200);
        res.end(JSON.stringify({
            success: true,
            data: logs,
            count: logs.length
        }));
    }

    private handleGetLogStats(req: http.IncomingMessage, res: http.ServerResponse): void {
        const stats = logManager.getLogStats();

        res.writeHead(200);
        res.end(JSON.stringify({
            success: true,
            data: stats
        }));
    }

    private handleSearchLogs(req: http.IncomingMessage, res: http.ServerResponse, url: URL): void {
        const query = url.searchParams.get('q');
        
        if (!query) {
            res.writeHead(400);
            res.end(JSON.stringify({
                success: false,
                error: '搜索查询参数 q 是必需的'
            }));
            return;
        }

        const logs = logManager.searchLogs(query);

        res.writeHead(200);
        res.end(JSON.stringify({
            success: true,
            data: logs,
            count: logs.length,
            query
        }));
    }

    private handleClearLogs(req: http.IncomingMessage, res: http.ServerResponse): void {
        if (req.method !== 'POST') {
            res.writeHead(405);
            res.end(JSON.stringify({
                success: false,
                error: '只支持 POST 方法'
            }));
            return;
        }

        logManager.clearLogs();

        res.writeHead(200);
        res.end(JSON.stringify({
            success: true,
            message: '日志已清空'
        }));
    }

    private handleNotFound(res: http.ServerResponse): void {
        res.writeHead(404);
        res.end(JSON.stringify({
            success: false,
            error: '接口不存在',
            availableEndpoints: [
                'GET /logs - 获取所有日志',
                'GET /logs/recent - 获取最近日志',
                'GET /logs/stats - 获取日志统计',
                'GET /logs/search?q=关键词 - 搜索日志',
                'POST /logs/clear - 清空日志'
            ]
        }));
    }

    private handleError(res: http.ServerResponse, error: any): void {
        res.writeHead(500);
        res.end(JSON.stringify({
            success: false,
            error: error.message || '服务器内部错误'
        }));
    }
}

export { LogServer };
