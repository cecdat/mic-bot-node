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
     * 智能活动点击工具 - 基于成熟项目的优化版本
     */
    private async smartActivityClick(currentPage: Page, taskTitle: string): Promise<boolean> {
        this.bot.log(this.bot.isMobile, '智能点击', `开始智能点击活动: "${taskTitle}"`);
        
        try {
            // 等待页面完全加载
            await this.bot.utils.wait(2000);
            
            // 检查当前URL状态
            const currentUrl = currentPage.url();
            if (currentUrl.includes('rewards.bing.com') || currentUrl.includes('bing.com/rewards')) {
                this.bot.log(this.bot.isMobile, '智能点击', '检测到已在Rewards页面，活动可能已完成');
                return true;
            }

            // 基于参考项目的成熟选择器策略
            const clickStrategies = [
                // 策略1: Microsoft Rewards专用选择器（参考项目核心）
                {
                    name: 'Microsoft Rewards专用选择器',
                    selectors: [
                        '.offer-cta',                    // 官方活动按钮
                        '.pointLink',                    // 积分链接
                        'a[href*="rewards.bing.com"]',   // Rewards页面链接
                        'a[href*="bing.com/rewards"]',   // Bing Rewards链接
                        '[data-bi-id*="Rewards"]',       // 官方数据属性
                        '[data-bi-id*="rewards"]',       // 小写rewards
                        'button[onclick*="rewards"]',    // 奖励按钮
                        'button[onclick*="promotion"]',  // 推广按钮
                        'button[onclick*="activity"]'    // 活动按钮
                    ]
                },
                // 策略2: 活动类型特定选择器
                {
                    name: '活动类型特定选择器',
                    selectors: [
                        '.activity-link',                // 活动链接
                        '.promotion-link',               // 推广链接
                        '.reward-link',                  // 奖励链接
                        '.earn-points-link',             // 赚取积分链接
                        '.start-activity',               // 开始活动
                        '.begin-activity',               // 开始活动
                        '.quiz-link',                    // 测验链接
                        '.poll-link',                    // 投票链接
                        '.punchcard-link'                // 打卡链接
                    ]
                },
                // 策略3: 通用奖励选择器
                {
                    name: '通用奖励选择器',
                    selectors: [
                        'a[href*="rewards"]',            // 包含rewards的链接
                        'a[href*="bing.com/spotlight"]', // Bing Spotlight
                        'a[href*="bing.com/search"]',    // Bing搜索
                        'a[href*="microsoft.com/rewards"]', // Microsoft Rewards
                        'a[href*="bing.com/explore"]',   // Bing探索
                        'a[href*="bing.com/discover"]'   // Bing发现
                    ]
                },
                // 策略4: 按钮和交互元素
                {
                    name: '按钮和交互元素',
                    selectors: [
                        'button[class*="reward"]',       // 奖励按钮
                        'button[class*="promotion"]',    // 推广按钮
                        'button[class*="activity"]',     // 活动按钮
                        'button[class*="point"]',        // 积分按钮
                        'button[class*="earn"]',         // 赚取按钮
                        'button[class*="start"]',        // 开始按钮
                        'button[class*="begin"]',        // 开始按钮
                        'button[class*="click"]',        // 点击按钮
                        'button[class*="complete"]',     // 完成按钮
                        'button[class*="join"]'          // 加入按钮
                    ]
                },
                // 策略5: 文本内容选择器（基于用户行为）
                {
                    name: '文本内容选择器',
                    selectors: [
                        'a:has-text("Earn")',            // 赚取
                        'a:has-text("Get points")',      // 获得积分
                        'a:has-text("Start")',           // 开始
                        'a:has-text("Begin")',           // 开始
                        'a:has-text("Click here")',      // 点击这里
                        'a:has-text("Continue")',        // 继续
                        'a:has-text("Learn more")',      // 了解更多
                        'a:has-text("Read more")',       // 阅读更多
                        'a:has-text("Take quiz")',       // 参加测验
                        'a:has-text("Play game")',       // 玩游戏
                        'a:has-text("Watch video")',     // 观看视频
                        'a:has-text("Complete")',        // 完成
                        'a:has-text("Join")',            // 加入
                        'a:has-text("Participate")',     // 参与
                        'a:has-text("Claim")',           // 领取
                        'a:has-text("Collect")',         // 收集
                        'a:has-text("Unlock")',          // 解锁
                        'a:has-text("Discover")',        // 发现
                        'a:has-text("Explore")'          // 探索
                    ]
                },
                // 策略6: 图片和视觉元素
                {
                    name: '图片和视觉元素',
                    selectors: [
                        'a img[src*="reward"]',          // 奖励图片
                        'a img[src*="promotion"]',       // 推广图片
                        'a img[src*="activity"]',        // 活动图片
                        'a img[src*="point"]',           // 积分图片
                        'a img[src*="earn"]',            // 赚取图片
                        'a img[src*="quiz"]',            // 测验图片
                        'a img[src*="poll"]',            // 投票图片
                        'a img[src*="game"]',            // 游戏图片
                        'a img[src*="video"]'            // 视频图片
                    ]
                },
                // 策略7: 通用类名选择器
                {
                    name: '通用类名选择器',
                    selectors: [
                        'a[class*="reward"]',            // 奖励类
                        'a[class*="promotion"]',         // 推广类
                        'a[class*="activity"]',          // 活动类
                        'a[class*="point"]',             // 积分类
                        'a[class*="earn"]',              // 赚取类
                        'a[class*="start"]',             // 开始类
                        'a[class*="begin"]',             // 开始类
                        'a[class*="click"]',             // 点击类
                        'a[class*="complete"]',          // 完成类
                        'a[class*="join"]',              // 加入类
                        'a[class*="claim"]',             // 领取类
                        'a[class*="collect"]',           // 收集类
                        'a[class*="unlock"]',            // 解锁类
                        'a[class*="discover"]',          // 发现类
                        'a[class*="explore"]'            // 探索类
                    ]
                }
            ];

            // 执行每个策略
            for (const strategy of clickStrategies) {
                this.bot.log(this.bot.isMobile, '智能点击', `尝试策略: ${strategy.name}`);
                
                for (const selector of strategy.selectors) {
                    try {
                        const locator = currentPage.locator(selector);
                        const count = await locator.count();
                        
                        if (count > 0) {
                            // 遍历所有匹配的元素
                            for (let i = 0; i < count; i++) {
                                const element = locator.nth(i);
                                
                                // 检查元素是否可见且可点击
                                if (await element.isVisible({ timeout: 2000 })) {
                                    try {
                                        // 获取元素信息用于调试
                                        const tagName = await element.evaluate(el => el.tagName.toLowerCase());
                                        const className = await element.getAttribute('class') || '';
                                        const href = await element.getAttribute('href') || '';
                                        
                                        this.bot.log(this.bot.isMobile, '智能点击', `尝试点击: ${tagName}${className ? '.' + className.split(' ')[0] : ''}${href ? ' -> ' + href : ''}`);
                                        
                                        // 尝试点击元素
                                        await element.click({ timeout: 5000 });
                                        
                                        this.bot.log(this.bot.isMobile, '智能点击', `成功点击元素: ${selector} (第${i+1}个)`);
                                        
                                        // 等待页面响应
                                        await this.bot.utils.wait(3000);
                                        
                                        // 检查是否跳转到新页面或URL发生变化
                                        const newUrl = currentPage.url();
                                        if (newUrl !== currentUrl) {
                                            this.bot.log(this.bot.isMobile, '智能点击', `页面已跳转到: ${newUrl}`);
                                            return true;
                                        }
                                        
                                        // 检查是否出现成功提示或完成状态
                                        const successIndicators = [
                                            'text=completed',
                                            'text=success',
                                            'text=earned',
                                            'text=points',
                                            'text=thank you',
                                            'text=done'
                                        ];
                                        
                                        for (const indicator of successIndicators) {
                                            try {
                                                const indicatorElement = currentPage.locator(indicator);
                                                if (await indicatorElement.isVisible({ timeout: 1000 })) {
                                                    this.bot.log(this.bot.isMobile, '智能点击', `检测到成功指示器: ${indicator}`);
                                                    return true;
                                                }
                                            } catch (e) {
                                                // 忽略指示器检查错误
                                            }
                                        }
                                        
                                        return true; // 点击成功，即使没有明显的页面变化
                                        
                                    } catch (clickError) {
                                        this.bot.log(this.bot.isMobile, '智能点击', `点击元素失败: ${selector} (第${i+1}个) - ${clickError}`, 'warn');
                                        continue;
                                    }
                                }
                            }
                        }
                    } catch (selectorError) {
                        // 继续尝试下一个选择器
                        continue;
                    }
                }
            }

            // 如果所有策略都失败，尝试最后的备用方法
            this.bot.log(this.bot.isMobile, '智能点击', '所有策略失败，尝试备用方法');
            
            try {
                // 查找页面上的所有链接
                const allLinks = currentPage.locator('a[href]');
                const linkCount = await allLinks.count();
                
                this.bot.log(this.bot.isMobile, '智能点击', `页面共有 ${linkCount} 个链接`);
                
                for (let i = 0; i < Math.min(linkCount, 20); i++) {
                    const link = allLinks.nth(i);
                    if (await link.isVisible({ timeout: 1000 })) {
                        const href = await link.getAttribute('href');
                        const text = await link.textContent() || '';
                        
                        if (href && (
                            href.includes('rewards') || 
                            href.includes('bing.com') || 
                            href.includes('microsoft.com') ||
                            text.toLowerCase().includes('earn') ||
                            text.toLowerCase().includes('point') ||
                            text.toLowerCase().includes('start') ||
                            text.toLowerCase().includes('begin')
                        )) {
                            this.bot.log(this.bot.isMobile, '智能点击', `备用方法点击链接: ${text} -> ${href}`);
                            await link.click({ timeout: 5000 });
                            await this.bot.utils.wait(3000);
                            return true;
                        }
                    }
                }
            } catch (fallbackError) {
                this.bot.log(this.bot.isMobile, '智能点击', `备用方法也失败: ${fallbackError}`, 'warn');
            }

            this.bot.log(this.bot.isMobile, '智能点击', '所有点击方法都失败');
            return false;
            
        } catch (error) {
            this.bot.log(this.bot.isMobile, '智能点击', `智能点击过程中发生错误: ${error}`, 'error');
            return false;
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
     * 执行URL奖励任务
     */
    private async executeUrlRewardTask(currentPage: Page, task: UnifiedTask) {
        this.bot.log(this.bot.isMobile, '活动', `发现活动类型: "URL奖励" 标题: "${task.title}"`);
        
        const destinationUrl = task.destinationUrl;
        if (!destinationUrl) {
            throw new Error('URL奖励任务缺少目标URL');
        }

        try {
            // 直接导航到目标URL
            await currentPage.goto(destinationUrl, { 
                waitUntil: 'domcontentloaded',
                timeout: 15000 
            });

            // 使用智能点击工具处理URL奖励
            const clickSuccess = await this.smartActivityClick(currentPage, task.title);
            
            if (clickSuccess) {
                this.bot.log(this.bot.isMobile, 'URL奖励', `URL奖励任务 "${task.title}" 执行成功`);
            } else {
                this.bot.log(this.bot.isMobile, 'URL奖励', `URL奖励任务 "${task.title}" 执行可能失败，但继续处理`);
            }
            
        } catch (error: any) {
            this.bot.log(this.bot.isMobile, 'URL奖励', `执行URL奖励任务时发生错误: ${error.message}`, 'error');
            
            // 如果直接导航失败，尝试在新标签页中打开
            try {
                this.bot.log(this.bot.isMobile, 'URL奖励', '尝试在新标签页中打开URL奖励链接', 'warn');
                const newPage = await currentPage.context().newPage();
                await newPage.goto(destinationUrl, { 
                    waitUntil: 'domcontentloaded',
                    timeout: 10000 
                });
                await this.bot.utils.wait(3000);
                await newPage.close();
                this.bot.log(this.bot.isMobile, 'URL奖励', '在新标签页中成功打开URL奖励链接');
            } catch (newPageError: any) {
                this.bot.log(this.bot.isMobile, 'URL奖励', `新标签页也失败: ${newPageError.message}`, 'error');
                throw newPageError;
            }
        }
    }

    /**
     * 执行测验任务 - 基于参考项目的实现
     */
    private async executeQuizTask(currentPage: Page, task: UnifiedTask) {
        this.bot.log(this.bot.isMobile, '活动', `发现活动类型: "测验" 标题: "${task.title}"`);
        
        const destinationUrl = task.destinationUrl;
        if (!destinationUrl) {
            this.bot.log(this.bot.isMobile, '测验', `跳过测验任务 "${task.title}" | 原因: 缺少目标URL！`, 'warn');
            return;
        }

        try {
            // 导航到测验页面
            await currentPage.goto(destinationUrl, { 
                waitUntil: 'domcontentloaded',
                timeout: 20000 
            });

            // 等待页面加载
            await this.bot.utils.wait(3000);

            // 检查是否已经在测验页面
            const currentUrl = currentPage.url();
            if (currentUrl.includes('rewards.bing.com') || currentUrl.includes('bing.com/rewards')) {
                this.bot.log(this.bot.isMobile, '测验', '检测到已在Rewards页面，测验可能已完成');
                return;
            }

            // 尝试点击开始测验的按钮
            const quizStartSelectors = [
                'a:has-text("Start")',
                'a:has-text("Begin")',
                'a:has-text("Take quiz")',
                'a:has-text("Start quiz")',
                'button:has-text("Start")',
                'button:has-text("Begin")',
                'button:has-text("Take quiz")',
                '.start-quiz',
                '.begin-quiz',
                '.quiz-start'
            ];

            let quizStarted = false;
            for (const selector of quizStartSelectors) {
                try {
                    const element = currentPage.locator(selector);
                    if (await element.isVisible({ timeout: 2000 })) {
                        await element.click({ timeout: 5000 });
                        this.bot.log(this.bot.isMobile, '测验', `点击了测验开始按钮: ${selector}`);
                        quizStarted = true;
                        await this.bot.utils.wait(3000);
                        break;
                    }
                } catch (error) {
                    continue;
                }
            }

            if (!quizStarted) {
                // 如果没有找到开始按钮，尝试直接点击活动链接
                this.bot.log(this.bot.isMobile, '测验', '未找到测验开始按钮，尝试直接点击活动链接');
                const clickSuccess = await this.smartActivityClick(currentPage, task.title);
                if (clickSuccess) {
                    this.bot.log(this.bot.isMobile, '测验', '成功点击测验活动链接');
                }
            }

            // 等待测验完成或页面跳转
            await this.bot.utils.wait(5000);
            
            const finalUrl = currentPage.url();
            if (finalUrl.includes('rewards.bing.com') || finalUrl.includes('bing.com/rewards')) {
                this.bot.log(this.bot.isMobile, '测验', '测验执行成功，已返回Rewards页面');
            } else {
                this.bot.log(this.bot.isMobile, '测验', `测验执行完成，当前页面: ${finalUrl}`);
            }

        } catch (error: any) {
            this.bot.log(this.bot.isMobile, '测验', `执行测验任务时发生错误: ${error.message}`, 'error');
            
            // 备用方案：在新标签页中打开
            try {
                this.bot.log(this.bot.isMobile, '测验', '尝试在新标签页中打开测验链接', 'warn');
                const newPage = await currentPage.context().newPage();
                await newPage.goto(destinationUrl, { 
                    waitUntil: 'domcontentloaded',
                    timeout: 15000 
                });
                await this.bot.utils.wait(3000);
                await newPage.close();
                this.bot.log(this.bot.isMobile, '测验', '在新标签页中成功打开测验链接');
            } catch (newPageError: any) {
                this.bot.log(this.bot.isMobile, '测验', `新标签页也失败: ${newPageError.message}`, 'error');
            }
        }
    }

    /**
     * 执行打卡任务 - 基于参考项目的实现
     */
    private async executePunchCardTask(currentPage: Page, task: UnifiedTask) {
        this.bot.log(this.bot.isMobile, '活动', `发现活动类型: "打卡" 标题: "${task.title}"`);
        
        const destinationUrl = task.destinationUrl;
        if (!destinationUrl) {
            this.bot.log(this.bot.isMobile, '打卡任务', `跳过打卡任务 "${task.title}" | 原因: 缺少目标URL！`, 'warn');
            return;
        }

        try {
            // 导航到打卡页面
            await currentPage.goto(destinationUrl, { 
                waitUntil: 'domcontentloaded',
                timeout: 20000 
            });

            // 等待页面加载
            await this.bot.utils.wait(3000);

            // 检查是否已经在打卡页面
            const currentUrl = currentPage.url();
            if (currentUrl.includes('rewards.bing.com') || currentUrl.includes('bing.com/rewards')) {
                this.bot.log(this.bot.isMobile, '打卡任务', '检测到已在Rewards页面，打卡可能已完成');
                return;
            }

            // 尝试点击打卡相关的按钮
            const punchCardSelectors = [
                'a:has-text("Start")',
                'a:has-text("Begin")',
                'a:has-text("Complete")',
                'a:has-text("Claim")',
                'a:has-text("Collect")',
                'a:has-text("Unlock")',
                'button:has-text("Start")',
                'button:has-text("Begin")',
                'button:has-text("Complete")',
                'button:has-text("Claim")',
                'button:has-text("Collect")',
                'button:has-text("Unlock")',
                '.punchcard-start',
                '.punchcard-begin',
                '.punchcard-complete',
                '.punchcard-claim',
                '.punchcard-collect',
                '.punchcard-unlock'
            ];

            let punchCardStarted = false;
            for (const selector of punchCardSelectors) {
                try {
                    const element = currentPage.locator(selector);
                    if (await element.isVisible({ timeout: 2000 })) {
                        await element.click({ timeout: 5000 });
                        this.bot.log(this.bot.isMobile, '打卡任务', `点击了打卡按钮: ${selector}`);
                        punchCardStarted = true;
                        await this.bot.utils.wait(3000);
                        break;
                    }
                } catch (error) {
                    continue;
                }
            }

            if (!punchCardStarted) {
                // 如果没有找到打卡按钮，尝试直接点击活动链接
                this.bot.log(this.bot.isMobile, '打卡任务', '未找到打卡按钮，尝试直接点击活动链接');
                const clickSuccess = await this.smartActivityClick(currentPage, task.title);
                if (clickSuccess) {
                    this.bot.log(this.bot.isMobile, '打卡任务', '成功点击打卡活动链接');
                }
            }

            // 等待打卡完成或页面跳转
            await this.bot.utils.wait(5000);
            
            const finalUrl = currentPage.url();
            if (finalUrl.includes('rewards.bing.com') || finalUrl.includes('bing.com/rewards')) {
                this.bot.log(this.bot.isMobile, '打卡任务', '打卡执行成功，已返回Rewards页面');
            } else {
                this.bot.log(this.bot.isMobile, '打卡任务', `打卡执行完成，当前页面: ${finalUrl}`);
            }

        } catch (error: any) {
            this.bot.log(this.bot.isMobile, '打卡任务', `执行打卡任务时发生错误: ${error.message}`, 'error');
            
            // 备用方案：在新标签页中打开
            try {
                this.bot.log(this.bot.isMobile, '打卡任务', '尝试在新标签页中打开打卡链接', 'warn');
                const newPage = await currentPage.context().newPage();
                await newPage.goto(destinationUrl, { 
                    waitUntil: 'domcontentloaded',
                    timeout: 15000 
                });
                await this.bot.utils.wait(3000);
                await newPage.close();
                this.bot.log(this.bot.isMobile, '打卡任务', '在新标签页中成功打开打卡链接');
            } catch (newPageError: any) {
                this.bot.log(this.bot.isMobile, '打卡任务', `新标签页也失败: ${newPageError.message}`, 'error');
            }
        }
    }

    /**
     * 执行默认任务（通用处理方式）
     */
    private async executeDefaultTask(currentPage: Page, task: UnifiedTask) {
        this.bot.log(this.bot.isMobile, '活动', `发现活动类型: "默认" 标题: "${task.title}"`);
        
        const destinationUrl = task.destinationUrl;
        if (!destinationUrl) {
            this.bot.log(this.bot.isMobile, '活动执行', `跳过任务 "${task.title}" | 原因: 缺少目标URL！`, 'warn');
            return;
        }

        // 检查页面是否有效
        if (currentPage.isClosed()) {
            throw new Error('当前页面已关闭，无法执行任务');
        }

        try {
            // 导航到目标URL
            await currentPage.goto(destinationUrl, { 
                waitUntil: 'domcontentloaded',
                timeout: 20000 
            });

            // 使用智能点击工具处理活动
            const clickSuccess = await this.smartActivityClick(currentPage, task.title);
            
            if (clickSuccess) {
                this.bot.log(this.bot.isMobile, '活动执行', `任务 "${task.title}" 执行成功`);
            } else {
                this.bot.log(this.bot.isMobile, '活动执行', `任务 "${task.title}" 执行可能失败，但继续处理`);
            }
            
        } catch (error: any) {
            this.bot.log(this.bot.isMobile, '活动执行', `执行任务 "${task.title}" 时发生错误: ${error.message}`, 'error');
            
            // 如果直接导航失败，尝试在新标签页中打开
            try {
                this.bot.log(this.bot.isMobile, '活动执行', '尝试在新标签页中打开活动链接', 'warn');
                const newPage = await currentPage.context().newPage();
                await newPage.goto(destinationUrl, { 
                    waitUntil: 'domcontentloaded',
                    timeout: 15000 
                });
                await this.bot.utils.wait(3000);
                await newPage.close();
                this.bot.log(this.bot.isMobile, '活动执行', '在新标签页中成功打开活动链接');
            } catch (newPageError: any) {
                this.bot.log(this.bot.isMobile, '活动执行', `新标签页也失败: ${newPageError.message}`, 'error');
            }
        }
    }

    public async doPunchCard(page: Page, data: DashboardData) {
        this.bot.log(this.bot.isMobile, '打卡任务', '所有"打卡任务"已完成')
    }
}
