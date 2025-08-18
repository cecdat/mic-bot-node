import * as http from 'http';
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

        this.server.on('error', (error: any) => {
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

            switch (pathname) {
                case '/logs/stream':
                    this.handleLogStream(req, res, url);
                    break;
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
                case '/':
                    this.handleRoot(req, res);
                    break;
                default:
                    this.handleNotFound(res);
                    break;
            }
        } catch (error) {
            this.handleError(res, error);
        }
    }

    private handleLogStream(req: http.IncomingMessage, res: http.ServerResponse, url: URL): void {
        // 设置SSE响应头
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Cache-Control'
        });

        // 发送初始连接消息
        res.write('data: {"type":"connected","message":"日志流已连接"}\n\n');

        // 获取过滤参数
        const level = url.searchParams.get('level') as 'log' | 'warn' | 'error' | null;
        const title = url.searchParams.get('title');
        const limit = parseInt(url.searchParams.get('limit') || '100');

        // 发送历史日志
        let logs = logManager.getRecentLogs(limit);
        
        if (level) {
            logs = logs.filter(log => log.level === level);
        }
        
        if (title) {
            logs = logs.filter(log => log.title.toLowerCase().includes(title.toLowerCase()));
        }

        // 发送历史日志
        for (const log of logs) {
            const logData = {
                type: 'log',
                data: log
            };
            res.write(`data: ${JSON.stringify(logData)}\n\n`);
        }

        // 设置定时器发送心跳
        const heartbeatInterval = setInterval(() => {
            if (!res.destroyed) {
                res.write('data: {"type":"heartbeat","timestamp":"' + new Date().toISOString() + '"}\n\n');
            }
        }, 30000); // 30秒心跳

        // 监听连接关闭
        req.on('close', () => {
            clearInterval(heartbeatInterval);
            log('main', '日志服务器', '客户端断开连接');
        });

        // 监听日志管理器的新日志事件
        const logListener = (logEntry: any) => {
            if (!res.destroyed) {
                // 应用过滤条件
                if (level && logEntry.level !== level) return;
                if (title && !logEntry.title.toLowerCase().includes(title.toLowerCase())) return;
                
                const logData = {
                    type: 'log',
                    data: logEntry
                };
                res.write(`data: ${JSON.stringify(logData)}\n\n`);
            }
        };

        // 注册日志监听器
        logManager.addListener(logListener);

        // 连接关闭时移除监听器
        req.on('close', () => {
            logManager.removeListener(logListener);
        });
    }

    private handleRoot(req: http.IncomingMessage, res: http.ServerResponse): void {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mic-Bot Node 日志查看器</title>
    <style>
        body {
            font-family: 'Courier New', monospace;
            background-color: #1e1e1e;
            color: #d4d4d4;
            margin: 0;
            padding: 20px;
            overflow-x: auto;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        .header {
            background-color: #2d2d2d;
            padding: 15px;
            border-radius: 5px;
            margin-bottom: 20px;
        }
        .controls {
            display: flex;
            gap: 10px;
            margin-bottom: 15px;
            flex-wrap: wrap;
        }
        .control-group {
            display: flex;
            align-items: center;
            gap: 5px;
        }
        select, input, button {
            padding: 8px 12px;
            border: 1px solid #555;
            border-radius: 3px;
            background-color: #3c3c3c;
            color: #d4d4d4;
            font-family: inherit;
        }
        button {
            cursor: pointer;
            background-color: #0078d4;
            border-color: #0078d4;
        }
        button:hover {
            background-color: #106ebe;
        }
        .log-container {
            background-color: #2d2d2d;
            border-radius: 5px;
            padding: 15px;
            height: 600px;
            overflow-y: auto;
            font-size: 14px;
            line-height: 1.4;
        }
        .log-entry {
            margin-bottom: 8px;
            padding: 5px;
            border-radius: 3px;
            border-left: 3px solid #555;
        }
        .log-entry.log { border-left-color: #4CAF50; }
        .log-entry.warn { border-left-color: #FF9800; }
        .log-entry.error { border-left-color: #F44336; }
        .log-timestamp {
            color: #888;
            font-size: 12px;
        }
        .log-level {
            font-weight: bold;
            margin: 0 5px;
        }
        .log-level.log { color: #4CAF50; }
        .log-level.warn { color: #FF9800; }
        .log-level.error { color: #F44336; }
        .log-platform {
            color: #9CDCFE;
            margin: 0 5px;
        }
        .log-title {
            color: #DCDCAA;
            margin: 0 5px;
        }
        .log-message {
            color: #d4d4d4;
            margin-left: 10px;
        }
        .status {
            color: #888;
            font-size: 12px;
            margin-top: 10px;
        }
        .clear-btn {
            background-color: #d32f2f;
            border-color: #d32f2f;
        }
        .clear-btn:hover {
            background-color: #b71c1c;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Mic-Bot Node 日志查看器</h1>
            <div class="controls">
                <div class="control-group">
                    <label>日志级别:</label>
                    <select id="levelFilter">
                        <option value="">全部</option>
                        <option value="log">信息</option>
                        <option value="warn">警告</option>
                        <option value="error">错误</option>
                    </select>
                </div>
                <div class="control-group">
                    <label>标题过滤:</label>
                    <input type="text" id="titleFilter" placeholder="输入标题关键词">
                </div>
                <div class="control-group">
                    <label>显示条数:</label>
                    <select id="limitFilter">
                        <option value="50">50条</option>
                        <option value="100" selected>100条</option>
                        <option value="200">200条</option>
                        <option value="500">500条</option>
                    </select>
                </div>
                <button onclick="connectStream()">连接流</button>
                <button onclick="clearLogs()" class="clear-btn">清空日志</button>
            </div>
            <div class="status" id="status">未连接</div>
        </div>
        <div class="log-container" id="logContainer">
            <div>等待连接日志流...</div>
        </div>
    </div>

    <script>
        let eventSource = null;
        let logCount = 0;

        function connectStream() {
            if (eventSource) {
                eventSource.close();
            }

            const level = document.getElementById('levelFilter').value;
            const title = document.getElementById('titleFilter').value;
            const limit = document.getElementById('limitFilter').value;

            let url = '/logs/stream';
            const params = new URLSearchParams();
            if (level) params.append('level', level);
            if (title) params.append('title', title);
            if (limit) params.append('limit', limit);
            
            if (params.toString()) {
                url += '?' + params.toString();
            }

            eventSource = new EventSource(url);
            
            eventSource.onopen = function() {
                document.getElementById('status').textContent = '已连接 - 实时接收日志';
                document.getElementById('logContainer').innerHTML = '';
                logCount = 0;
            };

            eventSource.onmessage = function(event) {
                try {
                    const data = JSON.parse(event.data);
                    
                    if (data.type === 'connected') {
                        console.log('日志流已连接');
                    } else if (data.type === 'heartbeat') {
                        // 心跳消息，可以更新状态
                        document.getElementById('status').textContent = '已连接 - 实时接收日志 (最后心跳: ' + new Date().toLocaleTimeString() + ')';
                    } else if (data.type === 'log') {
                        addLogEntry(data.data);
                    }
                } catch (e) {
                    console.error('解析日志数据失败:', e);
                }
            };

            eventSource.onerror = function(event) {
                document.getElementById('status').textContent = '连接错误 - 请检查网络连接';
                console.error('EventSource 错误:', event);
            };
        }

        function addLogEntry(log) {
            const container = document.getElementById('logContainer');
            const logEntry = document.createElement('div');
            logEntry.className = 'log-entry ' + log.level;
            
            logEntry.innerHTML = \`
                <span class="log-timestamp">[\${log.timestamp}]</span>
                <span class="log-level \${log.level}">[\${log.level.toUpperCase()}]</span>
                <span class="log-platform">[\${log.platform}]</span>
                <span class="log-title">[\${log.title}]</span>
                <div class="log-message">\${log.message}</div>
            \`;
            
            container.appendChild(logEntry);
            container.scrollTop = container.scrollHeight;
            
            logCount++;
            if (logCount > 1000) {
                // 保持最多1000条日志
                container.removeChild(container.firstChild);
                logCount--;
            }
        }

        function clearLogs() {
            if (confirm('确定要清空所有日志吗？')) {
                fetch('/logs/clear', { method: 'POST' })
                    .then(response => response.json())
                    .then(data => {
                        if (data.success) {
                            document.getElementById('logContainer').innerHTML = '<div>日志已清空</div>';
                            logCount = 0;
                        }
                    })
                    .catch(error => {
                        console.error('清空日志失败:', error);
                    });
            }
        }

        // 页面加载时自动连接
        window.onload = function() {
            connectStream();
        };

        // 页面卸载时关闭连接
        window.onbeforeunload = function() {
            if (eventSource) {
                eventSource.close();
            }
        };
    </script>
</body>
</html>
        `);
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

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
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
