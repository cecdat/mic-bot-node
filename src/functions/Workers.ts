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
            
            const selector = task.destinationUrl;
            if (!selector) {
                this.bot.log(this.bot.isMobile, '活动执行', `跳过任务 "${task.title}" | 原因: 缺少目标URL！`, 'warn');
                return;
            }

            // 检查页面是否有效
            if (currentPage.isClosed()) {
                throw new Error('当前页面已关闭，无法执行任务');
            }

            // 增加页面加载等待和重试机制
            let loadSuccess = false;
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    // 检查页面状态
                    if (currentPage.isClosed()) {
                        throw new Error('页面在执行过程中被关闭');
                    }

                    await currentPage.goto(selector, { referer: this.bot.config.baseURL });
                    
                    // 再次检查页面状态
                    if (currentPage.isClosed()) {
                        throw new Error('页面在导航过程中被关闭');
                    }

                    await currentPage.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
                    await this.bot.utils.wait(3000); // 增加等待时间
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

            // 最终检查页面状态
            if (currentPage.isClosed()) {
                throw new Error('页面在加载完成后被关闭');
            }

            // 尝试多种元素定位策略
            let activityLocator = null;
            let elementFound = false;

            // 策略1: 尝试使用URL作为选择器
            try {
                activityLocator = currentPage.locator(selector);
                const isVisible = await activityLocator.isVisible({ timeout: 5000 }).catch(() => false);
                if (isVisible) {
                    elementFound = true;
                    this.bot.log(this.bot.isMobile, '活动执行', `使用URL选择器找到元素`);
                }
            } catch (error) {
                this.bot.log(this.bot.isMobile, '活动执行', `URL选择器失败: ${error}`, 'warn');
            }

            // 策略2: 尝试查找常见的活动元素
            if (!elementFound) {
                try {
                    const commonSelectors = [
                        '.pointLink',
                        '[data-bi-id*="Rewards"]',
                        '.offer-cta',
                        '.activity-link',
                        'a[href*="rewards"]',
                        'button[onclick*="rewards"]'
                    ];

                    for (const commonSelector of commonSelectors) {
                        try {
                            const locator = currentPage.locator(commonSelector);
                            const count = await locator.count();
                            if (count > 0) {
                                const firstElement = locator.first();
                                if (await firstElement.isVisible({ timeout: 3000 }).catch(() => false)) {
                                    activityLocator = firstElement;
                                    elementFound = true;
                                    this.bot.log(this.bot.isMobile, '活动执行', `使用通用选择器找到元素: ${commonSelector}`);
                                    break;
                                }
                            }
                        } catch (selectorError) {
                            // 继续尝试下一个选择器
                        }
                    }
                } catch (error) {
                    this.bot.log(this.bot.isMobile, '活动执行', `通用选择器策略失败: ${error}`, 'warn');
                }
            }

            // 策略3: 尝试查找包含任务标题的链接
            if (!elementFound) {
                try {
                    const titleKeywords = task.title.toLowerCase().split(' ');
                    const linkLocator = currentPage.locator('a, button');
                    const count = await linkLocator.count();
                    
                    for (let i = 0; i < Math.min(count, 20); i++) { // 限制检查前20个元素
                        try {
                            const element = linkLocator.nth(i);
                            const text = await element.textContent().catch(() => '');
                            
                            if (text && titleKeywords.some(keyword => text.toLowerCase().includes(keyword))) {
                                if (await element.isVisible({ timeout: 3000 }).catch(() => false)) {
                                    activityLocator = element;
                                    elementFound = true;
                                    this.bot.log(this.bot.isMobile, '活动执行', `通过标题关键词找到元素: "${text}"`);
                                    break;
                                }
                            }
                        } catch (elementError) {
                            // 继续检查下一个元素
                        }
                    }
                } catch (error) {
                    this.bot.log(this.bot.isMobile, '活动执行', `标题关键词策略失败: ${error}`, 'warn');
                }
            }

            if (!elementFound || !activityLocator) {
                // 根据配置决定是否收集调试信息
                if (this.bot.config.debugOptions?.saveTaskDebugInfo) {
                    this.bot.log(this.bot.isMobile, '活动执行', `任务 "${task.title}" 定位失败，正在收集调试信息...`, 'warn');
                    
                    // 保存页面截图和HTML用于调试
                    if (this.bot.config.debugOptions?.saveTaskScreenshots || this.bot.config.debugOptions?.saveTaskHtml) {
                        try {
                            const debugDir = path.join(this.bot.config.sessionPath, 'debug');
                            await fs.promises.mkdir(debugDir, { recursive: true });
                            
                            const timestamp = Date.now();
                            const taskName = task.title.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20);
                            
                            if (this.bot.config.debugOptions?.saveTaskScreenshots) {
                                const screenshotPath = path.join(debugDir, `task_${taskName}_${timestamp}.png`);
                                await currentPage.screenshot({ path: screenshotPath, fullPage: true });
                                this.bot.log(this.bot.isMobile, '活动执行', `任务截图已保存: ${screenshotPath}`, 'warn');
                            }
                            
                            if (this.bot.config.debugOptions?.saveTaskHtml) {
                                const htmlPath = path.join(debugDir, `task_${taskName}_${timestamp}.html`);
                                const pageHtml = await currentPage.content();
                                await fs.promises.writeFile(htmlPath, pageHtml);
                                this.bot.log(this.bot.isMobile, '活动执行', `任务HTML已保存: ${htmlPath}`, 'warn');
                            }
                        } catch (debugError) {
                            this.bot.log(this.bot.isMobile, '活动执行', `保存调试信息失败: ${debugError}`, 'warn');
                        }
                    }
                    
                    // 记录任务详细信息
                    if (this.bot.config.debugOptions?.logTaskDetails) {
                        this.bot.log(this.bot.isMobile, '活动执行', `任务详情:`, 'warn');
                        this.bot.log(this.bot.isMobile, '活动执行', `  - 标题: ${task.title}`, 'warn');
                        this.bot.log(this.bot.isMobile, '活动执行', `  - 类型: ${task.promotionType}`, 'warn');
                        this.bot.log(this.bot.isMobile, '活动执行', `  - 目标URL: ${task.destinationUrl}`, 'warn');
                        this.bot.log(this.bot.isMobile, '活动执行', `  - 完成状态: ${task.complete}`, 'warn');
                        this.bot.log(this.bot.isMobile, '活动执行', `  - 积分: ${task.pointProgress}/${task.pointProgressMax}`, 'warn');
                        
                        // 检查页面上的所有链接和按钮
                        try {
                            const allLinks = await currentPage.locator('a, button').count();
                            const allTexts = await currentPage.locator('a, button').allTextContents();
                            this.bot.log(this.bot.isMobile, '活动执行', `页面上共有 ${allLinks} 个链接/按钮`, 'warn');
                            this.bot.log(this.bot.isMobile, '活动执行', `前10个元素文本: ${allTexts.slice(0, 10).join(', ')}`, 'warn');
                        } catch (countError) {
                            this.bot.log(this.bot.isMobile, '活动执行', `统计页面元素失败: ${countError}`, 'warn');
                        }
                    }
                }
                
                throw new Error(`无法找到任务 "${task.title}" 的目标元素，尝试了多种定位策略。请查看调试信息。`);
            }

            this.bot.log(this.bot.isMobile, '活动执行', `成功定位到目标元素，开始执行点击`);
            await this.bot.utils.humanClick(activityLocator);
            
            // 获取新标签页前检查当前页面状态
            if (currentPage.isClosed()) {
                throw new Error('页面在点击后被关闭');
            }

            const activityTab = await this.bot.browser.utils.getLatestTab(currentPage);
            
            await this.routeTaskToSolver(activityTab, task);
            
            // 任务执行后快照（根据配置决定是否保存）
            if (this.bot.config.snapshots?.taskExecution) {
                try {
                    const sessionDir = path.join(this.bot.config.sessionPath, 'task_snapshots');
                    await fs.promises.mkdir(sessionDir, { recursive: true });
                    
                    const timestamp = Date.now();
                    const taskName = task.title.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20);
                    const snapshotPath = path.join(sessionDir, `task_after_${taskName}_${timestamp}.png`);
                    const htmlPath = path.join(sessionDir, `task_after_${taskName}_${timestamp}.html`);
                    
                    await activityTab.screenshot({ path: snapshotPath, fullPage: true });
                    const pageHtml = await activityTab.content();
                    await fs.promises.writeFile(htmlPath, pageHtml);
                    
                    this.bot.log(this.bot.isMobile, '活动执行', `任务执行后快照已保存: ${snapshotPath}, ${htmlPath}`);
                } catch (snapshotError) {
                    this.bot.log(this.bot.isMobile, '活动执行', `保存任务执行后快照失败: ${snapshotError}`, 'warn');
                }
            }
            
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
                if (activity.name.toLowerCase().includes('exploreonbing')) {
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
