import { Page } from 'rebrowser-playwright'
import fs from 'fs'
import path from 'path'
// [FIX] Removed unused imports for MorePromotion, PromotionalItem, and PunchCard
import { DashboardData } from '../interface/DashboardData'
import { UnifiedTask } from '../util/AIOrcestrator'
import { MicrosoftRewardsBot } from '../index'
import { FailedTaskManager } from '../util/FailedTaskManager'

export class Workers {
    public bot: MicrosoftRewardsBot
    private failedTaskManager: FailedTaskManager | null = null

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot
    }

    /**
     * 初始化失败任务管理器
     */
    initializeFailedTaskManager(sessionPath: string): void {
        if (!this.failedTaskManager) {
            this.failedTaskManager = new FailedTaskManager(sessionPath, 3);
            this.bot.log(this.bot.isMobile, '失败任务管理', '失败任务管理器已初始化');
        }
    }

    /**
     * 添加失败任务
     */
    addFailedTask(accountEmail: string, taskType: 'search' | 'mobile' | 'desktop', reason: string, taskData?: any): void {
        if (!this.failedTaskManager) {
            this.bot.log(this.bot.isMobile, '失败任务管理', '失败任务管理器未初始化', 'warn');
            return;
        }

        this.failedTaskManager.addFailedTask({
            accountEmail,
            taskType,
            reason,
            maxRetries: 3,
            taskData
        });
    }

    /**
     * 处理cookies授权弹窗
     * @param page 当前页面
     */
    private async handleCookiesConsent(page: Page): Promise<void> {
        try {
            // 等待页面加载完成
            await this.bot.utils.wait(3000);
            
            this.bot.log(this.bot.isMobile, 'Cookies授权', '开始检测cookies授权弹窗...');
            
            // 方法1：查找所有可能的cookies授权按钮
            const cookiesButtonSelectors = [
                // 英文按钮
                'button:has-text("Accept all")',
                'button:has-text("Accept All")',
                'button:has-text("Accept")',
                'button:has-text("Allow all")',
                'button:has-text("Allow All")',
                'button:has-text("Allow")',
                'button:has-text("I agree")',
                'button:has-text("I Accept")',
                'button:has-text("OK")',
                'button:has-text("Yes")',
                'button:has-text("Accept all cookies")',
                'button:has-text("Accept cookies")',
                'button:has-text("Allow all cookies")',
                'button:has-text("Allow cookies")',
                'button:has-text("I agree to cookies")',
                
                // 中文按钮
                'button:has-text("接受所有")',
                'button:has-text("接受")',
                'button:has-text("允许所有")',
                'button:has-text("允许")',
                'button:has-text("同意")',
                'button:has-text("确定")',
                'button:has-text("是")',
                'button:has-text("好")',
                'button:has-text("好的")',
                'button:has-text("接受所有cookies")',
                'button:has-text("接受cookies")',
                'button:has-text("允许所有cookies")',
                'button:has-text("允许cookies")',
                
                // 数据属性选择器
                '[data-testid="accept-all"]',
                '[data-testid="accept"]',
                '[data-testid="allow-all"]',
                '[data-testid="allow"]',
                '[data-testid="agree"]',
                '[data-testid="cookie-accept"]',
                '[data-testid="cookie-allow"]',
                '[data-testid="consent-accept"]',
                '[data-testid="consent-allow"]',
                
                // 类名选择器
                '.accept-all',
                '.accept',
                '.allow-all',
                '.allow',
                '.agree',
                '.consent-accept',
                '.cookies-accept',
                '.cookie-accept',
                '.cookie-allow',
                '.consent-button',
                '.cookie-button',
                
                // ID选择器
                '#accept-all',
                '#accept',
                '#allow-all',
                '#allow',
                '#agree',
                '#consent-accept',
                '#cookies-accept',
                '#cookie-accept',
                '#cookie-allow',
                '#consent-button',
                '#cookie-button'
            ];
            
            let cookiesAccepted = false;
            
            // 尝试使用选择器查找按钮
            for (const selector of cookiesButtonSelectors) {
                try {
                    const button = page.locator(selector);
                    if (await button.count() > 0 && await button.isVisible({ timeout: 1000 })) {
                        this.bot.log(this.bot.isMobile, 'Cookies授权', `找到cookies授权按钮: ${selector}`);
                        
                        // 滚动到按钮位置，确保可见
                        await button.scrollIntoViewIfNeeded();
                        await this.bot.utils.wait(500);
                        
                        // 点击按钮
                        await button.click({ timeout: 5000 });
                        this.bot.log(this.bot.isMobile, 'Cookies授权', '已点击cookies授权按钮');
                        cookiesAccepted = true;
                        await this.bot.utils.wait(2000); // 等待弹窗消失
                        break;
                    }
                } catch (error) {
                    continue;
                }
            }
            
            // 方法2：如果选择器方法失败，使用文本搜索方法
            if (!cookiesAccepted) {
                this.bot.log(this.bot.isMobile, 'Cookies授权', '选择器方法未找到按钮，尝试文本搜索方法...');
                
                try {
                    // 查找页面中所有按钮
                    const allButtons = page.locator('button, input[type="button"], input[type="submit"], a[role="button"]');
                    const buttonCount = await allButtons.count();
                    
                    this.bot.log(this.bot.isMobile, 'Cookies授权', `页面中共找到 ${buttonCount} 个按钮，正在检查文本内容...`);
                    
                    for (let i = 0; i < buttonCount; i++) {
                        try {
                            const button = allButtons.nth(i);
                            
                            // 检查按钮是否可见
                            if (!(await button.isVisible({ timeout: 1000 }))) {
                                continue;
                            }
                            
                            // 获取按钮文本
                            const buttonText = await button.textContent();
                            if (!buttonText || buttonText.trim() === '') {
                                continue;
                            }
                            
                            const buttonTextLower = buttonText.trim().toLowerCase();
                            
                            // 检查按钮文本是否包含cookies相关关键词
                            if (buttonTextLower.includes('accept') || 
                                buttonTextLower.includes('allow') || 
                                buttonTextLower.includes('agree') || 
                                buttonTextLower.includes('ok') || 
                                buttonTextLower.includes('yes') ||
                                buttonTextLower.includes('接受') || 
                                buttonTextLower.includes('允许') || 
                                buttonTextLower.includes('同意') || 
                                buttonTextLower.includes('确定') || 
                                buttonTextLower.includes('是') ||
                                buttonTextLower.includes('好') ||
                                buttonTextLower.includes('cookie') ||
                                buttonTextLower.includes('consent')) {
                                
                                this.bot.log(this.bot.isMobile, 'Cookies授权', `通过文本匹配找到可能的cookies授权按钮: "${buttonText}"`);
                                
                                // 滚动到按钮位置，确保可见
                                await button.scrollIntoViewIfNeeded();
                                await this.bot.utils.wait(500);
                                
                                // 点击按钮
                                await button.click({ timeout: 5000 });
                                this.bot.log(this.bot.isMobile, 'Cookies授权', `已点击通过文本匹配找到的按钮: "${buttonText}"`);
                                cookiesAccepted = true;
                                await this.bot.utils.wait(2000); // 等待弹窗消失
                                break;
                            }
                        } catch (error) {
                            continue;
                        }
                    }
                } catch (error) {
                    this.bot.log(this.bot.isMobile, 'Cookies授权', `文本搜索方法出错: ${error}`, 'warn');
                }
            }
            
            // 方法3：查找包含cookies相关文本的任何元素
            if (!cookiesAccepted) {
                this.bot.log(this.bot.isMobile, 'Cookies授权', '前两种方法都失败，尝试查找包含cookies文本的元素...');
                
                try {
                    // 查找包含cookies相关文本的元素
                    const cookiesElements = page.locator('*:has-text("cookie"), *:has-text("Cookie"), *:has-text("cookies"), *:has-text("Cookies")');
                    const elementCount = await cookiesElements.count();
                    
                    this.bot.log(this.bot.isMobile, 'Cookies授权', `找到 ${elementCount} 个包含cookies文本的元素`);
                    
                    for (let i = 0; i < elementCount; i++) {
                        try {
                            const element = cookiesElements.nth(i);
                            
                            // 检查元素是否可见
                            if (!(await element.isVisible({ timeout: 1000 }))) {
                                continue;
                            }
                            
                            // 检查元素是否可点击
                            const tagName = await element.evaluate(el => el.tagName.toLowerCase());
                            if (tagName === 'button' || tagName === 'a' || tagName === 'input') {
                                const elementText = await element.textContent();
                                this.bot.log(this.bot.isMobile, 'Cookies授权', `找到可点击的cookies相关元素: ${tagName}, 文本: "${elementText}"`);
                                
                                // 滚动到元素位置，确保可见
                                await element.scrollIntoViewIfNeeded();
                                await this.bot.utils.wait(500);
                                
                                // 点击元素
                                await element.click({ timeout: 5000 });
                                this.bot.log(this.bot.isMobile, 'Cookies授权', `已点击cookies相关元素`);
                                cookiesAccepted = true;
                                await this.bot.utils.wait(2000); // 等待弹窗消失
                                break;
                            }
                        } catch (error) {
                            continue;
                        }
                    }
                } catch (error) {
                    this.bot.log(this.bot.isMobile, 'Cookies授权', `查找cookies文本元素方法出错: ${error}`, 'warn');
                }
            }
            
            if (cookiesAccepted) {
                this.bot.log(this.bot.isMobile, 'Cookies授权', 'Cookies授权弹窗已成功处理');
            } else {
                this.bot.log(this.bot.isMobile, 'Cookies授权', '未找到cookies授权弹窗或已处理');
            }
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, 'Cookies授权', `处理cookies授权弹窗时出错: ${errorMessage}`, 'warn');
        }
    }

    /**
     * 检查用户是否已登录Microsoft Rewards
     * @param page 当前页面
     * @returns 是否已登录
     */
    private async checkLoginStatus(page: Page): Promise<boolean> {
        try {
            // 等待页面完全加载
            await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
            
            // 优先检查已登录的明确标志
            
            // 方法1: 检查是否存在用户头像或账户信息（Microsoft Rewards页面特定）
            const userAvatar = page.locator('[data-testid="identityBanner"], .user-avatar, .account-info, [aria-label*="@"], .profile_img, #img_sec, #redirect_info_link, [id*="mectrl"], [class*="profile"]');
            if (await userAvatar.count() > 0) {
                this.bot.log(this.bot.isMobile, '登录检查', '检测到用户头像或账户信息，用户已登录');
                return true;
            }

            // 方法2: 检查页面是否包含Microsoft Rewards特定的用户信息元素
            const rewardsUserInfo = page.locator('#redirect_info_link, #img_sec, .profile_img, [id*="mectrl"], [class*="profile"], [id*="profile"]');
            if (await rewardsUserInfo.count() > 0) {
                this.bot.log(this.bot.isMobile, '登录检查', '检测到Microsoft Rewards用户信息元素，用户已登录');
                return true;
            }

            // 方法3: 检查页面是否包含用户邮箱信息
            const userEmail = page.locator('text=@outlook.com, text=@hotmail.com, text=@gmail.com, text=@live.com');
            if (await userEmail.count() > 0) {
                this.bot.log(this.bot.isMobile, '登录检查', '检测到用户邮箱信息，用户已登录');
                return true;
            }

            // 方法4: 检查页面是否包含"注销"或"Sign out"链接（说明已登录）
            const signOutLink = page.locator('a:has-text("注销"), a:has-text("Sign out"), a:has-text("登出"), [href*="Signout"]');
            if (await signOutLink.count() > 0) {
                this.bot.log(this.bot.isMobile, '登录检查', '检测到注销链接，用户已登录');
                return true;
            }

            // 方法5: 检查URL是否包含用户信息
            const currentUrl = page.url();
            if (currentUrl.includes('uaid=') || currentUrl.includes('account.live.com')) {
                this.bot.log(this.bot.isMobile, '登录检查', 'URL包含用户信息，用户已登录');
                return true;
            }

            // 方法6: 检查页面内容是否包含积分信息
            const pointsInfo = page.locator('text=points, text=积分, text=Rewards, text=奖励');
            if (await pointsInfo.count() > 0) {
                this.bot.log(this.bot.isMobile, '登录检查', '页面包含积分信息，用户已登录');
                return true;
            }

            // 方法7: 检查页面是否包含Microsoft账户相关的元素（说明已登录）
            const microsoftAccountElements = page.locator('[data-testid*="account"], [data-testid*="user"], [class*="account"], [class*="user"], [id*="account"], [id*="user"]');
            if (await microsoftAccountElements.count() > 0) {
                this.bot.log(this.bot.isMobile, '登录检查', '检测到Microsoft账户相关元素，用户已登录');
                return true;
            }

            // 方法8: 检查页面是否包含活动相关的元素（说明已登录）
            const activityElements = page.locator('[data-bi-id], .pointLink, .activity-item, [class*="activity"], [class*="task"]');
            if (await activityElements.count() > 0) {
                this.bot.log(this.bot.isMobile, '登录检查', '检测到活动相关元素，用户已登录');
                return true;
            }

            // 最后检查页面标题是否包含登录相关关键词（作为未登录的确认）
            const pageTitle = await page.title();
            if (pageTitle.toLowerCase().includes('sign in') || 
                pageTitle.toLowerCase().includes('login') || 
                pageTitle.toLowerCase().includes('登录') ||
                pageTitle.toLowerCase().includes('signin')) {
                this.bot.log(this.bot.isMobile, '登录检查', '页面标题显示需要登录');
                return false;
            }

            // 只有在没有找到任何已登录标志时，才检查是否存在明显的登录按钮
            // 使用更精确的选择器，避免误判
            // 注意：活动页面可能包含页眉/页脚的通用登录链接，这些不应该作为未登录的判断依据
            const loginButton = page.locator('a[href*="login"], a[href*="signin"], button[onclick*="login"], button[onclick*="signin"], a:has-text("Sign in"):not([href*="account"]), a:has-text("登录"):not([href*="account"])');
            if (await loginButton.count() > 0) {
                // 进一步检查：如果页面包含活动相关元素，说明用户已登录，忽略页眉/页脚的登录链接
                const hasActivityElements = await page.locator('[data-bi-id], .pointLink, .activity-item, [class*="activity"], [class*="task"]').count() > 0;
                if (hasActivityElements) {
                    this.bot.log(this.bot.isMobile, '登录检查', '页面包含活动元素，忽略页眉/页脚的登录链接，用户已登录');
                    return true;
                }
                
                // 检查登录按钮是否真的可见且可点击
                const visibleLoginButton = await loginButton.filter({ hasText: /^(Sign in|登录)$/i }).first();
                if (await visibleLoginButton.isVisible({ timeout: 2000 })) {
                    this.bot.log(this.bot.isMobile, '登录检查', '检测到明显的登录按钮，用户未登录');
                    return false;
                }
            }

            // 如果以上都没有明确指示，但页面不是登录页面，则假设已登录
            // 因为活动页面通常需要登录才能访问
            this.bot.log(this.bot.isMobile, '登录检查', '未找到明确的登录状态指示，但页面不是登录页面，假设已登录');
            return true;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '登录检查', `检查登录状态时出错: ${errorMessage}`, 'warn');
            return false;
        }
    }

    /**
     * 智能点击活动链接并执行任务
     */
    public async smartActivityClick(currentPage: Page, activity: any): Promise<boolean> {
        try {
            // 首先处理cookies授权弹窗，确保登录状态正确
            await this.handleCookiesConsent(currentPage);
            
            // 检查当前页面登录状态
            const isLoggedIn = await this.checkLoginStatus(currentPage);
            if (!isLoggedIn) {
                this.bot.log(this.bot.isMobile, '智能点击', '检测到用户未登录Microsoft Rewards，无法执行活动任务', 'warn');
                return false;
            }

            // 屏幕录像功能已禁用（根据配置）

            // 构建选择器
            let selector = `[data-bi-id^="${activity.offerId || ''}"] .pointLink:not(.contentContainer .pointLink)`;
            
            // 特殊处理某些活动名称
            if (activity.title && activity.title.includes('电影之夜')) {
                selector = '[data-bi-id="morepromotions"] .pointLink:not(.contentContainer .pointLink)';
            } else if (activity.title && activity.title.includes('合家欢视频')) {
                selector = '[data-bi-id="morepromotions"] .pointLink:not(.contentContainer .pointLink)';
            } else if (activity.title && activity.title.includes('吴哥在等待')) {
                selector = '[data-bi-id="morepromotions"] .pointLink:not(.contentContainer .pointLink)';
            } else if (activity.title && activity.title.includes('可爱的海獭')) {
                selector = '[data-bi-id="morepromotions"] .pointLink:not(.contentContainer .pointLink)';
            }

            // 备用选择器
            if (!(await currentPage.locator(selector).count())) {
                selector = '.pointLink:not(.contentContainer .pointLink)';
            }

            this.bot.log(this.bot.isMobile, '智能点击', `点击活动: ${activity.title}`);
            this.bot.log(this.bot.isMobile, '智能点击', `使用选择器: ${selector}`);
            
            // 记录点击前的页面状态
            this.bot.log(this.bot.isMobile, '智能点击', `点击前页面URL: ${currentPage.url()}`);
            
            // 点击活动链接
            await currentPage.click(selector);
            this.bot.log(this.bot.isMobile, '智能点击', '活动链接已点击，等待新标签页打开...');

            // 等待新标签页打开
            await this.bot.utils.wait(3000);
            
            // 获取新标签页
            const pages = currentPage.context().pages();
            const newPage = pages[pages.length - 1];
            
            if (!newPage || newPage === currentPage) {
                this.bot.log(this.bot.isMobile, '智能点击', '未检测到新标签页，可能在同一页面执行', 'warn');
                
                            // 屏幕录像功能已禁用
                
                return true;
            }
            
            this.bot.log(this.bot.isMobile, '智能点击', `新标签页已打开: ${newPage.url()}`);
            this.bot.log(this.bot.isMobile, '智能点击', `新标签页标题: ${await newPage.title()}`);

            // 等待新标签页加载完成
            try {
                await newPage.waitForLoadState('networkidle', { timeout: 10000 });
                this.bot.log(this.bot.isMobile, '智能点击', '新标签页加载完成');
            } catch (error) {
                this.bot.log(this.bot.isMobile, '智能点击', `等待新标签页加载超时: ${error}`, 'warn');
            }

            // 记录新标签页的详细信息
            this.bot.log(this.bot.isMobile, '智能点击', `新标签页最终URL: ${newPage.url()}`);
            this.bot.log(this.bot.isMobile, '智能点击', `新标签页最终标题: ${await newPage.title()}`);
            
            // 检查新标签页的登录状态
            const newPageLoginStatus = await this.checkLoginStatus(newPage);
            this.bot.log(this.bot.isMobile, '智能点击', `新标签页登录状态: ${newPageLoginStatus ? '已登录' : '未登录'}`);

            // 执行活动任务
            this.bot.log(this.bot.isMobile, '智能点击', '开始在新标签页中执行活动任务...');
            const success = await this.executeActivityByType(newPage, activity);
            
            // 关闭新标签页
            await newPage.close();
            this.bot.log(this.bot.isMobile, '智能点击', '活动标签页已关闭');

            // 屏幕录像功能已禁用

            return success;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '智能点击', `执行活动时出错: ${errorMessage}`, 'error');
            
            // 屏幕录像功能已禁用
            
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
            const clickSuccess = await this.smartActivityClick(currentPage, task);
            
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
                const clickSuccess = await this.smartActivityClick(currentPage, task);
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
                const clickSuccess = await this.smartActivityClick(currentPage, task);
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
            const clickSuccess = await this.smartActivityClick(currentPage, task);
            
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

    /**
     * 根据活动类型执行相应的任务
     */
    private async executeActivityByType(page: Page, activity: any): Promise<boolean> {
        try {
            this.bot.log(this.bot.isMobile, '活动执行', `开始执行活动类型: ${activity.promotionType}`);
            
            // 检查新标签页的登录状态
            const isLoggedIn = await this.checkLoginStatus(page);
            if (!isLoggedIn) {
                this.bot.log(this.bot.isMobile, '活动执行', '新标签页未登录，开始执行认证恢复流程', 'warn');
                
                // 步骤1：等待一段时间让页面完全加载
                this.bot.log(this.bot.isMobile, '活动执行', '等待页面完全加载...');
                await this.bot.utils.wait(5000);
                
                // 步骤2：尝试刷新页面，看是否能恢复登录状态
                this.bot.log(this.bot.isMobile, '活动执行', '尝试刷新页面恢复登录状态...');
                await page.reload({ waitUntil: 'networkidle' });
                await this.bot.utils.wait(3000);
                
                // 步骤3：再次检查登录状态
                const retryLoginStatus = await this.checkLoginStatus(page);
                if (retryLoginStatus) {
                    this.bot.log(this.bot.isMobile, '活动执行', '页面刷新后登录状态已恢复');
                } else {
                    this.bot.log(this.bot.isMobile, '活动执行', '页面刷新后仍未登录，尝试其他认证恢复方法', 'warn');
                    
                    // 步骤4：检查是否是必应搜索页面，这是正常的任务跳转，不需要强制跳转回rewards页面
                    if (page.url().includes('bing.com/search')) {
                        this.bot.log(this.bot.isMobile, '活动执行', '检测到必应搜索页面，这是正常的任务跳转，继续执行搜索任务');
                        // 对于搜索任务，跳转到必应搜索页面是正常的，不需要跳转回rewards页面
                    } else {
                        // 只有在非搜索页且未登录的情况下，才尝试访问Microsoft Rewards页面恢复登录状态
                        this.bot.log(this.bot.isMobile, '活动执行', '检测到非搜索页面且未登录，尝试访问Microsoft Rewards页面恢复登录状态...');
                        
                        try {
                            // 尝试访问Microsoft Rewards页面
                            await page.goto('https://rewards.bing.com', { waitUntil: 'networkidle' });
                            await this.bot.utils.wait(3000);
                            
                            // 检查是否恢复了登录状态
                            const rewardsLoginStatus = await this.checkLoginStatus(page);
                            if (rewardsLoginStatus) {
                                this.bot.log(this.bot.isMobile, '活动执行', '通过访问Microsoft Rewards页面恢复了登录状态');
                                
                                // 重新回到原始页面
                                await page.goto(page.url(), { waitUntil: 'networkidle' });
                                await this.bot.utils.wait(3000);
                            } else {
                                this.bot.log(this.bot.isMobile, '活动执行', '即使访问Microsoft Rewards页面仍未登录，可能认证已过期', 'error');
                            }
                        } catch (error) {
                            this.bot.log(this.bot.isMobile, '活动执行', `访问Microsoft Rewards页面失败: ${error}`, 'error');
                        }
                    }
                }
            }
            
            // 根据活动类型执行相应的任务
            switch (activity.promotionType) {
                case 'quiz':
                    return await this.executeQuizActivity(page, activity);
                case 'urlreward':
                    if (activity.name && activity.name.toLowerCase().includes('exploreonbing')) {
                        return await this.executeSearchOnBingActivity(page, activity);
                    } else {
                        return await this.executeUrlRewardActivity(page, activity);
                    }
                default:
                    this.bot.log(this.bot.isMobile, '活动执行', `未知的活动类型: ${activity.promotionType}`, 'warn');
                    return false;
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '活动执行', `执行活动类型时出错: ${errorMessage}`, 'error');
            return false;
        }
    }

    /**
     * 执行测验类活动
     */
    private async executeQuizActivity(page: Page, activity: any): Promise<boolean> {
        try {
            this.bot.log(this.bot.isMobile, '测验活动', `执行测验: ${activity.title}`);
            
            // 等待页面加载完成
            await this.bot.utils.wait(3000);
            
            // 根据积分数量判断测验类型
            switch (activity.pointProgressMax) {
                case 10:
                    // 投票或ABC测验
                    if (activity.destinationUrl && activity.destinationUrl.toLowerCase().includes('pollscenarioid')) {
                        this.bot.log(this.bot.isMobile, '测验活动', '检测到投票类型测验');
                        return await this.executePollActivity(page);
                    } else {
                        this.bot.log(this.bot.isMobile, '测验活动', '检测到ABC类型测验');
                        return await this.executeABCActivity(page);
                    }
                    
                case 50:
                    // This Or That测验
                    this.bot.log(this.bot.isMobile, '测验活动', '检测到This Or That测验');
                    return await this.executeThisOrThatActivity(page);
                    
                default:
                    // 其他测验类型
                    this.bot.log(this.bot.isMobile, '测验活动', '检测到通用测验类型');
                    return await this.executeGenericQuizActivity(page);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '测验活动', `执行测验时出错: ${errorMessage}`, 'error');
            return false;
        }
    }

    /**
     * 执行必应搜索活动
     */
    public async executeSearchOnBingActivity(page: Page, activity: any): Promise<boolean> {
        try {
            this.bot.log(this.bot.isMobile, '必应搜索', `执行必应搜索活动: ${activity.title}`);
            
            // 等待页面加载
            await this.bot.utils.wait(5000);
            
            // 尝试关闭所有消息提示
            await this.tryDismissAllMessages(page);
            
            // 获取搜索查询
            const query = await this.getSearchQuery(activity.title);
            
            // 查找搜索框
            const searchBar = '#sb_form_q';
            await page.waitForSelector(searchBar, { state: 'visible', timeout: 10000 });
            
            // 执行搜索
            await page.click(searchBar);
            await this.bot.utils.wait(500);
            await page.keyboard.type(query);
            await page.keyboard.press('Enter');
            await this.bot.utils.wait(3000);
            
            this.bot.log(this.bot.isMobile, '必应搜索', '必应搜索活动完成');
            return true;
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '必应搜索', `执行必应搜索时出错: ${errorMessage}`, 'error');
            
            // 记录失败任务
            this.addFailedTask(
                this.bot.account?.email || 'unknown',
                'search',
                `必应搜索失败: ${errorMessage}`,
                { activity, query: await this.getSearchQuery(activity.title) }
            );
            
            return false;
        }
    }

    /**
     * 执行URL奖励活动
     */
    public async executeUrlRewardActivity(page: Page, activity: any): Promise<boolean> {
        try {
            this.bot.log(this.bot.isMobile, 'URL奖励', `执行URL奖励活动: ${activity.title}`);
            
            // 等待页面加载
            await this.bot.utils.wait(2000);
            
            this.bot.log(this.bot.isMobile, 'URL奖励', 'URL奖励活动完成');
            return true;
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, 'URL奖励', `执行URL奖励时出错: ${errorMessage}`, 'error');
            
            // 记录失败任务
            this.addFailedTask(
                this.bot.account?.email || 'unknown',
                'search',
                `URL奖励失败: ${errorMessage}`,
                { activity }
            );
            
            return false;
        }
    }

    /**
     * 执行投票活动
     */
    private async executePollActivity(page: Page): Promise<boolean> {
        try {
            this.bot.log(this.bot.isMobile, '投票活动', '开始执行投票活动');
            
            // 等待投票选项加载
            await this.bot.utils.wait(3000);
            
            // 查找投票选项
            const pollOptions = page.locator('input[type="radio"], input[type="checkbox"]');
            const optionCount = await pollOptions.count();
            
            if (optionCount > 0) {
                // 随机选择一个选项
                const randomIndex = Math.floor(Math.random() * optionCount);
                const selectedOption = pollOptions.nth(randomIndex);
                
                await selectedOption.click();
                this.bot.log(this.bot.isMobile, '投票活动', `选择了第${randomIndex + 1}个选项`);
                
                // 查找提交按钮
                const submitButton = page.locator('button[type="submit"], input[type="submit"], button:has-text("Submit"), button:has-text("提交")');
                if (await submitButton.count() > 0) {
                    await submitButton.first().click();
                    this.bot.log(this.bot.isMobile, '投票活动', '已提交投票');
                }
                
                await this.bot.utils.wait(3000);
                return true;
            }
            
            this.bot.log(this.bot.isMobile, '投票活动', '未找到投票选项');
            return false;
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '投票活动', `执行投票时出错: ${errorMessage}`, 'error');
            return false;
        }
    }

    /**
     * 执行ABC测验活动
     */
    private async executeABCActivity(page: Page): Promise<boolean> {
        try {
            this.bot.log(this.bot.isMobile, 'ABC测验', '开始执行ABC测验活动');
            
            // 等待测验选项加载
            await this.bot.utils.wait(3000);
            
            // 查找测验选项
            const quizOptions = page.locator('input[type="radio"], input[type="checkbox"]');
            const optionCount = await quizOptions.count();
            
            if (optionCount > 0) {
                // 随机选择一个选项
                const randomIndex = Math.floor(Math.random() * optionCount);
                const selectedOption = quizOptions.nth(randomIndex);
                
                await selectedOption.click();
                this.bot.log(this.bot.isMobile, 'ABC测验', `选择了第${randomIndex + 1}个选项`);
                
                // 查找提交按钮
                const submitButton = page.locator('button[type="submit"], input[type="submit"], button:has-text("Submit"), button:has-text("提交")');
                if (await submitButton.count() > 0) {
                    await submitButton.first().click();
                    this.bot.log(this.bot.isMobile, 'ABC测验', '已提交答案');
                }
                
                await this.bot.utils.wait(3000);
                return true;
            }
            
            this.bot.log(this.bot.isMobile, 'ABC测验', '未找到测验选项');
            return false;
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, 'ABC测验', `执行ABC测验时出错: ${errorMessage}`, 'error');
            return false;
        }
    }

    /**
     * 执行This Or That测验活动
     */
    private async executeThisOrThatActivity(page: Page): Promise<boolean> {
        try {
            this.bot.log(this.bot.isMobile, 'This Or That', '开始执行This Or That测验活动');
            
            // 等待测验选项加载
            await this.bot.utils.wait(3000);
            
            // 查找测验选项
            const quizOptions = page.locator('input[type="radio"], input[type="checkbox"]');
            const optionCount = await quizOptions.count();
            
            if (optionCount > 0) {
                // 随机选择一个选项
                const randomIndex = Math.floor(Math.random() * optionCount);
                const selectedOption = quizOptions.nth(randomIndex);
                
                await selectedOption.click();
                this.bot.log(this.bot.isMobile, 'This Or That', `选择了第${randomIndex + 1}个选项`);
                
                // 查找提交按钮
                const submitButton = page.locator('button[type="submit"], input[type="submit"], button:has-text("Submit"), button:has-text("提交")');
                if (await submitButton.count() > 0) {
                    await submitButton.first().click();
                    this.bot.log(this.bot.isMobile, 'This Or That', '已提交答案');
                }
                
                await this.bot.utils.wait(3000);
                return true;
            }
            
            this.bot.log(this.bot.isMobile, 'This Or That', '未找到测验选项');
            return false;
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, 'This Or That', `执行This Or That测验时出错: ${errorMessage}`, 'error');
            return false;
        }
    }

    /**
     * 执行通用测验活动
     */
    private async executeGenericQuizActivity(page: Page): Promise<boolean> {
        try {
            this.bot.log(this.bot.isMobile, '通用测验', '开始执行通用测验活动');
            
            // 等待测验选项加载
            await this.bot.utils.wait(3000);
            
            // 查找测验选项
            const quizOptions = page.locator('input[type="radio"], input[type="checkbox"]');
            const optionCount = await quizOptions.count();
            
            if (optionCount > 0) {
                // 随机选择一个选项
                const randomIndex = Math.floor(Math.random() * optionCount);
                const selectedOption = quizOptions.nth(randomIndex);
                
                await selectedOption.click();
                this.bot.log(this.bot.isMobile, '通用测验', `选择了第${randomIndex + 1}个选项`);
                
                // 查找提交按钮
                const submitButton = page.locator('button[type="submit"], input[type="submit"], button:has-text("Submit"), button:has-text("提交")');
                if (await submitButton.count() > 0) {
                    await submitButton.first().click();
                    this.bot.log(this.bot.isMobile, '通用测验', '已提交答案');
                }
                
                await this.bot.utils.wait(3000);
                return true;
            }
            
            this.bot.log(this.bot.isMobile, '通用测验', '未找到测验选项');
            return false;
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '通用测验', `执行通用测验时出错: ${errorMessage}`, 'error');
            return false;
        }
    }

    /**
     * 获取搜索查询
     */
    private async getSearchQuery(title: string): Promise<string> {
        // 确保title不为空
        const safeTitle = title || 'microsoft rewards';
        
        try {
            // 简单的搜索查询生成策略
            const searchQueries = [
                safeTitle,
                `${safeTitle} information`,
                `${safeTitle} facts`,
                `${safeTitle} details`,
                `${safeTitle} guide`,
                `${safeTitle} tutorial`,
                `${safeTitle} tips`,
                `${safeTitle} help`,
                `${safeTitle} how to`,
                `${safeTitle} what is`
            ];
            
            // 随机选择一个查询
            const randomIndex = Math.floor(Math.random() * searchQueries.length);
            const randomQuery = searchQueries[randomIndex] || safeTitle;
            this.bot.log(this.bot.isMobile, '搜索查询', `生成搜索查询: ${randomQuery}`);
            
            return randomQuery;
            
        } catch (error) {
            this.bot.log(this.bot.isMobile, '搜索查询', `生成搜索查询时出错，使用默认查询: ${safeTitle}`, 'warn');
            return safeTitle;
        }
    }

    /**
     * 尝试关闭所有消息提示
     */
    private async tryDismissAllMessages(page: Page): Promise<void> {
        try {
            const dismissSelectors = [
                'button[aria-label="Close"]',
                'button[aria-label="关闭"]',
                '.close-button',
                '.dismiss-button',
                '[data-testid="close"]',
                'button:has-text("×")',
                'button:has-text("Close")',
                'button:has-text("关闭")'
            ];
            
            for (const selector of dismissSelectors) {
                try {
                    const dismissButton = page.locator(selector);
                    if (await dismissButton.count() > 0) {
                        await dismissButton.first().click();
                        await this.bot.utils.wait(500);
                    }
                } catch (e) {
                    // 忽略单个关闭按钮的错误
                }
            }
        } catch (error) {
            // 忽略关闭消息提示的错误
        }
    }

    public async doPunchCard(page: Page, data: DashboardData) {
        try {
            this.bot.log(this.bot.isMobile, '打卡任务', '开始检查各种任务完成状态...');
            
            // 1. 检查每日任务完成状态
            const todayStr = this.bot.utils.getFormattedDate();
            const dailyTasks = data.dailySetPromotions[todayStr] || [];
            const completedDailyTasks = dailyTasks.filter(task => task.complete);
            const incompleteDailyTasks = dailyTasks.filter(task => !task.complete);
            
            if (dailyTasks.length > 0) {
                this.bot.log(this.bot.isMobile, '打卡任务', `每日任务: 共 ${dailyTasks.length} 个，已完成 ${completedDailyTasks.length} 个，未完成 ${incompleteDailyTasks.length} 个`);
                
                if (completedDailyTasks.length > 0) {
                    const completedTitles = completedDailyTasks.map(task => task.title).join(', ');
                    this.bot.log(this.bot.isMobile, '打卡任务', `已完成的每日任务: ${completedTitles}`);
                }
                
                if (incompleteDailyTasks.length > 0) {
                    const incompleteTitles = incompleteDailyTasks.map(task => task.title).join(', ');
                    this.bot.log(this.bot.isMobile, '打卡任务', `未完成的每日任务: ${incompleteTitles}`);
                }
            } else {
                this.bot.log(this.bot.isMobile, '打卡任务', '今日暂无每日任务');
            }
            
            // 2. 检查更多促销活动完成状态
            const morePromotions = data.morePromotions || [];
            const completedMorePromotions = morePromotions.filter(task => task.complete);
            const incompleteMorePromotions = morePromotions.filter(task => !task.complete);
            
            if (morePromotions.length > 0) {
                this.bot.log(this.bot.isMobile, '打卡任务', `更多促销活动: 共 ${morePromotions.length} 个，已完成 ${completedMorePromotions.length} 个，未完成 ${incompleteMorePromotions.length} 个`);
                
                if (completedMorePromotions.length > 0) {
                    const completedTitles = completedMorePromotions.map(task => task.title).join(', ');
                    this.bot.log(this.bot.isMobile, '打卡任务', `已完成的促销活动: ${completedTitles}`);
                }
                
                if (incompleteMorePromotions.length > 0) {
                    const incompleteTitles = incompleteMorePromotions.map(task => task.title).join(', ');
                    this.bot.log(this.bot.isMobile, '打卡任务', `未完成的促销活动: ${incompleteTitles}`);
                }
            } else {
                this.bot.log(this.bot.isMobile, '打卡任务', '暂无更多促销活动');
            }
            
            // 3. 检查促销项目完成状态
            if (data.promotionalItem) {
                const promotionalItem = data.promotionalItem;
                if (promotionalItem.complete) {
                    this.bot.log(this.bot.isMobile, '打卡任务', `促销项目 "${promotionalItem.title}" 已完成`);
                } else {
                    this.bot.log(this.bot.isMobile, '打卡任务', `促销项目 "${promotionalItem.title}" 未完成 (进度: ${promotionalItem.pointProgress}/${promotionalItem.pointProgressMax})`);
                }
            } else {
                this.bot.log(this.bot.isMobile, '打卡任务', '暂无促销项目');
            }
            
            // 4. 检查搜索任务完成状态
            const pcSearch = data.userStatus.counters.pcSearch || [];
            const mobileSearch = data.userStatus.counters.mobileSearch || [];
            
            if (pcSearch.length > 0) {
                const completedPcSearch = pcSearch.filter(task => task.complete);
                const incompletePcSearch = pcSearch.filter(task => !task.complete);
                this.bot.log(this.bot.isMobile, '打卡任务', `桌面搜索任务: 共 ${pcSearch.length} 个，已完成 ${completedPcSearch.length} 个，未完成 ${incompletePcSearch.length} 个`);
            }
            
            if (mobileSearch.length > 0) {
                const completedMobileSearch = mobileSearch.filter(task => task.complete);
                const incompleteMobileSearch = mobileSearch.filter(task => !task.complete);
                this.bot.log(this.bot.isMobile, '打卡任务', `移动搜索任务: 共 ${mobileSearch.length} 个，已完成 ${completedMobileSearch.length} 个，未完成 ${incompleteMobileSearch.length} 个`);
            }
            
            // 5. 检查活动与测验完成状态
            const activityAndQuiz = data.userStatus.counters.activityAndQuiz || [];
            const completedActivityAndQuiz = activityAndQuiz.filter(task => task.complete);
            const incompleteActivityAndQuiz = activityAndQuiz.filter(task => !task.complete);
            
            if (activityAndQuiz.length > 0) {
                this.bot.log(this.bot.isMobile, '打卡任务', `活动与测验: 共 ${activityAndQuiz.length} 个，已完成 ${completedActivityAndQuiz.length} 个，未完成 ${incompleteActivityAndQuiz.length} 个`);
                
                if (completedActivityAndQuiz.length > 0) {
                    const completedTitles = completedActivityAndQuiz.map(task => task.title).join(', ');
                    this.bot.log(this.bot.isMobile, '打卡任务', `已完成的活动与测验: ${completedTitles}`);
                }
                
                if (incompleteActivityAndQuiz.length > 0) {
                    const incompleteTitles = incompleteActivityAndQuiz.map(task => task.title).join(', ');
                    this.bot.log(this.bot.isMobile, '打卡任务', `未完成的活动与测验: ${incompleteTitles}`);
                }
            } else {
                this.bot.log(this.bot.isMobile, '打卡任务', '暂无活动与测验');
            }
            
            // 6. 总结
            const totalTasks = dailyTasks.length + morePromotions.length + (data.promotionalItem ? 1 : 0) + pcSearch.length + mobileSearch.length + activityAndQuiz.length;
            const totalCompleted = completedDailyTasks.length + completedMorePromotions.length + (data.promotionalItem?.complete ? 1 : 0) + 
                                 pcSearch.filter(task => task.complete).length + mobileSearch.filter(task => task.complete).length + completedActivityAndQuiz.length;
            
            this.bot.log(this.bot.isMobile, '打卡任务', `任务总结: 总计 ${totalTasks} 个任务，已完成 ${totalCompleted} 个，完成率 ${Math.round((totalCompleted / totalTasks) * 100)}%`);
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '打卡任务', `检查任务完成状态时出错: ${errorMessage}`, 'error');
        }
    }
}
