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
