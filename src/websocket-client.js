/**
 * mic-bot-node WebSocket客户端
 * 用于实时状态同步（可选功能）
 */
const io = require('socket.io-client');

class NodeWebSocketClient {
    constructor(config) {
        this.config = config;
        this.socket = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 3;
        this.reconnectInterval = 10000; // 10秒
    }

    /**
     * 初始化WebSocket连接
     */
    init() {
        if (!this.config.apiServer || !this.config.apiServer.enabled) {
            console.log('WebSocket: API服务器未启用，跳过WebSocket连接');
            return;
        }

        try {
            const serverUrl = this.config.apiServer.updateUrl;
            this.socket = io(serverUrl, {
                auth: {
                    token: this.config.apiServer.token,
                    nodeName: this.config.apiServer.nodeName
                },
                transports: ['websocket', 'polling']
            });

            this.setupEventListeners();
            console.log('🔌 WebSocket客户端初始化完成');
        } catch (error) {
            console.error('❌ WebSocket初始化失败:', error);
        }
    }

    /**
     * 设置事件监听器
     */
    setupEventListeners() {
        this.socket.on('connect', () => {
            console.log('✅ WebSocket连接成功');
            this.isConnected = true;
            this.reconnectAttempts = 0;
            this.notifyNodeReady();
        });

        this.socket.on('disconnect', () => {
            console.log('❌ WebSocket连接断开');
            this.isConnected = false;
            this.scheduleReconnect();
        });

        this.socket.on('connect_error', (error) => {
            console.error('❌ WebSocket连接错误:', error);
            this.scheduleReconnect();
        });

        this.socket.on('error', (error) => {
            console.error('❌ WebSocket错误:', error);
        });

        this.socket.on('node_ready_confirmed', (data) => {
            console.log('✅ 节点准备就绪确认:', data);
        });

        this.socket.on('new_task', (data) => {
            console.log('📋 收到新任务:', data);
            this.handleNewTask(data);
        });

        this.socket.on('task_status_broadcast', (data) => {
            console.log('📊 任务状态广播:', data);
        });

        this.socket.on('task_completed_broadcast', (data) => {
            console.log('✅ 任务完成广播:', data);
        });
    }

    /**
     * 发送状态更新
     */
    emitStatusUpdate(status, isTaskRunning) {
        if (this.socket && this.isConnected) {
            this.socket.emit('node_status_update', {
                activity_status: status,
                isTaskRunning: isTaskRunning,
                timestamp: new Date().toISOString()
            });
            console.log(`📊 WebSocket发送状态更新: ${status}`);
        }
    }

    /**
     * 发送心跳
     */
    emitHeartbeat() {
        if (this.socket && this.isConnected) {
            this.socket.emit('node_heartbeat', {
                node_name: this.config.apiServer.nodeName,
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * 通知节点准备就绪
     */
    notifyNodeReady() {
        if (this.socket && this.isConnected) {
            this.socket.emit('node_ready', {
                node_name: this.config.apiServer.nodeName,
                timestamp: new Date().toISOString()
            });
            console.log('📡 已通知服务端节点准备就绪');
        }
    }

    /**
     * 处理新任务
     */
    handleNewTask(data) {
        const { task_id, command, command_data, node_id, node_name } = data;
        
        console.log(`📋 开始执行任务: ${task_id} (${command})`);
        
        // 发送任务状态更新
        this.emitTaskStatusUpdate(task_id, 'received', node_name);
        
        // 这里需要调用实际的任务执行逻辑
        // 由于这是Node.js环境，需要与主进程通信
        if (typeof process !== 'undefined' && process.send) {
            process.send({
                type: 'websocket_task',
                task_id: task_id,
                command: command,
                command_data: command_data,
                node_id: node_id,
                node_name: node_name
            });
        } else {
            console.log('⚠️ 无法执行任务：不在子进程环境中');
            this.emitTaskStatusUpdate(task_id, 'error', node_name, { error: 'Not in child process' });
        }
    }

    /**
     * 发送任务状态更新
     */
    emitTaskStatusUpdate(taskId, status, nodeName, result = null) {
        if (this.socket && this.isConnected) {
            this.socket.emit('task_status_update', {
                task_id: taskId,
                status: status,
                node_name: nodeName,
                result: result,
                timestamp: new Date().toISOString()
            });
            console.log(`📊 已发送任务状态更新: ${taskId} -> ${status}`);
        }
    }

    /**
     * 发送任务完成通知
     */
    emitTaskCompleted(taskId, nodeName, result = {}) {
        if (this.socket && this.isConnected) {
            this.socket.emit('task_completed', {
                task_id: taskId,
                node_name: nodeName,
                result: result,
                timestamp: new Date().toISOString()
            });
            console.log(`✅ 已发送任务完成通知: ${taskId}`);
        }
    }

    /**
     * 安排重连
     */
    scheduleReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`🔄 WebSocket尝试重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
            
            setTimeout(() => {
                this.init();
            }, this.reconnectInterval);
        } else {
            console.log('❌ WebSocket达到最大重连次数，停止重连');
        }
    }

    /**
     * 销毁连接
     */
    destroy() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
        this.isConnected = false;
        console.log('🔌 WebSocket连接已销毁');
    }
}

module.exports = NodeWebSocketClient;
