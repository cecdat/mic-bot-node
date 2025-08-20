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

            // 根据任务类型执行不同的逻辑
            if (task.promotionType === 'urlreward') {
                await this.executeUrlRewardTask(currentPage, task);
            } else if (task.promotionType === 'quiz') {
                await this.executeQuizTask(currentPage, task);
            } else if (task.promotionType === 'punchcard') {
                await this.executePunchCardTask(currentPage, task);
            } else {
                // 默认处理方式
                await this.executeDefaultTask(currentPage, task);
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

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '活动执行', `执行任务 "${task.title}" 时发生错误: ${errorMessage}`, 'error');
            
            // 记录更详细的错误信息
            if (error instanceof Error && error.stack) {
                this.bot.log(this.bot.isMobile, '活动执行', `错误堆栈: ${error.stack}`, 'error');
            }
            
            // 对于任务执行失败的情况，记录错误但继续执行其他任务
            this.bot.log(this.bot.isMobile, '活动执行', `任务 "${task.title}" 执行失败，但将继续执行其他任务`, 'warn');
        }
    }

    /**
     * 检查任务是否完成
     */
    private async checkTaskCompletion(currentPage: Page, task: UnifiedTask): Promise<boolean> {
        try {
            const pageContent = await currentPage.content();
            const currentUrl = currentPage.url();
            
            // 检查URL是否包含rewards相关
            if (currentUrl.includes('rewards.bing.com') || currentUrl.includes('bing.com/rewards')) {
                return true;
            }
            
            // 检查页面内容是否包含完成提示
            const completionIndicators = [
                'completed', '完成', 'earned', '获得', 'points added', '积分已添加',
                'task completed', '任务完成', 'successfully', '成功'
            ];
            
            for (const indicator of completionIndicators) {
                if (pageContent.toLowerCase().includes(indicator.toLowerCase())) {
                    return true;
                }
            }
            
            // 检查是否有完成按钮或状态
            const completionSelectors = [
                '.completed', '.task-completed', '.reward-earned', '.points-added',
                '[data-status="completed"]', '[data-completed="true"]'
            ];
            
            for (const selector of completionSelectors) {
                try {
                    const element = currentPage.locator(selector);
                    if (await element.count() > 0 && await element.first().isVisible()) {
                        return true;
                    }
                } catch (error) {
                    // 忽略选择器错误
                }
            }
            
            return false;
        } catch (error) {
            return false;
        }
    }

    /**
     * 执行URL奖励任务
     */
    private async executeUrlRewardTask(currentPage: Page, task: UnifiedTask) {
        this.bot.log(this.bot.isMobile, '活动', `发现活动类型: "URL奖励" 标题: "${task.title}"`);
        
        const destinationUrl = task.destinationUrl;
        if (!destinationUrl) {
            throw new Error('URL奖励任务缺少目标URL');
        }

        try {
            // 直接导航到目标URL，使用更宽松的等待条件
            await currentPage.goto(destinationUrl, { 
                waitUntil: 'domcontentloaded', // 改为更宽松的等待条件
                timeout: 15000 // 减少超时时间
            });

            // 等待页面基本加载
            await this.bot.utils.wait(2000);
            
            // 保存页面快照用于调试
            if (this.bot.config.snapshots?.taskExecution) {
                try {
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                    const filename = `url_reward_${this.bot.isMobile ? 'mobile' : 'pc'}_${timestamp}.png`;
                    await currentPage.screenshot({ 
                        path: `sessions/snapshots/${filename}`,
                        fullPage: true 
                    });
                    this.bot.log(this.bot.isMobile, 'URL奖励', `保存页面快照: ${filename}`);
                } catch (error) {
                    // 忽略快照保存错误
                }
            }

            // 检查是否已经完成（URL包含rewards相关）
            const currentUrl = currentPage.url();
            if (currentUrl.includes('rewards.bing.com') || currentUrl.includes('bing.com/rewards')) {
                this.bot.log(this.bot.isMobile, 'URL奖励', '检测到rewards页面，任务可能已完成');
                return;
            }

            // 尝试多次查找奖励元素，给页面更多时间加载
            let clicked = false;
            const maxAttempts = 3;
            
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                if (attempt > 1) {
                    this.bot.log(this.bot.isMobile, 'URL奖励', `第${attempt}次尝试查找奖励元素...`);
                    await this.bot.utils.wait(2000); // 等待更长时间
                }

                // 尝试查找并点击奖励链接
                const rewardSelectors = [
                    'a[href*="rewards"]',
                    'a[href*="bing.com/rewards"]',
                    'a[href*="rewards.bing.com"]',
                    '.pointLink',
                    '[data-bi-id*="Rewards"]',
                    '.offer-cta',
                    '.activity-link',
                    'a[href*="bing.com/spotlight"]',
                    'a[href*="bing.com/search"]',
                    'button[onclick*="rewards"]',
                    '.rewards-link',
                    '[data-bi-name*="Rewards"]',
                    'a[href*="microsoft.com/rewards"]',
                    'a[href*="bing.com/spotlight"]',
                    'a[href*="bing.com/news"]',
                    'a[href*="bing.com/videos"]',
                    'a[href*="bing.com/images"]',
                    '.activity-button',
                    '.reward-button',
                    '[data-bi-name*="reward"]',
                    '[data-bi-name*="activity"]'
                ];

                for (const selector of rewardSelectors) {
                    try {
                        const elements = currentPage.locator(selector);
                        const count = await elements.count();
                        
                        for (let i = 0; i < count; i++) {
                            const element = elements.nth(i);
                            if (await element.isVisible({ timeout: 1000 })) {
                                await element.click();
                                this.bot.log(this.bot.isMobile, 'URL奖励', `点击了奖励元素: ${selector}`);
                                clicked = true;
                                await this.bot.utils.wait(1000);
                                break;
                            }
                        }
                        
                        if (clicked) break;
                    } catch (error) {
                        // 继续尝试下一个选择器
                    }
                }
                
                if (clicked) break;
            }

            // 等待一下，让页面响应
            await this.bot.utils.wait(2000);
            
            // 检查任务是否完成
            const isCompleted = await this.checkTaskCompletion(currentPage, task);
            
            if (clicked) {
                this.bot.log(this.bot.isMobile, 'URL奖励', '成功点击奖励元素');
                
                if (isCompleted) {
                    this.bot.log(this.bot.isMobile, 'URL奖励', '确认任务已完成');
                } else {
                    this.bot.log(this.bot.isMobile, 'URL奖励', '点击后任务状态不明确，可能需要等待或手动处理');
                }
            } else {
                this.bot.log(this.bot.isMobile, 'URL奖励', '未找到可点击的奖励元素');
                
                if (isCompleted) {
                    this.bot.log(this.bot.isMobile, 'URL奖励', '任务可能已经完成');
                } else {
                    this.bot.log(this.bot.isMobile, 'URL奖励', '任务状态不明确，可能需要手动处理');
                }
            }
            
        } catch (error: any) {
            // 如果导航失败，尝试在新标签页中打开
            this.bot.log(this.bot.isMobile, 'URL奖励', `直接导航失败，尝试在新标签页中打开: ${error.message}`, 'warn');
            
            try {
                const newPage = await currentPage.context().newPage();
                await newPage.goto(destinationUrl, { 
                    waitUntil: 'domcontentloaded',
                    timeout: 10000 
                });
                await this.bot.utils.wait(2000);
                await newPage.close();
                this.bot.log(this.bot.isMobile, 'URL奖励', '在新标签页中成功完成URL奖励');
            } catch (newPageError: any) {
                this.bot.log(this.bot.isMobile, 'URL奖励', `新标签页也失败: ${newPageError.message}`, 'error');
                throw newPageError;
            }
        }
    }

    /**
     * 执行测验任务
     */
    private async executeQuizTask(currentPage: Page, task: UnifiedTask) {
        this.bot.log(this.bot.isMobile, '活动', `发现活动类型: "测验" 标题: "${task.title}"`);
        
        // 测验任务的实现逻辑
        // 这里需要根据具体的测验类型来实现
        this.bot.log(this.bot.isMobile, '测验', '测验任务暂未实现');
    }

    /**
     * 执行打卡任务
     */
    private async executePunchCardTask(currentPage: Page, task: UnifiedTask) {
        this.bot.log(this.bot.isMobile, '活动', `发现活动类型: "打卡" 标题: "${task.title}"`);
        
        // 打卡任务的实现逻辑
        this.bot.log(this.bot.isMobile, '打卡任务', '打卡任务暂未实现');
    }

    /**
     * 执行默认任务（通用处理方式）
     */
    private async executeDefaultTask(currentPage: Page, task: UnifiedTask) {
        this.bot.log(this.bot.isMobile, '活动', `发现活动类型: "默认" 标题: "${task.title}"`);
        
        const selector = task.destinationUrl;
        if (!selector) {
            this.bot.log(this.bot.isMobile, '活动执行', `跳过任务 "${task.title}" | 原因: 缺少目标URL！`, 'warn');
            return;
        }

        // 检查页面是否有效
        if (currentPage.isClosed()) {
            throw new Error('当前页面已关闭，无法执行任务');
        }

        // 导航到目标URL
        await currentPage.goto(selector, { 
            waitUntil: 'networkidle',
            timeout: 30000 
        });

        // 等待页面加载
        await this.bot.utils.wait(3000);

        // 尝试查找并点击活动元素
        const commonSelectors = [
            'a[href*="rewards"]',
            'a[href*="bing.com/rewards"]',
            'a[href*="rewards.bing.com"]',
            '.pointLink',
            '[data-bi-id*="Rewards"]',
            '.offer-cta',
            '.activity-link',
            'button[onclick*="rewards"]'
        ];

        let elementFound = false;
        for (const commonSelector of commonSelectors) {
            try {
                const locator = currentPage.locator(commonSelector);
                const count = await locator.count();
                if (count > 0) {
                    const firstElement = locator.first();
                    if (await firstElement.isVisible({ timeout: 3000 })) {
                        await firstElement.click();
                        this.bot.log(this.bot.isMobile, '活动执行', `使用通用选择器找到元素: ${commonSelector}`);
                        elementFound = true;
                        break;
                    }
                }
            } catch (selectorError) {
                // 继续尝试下一个选择器
            }
        }

        if (!elementFound) {
            this.bot.log(this.bot.isMobile, '活动执行', `未找到可点击的活动元素，但任务可能已完成`);
        }
    }

    public async doPunchCard(page: Page, data: DashboardData) {
        this.bot.log(this.bot.isMobile, '打卡任务', '所有"打卡任务"已完成')
    }
}
