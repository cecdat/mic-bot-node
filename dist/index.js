"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MicrosoftRewardsBot = void 0;
const child_process_1 = require("child_process");
const playwright = __importStar(require("playwright"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const Browser_1 = __importDefault(require("./browser/Browser"));
const BrowserFunc_1 = __importDefault(require("./browser/BrowserFunc"));
const BrowserUtil_1 = __importDefault(require("./browser/BrowserUtil"));
const Logger_1 = require("./util/Logger");
const Utils_1 = __importDefault(require("./util/Utils"));
const Load_1 = require("./util/Load");
const AccountStatusManager_1 = require("./util/AccountStatusManager");
const AIOrcestrator_1 = require("./util/AIOrcestrator");
const Login_1 = require("./functions/Login");
const Workers_1 = require("./functions/Workers");
const Activities_1 = __importDefault(require("./functions/Activities"));
const Axios_1 = __importDefault(require("./util/Axios"));
const axios_1 = __importDefault(require("axios"));
const express_1 = __importDefault(require("express"));
// 添加全局变量跟踪任务运行状态
let isTaskRunning = false;
let shouldStopTask = false;
async function checkInNode() {
    const config = (0, Load_1.loadConfig)();
    const apiConfig = config.apiServer;
    const utils = new Utils_1.default();
    if (!apiConfig || !apiConfig.enabled || !apiConfig.updateUrl || !apiConfig.nodeName) {
        (0, Logger_1.log)('main', '节点管理', 'API未启用或节点名称未配置，跳过签到。', 'warn');
        return;
    }
    try {
        const checkinUrl = new URL(apiConfig.updateUrl);
        checkinUrl.pathname = '/bot_api/checkin';
        // 确保使用正确的UTC时间戳，不受系统时区影响
        const now = new Date();
        const utcTimestamp = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString();
        const payload = {
            node_name: apiConfig.nodeName,
            bot_status: isTaskRunning ? 'Running' : 'Idle',
            timestamp: utcTimestamp
        };
        if (apiConfig.heartbeatTimeout) {
            payload.heartbeat_timeout = utils.stringToMs(apiConfig.heartbeatTimeout) / 1000;
        }
        (0, Logger_1.log)('main', '节点管理', `向中心服务器签到/发送心跳: ${JSON.stringify(payload)}`);
        await axios_1.default.post(checkinUrl.toString(), payload, {
            headers: { 'Authorization': `Bearer ${apiConfig.token}` }
        });
        (0, Logger_1.log)('main', '节点管理', '节点签到/心跳成功。');
    }
    catch (error) {
        let errorMessage;
        if (axios_1.default.isAxiosError(error)) {
            errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
        }
        else if (error instanceof Error) {
            errorMessage = error.message;
        }
        else {
            errorMessage = String(error);
        }
        (0, Logger_1.log)('main', '节点管理', `节点签到/心跳失败: ${errorMessage}`, 'error');
    }
}
async function sendFinalUpdate(bot, data) {
    const apiConfig = bot.config.apiServer;
    if (!apiConfig || !apiConfig.enabled || !apiConfig.updateUrl || !apiConfig.token) {
        return;
    }
    const payload = { ...data, node_name: apiConfig.nodeName };
    try {
        (0, Logger_1.log)('main', '最终上报', `正在向中心API上报账户 ${data.email} 的积分数据...`);
        const updateUrl = new URL(apiConfig.updateUrl);
        updateUrl.pathname = '/bot_api/update_points';
        await bot.axios.request({
            url: updateUrl.toString(),
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiConfig.token}` },
            data: payload
        }, true);
        (0, Logger_1.log)('main', '最终上报', `账户 ${data.email} 的积分数据上报成功！`);
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        (0, Logger_1.log)('main', '最终上报', `向中心API上报积分失败: ${errorMessage}`, 'error');
    }
}
async function sendLoginStatusUpdate(bot, type, status, code, message) {
    const apiConfig = bot.config.apiServer;
    if (!apiConfig || !apiConfig.enabled || !apiConfig.updateUrl) {
        return;
    }
    try {
        const statusUrl = new URL(apiConfig.updateUrl);
        statusUrl.pathname = '/bot_api/update_login_status';
        const payload = { email: bot.account.email, type, status, code, message };
        (0, Logger_1.log)(bot.isMobile, '状态上报', `上报登录状态: ${JSON.stringify(payload)}`);
        await axios_1.default.post(statusUrl.toString(), payload, {
            headers: { 'Authorization': `Bearer ${apiConfig.token}` }
        });
    }
    catch (error) {
        let errorMessage;
        if (axios_1.default.isAxiosError(error)) {
            errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
        }
        else if (error instanceof Error) {
            errorMessage = error.message;
        }
        else {
            errorMessage = String(error);
        }
        (0, Logger_1.log)(bot.isMobile, '状态上报', `上报登录状态失败: ${errorMessage}`, 'error');
    }
}
async function updateActivityStatus(status) {
    // 更新全局任务状态
    isTaskRunning = status === 'Running';
    const config = (0, Load_1.loadConfig)();
    const apiConfig = config.apiServer;
    if (!apiConfig || !apiConfig.enabled || !apiConfig.updateUrl)
        return;
    try {
        const apiUrl = new URL(apiConfig.updateUrl);
        apiUrl.pathname = '/bot_api/update_activity';
        await axios_1.default.post(apiUrl.toString(), { activity_status: status }, { headers: { 'Authorization': `Bearer ${apiConfig.token}` } });
        (0, Logger_1.log)('main', '主流程', `向服务器报告当前状态: [${status}]`);
    }
    catch (error) { /* Silent fail */ }
}
async function confirmCommandToServer(command) {
    const config = (0, Load_1.loadConfig)();
    const apiConfig = config.apiServer;
    if (!apiConfig || !apiConfig.enabled || !apiConfig.updateUrl)
        return;
    try {
        const apiUrl = new URL(apiConfig.updateUrl);
        apiUrl.pathname = '/bot_api/confirm_command';
        await axios_1.default.post(apiUrl.toString(), { command }, { headers: { 'Authorization': `Bearer ${apiConfig.token}` } });
        (0, Logger_1.log)('main', '主流程', `向服务器确认命令: [${command}]`);
    }
    catch (error) {
        let errorMessage;
        if (axios_1.default.isAxiosError(error)) {
            errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
        }
        else if (error instanceof Error) {
            errorMessage = error.message;
        }
        else {
            errorMessage = String(error);
        }
        (0, Logger_1.log)('main', '主流程', `确认命令失败: ${errorMessage}`, 'error');
    }
}
async function runHotSearchScript(accounts) {
    return new Promise((resolve, reject) => {
        (0, Logger_1.log)('main', '热搜脚本', '开始执行 get_all_hots.py 脚本...');
        const baseDir = __dirname;
        const tempAccountsPath = path_1.default.join(baseDir, 'accounts.temp.json');
        const configPath = path_1.default.join(baseDir, 'config.json');
        const outputDir = path_1.default.join(baseDir, 'search_terms');
        fs_1.default.writeFileSync(tempAccountsPath, JSON.stringify(accounts, null, 2));
        const pythonCommand = `python3 get_all_hots.py --config_path "${configPath}" --accounts_path "${tempAccountsPath}" --output_dir "${outputDir}"`;
        (0, child_process_1.exec)(pythonCommand, (error, stdout, stderr) => {
            fs_1.default.unlinkSync(tempAccountsPath);
            if (error) {
                (0, Logger_1.log)('main', '热搜脚本', `脚本执行失败: ${error.message}`, 'error');
                console.error(`stderr: ${stderr}`);
                reject(error);
                return;
            }
            (0, Logger_1.log)('main', '热搜脚本', `脚本执行成功。`);
            console.log(`stdout: ${stdout}`);
            resolve();
        });
    });
}
class MicrosoftRewardsBot {
    constructor() {
        this.activities = new Activities_1.default(this);
        // 停止状态检查函数
        // 默认为检查全局shouldStopTask变量
        this.checkStopStatus = () => shouldStopTask;
        this.isMobile = false;
        this.browserFactory = new Browser_1.default(this);
        this.accessToken = '';
        this.accountStatus = '未知';
        this.log = Logger_1.log;
        this.utils = new Utils_1.default();
        this.workers = new Workers_1.Workers(this);
        this.browser = { func: new BrowserFunc_1.default(this), utils: new BrowserUtil_1.default(this) };
        this.config = (0, Load_1.loadConfig)();
        this.login = new Login_1.Login(this);
        this.sendStatusUpdate = (type, status, code, message) => sendLoginStatusUpdate(this, type, status, code, message);
    }
    async Desktop(browser, account) {
        this.isMobile = false;
        const context = await this.browserFactory.createContext(browser, account);
        const page = await context.newPage();
        try {
            (0, Logger_1.log)(this.isMobile, '主流程', `[${account.email}] 已创建桌面端上下文`);
            await this.login.login(page, account.email, account.password);
            // 检查是否需要停止
            if (this.checkStopStatus()) {
                (0, Logger_1.log)(this.isMobile, '主流程', `[${account.email}] 检测到停止指令，终止任务...`, 'warn');
                return { points: 0, gain: 0 };
            }
            const initialData = await this.browser.func.getDashboardData(page);
            const initialPoints = initialData.userStatus.availablePoints;
            const allTasks = AIOrcestrator_1.aiOrchestrator.getAllIncompleteTasks(initialData);
            if (allTasks.length > 0) {
                const executionPlan = await AIOrcestrator_1.aiOrchestrator.getTaskExecutionPlan(allTasks);
                for (const task of executionPlan) {
                    // 检查是否需要停止
                    if (this.checkStopStatus()) {
                        (0, Logger_1.log)(this.isMobile, '主流程', `[${account.email}] 检测到停止指令，终止任务...`, 'warn');
                        return { points: initialPoints, gain: 0 };
                    }
                    await this.workers.executeSingleTask(page, task);
                }
            }
            if (this.config.workers.doPunchCards)
                await this.workers.doPunchCard(page, initialData);
            const afterActivitiesData = await this.browser.func.getDashboardData(page);
            if (this.config.workers.doDesktopSearch)
                await this.activities.doSearch(page, afterActivitiesData, account.email);
            const finalData = await this.browser.func.getDashboardData(page);
            const finalPoints = finalData.userStatus.availablePoints;
            return { points: finalPoints, gain: finalPoints - initialPoints };
        }
        finally {
            await context.close();
        }
    }
    async Mobile(browser, account) {
        this.isMobile = true;
        const context = await this.browserFactory.createContext(browser, account);
        const page = await context.newPage();
        try {
            (0, Logger_1.log)(this.isMobile, '主流程', `[${account.email}] 已创建移动端上下文`);
            await this.login.login(page, account.email, account.password);
            const initialData = await this.browser.func.getDashboardData(page);
            const initialPoints = initialData.userStatus.availablePoints;
            const tokenPage = await context.newPage();
            try {
                this.accessToken = await this.login.getMobileAccessToken(tokenPage, account.email);
            }
            finally {
                await tokenPage.close();
            }
            // 检查是否需要停止
            if (this.checkStopStatus()) {
                (0, Logger_1.log)(this.isMobile, '主流程', `[${account.email}] 检测到停止指令，终止任务...`, 'warn');
                return { points: initialPoints, gain: 0 };
            }
            if (this.config.workers.doDailyCheckIn)
                await this.activities.doDailyCheckIn(this.accessToken, initialData);
            // 检查是否需要停止
            if (this.checkStopStatus()) {
                (0, Logger_1.log)(this.isMobile, '主流程', `[${account.email}] 检测到停止指令，终止任务...`, 'warn');
                return { points: initialPoints, gain: 0 };
            }
            if (this.config.workers.doReadToEarn)
                await this.activities.doReadToEarn(this.accessToken, initialData);
            // 检查是否需要停止
            if (this.checkStopStatus()) {
                (0, Logger_1.log)(this.isMobile, '主流程', `[${account.email}] 检测到停止指令，终止任务...`, 'warn');
                return { points: initialPoints, gain: 0 };
            }
            if (this.config.workers.doMobileSearch) {
                if (initialData.userStatus.counters.mobileSearch) {
                    await this.activities.doSearch(page, initialData, account.email);
                }
            }
            const finalData = await this.browser.func.getDashboardData(page);
            const finalPoints = finalData.userStatus.availablePoints;
            return { points: finalPoints, gain: finalPoints - initialPoints };
        }
        finally {
            await context.close();
        }
    }
    async runFor(account) {
        this.account = account;
        this.axios = new Axios_1.default(account.proxy);
        const browser = await this.browserFactory.launchBrowser(account);
        try {
            const todayStr = this.utils.getYYYYMMDD();
            const dailyPointsData = await (0, Load_1.loadDailyPoints)(this.config.sessionPath, account.email);
            let initialPointsToday = 0;
            if (dailyPointsData && dailyPointsData.date === todayStr) {
                initialPointsToday = dailyPointsData.initialPoints;
            }
            // 添加停止检查
            if (shouldStopTask) {
                (0, Logger_1.log)('main', '主进程-WORKER', '检测到停止指令，终止账户任务...', 'warn');
                return;
            }
            const recoveryContext = await this.browserFactory.createContext(browser, account);
            const recoveryPage = await recoveryContext.newPage();
            try {
                // 关键改动：增加了 try/catch 来包裹获取数据的逻辑
                const data = await this.browser.func.getDashboardData(recoveryPage);
                initialPointsToday = data.userStatus.availablePoints;
                await (0, Load_1.saveDailyPoints)(this.config.sessionPath, account.email, { date: todayStr, initialPoints: initialPointsToday });
            }
            catch (e) {
                // 如果获取失败，记录警告并默认初始积分为0
                (0, Logger_1.log)(false, '主流程', `无法在任务开始前获取初始积分: ${e.message}。将让主流程处理登录。`, 'warn');
                initialPointsToday = 0;
            }
            finally {
                await recoveryContext.close();
            }
            // 添加停止检查
            if (shouldStopTask) {
                (0, Logger_1.log)('main', '主进程-WORKER', '检测到停止指令，终止账户任务...', 'warn');
                return;
            }
            const desktopResult = await this.Desktop(browser, account).catch(e => { (0, Logger_1.log)(false, 'Desktop-Error', e.message, 'error'); return { points: 0, gain: 0 }; });
            // 添加停止检查
            if (shouldStopTask) {
                (0, Logger_1.log)('main', '主进程-WORKER', '检测到停止指令，终止账户任务...', 'warn');
                return;
            }
            const mobileResult = await this.Mobile(browser, account).catch(e => { (0, Logger_1.log)(true, 'Mobile-Error', e.message, 'error'); return { points: 0, gain: 0 }; });
            // 添加停止检查
            if (shouldStopTask) {
                (0, Logger_1.log)('main', '主进程-WORKER', '检测到停止指令，终止账户任务...', 'warn');
                return;
            }
            const finalPoints = await this.browser.func.getDashboardData(await browser.newPage()).then(d => d.userStatus.availablePoints).catch(() => desktopResult.points > 0 ? desktopResult.points : 0);
            await sendFinalUpdate(this, {
                email: account.email,
                total_points: finalPoints,
                daily_gain: finalPoints - initialPointsToday,
                desktop_gain: desktopResult.gain,
                mobile_gain: mobileResult.gain
            });
        }
        finally {
            await browser.close();
        }
    }
}
exports.MicrosoftRewardsBot = MicrosoftRewardsBot;
async function runTasksForAccounts(accounts, config) {
    for (const account of accounts) {
        if (shouldStopTask) {
            (0, Logger_1.log)('main', '主进程-WORKER', '收到停止指令，终止任务执行...', 'warn');
            await updateActivityStatus('Idle');
            return;
        }
        if (AccountStatusManager_1.accountStatusManager.isFrozen(account.email)) {
            continue;
        }
        (0, Logger_1.log)('main', '主进程-WORKER', `开始为账户 ${account.email} 执行任务`);
        const bot = new MicrosoftRewardsBot();
        // 关键：将合并后的最终配置赋值给 bot 实例
        bot.config = config;
        try {
            // 添加任务执行前的停止检查
            if (shouldStopTask) {
                (0, Logger_1.log)('main', '主进程-WORKER', '任务执行前检测到停止指令，终止任务...', 'warn');
                await updateActivityStatus('Idle');
                return;
            }
            // 确保停止检查函数已正确设置（冗余检查，防止意外）
            if (bot.checkStopStatus() !== shouldStopTask) {
                (0, Logger_1.log)('main', '主进程-WORKER', '修正停止检查函数设置', 'warn');
                bot.checkStopStatus = () => shouldStopTask;
            }
            await bot.runFor(account);
            AccountStatusManager_1.accountStatusManager.recordSuccess(account.email);
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            (0, Logger_1.log)('main', '主进程-WORKER', `账户 ${account.email} 的任务执行失败: ${errorMessage}`, 'error');
            AccountStatusManager_1.accountStatusManager.recordFailure(account.email);
            await sendFinalUpdate(bot, { email: account.email, total_points: -1, daily_gain: -1, desktop_gain: 0, mobile_gain: 0 });
        }
        (0, Logger_1.log)('main', '主进程-WORKER', `完成账户 ${account.email} 的所有任务流程。`, 'log', 'green');
    }
}
async function main() {
    (0, Logger_1.log)('main', '主流程', `Mic-Bot 执行节点已启动...`);
    // 添加临时HTTP服务器用于测试停止命令
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    // POST端点保持不变，添加GET端点用于简单测试
    app.post('/test/stop', (req, res) => {
        (0, Logger_1.log)('main', '测试端点', '收到手动停止命令', 'warn');
        shouldStopTask = true;
        updateActivityStatus('Idle');
        res.json({ success: true, message: '已触发停止命令' });
    });
    // 处理服务端发送的停止指令
    app.post('/web_api/nodes/1/stop', (req, res) => {
        (0, Logger_1.log)('main', '节点管理', '收到服务端停止命令', 'warn');
        shouldStopTask = true;
        updateActivityStatus('Idle');
        res.json({ success: true, message: '已触发停止命令' });
    });
    // 添加GET端点，便于测试
    app.get('/test/stop', (req, res) => {
        (0, Logger_1.log)('main', '测试端点', '收到GET手动停止命令', 'warn');
        shouldStopTask = true;
        updateActivityStatus('Idle');
        res.json({ success: true, message: '已触发停止命令' });
    });
    // 添加测试端点，用于触发任务执行
    app.get('/test/run_tasks', (req, res) => {
        (0, Logger_1.log)('main', '测试端点', '收到触发任务命令', 'warn');
        (0, Logger_1.log)('main', '测试端点', `请求路径: ${req.path}`, 'log');
        (0, Logger_1.log)('main', '测试端点', `请求方法: ${req.method}`, 'log');
        if (!isTaskRunning) {
            (0, Logger_1.log)('main', '测试端点', '开始执行任务...', 'log');
            executeTasks().catch(err => {
                (0, Logger_1.log)('main', '任务执行', `任务执行出错: ${String(err)}`, 'error');
            });
            res.json({ success: true, message: '已触发任务执行' });
        }
        else {
            (0, Logger_1.log)('main', '测试端点', '任务已经在运行中', 'warn');
            res.json({ success: false, message: '任务已经在运行中' });
        }
    });
    // 添加一个根端点，用于测试连接
    app.get('/', (req, res) => {
        (0, Logger_1.log)('main', '测试端点', '收到根路径请求', 'log');
        res.json({ success: true, message: '节点服务正常运行' });
    });
    // 直接启动服务器，不声明未使用的变量
    app.listen(3002, () => {
        (0, Logger_1.log)('main', '测试端点', '临时HTTP服务器已启动在端口 3002', 'log');
    });
    // 步骤 1: 加载本地基础配置，确保 config 是变量 (let)
    let config = (0, Load_1.loadConfig)();
    const utils = new Utils_1.default();
    try {
        // 步骤 2: 尝试从远端加载扁平化的节点配置
        const nodeConfig = await (0, Load_1.loadNodeConfig)();
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
            config = {
                ...config,
                searchSettings: remoteSearchSettings
            };
            (0, Logger_1.log)('main', '主流程', '已成功合并远程节点配置。');
        }
    }
    catch (error) {
        (0, Logger_1.log)('main', '主流程', '加载远程节点配置失败，将仅使用本地配置。', 'warn');
    }
    // 步骤 4: 定时签到/发送心跳
    await checkInNode();
    // 确保使用最终的 config 对象来获取心跳间隔
    const heartbeatIntervalMs = utils.stringToMs(config.apiServer?.heartbeatInterval || '5m');
    setInterval(checkInNode, heartbeatIntervalMs);
    // 执行单个任务函数
    async function executeSingleTask(taskData) {
        if (isTaskRunning) {
            (0, Logger_1.log)('main', '执行单个任务', '任务正在执行中，无法执行新任务', 'warn');
            return;
        }
        isTaskRunning = true;
        try {
            shouldStopTask = false; // 重置停止标志
            await updateActivityStatus('Running');
            (0, Logger_1.log)('main', '执行单个任务', `开始执行任务 ${taskData.task_id}: ${taskData.task_type}`);
            // 获取账户列表
            const accounts = await (0, Load_1.loadAccounts)();
            if (accounts.length === 0) {
                (0, Logger_1.log)('main', '执行单个任务', '未获取到分配的账户，任务终止。');
                return;
            }
            // 为简化示例，我们使用第一个账户执行任务
            const account = accounts[0];
            if (!account) {
                (0, Logger_1.log)('main', '执行单个任务', '未获取到有效的账户，任务终止。', 'error');
                return;
            }
            (0, Logger_1.log)('main', '执行单个任务', `使用账户 ${account.email} 执行任务`);
            const bot = new MicrosoftRewardsBot();
            bot.config = config; // 使用合并后的配置
            bot.account = account;
            bot.axios = new Axios_1.default(account.proxy);
            // 创建浏览器实例
            const browser = await playwright.chromium.launch({ headless: true });
            try {
                // 这里应该有根据任务类型执行不同操作的逻辑
                // 为简化示例，我们只是执行常规任务
                await bot.runFor(account);
                (0, Logger_1.log)('main', '执行单个任务', `任务 ${taskData.task_id} 执行完成`);
            }
            finally {
                await browser.close();
            }
            if (!shouldStopTask) {
                await updateActivityStatus('Idle');
                (0, Logger_1.log)('main', '执行单个任务', '任务执行完毕，返回待机状态。');
            }
        }
        catch (error) {
            (0, Logger_1.log)('main', '执行单个任务', `执行任务时出错: ${String(error)}`, 'error');
            if (!shouldStopTask) {
                await updateActivityStatus('Idle');
            }
        }
        finally {
            isTaskRunning = false;
            // 确认命令已执行
            await confirmCommandToServer('RUN_TASK');
        }
    }
    // 任务执行函数
    async function executeTasks() {
        if (isTaskRunning)
            return;
        isTaskRunning = true;
        try {
            shouldStopTask = false; // 重置停止标志
            await updateActivityStatus('Running');
            const accounts = await (0, Load_1.loadAccounts)();
            if (accounts.length > 0) {
                await runHotSearchScript(accounts);
                await runTasksForAccounts(accounts, config);
            }
            else {
                (0, Logger_1.log)('main', '主流程', '未获取到分配的账户，本轮任务结束。');
            }
            if (!shouldStopTask) {
                await updateActivityStatus('Idle');
                (0, Logger_1.log)('main', '主流程', '所有任务执行完毕，返回待机状态。');
            }
        }
        catch (error) {
            (0, Logger_1.log)('main', '任务执行', `执行任务时出错: ${String(error)}`, 'error');
            if (!shouldStopTask) {
                await updateActivityStatus('Idle');
            }
        }
        finally {
            isTaskRunning = false;
        }
    }
    // 步骤 5: 开始主循环，监听任务
    while (true) {
        try {
            (0, Logger_1.log)('main', '主流程', '正在向指挥中心请求指令 (长轮询)...');
            const commandUrl = new URL(config.apiServer.updateUrl);
            commandUrl.pathname = '/bot_api/command_poll';
            const response = await axios_1.default.get(commandUrl.toString(), {
                headers: { 'Authorization': `Bearer ${config.apiServer.token}` },
                timeout: 60000
            });
            const command = response.data.command;
            if (command === 'RUN_TASKS') {
                (0, Logger_1.log)('main', '主流程', '收到 [执行任务] 指令，开始执行...');
                // 异步执行任务，不阻塞主循环
                if (!isTaskRunning) {
                    executeTasks().catch(err => {
                        (0, Logger_1.log)('main', '任务执行', `任务执行出错: ${String(err)}`, 'error');
                    });
                    // 确认命令已接收
                    await confirmCommandToServer('RUN_TASKS');
                }
                else {
                    (0, Logger_1.log)('main', '主流程', '任务正在执行中，忽略重复的执行指令', 'warn');
                    // 确认命令已接收但无需执行
                    await confirmCommandToServer('RUN_TASKS');
                }
            }
            else if (command === 'RUN_TASK') {
                (0, Logger_1.log)('main', '主流程', '收到 [执行单个任务] 指令，开始执行...');
                const taskData = response.data.data;
                (0, Logger_1.log)('main', '主流程', `任务数据: ${JSON.stringify(taskData)}`);
                // 异步执行单个任务，不阻塞主循环
                if (!isTaskRunning) {
                    executeSingleTask(taskData).catch(err => {
                        (0, Logger_1.log)('main', '任务执行', `单个任务执行出错: ${String(err)}`, 'error');
                    });
                }
                else {
                    (0, Logger_1.log)('main', '主流程', '任务正在执行中，无法执行单个任务', 'warn');
                    // 确认命令已接收但无法执行
                    await confirmCommandToServer('RUN_TASK');
                }
            }
            else if (command === 'STOP_TASKS') {
                (0, Logger_1.log)('main', '主流程', '收到 [停止任务] 指令，正在终止当前任务...', 'warn');
                shouldStopTask = true;
                // 立即更新活动状态为Idle
                await updateActivityStatus('Idle');
                // 向服务端确认命令已执行
                await confirmCommandToServer('STOP_TASKS');
                (0, Logger_1.log)('main', '主流程', '已设置停止标志、更新状态为Idle并确认命令', 'warn');
                (0, Logger_1.log)('main', '主流程', '停止命令处理完成', 'warn');
                // 重置任务运行状态，确保可以立即响应新指令
                isTaskRunning = false;
            }
            else if (command === null) {
                (0, Logger_1.log)('main', '主流程', '收到 [空命令]，忽略...', 'log');
                // 不将空命令视为停止指令
            }
            else {
                (0, Logger_1.log)('main', '主流程', `收到未知命令: ${command}`, 'warn');
            }
        }
        catch (error) {
            let errorMessage;
            if (axios_1.default.isAxiosError(error) && (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT')) {
                errorMessage = '长轮询超时，正在发起下一次请求...';
            }
            else if (axios_1.default.isAxiosError(error)) {
                errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
            }
            else {
                errorMessage = String(error);
            }
            (0, Logger_1.log)('main', '主流程', `主循环出错: ${errorMessage}`, 'warn');
            await utils.wait(30000);
        }
    }
}
main().catch(error => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    (0, Logger_1.log)('main', '主流程-致命错误', `运行机器人时发生致命错误: ${errorMessage}`, 'error');
    process.exit(1);
});
//# sourceMappingURL=index.js.map