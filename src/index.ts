import { exec, ExecException, fork, ChildProcess } from 'child_process';
import * as playwright from 'playwright';
import fs from 'fs';
import path from 'path';
import { Page, Browser as PlaywrightBrowser } from 'rebrowser-playwright';
import Browser from './browser/Browser';
import BrowserFunc from './browser/BrowserFunc';
import BrowserUtil from './browser/BrowserUtil';
import { log } from './util/Logger';
import Util from './util/Utils';
import { loadAccounts, loadConfig, loadNodeConfig, loadDailyPoints, saveDailyPoints, DailyPoints } from './util/Load';

import { LogPusher } from './util/LogPusher';
import { accountStatusManager } from './util/AccountStatusManager';
import { aiOrchestrator } from './util/AIOrcestrator';
import { Login } from './functions/Login';
import { Workers } from './functions/Workers';
import Activities from './functions/Activities';
import { LoginExceptionHandlerManager } from './handlers/LoginExceptionHandlerManager';
import { PageExceptionDetector, PageExceptionResult } from './handlers/PageExceptionDetector';
import { Account } from './interface/Account';
import Axios from './util/Axios';
import axios from 'axios';
import { Config } from './interface/Config'; 

// 添加全局变量跟踪任务运行状态
let isTaskRunning = false;
let shouldStopTask = false;
let lastConfirmedCommand: string | null = null;

// 任务执行隔离机制
let taskExecutionLock = false; // 防止重复执行任务
let taskExecutionQueue: any[] = []; // 任务执行队列

// 添加服务端状态跟踪
let serverOffline = false;
let lastServerErrorTime = 0;

// 添加全局错误抑制机制
let lastHeartbeatErrorTime = 0;
let lastStatusSyncErrorTime = 0;
let lastHeartbeatSuccessTime = 0;
const ERROR_SUPPRESS_INTERVAL = 30000; // 30秒错误抑制间隔
const HEARTBEAT_SUCCESS_INTERVAL = 300000; // 5分钟心跳成功日志间隔

// 添加精准状态跟踪
let lastStatusUpdateTime = 0;
let statusUpdateInterval: NodeJS.Timeout | null = null;
let lastReportedStatus: 'Running' | 'Idle' = 'Idle';

// 添加WebSocket任务调度支持
let wsClient: any = null;
let useWebSocketScheduling = false;
let globalWebSocketTask: any = null;
let lastWebSocketErrorTime = 0;
let webSocketRecoveryCheckInterval: NodeJS.Timeout | null = null;

// WebSocket客户端类定义
class NodeWebSocketClient {
    private config: any;
    private socket: any = null;
    private isConnected: boolean = false;
    private reconnectAttempts: number = 0;
    private maxReconnectAttempts: number = 3; // 减少重连次数，与服务端保持一致
    private reconnectInterval: number = 10000; // 基础间隔10秒，与服务端保持一致
    private maxReconnectInterval: number = 300000; // 最大间隔5分钟
    private isReconnecting: boolean = false; // 防止重复重连
    private messageQueue: any[] = []; // 消息队列
    private maxQueueSize: number = 50; // 最大队列大小
    private heartbeatInterval: number = 120000; // 心跳间隔2分钟，与服务端保持一致
    private heartbeatTimer: NodeJS.Timeout | null = null; // 心跳定时器
    private lastErrorTime: number = 0; // 上次错误时间
    private errorSuppressInterval: number = 30000; // 错误抑制间隔30秒

    constructor(config: any) {
        this.config = config;
    }

    /**
     * 检查是否应该抑制错误日志
     */
    private shouldSuppressError(): boolean {
        const now = Date.now();
        if (now - this.lastErrorTime < this.errorSuppressInterval) {
            return true;
        }
        this.lastErrorTime = now;
        return false;
    }

    /**
     * 初始化WebSocket连接
     */
    init() {
        if (!this.config.apiServer || !this.config.apiServer.enabled) {
            log('main', 'WebSocket', 'API服务器未启用，跳过WebSocket连接');
            return;
        }

        // 如果已经连接或正在连接，跳过
        if (this.isConnected || (this.socket && this.socket.connected)) {
            log('main', 'WebSocket', 'WebSocket已连接，跳过重复初始化');
            return;
        }

        try {
            // 清理旧连接
            if (this.socket) {
                this.socket.disconnect();
                this.socket = null;
            }

            // 动态导入socket.io-client
            const io = require('socket.io-client');
            const serverUrl = this.config.apiServer.updateUrl;
            this.socket = io(serverUrl, {
                auth: {
                    token: this.config.apiServer.token,
                    nodeName: this.config.apiServer.nodeName
                },
                transports: ['polling', 'websocket'], // 与服务端保持一致
                timeout: 30000, // 增加连接超时到30秒
                forceNew: true, // 强制新连接
                reconnection: true,
                reconnectionAttempts: this.maxReconnectAttempts,
                reconnectionDelay: this.reconnectInterval,
                reconnectionDelayMax: this.maxReconnectInterval,
                maxReconnectionAttempts: this.maxReconnectAttempts,
                randomizationFactor: 0.5, // 重连随机化因子
                autoConnect: true,
                multiplex: false, // 禁用多路复用
                forceBase64: false, // 不强制base64编码
                timestampRequests: true, // 启用时间戳请求
                timestampParam: 't',
                policyPort: 843,
                path: '/socket.io/'
            });

            this.setupEventListeners();
            this.startHeartbeat();
            log('main', 'WebSocket', '🔌 WebSocket客户端初始化完成');
        } catch (error) {
            log('main', 'WebSocket', `❌ WebSocket初始化失败: ${error}`, 'error');
            this.scheduleReconnect();
        }
    }

    /**
     * 设置事件监听器
     */
    setupEventListeners() {
        this.socket.on('connect', () => {
            log('main', 'WebSocket', '✅ WebSocket连接成功');
            this.isConnected = true;
            this.reconnectAttempts = 0;
            this.isReconnecting = false;
            this.notifyNodeReady();
            this.processQueue(); // 处理队列中的消息
        });

        this.socket.on('disconnect', () => {
            log('main', 'WebSocket', '❌ WebSocket连接断开');
            this.isConnected = false;
            this.scheduleReconnect();
        });

        this.socket.on('connect_error', (error: any) => {
            if (!this.shouldSuppressError()) {
                log('main', 'WebSocket', `❌ WebSocket连接错误: ${error.message || error}`, 'error');
            }
            this.isConnected = false;
            this.scheduleReconnect();
        });

        this.socket.on('error', (error: any) => {
            if (!this.shouldSuppressError()) {
                log('main', 'WebSocket', `❌ WebSocket错误: ${error.message || error}`, 'error');
            }
            this.isConnected = false;
        });

        this.socket.on('node_ready_confirmed', (data: any) => {
            log('main', 'WebSocket', `✅ 节点准备就绪确认: ${JSON.stringify(data)}`);
        });

        this.socket.on('new_task', (data: any) => {
            log('main', 'WebSocket', `📋 收到新任务: ${JSON.stringify(data)}`);
            // 将任务数据存储到全局变量，让主循环处理
            globalWebSocketTask = data;
            this.emitTaskStatusUpdate(data.task_id, 'received', data.node_name);
        });

        this.socket.on('task_status_broadcast', (data: any) => {
            log('main', 'WebSocket', `📊 任务状态广播: ${JSON.stringify(data)}`);
        });

        this.socket.on('task_completed_broadcast', (data: any) => {
            log('main', 'WebSocket', `✅ 任务完成广播: ${JSON.stringify(data)}`);
        });

        this.socket.on('pong', (data: any) => {
            // 静默处理pong响应，减少日志输出
            // log('main', 'WebSocket', `🏓 收到pong响应: ${JSON.stringify(data)}`);
        });
    }

    /**
     * 安全发送消息，带队列和限流
     */
    safeEmit(event: string, data?: any) {
        if (this.isConnected && this.socket) {
            try {
                this.socket.emit(event, data);
            } catch (error) {
                log('main', 'WebSocket', `❌ 发送消息失败: ${error}`, 'error');
                this.addToQueue(event, data);
            }
        } else {
            this.addToQueue(event, data);
        }
    }

    /**
     * 添加消息到队列
     */
    addToQueue(event: string, data?: any) {
        if (this.messageQueue.length >= this.maxQueueSize) {
            // 队列满了，移除最旧的消息
            this.messageQueue.shift();
        }
        this.messageQueue.push({ event, data, timestamp: Date.now() });
    }

    /**
     * 处理队列中的消息
     */
    processQueue() {
        if (this.messageQueue.length === 0 || !this.isConnected) {
            return;
        }

        const messages = this.messageQueue.splice(0, 10); // 每次处理最多10条消息
        messages.forEach(({ event, data }) => {
            try {
                this.socket.emit(event, data);
            } catch (error) {
                log('main', 'WebSocket', `❌ 处理队列消息失败: ${error}`, 'error');
            }
        });
    }

    /**
     * 开始心跳检测
     */
    startHeartbeat() {
        this.heartbeatTimer = setInterval(() => {
            if (this.socket && this.isConnected) {
                // 静默发送ping，减少日志输出
                this.safeEmit('ping');
            }
        }, this.heartbeatInterval);
    }

    /**
     * 停止心跳检测
     */
    stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    /**
     * 通知节点准备就绪
     */
    notifyNodeReady() {
        this.safeEmit('node_ready', {
            node_name: this.config.apiServer.nodeName,
            timestamp: new Date().toISOString()
        });
        log('main', 'WebSocket', '📡 已通知服务端节点准备就绪');
    }


    /**
     * 发送任务状态更新
     */
    emitTaskStatusUpdate(taskId: string, status: string, nodeName: string, result: any = null) {
        this.safeEmit('task_status_update', {
            task_id: taskId,
            status: status,
            node_name: nodeName,
            result: result,
            timestamp: new Date().toISOString()
        });
        // 静默发送任务状态更新，减少日志输出
        // log('main', 'WebSocket', `📊 已发送任务状态更新: ${taskId} -> ${status}`);
    }

    /**
     * 发送任务完成通知
     */
    emitTaskCompleted(taskId: string, nodeName: string, result: any = {}) {
        this.safeEmit('task_completed', {
            task_id: taskId,
            node_name: nodeName,
            result: result,
            timestamp: new Date().toISOString()
        });
        // 静默发送任务完成通知，减少日志输出
        // log('main', 'WebSocket', `✅ 已发送任务完成通知: ${taskId}`);
    }

    /**
     * 安排重连
     */
    scheduleReconnect() {
        if (this.isReconnecting) {
            return; // 防止重复重连
        }
        
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.isReconnecting = true;
            this.reconnectAttempts++;
            
            // 递增延迟策略：10s, 20s, 30s (与服务端保持一致)
            const delay = Math.min(
                this.reconnectInterval * this.reconnectAttempts,
                this.maxReconnectInterval
            );
            
            // 只在第一次重连时输出日志，后续重连抑制日志
            if (this.reconnectAttempts === 1) {
                log('main', 'WebSocket', `🔄 尝试重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts})，${Math.round(delay/1000)}秒后重试...`);
            }
            
            setTimeout(() => {
                this.isReconnecting = false;
                this.init();
            }, delay);
        } else {
            // 只在达到最大重连次数时输出一次日志
            if (!this.shouldSuppressError()) {
                log('main', 'WebSocket', '❌ 达到最大重连次数，停止重连。将使用HTTP轮询模式', 'warn');
            }
            // 停止WebSocket调度，回退到HTTP轮询
            useWebSocketScheduling = false;
            
            // 记录错误时间，启动服务端恢复检测
            lastWebSocketErrorTime = Date.now();
            startServerRecoveryCheck();
        }
    }

    /**
     * 检查连接状态
     */
    get connected() {
        return this.socket && this.socket.connected;
    }

    /**
     * 销毁连接
     */
    destroy() {
        this.stopHeartbeat();
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
        this.isConnected = false;
        this.isReconnecting = false;
        this.reconnectAttempts = 0;
        this.messageQueue = [];
        log('main', 'WebSocket', '🔌 WebSocket连接已销毁');
    }
}

/**
 * 执行单个任务函数
 */
async function executeSingleTask(taskData: any) {
    // 严格检查当前任务状态，防止与正在执行的任务冲突
    if (isTaskRunning) {
        log('main', '执行单个任务', `❌ 拒绝执行单个任务：当前有任务正在执行中`, 'warn');
        log('main', '执行单个任务', `当前状态: isTaskRunning=${isTaskRunning}, shouldStopTask=${shouldStopTask}`);
        log('main', '执行单个任务', '等待当前任务完成后再接受新的单个任务指令', 'warn');
        // 确认命令已接收但拒绝执行
        await confirmCommandToServer('RUN_TASK');
        return;
    }

    // 状态已在主循环中设置，这里不需要重复设置
    try {
        shouldStopTask = false; // 重置停止标志

        log('main', '执行单个任务', `开始执行任务 ${taskData.task_id}: ${taskData.task_type}`);

        // 对于定时任务，直接调用executeTasks执行完整的任务流程
        await executeTasks();
        log('main', '执行单个任务', `任务 ${taskData.task_id} 执行完成`);
    } catch (error) {
        log('main', '执行单个任务', `执行任务时出错: ${String(error)}`, 'error');
    } finally {
        // 注意：不要在这里重置isTaskRunning，因为任务可能还在执行中
        // isTaskRunning会在主循环中重置
    }
}

/**
 * 任务执行函数
 */
async function executeTasks() {
    // 状态已在主循环中设置，这里不需要重复设置
    const taskResult = {
        success: true,
        account_count: 0,
        total_points: 0,
        accounts: [] as Array<{email: string, points_gained: number, final_points: number}>
    };
    
    try {
        shouldStopTask = false; // 重置停止标志

        const config = loadConfig();
        const accounts = await loadAccounts();
        if (accounts.length > 0) {
            await runHotSearchScript(accounts);
            
            // 严格按账户顺序执行：每个账户先完成桌面端，再完成移动端
            log('main', '主流程', '开始按账户顺序执行任务...');
            
            for (const account of accounts) {
                // 检查是否需要停止
                if (shouldStopTask) {
                    log('main', '主流程', `检测到停止指令，终止账户 ${account.email} 的任务`, 'warn');
                    break;
                }
                
                log('main', '主流程', `开始处理账户: ${account.email}`);
                
                // 获取今日初始积分
                const todayStr = new Util().getYYYYMMDD();
                const dailyPointsData = await loadDailyPoints(config.sessionPath, account.email);
                let initialPointsToday = 0;
                
                if (dailyPointsData && dailyPointsData.date === todayStr) {
                    initialPointsToday = dailyPointsData.initialPoints;
                    log('main', '主流程', `[${account.email}] 使用已保存的今日初始积分: ${initialPointsToday}`);
                } else {
                    log('main', '主流程', `[${account.email}] 未找到今日初始积分记录，将在登录后获取当前积分作为初始值`);
                }
                
                // 先执行桌面端任务
                log('main', '主流程', `账户 ${account.email} 开始执行桌面端任务...`);
                await runTasksForAccounts([account], config, 'desktop');
                log('main', '主流程', `账户 ${account.email} 桌面端任务执行完成`);
                
                // 检查是否需要停止
                if (shouldStopTask) {
                    log('main', '主流程', `检测到停止指令，跳过账户 ${account.email} 的移动端任务`, 'warn');
                    continue;
                }
                
                // 再执行移动端任务
                log('main', '主流程', `账户 ${account.email} 开始执行移动端任务...`);
                await runTasksForAccounts([account], config, 'mobile');
                log('main', '主流程', `账户 ${account.email} 移动端任务执行完成`);
                
                // 获取最终积分并上报
                const finalDailyPointsData = await loadDailyPoints(config.sessionPath, account.email);
                if (finalDailyPointsData && finalDailyPointsData.date === todayStr) {
                    const finalPoints = finalDailyPointsData.desktopFinalPoints || finalDailyPointsData.initialPoints || 0;
                    const dailyGain = initialPointsToday > 0 ? finalPoints - initialPointsToday : 0;
                    
                    log('main', '主流程', `[${account.email}] 积分统计 - 初始: ${initialPointsToday}, 最终: ${finalPoints}, 今日收益: ${dailyGain}`);
                    
                    // 记录账户执行结果
                    taskResult.accounts.push({
                        email: account.email,
                        points_gained: dailyGain,
                        final_points: finalPoints
                    });
                    taskResult.total_points += dailyGain;
                    
                    // 上报积分数据
                    const bot = new MicrosoftRewardsBot();
                    bot.config = config;
                    bot.account = account;
                    bot.axios = new Axios(account.proxy);
                    
                    await sendFinalUpdate(bot, {
                        email: account.email,
                        total_points: finalPoints,
                        daily_gain: dailyGain,
                        desktop_gain: 0, // 子进程执行，无法获取详细收益
                        mobile_gain: 0   // 子进程执行，无法获取详细收益
                    });
                }
                
                log('main', '主流程', `账户 ${account.email} 所有任务执行完成`);
            }
            
            // 更新任务结果
            taskResult.account_count = taskResult.accounts.length;
            log('main', '主流程', '所有账户任务执行完成');
        } else {
            log('main', '主流程', '未获取到分配的账户，本轮任务结束。');
        }

        // 注意：不要在这里重置isTaskRunning，因为任务可能还在执行中
        // isTaskRunning会在主循环中重置
    } catch (error) {
        log('main', '任务执行', `执行任务时出错: ${String(error)}`, 'error');
        taskResult.success = false;
        // 注意：不要在这里重置isTaskRunning，因为任务可能还在执行中
        // isTaskRunning会在主循环中重置
    } finally {
        // 注意：不要在这里重置isTaskRunning，因为任务可能还在执行中
        // isTaskRunning会在任务真正完成时由executeTasks函数重置
        if (shouldStopTask) {
            log('main', '主流程', '检测到停止指令，保持任务运行状态');
        }
    }
    
    return taskResult;
}

/**
 * 任务执行隔离函数 - 确保任务执行不受WebSocket连接状态影响
 */
async function executeTaskIsolated(task: any) {
    // 检查任务执行锁
    if (taskExecutionLock) {
        log('main', '任务隔离', '⚠️ 有任务正在执行中，将任务加入队列', 'warn');
        taskExecutionQueue.push(task);
        return;
    }
    
    // 设置执行锁
    taskExecutionLock = true;
    isTaskRunning = true;
    
    try {
        log('main', '任务隔离', `🚀 开始执行隔离任务: ${task.task_id} (${task.command})`);
        
        // 尝试发送状态更新，但不依赖WebSocket连接
        if (wsClient && wsClient.connected) {
            wsClient.emitTaskStatusUpdate(task.task_id, 'executing', task.node_name);
        }
        // 静默处理WebSocket未连接的情况，减少日志输出
        
        await updateActivityStatus('Running');
        
        // 根据命令类型执行相应任务
        let taskResult = {
            success: true,
            account_count: 0,
            total_points: 0,
            accounts: [] as Array<{email: string, points_gained: number, final_points: number}>
        };
        
        if (task.command === 'RUN_TASKS') {
            taskResult = await executeTasks();
        } else if (task.command === 'RUN_TASK') {
            await executeSingleTask(task.command_data);
        }
        
        // 任务完成 - 尝试发送完成状态，但不依赖WebSocket连接
        if (wsClient && wsClient.connected) {
            wsClient.emitTaskStatusUpdate(task.task_id, 'completed', task.node_name, taskResult);
            wsClient.emitTaskCompleted(task.task_id, task.node_name, taskResult);
        }
        // 静默处理WebSocket未连接的情况，减少日志输出
        
        log('main', '任务隔离', `✅ 隔离任务完成: ${task.task_id}`);
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log('main', '任务隔离', `❌ 隔离任务执行失败: ${errorMessage}`, 'error');
        
        // 尝试发送错误状态，但不依赖WebSocket连接
        if (wsClient && wsClient.connected) {
            wsClient.emitTaskStatusUpdate(task.task_id, 'failed', task.node_name, { error: errorMessage });
        }
        // 静默处理WebSocket未连接的情况，减少日志输出
    } finally {
        // 重置状态
        isTaskRunning = false;
        taskExecutionLock = false;
        await updateActivityStatus('Idle');
        
        // 处理队列中的下一个任务
        if (taskExecutionQueue.length > 0) {
            const nextTask = taskExecutionQueue.shift();
            log('main', '任务隔离', `📋 处理队列中的下一个任务: ${nextTask.task_id}`);
            setTimeout(() => executeTaskIsolated(nextTask), 1000); // 1秒后执行下一个任务
        }
    }
}

/**
 * 启动服务端恢复检测
 */
function startServerRecoveryCheck() {
    if (webSocketRecoveryCheckInterval) {
        return; // 已经在检测中
    }
    
    log('main', 'WebSocket', '🔍 启动服务端恢复检测，每30秒检查一次');
    
    webSocketRecoveryCheckInterval = setInterval(async () => {
        await checkServerRecovery();
    }, 30000); // 每30秒检查一次
}

/**
 * 检查服务端是否恢复
 */
async function checkServerRecovery() {
    try {
        const config = loadConfig();
        const apiConfig = config.apiServer;
        if (!apiConfig || !apiConfig.enabled || !apiConfig.updateUrl) {
            return;
        }
        
        const response = await axios.get(`${apiConfig.updateUrl}bot_api/checkin`, {
            headers: {
                'Authorization': `Bearer ${apiConfig.token}`,
                'Content-Type': 'application/json'
            },
            timeout: 5000
        });
        
        if (response.status === 200) {
            log('main', 'WebSocket', '✅ 检测到服务端已恢复，尝试重新连接WebSocket');
            lastWebSocketErrorTime = 0;
            
            // 重新启用WebSocket调度
            useWebSocketScheduling = true;
            if (wsClient) {
                wsClient.reconnectAttempts = 0; // 重置重连计数
                wsClient.init();
            }
            
            // 停止恢复检测
            if (webSocketRecoveryCheckInterval) {
                clearInterval(webSocketRecoveryCheckInterval);
                webSocketRecoveryCheckInterval = null;
            }
        }
    } catch (error) {
        // 服务端仍未恢复，继续等待
        const timeSinceError = Date.now() - lastWebSocketErrorTime;
        if (timeSinceError > 600000) { // 10分钟后停止检测
            log('main', 'WebSocket', '⏰ 服务端恢复检测超时，停止检测', 'warn');
            if (webSocketRecoveryCheckInterval) {
                clearInterval(webSocketRecoveryCheckInterval);
                webSocketRecoveryCheckInterval = null;
            }
        }
    }
}


// 在文件开头添加内存监控
let memoryMonitorInterval: NodeJS.Timeout | null = null;

// 内存监控函数
function startMemoryMonitoring() {
    memoryMonitorInterval = setInterval(() => {
        const memUsage = process.memoryUsage();
        const heapUsedMB = Math.round(memUsage.heapUsed / (1024 * 1024) * 100) / 100;
        const heapTotalMB = Math.round(memUsage.heapTotal / (1024 * 1024) * 100) / 100;
        
        // 如果内存使用超过800MB，记录警告
        if (heapUsedMB > 800) {
            log('main', '内存监控', `内存使用过高: ${heapUsedMB}MB / ${heapTotalMB}MB`, 'warn');
            
            // 尝试强制垃圾回收
            if (global.gc) {
                global.gc();
                log('main', '内存监控', '已执行强制垃圾回收', 'log');
            }
        }
        
        // 每5分钟记录一次内存使用情况
        if (Date.now() % (5 * 60 * 1000) < 1000) {
            log('main', '内存监控', `当前内存使用: ${heapUsedMB}MB / ${heapTotalMB}MB`, 'log');
        }
    }, 30000); // 每30秒检查一次
}

// 停止内存监控
function stopMemoryMonitoring() {
    if (memoryMonitorInterval) {
        clearInterval(memoryMonitorInterval);
        memoryMonitorInterval = null;
    }
}

async function checkInNode() {
    const config = loadConfig();
    const apiConfig = config.apiServer;
    const utils = new Util();

    if (!apiConfig || !apiConfig.enabled || !apiConfig.updateUrl || !apiConfig.nodeName) {
        log('main', '节点管理', 'API未启用或节点名称未配置，跳过签到。', 'warn');
        return;
    }

    try {
        const checkinUrl = new URL(apiConfig.updateUrl);
        checkinUrl.pathname = '/bot_api/checkin';

        // 确保使用正确的UTC时间戳，不受系统时区影响
        const currentTime = new Date();
        const utcTimestamp = new Date(currentTime.getTime() - currentTime.getTimezoneOffset() * 60000).toISOString();

        const payload: { node_name: string; heartbeat_timeout?: number; activity_status: string; timestamp: string; isTaskRunning: boolean } = {
            node_name: apiConfig.nodeName,
            activity_status: isTaskRunning ? 'Running' : 'Idle',
            timestamp: utcTimestamp,
            isTaskRunning: isTaskRunning
        };
        
        // 只在状态变化时输出详细日志
        if (lastReportedStatus !== payload.activity_status) {
            log('main', '节点管理', `📊 状态变化: ${lastReportedStatus} → ${payload.activity_status}`);
            lastReportedStatus = payload.activity_status as 'Running' | 'Idle';
        }

        if (apiConfig.heartbeatTimeout) {
            payload.heartbeat_timeout = utils.stringToMs(apiConfig.heartbeatTimeout) / 1000;
        }

        // 抑制频繁的心跳发送日志
        const now = Date.now();
        if (now - lastHeartbeatSuccessTime > HEARTBEAT_SUCCESS_INTERVAL) {
            log('main', '节点管理', `📡 向中心服务器签到/发送心跳: ${apiConfig.nodeName}`);
            log('main', '节点管理', `🌐 服务地址: ${checkinUrl.toString()}`);
        }
        
        await axios.post(checkinUrl.toString(), payload, {
            headers: { 'Authorization': `Bearer ${apiConfig.token}` },
            timeout: 30000 // 30秒超时
        });
        
        // 检查服务端是否从离线状态恢复
        if (serverOffline) {
            const offlineDuration = Math.round((Date.now() - lastServerErrorTime) / 1000);
            log('main', '节点管理', `🔄 服务端已恢复！离线时长: ${offlineDuration}秒`, 'warn');
            serverOffline = false;
            lastServerErrorTime = 0;
            lastHeartbeatErrorTime = 0; // 重置错误时间
            lastHeartbeatSuccessTime = 0; // 重置成功时间，允许输出恢复日志
        }
        
        // 抑制频繁的心跳成功日志
        if (now - lastHeartbeatSuccessTime > HEARTBEAT_SUCCESS_INTERVAL) {
            log('main', '节点管理', '✅ 节点签到/心跳成功');
            lastHeartbeatSuccessTime = now;
        }
    } catch (error) {
        let errorMessage: string;
        let logLevel: 'warn' | 'error' = 'warn';
        
        if (axios.isAxiosError(error)) {
            if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
                errorMessage = `请求超时: ${error.message}`;
                logLevel = 'warn';
            } else if (error.response) {
                const status = error.response.status;
                errorMessage = `服务器错误 (${status}): ${JSON.stringify(error.response.data)}`;
                
                // 根据状态码决定日志级别和离线状态
                if (status >= 500) {
                    logLevel = 'warn'; // 服务器错误，可能是临时的
                    // 标记服务端为离线状态
                    if (!serverOffline) {
                        serverOffline = true;
                        lastServerErrorTime = Date.now();
                        log('main', '节点管理', '⚠️ 服务端暂时不可用，进入离线模式', 'warn');
                    }
                } else if (status === 401 || status === 403) {
                    logLevel = 'error'; // 认证错误，需要检查配置
                } else {
                    logLevel = 'warn';
                }
            } else {
                errorMessage = `网络错误: ${error.message}`;
                logLevel = 'warn';
                // 网络错误也标记为离线状态
                if (!serverOffline) {
                    serverOffline = true;
                    lastServerErrorTime = Date.now();
                    log('main', '节点管理', '⚠️ 网络连接异常，进入离线模式', 'warn');
                }
            }
        } else if (error instanceof Error) {
            errorMessage = `客户端错误: ${error.message}`;
            logLevel = 'warn';
        } else {
            errorMessage = `未知错误: ${String(error)}`;
            logLevel = 'warn';
        }
        
        // 抑制重复的心跳错误日志
        const errorTime = Date.now();
        if (errorTime - lastHeartbeatErrorTime > ERROR_SUPPRESS_INTERVAL) {
            log('main', '节点管理', `❌ 节点签到/心跳失败: ${errorMessage}`, logLevel);
            lastHeartbeatErrorTime = errorTime;
            
            // 只在严重错误时提示检查配置
            if (logLevel === 'error') {
                log('main', '节点管理', `🔧 请检查网络连接和服务端状态`, 'warn');
            }
        }
        
        // 确保心跳失败不会影响主循环继续运行
        // 不抛出异常，让主循环继续
    }
}

async function sendFinalUpdate(bot: MicrosoftRewardsBot, data: { email: string; total_points: number; daily_gain: number; desktop_gain: number; mobile_gain: number; }) {
    const apiConfig = bot.config.apiServer;
    if (!apiConfig || !apiConfig.enabled || !apiConfig.updateUrl || !apiConfig.token) {
        return;
    }
    
    const payload = { ...data, node_name: apiConfig.nodeName };

    try {
        log('main', '最终上报', `正在向中心API上报账户 ${data.email} 的积分数据...`);
        const updateUrl = new URL(apiConfig.updateUrl);
        updateUrl.pathname = '/bot_api/update_points';

        await bot.axios.request({
            url: updateUrl.toString(),
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiConfig.token}` },
            data: payload
        }, true);
        log('main', '最终上报', `账户 ${data.email} 的积分数据上报成功！`);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log('main', '最终上报', `向中心API上报积分失败: ${errorMessage}`, 'error');
    }
}

async function sendLoginStatusUpdate(bot: MicrosoftRewardsBot, type: 'pc' | 'mobile', status: boolean, code: number, message: string) {
    const apiConfig = bot.config.apiServer;
    if (!apiConfig || !apiConfig.enabled || !apiConfig.updateUrl) {
        return;
    }

    try {
        const statusUrl = new URL(apiConfig.updateUrl);
        statusUrl.pathname = '/bot_api/update_login_status';

        const payload = { email: bot.account.email, type, status, code, message };
        
        log(bot.isMobile, '状态上报', `上报登录状态: ${JSON.stringify(payload)}`);
        await axios.post(statusUrl.toString(), payload, {
            headers: { 'Authorization': `Bearer ${apiConfig.token}` }
        });

    } catch (error) {
        let errorMessage: string;
        if (axios.isAxiosError(error)) {
            errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
        } else if (error instanceof Error) {
            errorMessage = error.message;
        } else {
            errorMessage = String(error);
        }
        log(bot.isMobile, '状态上报', `上报登录状态失败: ${errorMessage}`, 'error');
    }
}

async function updateActivityStatus(status: 'Running' | 'Idle') {
    // 更新全局任务状态
    isTaskRunning = status === 'Running';
    
    const config = loadConfig();
    const apiConfig = config.apiServer;
    if (!apiConfig || !apiConfig.enabled || !apiConfig.updateUrl) return;
    
    // 检查状态是否真的发生了变化
    if (lastReportedStatus === status) {
        // 即使状态未变化，也要更新时间戳，确保心跳能正确同步
        lastStatusUpdateTime = Date.now();
        // 静默处理状态未变化的情况，减少日志输出
        // log('main', '主流程', `📊 状态未变化，跳过上报: [${status}]`);
        return;
    }
    
    try {
        const apiUrl = new URL(apiConfig.updateUrl);
        apiUrl.pathname = '/bot_api/update_activity';
        await axios.post(apiUrl.toString(), 
            { 
                activity_status: status,
                timestamp: new Date().toISOString(),
                isTaskRunning: isTaskRunning
            },
            { headers: { 'Authorization': `Bearer ${apiConfig.token}` } }
        );
        
        // 更新状态记录
        lastReportedStatus = status;
        lastStatusUpdateTime = Date.now();
        
        log('main', '主流程', `📊 向服务器报告当前状态: [${status}] (isTaskRunning=${isTaskRunning})`);
    } catch (error) { 
        const errorMessage = error instanceof Error ? error.message : String(error);
        log('main', '主流程', `❌ 状态上报失败: ${errorMessage}`, 'warn');
    }
}

// 精准状态同步函数
async function syncStatusPrecisely() {
    const config = loadConfig();
    const apiConfig = config.apiServer;
    if (!apiConfig || !apiConfig.enabled || !apiConfig.updateUrl) return;
    
    const currentStatus = isTaskRunning ? 'Running' : 'Idle';
    const now = Date.now();
    
    // 如果状态发生变化，立即上报
    if (lastReportedStatus !== currentStatus) {
        await updateActivityStatus(currentStatus);
        return;
    }
    
    // 如果状态未变化，但超过30秒未更新，也进行同步（静默同步，不输出日志）
    if (now - lastStatusUpdateTime > 30000) {
        try {
            const apiUrl = new URL(apiConfig.updateUrl);
            apiUrl.pathname = '/bot_api/sync_status';
            await axios.post(apiUrl.toString(), 
                { 
                    activity_status: currentStatus,
                    timestamp: new Date().toISOString(),
                    isTaskRunning: isTaskRunning,
                    lastUpdateTime: lastStatusUpdateTime
                },
                { headers: { 'Authorization': `Bearer ${apiConfig.token}` } }
            );
            
            lastStatusUpdateTime = now;
            // 静默同步，不输出重复的状态日志
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const syncErrorTime = Date.now();
            
            // 抑制重复的状态同步错误日志
            if (syncErrorTime - lastStatusSyncErrorTime > ERROR_SUPPRESS_INTERVAL) {
                log('main', '状态同步', `❌ 状态同步失败: ${errorMessage}`, 'warn');
                lastStatusSyncErrorTime = syncErrorTime;
            }
        }
    }
}

async function confirmCommandToServer(command: string) {
    const config = loadConfig();
    const apiConfig = config.apiServer;
    if (!apiConfig || !apiConfig.enabled || !apiConfig.updateUrl) return;
    
    // 避免重复确认同一个命令
    if (lastConfirmedCommand === command) {
        log('main', '主流程', `ℹ️ 命令 [${command}] 已确认过，跳过重复确认`);
        return;
    }
    
    try {
        const apiUrl = new URL(apiConfig.updateUrl);
        apiUrl.pathname = '/bot_api/confirm_command';
        await axios.post(apiUrl.toString(), 
            { command },
            { headers: { 'Authorization': `Bearer ${apiConfig.token}` } }
        );
        log('main', '主流程', `✅ 向服务器确认命令: [${command}]`);
        lastConfirmedCommand = command;
    } catch (error) {
        let errorMessage: string;
        if (axios.isAxiosError(error)) {
            errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
        } else if (error instanceof Error) {
            errorMessage = error.message;
        } else {
            errorMessage = String(error);
        }
        
        // 检查是否是 "No pending command to confirm" 错误
        if (errorMessage.includes('No pending command to confirm') || 
            errorMessage.includes('"status":"info"')) {
            // 这种情况是正常的，不需要记录为错误
            log('main', '主流程', `ℹ️ 命令 [${command}] 已被处理或不存在，无需确认`);
            lastConfirmedCommand = command; // 标记为已处理
        } else if (errorMessage.includes('Command mismatch')) {
            // 命令不匹配，记录为警告
            log('main', '主流程', `⚠️ 命令不匹配: ${errorMessage}`, 'warn');
        } else {
            // 其他错误才记录为错误
            log('main', '主流程', `❌ 确认命令失败: ${errorMessage}`, 'error');
        }
    }
}

async function runHotSearchScript(accounts: Account[]) {
    return new Promise<void>((resolve, reject) => {
        log('main', '热搜脚本', '🔄 开始执行 get_all_hots.py 脚本...');
        
        const baseDir = __dirname;
        const tempAccountsPath = path.join(baseDir, 'accounts.temp.json');
        const configPath = path.join(baseDir, 'config.json');
        const outputDir = path.join(baseDir, 'search_terms');
        
        // 确保输出目录存在
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        fs.writeFileSync(tempAccountsPath, JSON.stringify(accounts, null, 2));

        // 在Docker容器中，get_all_hots.py在/app目录下
        const pythonCommand = `cd /app && python3 get_all_hots.py --config_path "${configPath}" --accounts_path "${tempAccountsPath}" --output_dir "${outputDir}"`;
        
        log('main', '热搜脚本', `执行命令: ${pythonCommand}`);
        
        exec(pythonCommand, (error: ExecException | null, stdout: string, stderr: string) => {
            // 清理临时文件
            if (fs.existsSync(tempAccountsPath)) {
                fs.unlinkSync(tempAccountsPath);
            }
            
            if (error) {
                log('main', '热搜脚本', `❌ 脚本执行失败: ${error.message}`, 'error');
                console.error(`stderr: ${stderr}`);
                reject(error);
                return;
            }
            log('main', '热搜脚本', `✅ 脚本执行成功`);
            console.log(`stdout: ${stdout}`);
            resolve();
        });
    });
}

export class MicrosoftRewardsBot {
    public log: typeof log;
    public config;
    public utils: Util;
    public activities: Activities = new Activities(this);
    public browser: { func: BrowserFunc; utils: BrowserUtil; };
    // 停止状态检查函数
    // 默认为检查全局shouldStopTask变量
    public checkStopStatus: () => boolean = () => shouldStopTask;
    public isMobile: boolean = false;
    public homePage!: Page;
    private browserFactory: Browser = new Browser(this);
    private workers: Workers;
    private login: Login;
    private loginExceptionHandlerManager: LoginExceptionHandlerManager;
    private pageExceptionDetector: PageExceptionDetector;
    public axios!: Axios;
    public accountStatus: string = '未知';
    public account!: Account;
    public sendStatusUpdate: (type: 'pc' | 'mobile', status: boolean, code: number, message: string) => Promise<void>;


    constructor() {
        this.log = log;
        this.utils = new Util();
        this.workers = new Workers(this);
        this.browser = { func: new BrowserFunc(this), utils: new BrowserUtil(this) };
        this.config = loadConfig();
        this.login = new Login(this);
        this.loginExceptionHandlerManager = new LoginExceptionHandlerManager(this);
        this.pageExceptionDetector = new PageExceptionDetector(this);
        this.sendStatusUpdate = (type, status, code, message) => sendLoginStatusUpdate(this, type, status, code, message);
    }
    
    private async Desktop(browser: PlaywrightBrowser, account: Account, initialPointsToday: number): Promise<{points: number, gain: number, initialPoints: number}> {
        this.isMobile = false;
        const context = await this.browserFactory.createContext(browser, account);
        const page = await context.newPage();
        try {
            log(this.isMobile, '主流程', `[${account.email}] 已创建桌面端上下文`);
            await this.login.login(page, account.email, account.password);
            
            // 登录成功后获取初始积分
            const initialData = await this.browser.func.getDashboardData(page);
            const currentInitialPoints = initialData.userStatus.availablePoints;
            
            // 如果之前没有初始积分记录，则保存当前积分作为初始值
            if (initialPointsToday === 0) {
                const todayStr = this.utils.getYYYYMMDD();
                await saveDailyPoints(this.config.sessionPath, account.email, {
                    date: todayStr,
                    initialPoints: currentInitialPoints
                });
                initialPointsToday = currentInitialPoints;
                log(false, '主流程', `[${account.email}] 已保存桌面端初始积分: ${initialPointsToday}`);
            }
            
            // 检查是否需要停止
            if (this.checkStopStatus()) {
                log(this.isMobile, '主流程', `[${account.email}] 检测到停止指令，终止任务...`, 'warn');
                return { points: initialPointsToday, gain: 0, initialPoints: initialPointsToday };
            }
            
            const allTasks = aiOrchestrator.getAllIncompleteTasks(initialData);
            if (allTasks.length > 0) {
                const executionPlan = await aiOrchestrator.getTaskExecutionPlan(allTasks);
                for (const task of executionPlan) {
                    // 检查是否需要停止
                    if (this.checkStopStatus()) {
                        log(this.isMobile, '主流程', `[${account.email}] 检测到停止指令，终止任务...`, 'warn');
                        return { points: initialPointsToday, gain: 0, initialPoints: initialPointsToday };
                    }
                    await this.workers.executeSingleTask(page, task);
                }
            }
            if (this.config.workers.doPunchCards) await this.workers.doPunchCard(page, initialData);
            const afterActivitiesData = await this.browser.func.getDashboardData(page);
            if (this.config.workers.doDesktopSearch) await this.activities.doSearch(page, afterActivitiesData, account.email);
            const finalData = await this.browser.func.getDashboardData(page);
            const finalPoints = finalData.userStatus.availablePoints;
            
            // 计算桌面端收益：基于今日初始积分
            const desktopGain = finalPoints - initialPointsToday;
            
            log(false, '主流程', `[${account.email}] 桌面端完成 - 初始: ${initialPointsToday}, 最终: ${finalPoints}, 收益: ${desktopGain}`);
            
            // 保存桌面端完成后的积分，供移动端任务使用
            const todayStr = this.utils.getYYYYMMDD();
            await saveDailyPoints(this.config.sessionPath, account.email, {
                date: todayStr,
                initialPoints: initialPointsToday,
                desktopFinalPoints: finalPoints  // 新增：保存桌面端完成后的积分
            });
            log(false, '主流程', `[${account.email}] 已保存桌面端完成后的积分: ${finalPoints}`);
            
            return { points: finalPoints, gain: desktopGain, initialPoints: initialPointsToday };
        } finally {
            await context.close();
        }
    }

    private async Mobile(browser: PlaywrightBrowser, account: Account, desktopFinalPoints: number): Promise<{points: number, gain: number}> {
        this.isMobile = true;
        const context = await this.browserFactory.createContext(browser, account);
        const page = await context.newPage();
        try {
            log(this.isMobile, '主流程', `[${account.email}] 已创建移动端上下文`);
            await this.login.login(page, account.email, account.password);
            const initialData = await this.browser.func.getDashboardData(page);
            
            // 移动端使用桌面端完成后的积分作为初始值
            const mobileInitialPoints = desktopFinalPoints;
            log(true, '主流程', `[${account.email}] 移动端初始积分: ${mobileInitialPoints} (基于桌面端完成后的积分)`);
            
            // 获取移动端访问令牌，如果失败则跳过移动端任务
            let accessToken: string | null = null;
            let tokenErrorOccurred = false;
            try {
                const tokenPage = await context.newPage();
                try { 
                    accessToken = await this.login.getMobileAccessToken(tokenPage, account.email); 
                    log(true, '主流程', `[${account.email}] 成功获取移动端访问令牌`);
                } catch (tokenError) {
                    const errorMessage = tokenError instanceof Error ? tokenError.message : String(tokenError);
                    log(true, '主流程', `[${account.email}] 获取移动端访问令牌失败: ${errorMessage}`, 'warn');
                    log(true, '主流程', `[${account.email}] 将跳过需要访问令牌的移动端任务`);
                    tokenErrorOccurred = true;
                } finally { 
                    await tokenPage.close(); 
                }
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                log(true, '主流程', `[${account.email}] 移动端访问令牌获取过程出错: ${errorMessage}`, 'warn');
                tokenErrorOccurred = true;
            }
            
            // 检查是否需要停止
            if (this.checkStopStatus()) {
                log(this.isMobile, '主流程', `[${account.email}] 检测到停止指令，终止任务...`, 'warn');
                return { points: mobileInitialPoints, gain: 0 };
            }

            // 执行需要访问令牌的任务
            if (this.config.workers.doDailyCheckIn) {
                if (accessToken) {
                    try {
                        log(true, '主流程', `[${account.email}] 开始执行移动端每日签到任务`);
                        
                        const checkInResult = await this.activities.doDailyCheckIn(accessToken, initialData);
                        log(true, '主流程', `[${account.email}] 移动端每日签到任务执行完成: ${JSON.stringify(checkInResult)}`);
                        
                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        log(true, '主流程', `[${account.email}] 每日签到任务执行失败: ${errorMessage}`, 'warn');
                        
                        // 如果是令牌相关错误，尝试重新获取令牌
                        if (errorMessage.includes('401') || errorMessage.includes('访问令牌')) {
                            log(true, '主流程', `[${account.email}] 尝试重新获取移动端访问令牌...`, 'warn');
                            try {
                                const newTokenPage = await context.newPage();
                                try {
                                    const newAccessToken = await this.login.getMobileAccessToken(newTokenPage, account.email);
                                    if (newAccessToken && newAccessToken !== accessToken) {
                                        log(true, '主流程', `[${account.email}] 重新获取访问令牌成功，重试签到任务`);
                                        try {
                                                                                         const retryResult = await this.activities.doDailyCheckIn(newAccessToken, initialData);
                                            log(true, '主流程', `[${account.email}] 重试签到任务成功: ${JSON.stringify(retryResult)}`);
                                        } catch (retryError) {
                                            const retryErrorMessage = retryError instanceof Error ? retryError.message : String(retryError);
                                            log(true, '主流程', `[${account.email}] 重试签到任务失败: ${retryErrorMessage}`, 'error');
                                        }
                                    }
                                } finally {
                                    await newTokenPage.close();
                                }
                            } catch (retryTokenError) {
                                const retryTokenErrorMessage = retryTokenError instanceof Error ? retryTokenError.message : String(retryTokenError);
                                log(true, '主流程', `[${account.email}] 重新获取访问令牌失败: ${retryTokenErrorMessage}`, 'error');
                            }
                        }
                    }
                } else if (tokenErrorOccurred) {
                    log(true, '主流程', `[${account.email}] 跳过每日签到任务（访问令牌获取失败）`, 'warn');
                } else {
                    log(true, '主流程', `[${account.email}] 跳过每日签到任务（未获取到访问令牌）`, 'warn');
                }
            } else {
                log(true, '主流程', `[${account.email}] 跳过每日签到任务（配置未启用）`, 'log');
            }
            
            // 检查是否需要停止
            if (this.checkStopStatus()) {
                log(this.isMobile, '主流程', `[${account.email}] 检测到停止指令，终止任务...`, 'warn');
                return { points: mobileInitialPoints, gain: 0 };
            }

            if (accessToken && this.config.workers.doReadToEarn) {
                try {
                    log(true, '主流程', `[${account.email}] 开始执行移动端阅读赚积分任务`);
                    await this.activities.doReadToEarn(accessToken, initialData);
                    log(true, '主流程', `[${account.email}] 移动端阅读赚积分任务执行完成`);
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    log(true, '主流程', `[${account.email}] 阅读赚积分任务执行失败: ${errorMessage}`, 'warn');
                }
            } else if (tokenErrorOccurred) {
                log(true, '主流程', `[${account.email}] 跳过阅读赚积分任务（访问令牌获取失败）`, 'warn');
            }
            
            // 检查是否需要停止
            if (this.checkStopStatus()) {
                log(this.isMobile, '主流程', `[${account.email}] 检测到停止指令，终止任务...`, 'warn');
                return { points: mobileInitialPoints, gain: 0 };
            }

            // 移动端搜索任务不需要访问令牌，但需要确保登录状态
            if (this.config.workers.doMobileSearch) {
                if (initialData.userStatus.counters.mobileSearch) {
                    try {
                        log(true, '主流程', `[${account.email}] 开始执行移动端搜索任务`);
                        await this.activities.doSearch(page, initialData, account.email);
                        log(true, '主流程', `[${account.email}] 移动端搜索任务执行完成`);
                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        log(true, '主流程', `[${account.email}] 移动端搜索任务执行失败: ${errorMessage}`, 'warn');
                    }
                } else {
                    log(true, '主流程', `[${account.email}] 移动端搜索任务已完成或不可用`);
                }
            }
            
            // 移动端每日活动任务 - 尝试完成桌面端可能遗漏的任务
            if (this.config.workers.doPunchCards || this.config.workers.doDailyCheckIn) {
                try {
                    log(true, '主流程', `[${account.email}] 开始执行移动端每日活动任务`);
                    
                    // 获取最新的任务数据
                    const currentData = await this.browser.func.getDashboardData(page);
                    const allTasks = aiOrchestrator.getAllIncompleteTasks(currentData);
                    
                    if (allTasks.length > 0) {
                        log(true, '主流程', `[${account.email}] 发现 ${allTasks.length} 个未完成的每日活动任务`);
                        
                        const executionPlan = await aiOrchestrator.getTaskExecutionPlan(allTasks);
                        for (const task of executionPlan) {
                            // 检查是否需要停止
                            if (this.checkStopStatus()) {
                                log(true, '主流程', `[${account.email}] 检测到停止指令，终止移动端每日活动任务`, 'warn');
                                break;
                            }
                            
                            try {
                                await this.workers.executeSingleTask(page, task);
                                log(true, '主流程', `[${account.email}] 移动端完成每日活动任务: ${task.title}`);
                            } catch (taskError) {
                                const taskErrorMessage = taskError instanceof Error ? taskError.message : String(taskError);
                                log(true, '主流程', `[${account.email}] 移动端每日活动任务执行失败: ${task.title} - ${taskErrorMessage}`, 'warn');
                            }
                        }
                    } else {
                        log(true, '主流程', `[${account.email}] 移动端每日活动任务已完成或不可用`);
                    }
                    
                    log(true, '主流程', `[${account.email}] 移动端每日活动任务执行完成`);
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    log(true, '主流程', `[${account.email}] 移动端每日活动任务执行失败: ${errorMessage}`, 'warn');
                }
            }
            
            const finalData = await this.browser.func.getDashboardData(page);
            const finalPoints = finalData.userStatus.availablePoints;
            
            // 计算移动端收益：基于桌面端完成后的积分
            const mobileGain = finalPoints - mobileInitialPoints;
            
            log(true, '主流程', `[${account.email}] 移动端完成 - 初始: ${mobileInitialPoints}, 最终: ${finalPoints}, 收益: ${mobileGain}`);
            
            return { points: finalPoints, gain: mobileGain };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log(true, '主流程', `[${account.email}] 移动端任务执行出错: ${errorMessage}`, 'error');
            
            // 记录详细的错误信息
            log(true, '主流程', `[${account.email}] 移动端任务执行失败，详细错误: ${errorMessage}`, 'error');
            
            // 即使出错也返回桌面端的积分，确保流程继续
            log(true, '主流程', `[${account.email}] 移动端任务失败，返回桌面端积分: ${desktopFinalPoints}`);
            
            // 记录任务失败状态，便于后续分析
            this.accountStatus = '移动端任务失败';
            
            return { points: desktopFinalPoints, gain: 0 };
        } finally {
            await context.close();
        }
    }

    public async runFor(account: Account) {
        this.account = account;
        this.axios = new Axios(account.proxy);
        const browser = await this.browserFactory.launchBrowser(account);
        try {
            const todayStr = this.utils.getYYYYMMDD();
            const dailyPointsData = await loadDailyPoints(this.config.sessionPath, account.email);
            let initialPointsToday = 0;
            
            // 检查是否有今日的初始积分记录
            if (dailyPointsData && dailyPointsData.date === todayStr) {
                initialPointsToday = dailyPointsData.initialPoints;
                log(false, '主流程', `[${account.email}] 使用已保存的今日初始积分: ${initialPointsToday}`);
            } else {
                log(false, '主流程', `[${account.email}] 未找到今日初始积分记录，将在登录后获取当前积分作为初始值`);
            }
            
            // 添加停止检查
            if (shouldStopTask) {
                log('main', '主进程-WORKER', '🛑 检测到停止指令，终止账户任务...', 'warn');
                return;
            }
            
            // 先执行桌面端任务，在登录成功后获取初始积分
            const desktopResult = await this.Desktop(browser, account, initialPointsToday).catch(e => { 
                if (e.message === 'VERIFICATION_LOGIN_SUCCESS') {
                    log(false, 'Desktop-Info', '验证码登录成功，继续执行任务');
                    // 验证码登录成功，继续执行任务
                    return {points: 0, gain: 0, initialPoints: 0}
                } else {
                    log(false, 'Desktop-Error', e.message, 'error'); 
                    return {points: 0, gain: 0, initialPoints: 0}
                }
            });
            
            // 添加停止检查
            if (shouldStopTask) {
                log('main', '主进程-WORKER', '🛑 检测到停止指令，终止账户任务...', 'warn');
                return;
            }
            
            // 执行移动端任务，使用桌面端完成后的积分作为初始值
            const mobileResult = await this.Mobile(browser, account, desktopResult.points).catch(e => { 
                if (e.message === 'VERIFICATION_LOGIN_SUCCESS') {
                    log(true, 'Mobile-Info', '验证码登录成功，继续执行任务');
                    // 验证码登录成功，继续执行任务
                    return {points: desktopResult.points, gain: 0}
                } else {
                    log(true, 'Mobile-Error', e.message, 'error'); 
                    return {points: desktopResult.points, gain: 0}
                }
            });
            
            // 添加停止检查
            if (shouldStopTask) {
                log('main', '主进程-WORKER', '🛑 检测到停止指令，终止账户任务...', 'warn');
                return;
            }
            
            // 获取最终积分：使用移动端完成后的积分作为最终积分
            const finalPoints = mobileResult.points;

            // 计算今日总收益：使用今日初始积分作为基准
            const dailyGain = initialPointsToday > 0 ? finalPoints - initialPointsToday : 0;
            
            // 计算桌面端和移动端的实际收益
            const actualDesktopGain = desktopResult.gain;
            const actualMobileGain = mobileResult.gain;
            
            if (initialPointsToday === 0) {
                log(false, '主流程', `[${account.email}] 初始积分获取失败，跳过今日收益计算`);
            } else {
                log(false, '主流程', `[${account.email}] 积分统计 - 初始: ${initialPointsToday}, 最终: ${finalPoints}, 今日收益: ${dailyGain}`);
                log(false, '主流程', `[${account.email}] 桌面端收益: ${actualDesktopGain}, 移动端收益: ${actualMobileGain}`);
            }

            await sendFinalUpdate(this, {
                email: account.email,
                total_points: finalPoints,
                daily_gain: dailyGain,
                desktop_gain: actualDesktopGain,
                mobile_gain: actualMobileGain
            });
        } finally {
            await browser.close();
        }
    }

    /**
     * 处理登录异常的统一入口
     * @param exceptionType 异常类型
     * @param page 页面对象
     * @param email 邮箱
     * @returns 处理结果
     */
    public async handleLoginException(exceptionType: string, page: Page, email: string): Promise<boolean> {
        return await this.loginExceptionHandlerManager.handleLoginException(exceptionType, page, email);
    }

    public async detectPageException(page: Page, email: string, timeout?: number): Promise<PageExceptionResult> {
        return await this.pageExceptionDetector.detectAndHandle(page, email, timeout);
    }

    /**
     * 公共方法：执行桌面端任务
     * @param account 账户信息
     * @param initialPoints 初始积分
     * @returns 任务执行结果
     */
    public async executeDesktopTask(account: Account, initialPoints: number): Promise<{points: number, gain: number, initialPoints: number}> {
        const browser = await this.browserFactory.launchBrowser(account);
        try {
            return await this.Desktop(browser, account, initialPoints);
        } finally {
            await browser.close();
        }
    }

    /**
     * 公共方法：执行移动端任务
     * @param account 账户信息
     * @param desktopFinalPoints 桌面端完成后的积分
     * @returns 任务执行结果
     */
    public async executeMobileTask(account: Account, desktopFinalPoints: number): Promise<{points: number, gain: number}> {
        const browser = await this.browserFactory.launchBrowser(account);
        try {
            return await this.Mobile(browser, account, desktopFinalPoints);
        } finally {
            await browser.close();
        }
    }

    /**
     * 公共方法：加载每日积分数据
     * @param sessionPath 会话路径
     * @param email 邮箱
     * @returns 每日积分数据
     */
    public async loadDailyPoints(sessionPath: string, email: string): Promise<DailyPoints | null> {
        return await loadDailyPoints(sessionPath, email);
    }
}


async function runTasksForAccounts(accounts: Account[], config: Config, taskType: 'desktop' | 'mobile' = 'desktop') {
    // 并发数：优先使用 service 下发的 clusters，其次使用本地 parallel（true 视为 2），默认 1
    const concurrency = Math.max(1, Number((config as any).clusters || (config.parallel ? 2 : 1)) || 1);
    log('main', '主进程-WORKER', `⚙️ 使用并发数: ${concurrency}，任务类型: ${taskType}`);

    const queue: Account[] = accounts.filter(a => !accountStatusManager.isFrozen(a.email));
    const children: ChildProcess[] = [];
    const failedAccounts: string[] = [];

    async function spawnWorker(workerId: number) {
        while (queue.length > 0) {
            if (shouldStopTask) {
                log('main', '主进程-WORKER', `🛑 并发#${workerId} 收到停止指令，结束`, 'warn');
                return;
            }
            const account = queue.shift();
            if (!account) break;

            log('main', '主进程-WORKER', `🚀 开始为账户 ${account.email} 执行${taskType}任务 (并发#${workerId})`);
            const env = { ...process.env, ACCOUNT: JSON.stringify(account), TASK_TYPE: taskType } as any;
            // 尝试多个可能的 worker 文件路径
            let workerPath = './dist/worker.js';
            if (!require('fs').existsSync(workerPath)) {
                workerPath = './src/worker.ts';
                if (!require('fs').existsSync(workerPath)) {
                    log('main', '主进程-WORKER', `❌ 错误：找不到 worker 文件，尝试使用 ts-node 执行`, 'error');
                    workerPath = './src/worker.ts';
                }
            }
            
            log('main', '主进程-WORKER', `📁 使用 worker 文件: ${workerPath}`);
            const cp = fork(workerPath, { env, stdio: 'inherit' });
            children.push(cp);
            
            try {
                await new Promise<void>((resolve, reject) => {
                    let timeoutId: NodeJS.Timeout | null = null;
                    let isResolved = false;
                    
                    // [取消] 全局任务超时设置
                    // 现在只依赖搜索任务的错误次数限制（maxLoop达到10次才终止）
                    // 这样可以避免因为网络慢或其他原因导致的过早终止
                    log('main', '主进程-WORKER', `⏰ 账户 ${account.email} 已取消全局任务超时，只依赖搜索任务错误次数限制 (并发#${workerId})`);
                    
                    // 不再设置超时定时器，让任务自然完成或通过错误次数限制终止
                    // timeoutId = null; // 明确设置为null，表示没有超时
                    
                    cp.on('exit', (code) => {
                        if (!isResolved) {
                            isResolved = true;
                            // 清理超时定时器（如果存在的话）
                            if (timeoutId) {
                                clearTimeout(timeoutId);
                                timeoutId = null;
                            }
                            
                            if (code === 0) {
                                log('main', '主进程-WORKER', `✅ 账户 ${account.email} 任务执行成功 (并发#${workerId})`);
                                resolve();
                            } else {
                                log('main', '主进程-WORKER', `❌ 账户 ${account.email} 任务执行失败，退出码: ${code} (并发#${workerId})`, 'warn');
                                failedAccounts.push(account.email);
                                // 即使失败也resolve，继续处理下一个账号
                                resolve();
                            }
                        }
                    });
                });
                
                // 从children数组中移除已完成的进程
                const index = children.indexOf(cp);
                if (index > -1) {
                    children.splice(index, 1);
                }
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                log('main', '主进程-WORKER', `💥 账户 ${account.email} 任务执行异常: ${errorMessage} (并发#${workerId})`, 'error');
                failedAccounts.push(account.email);
                
                // 从children数组中移除异常的进程
                const index = children.indexOf(cp);
                if (index > -1) {
                    children.splice(index, 1);
                }
            }
        }
    }

    // 启动固定数量的子进程消费队列（串行复用 child，避免爆炸性进程增长）
    log('main', '主进程-WORKER', `🚀 启动 ${concurrency} 个并发工作进程...`);
    await Promise.all(Array.from({ length: concurrency }, (_, i) => spawnWorker(i + 1)));
    
    // 等待所有子进程真正完成
    log('main', '主进程-WORKER', '⏳ 等待所有子进程完成...');
    for (const cp of children) {
        if (!cp.killed) {
            try {
                await new Promise<void>((resolve) => {
                    cp.on('exit', () => resolve());
                    // 如果进程还在运行，等待它自然结束
                    if (!cp.killed) {
                        setTimeout(() => {
                            if (!cp.killed) {
                                log('main', '主进程-WORKER', '⏰ 强制终止超时子进程', 'warn');
                                cp.kill('SIGKILL');
                            }
                            resolve();
                        }, 10000); // 10秒超时
                    }
                });
            } catch (error) {
                log('main', '主进程-WORKER', `⚠️ 等待子进程完成时出错: ${error}`, 'warn');
            }
        }
    }

    // 清理残留子进程（只处理真正还在运行的）
    for (const cp of children) {
        try { 
            if (!cp.killed) {
                log('main', '主进程-WORKER', '🧹 清理残留运行中的子进程', 'warn');
                cp.kill('SIGKILL');
            }
        } catch {}
    }
    
    // 报告执行结果
    if (failedAccounts.length > 0) {
        log('main', '主进程-WORKER', `⚠️ ${taskType}任务执行完成，失败的账户: ${failedAccounts.join(', ')}`, 'warn');
    } else {
        log('main', '主进程-WORKER', `✅ 当前账户的${taskType}任务执行完成`);
    }
    
    log('main', '主进程-WORKER', `🏁 runTasksForAccounts函数执行完成 (${taskType})`);
    
    // [修复] 确保任务完成后状态被正确重置
    // 检查是否还有子进程在运行
    if (children.length > 0) {
        log('main', '主进程-WORKER', `⚠️ 还有 ${children.length} 个子进程在运行，等待完成...`, 'warn');
        // 等待所有子进程完成
        await Promise.all(children.map(cp => new Promise<void>((resolve) => {
            if (cp.killed || cp.exitCode !== null) {
                resolve();
            } else {
                cp.on('exit', () => resolve());
                cp.on('error', () => resolve());
            }
        })));
        log('main', '主进程-WORKER', '所有子进程已完成');
    }
    
    // 注意：不要在这里重置isTaskRunning，因为任务可能还在执行中
    // isTaskRunning会在主循环中重置
}

async function main() {
    try {
        // 启动内存监控
        startMemoryMonitoring();
        // 移除内存监控已启动的日志，减少非关键信息输出

        // 设置进程退出时的清理
        process.on('SIGINT', () => {
            log('main', '主流程', '收到SIGINT信号，正在清理资源...', 'warn');
            stopMemoryMonitoring();
            process.exit(0);
        });

        process.on('SIGTERM', () => {
            log('main', '主流程', '收到SIGTERM信号，正在清理资源...', 'warn');
            stopMemoryMonitoring();
            process.exit(0);
        });

        process.on('exit', () => {
            log('main', '主流程', '进程退出，清理完成', 'log');
        });

        // 加载配置
        let config = loadConfig();
        
        // 检测进程类型（主进程还是子进程）
        const isMainProcess = !process.env.ACCOUNT && !process.env.TASK_TYPE;
        
        // 只在主进程中显示完整的启动信息
        if (isMainProcess) {
            log('main', '启动', '🚀 Mic-Bot Node 正在启动...');
            log('main', '启动', `📋 节点名称: ${config.apiServer?.nodeName || '未配置'}`);
            log('main', '启动', `🌐 服务地址: ${config.apiServer?.updateUrl || '未配置'}`);
            log('main', '启动', `🔑 API Token: ${config.apiServer?.token ? '已配置' : '未配置'}`);
            log('main', '启动', `💓 心跳间隔: ${config.apiServer?.heartbeatInterval || '5m'}`);
            log('main', '启动', `📊 日志推送: ${config.logPush?.enabled ? '已启用' : '已禁用'}`);
            if (config.logPush?.enabled) {
                log('main', '启动', `📤 日志推送间隔: ${config.logPush.interval}秒`);
            }
        }

        // 启动日志服务器


        // 启动日志推送服务
        let logPusher: LogPusher | null = null;
        if (config.logPush?.enabled) {
            logPusher = new LogPusher({
                enabled: config.logPush.enabled,
                serverUrl: config.logPush.serverUrl,
                token: config.logPush.token,
                interval: config.logPush.interval
            });
            logPusher.start();
            if (isMainProcess) {
                log('main', '启动', '📤 日志推送服务已启动');
            }
        }

        // 确保 searchSettings 总是有默认值
        if (!config.searchSettings) {
            config.searchSettings = {
                useGeoLocaleQueries: true,
                scrollRandomResults: true,
                clickRandomResults: true,
                retryMobileSearchAmount: 3,
                searchDelay: {
                    min: '2s',
                    max: '5s'
                }
            };
        }

        try {
            // 步骤 2: 尝试从远端加载扁平化的节点配置
            const nodeConfig = await loadNodeConfig();

            // 步骤 3: 如果成功获取，则进行重组和合并
            if (nodeConfig) {
                // 这是方案一的核心：将扁平配置重组为嵌套结构
                const remoteSearchSettings = {
                    useGeoLocaleQueries: true, // 可以保留一个默认值
                    scrollRandomResults: true, // 可以保留一个默认值
                    clickRandomResults: true, // 可以保留一个默认值
                    retryMobileSearchAmount: 3, // 可以保留一个默认值
                    searchDelay: {
                        min: nodeConfig.search_delay_min,
                        max: nodeConfig.search_delay_max
                    }
                };

                // 将重组后的配置与本地配置合并，远程的 searchSettings 会覆盖本地的
                // 同时合入 service 端下发的并发数 clusters 和日志推送配置
                config = {
                    ...config,
                    searchSettings: remoteSearchSettings,
                    clusters: (nodeConfig as any).clusters,
                    logPush: {
                        enabled: nodeConfig.log_push_enabled || false,
                        serverUrl: `${config.apiServer?.updateUrl}logs/receive`,
                        token: config.apiServer?.token || '',
                        interval: nodeConfig.log_push_interval || 30
                    }
                };

                if (isMainProcess) {
                    log('main', '启动', '✅ 已成功加载远程节点配置');
                    log('main', '启动', `⚙️ 服务端并发配置: ${(nodeConfig as any).clusters || '未配置'}`);
                    log('main', '启动', `🔍 搜索延迟: ${nodeConfig.search_delay_min || '2s'} - ${nodeConfig.search_delay_max || '5s'}`);
                    log('main', '启动', `📊 日志推送状态: ${nodeConfig.log_push_enabled ? '已启用' : '已禁用'}`);
                    if (nodeConfig.log_push_enabled) {
                        log('main', '启动', `📤 日志推送间隔: ${nodeConfig.log_push_interval || 30}秒`);
                    }
                }
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (isMainProcess) {
                log('main', '启动', `⚠️ 加载远程节点配置失败: ${errorMessage}`, 'warn');
                log('main', '启动', '📋 将仅使用本地配置继续运行', 'warn');
            }
        }

        // 步骤 4: 定时签到/发送心跳
        if (isMainProcess) {
            log('main', '启动', '🔄 正在向服务端签到...');
        }
        await checkInNode();
        
        // 确保使用最终的 config 对象来获取心跳间隔
        const utils = new Util();
        const heartbeatIntervalMs = utils.stringToMs(config.apiServer?.heartbeatInterval || '5m');
        setInterval(checkInNode, heartbeatIntervalMs);
        
        // 移除精准状态同步，统一使用心跳接口
        if (statusUpdateInterval) {
            clearInterval(statusUpdateInterval);
            statusUpdateInterval = null;
        }
        
        // 初始化WebSocket任务调度（可选）
        try {
            wsClient = new NodeWebSocketClient(config);
            wsClient.init();
            useWebSocketScheduling = true;
            log('main', '启动', '🔌 WebSocket任务调度已启用');
        } catch (error) {
            log('main', '启动', `⚠️ WebSocket任务调度初始化失败: ${error}`, 'warn');
            useWebSocketScheduling = false;
        }
        
        // 启动完成日志
        if (isMainProcess) {
            log('main', '启动', '🎉 Mic-Bot Node 启动完成！');
            log('main', '启动', `📡 节点状态: 在线 (${config.apiServer?.nodeName})`);
            log('main', '启动', `⏰ 心跳间隔: ${config.apiServer?.heartbeatInterval || '5m'}`);
            log('main', '启动', '🔄 开始监听服务端指令...');
            
            // 确保启动时状态正确
            if (isTaskRunning) {
                log('main', '启动', '⚠️ 检测到启动时任务状态异常，正在重置...', 'warn');
                isTaskRunning = false;
                await updateActivityStatus('Idle');
                log('main', '启动', '✅ 任务状态已重置为 Idle');
            } else {
                log('main', '启动', `📊 当前任务状态: Idle (isTaskRunning=${isTaskRunning})`);
            }
        }


        // 步骤 5: 开始主循环，监听任务
        let consecutiveErrors = 0;
        const maxConsecutiveErrors = 5; // 最大连续错误次数
        let lastLoopTime = Date.now();
        const maxLoopInterval = 300000; // 5分钟最大循环间隔
        
        // 启动主循环监控
        const loopMonitor = setInterval(() => {
            const now = Date.now();
            const timeSinceLastLoop = now - lastLoopTime;
            
            if (timeSinceLastLoop > maxLoopInterval) {
                log('main', '主流程监控', `主循环可能卡死，距离上次循环已过去${Math.round(timeSinceLastLoop/1000)}秒`, 'error');
                log('main', '主流程监控', '尝试强制重置主循环状态...', 'warn');
                
                // 强制重置状态
                isTaskRunning = false;
                shouldStopTask = false;
                consecutiveErrors = 0;
                
                // 尝试重新加载配置
                try {
                    config = loadConfig();
                    log('main', '主流程监控', '配置已重新加载');
                } catch (configError) {
                    log('main', '主流程监控', `重新加载配置失败: ${configError}`, 'warn');
                }
                
                // 更新活动状态
                updateActivityStatus('Idle').catch(error => {
                    log('main', '主流程监控', `重置活动状态失败: ${error}`, 'warn');
                });
                
                lastLoopTime = now; // 重置时间
            }
        }, 60000); // 每分钟检查一次
        
        // 确保进程退出时清理监控
        process.on('exit', () => {
            clearInterval(loopMonitor);
            if (webSocketRecoveryCheckInterval) {
                clearInterval(webSocketRecoveryCheckInterval);
            }
        });
        
        while (true) {
            try {
                // 更新循环时间戳
                lastLoopTime = Date.now();
                
                // 检查是否有WebSocket任务需要处理
                if (globalWebSocketTask) {
                    const task = globalWebSocketTask;
                    globalWebSocketTask = null; // 清除任务
                    
                    log('main', '主流程', `📋 收到WebSocket任务: ${task.task_id} (${task.command})`);
                    
                    // 使用隔离执行函数，确保任务执行不受WebSocket连接状态影响
                    executeTaskIsolated(task);
                }
                
                // 如果使用WebSocket调度，跳过轮询
                if (useWebSocketScheduling && wsClient && wsClient.connected) {
                    await new Promise(resolve => setTimeout(resolve, 5000)); // 等待5秒
                    continue;
                }
                // 重置连续错误计数
                consecutiveErrors = 0;
                // [修复] 移除错误的状态健康检查逻辑
                // 原来的逻辑会错误地重置任务状态，导致任务执行时显示Idle
                // 任务状态应该只在主循环的finally块中重置
                
                // 移除长轮询请求指令的日志，减少非关键信息输出
                const commandUrl = new URL(config.apiServer.updateUrl);
                commandUrl.pathname = '/bot_api/command_poll';

                const response = await axios.get(commandUrl.toString(), {
                    headers: { 'Authorization': `Bearer ${config.apiServer.token}` },
                    timeout: 60000
                });

                const command = response.data.command;

                // 检查服务端是否从离线状态恢复
                if (serverOffline) {
                    const offlineDuration = Math.round((Date.now() - lastServerErrorTime) / 1000);
                    log('main', '主流程', `🔄 服务端已恢复！离线时长: ${offlineDuration}秒`, 'warn');
                    serverOffline = false;
                    lastServerErrorTime = 0;
                }

                if (command === 'RUN_TASKS') {
                    log('main', '主流程', '收到 [执行任务] 指令，开始执行...');
                    // 严格检查当前任务状态
                    if (!isTaskRunning) {
                        log('main', '主流程', '当前无任务运行，开始执行新任务...');
                        // 立即设置状态，防止重复执行
                        isTaskRunning = true;
                        // 上报运行状态
                        await updateActivityStatus('Running');
                        // 等待任务执行完成，确保状态管理正确
                        try {
                            await executeTasks();
                            log('main', '主流程', '任务执行完成');
                        } catch (err) {
                            log('main', '任务执行', `任务执行出错: ${String(err)}`, 'error');
                        } finally {
                            // 任务完成后才重置状态
                            isTaskRunning = false; // 重置任务运行状态
                            await updateActivityStatus('Idle');
                            log('main', '主流程', '任务执行完成，状态已重置为 Idle');
                        }
                        // 确认命令已接收
                        await confirmCommandToServer('RUN_TASKS');
                    } else {
                        log('main', '主流程', '任务正在执行中，忽略重复的执行指令', 'warn');
                        log('main', '主流程', `当前状态: isTaskRunning=${isTaskRunning}, shouldStopTask=${shouldStopTask}`);
                        // 确认命令已接收但无需执行
                        await confirmCommandToServer('RUN_TASKS');
                    }
                } else if (command === 'RUN_TASK') {
                    log('main', '主流程', '收到 [执行单个任务] 指令，开始执行...');
                    const taskData = response.data.data;
                    log('main', '主流程', `任务数据: ${JSON.stringify(taskData)}`);
                    // 严格检查当前任务状态 - 拒绝所有单个任务指令如果有任务正在执行
                    if (!isTaskRunning) {
                        log('main', '主流程', '当前无任务运行，开始执行单个任务...');
                        // 立即设置状态，防止重复执行
                        isTaskRunning = true;
                        // 上报运行状态
                        await updateActivityStatus('Running');
                        // 等待单个任务执行完成，确保状态管理正确
                        try {
                            await executeSingleTask(taskData);
                            log('main', '主流程', '单个任务执行完成');
                        } catch (err) {
                            log('main', '执行单个任务', `单个任务执行出错: ${String(err)}`, 'error');
                        } finally {
                            // 任务完成后才重置状态
                            isTaskRunning = false; // 重置任务运行状态
                            await updateActivityStatus('Idle');
                            log('main', '主流程', '单个任务执行完成，状态已重置为 Idle');
                        }
                        // 确认命令已接收
                        await confirmCommandToServer('RUN_TASK');
                    } else {
                        log('main', '主流程', '❌ 拒绝执行单个任务：当前有任务正在执行中', 'warn');
                        log('main', '主流程', `当前状态: isTaskRunning=${isTaskRunning}, shouldStopTask=${shouldStopTask}`);
                        log('main', '主流程', '等待当前任务完成后再接受新的单个任务指令', 'warn');
                        // 确认命令已接收但拒绝执行
                        await confirmCommandToServer('RUN_TASK');
                    }
                } else if (command === 'STOP_TASKS') {
                    log('main', '主流程', '收到 [停止任务] 指令，正在终止当前任务...', 'warn');
                    shouldStopTask = true;
                    // 立即更新活动状态为Idle
                    await updateActivityStatus('Idle');
                    // 向服务端确认命令已执行
                    await confirmCommandToServer('STOP_TASKS');
                    log('main', '主流程', '已设置停止标志、更新状态为Idle并确认命令', 'warn');
                    log('main', '主流程', '停止命令处理完成', 'warn');
                    // 重置任务运行状态，确保可以立即响应新指令
                    isTaskRunning = false;
                } else if (command === null) {
                    // 移除空命令的日志输出，减少非关键信息
                    // 不将空命令视为停止指令
                } else {
                    log('main', '主流程', `收到未知命令: ${command}`, 'warn');
                }

            } catch (error) {
                consecutiveErrors++;
                let errorMessage: string;
                let retryDelay = 30000; // 默认30秒重试
                
                if (axios.isAxiosError(error)) {
                    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
                        errorMessage = '长轮询超时，正在发起下一次请求...';
                        retryDelay = 5000; // 超时错误快速重试
                    } else if (error.response) {
                        const status = error.response.status;
                        errorMessage = `服务器错误 (${status}): ${JSON.stringify(error.response.data)}`;
                        
                        // 根据HTTP状态码决定重试策略
                        if (status >= 500) {
                            // 5xx服务器错误，延长重试间隔
                            retryDelay = 60000; // 1分钟
                // 抑制重复的服务器错误日志
                const currentTime = Date.now();
                if (currentTime - lastServerErrorTime > ERROR_SUPPRESS_INTERVAL) {
                    log('main', '主流程', `服务器错误，将在${retryDelay/1000}秒后重试`, 'warn');
                }
                            // 标记服务端为离线状态
                            if (!serverOffline) {
                                serverOffline = true;
                                lastServerErrorTime = Date.now();
                                log('main', '主流程', '⚠️ 服务端暂时不可用，进入离线模式', 'warn');
                            }
                        } else if (status === 401 || status === 403) {
                            // 认证错误，需要检查配置
                            log('main', '主流程', `认证失败 (${status})，请检查API Token配置`, 'error');
                            retryDelay = 300000; // 5分钟
                        } else if (status === 404) {
                            // 接口不存在，可能是配置错误
                            log('main', '主流程', `接口不存在 (${status})，请检查API URL配置`, 'error');
                            retryDelay = 300000; // 5分钟
                        } else {
                            // 其他客户端错误
                            retryDelay = 60000; // 1分钟
                        }
                    } else {
                        errorMessage = `网络错误: ${error.message}`;
                        retryDelay = 30000; // 网络错误30秒重试
                        // 网络错误也标记为离线状态
                        if (!serverOffline) {
                            serverOffline = true;
                            lastServerErrorTime = Date.now();
                            log('main', '主流程', '⚠️ 网络连接异常，进入离线模式', 'warn');
                        }
                    }
                } else {
                    errorMessage = String(error);
                    retryDelay = 30000; // 其他错误30秒重试
                }
                
                // 抑制重复的主循环错误日志
                const errorTime = Date.now();
                if (errorTime - lastServerErrorTime > ERROR_SUPPRESS_INTERVAL) {
                    log('main', '主流程', `主循环出错 (${consecutiveErrors}/${maxConsecutiveErrors}): ${errorMessage}`, 'warn');
                }
                
                // 检查连续错误次数
                if (consecutiveErrors >= maxConsecutiveErrors) {
                    log('main', '主流程', `连续错误次数达到${maxConsecutiveErrors}次，执行强制恢复...`, 'error');
                    
                    // 强制重置所有状态
                    isTaskRunning = false;
                    shouldStopTask = false;
                    consecutiveErrors = 0; // 重置错误计数
                    
                    // 尝试重新加载配置
                    try {
                        config = loadConfig();
                        log('main', '主流程', '配置已重新加载');
                    } catch (configError) {
                        log('main', '主流程', `重新加载配置失败: ${configError}`, 'warn');
                    }
                    
                    // 更新活动状态
                    try {
                        await updateActivityStatus('Idle');
                        log('main', '主流程', '活动状态已重置为 Idle');
                    } catch (statusError) {
                        log('main', '主流程', `重置活动状态失败: ${statusError}`, 'warn');
                    }
                    
                    // 延长重试间隔
                    retryDelay = 120000; // 2分钟
                    log('main', '主流程', '强制恢复完成，将延长重试间隔');
                } else {
                    // 检查是否需要重置任务状态
                    if (isTaskRunning && !shouldStopTask) {
                        log('main', '主流程', '检测到主循环错误且任务状态异常，正在重置任务状态...', 'warn');
                        isTaskRunning = false;
                        shouldStopTask = false;
                        await updateActivityStatus('Idle');
                        log('main', '主流程', '任务状态已重置为 Idle');
                    }
                }
                
                // 等待指定时间后重试
                log('main', '主流程', `等待${retryDelay/1000}秒后重试...`);
                await utils.wait(retryDelay);
            }
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log('main', '主流程-致命错误', `运行机器人时发生致命错误: ${errorMessage}`, 'error');
        process.exit(1);
    }
}

main().catch(error => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log('main', '主流程-致命错误', `运行机器人时发生致命错误: ${errorMessage}`, 'error');
    process.exit(1);
});