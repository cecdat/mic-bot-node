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
import { loadAccounts, loadConfig, loadNodeConfig, loadDailyPoints, saveDailyPoints } from './util/Load';
import { accountStatusManager } from './util/AccountStatusManager';
import { aiOrchestrator } from './util/AIOrcestrator';
import { Login } from './functions/Login';
import { Workers } from './functions/Workers';
import Activities from './functions/Activities';
import { Account } from './interface/Account';
import Axios from './util/Axios';
import axios from 'axios';
import { Config } from './interface/Config'; 

// 添加全局变量跟踪任务运行状态
let isTaskRunning = false;
let shouldStopTask = false;

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
        const now = new Date();
        const utcTimestamp = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString();

        const payload: { node_name: string; heartbeat_timeout?: number; bot_status: string; timestamp: string } = {
            node_name: apiConfig.nodeName,
            bot_status: isTaskRunning ? 'Running' : 'Idle',
            timestamp: utcTimestamp
        };

        if (apiConfig.heartbeatTimeout) {
            payload.heartbeat_timeout = utils.stringToMs(apiConfig.heartbeatTimeout) / 1000;
        }

        log('main', '节点管理', `向中心服务器签到/发送心跳: ${JSON.stringify(payload)}`);
        await axios.post(checkinUrl.toString(), payload, {
            headers: { 'Authorization': `Bearer ${apiConfig.token}` }
        });
        log('main', '节点管理', '节点签到/心跳成功。');
    } catch (error) {
        let errorMessage: string;
        if (axios.isAxiosError(error)) {
            errorMessage = error.response ? 
                `服务器错误: ${JSON.stringify(error.response.data)}` : 
                `请求错误: ${error.message}`;
        } else if (error instanceof Error) {
            errorMessage = `客户端错误: ${error.message}`;
        } else {
            errorMessage = `未知错误: ${String(error)}`;
        }
        log('main', '节点管理', `节点签到/心跳失败: ${errorMessage}`, 'error');
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
    try {
        const apiUrl = new URL(apiConfig.updateUrl);
        apiUrl.pathname = '/bot_api/update_activity';
        await axios.post(apiUrl.toString(), 
            { activity_status: status },
            { headers: { 'Authorization': `Bearer ${apiConfig.token}` } }
        );
        log('main', '主流程', `向服务器报告当前状态: [${status}]`);
    } catch (error) { /* Silent fail */ }
}

async function confirmCommandToServer(command: string) {
    const config = loadConfig();
    const apiConfig = config.apiServer;
    if (!apiConfig || !apiConfig.enabled || !apiConfig.updateUrl) return;
    try {
        const apiUrl = new URL(apiConfig.updateUrl);
        apiUrl.pathname = '/bot_api/confirm_command';
        await axios.post(apiUrl.toString(), 
            { command },
            { headers: { 'Authorization': `Bearer ${apiConfig.token}` } }
        );
        log('main', '主流程', `向服务器确认命令: [${command}]`);
    } catch (error) {
        let errorMessage: string;
        if (axios.isAxiosError(error)) {
            errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
        } else if (error instanceof Error) {
            errorMessage = error.message;
        } else {
            errorMessage = String(error);
        }
        log('main', '主流程', `确认命令失败: ${errorMessage}`, 'error');
    }
}

async function runHotSearchScript(accounts: Account[]) {
    return new Promise<void>((resolve, reject) => {
        log('main', '热搜脚本', '开始执行 get_all_hots.py 脚本...');
        
        const baseDir = __dirname;
        const tempAccountsPath = path.join(baseDir, 'accounts.temp.json');
        const configPath = path.join(baseDir, 'config.json');
        const outputDir = path.join(baseDir, 'search_terms');

        fs.writeFileSync(tempAccountsPath, JSON.stringify(accounts, null, 2));

        const pythonCommand = `python3 get_all_hots.py --config_path "${configPath}" --accounts_path "${tempAccountsPath}" --output_dir "${outputDir}"`;
        
        exec(pythonCommand, (error: ExecException | null, stdout: string, stderr: string) => {
            fs.unlinkSync(tempAccountsPath);
            if (error) {
                log('main', '热搜脚本', `脚本执行失败: ${error.message}`, 'error');
                console.error(`stderr: ${stderr}`);
                reject(error);
                return;
            }
            log('main', '热搜脚本', `脚本执行成功。`);
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
    private accessToken: string = '';
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
            return { points: finalPoints, gain: finalPoints - initialPointsToday };
        } finally {
            await context.close();
        }
    }

    private async Mobile(browser: PlaywrightBrowser, account: Account, initialPointsToday: number): Promise<{points: number, gain: number}> {
        this.isMobile = true;
        const context = await this.browserFactory.createContext(browser, account);
        const page = await context.newPage();
        try {
            log(this.isMobile, '主流程', `[${account.email}] 已创建移动端上下文`);
            await this.login.login(page, account.email, account.password);
            const initialData = await this.browser.func.getDashboardData(page);
            
            // 移动端使用桌面端完成后的积分作为初始值
            const mobileInitialPoints = desktopFinalPoints;
            
            const tokenPage = await context.newPage();
            try { this.accessToken = await this.login.getMobileAccessToken(tokenPage, account.email); }
            finally { await tokenPage.close(); }
            
            // 检查是否需要停止
            if (this.checkStopStatus()) {
                log(this.isMobile, '主流程', `[${account.email}] 检测到停止指令，终止任务...`, 'warn');
                return { points: initialPointsToday, gain: 0 };
            }

            if (this.config.workers.doDailyCheckIn) await this.activities.doDailyCheckIn(this.accessToken, initialData);
            
            // 检查是否需要停止
            if (this.checkStopStatus()) {
                log(this.isMobile, '主流程', `[${account.email}] 检测到停止指令，终止任务...`, 'warn');
                return { points: initialPointsToday, gain: 0 };
            }

            if (this.config.workers.doReadToEarn) await this.activities.doReadToEarn(this.accessToken, initialData);
            
            // 检查是否需要停止
            if (this.checkStopStatus()) {
                log(this.isMobile, '主流程', `[${account.email}] 检测到停止指令，终止任务...`, 'warn');
                return { points: initialPointsToday, gain: 0 };
            }

            if (this.config.workers.doMobileSearch) {
                if (initialData.userStatus.counters.mobileSearch) {
                    await this.activities.doSearch(page, initialData, account.email);
                }
            }
            
            const finalData = await this.browser.func.getDashboardData(page);
            const finalPoints = finalData.userStatus.availablePoints;
            return { points: finalPoints, gain: finalPoints - initialPointsToday };
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
            }
            
            // 添加停止检查
            if (shouldStopTask) {
                log('main', '主进程-WORKER', '检测到停止指令，终止账户任务...', 'warn');
                return;
            }
            
            // 先执行桌面端任务，在登录成功后获取初始积分
            const desktopResult = await this.Desktop(browser, account, initialPointsToday).catch(e => { 
                log(false, 'Desktop-Error', e.message, 'error'); 
                return {points: 0, gain: 0, initialPoints: 0}
            });
            
            // 添加停止检查
            if (shouldStopTask) {
                log('main', '主进程-WORKER', '检测到停止指令，终止账户任务...', 'warn');
                return;
            }
            
            // 执行移动端任务
            const mobileResult = await this.Mobile(browser, account, initialPointsToday).catch(e => { 
                log(true, 'Mobile-Error', e.message, 'error'); 
                return {points: 0, gain: 0}
            });
            
            // 添加停止检查
            if (shouldStopTask) {
                log('main', '主进程-WORKER', '检测到停止指令，终止账户任务...', 'warn');
                return;
            }
            
            // 获取最终积分：使用移动端完成后的积分作为最终积分
            const finalPoints = mobileResult.points > 0 ? mobileResult.points : desktopResult.points;

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
}


async function runTasksForAccounts(accounts: Account[], config: Config) {
    // 并发数：优先使用 service 下发的 clusters，其次使用本地 parallel（true 视为 2），默认 1
    const concurrency = Math.max(1, Number((config as any).clusters || (config.parallel ? 2 : 1)) || 1);
    log('main', '主进程-WORKER', `使用并发数: ${concurrency}`);

    const queue: Account[] = accounts.filter(a => !accountStatusManager.isFrozen(a.email));
    const children: ChildProcess[] = [];

    async function spawnWorker(workerId: number) {
        while (queue.length > 0) {
            if (shouldStopTask) {
                log('main', '主进程-WORKER', `并发#${workerId} 收到停止指令，结束`, 'warn');
                return;
            }
            const account = queue.shift();
            if (!account) break;

            log('main', '主进程-WORKER', `开始为账户 ${account.email} 执行任务 (并发#${workerId})`);
            const env = { ...process.env, ACCOUNT: JSON.stringify(account) } as any;
            const cp = fork('./dist/worker.js', { env, stdio: 'inherit' });
            children.push(cp);
            await new Promise<void>((resolve) => {
                cp.on('exit', () => resolve());
            });
        }
    }

    // 启动固定数量的子进程消费队列（串行复用 child，避免爆炸性进程增长）
    await Promise.all(Array.from({ length: concurrency }, (_, i) => spawnWorker(i + 1)));

    // 清理残留子进程
    for (const cp of children) {
        try { cp.kill(); } catch {}
    }
}

async function main() {
    log('main', '主流程', `Mic-Bot 执行节点已启动...`);

    // 移除临时HTTP测试端口与相关路由
    // 步骤 1: 加载本地基础配置，确保 config 是变量 (let)
    let config = loadConfig();
    const utils = new Util();

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
            // 同时合入 service 端下发的并发数 clusters
            config = {
                ...config,
                searchSettings: remoteSearchSettings,
                clusters: (nodeConfig as any).clusters
            };

            log('main', '主流程', '已成功合并远程节点配置。');
            log('main', '主流程', `服务端并发配置 clusters=${(nodeConfig as any).clusters}, 合并后 config.clusters=${(config as any).clusters}`);
        }
    } catch (error) {
        log('main', '主流程', '加载远程节点配置失败，将仅使用本地配置。', 'warn');
    }

    // 步骤 4: 定时签到/发送心跳
    await checkInNode();
    // 确保使用最终的 config 对象来获取心跳间隔
    const heartbeatIntervalMs = utils.stringToMs(config.apiServer?.heartbeatInterval || '5m');
    setInterval(checkInNode, heartbeatIntervalMs);

    // 执行单个任务函数
    async function executeSingleTask(taskData: any) {
        if (isTaskRunning) {
            log('main', '执行单个任务', '任务正在执行中，无法执行新任务', 'warn');
            return;
        }
        isTaskRunning = true;
        try {
            shouldStopTask = false; // 重置停止标志
            await updateActivityStatus('Running');

            log('main', '执行单个任务', `开始执行任务 ${taskData.task_id}: ${taskData.task_type}`);

            // 获取账户列表
            const accounts = await loadAccounts();
            if (accounts.length === 0) {
                log('main', '执行单个任务', '未获取到分配的账户，任务终止。');
                return;
            }

            // 为简化示例，我们使用第一个账户执行任务
            const account = accounts[0];
            if (!account) {
                log('main', '执行单个任务', '未获取到有效的账户，任务终止。', 'error');
                return;
            }
            log('main', '执行单个任务', `使用账户 ${account.email} 执行任务`);

            const bot = new MicrosoftRewardsBot();
            bot.config = config; // 使用合并后的配置
            bot.account = account;
            bot.axios = new Axios(account.proxy);

            // 创建浏览器实例
            const browser = await playwright.chromium.launch({headless: true});
            try {
                // 这里应该有根据任务类型执行不同操作的逻辑
                // 为简化示例，我们只是执行常规任务
                await bot.runFor(account);
                log('main', '执行单个任务', `任务 ${taskData.task_id} 执行完成`);
            } finally {
                await browser.close();
            }

            if (!shouldStopTask) {
                await updateActivityStatus('Idle');
                log('main', '执行单个任务', '任务执行完毕，返回待机状态。');
            }
        } catch (error) {
            log('main', '执行单个任务', `执行任务时出错: ${String(error)}`, 'error');
            if (!shouldStopTask) {
                await updateActivityStatus('Idle');
            }
        } finally {
            isTaskRunning = false;
            // 确认命令已执行
            await confirmCommandToServer('RUN_TASK');
        }
    }

    // 任务执行函数
    async function executeTasks() {
        if (isTaskRunning) return;
        isTaskRunning = true;
        try {
            shouldStopTask = false; // 重置停止标志
            await updateActivityStatus('Running');

            const accounts = await loadAccounts();
            if (accounts.length > 0) {
                await runHotSearchScript(accounts);
                await runTasksForAccounts(accounts, config);
            } else {
                log('main', '主流程', '未获取到分配的账户，本轮任务结束。');
            }

            if (!shouldStopTask) {
                await updateActivityStatus('Idle');
                log('main', '主流程', '所有任务执行完毕，返回待机状态。');
            }
        } catch (error) {
            log('main', '任务执行', `执行任务时出错: ${String(error)}`, 'error');
            if (!shouldStopTask) {
                await updateActivityStatus('Idle');
            }
        } finally {
            isTaskRunning = false;
        }
    }

    // 步骤 5: 开始主循环，监听任务
    while (true) {
        try {
            log('main', '主流程', '正在向指挥中心请求指令 (长轮询)...');
            const commandUrl = new URL(config.apiServer.updateUrl);
            commandUrl.pathname = '/bot_api/command_poll';

            const response = await axios.get(commandUrl.toString(), {
                headers: { 'Authorization': `Bearer ${config.apiServer.token}` },
                timeout: 60000
            });

            const command = response.data.command;

            if (command === 'RUN_TASKS') {
                log('main', '主流程', '收到 [执行任务] 指令，开始执行...');
                // 异步执行任务，不阻塞主循环
                if (!isTaskRunning) {
                    executeTasks().catch(err => {
                        log('main', '任务执行', `任务执行出错: ${String(err)}`, 'error');
                    });
                    // 确认命令已接收
                    await confirmCommandToServer('RUN_TASKS');
                } else {
                    log('main', '主流程', '任务正在执行中，忽略重复的执行指令', 'warn');
                    // 确认命令已接收但无需执行
                    await confirmCommandToServer('RUN_TASKS');
                }
            } else if (command === 'RUN_TASK') {
                log('main', '主流程', '收到 [执行单个任务] 指令，开始执行...');
                const taskData = response.data.data;
                log('main', '主流程', `任务数据: ${JSON.stringify(taskData)}`);
                // 异步执行单个任务，不阻塞主循环
                if (!isTaskRunning) {
                    executeSingleTask(taskData).catch(err => {
                        log('main', '任务执行', `单个任务执行出错: ${String(err)}`, 'error');
                    });
                } else {
                    log('main', '主流程', '任务正在执行中，无法执行单个任务', 'warn');
                    // 确认命令已接收但无法执行
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
                log('main', '主流程', '收到 [空命令]，忽略...', 'log');
                // 不将空命令视为停止指令
            } else {
                log('main', '主流程', `收到未知命令: ${command}`, 'warn');
            }

        } catch (error) {
            let errorMessage: string;
            if (axios.isAxiosError(error) && (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT')) {
                errorMessage = '长轮询超时，正在发起下一次请求...';
            } else if (axios.isAxiosError(error)) {
                errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
            } else {
                errorMessage = String(error);
            }
            log('main', '主流程', `主循环出错: ${errorMessage}`, 'warn');
            await utils.wait(30000);
        }
    }
}

main().catch(error => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log('main', '主流程-致命错误', `运行机器人时发生致命错误: ${errorMessage}`, 'error');
    process.exit(1);
});