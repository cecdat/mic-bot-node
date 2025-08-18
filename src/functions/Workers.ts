import { Page } from 'rebrowser-playwright'
import fs from 'fs'
import path from 'path'
// [FIX] Removed unused imports for MorePromotion, PromotionalItem, and PunchCard
import { DashboardData } from '../interface/DashboardData'
import { UnifiedTask } from '../util/AIOrcestrator'
import { MicrosoftRewardsBot } from '../index'

export class Workers {
    public bot: MicrosoftRewardsBot

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot
    }

    /**
     * [新增] 执行由AI调度器派发的单个任务
     * @param dashboardPage 仪表盘主页面
     * @param task 要执行的单个任务对象
     */
    async executeTask(dashboardPage: Page, task: UnifiedTask) {
        // 检查是否需要停止
        if (this.bot.checkStopStatus()) {
            this.bot.log(this.bot.isMobile, '活动执行', '检测到停止指令，终止当前任务', 'warn');
            return;
        }
        const activityInitial = dashboardPage.url();
        
        try {
            let currentPage = await this.bot.browser.utils.getLatestTab(dashboardPage);
            const pages = currentPage.context().pages();
            if (pages.length > 2) { // 保持主页面和工作页面
                await currentPage.close().catch(() => {});
                currentPage = await this.bot.browser.utils.getLatestTab(dashboardPage);
            }

            if (currentPage.url() !== activityInitial) {
                await currentPage.goto(activityInitial);
            }

            this.bot.log(this.bot.isMobile, '活动执行', `正在检查并关闭可能的弹窗...`);
            await this.bot.browser.utils.tryDismissAllMessages(currentPage);
            
            await this.executeSingleTask(currentPage, task);
            
            await this.bot.utils.wait(2000);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '活动执行', `执行任务 "${task.title}" 时发生错误: ${errorMessage}`, 'error');
        }
    }
    
    public async executeSingleTask(currentPage: Page, task: UnifiedTask) {
        try {
            this.bot.log(this.bot.isMobile, '活动执行', `开始执行任务: "${task.title}"`);
            
            // 任务执行前快照（根据配置决定是否保存）
            if (this.bot.config.snapshots?.taskExecution) {
                try {
                    const sessionDir = path.join(this.bot.config.sessionPath, 'task_snapshots');
                    await fs.promises.mkdir(sessionDir, { recursive: true });
                    
                    const timestamp = Date.now();
                    const taskName = task.title.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20);
                    const snapshotPath = path.join(sessionDir, `task_before_${taskName}_${timestamp}.png`);
                    const htmlPath = path.join(sessionDir, `task_before_${taskName}_${timestamp}.html`);
                    
                    await currentPage.screenshot({ path: snapshotPath, fullPage: true });
                    const pageHtml = await currentPage.content();
                    await fs.promises.writeFile(htmlPath, pageHtml);
                    
                    this.bot.log(this.bot.isMobile, '活动执行', `任务执行前快照已保存: ${snapshotPath}, ${htmlPath}`);
                } catch (snapshotError) {
                    this.bot.log(this.bot.isMobile, '活动执行', `保存任务执行前快照失败: ${snapshotError}`, 'warn');
                }
            }

            // 检查页面是否有效
            if (currentPage.isClosed()) {
                throw new Error('当前页面已关闭，无法执行任务');
            }

            // 对于 urlreward 类型的任务，使用简化的处理逻辑
            if (task.promotionType === 'urlreward') {
                await this.handleUrlRewardTask(currentPage, task);
                return;
            }

            // 其他类型的任务，导航到目标页面并查找活动元素
            const selector = task.destinationUrl;
            if (!selector) {
                this.bot.log(this.bot.isMobile, '活动执行', `跳过任务 "${task.title}" | 原因: 缺少目标URL！`, 'warn');
                return;
            }

            // 导航到任务页面
            await this.navigateToTaskPage(currentPage, selector);

            // 查找活动元素
            const activityLocator = await this.findActivityElement(currentPage, task);

            if (activityLocator) {
                this.bot.log(this.bot.isMobile, '活动执行', '成功定位到目标元素，开始执行点击');
                await activityLocator.click();
                await this.bot.utils.wait(2000);
            } else {
                throw new Error(`无法找到任务 "${task.title}" 的目标元素`);
            }

            // 任务执行后快照（根据配置决定是否保存）
            if (this.bot.config.snapshots?.taskExecution) {
                try {
                    const sessionDir = path.join(this.bot.config.sessionPath, 'task_snapshots');
                    await fs.promises.mkdir(sessionDir, { recursive: true });
                    
                    const timestamp = Date.now();
                    const taskName = task.title.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20);
                    const snapshotPath = path.join(sessionDir, `task_after_${taskName}_${timestamp}.png`);
                    const htmlPath = path.join(sessionDir, `task_after_${taskName}_${timestamp}.html`);
                    
                    await currentPage.screenshot({ path: snapshotPath, fullPage: true });
                    const pageHtml = await currentPage.content();
                    await fs.promises.writeFile(htmlPath, pageHtml);
                    
                    this.bot.log(this.bot.isMobile, '活动执行', `任务执行后快照已保存: ${snapshotPath}, ${htmlPath}`);
                } catch (snapshotError) {
                    this.bot.log(this.bot.isMobile, '活动执行', `保存任务执行后快照失败: ${snapshotError}`, 'warn');
                }
            }

            // 路由到具体的任务处理器
            const activityTab = await this.bot.browser.utils.getLatestTab(currentPage).catch(() => currentPage);
            await this.routeTaskToSolver(activityTab, task);
            
            await this.bot.utils.wait(2000);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '活动执行', `执行任务 "${task.title}" 时发生错误: ${errorMessage}`, 'error');
            
            // 记录更详细的错误信息
            if (error instanceof Error && error.stack) {
                this.bot.log(this.bot.isMobile, '活动执行', `错误堆栈: ${error.stack}`, 'error');
            }
            
            // 对于任务定位失败的情况，记录但继续执行其他任务
            if (errorMessage.includes('无法找到任务') || errorMessage.includes('目标元素')) {
                this.bot.log(this.bot.isMobile, '活动执行', `任务 "${task.title}" 定位失败，跳过此任务继续执行其他任务`, 'warn');
                return; // 跳过此任务，继续执行下一个
            }
            
            // 对于其他严重错误，可能需要重新考虑是否继续
            this.bot.log(this.bot.isMobile, '活动执行', `任务 "${task.title}" 执行失败，但将继续执行其他任务`, 'warn');
        }
    }

    /**
     * 处理 URL 奖励任务
     */
    private async handleUrlRewardTask(currentPage: Page, task: UnifiedTask): Promise<void> {
        try {
            this.bot.log(this.bot.isMobile, '活动', `发现活动类型: "URL奖励" 标题: "${task.title}"`);
            
            // 导航到目标URL
            await this.navigateToTaskPage(currentPage, task.destinationUrl);
            
            // 等待页面加载完成
            await this.bot.utils.wait(3000);
            
            // 对于 URL 奖励任务，通常只需要访问页面即可
            // 不需要额外的点击操作
            this.bot.log(this.bot.isMobile, 'URL奖励', '尝试完成URL奖励');
            
            // 等待一段时间确保奖励被记录
            await this.bot.utils.wait(2000);
            
            this.bot.log(this.bot.isMobile, 'URL奖励', '成功完成URL奖励');
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, 'URL奖励', `发生错误: ${errorMessage}`, 'error');
            throw error;
        }
    }

    /**
     * 导航到任务页面
     */
    private async navigateToTaskPage(currentPage: Page, url: string): Promise<void> {
        let loadSuccess = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                // 检查页面状态
                if (currentPage.isClosed()) {
                    throw new Error('页面在执行过程中被关闭');
                }

                // 使用更宽松的导航选项
                await currentPage.goto(url, { 
                    referer: this.bot.config.baseURL,
                    waitUntil: 'domcontentloaded',
                    timeout: 30000
                });
                
                // 再次检查页面状态
                if (currentPage.isClosed()) {
                    throw new Error('页面在导航过程中被关闭');
                }

                // 等待页面基本加载完成
                await currentPage.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
                await this.bot.utils.wait(2000);
                loadSuccess = true;
                break;
            } catch (loadError) {
                if (attempt === 3) {
                    throw loadError;
                }
                this.bot.log(this.bot.isMobile, '活动执行', `页面加载尝试 ${attempt} 失败，重试中...`, 'warn');
                await this.bot.utils.wait(2000);
            }
        }

        if (!loadSuccess) {
            throw new Error('页面加载最终失败');
        }
    }

    /**
     * 查找活动元素
     */
    private async findActivityElement(currentPage: Page, task: UnifiedTask): Promise<any> {
        // 策略1: 尝试查找常见的活动元素
        const commonSelectors = [
            '.pointLink',
            '[data-bi-id*="Rewards"]',
            '.offer-cta',
            '.activity-link',
            'a[href*="rewards"]',
            'button[onclick*="rewards"]',
            '[role="button"]',
            'a[href*="bing.com"]',
            'a[href*="microsoft.com"]',
            'a[href*="rewards.bing.com"]'
        ];

        for (const commonSelector of commonSelectors) {
            try {
                const locator = currentPage.locator(commonSelector);
                const count = await locator.count();
                if (count > 0) {
                    const firstElement = locator.first();
                    if (await firstElement.isVisible({ timeout: 3000 }).catch(() => false)) {
                        this.bot.log(this.bot.isMobile, '活动执行', `使用通用选择器找到元素: ${commonSelector}`);
                        return firstElement;
                    }
                }
            } catch (selectorError) {
                // 继续尝试下一个选择器
            }
        }

        // 策略2: 尝试查找包含任务标题的链接
        try {
            const titleKeywords = task.title.toLowerCase().split(' ');
            const allLinks = currentPage.locator('a');
            const count = await allLinks.count();
            
            for (let i = 0; i < Math.min(count, 20); i++) {
                try {
                    const link = allLinks.nth(i);
                    const text = await link.textContent();
                    if (text && titleKeywords.some(keyword => text.toLowerCase().includes(keyword))) {
                        if (await link.isVisible({ timeout: 2000 }).catch(() => false)) {
                            this.bot.log(this.bot.isMobile, '活动执行', `通过标题关键词找到元素: ${text}`);
                            return link;
                        }
                    }
                } catch (linkError) {
                    // 继续检查下一个链接
                }
            }
        } catch (error) {
            this.bot.log(this.bot.isMobile, '活动执行', `标题关键词搜索失败: ${error}`, 'warn');
        }

        return null;
    }

    private async routeTaskToSolver(activityPage: Page, activity: UnifiedTask) {
        // 检查是否需要停止
        if (this.bot.checkStopStatus()) {
            this.bot.log(this.bot.isMobile, '活动执行', '检测到停止指令，终止当前任务', 'warn');
            return;
        }
        switch (activity.promotionType) {
            case 'quiz':
                switch (activity.pointProgressMax) {
                    case 10:
                        if (activity.destinationUrl.toLowerCase().includes('pollscenarioid')) {
                            this.bot.log(this.bot.isMobile, '活动', `发现活动类型: "投票" 标题: "${activity.title}"`)
                            await this.bot.activities.doPoll(activityPage)
                        } else {
                            this.bot.log(this.bot.isMobile, '活动', `发现活动类型: "ABC" 标题: "${activity.title}"`)
                            await this.bot.activities.doABC(activityPage)
                        }
                        break
                    case 50:
                        this.bot.log(this.bot.isMobile, '活动', `发现活动类型: "ThisOrThat" 标题: "${activity.title}"`)
                        await this.bot.activities.doThisOrThat(activityPage)
                        break
                    default:
                        this.bot.log(this.bot.isMobile, '活动', `发现活动类型: "测验" 标题: "${activity.title}"`)
                        await this.bot.activities.doQuiz(activityPage)
                        break
                }
                break;
            case 'urlreward':
                if (activity.name?.toLowerCase().includes('exploreonbing')) {
                    this.bot.log(this.bot.isMobile, '活动', `发现活动类型: "在必应上搜索" 标题: "${activity.title}"`)
                    await this.bot.activities.doSearchOnBing(activityPage, activity)
                } else {
                    this.bot.log(this.bot.isMobile, '活动', `发现活动类型: "URL奖励" 标题: "${activity.title}"`)
                    await this.bot.activities.doUrlReward(activityPage)
                }
                break;
            default:
                this.bot.log(this.bot.isMobile, '活动', `跳过活动 "${activity.title}" | 原因: 不支持的类型: "${activity.promotionType}"！`, 'warn')
                break;
        }
    }

    async doPunchCard(page: Page, data: DashboardData) {
        const punchCardsUncompleted = data.punchCards?.filter(x => x.parentPromotion && !x.parentPromotion.complete) ?? [];
        if (!punchCardsUncompleted.length) {
            this.bot.log(this.bot.isMobile, '打卡任务', '所有"打卡任务"已完成');
            return;
        }
        for (const punchCard of punchCardsUncompleted) {
            if (!punchCard.parentPromotion?.title) {
                this.bot.log(this.bot.isMobile, '打卡任务', `跳过打卡任务 "${punchCard.name}" | 原因: 父推广活动缺失！`, 'warn');
                continue;
            }
            
            // 检查页面状态
            if (page.isClosed()) {
                this.bot.log(this.bot.isMobile, '打卡任务', '主页面已关闭，无法继续执行打卡任务', 'error');
                return;
            }
            
            let currentPage = await this.bot.browser.utils.getLatestTab(page).catch(() => page);
            
            // 检查获取到的页面是否有效
            if (currentPage.isClosed()) {
                this.bot.log(this.bot.isMobile, '打卡任务', '无法获取有效的页面来执行打卡任务', 'error');
                continue;
            }
            
            const activitiesUncompleted = punchCard.childPromotions.filter(x => !x.complete);
            this.bot.log(this.bot.isMobile, '打卡任务', `开始为打卡任务解决项目: "${punchCard.parentPromotion.title}"`);
            
            try {
                await currentPage.goto(punchCard.parentPromotion.destinationUrl, { referer: this.bot.config.baseURL });
                
                // 检查页面是否在导航过程中被关闭
                if (currentPage.isClosed()) {
                    this.bot.log(this.bot.isMobile, '打卡任务', '页面在导航过程中被关闭', 'error');
                    continue;
                }
                
                await currentPage.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

                for (const activity of activitiesUncompleted) {
                    // 检查是否需要停止
                    if (this.bot.checkStopStatus()) {
                        this.bot.log(this.bot.isMobile, '打卡任务', '检测到停止指令，终止打卡任务', 'warn');
                        return;
                    }
                    
                    // 检查页面状态
                    if (currentPage.isClosed()) {
                        this.bot.log(this.bot.isMobile, '打卡任务', '页面在执行任务过程中被关闭', 'error');
                        break;
                    }
                    
                    await this.executeSingleTask(currentPage, activity);
                }
                
                currentPage = await this.bot.browser.utils.getLatestTab(page).catch(() => page);
                
                // 检查页面状态
                if (currentPage && !currentPage.isClosed()) {
                    const pages = currentPage.context().pages();
                    if (pages.length > 2) {
                        await currentPage.close().catch(() => {});
                    } else {
                        await this.bot.browser.func.goHome(currentPage);
                    }
                }
                
                this.bot.log(this.bot.isMobile, '打卡任务', `打卡任务的所有项目: "${punchCard.parentPromotion.title}" 已完成`);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                this.bot.log(this.bot.isMobile, '打卡任务', `执行打卡任务 "${punchCard.parentPromotion.title}" 时发生错误: ${errorMessage}`, 'error');
                continue; // 继续执行下一个打卡任务
            }
        }
        this.bot.log(this.bot.isMobile, '打卡任务', '所有"打卡任务"项已完成');
    }
}
