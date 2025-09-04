import Axios from './util/Axios';
import { Account } from './interface/Account';
import { MicrosoftRewardsBot } from './index';
import { log } from './util/Logger';

async function main() {
    try {
        const accountJson = process.env.ACCOUNT;
        const taskType = process.env.TASK_TYPE;
        
        if (!accountJson) {
            throw new Error('ACCOUNT env not provided');
        }
        if (!taskType) {
            throw new Error('TASK_TYPE env not provided');
        }
        
        const account: Account = JSON.parse(accountJson);
        log('main', '子进程', `🚀 开始执行 ${taskType} 任务，账户: ${account.email}`);

        const bot = new MicrosoftRewardsBot();
        bot.account = account;
        bot.axios = new Axios(account.proxy);

        // 根据任务类型执行相应的任务，而不是执行完整的桌面端+移动端流程
        if (taskType === 'desktop') {
            // 只执行桌面端任务
            log('main', '子进程', `[${account.email}] 🖥️ 执行桌面端任务`);
            try {
                const todayStr = bot.utils.getYYYYMMDD();
                const dailyPointsData = await bot.loadDailyPoints(bot.config.sessionPath, account.email);
                let initialPointsToday = 0;
                
                if (dailyPointsData && dailyPointsData.date === todayStr) {
                    initialPointsToday = dailyPointsData.initialPoints;
                    log('main', '子进程', `[${account.email}] 💰 使用已保存的今日初始积分: ${initialPointsToday}`);
                }
                
                const desktopResult = await bot.executeDesktopTask(account, initialPointsToday);
                log('main', '子进程', `[${account.email}] ✅ 桌面端任务执行完成，积分: ${desktopResult.points}, 收益: ${desktopResult.gain}`);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                log('main', '子进程', `[${account.email}] ❌ 桌面端任务执行失败: ${errorMessage}`, 'error');
                throw error;
            }
        } else if (taskType === 'mobile') {
            // 只执行移动端任务
            log('main', '子进程', `[${account.email}] 📱 执行移动端任务`);
            try {
                // 从保存的每日积分数据中获取桌面端完成后的积分
                const todayStr = bot.utils.getYYYYMMDD();
                const dailyPointsData = await bot.loadDailyPoints(bot.config.sessionPath, account.email);
                let desktopFinalPoints = 0;
                
                if (dailyPointsData && dailyPointsData.date === todayStr && dailyPointsData.desktopFinalPoints) {
                    desktopFinalPoints = dailyPointsData.desktopFinalPoints;
                    log('main', '子进程', `[${account.email}] 💰 读取到桌面端完成后的积分: ${desktopFinalPoints}`);
                } else {
                    log('main', '子进程', `[${account.email}] ⚠️ 未找到桌面端完成后的积分，使用默认值: 0`, 'warn');
                }
                
                const mobileResult = await bot.executeMobileTask(account, desktopFinalPoints);
                log('main', '子进程', `[${account.email}] ✅ 移动端任务执行完成，积分: ${mobileResult.points}, 收益: ${mobileResult.gain}`);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                log('main', '子进程', `[${account.email}] ❌ 移动端任务执行失败: ${errorMessage}`, 'error');
                throw error;
            }
        } else {
            throw new Error(`未知的任务类型: ${taskType}`);
        }
        
        log('main', '子进程', `[${account.email}] 🎉 ${taskType} 任务执行成功`);
        process.exit(0);
    } catch (err: any) {
        log('main', '子进程', `💥 执行失败: ${err?.message || String(err)}`, 'error');
        process.exit(1);
    }
}

main();


