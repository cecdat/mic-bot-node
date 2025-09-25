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

import { accountStatusManager } from './util/AccountStatusManager';
import { aiOrchestrator } from './util/AIOrcestrator';
import { FailedTaskManager } from './util/FailedTaskManager';
import { Login } from './functions/Login';
import { Workers } from './functions/Workers';
import Activities from './functions/Activities';
import { LoginExceptionHandlerManager } from './handlers/LoginExceptionHandlerManager';
import { PageExceptionDetector, PageExceptionResult } from './handlers/PageExceptionDetector';
import Axios from './util/Axios';
import { Account } from './interface/Account';
import axios from 'axios';
import { Config } from './interface/Config'; 
import { displayVersion, getVersionManager } from './util/Version'; 

// 添加全局变量跟踪任务运行状态
let isTaskRunning = false;
let shouldStopTask = false;
let lastConfirmedCommand: string | null = null;
let failedTaskManager: FailedTaskManager | null = null;
let config: any = null; // 全局配置变量

// 任务执行隔离机制
let taskExecutionLock = false; // 防止重复执行任务
let taskExecutionQueue: any[] = []; // 任务执行队列

// 积分停滞检测相关
interface AccountStagnationData {
    email: string;
    desktopStagnationCount: number;
    mobileStagnationCount: number;
    lastDesktopPoints: number;
    lastMobilePoints: number;
    desktopCompleted: boolean;
    mobileCompleted: boolean;
}

let accountStagnationMap = new Map<string, AccountStagnationData>();

/**
 * 初始化失败任务管理器
 */
function initializeFailedTaskManager(sessionPath: string): void {
    if (!failedTaskManager) {
        // 使用会话模式：重启后丢弃失败任务
        failedTaskManager = new FailedTaskManager(sessionPath, 3, true);
        log('main', '失败任务管理', '失败任务管理器已初始化（会话模式）');
    }
}

/**
 * 初始化账户停滞检测数据
 */
function initializeAccountStagnationData(accounts: Account[]): void {
    accountStagnationMap.clear();
    for (const account of accounts) {
        accountStagnationMap.set(account.email, {
            email: account.email,
            desktopStagnationCount: 0,
            mobileStagnationCount: 0,
            lastDesktopPoints: 0,
            lastMobilePoints: 0,
            desktopCompleted: false,
            mobileCompleted: false
        });
    }
    log('main', '停滞检测', `已初始化 ${accounts.length} 个账户的停滞检测数据`);
}

/**
 * 分析页面异常情况（人机验证等）
 */
async function analyzePageForExceptions(page: any, account: Account, taskType: 'desktop' | 'mobile'): Promise<boolean> {
    try {
        const currentUrl = page.url();
        const pageTitle = await page.title();
        
        log('main', '页面分析', `[${account.email}] 分析 ${taskType} 页面异常情况...`);
        log('main', '页面分析', `[${account.email}] 当前URL: ${currentUrl}`);
        log('main', '页面分析', `[${account.email}] 页面标题: ${pageTitle}`);
        
        // 检查是否有人机验证页面
        const captchaIndicators = [
            'captcha',
            'verification',
            'verify',
            'challenge',
            'robot',
            'bot',
            'security',
            'suspicious',
            'unusual',
            'activity'
        ];
        
        const titleLower = pageTitle.toLowerCase();
        const urlLower = currentUrl.toLowerCase();
        
        for (const indicator of captchaIndicators) {
            if (titleLower.includes(indicator) || urlLower.includes(indicator)) {
                log('main', '页面分析', `[${account.email}] ⚠️ 检测到可能的验证页面: ${indicator}`, 'warn');
                return true;
            }
        }
        
        // 检查页面内容中的验证相关元素
        try {
            const captchaElements = await page.$$('[class*="captcha"], [id*="captcha"], [class*="verification"], [id*="verification"]');
            if (captchaElements.length > 0) {
                log('main', '页面分析', `[${account.email}] ⚠️ 检测到验证相关元素`, 'warn');
                return true;
            }
        } catch (error) {
            // 忽略元素查找错误
        }
        
        log('main', '页面分析', `[${account.email}] ✅ 页面分析正常，未发现异常`);
        return false;
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log('main', '页面分析', `[${account.email}] 页面分析出错: ${errorMessage}`, 'warn');
        return false;
    }
}

/**
 * 检查积分是否停滞
 */
function checkPointsStagnation(account: Account, taskType: 'desktop' | 'mobile', currentPoints: number): boolean {
    const stagnationData = accountStagnationMap.get(account.email);
    if (!stagnationData) {
        return false;
    }
    
    let lastPoints: number;
    let stagnationCount: number;
    
    if (taskType === 'desktop') {
        lastPoints = stagnationData.lastDesktopPoints;
        stagnationCount = stagnationData.desktopStagnationCount;
    } else {
        lastPoints = stagnationData.lastMobilePoints;
        stagnationCount = stagnationData.mobileStagnationCount;
    }
    
    // 检查积分是否变化
    if (currentPoints === lastPoints) {
        stagnationCount++;
        log('main', '停滞检测', `[${account.email}] ${taskType} 积分停滞: ${currentPoints} (连续 ${stagnationCount} 轮)`);
        
        if (taskType === 'desktop') {
            stagnationData.desktopStagnationCount = stagnationCount;
        } else {
            stagnationData.mobileStagnationCount = stagnationCount;
        }
        
        // 连续3轮停滞
        if (stagnationCount >= 3) {
            log('main', '停滞检测', `[${account.email}] ⚠️ ${taskType} 积分连续 ${stagnationCount} 轮停滞，需要切换任务类型`, 'warn');
            return true;
        }
    } else {
        // 积分有变化，重置停滞计数
        if (taskType === 'desktop') {
            stagnationData.desktopStagnationCount = 0;
            stagnationData.lastDesktopPoints = currentPoints;
        } else {
            stagnationData.mobileStagnationCount = 0;
            stagnationData.lastMobilePoints = currentPoints;
        }
        log('main', '停滞检测', `[${account.email}] ${taskType} 积分变化: ${lastPoints} → ${currentPoints}，重置停滞计数`);
    }
    
    return false;
}

/**
 * 获取账户应该执行的任务类型
 */
function getAccountTaskType(account: Account): 'desktop' | 'mobile' | 'skip' {
    const stagnationData = accountStagnationMap.get(account.email);
    if (!stagnationData) {
        return 'desktop'; // 默认执行桌面端
    }
    
    // 如果桌面端已完成，执行移动端
    if (stagnationData.desktopCompleted && !stagnationData.mobileCompleted) {
        log('main', '任务选择', `[${account.email}] 🔄 桌面端已完成，切换到移动端任务`);
        return 'mobile';
    }
    
    // 如果移动端已完成，执行桌面端
    if (stagnationData.mobileCompleted && !stagnationData.desktopCompleted) {
        log('main', '任务选择', `[${account.email}] 🔄 移动端已完成，切换到桌面端任务`);
        return 'desktop';
    }
    
    // 如果都已完成，跳过
    if (stagnationData.desktopCompleted && stagnationData.mobileCompleted) {
        log('main', '任务选择', `[${account.email}] ✅ 所有任务已完成，跳过`);
        return 'skip';
    }
    
    // 检查停滞情况，优先执行未停滞的任务类型
    if (stagnationData.desktopStagnationCount >= 3 && !stagnationData.mobileCompleted) {
        log('main', '任务选择', `[${account.email}] ⚠️ 桌面端停滞（${stagnationData.desktopStagnationCount}轮），切换到移动端任务`);
        return 'mobile';
    }
    
    if (stagnationData.mobileStagnationCount >= 3 && !stagnationData.desktopCompleted) {
        log('main', '任务选择', `[${account.email}] ⚠️ 移动端停滞（${stagnationData.mobileStagnationCount}轮），切换到桌面端任务`);
        return 'desktop';
    }
    
    // 默认执行桌面端
    log('main', '任务选择', `[${account.email}] 🖥️ 默认执行桌面端任务`);
    return 'desktop';
}

/**
 * 添加失败任务
 */
function addFailedTask(accountEmail: string, taskType: 'search' | 'mobile' | 'desktop', reason: string, taskData?: any): void {
    if (!failedTaskManager) {
        log('main', '失败任务管理', '失败任务管理器未初始化', 'warn');
        return;
    }

    failedTaskManager.addFailedTask({
        accountEmail,
        taskType,
        reason,
        maxRetries: 3,
        taskData
    });
}

/**
 * 重试失败任务
 */
async function retryFailedTasks(accountEmail: string): Promise<{ success: number; failed: number }> {
    if (!failedTaskManager) {
        log('main', '失败任务管理', '失败任务管理器未初始化', 'warn');
        return { success: 0, failed: 0 };
    }

    log('main', '失败任务管理', `开始重试账户 ${accountEmail} 的失败任务`);

    const result = await failedTaskManager.retryFailedTasksForAccount(accountEmail, async (task) => {
        try {
            log('main', '失败任务管理', `重试任务: ${task.taskType} - ${task.reason}`);
            
            // 根据任务类型执行重试
            switch (task.taskType) {
                case 'search':
                    return await retrySearchTask(task);
                case 'mobile':
                    return await retryMobileTask(task);
                case 'desktop':
                    return await retryDesktopTask(task);
                default:
                    log('main', '失败任务管理', `未知任务类型: ${task.taskType}`, 'warn');
                    return false;
            }
        } catch (error) {
            log('main', '失败任务管理', `重试任务异常: ${error}`, 'error');
            return false;
        }
    });

    log('main', '失败任务管理', `账户 ${accountEmail} 重试完成: 成功 ${result.success} 个，失败 ${result.failed} 个`);
    return result;
}

/**
 * 重试搜索任务
 */
async function retrySearchTask(task: any): Promise<boolean> {
    try {
        log('main', '失败任务管理', `重试搜索任务: ${task.reason}`);
        
        // 创建新的bot实例来执行重试
        const bot = new MicrosoftRewardsBot();
        bot.account = { email: task.accountEmail } as any;
        
        // 初始化失败任务管理器
        bot.workers.initializeFailedTaskManager(bot.config.sessionPath);
        
        // 根据任务数据执行重试
        if (task.taskData && task.taskData.activity) {
            const activity = task.taskData.activity;
            
            // 启动浏览器
            const browser = await bot.browserFactory.launchBrowser(bot.account);
            const context = await bot.browserFactory.createContext(browser, bot.account);
            bot.homePage = await context.newPage();
            
            try {
                // 登录
                await bot.login.login(bot.homePage, bot.account.email, bot.account.password);
                
                // 执行搜索任务
                let success = false;
                if (activity.promotionType === 'urlreward' && activity.name && activity.name.toLowerCase().includes('exploreonbing')) {
                    success = await bot.workers.executeSearchOnBingActivity(bot.homePage, activity);
                } else {
                    success = await bot.workers.executeUrlRewardActivity(bot.homePage, activity);
                }
                
                if (success) {
                    log('main', '失败任务管理', `重试搜索任务成功: ${task.accountEmail}`);
                } else {
                    log('main', '失败任务管理', `重试搜索任务失败: ${task.accountEmail}`, 'warn');
                }
                
                return success;
                
            } finally {
                // 关闭浏览器
                if (bot.homePage && bot.homePage.context()) {
                    await bot.homePage.context().close();
                }
            }
        } else {
            log('main', '失败任务管理', `重试搜索任务缺少任务数据: ${task.accountEmail}`, 'warn');
            return false;
        }
        
    } catch (error) {
        log('main', '失败任务管理', `重试搜索任务异常: ${error}`, 'error');
        return false;
    }
}

/**
 * 重试移动端任务
 */
async function retryMobileTask(task: any): Promise<boolean> {
    try {
        log('main', '失败任务管理', `重试移动端任务: ${task.reason}`);
        
        // 创建新的bot实例来执行重试
        const bot = new MicrosoftRewardsBot();
        bot.account = { email: task.accountEmail } as any;
        
        // 初始化失败任务管理器
        bot.workers.initializeFailedTaskManager(bot.config.sessionPath);
        
        // 启动移动端浏览器
        // 启动移动端浏览器
        bot.isMobile = true;
        const browser = await bot.browserFactory.launchBrowser(bot.account);
        const context = await bot.browserFactory.createContext(browser, bot.account);
        bot.homePage = await context.newPage();
        
        try {
            // 登录
            await bot.login.login(bot.homePage, bot.account.email, bot.account.password);
            
            // 执行移动端任务
            const activities = new Activities(bot);
            // 移动端任务执行逻辑
            const dashboardData = await bot.browser.func.getDashboardData(bot.homePage);
            await activities.doSearch(bot.homePage, dashboardData, bot.account.email);
            const success = true;
            
            if (success) {
                log('main', '失败任务管理', `重试移动端任务成功: ${task.accountEmail}`);
            } else {
                log('main', '失败任务管理', `重试移动端任务失败: ${task.accountEmail}`, 'warn');
            }
            
            return success;
            
        } finally {
            // 关闭浏览器
            if (bot.homePage && bot.homePage.context()) {
                await bot.homePage.context().close();
            }
        }
        
    } catch (error) {
        log('main', '失败任务管理', `重试移动端任务异常: ${error}`, 'error');
        return false;
    }
}

/**
 * 重试桌面端任务
 */
async function retryDesktopTask(task: any): Promise<boolean> {
    try {
        log('main', '失败任务管理', `重试桌面端任务: ${task.reason}`);
        
        // 创建新的bot实例来执行重试
        const bot = new MicrosoftRewardsBot();
        bot.account = { email: task.accountEmail } as any;
        
        // 初始化失败任务管理器
        bot.workers.initializeFailedTaskManager(bot.config.sessionPath);
        
        // 启动桌面端浏览器
        // 启动桌面端浏览器
        bot.isMobile = false;
        const browser = await bot.browserFactory.launchBrowser(bot.account);
        const context = await bot.browserFactory.createContext(browser, bot.account);
        bot.homePage = await context.newPage();
        
        try {
            // 登录
            await bot.login.login(bot.homePage, bot.account.email, bot.account.password);
            
            // 执行桌面端任务
            const activities = new Activities(bot);
            // 桌面端任务执行逻辑
            const dashboardData = await bot.browser.func.getDashboardData(bot.homePage);
            await activities.doSearch(bot.homePage, dashboardData, bot.account.email);
            const success = true;
            
            if (success) {
                log('main', '失败任务管理', `重试桌面端任务成功: ${task.accountEmail}`);
            } else {
                log('main', '失败任务管理', `重试桌面端任务失败: ${task.accountEmail}`, 'warn');
            }
            
            return success;
            
        } finally {
            // 关闭浏览器
            if (bot.homePage && bot.homePage.context()) {
                await bot.homePage.context().close();
            }
        }
        
    } catch (error) {
        log('main', '失败任务管理', `重试桌面端任务异常: ${error}`, 'error');
        return false;
    }
}

// 添加服务端状态跟踪
let serverOffline = false;
let lastServerErrorTime = 0;
let lastRecoveryLogTime = 0; // 上次服务端恢复日志时间

// 添加全局错误抑制机制
let lastHeartbeatErrorTime = 0;
let lastStatusSyncErrorTime = 0;
let lastHeartbeatSuccessTime = 0;
const ERROR_SUPPRESS_INTERVAL = 60000; // 60秒错误抑制间隔，减少日志频率
const HEARTBEAT_SUCCESS_INTERVAL = 600000; // 10分钟心跳成功日志间隔，进一步减少日志
const RECOVERY_LOG_INTERVAL = 300000; // 5分钟服务端恢复日志间隔

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
    
    // 房间状态跟踪
    private isRoomJoined: boolean = false;
    private lastRoomJoinTime: number = 0;
    private roomJoinCooldown: number = 30000; // 30秒冷却期，减少等待时间

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
            this.processQueue(); // 处理队列中的消息
            
            // 连接成功后延迟尝试加入房间，确保节点注册完成
            setTimeout(() => {
                log('main', 'WebSocket', '🏠 连接成功后延迟尝试加入节点房间...');
                this.joinNodeRoom();
            }, 3000); // 3秒后尝试加入房间，给节点注册更多时间
            
            // 确保连接后立即检查任务
            setTimeout(() => {
                if (globalWebSocketTask) {
                    log('main', 'WebSocket', '🔍 连接后检查到待处理任务，准备执行');
                }
            }, 1000);
        });

        this.socket.on('disconnect', () => {
            log('main', 'WebSocket', '❌ WebSocket连接断开');
            this.isConnected = false;
            this.resetRoomStatus(); // 重置房间状态
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

        this.socket.on('room_joined', (data: any) => {
            log('main', 'WebSocket', `🏠 成功加入节点房间: ${JSON.stringify(data)}`);
            this.isRoomJoined = true;
        });

        this.socket.on('room_join_failed', (data: any) => {
            log('main', 'WebSocket', `❌ 加入节点房间失败: ${JSON.stringify(data)}`, 'error');
            this.isRoomJoined = false;
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

        this.socket.on('warning', (data: any) => {
            log('main', 'WebSocket', `⚠️ WebSocket警告: ${data.message || JSON.stringify(data)}`, 'warn');
        });

        this.socket.on('upgrade_command', (data: any) => {
            log('main', 'WebSocket', `🔄 收到升级命令: ${JSON.stringify(data)}`);
            // 将升级命令存储到全局变量，让主循环处理
            globalWebSocketTask = {
                task_id: data.upgrade_id,
                command: 'UPGRADE',
                command_data: data,
                node_name: this.config.apiServer?.nodeName || 'unknown'
            };
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
     * 检查是否需要加入房间
     */
    shouldJoinRoom(): boolean {
        const now = Date.now();
        return !this.isRoomJoined || (now - this.lastRoomJoinTime) > this.roomJoinCooldown;
    }

    /**
     * 加入节点房间
     */
    joinNodeRoom() {
        if (!this.shouldJoinRoom()) {
            const timeSinceLastJoin = Date.now() - this.lastRoomJoinTime;
            const remainingCooldown = this.roomJoinCooldown - timeSinceLastJoin;
            log('main', 'WebSocket', `⏳ 房间加入冷却中，剩余 ${Math.ceil(remainingCooldown / 1000)} 秒`, 'warn');
            return;
        }
        
        if (!this.isConnected) {
            log('main', 'WebSocket', '❌ WebSocket未连接，无法加入房间', 'warn');
            return;
        }
        
        if (!this.config.apiServer || !this.config.apiServer.nodeName) {
            log('main', 'WebSocket', '❌ 节点名称未配置，无法加入房间', 'warn');
            return;
        }
        
        log('main', 'WebSocket', `🏠 正在加入节点房间: ${this.config.apiServer.nodeName}`);
        
        this.safeEmit('join_node_room', {
            node_name: this.config.apiServer.nodeName
        });
        this.isRoomJoined = true;
        this.lastRoomJoinTime = Date.now();
        log('main', 'WebSocket', '📡 节点房间加入请求已发送');
    }

    /**
     * 重置房间状态（连接断开时）
     */
    resetRoomStatus() {
        this.isRoomJoined = false;
        this.lastRoomJoinTime = 0;
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
        accounts: [] as Array<{email: string, points_gained: number, final_points: number, desktop_gain: number, mobile_gain: number}>
    };
    
    try {
        shouldStopTask = false; // 重置停止标志

        // 重新加载远程配置，确保获取最新的交叉执行设置
        try {
            const nodeConfig = await loadNodeConfig();
            if (nodeConfig) {
                // 更新全局配置中的交叉执行设置
                config.search_cross_execution = nodeConfig.search_cross_execution;
                log('main', '主流程', `🔄 重新加载远程配置: search_cross_execution = ${nodeConfig.search_cross_execution}`);
            }
        } catch (error) {
            log('main', '主流程', `⚠️ 重新加载远程配置失败: ${error}`, 'warn');
        }

        // 使用全局的 config 变量（已经包含远程配置）
        const accounts = await loadAccounts();
        if (accounts.length > 0) {
            // 初始化失败任务管理器
            initializeFailedTaskManager(config.sessionPath);
            
            await runHotSearchScript(accounts);
            
            // 检查是否启用搜索任务交叉执行
            const searchCrossExecution = (config as any).search_cross_execution || false;
            
            // 添加调试日志
            log('main', '主流程', `🔍 调试: config.search_cross_execution = ${(config as any).search_cross_execution}`);
            log('main', '主流程', `🔍 调试: searchCrossExecution = ${searchCrossExecution}`);
            log('main', '主流程', `🔍 调试: typeof searchCrossExecution = ${typeof searchCrossExecution}`);
            
            // 判断是否应该使用交叉执行模式
            const shouldUseCrossExecution = await shouldEnableCrossExecution(accounts, config, searchCrossExecution);
            
            if (shouldUseCrossExecution) {
                log('main', '主流程', '🔄 启用搜索任务交叉执行模式');
                
                // 发送任务开始执行事件
                if (wsClient && wsClient.connected) {
                    wsClient.emitTaskStatusUpdate('cross_execution', 'executing', config.nodeName);
                }
                
                await executeTasksWithCrossExecution(accounts, config, taskResult);
                
                // 发送任务完成事件
                if (wsClient && wsClient.connected) {
                    wsClient.emitTaskStatusUpdate('cross_execution', 'completed', config.nodeName, taskResult);
                }
                        } else {
                log('main', '主流程', '📋 使用传统顺序执行模式');
                
                // 发送任务开始执行事件
                if (wsClient && wsClient.connected) {
                    wsClient.emitTaskStatusUpdate('sequential_execution', 'executing', config.nodeName);
                }
                
                await executeTasksSequentially(accounts, config, taskResult);
                
                // 发送任务完成事件
                if (wsClient && wsClient.connected) {
                    wsClient.emitTaskStatusUpdate('sequential_execution', 'completed', config.nodeName, taskResult);
                }
            }
            
            // 更新任务结果
            taskResult.account_count = taskResult.accounts.length;
            log('main', '主流程', '所有账户任务执行完成');
            
            // 执行全局失败任务重试
            try {
                if (failedTaskManager) {
                    // 清理过期任务
                    failedTaskManager.cleanupExpiredTasks();
                    
                    const globalRetryResult = await failedTaskManager.retryAllFailedTasks(async (task) => {
                        try {
                            log('main', '失败任务管理', `全局重试任务: ${task.taskType} - ${task.reason}`);
                            
                            // 根据任务类型执行重试
                            switch (task.taskType) {
                                case 'search':
                                    return await retrySearchTask(task);
                                case 'mobile':
                                    return await retryMobileTask(task);
                                case 'desktop':
                                    return await retryDesktopTask(task);
                                default:
                                    log('main', '失败任务管理', `未知任务类型: ${task.taskType}`, 'warn');
                                    return false;
                            }
                        } catch (error) {
                            log('main', '失败任务管理', `全局重试任务异常: ${error}`, 'error');
                            return false;
                        }
                    });
                    
                    if (globalRetryResult.success > 0 || globalRetryResult.failed > 0) {
                        log('main', '主流程', `全局失败任务重试完成: 成功 ${globalRetryResult.success} 个，失败 ${globalRetryResult.failed} 个`);
                    }
                    
                    // 输出失败任务统计
                    const stats = failedTaskManager.getFailedTaskStats();
                    if (stats.total > 0) {
                        log('main', '失败任务管理', `当前失败任务统计: 总计 ${stats.total} 个`);
                        log('main', '失败任务管理', `按账户分布: ${JSON.stringify(stats.byAccount)}`);
                        log('main', '失败任务管理', `按类型分布: ${JSON.stringify(stats.byType)}`);
                    }
                }
            } catch (error) {
                log('main', '主流程', `全局失败任务重试异常: ${error}`, 'warn');
            }
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
 * 执行升级命令 - 容器内升级
 */
async function executeUpgrade(upgradeData: any) {
    const { upgrade_id, upgrade_type = 'files', file_url, file_name } = upgradeData;
    const config = loadConfig();
    
    try {
        log('main', '升级', `开始执行升级: ${upgrade_type}`);
        
        // 发送升级状态更新
        if (wsClient && wsClient.connected) {
            wsClient.safeEmit('upgrade_status', {
                node_id: config.apiServer?.nodeName || 'unknown',
                upgrade_id,
                status: 'started',
                progress: 0,
                message: '开始升级...'
            });
        }
        
        // 发送进度更新
        if (wsClient && wsClient.connected) {
            wsClient.safeEmit('upgrade_status', {
                node_id: config.apiServer?.nodeName || 'unknown',
                upgrade_id,
                status: 'preparing',
                progress: 10,
                message: '准备升级文件...'
            });
        }
        
        // 1. 备份当前配置
        log('main', '升级', '备份当前配置...');
        try {
            await execCommand('cp /app/dist/config.json /tmp/config.json.backup');
            log('main', '升级', '配置文件备份完成');
        } catch (error) {
            log('main', '升级', `备份配置失败: ${error}`, 'warn');
        }
        
        // 发送进度更新
        if (wsClient && wsClient.connected) {
            wsClient.safeEmit('upgrade_status', {
                node_id: config.apiServer?.nodeName || 'unknown',
                upgrade_id,
                status: 'downloading',
                progress: 20,
                message: '下载升级文件...'
            });
        }
        
        // 2. 根据升级类型处理文件
        let needRebuild = false;
        let needRestart = true;
        
        if (upgrade_type === 'zip') {
            // ZIP文件升级
            log('main', '升级', 'ZIP文件升级...');
            try {
                // 下载ZIP文件
                const downloadResult = await execCommand(`wget -O /tmp/upgrade.zip "${file_url}"`);
                log('main', '升级', `下载结果: ${downloadResult}`);
                
                // 解压ZIP文件
                const unzipResult = await execCommand('cd /tmp && unzip -o upgrade.zip');
                log('main', '升级', `解压结果: ${unzipResult}`);
                
                // 检查是否包含TypeScript源码
                const hasTsFiles = await execCommand('find /tmp -name "*.ts" | head -1').then(() => true).catch(() => false);
                const hasDistFiles = await execCommand('find /tmp -path "*/dist/*" -name "*.js" | head -1').then(() => true).catch(() => false);
                
                if (hasTsFiles) {
                    // 包含TypeScript源码，需要重新构建
                    log('main', '升级', '检测到TypeScript源码，需要重新构建...');
                    needRebuild = true;
                    
                    // 复制源码到临时目录
                    await execCommand('cp -r /tmp/src /tmp/build-src');
                    await execCommand('cp /tmp/package*.json /tmp/build-src/');
                    await execCommand('cp /tmp/tsconfig.json /tmp/build-src/');
                    
                    // 构建新代码
                    const buildResult = await execCommand('cd /tmp/build-src && npm install && npm run build');
                    log('main', '升级', `构建结果: ${buildResult}`);
                    
                    // 复制构建后的文件
                    const copyResult = await execCommand('cp -r /tmp/build-src/dist/* /app/dist/');
                    log('main', '升级', `复制文件结果: ${copyResult}`);
                    
                } else if (hasDistFiles) {
                    // 包含编译后的文件，直接复制
                    log('main', '升级', '检测到编译后文件，直接复制...');
                    const copyResult = await execCommand('cp -r /tmp/dist/* /app/dist/');
                    log('main', '升级', `复制文件结果: ${copyResult}`);
                } else {
                    // 其他文件，直接复制到dist目录
                    const copyResult = await execCommand('cp -r /tmp/* /app/dist/');
                    log('main', '升级', `复制文件结果: ${copyResult}`);
                }
                
            } catch (error) {
                log('main', '升级', `ZIP升级失败: ${error}`, 'error');
                throw error;
            }
        } else if (upgrade_type === 'file') {
            // 单个文件升级
            log('main', '升级', '单个文件升级...');
            try {
                // 下载文件
                const downloadResult = await execCommand(`wget -O /tmp/${file_name} "${file_url}"`);
                log('main', '升级', `下载结果: ${downloadResult}`);
                
                // 检查文件类型
                if (file_name.endsWith('.ts')) {
                    // TypeScript文件，需要重新构建
                    log('main', '升级', '检测到TypeScript文件，需要重新构建...');
                    needRebuild = true;
                    
                    // 复制文件到临时构建目录
                    await execCommand('mkdir -p /tmp/build-src');
                    await execCommand(`cp /tmp/${file_name} /tmp/build-src/`);
                    await execCommand('cp -r /app/dist/* /tmp/build-src/');
                    await execCommand('cp /app/package*.json /tmp/build-src/');
                    await execCommand('cp /app/tsconfig.json /tmp/build-src/');
                    
                    // 构建新代码
                    const buildResult = await execCommand('cd /tmp/build-src && npm install && npm run build');
                    log('main', '升级', `构建结果: ${buildResult}`);
                    
                    // 复制构建后的文件
                    const copyResult = await execCommand('cp -r /tmp/build-src/dist/* /app/dist/');
                    log('main', '升级', `复制文件结果: ${copyResult}`);
                    
                } else if (file_name.endsWith('.json')) {
                    // 配置文件，直接复制
                    log('main', '升级', '检测到配置文件，直接复制...');
                    const copyResult = await execCommand(`cp /tmp/${file_name} /app/dist/`);
                    log('main', '升级', `复制文件结果: ${copyResult}`);
                    needRestart = false; // 配置文件通常不需要重启
                    
                } else {
                    // JavaScript文件，直接复制
                    log('main', '升级', '检测到JavaScript文件，直接复制...');
                    const copyResult = await execCommand(`cp /tmp/${file_name} /app/dist/`);
                    log('main', '升级', `复制文件结果: ${copyResult}`);
                }
                
            } catch (error) {
                log('main', '升级', `文件升级失败: ${error}`, 'error');
                throw error;
            }
        } else if (upgrade_type === 'git') {
            // Git拉取升级
            log('main', '升级', 'Git拉取升级...');
            try {
                // 备份当前代码
                await execCommand('cp -r /app/dist /tmp/dist.backup');
                
                // 拉取最新代码
                const gitResult = await execCommand('cd /tmp && git clone https://github.com/your-repo/mic-bot-node.git temp-repo');
                log('main', '升级', `Git拉取结果: ${gitResult}`);
                
                // 构建新代码
                const buildResult = await execCommand('cd /tmp/temp-repo && npm install && npm run build');
                log('main', '升级', `构建结果: ${buildResult}`);
                needRebuild = true;
                
                // 复制新文件
                const copyResult = await execCommand('cp -r /tmp/temp-repo/dist/* /app/dist/');
                log('main', '升级', `复制文件结果: ${copyResult}`);
                
                // 清理临时文件
                await execCommand('rm -rf /tmp/temp-repo /tmp/dist.backup');
                
            } catch (error) {
                log('main', '升级', `Git升级失败: ${error}`, 'error');
                throw error;
            }
        }
        
        // 发送进度更新
        if (wsClient && wsClient.connected) {
            let status = 'restoring';
            let message = '恢复配置文件...';
            let progress = 70;
            
            if (needRebuild) {
                status = 'building';
                message = '重新构建应用...';
                progress = 60;
            }
            
            wsClient.safeEmit('upgrade_status', {
                node_id: config.apiServer?.nodeName || 'unknown',
                upgrade_id,
                status: status,
                progress: progress,
                message: message
            });
        }
        
        // 3. 恢复配置文件
        log('main', '升级', '恢复配置文件...');
        try {
            await execCommand('cp /tmp/config.json.backup /app/dist/config.json');
            log('main', '升级', '配置文件恢复完成');
        } catch (error) {
            log('main', '升级', `恢复配置失败: ${error}`, 'warn');
        }
        
        // 发送进度更新
        if (wsClient && wsClient.connected) {
            wsClient.safeEmit('upgrade_status', {
                node_id: config.apiServer?.nodeName || 'unknown',
                upgrade_id,
                status: 'verifying',
                progress: 85,
                message: '验证升级结果...'
            });
        }
        
        // 4. 验证升级结果
        log('main', '升级', '验证升级结果...');
        try {
            // 检查文件是否存在
            const checkResult = await execCommand('ls -la /app/dist/');
            log('main', '升级', `文件检查结果: ${checkResult}`);
            
            // 清理临时文件
            await execCommand('rm -f /tmp/config.json.backup /tmp/upgrade.zip /tmp/*.js');
            
        } catch (error) {
            log('main', '升级', `验证升级失败: ${error}`, 'warn');
        }
        
        // 发送完成状态
        if (wsClient && wsClient.connected) {
            wsClient.safeEmit('upgrade_status', {
                node_id: config.apiServer?.nodeName || 'unknown',
                upgrade_id,
                status: 'completed',
                progress: 100,
                message: '升级完成'
            });
        }
        
        log('main', '升级', '升级执行完成');
        
        // 5. 根据升级类型决定是否需要重启
        if (needRestart) {
            if (needRebuild) {
                log('main', '升级', '已重新构建，5秒后退出当前进程，让新代码生效...');
            } else {
                log('main', '升级', '已替换文件，5秒后退出当前进程，让新代码生效...');
            }
            setTimeout(() => {
                process.exit(0);
            }, 5000);
        } else {
            log('main', '升级', '配置文件已更新，无需重启进程');
        }
        
    } catch (error) {
        log('main', '升级', `升级执行失败: ${error}`, 'error');
        
        // 发送失败状态
        if (wsClient && wsClient.connected) {
            wsClient.safeEmit('upgrade_status', {
                node_id: config.apiServer?.nodeName || 'unknown',
                upgrade_id,
                status: 'failed',
                progress: 0,
                message: `升级失败: ${error}`
            });
        }
        
        throw error;
    }
}

/**
 * 执行系统命令
 */
async function execCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const { exec } = require('child_process');
        exec(command, { timeout: 300000 }, (error: any, stdout: string, stderr: string) => {
            if (error) {
                reject(new Error(`命令执行失败: ${error.message}\n${stderr}`));
            } else {
                resolve(stdout);
            }
        });
    });
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
    
    try {
        log('main', '任务隔离', `🚀 开始执行隔离任务: ${task.task_id} (${task.command})`);
        
        // 设置任务运行状态并上报
        isTaskRunning = true;
        await updateActivityStatus('Running');
        
        // 尝试发送状态更新，但不依赖WebSocket连接
        if (wsClient && wsClient.connected) {
            wsClient.emitTaskStatusUpdate(task.task_id, 'executing', task.node_name);
        }
        // 静默处理WebSocket未连接的情况，减少日志输出
        
        // 根据命令类型执行相应任务
        let taskResult = {
            success: true,
            account_count: 0,
            total_points: 0,
            accounts: [] as Array<{email: string, points_gained: number, final_points: number, desktop_gain: number, mobile_gain: number}>
        };
        
        if (task.command === 'RUN_TASKS') {
            taskResult = await executeTasks();
        } else if (task.command === 'RUN_TASK') {
            await executeSingleTask(task.command_data);
        }
        
        // 任务完成 - 尝试发送完成状态，但不依赖WebSocket连接
        if (wsClient && wsClient.connected) {
            wsClient.emitTaskStatusUpdate(task.task_id, 'completed', task.node_name, taskResult);
        }
        // 静默处理WebSocket未连接的情况，减少日志输出
        
        log('main', '任务隔离', `✅ 隔离任务完成: ${task.task_id}`);
        
        // 立即处理队列中的下一个任务
        if (taskExecutionQueue.length > 0) {
            const nextTask = taskExecutionQueue.shift();
            log('main', '任务隔离', `🔄 处理队列中的下一个任务: ${nextTask.task_id}`);
            // 递归处理下一个任务
            setTimeout(() => executeTaskIsolated(nextTask), 1000);
        }
        
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

        // 抑制频繁的心跳发送日志 - 只在待机状态下进一步减少日志
        const now = Date.now();
        if (now - lastHeartbeatSuccessTime > HEARTBEAT_SUCCESS_INTERVAL) {
            // 在待机状态下，进一步减少心跳日志
            if (!isTaskRunning) {
                // 待机状态下，每20分钟才输出一次心跳日志
                if (now - lastHeartbeatSuccessTime > 1200000) {
                    log('main', '节点管理', `📡 节点待机中，心跳正常: ${apiConfig.nodeName}`);
                }
            } else {
                // 任务执行状态下，正常输出心跳日志
            log('main', '节点管理', `📡 向中心服务器签到/发送心跳: ${apiConfig.nodeName}`);
            log('main', '节点管理', `🌐 服务地址: ${checkinUrl.toString()}`);
            }
        }
        
        await axios.post(checkinUrl.toString(), payload, {
            headers: { 'Authorization': `Bearer ${apiConfig.token}` },
            timeout: 30000 // 30秒超时
        });
        
        // 节点注册成功后，确保WebSocket房间已加入（作为备用机制）
        if (wsClient && wsClient.connected) {
            // 检查是否已经加入房间，如果没有则尝试加入
            if (!wsClient.isRoomJoined) {
                log('main', '节点管理', '🏠 节点注册成功，延迟1秒后确保WebSocket房间已加入...');
                // 添加延迟，确保服务端数据库事务已提交
                setTimeout(() => {
                    if (wsClient && wsClient.connected && !wsClient.isRoomJoined) {
                        wsClient.joinNodeRoom();
                    }
                }, 1000); // 1秒延迟
            } else {
                log('main', '节点管理', '✅ WebSocket房间已加入，无需重复加入');
            }
        }
        
        // 检查服务端是否从离线状态恢复 - 抑制重复的恢复日志
        if (serverOffline) {
            const offlineDuration = Math.round((Date.now() - lastServerErrorTime) / 1000);
            const now = Date.now();
            
            // 抑制频繁的恢复日志，每5分钟最多输出一次
            if (now - lastRecoveryLogTime > RECOVERY_LOG_INTERVAL) {
            log('main', '节点管理', `🔄 服务端已恢复！离线时长: ${offlineDuration}秒`, 'warn');
                lastRecoveryLogTime = now;
            }
            
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
        
        // 使用正确的配置文件路径
        let configPath: string;
        try {
            const config = loadConfig();
            // 尝试多个可能的配置文件路径
            const possiblePaths = [
                path.join('/app', 'config.json'),            // 容器环境
                path.join(process.cwd(), 'config.json'),     // 当前工作目录
                path.join(baseDir, 'config.json'),           // dist目录
                'config.json'                                 // 相对路径
            ];
            
            configPath = possiblePaths.find(p => fs.existsSync(p)) || possiblePaths[0];
            log('main', '热搜脚本', `使用配置文件路径: ${configPath}`);
        } catch (error) {
            // 如果loadConfig失败，使用默认路径
            configPath = path.join('/app', 'config.json');
            log('main', '热搜脚本', `配置文件加载失败，使用默认路径: ${configPath}`, 'warn');
        }
        
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
    public browserFactory: Browser = new Browser(this);
    public workers: Workers;
    public login: Login;
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
        
        // 初始化失败任务管理器
        this.workers.initializeFailedTaskManager(this.config.sessionPath);
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
            let initialData;
            let retryCount = 0;
            const maxRetries = 3;
            
            while (retryCount < maxRetries) {
                try {
                    initialData = await this.browser.func.getDashboardData(page);
                    if (initialData && initialData.userStatus && initialData.userStatus.availablePoints !== undefined) {
                        break;
                    } else {
                        throw new Error('仪表板数据不完整');
                    }
                } catch (error) {
                    retryCount++;
                    log(this.isMobile, '主流程', `[${account.email}] 获取初始积分失败 (${retryCount}/${maxRetries}): ${error}`, 'warn');
                    if (retryCount >= maxRetries) {
                        throw new Error(`获取初始积分失败，已重试${maxRetries}次`);
                    }
                    await page.waitForTimeout(2000); // 等待2秒后重试
                }
            }
            
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
            
            // 获取最终积分，添加重试机制
            let finalData;
            let finalRetryCount = 0;
            const maxFinalRetries = 3;
            
            while (finalRetryCount < maxFinalRetries) {
                try {
                    finalData = await this.browser.func.getDashboardData(page);
                    if (finalData && finalData.userStatus && finalData.userStatus.availablePoints !== undefined) {
                        break;
                    } else {
                        throw new Error('最终仪表板数据不完整');
                    }
                } catch (error) {
                    finalRetryCount++;
                    log(this.isMobile, '主流程', `[${account.email}] 获取最终积分失败 (${finalRetryCount}/${maxFinalRetries}): ${error}`, 'warn');
                    if (finalRetryCount >= maxFinalRetries) {
                        throw new Error(`获取最终积分失败，已重试${maxFinalRetries}次`);
                    }
                    await page.waitForTimeout(2000);
                }
            }
            
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
            
            // 获取移动端最终积分，添加重试机制
            let finalData;
            let mobileFinalRetryCount = 0;
            const maxMobileFinalRetries = 3;
            
            while (mobileFinalRetryCount < maxMobileFinalRetries) {
                try {
                    finalData = await this.browser.func.getDashboardData(page);
                    if (finalData && finalData.userStatus && finalData.userStatus.availablePoints !== undefined) {
                        break;
                    } else {
                        throw new Error('移动端最终仪表板数据不完整');
                    }
                } catch (error) {
                    mobileFinalRetryCount++;
                    log(this.isMobile, '主流程', `[${account.email}] 获取移动端最终积分失败 (${mobileFinalRetryCount}/${maxMobileFinalRetries}): ${error}`, 'warn');
                    if (mobileFinalRetryCount >= maxMobileFinalRetries) {
                        throw new Error(`获取移动端最终积分失败，已重试${maxMobileFinalRetries}次`);
                    }
                    await page.waitForTimeout(2000);
                }
            }
            
            const finalPoints = finalData.userStatus.availablePoints;
            
            // 计算移动端收益：基于桌面端完成后的积分
            const mobileGain = finalPoints - mobileInitialPoints;
            
            log(true, '主流程', `[${account.email}] 移动端完成 - 初始: ${mobileInitialPoints}, 最终: ${finalPoints}, 收益: ${mobileGain}`);
            
            // 保存移动端完成后的最终积分
            const todayStr = this.utils.getYYYYMMDD();
            await saveDailyPoints(this.config.sessionPath, account.email, {
                date: todayStr,
                initialPoints: mobileInitialPoints, // 使用桌面端完成后的积分作为初始值
                desktopFinalPoints: mobileInitialPoints, // 桌面端完成后的积分（mobileInitialPoints就是桌面端完成后的积分）
                mobileFinalPoints: finalPoints // 新增：移动端完成后的最终积分
            });
            log(true, '主流程', `[${account.email}] 已保存移动端完成后的最终积分: ${finalPoints}`);
            
            return { points: finalPoints, gain: mobileGain };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log(true, '主流程', `[${account.email}] 移动端任务执行出错: ${errorMessage}`, 'error');
            
            // 记录详细的错误信息
            log(true, '主流程', `[${account.email}] 移动端任务执行失败，详细错误: ${errorMessage}`, 'error');
            
            // 即使出错也返回桌面端的积分，确保流程继续
            log(true, '主流程', `[${account.email}] 移动端任务失败，返回桌面端积分: ${desktopFinalPoints}`);
            
            // 保存移动端任务失败时的积分状态
            const todayStr = this.utils.getYYYYMMDD();
            await saveDailyPoints(this.config.sessionPath, account.email, {
                date: todayStr,
                initialPoints: desktopFinalPoints, // 使用桌面端完成后的积分作为初始值
                desktopFinalPoints: desktopFinalPoints, // 桌面端完成后的积分
                mobileFinalPoints: desktopFinalPoints // 移动端失败，最终积分等于桌面端积分
            });
            log(true, '主流程', `[${account.email}] 已保存移动端任务失败时的积分状态: ${desktopFinalPoints}`);
            
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

            // 修复积分计算逻辑：即使初始积分为0，也要计算实际收益
            let dailyGain = 0;
            if (initialPointsToday > 0) {
                dailyGain = finalPoints - initialPointsToday;
            } else if (finalPoints > 0) {
                // 如果初始积分为0但最终积分大于0，说明有收益
                dailyGain = finalPoints;
            }
            
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
        config = loadConfig();
        
        // 检测进程类型（主进程还是子进程）
        const isMainProcess = !process.env.ACCOUNT && !process.env.TASK_TYPE;
        
        // 只在主进程中显示完整的启动信息
        if (isMainProcess) {
            // 显示版本信息
            displayVersion();
            
            log('main', '启动', '🚀 Mic-Bot Node 正在启动...');
            log('main', '启动', `📋 节点名称: ${config.apiServer?.nodeName || '未配置'}`);
            log('main', '启动', `🌐 服务地址: ${config.apiServer?.updateUrl || '未配置'}`);
            log('main', '启动', `🔑 API Token: ${config.apiServer?.token ? '已配置' : '未配置'}`);
            // 显示实际的心跳间隔配置
            const heartbeatInterval = config.apiServer?.heartbeatInterval || '5m';
            log('main', '启动', `💓 心跳间隔: ${heartbeatInterval}`);
        }

        // 启动日志服务器



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
                    search_cross_execution: nodeConfig.search_cross_execution,
                };

                if (isMainProcess) {
                    log('main', '启动', '✅ 已成功加载远程节点配置');
                    log('main', '启动', `⚙️ 服务端并发配置: ${(nodeConfig as any).clusters || '未配置'}`);
                    log('main', '启动', `🔍 搜索延迟: ${nodeConfig.search_delay_min || '2s'} - ${nodeConfig.search_delay_max || '5s'}`);
                    log('main', '启动', `🔄 交叉执行配置: ${nodeConfig.search_cross_execution ? '已启用' : '未启用'}`);
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
        const maxLoopInterval = 600000; // 10分钟最大循环间隔
        
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
                    
                    // 检查是否与当前正在执行的任务冲突
                    if (isTaskRunning) {
                        log('main', '主流程', `⚠️ 有任务正在执行中，将WebSocket任务加入队列: ${task.task_id}`, 'warn');
                        // 将任务加入队列，等待当前任务完成
                        taskExecutionQueue.push(task);
                    } else {
                        // 使用隔离执行函数，确保任务执行不受WebSocket连接状态影响
                        log('main', '主流程', `🚀 立即执行WebSocket任务: ${task.task_id} (${task.command})`);
                        executeTaskIsolated(task);
                    }
                }
                
                // 如果使用WebSocket调度且连接正常，跳过轮询
                if (useWebSocketScheduling && wsClient && wsClient.connected) {
                    // 检查是否有待处理的WebSocket任务
                    if (globalWebSocketTask) {
                        const task = globalWebSocketTask;
                        globalWebSocketTask = null; // 清除任务
                        log('main', '主流程', `📋 收到WebSocket任务: ${task.task_id} (${task.command})`);
                        if (isTaskRunning) {
                            log('main', '主流程', `⚠️ 有任务正在执行中，将WebSocket任务加入队列: ${task.task_id}`, 'warn');
                            taskExecutionQueue.push(task);
                        } else {
                            log('main', '主流程', `🚀 立即执行WebSocket任务: ${task.task_id} (${task.command})`);
                            executeTaskIsolated(task);
                        }
                    }
                    await new Promise(resolve => setTimeout(resolve, 1000)); // 减少等待时间到1秒，提高响应性
                    continue;
                }
                // 重置连续错误计数
                consecutiveErrors = 0;
                
                // 如果之前有连续错误，记录恢复信息
                if (consecutiveErrors === 0) {
                    // 这里不需要额外日志，因为consecutiveErrors已经重置了
                }
                // [修复] 移除错误的状态健康检查逻辑
                // 原来的逻辑会错误地重置任务状态，导致任务执行时显示Idle
                // 任务状态应该只在主循环的finally块中重置
                
                // 移除长轮询请求指令的日志，减少非关键信息输出
                const commandUrl = new URL(config.apiServer.updateUrl);
                commandUrl.pathname = '/bot_api/command_poll';

                const response = await axios.get(commandUrl.toString(), {
                    headers: { 'Authorization': `Bearer ${config.apiServer.token}` },
                    timeout: 120000  // 增加超时时间到120秒，减少误报
                });

                const command = response.data.command;

                // 检查服务端是否从离线状态恢复 - 抑制重复的恢复日志
                if (serverOffline) {
                    const offlineDuration = Math.round((Date.now() - lastServerErrorTime) / 1000);
                    const now = Date.now();
                    
                    // 抑制频繁的恢复日志，每5分钟最多输出一次
                    if (now - lastRecoveryLogTime > RECOVERY_LOG_INTERVAL) {
                    log('main', '主流程', `🔄 服务端已恢复！离线时长: ${offlineDuration}秒`, 'warn');
                        lastRecoveryLogTime = now;
                    }
                    
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
                } else if (command === 'UPGRADE') {
                    log('main', '主流程', '收到 [升级] 指令，开始执行升级...', 'warn');
                    // 立即更新活动状态为Idle，停止当前任务
                    shouldStopTask = true;
                    await updateActivityStatus('Idle');
                    isTaskRunning = false;
                    
                    // 执行升级
                    try {
                        const upgradeData = response.data.data;
                        await executeUpgrade(upgradeData);
                        log('main', '主流程', '升级执行完成', 'warn');
                    } catch (error) {
                        log('main', '主流程', `升级执行失败: ${error}`, 'error');
                    }
                    
                    // 向服务端确认命令已执行
                    await confirmCommandToServer('UPGRADE');
                    log('main', '主流程', '升级命令处理完成', 'warn');
                } else if (command === 'RESTART_SERVICE') {
                    log('main', '主流程', '🔄 收到 [重启服务] 指令，准备重启...', 'warn');
                    
                    // 记录重启信息
                    const restartInfo = {
                        restart_time: new Date().toISOString(),
                        restart_reason: 'manual_restart',
                        node_name: config.apiServer?.nodeName || 'unknown',
                        current_tasks: isTaskRunning ? 'running' : 'idle'
                    };
                    log('main', '主流程', `📋 重启信息: ${JSON.stringify(restartInfo)}`, 'log');
                    
                    // 立即更新活动状态为Idle，停止当前任务
                    shouldStopTask = true;
                    await updateActivityStatus('Idle');
                    isTaskRunning = false;
                    
                    // 向服务端确认命令已执行
                    await confirmCommandToServer('RESTART_SERVICE');
                    
                    // 发送重启状态到WebSocket
                    if (wsClient && wsClient.connected) {
                        wsClient.safeEmit('restart_status', {
                            node_id: config.apiServer?.nodeName || 'unknown',
                            status: 'restarting',
                            message: '节点正在重启服务',
                            restart_time: restartInfo.restart_time
                        });
                    }
                    
                    log('main', '主流程', '⏰ 服务将在3秒后重启...', 'warn');
                    setTimeout(() => {
                        log('main', '主流程', '🚀 正在重启服务...', 'warn');
                        log('main', '主流程', '👋 再见！', 'log');
                        process.exit(0); // 退出进程，让容器重启
                    }, 3000);
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
                        retryDelay = 10000; // 超时错误重试间隔增加到10秒
                        
                        // 进一步抑制超时错误日志，减少待机状态下的日志噪音
                        if (consecutiveErrors % 20 === 1) { // 每20次超时才记录一次，进一步减少日志噪音
                            log('main', '主流程', `长轮询超时 (${consecutiveErrors}次)，网络可能较慢`, 'warn');
                        } else if (consecutiveErrors % 100 === 1) { // 每100次超时记录一次详细信息
                            log('main', '主流程', `长轮询持续超时 (${consecutiveErrors}次)，建议检查网络连接`, 'warn');
                        }
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
                const isTimeoutError = axios.isAxiosError(error) && (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT');
                
                // 对于超时错误，使用更宽松的抑制策略，进一步减少待机状态下的日志
                if (isTimeoutError) {
                    // 超时错误每10次才记录一次，或者距离上次记录超过5分钟
                    if (consecutiveErrors % 10 === 1 || errorTime - lastServerErrorTime > 300000) {
                    log('main', '主流程', `主循环出错 (${consecutiveErrors}/${maxConsecutiveErrors}): ${errorMessage}`, 'warn');
                        lastServerErrorTime = errorTime;
                    }
                } else if (errorTime - lastServerErrorTime > ERROR_SUPPRESS_INTERVAL) {
                    log('main', '主流程', `主循环出错 (${consecutiveErrors}/${maxConsecutiveErrors}): ${errorMessage}`, 'warn');
                    lastServerErrorTime = errorTime;
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
                
                // 等待指定时间后重试 - 抑制频繁的等待日志
                const waitTime = retryDelay/1000;
                const isTimeoutErrorForWait = axios.isAxiosError(error) && (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT');
                
                // 只在非超时错误或长时间等待时才输出等待日志
                if (!isTimeoutErrorForWait || waitTime >= 30) {
                    log('main', '主流程', `等待${waitTime}秒后重试...`);
                }
                await utils.wait(retryDelay);
            }
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log('main', '主流程-致命错误', `运行机器人时发生致命错误: ${errorMessage}`, 'error');
        process.exit(1);
    }
}

/**
 * 传统顺序执行模式：每个账户先完成桌面端，再完成移动端
 */
async function executeTasksSequentially(accounts: Account[], config: Config, taskResult: any) {
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
        
        // 处理积分统计和上报
        const accountResult = await processAccountPoints(account, config, todayStr, initialPointsToday);
        if (accountResult) {
            taskResult.accounts.push(accountResult);
            taskResult.total_points += accountResult.points_gained;
        }
        
        log('main', '主流程', `账户 ${account.email} 所有任务执行完成`);
        
        // 重试该账户的失败任务
        await retryAccountFailedTasks(account.email);
    }
}

/**
 * 交叉执行模式：按账户轮询执行搜索任务
 */
async function executeTasksWithCrossExecution(accounts: Account[], config: Config, taskResult: any) {
    log('main', '主流程', '开始分阶段交叉执行模式：先完成移动端签到阅读，再进行搜索任务交叉运行...');
    
    // 初始化所有账户的积分数据和停滞检测数据
    const accountPointsData = new Map<string, {initialPoints: number, todayStr: string}>();
    initializeAccountStagnationData(accounts);
    
    for (const account of accounts) {
        const todayStr = new Util().getYYYYMMDD();
        const dailyPointsData = await loadDailyPoints(config.sessionPath, account.email);
        let initialPointsToday = 0;
        
        if (dailyPointsData && dailyPointsData.date === todayStr) {
            initialPointsToday = dailyPointsData.initialPoints;
        }
        
        accountPointsData.set(account.email, {
            initialPoints: initialPointsToday,
            todayStr: todayStr
        });
        
        log('main', '主流程', `[${account.email}] 初始化积分: ${initialPointsToday}`);
    }
    
    // 第一阶段：所有账户完成移动端签到和阅读任务
    log('main', '主流程', '📱 第一阶段：开始执行所有账户的移动端签到和阅读任务...');
    await executeAllAccountsMobileCheckInAndReadTasks(accounts, config, accountPointsData);
    
    // 第二阶段：搜索任务交叉运行
    log('main', '主流程', '🔄 第二阶段：开始搜索任务交叉运行...');
    await executeSmartCrossSearchTasks(accounts, config, accountPointsData);
    
    // 处理所有账户的积分统计和上报
    for (const account of accounts) {
        const pointsData = accountPointsData.get(account.email);
        if (pointsData) {
            const accountResult = await processAccountPoints(account, config, pointsData.todayStr, pointsData.initialPoints);
            if (accountResult) {
                taskResult.accounts.push(accountResult);
                taskResult.total_points += accountResult.points_gained;
            }
        }
    }
    
    // 所有任务完成后，统一重试失败任务
    log('main', '主流程', '🔄 开始重试所有失败任务...');
    for (const account of accounts) {
        await retryAccountFailedTasks(account.email);
    }
    log('main', '主流程', '✅ 失败任务重试完成');
    
    log('main', '主流程', '智能交叉执行模式完成');
}

/**
 * 第一阶段：执行所有账户的移动端签到和阅读任务
 */
async function executeAllAccountsMobileCheckInAndReadTasks(
    accounts: Account[], 
    config: Config, 
    accountPointsData: Map<string, {initialPoints: number, todayStr: string}>
) {
    log('main', '主流程', `📱 开始执行 ${accounts.length} 个账户的移动端签到和阅读任务`);
    
    for (const account of accounts) {
        if (shouldStopTask) {
            log('main', '主流程', `检测到停止指令，终止移动端签到阅读任务`, 'warn');
            return;
        }
        
        log('main', '主流程', `[${account.email}] 开始执行移动端签到和阅读任务`);
        
        // 创建浏览器实例
        const bot = new MicrosoftRewardsBot();
        bot.account = account;
        bot.axios = new Axios(account.proxy);
        bot.isMobile = true;
        
        let browser: any = null;
        let context: any = null;
        
        try {
            browser = await bot.browserFactory.launchBrowser(account);
            
            try {
                context = await bot.browserFactory.createContext(browser, account);
                const page = await context.newPage();
                
                try {
                    // 激活会话状态
                    log('main', '主流程', `[${account.email}] 激活会话状态...`);
                    await page.goto('https://rewards.bing.com', { waitUntil: 'domcontentloaded' });
                    await page.waitForTimeout(2000);
                    
                    // 执行登录流程
                    try {
                        await bot.login.login(page, account.email, account.password);
                        log('main', '主流程', `[${account.email}] 登录流程完成`);
                    } catch (loginError) {
                        const errorMessage = loginError instanceof Error ? loginError.message : String(loginError);
                        log('main', '主流程', `[${account.email}] 登录失败: ${errorMessage}，跳过移动端签到阅读任务`, 'warn');
                        continue;
                    }
                    
                    // 获取初始数据
                    const initialData = await bot.browser.func.getDashboardData(page);
                    
                    // 获取移动端访问令牌
                    let accessToken: string | null = null;
                    try {
                        const tokenPage = await context.newPage();
                        try { 
                            accessToken = await bot.login.getMobileAccessToken(tokenPage, account.email); 
                            log('main', '主流程', `[${account.email}] 成功获取移动端访问令牌`);
                        } catch (tokenError) {
                            const errorMessage = tokenError instanceof Error ? tokenError.message : String(tokenError);
                            log('main', '主流程', `[${account.email}] 获取移动端访问令牌失败: ${errorMessage}`, 'warn');
                        } finally { 
                            await tokenPage.close(); 
                        }
                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        log('main', '主流程', `[${account.email}] 移动端访问令牌获取过程出错: ${errorMessage}`, 'warn');
                    }
                    
                    // 执行移动端每日签到任务
                    if (accessToken && bot.config.workers.doDailyCheckIn) {
                        try {
                            log('main', '主流程', `[${account.email}] 开始执行移动端每日签到任务`);
                            const checkInResult = await bot.activities.doDailyCheckIn(accessToken, initialData);
                            log('main', '主流程', `[${account.email}] 移动端每日签到任务执行完成: ${JSON.stringify(checkInResult)}`);
                        } catch (error) {
                            const errorMessage = error instanceof Error ? error.message : String(error);
                            log('main', '主流程', `[${account.email}] 每日签到任务执行失败: ${errorMessage}`, 'warn');
                        }
                    } else if (!accessToken && bot.config.workers.doDailyCheckIn) {
                        log('main', '主流程', `[${account.email}] 跳过移动端每日签到任务（访问令牌获取失败）`, 'warn');
                    }
                    
                    // 执行移动端阅读赚积分任务
                    if (accessToken && bot.config.workers.doReadToEarn) {
                        try {
                            log('main', '主流程', `[${account.email}] 开始执行移动端阅读赚积分任务`);
                            await bot.activities.doReadToEarn(accessToken, initialData);
                            log('main', '主流程', `[${account.email}] 移动端阅读赚积分任务执行完成`);
                        } catch (error) {
                            const errorMessage = error instanceof Error ? error.message : String(error);
                            log('main', '主流程', `[${account.email}] 阅读赚积分任务执行失败: ${errorMessage}`, 'warn');
                        }
                    } else if (!accessToken && bot.config.workers.doReadToEarn) {
                        log('main', '主流程', `[${account.email}] 跳过移动端阅读赚积分任务（访问令牌获取失败）`, 'warn');
                    }
                    
                    // 获取移动端签到和阅读任务完成后的积分数据
                    const afterMobileTasksData = await bot.browser.func.getDashboardData(page);
                    if (afterMobileTasksData && afterMobileTasksData.userStatus) {
                        const currentTotalPoints = afterMobileTasksData.userStatus.availablePoints;
                        
                        // 保存移动端签到和阅读任务完成后的积分
                        const pointsData = accountPointsData.get(account.email);
                        if (pointsData) {
                            const todayStr = pointsData.todayStr;
                            const dailyPointsData = await loadDailyPoints(config.sessionPath, account.email);
                            
                            if (dailyPointsData && dailyPointsData.date === todayStr) {
                                // 如果还没有桌面端最终积分，将移动端签到阅读后的积分作为桌面端最终积分
                                if (dailyPointsData.desktopFinalPoints === undefined) {
                                    dailyPointsData.desktopFinalPoints = currentTotalPoints;
                                    log('main', '主流程', `[${account.email}] 保存移动端签到阅读后的积分作为桌面端最终积分: ${currentTotalPoints}`);
                                }
                                
                                await saveDailyPoints(config.sessionPath, account.email, dailyPointsData);
                            }
                        }
                    }
                    
                    log('main', '主流程', `[${account.email}] 移动端签到和阅读任务执行完成`);
                    
                } finally {
                    await page.close();
                }
            } finally {
                if (context) {
                    await context.close();
                }
            }
        } finally {
            if (browser) {
                await browser.close();
            }
        }
        
        // 账户间延迟
        if (!shouldStopTask) {
            await new Promise(resolve => setTimeout(resolve, 3000)); // 3秒延迟
        }
    }
    
    log('main', '主流程', '📱 所有账户的移动端签到和阅读任务执行完成');
}

/**
 * 智能交叉执行搜索任务：根据积分变化和完成状态动态切换任务类型
 */
async function executeSmartCrossSearchTasks(
    accounts: Account[], 
    config: Config, 
    accountPointsData: Map<string, {initialPoints: number, todayStr: string}>
) {
    const maxRounds = 20; // 增加最大轮数，因为现在需要处理更复杂的切换逻辑
    let currentRound = 0;
    let allCompleted = false;
    
    // 动态账户列表，会随着任务完成而减少
    let activeAccounts = [...accounts];
    
    while (currentRound < maxRounds && !allCompleted && !shouldStopTask && activeAccounts.length > 0) {
        currentRound++;
        log('main', '主流程', `🔄 开始第 ${currentRound} 轮智能交叉执行`);
        log('main', '主流程', `📊 当前活跃账户数量: ${activeAccounts.length}`);
        
        allCompleted = true;
        const completedAccounts: Account[] = []; // 本轮完成的账户
        
        for (const account of activeAccounts) {
            if (shouldStopTask) {
                log('main', '主流程', `检测到停止指令，终止智能交叉执行`, 'warn');
                return;
            }
            
            // 获取账户应该执行的任务类型
            const taskType = getAccountTaskType(account);
            
            if (taskType === 'skip') {
                log('main', '主流程', `[${account.email}] 所有任务已完成，跳过`);
                completedAccounts.push(account);
                continue;
            }
            
            log('main', '主流程', `[${account.email}] 开始第 ${currentRound} 轮 ${taskType} 任务`);
            
            try {
                // 执行单个账户的一轮搜索任务
                const isTaskCompleted = await runSingleAccountSearchTaskWithStagnationCheck(
                    account, 
                    config, 
                    taskType, 
                    accountPointsData, 
                    currentRound === 1 // 第一轮进行完整登录检查
                );
                
                if (isTaskCompleted) {
                    // 标记该任务类型为已完成
                    const stagnationData = accountStagnationMap.get(account.email);
                    if (stagnationData) {
                        if (taskType === 'desktop') {
                            stagnationData.desktopCompleted = true;
                        } else {
                            stagnationData.mobileCompleted = true;
                        }
                        
                        // 检查是否所有任务都已完成
                        if (stagnationData.desktopCompleted && stagnationData.mobileCompleted) {
                            log('main', '主流程', `[${account.email}] 🎉 所有任务已完成（桌面端+移动端），从活跃列表中移除`);
                            completedAccounts.push(account);
                        } else {
                            if (taskType === 'desktop' && stagnationData.desktopCompleted) {
                                log('main', '主流程', `[${account.email}] ✅ 桌面端任务已完成，下一轮将执行移动端任务`);
                            } else if (taskType === 'mobile' && stagnationData.mobileCompleted) {
                                log('main', '主流程', `[${account.email}] ✅ 移动端任务已完成，下一轮将执行桌面端任务`);
                            } else {
                                log('main', '主流程', `[${account.email}] ✅ ${taskType} 任务已完成，继续参与下一轮`);
                            }
                            allCompleted = false;
                        }
                    }
                } else {
                    log('main', '主流程', `[${account.email}] 第 ${currentRound} 轮 ${taskType} 任务完成，继续参与下一轮`);
                    allCompleted = false; // 有未完成的任务，需要继续下一轮
                }
            } catch (error) {
                log('main', '主流程', `[${account.email}] 第 ${currentRound} 轮 ${taskType} 任务失败: ${error}`, 'error');
                allCompleted = false; // 有失败的任务，需要继续下一轮
            }
            
            // 添加轮次间延迟
            if (!shouldStopTask) {
                await new Promise(resolve => setTimeout(resolve, 2000)); // 2秒延迟
            }
        }
        
        // 从活跃账户列表中移除已完成的账户
        activeAccounts = activeAccounts.filter(account => !completedAccounts.includes(account));
        
        if (!allCompleted) {
            log('main', '主流程', `第 ${currentRound} 轮智能交叉执行完成，有未完成任务，继续下一轮`);
        } else {
            log('main', '主流程', `第 ${currentRound} 轮智能交叉执行完成，所有任务成功`);
        }
        
        // 如果所有账户都完成了任务，退出循环
        if (activeAccounts.length === 0) {
            log('main', '主流程', `🎉 所有账户的所有任务都已完成，退出智能交叉执行`);
            break;
        }
    }
    
    if (currentRound >= maxRounds) {
        log('main', '主流程', `⚠️ 智能交叉执行达到最大轮数限制 (${maxRounds})，停止执行`, 'warn');
    }
}

/**
 * 执行单个账户的一轮搜索任务（带停滞检测）
 */
async function runSingleAccountSearchTaskWithStagnationCheck(
    account: Account, 
    config: Config, 
    taskType: 'desktop' | 'mobile',
    accountPointsData: Map<string, {initialPoints: number, todayStr: string}>,
    shouldCheckLogin: boolean = true
): Promise<boolean> {
    log('main', '主流程', `[${account.email}] 开始执行 ${taskType} 搜索任务（带停滞检测）`);
    
    try {
        // 创建浏览器实例
        const bot = new MicrosoftRewardsBot();
        bot.account = account;
        bot.axios = new Axios(account.proxy); // 初始化axios实例
        
        // 根据任务类型设置移动端模式
        if (taskType === 'mobile') {
            bot.isMobile = true;
            log('main', '主流程', `[${account.email}] 设置为移动端模式`);
        } else {
            bot.isMobile = false;
            log('main', '主流程', `[${account.email}] 设置为桌面端模式`);
        }
        
        const browser = await bot.browserFactory.launchBrowser(account);
        
        try {
            const context = await bot.browserFactory.createContext(browser, account);
            const page = await context.newPage();
            
            try {
                // 激活会话状态
                log('main', '主流程', `[${account.email}] 激活会话状态...`);
                await page.goto('https://rewards.bing.com', { waitUntil: 'domcontentloaded' });
                await page.waitForTimeout(2000);
                
                // 检测并处理 chrome-error 页面
                const rewardsUrl = page.url();
                if (rewardsUrl.includes('chrome-error://') || rewardsUrl.includes('chromewebdata')) {
                    log('main', '主流程', `[${account.email}] 检测到 chrome-error 页面: ${rewardsUrl}，尝试恢复...`, 'warn');
                    const recovered = await bot.browser.func.handleChromeError(page, 'https://rewards.bing.com');
                    if (!recovered) {
                        log('main', '主流程', `[${account.email}] 无法从 chrome-error 页面恢复，跳过此账户`, 'error');
                        return false;
                    }
                }
                
                // 根据参数决定是否进行登录检查
                if (shouldCheckLogin) {
                    log('main', '主流程', `[${account.email}] 执行完整登录流程（包含登录检查）`);
                    await bot.login.login(page, account.email, account.password);
                } else {
                    log('main', '主流程', `[${account.email}] 跳过登录检查，直接使用现有会话`);
                    // 直接调用 login 方法，它会内部处理登录状态检查
                    // 如果已经登录，login 方法会快速返回
                    await bot.login.login(page, account.email, account.password);
                }
                
                // 登录完成后获取执行前的积分状态
                let beforePoints = 0;
                try {
                    const beforeDashboardData = await bot.browser.func.getDashboardData(page);
                    if (taskType === 'desktop') {
                        beforePoints = beforeDashboardData.userStatus.counters.pcSearch?.[0]?.pointProgress || 0;
                    } else {
                        beforePoints = beforeDashboardData.userStatus.counters.mobileSearch?.[0]?.pointProgress || 0;
                    }
                    log('main', '主流程', `[${account.email}] 执行前 ${taskType} 积分: ${beforePoints}`);
                } catch (error) {
                    log('main', '主流程', `[${account.email}] 获取执行前积分失败: ${error}`, 'warn');
                    beforePoints = 0;
                }
                
                // 跳转到 Bing 搜索页面
                log('main', '主流程', `[${account.email}] 跳转到 Bing 搜索页面...`);
                await page.goto('https://www.bing.com', { waitUntil: 'domcontentloaded' });
                await page.waitForTimeout(5000);
                
                // 验证页面跳转是否成功
                const currentUrl = page.url();
                if (currentUrl.includes('rewards.bing.com')) {
                    log('main', '主流程', `[${account.email}] 检测到仍在 Rewards 页面，强制跳转到 Bing 搜索页面...`);
                    await page.goto('https://www.bing.com', { waitUntil: 'networkidle' });
                    await page.waitForTimeout(3000);
                }
                
                // 执行任务
                if (taskType === 'desktop') {
                    // 执行桌面端搜索任务
                    log('main', '主流程', `[${account.email}] 开始执行桌面端搜索任务...`);
                    await bot.workers.executeSearchOnBingActivity(page, {
                        title: '智能交叉执行桌面端搜索',
                        promotionType: 'urlreward',
                        name: 'exploreonbing'
                    });
                } else {
                    // 移动端只执行搜索任务（签到和阅读任务已在第一阶段完成）
                    log('main', '主流程', `[${account.email}] 开始执行移动端搜索任务（带停滞检测）`);
                    
                    // 获取初始数据
                    const initialData = await bot.browser.func.getDashboardData(page);
                    
                    // 执行移动端搜索任务
                    if (bot.config.workers.doMobileSearch) {
                        if (initialData.userStatus.counters.mobileSearch) {
                            try {
                                log('main', '主流程', `[${account.email}] 开始执行移动端搜索任务`);
                                await bot.activities.doSearch(page, initialData, account.email);
                                log('main', '主流程', `[${account.email}] 移动端搜索任务执行完成`);
                            } catch (error) {
                                const errorMessage = error instanceof Error ? error.message : String(error);
                                log('main', '主流程', `[${account.email}] 移动端搜索任务执行失败: ${errorMessage}`, 'warn');
                            }
                        } else {
                            log('main', '主流程', `[${account.email}] 移动端搜索任务已完成或不可用`);
                        }
                    }
                    
                    // 执行移动端每日活动任务
                    if (bot.config.workers.doPunchCards || bot.config.workers.doDailyCheckIn) {
                        try {
                            log('main', '主流程', `[${account.email}] 开始执行移动端每日活动任务`);
                            
                            // 获取最新的任务数据
                            const currentData = await bot.browser.func.getDashboardData(page);
                            const allTasks = aiOrchestrator.getAllIncompleteTasks(currentData);
                            
                            if (allTasks.length > 0) {
                                log('main', '主流程', `[${account.email}] 发现 ${allTasks.length} 个未完成的每日活动任务`);
                                
                                const executionPlan = await aiOrchestrator.getTaskExecutionPlan(allTasks);
                                for (const task of executionPlan) {
                                    try {
                                        await bot.workers.executeSingleTask(page, task);
                                        log('main', '主流程', `[${account.email}] 移动端完成每日活动任务: ${task.title}`);
                                    } catch (taskError) {
                                        const taskErrorMessage = taskError instanceof Error ? taskError.message : String(taskError);
                                        log('main', '主流程', `[${account.email}] 移动端每日活动任务执行失败: ${task.title} - ${taskErrorMessage}`, 'warn');
                                    }
                                }
                            } else {
                                log('main', '主流程', `[${account.email}] 移动端没有未完成的每日活动任务`);
                            }
                        } catch (error) {
                            const errorMessage = error instanceof Error ? error.message : String(error);
                            log('main', '主流程', `[${account.email}] 移动端每日活动任务执行失败: ${errorMessage}`, 'warn');
                        }
                    }
                    
                    log('main', '主流程', `[${account.email}] 移动端完整任务流程执行完成（带停滞检测）`);
                }
                
                log('main', '主流程', `[${account.email}] ${taskType} 搜索任务完成`);
                
                // 获取执行后的积分状态
                const afterDashboardData = await bot.browser.func.getDashboardData(page);
                let afterPoints = 0;
                
                if (taskType === 'desktop') {
                    afterPoints = afterDashboardData.userStatus.counters.pcSearch?.[0]?.pointProgress || 0;
                } else {
                    afterPoints = afterDashboardData.userStatus.counters.mobileSearch?.[0]?.pointProgress || 0;
                }
                
                log('main', '主流程', `[${account.email}] 执行后 ${taskType} 积分: ${afterPoints}`);
                
                // 检查积分停滞情况
                const isStagnant = checkPointsStagnation(account, taskType, afterPoints);
                
                if (isStagnant) {
                    // 积分停滞，进行页面分析
                    log('main', '主流程', `[${account.email}] ⚠️ ${taskType} 积分停滞，进行页面分析...`, 'warn');
                    const hasException = await analyzePageForExceptions(page, account, taskType);
                    
                    if (hasException) {
                        log('main', '主流程', `[${account.email}] ⚠️ 检测到页面异常，暂停 ${taskType} 任务执行`, 'warn');
                        // 标记该任务类型为停滞状态，下一轮会切换到其他任务类型
                        return false;
                    }
                }
                
                // 保存积分数据
                const pointsData = accountPointsData.get(account.email);
                if (pointsData) {
                    const todayStr = pointsData.todayStr;
                    const dailyPointsData = await loadDailyPoints(config.sessionPath, account.email);
                    
                    if (dailyPointsData && dailyPointsData.date === todayStr) {
                        // 获取当前总积分，而不是任务积分
                        const currentTotalPoints = afterDashboardData.userStatus.availablePoints;
                        
                        // 添加调试日志
                        log('main', '主流程', `[${account.email}] 调试 - 获取到的总积分: ${currentTotalPoints}`);
                        log('main', '主流程', `[${account.email}] 调试 - 任务类型: ${taskType}`);
                        
                        if (taskType === 'desktop') {
                            dailyPointsData.desktopFinalPoints = currentTotalPoints;
                            log('main', '主流程', `[${account.email}] 保存桌面端完成后的总积分: ${currentTotalPoints}`);
                        } else {
                            dailyPointsData.mobileFinalPoints = currentTotalPoints;
                            log('main', '主流程', `[${account.email}] 保存移动端完成后的总积分: ${currentTotalPoints}`);
                        }
                        
                        await saveDailyPoints(config.sessionPath, account.email, dailyPointsData);
                    }
                }
                
                // 检查任务是否完成（积分是否达到上限）
                const isTaskCompleted = await checkTaskCompletion(account, taskType, accountPointsData);
                return isTaskCompleted;
                
            } finally {
                await page.close();
            }
            
        } finally {
            await browser.close();
        }
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log('main', '主流程', `[${account.email}] ${taskType} 搜索任务执行失败: ${errorMessage}`, 'error');
        return false;
    }
}

/**
 * 执行单个账户的一轮搜索任务（真正的交叉执行）
 */
async function runSingleAccountSearchTask(
    account: Account, 
    config: Config, 
    taskType: 'desktop' | 'mobile',
    accountPointsData: Map<string, {initialPoints: number, todayStr: string}>,
    shouldCheckLogin: boolean = true
): Promise<boolean> {
    log('main', '主流程', `[${account.email}] 开始执行 ${taskType} 搜索任务`);
    
    try {
        // 创建浏览器实例
        const bot = new MicrosoftRewardsBot();
        bot.account = account; // 设置当前账户信息
        bot.axios = new Axios(account.proxy); // 初始化axios实例
        
        // 根据任务类型设置移动端模式
        if (taskType === 'mobile') {
            bot.isMobile = true;
            log('main', '主流程', `[${account.email}] 设置为移动端模式`);
        } else {
            bot.isMobile = false;
            log('main', '主流程', `[${account.email}] 设置为桌面端模式`);
        }
        
        const browser = await bot.browserFactory.launchBrowser(account);
        
        try {
            // 创建上下文并加载会话数据
            const context = await bot.browserFactory.createContext(browser, account);
            
            const page = await context.newPage();
            
            try {
                        // 先访问一个页面来激活会话
                        log('main', '主流程', `[${account.email}] 激活会话状态...`);
                        await page.goto('https://rewards.bing.com', { waitUntil: 'domcontentloaded' });
                        await page.waitForTimeout(2000);
                        
                        // 根据参数决定是否进行登录检查
                        if (shouldCheckLogin) {
                            log('main', '主流程', `[${account.email}] 执行完整登录流程（包含登录检查）`);
                            await bot.login.login(page, account.email, account.password);
                        } else {
                            log('main', '主流程', `[${account.email}] 跳过登录检查，直接使用现有会话`);
                            // 简化逻辑：直接调用 login 方法，它会内部处理登录状态检查
                            // 如果已经登录，login 方法会快速返回
                            await bot.login.login(page, account.email, account.password);
                        }
                
                        // 跳转到 Bing 搜索页面
                        log('main', '主流程', `[${account.email}] 跳转到 Bing 搜索页面...`);
                        await page.goto('https://www.bing.com', { waitUntil: 'domcontentloaded' });
                        await page.waitForTimeout(5000);
                        
                        // 检测并处理 chrome-error 页面
                        const bingUrl = page.url();
                        if (bingUrl.includes('chrome-error://') || bingUrl.includes('chromewebdata')) {
                            log('main', '主流程', `[${account.email}] 检测到 chrome-error 页面: ${bingUrl}，尝试恢复...`, 'warn');
                            const recovered = await bot.browser.func.handleChromeError(page, 'https://www.bing.com');
                            if (!recovered) {
                                log('main', '主流程', `[${account.email}] 无法从 chrome-error 页面恢复，跳过此账户`, 'error');
                                return false;
                            }
                        }
                        
                        // 验证页面跳转是否成功
                        const finalUrl = page.url();
                        const pageTitle = await page.title();
                        log('main', '主流程', `[${account.email}] 跳转后URL: ${finalUrl}`);
                        log('main', '主流程', `[${account.email}] 跳转后标题: ${pageTitle}`);
                        
                        // 如果还在 Rewards 页面，强制跳转到 Bing 搜索页面
                        if (finalUrl.includes('rewards.bing.com')) {
                            log('main', '主流程', `[${account.email}] 检测到仍在 Rewards 页面，强制跳转到 Bing 搜索页面...`);
                            await page.goto('https://www.bing.com', { waitUntil: 'networkidle' });
                            await page.waitForTimeout(3000);
                            
                            const finalUrl = page.url();
                            const finalTitle = await page.title();
                            log('main', '主流程', `[${account.email}] 强制跳转后URL: ${finalUrl}`);
                            log('main', '主流程', `[${account.email}] 强制跳转后标题: ${finalTitle}`);
                        }
                        
                
                // 执行完整的搜索任务（真正的交叉执行）
                log('main', '主流程', `[${account.email}] 开始执行 ${taskType} 搜索任务...`);
                
                // 获取积分状态
                const dashboardData = await bot.browser.func.getDashboardData(page);
                if (taskType === 'desktop') {
                    log('main', '主流程', `[${account.email}] 当前桌面端积分状态: ${dashboardData.userStatus.counters.pcSearch?.[0]?.pointProgress || 0}/${dashboardData.userStatus.counters.pcSearch?.[0]?.pointProgressMax || 0}`);
                } else {
                    log('main', '主流程', `[${account.email}] 当前移动端积分状态: ${dashboardData.userStatus.counters.mobileSearch?.[0]?.pointProgress || 0}/${dashboardData.userStatus.counters.mobileSearch?.[0]?.pointProgressMax || 0}`);
                }
                
                // 根据任务类型执行相应的任务
                if (taskType === 'desktop') {
                    // 执行桌面端搜索任务
                    await bot.workers.executeSearchOnBingActivity(page, {
                        title: '交叉执行桌面端搜索',
                        promotionType: 'urlreward',
                        name: 'exploreonbing'
                    });
                } else {
                    // 移动端只执行搜索任务（签到和阅读任务已在第一阶段完成）
                    log('main', '主流程', `[${account.email}] 开始执行移动端搜索任务`);
                    
                    // 获取初始数据
                    const initialData = await bot.browser.func.getDashboardData(page);
                    
                    // 执行移动端搜索任务
                    if (bot.config.workers.doMobileSearch) {
                        if (initialData.userStatus.counters.mobileSearch) {
                            try {
                                log('main', '主流程', `[${account.email}] 开始执行移动端搜索任务`);
                                await bot.activities.doSearch(page, initialData, account.email);
                                log('main', '主流程', `[${account.email}] 移动端搜索任务执行完成`);
                            } catch (error) {
                                const errorMessage = error instanceof Error ? error.message : String(error);
                                log('main', '主流程', `[${account.email}] 移动端搜索任务执行失败: ${errorMessage}`, 'warn');
                            }
                        } else {
                            log('main', '主流程', `[${account.email}] 移动端搜索任务已完成或不可用`);
                        }
                    }
                    
                    // 执行移动端每日活动任务
                    if (bot.config.workers.doPunchCards || bot.config.workers.doDailyCheckIn) {
                        try {
                            log('main', '主流程', `[${account.email}] 开始执行移动端每日活动任务`);
                            
                            // 获取最新的任务数据
                            const currentData = await bot.browser.func.getDashboardData(page);
                            const allTasks = aiOrchestrator.getAllIncompleteTasks(currentData);
                            
                            if (allTasks.length > 0) {
                                log('main', '主流程', `[${account.email}] 发现 ${allTasks.length} 个未完成的每日活动任务`);
                                
                                const executionPlan = await aiOrchestrator.getTaskExecutionPlan(allTasks);
                                for (const task of executionPlan) {
                                    try {
                                        await bot.workers.executeSingleTask(page, task);
                                        log('main', '主流程', `[${account.email}] 移动端完成每日活动任务: ${task.title}`);
                                    } catch (taskError) {
                                        const taskErrorMessage = taskError instanceof Error ? taskError.message : String(taskError);
                                        log('main', '主流程', `[${account.email}] 移动端每日活动任务执行失败: ${task.title} - ${taskErrorMessage}`, 'warn');
                                    }
                                }
                            } else {
                                log('main', '主流程', `[${account.email}] 移动端没有未完成的每日活动任务`);
                            }
                        } catch (error) {
                            const errorMessage = error instanceof Error ? error.message : String(error);
                            log('main', '主流程', `[${account.email}] 移动端每日活动任务执行失败: ${errorMessage}`, 'warn');
                        }
                    }
                    
                    log('main', '主流程', `[${account.email}] 移动端完整任务流程执行完成`);
                }
                
                log('main', '主流程', `[${account.email}] ${taskType} 搜索任务完成`);
                
                // 保存积分数据
                const pointsData = accountPointsData.get(account.email);
                if (pointsData) {
                    const todayStr = pointsData.todayStr;
                    const dailyPointsData = await loadDailyPoints(config.sessionPath, account.email);
                    
                    if (dailyPointsData && dailyPointsData.date === todayStr) {
                        // 获取最新的积分状态
                        const latestDashboardData = await bot.browser.func.getDashboardData(page);
                        if (latestDashboardData && latestDashboardData.userStatus) {
                            // 保存总积分，而不是任务积分
                            const currentTotalPoints = latestDashboardData.userStatus.availablePoints;
                            
                            // 添加调试日志
                            log('main', '主流程', `[${account.email}] 调试 - 获取到的总积分: ${currentTotalPoints}`);
                            log('main', '主流程', `[${account.email}] 调试 - 任务类型: ${taskType}`);
                            
                            if (taskType === 'desktop') {
                                dailyPointsData.desktopFinalPoints = currentTotalPoints;
                                log('main', '主流程', `[${account.email}] 保存桌面端完成后的总积分: ${currentTotalPoints}`);
                            } else if (taskType === 'mobile') {
                                dailyPointsData.mobileFinalPoints = currentTotalPoints;
                                log('main', '主流程', `[${account.email}] 保存移动端完成后的总积分: ${currentTotalPoints}`);
                            }
                            
                            // 保存更新后的积分数据
                            await saveDailyPoints(config.sessionPath, account.email, dailyPointsData);
                        }
                    }
                }
                
                // 检查任务是否完成（积分是否达到上限）
                const isTaskCompleted = await checkTaskCompletion(account, taskType, accountPointsData);
                return isTaskCompleted;
                
            } finally {
                await page.close();
            }
            
        } finally {
            await browser.close();
        }
        
    } catch (error) {
        log('main', '主流程', `[${account.email}] ${taskType} 搜索任务失败: ${error}`, 'error');
        throw error;
    }
}

/**
 * 执行交叉搜索任务（包含登录流程）
 */
async function executeCrossSearchTasksWithLogin(
    accounts: Account[], 
    config: Config, 
    taskType: 'desktop' | 'mobile',
    accountPointsData: Map<string, {initialPoints: number, todayStr: string}>,
    skipLoginCheck: boolean = false
) {
    const maxRounds = 10; // 最大轮数，防止无限循环
    let currentRound = 0;
    let allCompleted = false;
    
    // 动态账户列表，会随着任务完成而减少
    let activeAccounts = [...accounts];
    
    while (currentRound < maxRounds && !allCompleted && !shouldStopTask && activeAccounts.length > 0) {
        currentRound++;
        log('main', '主流程', `🔄 开始第 ${currentRound} 轮 ${taskType} 交叉执行（包含登录流程）`);
        log('main', '主流程', `📊 当前活跃账户数量: ${activeAccounts.length}`);
        
        allCompleted = true;
        const completedAccounts: Account[] = []; // 本轮完成的账户
        
        for (const account of activeAccounts) {
            if (shouldStopTask) {
                log('main', '主流程', `检测到停止指令，终止 ${taskType} 交叉执行`, 'warn');
                return;
            }
            
            log('main', '主流程', `[${account.email}] 开始第 ${currentRound} 轮 ${taskType} 任务（包含登录流程）`);
            
            try {
                // 执行单个账户的一轮搜索任务（真正的交叉执行）
                // 第一轮进行完整登录检查，后续轮次跳过登录检查
                const shouldCheckLogin = !skipLoginCheck && currentRound === 1;
                const isTaskCompleted = await runSingleAccountSearchTask(account, config, taskType, accountPointsData, shouldCheckLogin);
                
                if (isTaskCompleted) {
                    log('main', '主流程', `[${account.email}] ${taskType} 任务已完成，从活跃列表中移除`);
                    completedAccounts.push(account);
                } else {
                    log('main', '主流程', `[${account.email}] 第 ${currentRound} 轮 ${taskType} 任务完成，继续参与下一轮`);
                    allCompleted = false; // 有未完成的任务，需要继续下一轮
                }
            } catch (error) {
                log('main', '主流程', `[${account.email}] 第 ${currentRound} 轮 ${taskType} 任务失败: ${error}`, 'error');
                allCompleted = false; // 有失败的任务，需要继续下一轮
            }
            
            // 添加轮次间延迟
            if (!shouldStopTask) {
                await new Promise(resolve => setTimeout(resolve, 2000)); // 2秒延迟
            }
        }
        
        // 从活跃账户列表中移除已完成的账户
        activeAccounts = activeAccounts.filter(account => !completedAccounts.includes(account));
        
        if (!allCompleted) {
            log('main', '主流程', `第 ${currentRound} 轮 ${taskType} 交叉执行完成，有失败任务，继续下一轮`);
        } else {
            log('main', '主流程', `第 ${currentRound} 轮 ${taskType} 交叉执行完成，所有任务成功`);
        }
        
        // 如果所有账户都完成了任务，退出循环
        if (activeAccounts.length === 0) {
            log('main', '主流程', `🎉 所有账户的 ${taskType} 任务都已完成，退出交叉执行`);
            break;
        }
    }
    
    if (currentRound >= maxRounds) {
        log('main', '主流程', `⚠️ ${taskType} 交叉执行达到最大轮数限制 (${maxRounds})，停止执行`, 'warn');
    }
}

/**
 * 检查任务是否完成（积分是否达到上限）
 */
async function checkTaskCompletion(account: Account, taskType: 'desktop' | 'mobile', accountPointsData: Map<string, {initialPoints: number, todayStr: string}>): Promise<boolean> {
    try {
        // 创建浏览器实例检查积分状态
        const bot = new MicrosoftRewardsBot();
        bot.account = account;
        
        // 根据任务类型设置移动端模式
        if (taskType === 'mobile') {
            bot.isMobile = true;
            log('main', '主流程', `[${account.email}] 检查移动端任务完成状态`);
        } else {
            bot.isMobile = false;
            log('main', '主流程', `[${account.email}] 检查桌面端任务完成状态`);
        }
        
        const browser = await bot.browserFactory.launchBrowser(account);
        
        try {
            const context = await bot.browserFactory.createContext(browser, account);
            const page = await context.newPage();
            
            try {
                // 访问 Rewards 页面获取积分状态
                await page.goto('https://rewards.bing.com', { waitUntil: 'domcontentloaded' });
                await page.waitForTimeout(2000);
                
                // 获取仪表板数据
                const dashboardData = await bot.browser.func.getDashboardData(page);
                if (dashboardData && dashboardData.userStatus && dashboardData.userStatus.counters) {
                    if (taskType === 'desktop') {
                        const pcSearch = dashboardData.userStatus.counters.pcSearch?.[0];
                        if (pcSearch) {
                            const isCompleted = pcSearch.pointProgress >= pcSearch.pointProgressMax;
                            log('main', '主流程', `[${account.email}] 桌面端积分状态: ${pcSearch.pointProgress}/${pcSearch.pointProgressMax} (${isCompleted ? '已完成' : '未完成'})`);
                            return isCompleted;
                        } else {
                            log('main', '主流程', `[${account.email}] 未找到桌面端搜索积分数据`, 'warn');
                            return false; // 未找到数据时假设未完成
                        }
                    } else if (taskType === 'mobile') {
                        const mobileSearch = dashboardData.userStatus.counters.mobileSearch?.[0];
                        if (mobileSearch) {
                            const isCompleted = mobileSearch.pointProgress >= mobileSearch.pointProgressMax;
                            log('main', '主流程', `[${account.email}] 移动端积分状态: ${mobileSearch.pointProgress}/${mobileSearch.pointProgressMax} (${isCompleted ? '已完成' : '未完成'})`);
                            return isCompleted;
                        } else {
                            log('main', '主流程', `[${account.email}] 未找到移动端搜索积分数据，检查桌面端数据作为备用`, 'warn');
                            // 如果移动端数据不可用，检查桌面端数据作为备用
                            const pcSearch = dashboardData.userStatus.counters.pcSearch?.[0];
                            if (pcSearch) {
                                const isCompleted = pcSearch.pointProgress >= pcSearch.pointProgressMax;
                                log('main', '主流程', `[${account.email}] 使用桌面端积分状态作为移动端参考: ${pcSearch.pointProgress}/${pcSearch.pointProgressMax} (${isCompleted ? '已完成' : '未完成'})`);
                                return isCompleted;
                            } else {
                                log('main', '主流程', `[${account.email}] 桌面端和移动端积分数据都不可用`, 'warn');
                                return false; // 未找到数据时假设未完成
                            }
                        }
                    }
                }
                
                log('main', '主流程', `[${account.email}] 无法获取 ${taskType} 积分状态，假设未完成`, 'warn');
                return false;
                
            } finally {
                await page.close();
            }
            
        } finally {
            await browser.close();
        }
        
    } catch (error) {
        log('main', '主流程', `[${account.email}] 检查 ${taskType} 任务完成状态时出错: ${error}`, 'warn');
        return false; // 出错时假设未完成，继续执行
    }
}

/**
 * 执行交叉搜索任务（仅搜索，不包含登录）
 */
async function executeCrossSearchTasks(
    accounts: Account[], 
    config: Config, 
    taskType: 'desktop' | 'mobile',
    accountPointsData: Map<string, {initialPoints: number, todayStr: string}>
) {
    const maxRounds = 10; // 最大轮数，防止无限循环
    let currentRound = 0;
    let allCompleted = false;
    
    while (currentRound < maxRounds && !allCompleted && !shouldStopTask) {
        currentRound++;
        log('main', '主流程', `🔄 开始第 ${currentRound} 轮 ${taskType} 交叉执行`);
        
        allCompleted = true;
        
        for (const account of accounts) {
            if (shouldStopTask) {
                log('main', '主流程', `检测到停止指令，终止 ${taskType} 交叉执行`, 'warn');
                return;
            }
            
            log('main', '主流程', `[${account.email}] 开始第 ${currentRound} 轮 ${taskType} 搜索任务`);
            
            try {
                // 执行单个账户的搜索任务
                await runTasksForAccounts([account], config, taskType);
                log('main', '主流程', `[${account.email}] 第 ${currentRound} 轮 ${taskType} 搜索任务完成`);
            } catch (error) {
                log('main', '主流程', `[${account.email}] 第 ${currentRound} 轮 ${taskType} 搜索任务失败: ${error}`, 'error');
                allCompleted = false; // 有失败的任务，需要继续下一轮
            }
            
            // 添加轮次间延迟
            if (!shouldStopTask) {
                await new Promise(resolve => setTimeout(resolve, 2000)); // 2秒延迟
            }
        }
        
        if (!allCompleted) {
            log('main', '主流程', `第 ${currentRound} 轮 ${taskType} 交叉执行完成，有失败任务，继续下一轮`);
        } else {
            log('main', '主流程', `第 ${currentRound} 轮 ${taskType} 交叉执行完成，所有任务成功`);
        }
    }
    
    if (currentRound >= maxRounds) {
        log('main', '主流程', `⚠️ ${taskType} 交叉执行达到最大轮数限制 (${maxRounds})，停止执行`, 'warn');
    }
}

/**
 * 处理账户积分统计和上报
 */
async function processAccountPoints(account: Account, config: Config, todayStr: string, initialPointsToday: number): Promise<{email: string, points_gained: number, final_points: number, desktop_gain: number, mobile_gain: number} | null> {
    // 获取最终积分并上报
    const finalDailyPointsData = await loadDailyPoints(config.sessionPath, account.email);
    if (finalDailyPointsData && finalDailyPointsData.date === todayStr) {
        // 正确计算最终积分：优先使用移动端完成后的总积分，如果没有则使用桌面端，最后使用初始积分
        let finalPoints = 0;
        if (finalDailyPointsData.mobileFinalPoints !== undefined) {
            finalPoints = finalDailyPointsData.mobileFinalPoints;
        } else if (finalDailyPointsData.desktopFinalPoints !== undefined) {
            finalPoints = finalDailyPointsData.desktopFinalPoints;
        } else {
            finalPoints = finalDailyPointsData.initialPoints || 0;
        }
        
        // 修复积分计算逻辑：即使初始积分为0，也要计算实际收益
        let dailyGain = 0;
        if (initialPointsToday > 0) {
            dailyGain = finalPoints - initialPointsToday;
        } else if (finalPoints > 0) {
            // 如果初始积分为0但最终积分大于0，说明有收益
            dailyGain = finalPoints;
        }
        
        log('main', '主流程', `[${account.email}] 积分统计 - 初始: ${initialPointsToday}, 最终: ${finalPoints}, 今日收益: ${dailyGain}`);
        
        // 验证积分数据合理性
        if (finalPoints < 0) {
            log('main', '主流程', `[${account.email}] ⚠️ 最终积分异常: ${finalPoints}，设置为0`, 'warn');
            finalPoints = 0;
        }
        
        if (dailyGain < 0) {
            log('main', '主流程', `[${account.email}] ⚠️ 今日收益异常: ${dailyGain}，设置为0`, 'warn');
            dailyGain = 0;
        }
        
        // 计算桌面端和移动端的实际收益
        let desktopGain = 0;
        let mobileGain = 0;
        
        // 修复收益计算逻辑
        if (finalDailyPointsData.desktopFinalPoints !== undefined) {
            // 桌面端收益 = 桌面端最终积分 - 初始积分
            desktopGain = Math.max(0, finalDailyPointsData.desktopFinalPoints - (finalDailyPointsData.initialPoints || 0));
        }
        
        if (finalDailyPointsData.mobileFinalPoints !== undefined) {
            if (finalDailyPointsData.desktopFinalPoints !== undefined) {
                // 移动端收益 = 移动端最终积分 - 桌面端最终积分
                mobileGain = Math.max(0, finalDailyPointsData.mobileFinalPoints - finalDailyPointsData.desktopFinalPoints);
            } else {
                // 如果没有桌面端最终积分，移动端收益 = 移动端最终积分 - 初始积分
                mobileGain = Math.max(0, finalDailyPointsData.mobileFinalPoints - (finalDailyPointsData.initialPoints || 0));
            }
        }
        
        log('main', '主流程', `[${account.email}] 收益统计 - 桌面端: ${desktopGain}, 移动端: ${mobileGain}`);
        log('main', '主流程', `[${account.email}] 积分数据详情 - 初始: ${finalDailyPointsData.initialPoints}, 桌面端最终: ${finalDailyPointsData.desktopFinalPoints}, 移动端最终: ${finalDailyPointsData.mobileFinalPoints}`);
        
        // 上报积分数据
        const bot = new MicrosoftRewardsBot();
        bot.config = config;
        bot.account = account;
        bot.axios = new Axios(account.proxy);
        
        await sendFinalUpdate(bot, {
            email: account.email,
            total_points: finalPoints,
            daily_gain: dailyGain,
            desktop_gain: desktopGain,
            mobile_gain: mobileGain
        });
        
        // 返回账户执行结果
        return {
            email: account.email,
            points_gained: dailyGain,
            final_points: finalPoints,
            desktop_gain: desktopGain,
            mobile_gain: mobileGain
        };
    } else {
        log('main', '主流程', `[${account.email}] ⚠️ 未找到今日积分数据，跳过上报`, 'warn');
        return null;
    }
}

/**
 * 重试账户失败任务
 */
async function retryAccountFailedTasks(email: string) {
    try {
        const retryResult = await retryFailedTasks(email);
        if (retryResult.success > 0 || retryResult.failed > 0) {
            log('main', '主流程', `账户 ${email} 失败任务重试完成: 成功 ${retryResult.success} 个，失败 ${retryResult.failed} 个`);
        }
    } catch (error) {
        log('main', '主流程', `账户 ${email} 失败任务重试异常: ${error}`, 'warn');
    }
}

/**
 * 判断是否应该启用交叉执行模式
 */
async function shouldEnableCrossExecution(accounts: Account[], config: Config, searchCrossExecution: boolean): Promise<boolean> {
    // 1. 检查配置是否启用交叉执行
    if (!searchCrossExecution) {
        log('main', '主流程', '📋 配置未启用交叉执行，使用顺序执行模式');
        return false;
    }
    
    // 2. 检查账户数量是否满足交叉执行条件（>=2个账户）
    if (accounts.length < 2) {
        log('main', '主流程', `📋 账户数量不足（${accounts.length}个），交叉执行需要至少2个账户，使用顺序执行模式`);
        return false;
    }
    
    log('main', '主流程', `🔍 开始预检查 ${accounts.length} 个账户的登录状态...`);
    
    // 3. 预检查所有账户的登录状态
    const loginStatusResults = await checkAllAccountsLoginStatus(accounts, config);
    const validAccounts = loginStatusResults.filter(result => result.isLoggedIn);
    
    log('main', '主流程', `🔍 登录状态检查完成：${validAccounts.length}/${accounts.length} 个账户登录成功`);
    
    // 4. 检查有效登录账户数量
    if (validAccounts.length < 2) {
        log('main', '主流程', `📋 有效登录账户数量不足（${validAccounts.length}个），交叉执行需要至少2个有效账户，使用顺序执行模式`);
        log('main', '主流程', `💡 未登录的账户将在顺序执行模式中正常进行登录流程`);
        return false;
    }
    
    log('main', '主流程', `✅ 满足交叉执行条件：${validAccounts.length} 个有效账户，启用交叉执行模式`);
    log('main', '主流程', `💡 未登录的账户将在交叉执行模式中正常进行登录流程`);
    return true;
}

/**
 * 检查所有账户的登录状态
 */
async function checkAllAccountsLoginStatus(accounts: Account[], config: Config): Promise<Array<{email: string, isLoggedIn: boolean, error?: string}>> {
    const results: Array<{email: string, isLoggedIn: boolean, error?: string}> = [];
    
    for (const account of accounts) {
        try {
            log('main', '主流程', `🔍 检查账户 ${account.email} 的登录状态...`);
            
            // 创建浏览器实例进行登录状态检查（使用轻量级方式避免重复初始化）
            const browserFactory = new MicrosoftRewardsBot().browserFactory;
            const browser = await browserFactory.launchBrowser(account);
            
            try {
                // 创建上下文并加载会话数据
                const context = await browserFactory.createContext(browser, account);
                
                const page = await context.newPage();
                
                try {
                    // 访问 Microsoft Rewards 页面检查登录状态
                    await page.goto('https://rewards.bing.com', { 
                        waitUntil: 'domcontentloaded', 
                        timeout: 30000 
                    });
                    
                    await page.waitForTimeout(3000);
                    
                    // 检查是否已登录
                    const isLoggedIn = await checkPageLoginStatus(page);
                    
                    results.push({
                        email: account.email,
                        isLoggedIn: isLoggedIn
                    });
                    
                    log('main', '主流程', `🔍 账户 ${account.email} 登录状态：${isLoggedIn ? '已登录' : '未登录'}`);
                    
                } finally {
                    await page.close();
                }
                
            } finally {
                await browser.close();
            }
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log('main', '主流程', `🔍 账户 ${account.email} 登录状态检查失败: ${errorMessage}`, 'warn');
            
            results.push({
                email: account.email,
                isLoggedIn: false,
                error: errorMessage
            });
        }
    }
    
    return results;
}

/**
 * 检查页面登录状态
 */
async function checkPageLoginStatus(page: any): Promise<boolean> {
    try {
        // 检查多种登录状态指示器
        const loginIndicators = [
            // 用户头像或账户信息
            '[data-testid="identityBanner"]',
            '.user-avatar',
            '.account-info',
            '[aria-label*="@"]',
            '.profile_img',
            '#img_sec',
            '#redirect_info_link',
            '[id*="mectrl"]',
            '[class*="profile"]',
            
            // 注销链接
            'a:has-text("注销")',
            'a:has-text("Sign out")',
            'a:has-text("登出")',
            '[href*="Signout"]',
            
            // 积分信息
            'text=points',
            'text=积分',
            'text=Rewards',
            'text=奖励',
            
            // 活动相关元素
            '[data-bi-id]',
            '.pointLink',
            '.activity-item',
            '[class*="activity"]',
            '[class*="task"]'
        ];
        
        for (const selector of loginIndicators) {
            try {
                const element = await page.$(selector);
                if (element) {
                    const isVisible = await element.isVisible();
                    if (isVisible) {
                        return true;
                    }
                }
            } catch (e) {
                // 忽略选择器错误，继续检查下一个
            }
        }
        
        // 检查页面标题
        const pageTitle = await page.title();
        if (pageTitle.includes('Microsoft Rewards') || 
            pageTitle.includes('Bing Rewards') || 
            pageTitle.includes('Rewards') ||
            pageTitle.includes('Dashboard')) {
            return true;
        }
        
        // 检查URL
        const currentUrl = page.url();
        if (currentUrl.includes('uaid=') || 
            currentUrl.includes('account.live.com') ||
            currentUrl.includes('rewards.bing.com')) {
            return true;
        }
        
        return false;
        
    } catch (error) {
        log('main', '主流程', `检查页面登录状态时出错: ${error}`, 'warn');
        return false;
    }
}

main().catch(error => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log('main', '主流程-致命错误', `运行机器人时发生致命错误: ${errorMessage}`, 'error');
    process.exit(1);
});