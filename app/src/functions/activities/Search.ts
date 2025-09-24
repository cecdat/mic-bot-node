import { Page } from 'rebrowser-playwright';
import fs from 'fs';
import path from 'path'; 

import { Workers } from '../Workers'
import { Counters, DashboardData } from '../../interface/DashboardData'
import { SearchSnapshot } from '../../util/SearchSnapshot'

export class Search extends Workers {
    private bingHome = 'https://bing.com'
    private snapshotTool: SearchSnapshot | null = null;

    // [修改] doSearch 方法现在需要接收 email
    public async doSearch(page: Page, data: DashboardData, email: string) {
        // 初始化快照工具
        this.snapshotTool = new SearchSnapshot(email);
        
        this.bot.log(this.bot.isMobile, '搜索-必应', '🔍 开始必应搜索')

        let searchCounters: Counters = data.userStatus.counters;
        let missingPoints = this.calculatePoints(searchCounters)

        if (missingPoints === 0) {
            this.bot.log(this.bot.isMobile, '搜索-必应', '✅ 必应搜索任务已完成')
            return
        }

        // [核心修改] 传入email，让脚本能找到专属的搜索词文件
        let allQueries = await this.getLocalSearchWords(email);
        const uniqueQueries = [...new Set(allQueries)];
        let searchQueries: string[];

        if (uniqueQueries.length > 0) {
            const requiredSearches = Math.ceil(missingPoints / 3) + 2;
            this.bot.log(this.bot.isMobile, '搜索-本地词库', `💰 剩余 ${missingPoints} 积分，将从 ${uniqueQueries.length} 个词中随机抽取 ${requiredSearches} 个进行搜索。`);
            const shuffledQueries = this.bot.utils.shuffleArray(uniqueQueries);
            searchQueries = shuffledQueries.slice(0, requiredSearches);
        } else {
            this.bot.log(this.bot.isMobile, '搜索-必应', '⚠️ 本地搜索词文件为空或读取失败，将使用默认词条', 'warn');
            searchQueries = ['天气', '新闻', '电影', '音乐', '游戏', '购物', '旅游', '美食', '体育', '科技', '财经', '汽车', '房产', '教育', '健康'];
        }
        
        let maxLoop = 0;
        let currentQueries = [...searchQueries];

        while (missingPoints > 0 && currentQueries.length > 0 && maxLoop <= 10) {
            
            await this.closeExtraPages(page);
            
            const query = currentQueries.shift()!;
            
            // 显示详细的积分信息
            if (this.bot.isMobile) {
                this.bot.log(this.bot.isMobile, '搜索-必应', `💰 剩余 ${missingPoints} 积分 | 查询: ${query}`);
            } else {
                // 桌面端显示更详细的积分信息
                const searchCounters = await this.bot.browser.func.getDashboardData(page).then(data => data.userStatus.counters);
                const genericData = searchCounters.pcSearch?.[0];
                const edgeData = searchCounters.pcSearch?.[1];
                
                let logMessage = `剩余 ${missingPoints} 积分 | 查询: ${query}`;
                if (genericData) {
                    logMessage += ` | 必应: ${genericData.pointProgress}/${genericData.pointProgressMax}`;
                }
                if (edgeData) {
                    logMessage += ` | Edge: ${edgeData.pointProgress}/${edgeData.pointProgressMax}`;
                }
                
                this.bot.log(false, '搜索-必应', logMessage);
            }

            try {
                // 搜索前快照
                if (this.bot.isMobile && maxLoop === 0) {
                    await this.takeSearchSnapshot(page, 'before_search', query, missingPoints);
                }
                
                // 执行搜索
                await this.bingSearch(page, query, missingPoints);
                const newCounters = await this.bot.browser.func.getDashboardData(page).then(data => data.userStatus.counters);
                const newMissingPoints = this.calculatePoints(newCounters);
                
                if (newMissingPoints === missingPoints) {
                    maxLoop++;
                    this.bot.log(this.bot.isMobile, '搜索-必应', `⚠️ 本次搜索未获得积分，连续失败次数: ${maxLoop}/10`, 'warn');
                    
                    // 连续失败时也拍快照
                    if (this.bot.isMobile && (maxLoop === 3 || maxLoop === 5)) {
                        await this.takeSearchSnapshot(page, 'search_failed', query, missingPoints, maxLoop);
                    }
                    
                    // 移动端搜索失败时，增加额外延迟
                    if (this.bot.isMobile && maxLoop > 3) {
                        const extraDelay = Math.min(maxLoop * 2000, 10000); // 最多10秒延迟
                        this.bot.log(this.bot.isMobile, '搜索-必应', `⏰ 移动端搜索连续失败，增加延迟 ${extraDelay/1000} 秒`, 'warn');
                        await this.bot.utils.wait(extraDelay);
                    }
                } else {
                    maxLoop = 0;
                    this.bot.log(this.bot.isMobile, '搜索-必应', `🎉 搜索成功！积分变化: ${missingPoints} -> ${newMissingPoints}`);
                    
                    // 搜索成功后也拍快照
                    if (this.bot.isMobile) {
                        await this.takeSearchSnapshot(page, 'search_success', query, newMissingPoints);
                    }
                }

                missingPoints = newMissingPoints;
                searchCounters = newCounters;
                
                // 如果移动端搜索连续失败5次，尝试刷新页面
                if (this.bot.isMobile && maxLoop === 5) {
                    this.bot.log(this.bot.isMobile, '搜索-必应', '🔄 移动端搜索连续失败5次，尝试刷新页面', 'warn');
                    try {
                        await page.reload({ waitUntil: 'domcontentloaded' });
                        await this.bot.utils.wait(3000);
                        
                        // 刷新后拍快照
                        await this.takeSearchSnapshot(page, 'after_refresh', query, missingPoints);
                    } catch (refreshError) {
                        this.bot.log(this.bot.isMobile, '搜索-必应', `❌ 页面刷新失败: ${refreshError}`, 'warn');
                    }
                }
                
            } catch (searchError) {
                const errorMessage = searchError instanceof Error ? searchError.message : String(searchError);
                this.bot.log(this.bot.isMobile, '搜索-必应', `💥 搜索执行出错: ${errorMessage}`, 'error');
                maxLoop++;
                
                // 搜索出错时拍快照
                if (this.bot.isMobile) {
                    await this.takeSearchSnapshot(page, 'search_error', query, missingPoints, maxLoop, errorMessage);
                }
                
                // 搜索出错时等待更长时间
                await this.bot.utils.wait(5000);
            }
        }

        if (missingPoints > 0) {
            this.bot.log(this.bot.isMobile, '搜索-必应', `⚠️ 搜索任务结束，但仍有 ${missingPoints} 积分未获取。可能是因为连续失败次数过多或搜索词已用尽。`, 'warn');
        }

        this.bot.log(this.bot.isMobile, '搜索-必应', '🏁 完成搜索任务');
    }

    private async bingSearch(page: Page, query: string, missingPoints: number): Promise<Counters> {
        try {
            // 搜索前快照
            if (this.bot.isMobile) {
                await this.takeSearchSnapshot(page, 'search_start', query, missingPoints);
            }
            
            await page.goto(this.bingHome, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await this.bot.browser.utils.tryDismissAllMessages(page);

            // 必应首页快照
            if (this.bot.isMobile) {
                await this.takeSearchSnapshot(page, 'bing_homepage', query, missingPoints);
            }

            // 移动端仿真：在搜索前添加一些随机交互
            if (this.bot.isMobile) {
                await this.simulateMobilePreSearchBehavior(page);
            }

            const searchBarSelector = '#sb_form_q';
            await page.waitForSelector(searchBarSelector, { state: 'visible', timeout: 15000 });
            
            // 移动端仿真：模拟真实的输入行为
            if (this.bot.isMobile) {
                await this.simulateMobileTyping(page, searchBarSelector, query);
            } else {
                await page.fill(searchBarSelector, query);
            }
            
            await page.press(searchBarSelector, 'Enter');

            const navigationTimeoutMs = this.bot.utils.stringToMs(this.bot.config.navigationTimeout);
            
            // 检查并处理cookies模态窗（仅移动端）
            if (this.bot.isMobile) {
                await this.handleCookiesModal(page, query);
            }
            
            // [修复] 等待搜索结果或真人检测界面出现
            try {
                await page.waitForSelector('#b_results', { timeout: navigationTimeoutMs });
                
                // 搜索结果页快照
                if (this.bot.isMobile) {
                    await this.takeSearchSnapshot(page, 'search_results', query, missingPoints);
                }
                
                // [新增] 检查并处理必应验证模态窗
                await this.handleBingVerification(page, query);
                
                // 再次检查cookies模态窗（可能在搜索结果加载后出现，仅移动端）
                if (this.bot.isMobile) {
                    await this.handleCookiesModal(page, query);
                }
                
                // 只有在搜索结果页面出现异常时才检查真人检测
                const hasSearchResults = await page.locator('#b_results').isVisible().catch(() => false);
                if (!hasSearchResults) {
                    await this.handleHumanVerification(page, query);
                }
                
            } catch (timeoutError) {
                // 如果等待搜索结果超时，检查是否出现了真人检测界面
                this.bot.log(this.bot.isMobile, '搜索-必应', `[${query}] 等待搜索结果超时，检查是否出现真人检测界面...`);
                
                // 检查是否出现真人检测界面
                const humanVerificationDetected = await this.checkAndHandleHumanVerificationPage(page, query);
                
                if (!humanVerificationDetected) {
                    // 如果既没有搜索结果也没有真人检测，抛出错误
                    throw new Error('页面加载超时，未检测到搜索结果或真人检测界面');
                }
            }
            
            const resultPage = await this.bot.browser.utils.getLatestTab(page);

            // 移动端仿真动作：滚动和点击搜索结果
            if (this.bot.isMobile) {
                // 检查是否有搜索结果，如果没有则跳过仿真动作
                const hasSearchResults = await resultPage.locator('#b_results').isVisible().catch(() => false);
                
                if (hasSearchResults) {
                    // 移动端滚动仿真
                    if (this.bot.config.searchSettings?.scrollRandomResults) {
                        await this.bot.utils.wait(1000);
                        await this.mobileRandomScroll(resultPage);
                        
                        // 滚动后快照
                        await this.takeSearchSnapshot(page, 'after_scroll', query, 0);
                    }
                    
                    // 移动端点击搜索结果仿真
                    if (this.bot.config.searchSettings?.clickRandomResults) {
                        await this.bot.utils.wait(1000);
                        await this.mobileClickRandomLink(resultPage);
                        
                        // 点击后快照
                        await this.takeSearchSnapshot(page, 'after_click', query, 0);
                    }
                } else {
                    this.bot.log(this.bot.isMobile, '搜索-移动端仿真', `[${query}] 未检测到搜索结果，跳过仿真动作`);
                }
            } else {
                // 桌面端保持原有逻辑
                if (this.bot.config.searchSettings?.scrollRandomResults) {
                    await this.bot.utils.wait(1000);
                    await this.randomScroll(resultPage);
                }
                if (this.bot.config.searchSettings?.clickRandomResults) {
                    await this.bot.utils.wait(1000);
                    await this.clickRandomLink(resultPage);
                }
            }

            // --- 移动端和桌面端不同的延迟策略 ---
            if (this.bot.isMobile) {
                // 移动端使用更长的延迟，模拟真实用户行为
                const mobileMinDelay = this.bot.utils.stringToMs('8s');
                const mobileMaxDelay = this.bot.utils.stringToMs('20s');
                
                const minDelay = this.bot.config.searchSettings?.searchDelay?.min
                    ? this.bot.utils.stringToMs(this.bot.config.searchSettings.searchDelay.min)
                    : mobileMinDelay;
                
                const maxDelay = this.bot.config.searchSettings?.searchDelay?.max
                    ? this.bot.utils.stringToMs(this.bot.config.searchSettings.searchDelay.max)
                    : mobileMaxDelay;

                const delay = Math.floor(this.bot.utils.randomNumber(minDelay, maxDelay));
                this.bot.log(this.bot.isMobile, '搜索-移动端延迟', `移动端搜索间隔: ${delay}ms`);
                await this.bot.utils.wait(delay);
            } else {
                // 桌面端保持原有逻辑
                const defaultMinDelay = this.bot.utils.stringToMs('5s');
                const defaultMaxDelay = this.bot.utils.stringToMs('15s');

                const minDelay = this.bot.config.searchSettings?.searchDelay?.min
                    ? this.bot.utils.stringToMs(this.bot.config.searchSettings.searchDelay.min)
                    : defaultMinDelay;
                
                const maxDelay = this.bot.config.searchSettings?.searchDelay?.max
                    ? this.bot.utils.stringToMs(this.bot.config.searchSettings.searchDelay.max)
                    : defaultMaxDelay;

                const delay = Math.floor(this.bot.utils.randomNumber(minDelay, maxDelay));
                await this.bot.utils.wait(delay);
            }
            // --- 修改结束 ---

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '搜索-必应', `单次搜索失败: ${errorMessage}`, 'error');
            
            // 搜索失败时拍快照
            if (this.bot.isMobile) {
                await this.takeSearchSnapshot(page, 'search_failed_page', query, 0, undefined, errorMessage);
            }
        }

        // [优化] 减少仪表盘数据获取频率，只在必要时获取
        // 这里不立即获取数据，而是返回 null，让调用方决定何时获取
        return null as any;
    }

    // [核心修改] getLocalSearchWords 现在能智能加载专属或默认的词库
    protected async getLocalSearchWords(email: string): Promise<string[]> {
        // Python脚本现在会把所有搜索词文件输出到 dist/search_terms/ 目录下
        // 在编译后的代码中，__dirname 指向 dist/functions/activities/，需要回到 dist/ 目录
        const baseDir = path.join(__dirname, '..', '..', 'search_terms');
        const userFilePath = path.join(baseDir, `${email}.txt`);
        const defaultFilePath = path.join(baseDir, 'default.txt');
        
        // 添加调试日志
        this.bot.log(this.bot.isMobile, '搜索-本地词库', `🔍 搜索词目录: ${baseDir}`);
        this.bot.log(this.bot.isMobile, '搜索-本地词库', `🔍 用户文件路径: ${userFilePath}`);
        this.bot.log(this.bot.isMobile, '搜索-本地词库', `🔍 默认文件路径: ${defaultFilePath}`);
        this.bot.log(this.bot.isMobile, '搜索-本地词库', `🔍 目录是否存在: ${fs.existsSync(baseDir)}`);
        
        if (fs.existsSync(baseDir)) {
            const files = fs.readdirSync(baseDir);
            this.bot.log(this.bot.isMobile, '搜索-本地词库', `🔍 目录中的文件: ${files.join(', ')}`);
        }
        
        let filePathToUse: string;

        if (fs.existsSync(userFilePath)) {
            // 如果存在专属文件，就用它
            this.bot.log(this.bot.isMobile, '搜索-本地词库', `✅ 发现账户 ${email} 的专属搜索词文件，正在加载...`);
            filePathToUse = userFilePath;
        } else {
            // 否则，使用通用文件
            this.bot.log(this.bot.isMobile, '搜索-本地词库', `⚠️ 未找到账户 ${email} 的专属搜索词文件，将使用通用热搜词。`);
            filePathToUse = defaultFilePath;
        }

        try {
            if (!fs.existsSync(filePathToUse)) {
                this.bot.log(this.bot.isMobile, '搜索-本地词库', `❌ 搜索词文件 ${path.basename(filePathToUse)} 不存在`, 'warn');
                return [];
            }
            const fileContent = fs.readFileSync(filePathToUse, 'utf-8');
            const terms = fileContent.split('\n').map((term: string) => term.trim()).filter((term: string) => term.length > 0);
            this.bot.log(this.bot.isMobile, '搜索-本地词库', `✅ 成功加载 ${terms.length} 个搜索词`);
            return terms;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '搜索-本地词库', `❌ 读取搜索词文件时发生错误: ${errorMessage}`, 'error');
            return [];
        }
    }

    private async randomScroll(page: Page) {
        try {
            this.bot.log(this.bot.isMobile, '搜索-随机滚动', '开始执行随机滚动...');
            
            // 添加更安全的DOM元素检查
            const viewportHeight = await page.evaluate(() => {
                // 检查页面是否完全加载
                if (!document.body || !document.documentElement) {
                    return 0;
                }
                return window.innerHeight || document.documentElement.clientHeight || document.body.clientHeight;
            });

            if (viewportHeight === 0) {
                this.bot.log(this.bot.isMobile, '搜索-随机滚动', '无法获取视口高度，跳过滚动', 'warn');
                return;
            }

            // 随机滚动次数：2-4次
            const scrollCount = Math.floor(Math.random() * 3) + 2;
            this.bot.log(this.bot.isMobile, '搜索-随机滚动', `将执行 ${scrollCount} 次随机滚动`);
            
            for (let i = 0; i < scrollCount; i++) {
                // 随机选择滚动方向：向上或向下
                const scrollDirection = Math.random() > 0.5 ? 1 : -1;
                const scrollDistance = Math.floor(Math.random() * viewportHeight * 0.8) + 100;
                const finalDistance = scrollDirection * scrollDistance;
                
                this.bot.log(this.bot.isMobile, '搜索-随机滚动', `第 ${i + 1} 次滚动: ${scrollDirection > 0 ? '向下' : '向上'} ${scrollDistance}px`);
                
                await page.evaluate((distance) => {
                    window.scrollBy(0, distance);
                }, finalDistance);
                
                // 每次滚动后等待0.5-1.5秒
                const waitTime = Math.random() * 1000 + 500;
                await this.bot.utils.wait(waitTime);
            }

            // 最后滚动回顶部
            this.bot.log(this.bot.isMobile, '搜索-随机滚动', '滚动回顶部');
            await page.evaluate(() => {
                window.scrollTo(0, 0);
            });
            await this.bot.utils.wait(1000);

            this.bot.log(this.bot.isMobile, '搜索-随机滚动', '随机滚动完成');

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '搜索-随机滚动', `随机滚动失败: ${errorMessage}`, 'warn');
        }
    }

    // [新增] 移动端专用滚动仿真方法
    private async mobileRandomScroll(page: Page) {
        try {
            this.bot.log(this.bot.isMobile, '搜索-移动端滚动', '开始执行移动端滚动仿真...');
            
            // 获取移动端视口信息
            const viewportInfo = await page.evaluate(() => {
                if (!document.body || !document.documentElement) {
                    return { height: 0, width: 0 };
                }
                return {
                    height: window.innerHeight || document.documentElement.clientHeight || document.body.clientHeight,
                    width: window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth
                };
            });

            if (viewportInfo.height === 0) {
                this.bot.log(this.bot.isMobile, '搜索-移动端滚动', '无法获取视口信息，跳过滚动', 'warn');
                return;
            }

            // 移动端滚动次数：3-6次（比桌面端更多）
            const scrollCount = Math.floor(Math.random() * 4) + 3;
            this.bot.log(this.bot.isMobile, '搜索-移动端滚动', `将执行 ${scrollCount} 次移动端滚动`);

            for (let i = 0; i < scrollCount; i++) {
                // 移动端滚动距离更大，模拟手指滑动
                const scrollDistance = Math.floor(Math.random() * viewportInfo.height * 0.6) + 200;
                
                // 移动端主要向下滚动，偶尔向上
                const scrollDirection = Math.random() > 0.2 ? 1 : -1;
                const finalDistance = scrollDirection * scrollDistance;
                
                this.bot.log(this.bot.isMobile, '搜索-移动端滚动', `第 ${i + 1} 次滚动: ${scrollDirection > 0 ? '向下' : '向上'} ${scrollDistance}px`);
                
                // 使用平滑滚动，模拟移动端触摸滑动
                await page.evaluate((distance) => {
                    window.scrollBy({
                        top: distance,
                        behavior: 'smooth'
                    });
                }, finalDistance);
                
                // 移动端滚动间隔更长，模拟真实用户行为
                const waitTime = Math.random() * 2000 + 1000; // 1-3秒
                await this.bot.utils.wait(waitTime);
                
                // 偶尔添加小幅度的左右滑动（模拟移动端手势）
                if (Math.random() > 0.7) {
                    const horizontalDistance = Math.floor(Math.random() * 50) - 25; // -25到25px
                    await page.evaluate((distance) => {
                        window.scrollBy({
                            left: distance,
                            behavior: 'smooth'
                        });
                    }, horizontalDistance);
                    await this.bot.utils.wait(300);
                }
            }

            // 最后滚动回顶部
            this.bot.log(this.bot.isMobile, '搜索-移动端滚动', '滚动回顶部');
            await page.evaluate(() => {
                window.scrollTo({
                    top: 0,
                    behavior: 'smooth'
                });
            });
            await this.bot.utils.wait(1500);

            this.bot.log(this.bot.isMobile, '搜索-移动端滚动', '移动端滚动仿真完成');

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '搜索-移动端滚动', `移动端滚动失败: ${errorMessage}`, 'warn');
        }
    }

    private async clickRandomLink(page: Page) {
        try {
            this.bot.log(this.bot.isMobile, '搜索-随机点击', '开始执行随机点击搜索结果...');
            
            // 查找搜索结果容器
            const resultsContainer = page.locator('#b_results');
            const isVisible = await resultsContainer.isVisible();
            
            if (!isVisible) {
                this.bot.log(this.bot.isMobile, '搜索-随机点击', '搜索结果容器不可见，跳过点击');
                return;
            }
            
            const links = resultsContainer.getByRole('link');
            const count = await links.count();
            
            if (count > 0) {
                const clickMaxIndex = Math.min(count, 5);
                const randomIndex = Math.floor(Math.random() * clickMaxIndex);
                
                this.bot.log(this.bot.isMobile, '搜索-随机点击', `找到 ${count} 个搜索结果链接，将点击第 ${randomIndex + 1} 个`);
                
                // [新增] 捕获可能的新开标签页
                const popupPromise = page.waitForEvent('popup', { timeout: 5000 }).catch(() => null);
                let popupOpened = null as null | Page;
                
                // 使用 JS 触发点击，避免 Playwright 为导航自动等待
                const beforeUrl = page.url();
                try {
                    const handle = await links.nth(randomIndex).elementHandle({ timeout: 3000 });
                    if (handle) {
                        this.bot.log(this.bot.isMobile, '搜索-随机点击', '正在点击搜索结果链接...');
                        await page.evaluate((el) => {
                            (el as HTMLElement).click();
                        }, handle);
                        this.bot.log(this.bot.isMobile, '搜索-随机点击', '点击完成，等待页面响应...');
                    } else {
                        throw new Error('未获取到可点击的链接句柄');
                    }
                    popupOpened = await popupPromise;
                } catch (clickError) {
                    this.bot.log(this.bot.isMobile, '搜索-随机点击', `点击链接失败: ${clickError}`, 'warn');
                }
                
                if (popupOpened) {
                    this.bot.log(this.bot.isMobile, '搜索-随机点击', '检测到新标签页打开，等待页面加载...');
                    await popupOpened.waitForLoadState('domcontentloaded').catch(() => {});
                    
                    // [修改] 等待2-5秒的随机时间
                    const waitTime = Math.floor(Math.random() * 3000) + 2000; // 2-5秒
                    this.bot.log(this.bot.isMobile, '搜索-随机点击', `等待 ${waitTime}ms 后关闭新标签页...`);
                    await this.bot.utils.wait(waitTime);
                    
                    // 关闭新标签页
                    try {
                        await popupOpened.close();
                        this.bot.log(this.bot.isMobile, '搜索-随机点击', '新标签页已关闭');
                    } catch (closeError) {
                        this.bot.log(this.bot.isMobile, '搜索-随机点击', `关闭新标签页失败: ${closeError}`, 'warn');
                    }
                    return;
                }
                
                // 如果没有弹窗，等待短暂的同页导航或 URL 变化
                if (!popupOpened) {
                    this.bot.log(this.bot.isMobile, '搜索-随机点击', '未检测到新标签页，等待同页导航...');
                    await Promise.race([
                        page.waitForNavigation({ timeout: 4000 }).catch(() => null),
                        page.waitForURL((url) => url.toString() !== beforeUrl, { timeout: 4000 }).catch(() => null)
                    ]);
                }
                
                // 若当前页发生了同页跳转，则尝试回退
                await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
                const currentUrl = page.url();
                if (!/bing\.com\/search/i.test(currentUrl)) {
                    this.bot.log(this.bot.isMobile, '搜索-随机点击', `检测到同页跳转至非搜索页: ${currentUrl}，将回退到搜索结果`);
                    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
                }
                
                this.bot.log(this.bot.isMobile, '搜索-随机点击', '随机点击完成');
            } else {
                this.bot.log(this.bot.isMobile, '搜索-随机点击', '未找到可点击的链接');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '搜索-随机点击', `发生错误: ${errorMessage}`, 'error');
        }
    }

    // [新增] 移动端专用点击搜索结果方法
    private async mobileClickRandomLink(page: Page) {
        try {
            this.bot.log(this.bot.isMobile, '搜索-移动端点击', '开始执行移动端点击搜索结果仿真...');
            
            // 首先检查是否遇到真人检测页面
            const hasHumanVerification = await this.checkHumanVerificationPage(page);
            if (hasHumanVerification) {
                this.bot.log(this.bot.isMobile, '搜索-移动端点击', '检测到真人检测页面，跳过点击搜索结果');
                return;
            }
            
            // 查找搜索结果容器
            const resultsContainer = page.locator('#b_results');
            const isVisible = await resultsContainer.isVisible();
            
            if (!isVisible) {
                this.bot.log(this.bot.isMobile, '搜索-移动端点击', '搜索结果容器不可见，跳过点击');
                return;
            }
            
            const links = resultsContainer.getByRole('link');
            const count = await links.count();
            
            if (count > 0) {
                // 移动端点击前3个结果中的一个
                const clickMaxIndex = Math.min(count, 3);
                const randomIndex = Math.floor(Math.random() * clickMaxIndex);
                
                this.bot.log(this.bot.isMobile, '搜索-移动端点击', `找到 ${count} 个搜索结果链接，将点击第 ${randomIndex + 1} 个`);
                
                // 移动端点击前先模拟触摸手势
                await this.simulateMobileTouchGesture(page, links.nth(randomIndex));
                
                // 捕获可能的新开标签页
                const popupPromise = page.waitForEvent('popup', { timeout: 5000 }).catch(() => null);
                let popupOpened = null as null | Page;
                
                const beforeUrl = page.url();
                try {
                    const handle = await links.nth(randomIndex).elementHandle({ timeout: 3000 });
                    if (handle) {
                        this.bot.log(this.bot.isMobile, '搜索-移动端点击', '正在点击搜索结果链接...');
                        
                        // 移动端使用触摸点击
                        await page.evaluate((el) => {
                            try {
                                // 模拟移动端触摸事件（兼容性处理）
                                const rect = el.getBoundingClientRect();
                                const centerX = rect.left + rect.width / 2;
                                const centerY = rect.top + rect.height / 2;
                                
                                // 创建触摸事件（如果支持）
                                if (typeof TouchEvent !== 'undefined' && typeof Touch !== 'undefined') {
                                    const touchEvent = new TouchEvent('touchstart', {
                                        bubbles: true,
                                        cancelable: true,
                                        touches: [new Touch({
                                            identifier: 1,
                                            target: el,
                                            clientX: centerX,
                                            clientY: centerY
                                        })]
                                    });
                                    el.dispatchEvent(touchEvent);
                                }
                                
                                // 短暂延迟后触发点击
                                setTimeout(() => {
                                    (el as HTMLElement).click();
                                }, 100);
                            } catch (error) {
                                // 如果触摸事件失败，直接点击
                                (el as HTMLElement).click();
                            }
                        }, handle);
                        
                        this.bot.log(this.bot.isMobile, '搜索-移动端点击', '移动端点击完成，等待页面响应...');
                    } else {
                        throw new Error('未获取到可点击的链接句柄');
                    }
                    popupOpened = await popupPromise;
                } catch (clickError) {
                    this.bot.log(this.bot.isMobile, '搜索-移动端点击', `点击链接失败: ${clickError}`, 'warn');
                }
                
                if (popupOpened) {
                    this.bot.log(this.bot.isMobile, '搜索-移动端点击', '检测到新标签页打开，等待页面加载...');
                    await popupOpened.waitForLoadState('domcontentloaded').catch(() => {});
                    
                    // 移动端停留时间更长，模拟真实用户行为
                    const waitTime = Math.floor(Math.random() * 5000) + 3000; // 3-8秒
                    this.bot.log(this.bot.isMobile, '搜索-移动端点击', `等待 ${waitTime}ms 后关闭新标签页...`);
                    await this.bot.utils.wait(waitTime);
                    
                    // 关闭新标签页
                    try {
                        await popupOpened.close();
                        this.bot.log(this.bot.isMobile, '搜索-移动端点击', '新标签页已关闭');
                    } catch (closeError) {
                        this.bot.log(this.bot.isMobile, '搜索-移动端点击', `关闭新标签页失败: ${closeError}`, 'warn');
                    }
                    return;
                }
                
                // 如果没有弹窗，等待短暂的同页导航或 URL 变化
                if (!popupOpened) {
                    this.bot.log(this.bot.isMobile, '搜索-移动端点击', '未检测到新标签页，等待同页导航...');
                    await Promise.race([
                        page.waitForNavigation({ timeout: 4000 }).catch(() => null),
                        page.waitForURL((url) => url.toString() !== beforeUrl, { timeout: 4000 }).catch(() => null)
                    ]);
                }
                
                // 若当前页发生了同页跳转，则尝试回退
                await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
                const currentUrl = page.url();
                if (!/bing\.com\/search/i.test(currentUrl)) {
                    this.bot.log(this.bot.isMobile, '搜索-移动端点击', `检测到同页跳转至非搜索页: ${currentUrl}，将回退到搜索结果`);
                    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
                }
                
                this.bot.log(this.bot.isMobile, '搜索-移动端点击', '移动端点击仿真完成');
            } else {
                this.bot.log(this.bot.isMobile, '搜索-移动端点击', '未找到可点击的链接');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '搜索-移动端点击', `发生错误: ${errorMessage}`, 'error');
        }
    }

    // [新增] 检查是否遇到真人检测页面
    private async checkHumanVerificationPage(page: Page): Promise<boolean> {
        try {
            // 检查常见的真人检测页面标识
            const humanVerificationSelectors = [
                'input[type="checkbox"]',
                '[data-testid*="captcha"]',
                '[class*="captcha"]',
                '[id*="captcha"]',
                'iframe[src*="captcha"]',
                'iframe[src*="recaptcha"]',
                'iframe[src*="hcaptcha"]',
                '[class*="verification"]',
                '[id*="verification"]',
                'button:has-text("验证")',
                'button:has-text("Verify")',
                'button:has-text("I\'m not a robot")',
                'button:has-text("我不是机器人")'
            ];

            for (const selector of humanVerificationSelectors) {
                const element = page.locator(selector);
                if (await element.count() > 0 && await element.first().isVisible({ timeout: 1000 }).catch(() => false)) {
                    this.bot.log(this.bot.isMobile, '搜索-真人检测检查', `检测到真人检测页面元素: ${selector}`);
                    return true;
                }
            }

            // 检查页面内容是否包含真人检测相关文本
            const pageContent = await page.content();
            const humanVerificationTexts = [
                'captcha',
                'recaptcha',
                'hcaptcha',
                'verification',
                'verify',
                'robot',
                '机器人',
                '验证',
                'human',
                'challenge'
            ];

            const lowerContent = pageContent.toLowerCase();
            for (const text of humanVerificationTexts) {
                if (lowerContent.includes(text)) {
                    this.bot.log(this.bot.isMobile, '搜索-真人检测检查', `页面内容包含真人检测相关文本: ${text}`);
                    return true;
                }
            }

            return false;
        } catch (error) {
            this.bot.log(this.bot.isMobile, '搜索-真人检测检查', `检查真人检测页面时出错: ${error}`, 'warn');
            return false;
        }
    }

    // [新增] 模拟移动端触摸手势
    private async simulateMobileTouchGesture(page: Page, element: any) {
        try {
            // 获取元素位置
            const boundingBox = await element.boundingBox();
            if (!boundingBox) return;

            const centerX = boundingBox.x + boundingBox.width / 2;
            const centerY = boundingBox.y + boundingBox.height / 2;

            // 模拟触摸前的短暂停留
            await this.bot.utils.wait(Math.random() * 500 + 200);

            // 模拟触摸手势：先触摸，再点击
            await page.touchscreen.tap(centerX, centerY);
            
            this.bot.log(this.bot.isMobile, '搜索-移动端触摸', '模拟移动端触摸手势完成');
        } catch (error) {
            this.bot.log(this.bot.isMobile, '搜索-移动端触摸', `模拟触摸手势失败: ${error}`, 'warn');
        }
    }

    // [新增] 模拟移动端搜索前的行为
    private async simulateMobilePreSearchBehavior(page: Page) {
        try {
            this.bot.log(this.bot.isMobile, '搜索-移动端预搜索', '开始模拟移动端搜索前行为...');
            
            // 随机等待时间，模拟用户浏览页面
            const waitTime = Math.random() * 2000 + 1000; // 1-3秒
            await this.bot.utils.wait(waitTime);
            
            // 随机进行小幅度的页面滚动，模拟用户浏览
            if (Math.random() > 0.5) {
                const scrollDistance = Math.floor(Math.random() * 200) + 50; // 50-250px
                await page.evaluate((distance) => {
                    window.scrollBy({
                        top: distance,
                        behavior: 'smooth'
                    });
                }, scrollDistance);
                
                await this.bot.utils.wait(500);
                
                // 滚动回顶部
                await page.evaluate(() => {
                    window.scrollTo({
                        top: 0,
                        behavior: 'smooth'
                    });
                });
            }
            
            this.bot.log(this.bot.isMobile, '搜索-移动端预搜索', '移动端搜索前行为模拟完成');
        } catch (error) {
            this.bot.log(this.bot.isMobile, '搜索-移动端预搜索', `模拟搜索前行为失败: ${error}`, 'warn');
        }
    }

    // [新增] 模拟移动端真实输入行为
    private async simulateMobileTyping(page: Page, selector: string, text: string) {
        try {
            this.bot.log(this.bot.isMobile, '搜索-移动端输入', '开始模拟移动端真实输入行为...');
            
            // 先点击搜索框
            await page.click(selector);
            await this.bot.utils.wait(300);
            
            // 清空搜索框
            await page.fill(selector, '');
            await this.bot.utils.wait(200);
            
            // 模拟分段输入，避免逐字符输入的问题
            const segments = this.splitTextIntoSegments(text);
            for (const segment of segments) {
                if (segment && segment.length > 0) {
                    await page.keyboard.type(segment);
                    
                    // 随机输入间隔，模拟真实打字速度
                    const typeDelay = Math.random() * 300 + 100; // 100-400ms
                    await this.bot.utils.wait(typeDelay);
                    
                    // 偶尔添加更长的停顿，模拟思考时间
                    if (Math.random() > 0.7) {
                        const pauseTime = Math.random() * 500 + 200; // 200-700ms
                        await this.bot.utils.wait(pauseTime);
                    }
                }
            }
            
            // 输入完成后短暂等待
            await this.bot.utils.wait(Math.random() * 300 + 200);
            
            this.bot.log(this.bot.isMobile, '搜索-移动端输入', '移动端真实输入行为模拟完成');
        } catch (error) {
            this.bot.log(this.bot.isMobile, '搜索-移动端输入', `模拟输入行为失败: ${error}`, 'warn');
            // 如果模拟输入失败，回退到普通输入
            await page.fill(selector, text);
        }
    }

    // [新增] 将文本分割成小段，用于模拟真实输入
    private splitTextIntoSegments(text: string): string[] {
        const segments: string[] = [];
        let currentSegment = '';
        
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            currentSegment += char;
            
            // 在空格、标点符号或每2-4个字符后分割
            if (char === ' ' || char === '.' || char === ',' || char === '?' || char === '!' || 
                currentSegment.length >= Math.floor(Math.random() * 3) + 2) {
                segments.push(currentSegment);
                currentSegment = '';
            }
        }
        
        // 添加剩余部分
        if (currentSegment.length > 0) {
            segments.push(currentSegment);
        }
        
        return segments;
    }

    // [新增] 关闭除第一个以外的所有页面，避免资源占用
    private async closeExtraPages(page: Page) {
        try {
            const context = page.context();
            const pages = context.pages();
            if (pages.length <= 1) return;
            for (let i = 1; i < pages.length; i++) {
                try {
                    const pageToClose = pages[i];
                    if (pageToClose) {
                        await (pageToClose as any).close({ runBeforeUnload: true });
                    }
                } catch {}
            }
            this.bot.log(this.bot.isMobile, '搜索-资源清理', `已关闭多余标签页，剩余 ${context.pages().length} 个页面`);
        } catch {}
    }



    // [新增] 搜索过程中拍快照
    private async takeSearchSnapshot(page: Page, snapshotType: string, query: string, missingPoints: number, maxLoop?: number, errorMessage?: string) {
        // 根据配置决定是否保存快照
        if (!this.bot.config.snapshots?.taskExecution) {
            return;
        }
        
        if (!this.snapshotTool) {
            this.bot.log(this.bot.isMobile, '搜索-快照', '快照工具未初始化，跳过快照', 'warn');
            return;
        }

        try {
            const filePath = await this.snapshotTool.takeSnapshot(page, {
                snapshotType,
                query,
                missingPoints,
                maxLoop,
                errorMessage
            });

            if (filePath) {
                this.bot.log(this.bot.isMobile, '搜索-快照', `快照已保存到 ${filePath}`);
                
                // 简化快照日志
                this.bot.log(this.bot.isMobile, '搜索-快照', `快照已保存: ${snapshotType}`);
            } else {
                this.bot.log(this.bot.isMobile, '搜索-快照', '快照拍摄失败', 'error');
            }

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '搜索-快照', `拍摄快照失败: ${errorMessage}`, 'error');
        }
    }

    // [新增] 处理必应验证模态窗
    private async handleBingVerification(page: Page, query: string): Promise<void> {
        try {
            // 等待一下页面完全加载
            await this.bot.utils.wait(2000);
            
            // 检查是否存在验证模态窗
            const verificationBanner = page.locator('text=通过快速验证增强搜索体验');
            const verifyButton = page.locator('button:has-text("验证")');
            
            if (await verificationBanner.isVisible() && await verifyButton.isVisible()) {
                this.bot.log(this.bot.isMobile, '搜索-验证', `[${query}] 检测到必应验证模态窗，正在处理...`);
                
                // 点击验证按钮前的快照
                if (this.bot.isMobile) {
                    await this.takeSearchSnapshot(page, 'before_verification', query, 0);
                }
                
                // 点击验证按钮
                this.bot.log(this.bot.isMobile, '搜索-验证', `[${query}] 正在点击验证按钮...`);
                await verifyButton.click();
                
                // 等待验证页面加载
                await this.bot.utils.wait(3000);
                
                // 验证后页面的快照
                if (this.bot.isMobile) {
                    await this.takeSearchSnapshot(page, 'after_verification', query, 0);
                }
                
                this.bot.log(this.bot.isMobile, '搜索-验证', `[${query}] 验证按钮已点击，等待验证页面加载...`);
                
                // [新增] 处理真人检测
                await this.handleHumanVerification(page, query);
                
                // 等待验证完成，检查是否回到搜索结果页
                try {
                    await page.waitForSelector('#b_results', { timeout: 30000 });
                    this.bot.log(this.bot.isMobile, '搜索-验证', `[${query}] 验证完成，已回到搜索结果页`);
                } catch (timeoutError) {
                    this.bot.log(this.bot.isMobile, '搜索-验证', `[${query}] 验证超时，可能仍在验证页面`, 'warn');
                    
                    // 如果还在验证页面，尝试回退
                    try {
                        await page.goBack({ waitUntil: 'domcontentloaded' });
                        this.bot.log(this.bot.isMobile, '搜索-验证', `[${query}] 已回退到搜索结果页`);
                    } catch (goBackError) {
                        this.bot.log(this.bot.isMobile, '搜索-验证', `[${query}] 回退失败: ${goBackError}`, 'warn');
                    }
                }
            } else {
                this.bot.log(this.bot.isMobile, '搜索-验证', `[${query}] 未检测到验证模态窗，继续执行搜索任务`);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '搜索-验证', `[${query}] 处理验证模态窗时出错: ${errorMessage}`, 'error');
            
            // 出错时也拍快照
            if (this.bot.isMobile) {
                await this.takeSearchSnapshot(page, 'verification_error', query, 0, undefined, errorMessage);
            }
        }
    }

    // [新增] 处理真人检测
    private async handleHumanVerification(page: Page, query: string): Promise<void> {
        try {
            this.bot.log(this.bot.isMobile, '搜索-真人检测', `[${query}] 开始处理真人检测...`);
            
            // 等待页面完全加载
            await this.bot.utils.wait(2000);
            
            // 真人检测前的快照已禁用
            
            // 尝试多种可能的真人检测选择器，包括在搜索结果页面直接出现的
            const possibleSelectors = [
                // 常见的真人检测选择器
                'input[type="checkbox"]',
                'input[type="radio"]',
                '.recaptcha-checkbox',
                '[role="checkbox"]',
                '[aria-checked="false"]',
                'input[aria-label*="robot"]',
                'input[aria-label*="human"]',
                'input[aria-label*="captcha"]',
                'input[aria-label*="验证"]',
                'input[aria-label*="检测"]',
                // 必应特有的真人检测选择器
                'input[aria-label*="I\'m not a robot"]',
                'input[aria-label*="我不是机器人"]',
                'input[aria-label*="Verify you are human"]',
                'input[aria-label*="验证你是人类"]',
                // 更通用的选择器
                'input[data-testid*="captcha"]',
                'input[data-testid*="verification"]',
                'input[class*="captcha"]',
                'input[class*="verification"]',
                'input[id*="captcha"]',
                'input[id*="verification"]'
            ];
            
            let verificationCompleted = false;
            
            for (const selector of possibleSelectors) {
                try {
                    const elements = page.locator(selector);
                    const count = await elements.count();
                    
                    if (count > 0) {
                        this.bot.log(this.bot.isMobile, '搜索-真人检测', `[${query}] 找到 ${count} 个可能的验证元素，使用选择器: ${selector}`);
                        
                        // 遍历找到的元素，尝试勾选
                        for (let i = 0; i < count; i++) {
                            try {
                                const element = elements.nth(i);
                                const isVisible = await element.isVisible();
                                
                                if (isVisible) {
                                    this.bot.log(this.bot.isMobile, '搜索-真人检测', `[${query}] 正在勾选第 ${i + 1} 个验证元素...`);
                                    
                                    // 尝试点击勾选
                                    await element.click();
                                    await this.bot.utils.wait(1000);
                                    
                                    // 检查是否勾选成功
                                    const isChecked = await element.isChecked().catch(() => false);
                                    if (isChecked) {
                                        this.bot.log(this.bot.isMobile, '搜索-真人检测', `[${query}] 第 ${i + 1} 个验证元素勾选成功`);
                                        verificationCompleted = true;
                                        break;
                                    }
                                }
                            } catch (elementError) {
                                this.bot.log(this.bot.isMobile, '搜索-真人检测', `[${query}] 勾选第 ${i + 1} 个元素失败: ${elementError}`, 'warn');
                                continue;
                            }
                        }
                        
                        if (verificationCompleted) {
                            break;
                        }
                    }
                } catch (selectorError) {
                    this.bot.log(this.bot.isMobile, '搜索-真人检测', `[${query}] 选择器 ${selector} 查找失败: ${selectorError}`, 'warn');
                    continue;
                }
            }
            
            if (verificationCompleted) {
                this.bot.log(this.bot.isMobile, '搜索-真人检测', `[${query}] 真人检测勾选完成`);
                
                // 勾选完成后的快照已禁用
                
                // 等待验证提交
                await this.bot.utils.wait(3000);
                
                // 尝试查找并点击提交按钮
                const submitSelectors = [
                    'button:has-text("提交")',
                    'button:has-text("Submit")',
                    'button:has-text("验证")',
                    'button:has-text("Verify")',
                    'button:has-text("确认")',
                    'button:has-text("Confirm")',
                    'input[type="submit"]',
                    '[role="button"]',
                    // 必应特有的提交按钮
                    'button[aria-label*="Submit"]',
                    'button[aria-label*="提交"]',
                    'button[aria-label*="Verify"]',
                    'button[aria-label*="验证"]'
                ];
                
                for (const submitSelector of submitSelectors) {
                    try {
                        const submitButton = page.locator(submitSelector);
                        if (await submitButton.isVisible()) {
                            this.bot.log(this.bot.isMobile, '搜索-真人检测', `[${query}] 找到提交按钮，正在点击...`);
                            await submitButton.click();
                            await this.bot.utils.wait(2000);
                            break;
                        }
                    } catch (submitError) {
                        continue;
                    }
                }
                
                // 等待验证结果，检查页面是否回到正常状态
                await this.bot.utils.wait(3000);
                
                // 验证完成后的快照
                if (this.bot.isMobile) {
                    await this.takeSearchSnapshot(page, 'verification_completed', query, 0);
                }
                
            } else {
                this.bot.log(this.bot.isMobile, '搜索-真人检测', `[${query}] 未找到可勾选的验证元素`, 'warn');
                
                // 未找到验证元素时的快照已禁用
                // if (this.bot.isMobile) {
                //     await this.takeSearchSnapshot(page, 'human_verification_not_found', query, 0);
                // }
            }
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '搜索-真人检测', `[${query}] 处理真人检测时出错: ${errorMessage}`, 'error');
            
            // 出错时的快照已禁用
        }
    }

    // [新增] 处理 cookies 管理模态窗口
    private async handleCookiesModal(page: Page, query: string): Promise<void> {
        try {
            this.bot.log(this.bot.isMobile, '搜索-Cookies', `[${query}] 检查是否存在 cookies 管理模态窗口...`);
            
            // 等待页面完全加载
            await this.bot.utils.wait(1000);
            
            // 检查是否存在 cookies 管理模态窗口
            const cookiesModalSelectors = [
                // 中文 cookies 模态窗口 - 基于图片中的实际文本
                'text=我们使用可选的Cookie',
                'text=管理 Cookie',
                'text=接受',
                'text=拒绝',
                'text=隐私声明',
                'text=第三方 Cookie',
                // 英文 cookies 模态窗口
                'text=We use optional Cookies',
                'text=Manage Cookie',
                'text=Accept',
                'text=Reject',
                'text=Privacy Statement',
                'text=Third-party Cookie',
                // 更通用的选择器
                'button:has-text("接受")',
                'button:has-text("Accept")',
                'button:has-text("拒绝")',
                'button:has-text("Reject")',
                // 基于图片中的按钮样式
                'button[style*="blue"]',
                'button[class*="primary"]',
                'button[class*="accept"]',
                'button[class*="reject"]',
                // 数据属性选择器
                '[data-testid*="cookie"]',
                '[data-testid*="accept"]',
                '[data-testid*="reject"]',
                // ARIA属性选择器
                '[aria-label*="Cookie"]',
                '[aria-label*="cookie"]',
                '[aria-label*="接受"]',
                '[aria-label*="拒绝"]',
                // 模态窗口检测
                '[role="dialog"]',
                '[class*="modal"]',
                '[class*="popup"]',
                '[class*="overlay"]'
            ];
            
            let cookiesModalFound = false;
            
            // 首先检查页面是否包含cookies相关文本
            const pageContent = await page.content();
            const hasCookiesText = pageContent.toLowerCase().includes('cookie') || 
                                  pageContent.toLowerCase().includes('cookies') ||
                                  pageContent.includes('我们使用可选的Cookie') ||
                                  pageContent.includes('管理 Cookie');
            
            if (hasCookiesText) {
                this.bot.log(this.bot.isMobile, '搜索-Cookies', `[${query}] 页面内容包含cookies相关文本，开始查找具体元素...`);
                
                // 保存cookies页面的HTML快照用于分析（受配置控制）
                if (this.bot.config.snapshots?.cookies) {
                    try {
                        const htmlContent = await page.content();
                        const sessionDir = path.join(process.cwd(), this.bot.config.sessionPath, 'cookies_analysis');
                        if (!fs.existsSync(sessionDir)) {
                            fs.mkdirSync(sessionDir, { recursive: true });
                        }
                        
                        const timestamp = Date.now();
                        const htmlPath = path.join(sessionDir, `cookies_page_${timestamp}.html`);
                        fs.writeFileSync(htmlPath, htmlContent);
                        
                        this.bot.log(this.bot.isMobile, '搜索-Cookies', `[${query}] Cookies页面HTML快照已保存: ${htmlPath}`);
                        
                    } catch (snapshotError) {
                        this.bot.log(this.bot.isMobile, '搜索-Cookies', `[${query}] 保存Cookies页面HTML快照失败: ${snapshotError}`, 'warn');
                    }
                }
                
                // 尝试查找具体的cookies模态窗口元素
                for (const selector of cookiesModalSelectors) {
                    try {
                        const element = page.locator(selector);
                        const count = await element.count();
                        
                        if (count > 0) {
                            this.bot.log(this.bot.isMobile, '搜索-Cookies', `[${query}] 使用选择器 ${selector} 找到 ${count} 个元素`);
                            
                            for (let i = 0; i < count; i++) {
                                try {
                                    const currentElement = element.nth(i);
                                    if (await currentElement.isVisible()) {
                                        this.bot.log(this.bot.isMobile, '搜索-Cookies', `[${query}] 找到可见的cookies元素: ${selector} (第${i+1}个)`);
                                        cookiesModalFound = true;
                                        break;
                                    }
                                } catch (elementError) {
                                    continue;
                                }
                            }
                            
                            if (cookiesModalFound) {
                                break;
                            }
                        }
                    } catch (selectorError) {
                        continue;
                    }
                }
            } else {
                this.bot.log(this.bot.isMobile, '搜索-Cookies', `[${query}] 页面内容不包含cookies相关文本，跳过cookies检测`);
            }
            
            if (cookiesModalFound) {
                // Cookies 模态窗口出现前的快照
                if (this.bot.isMobile) {
                    await this.takeSearchSnapshot(page, 'before_cookies_modal', query, 0);
                }
                
                this.bot.log(this.bot.isMobile, '搜索-Cookies', `[${query}] 正在处理 cookies 管理模态窗口...`);
                
                // 尝试点击"接受"按钮
                const acceptSelectors = [
                    'button:has-text("接受")',
                    'button:has-text("Accept")',
                    'text=接受',
                    'text=Accept'
                ];
                
                let acceptClicked = false;
                
                for (const acceptSelector of acceptSelectors) {
                    try {
                        const acceptButton = page.locator(acceptSelector);
                        if (await acceptButton.isVisible()) {
                            this.bot.log(this.bot.isMobile, '搜索-Cookies', `[${query}] 找到接受按钮，正在点击...`);
                            await acceptButton.click();
                            await this.bot.utils.wait(1000);
                            acceptClicked = true;
                            break;
                        }
                    } catch (acceptError) {
                        continue;
                    }
                }
                
                if (acceptClicked) {
                    this.bot.log(this.bot.isMobile, '搜索-Cookies', `[${query}] Cookies 接受按钮点击成功`);
                    
                    // 等待模态窗口消失
                    await this.bot.utils.wait(2000);
                    
                    // Cookies 处理完成后的快照
                    if (this.bot.isMobile) {
                        await this.takeSearchSnapshot(page, 'after_cookies_modal', query, 0);
                    }
                    
                } else {
                    this.bot.log(this.bot.isMobile, '搜索-Cookies', `[${query}] 未找到可点击的接受按钮`, 'warn');
                    
                    // 尝试查找并点击其他可能的按钮
                    const otherButtonSelectors = [
                        'button:has-text("拒绝")',
                        'button:has-text("Reject")',
                        'text=拒绝',
                        'text=Reject'
                    ];
                    
                    for (const otherSelector of otherButtonSelectors) {
                        try {
                            const otherButton = page.locator(otherSelector);
                            if (await otherButton.isVisible()) {
                                this.bot.log(this.bot.isMobile, '搜索-Cookies', `[${query}] 找到其他按钮，尝试点击...`);
                                await otherButton.click();
                                await this.bot.utils.wait(2000);
                                break;
                            }
                        } catch (otherError) {
                            continue;
                        }
                    }
                }
                
            } else {
                this.bot.log(this.bot.isMobile, '搜索-Cookies', `[${query}] 未检测到 cookies 管理模态窗口`);
            }
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '搜索-Cookies', `[${query}] 处理 cookies 模态窗口时出错: ${errorMessage}`, 'error');
            
            // 出错时的快照
            if (this.bot.isMobile) {
                await this.takeSearchSnapshot(page, 'cookies_modal_error', query, 0, undefined, errorMessage);
            }
        }
    }

    // [新增] 检测并处理真人检测页面（当搜索结果页面没有出现时）
    private async checkAndHandleHumanVerificationPage(page: Page, query: string): Promise<boolean> {
        try {
            this.bot.log(this.bot.isMobile, '搜索-真人检测页面', `[${query}] 开始检测真人检测页面...`);
            
            // 等待页面完全加载
            await this.bot.utils.wait(3000);
            
            // 真人检测页面出现前的快照已禁用
            
            // 检测真人检测页面的特征
            const humanVerificationSelectors = [
                // 中文真人检测页面
                'text=最后一步',
                'text=请解决以下难题以继续',
                'text=确认您是真人',
                'text=我们使用可选的Cookie',
                // 英文真人检测页面
                'text=Last Step',
                'text=Please solve the following problem to continue',
                'text=Confirm you are a real person',
                'text=We use optional Cookies',
                // 更通用的选择器
                'input[type="checkbox"]',
                'input[type="radio"]',
                '[role="checkbox"]',
                '[aria-checked="false"]',
                // 必应特有的选择器
                'input[aria-label*="robot"]',
                'input[aria-label*="human"]',
                'input[aria-label*="captcha"]',
                'input[aria-label*="验证"]',
                'input[aria-label*="检测"]',
                'input[aria-label*="真人"]'
            ];
            
            let humanVerificationPageFound = false;
            
            for (const selector of humanVerificationSelectors) {
                try {
                    const element = page.locator(selector);
                    if (await element.isVisible()) {
                        this.bot.log(this.bot.isMobile, '搜索-真人检测页面', `[${query}] 检测到真人检测页面，使用选择器: ${selector}`);
                        humanVerificationPageFound = true;
                        break;
                    }
                } catch (selectorError) {
                    continue;
                }
            }
            
            if (humanVerificationPageFound) {
                this.bot.log(this.bot.isMobile, '搜索-真人检测页面', `[${query}] 正在处理真人检测页面...`);
                
                // 处理真人检测页面
                await this.handleHumanVerificationPage(page, query);
                
                // 等待页面处理完成，尝试回到搜索结果页
                await this.bot.utils.wait(5000);
                
                // 检查是否已经回到搜索结果页
                try {
                    await page.waitForSelector('#b_results', { timeout: 15000 });
                    this.bot.log(this.bot.isMobile, '搜索-真人检测页面', `[${query}] 真人检测完成，已回到搜索结果页`);
                    return true;
                } catch (resultsTimeoutError) {
                    this.bot.log(this.bot.isMobile, '搜索-真人检测页面', `[${query}] 真人检测后仍未回到搜索结果页`, 'warn');
                    
                    // 尝试刷新页面
                    try {
                        this.bot.log(this.bot.isMobile, '搜索-真人检测页面', `[${query}] 尝试刷新页面...`);
                        await page.reload({ waitUntil: 'domcontentloaded' });
                        await this.bot.utils.wait(3000);
                        
                        // 刷新后再次检查
                        await page.waitForSelector('#b_results', { timeout: 15000 });
                        this.bot.log(this.bot.isMobile, '搜索-真人检测页面', `[${query}] 页面刷新后已回到搜索结果页`);
                        return true;
                    } catch (refreshError) {
                        this.bot.log(this.bot.isMobile, '搜索-真人检测页面', `[${query}] 页面刷新后仍未回到搜索结果页`, 'warn');
                        return false;
                    }
                }
            } else {
                this.bot.log(this.bot.isMobile, '搜索-真人检测页面', `[${query}] 未检测到真人检测页面`);
                return false;
            }
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '搜索-真人检测页面', `[${query}] 检测真人检测页面时出错: ${errorMessage}`, 'error');
            
            // 出错时的快照已禁用
            
            return false;
        }
    }

    // [新增] 处理真人检测页面（专门处理"最后一步"类型的页面）
    private async handleHumanVerificationPage(page: Page, query: string): Promise<void> {
        try {
            this.bot.log(this.bot.isMobile, '搜索-真人检测页面处理', `[${query}] 开始处理真人检测页面...`);
            
            // 等待页面完全加载
            await this.bot.utils.wait(2000);
            
            // [新增] 检查是否出现"正在验证..."状态，如果是则等待验证完成
            try {
                const verifyingSelectors = [
                    'text=正在验证...',
                    'text=Verifying...',
                    'text=正在验证',
                    'text=Verifying',
                    // 更通用的选择器
                    '[class*="verifying"]',
                    '[class*="loading"]',
                    '[class*="spinner"]',
                    '[class*="progress"]'
                ];
                
                let isVerifying = false;
                for (const selector of verifyingSelectors) {
                    try {
                        const element = page.locator(selector);
                        if (await element.isVisible()) {
                            this.bot.log(this.bot.isMobile, '搜索-真人检测页面处理', `[${query}] 检测到"正在验证..."状态，等待验证完成...`);
                            isVerifying = true;
                            break;
                        }
                    } catch (selectorError) {
                        continue;
                    }
                }
                
                if (isVerifying) {
                    // 等待验证完成，最多等待30秒
                    this.bot.log(this.bot.isMobile, '搜索-真人检测页面处理', `[${query}] 开始等待验证完成...`);
                    
                    let verificationCompleted = false;
                    const maxWaitTime = 30000; // 30秒
                    const checkInterval = 2000; // 每2秒检查一次
                    let waitedTime = 0;
                    
                    while (waitedTime < maxWaitTime && !verificationCompleted) {
                        await this.bot.utils.wait(checkInterval);
                        waitedTime += checkInterval;
                        
                        // 检查验证状态是否还在
                        let stillVerifying = false;
                        for (const selector of verifyingSelectors) {
                            try {
                                const element = page.locator(selector);
                                if (await element.isVisible()) {
                                    stillVerifying = true;
                                    break;
                                }
                            } catch (selectorError) {
                                continue;
                            }
                        }
                        
                        if (!stillVerifying) {
                            verificationCompleted = true;
                            this.bot.log(this.bot.isMobile, '搜索-真人检测页面处理', `[${query}] 验证完成，等待时间: ${waitedTime/1000}秒`);
                        } else {
                            this.bot.log(this.bot.isMobile, '搜索-真人检测页面处理', `[${query}] 验证仍在进行中，已等待 ${waitedTime/1000}秒...`);
                        }
                    }
                    
                    if (!verificationCompleted) {
                        this.bot.log(this.bot.isMobile, '搜索-真人检测页面处理', `[${query}] 验证超时，继续处理页面`, 'warn');
                    }
                    
                    // 验证完成后再等待一下，确保页面稳定
                    await this.bot.utils.wait(2000);
                }
            } catch (verificationError) {
                this.bot.log(this.bot.isMobile, '搜索-真人检测页面处理', `[${query}] 检查验证状态时出错: ${verificationError}`, 'warn');
            }
            
            // [新增] 等待页面完全加载，确保复选框出现
            this.bot.log(this.bot.isMobile, '搜索-真人检测页面处理', `[${query}] 等待页面完全加载，确保复选框出现...`);
            
            // 等待页面加载完成
            try {
                await page.waitForLoadState('networkidle', { timeout: 10000 });
                this.bot.log(this.bot.isMobile, '搜索-真人检测页面处理', `[${query}] 页面网络加载完成`);
            } catch (loadError) {
                this.bot.log(this.bot.isMobile, '搜索-真人检测页面处理', `[${query}] 等待页面加载超时: ${loadError}`, 'warn');
            }
            
            // 额外等待时间，确保动态内容加载完成
            await this.bot.utils.wait(5000);
            
            // 检查页面是否包含复选框相关的元素
            let checkboxesReady = false;
            const maxWaitTime = 15000; // 最多等待15秒
            const checkInterval = 2000; // 每2秒检查一次
            let waitedTime = 0;
            
            while (waitedTime < maxWaitTime && !checkboxesReady) {
                try {
                    // 检查页面是否包含复选框
                    const checkboxIndicators = [
                        'input[type="checkbox"]',
                        '[role="checkbox"]',
                        'input[aria-label*="真人"]',
                        'input[aria-label*="human"]',
                        'input[aria-label*="验证"]',
                        'input[aria-label*="检测"]'
                    ];
                    
                    for (const indicator of checkboxIndicators) {
                        const elements = page.locator(indicator);
                        const count = await elements.count();
                        if (count > 0) {
                            checkboxesReady = true;
                            this.bot.log(this.bot.isMobile, '搜索-真人检测页面处理', `[${query}] 检测到复选框元素，页面已准备就绪`);
                            break;
                        }
                    }
                    
                    if (checkboxesReady) {
                        break;
                    }
                    
                    this.bot.log(this.bot.isMobile, '搜索-真人检测页面处理', `[${query}] 复选框尚未出现，继续等待... (已等待 ${waitedTime/1000}秒)`);
                    await this.bot.utils.wait(checkInterval);
                    waitedTime += checkInterval;
                    
                } catch (checkError) {
                    this.bot.log(this.bot.isMobile, '搜索-真人检测页面处理', `[${query}] 检查复选框状态时出错: ${checkError}`, 'warn');
                    await this.bot.utils.wait(checkInterval);
                    waitedTime += checkInterval;
                }
            }
            
            if (!checkboxesReady) {
                this.bot.log(this.bot.isMobile, '搜索-真人检测页面处理', `[${query}] 等待复选框出现超时，继续处理页面`, 'warn');
            }
            
            // 真人检测页面快照功能已禁用（根据配置）
            
            // 查找并勾选"确认您是真人"的单选框
            const checkboxSelectors = [
                // 更精确的选择器，优先使用
                'input[type="checkbox"]:not([checked])',
                'input[type="checkbox"]',
                'input[type="radio"]:not([checked])',
                'input[type="radio"]',
                '[role="checkbox"]:not([aria-checked="true"])',
                '[role="checkbox"]',
                '[aria-checked="false"]',
                // 基于文本内容的选择器
                'input[aria-label*="真人"]',
                'input[aria-label*="human"]',
                'input[aria-label*="robot"]',
                'input[aria-label*="验证"]',
                'input[aria-label*="检测"]',
                // 更通用的选择器
                'input[type="checkbox"]:not([checked="checked"])',
                'input[type="checkbox"]:not([checked="true"])',
                // 基于父元素的文本内容查找
                'input[type="checkbox"]',
                'input[type="radio"]'
            ];
            
            let checkboxClicked = false;
            
            for (const selector of checkboxSelectors) {
                try {
                    const checkboxes = page.locator(selector);
                    const count = await checkboxes.count();
                    
                    if (count > 0) {
                        this.bot.log(this.bot.isMobile, '搜索-真人检测页面处理', `[${query}] 找到 ${count} 个可能的复选框，使用选择器: ${selector}`);
                        
                        // 遍历找到的复选框，尝试勾选
                        for (let i = 0; i < count; i++) {
                            try {
                                const checkbox = checkboxes.nth(i);
                                const isVisible = await checkbox.isVisible();
                                
                                if (isVisible) {
                                    this.bot.log(this.bot.isMobile, '搜索-真人检测页面处理', `[${query}] 正在勾选第 ${i + 1} 个复选框...`);
                                    
                                    // 尝试点击勾选
                                    await checkbox.click();
                                    await this.bot.utils.wait(1000);
                                    
                                    // 检查是否勾选成功
                                    const isChecked = await checkbox.isChecked().catch(() => false);
                                    if (isChecked) {
                                        this.bot.log(this.bot.isMobile, '搜索-真人检测页面处理', `[${query}] 第 ${i + 1} 个复选框勾选成功`);
                                        checkboxClicked = true;
                                        break;
                                    }
                                }
                            } catch (checkboxError) {
                                this.bot.log(this.bot.isMobile, '搜索-真人检测页面处理', `[${query}] 勾选第 ${i + 1} 个复选框失败: ${checkboxError}`, 'warn');
                                continue;
                            }
                        }
                        
                        if (checkboxClicked) {
                            break;
                        }
                    }
                } catch (selectorError) {
                    continue;
                }
            }
            
            if (checkboxClicked) {
                this.bot.log(this.bot.isMobile, '搜索-真人检测页面处理', `[${query}] 复选框勾选完成`);
                
                // 勾选完成后的快照已禁用
                
                // 等待验证提交
                await this.bot.utils.wait(3000);
                
                // 尝试查找并点击提交按钮
                const submitSelectors = [
                    'button:has-text("提交")',
                    'button:has-text("Submit")',
                    'button:has-text("验证")',
                    'button:has-text("Verify")',
                    'button:has-text("确认")',
                    'button:has-text("Confirm")',
                    'button:has-text("继续")',
                    'button:has-text("Continue")',
                    'input[type="submit"]',
                    '[role="button"]',
                    // 必应特有的提交按钮
                    'button[aria-label*="Submit"]',
                    'button[aria-label*="提交"]',
                    'button[aria-label*="Verify"]',
                    'button[aria-label*="验证"]'
                ];
                
                for (const submitSelector of submitSelectors) {
                    try {
                        const submitButton = page.locator(submitSelector);
                        if (await submitButton.isVisible()) {
                            this.bot.log(this.bot.isMobile, '搜索-真人检测页面处理', `[${query}] 找到提交按钮，正在点击...`);
                            await submitButton.click();
                            await this.bot.utils.wait(2000);
                            break;
                        }
                    } catch (submitError) {
                        continue;
                    }
                }
                
                // 等待验证结果
                await this.bot.utils.wait(3000);
                
                // 验证完成后的快照已禁用
                
            } else {
                this.bot.log(this.bot.isMobile, '搜索-真人检测页面处理', `[${query}] 未找到可勾选的复选框，尝试智能查找...`);
                
                // [新增] 智能查找复选框：基于页面文本内容定位
                const smartCheckboxFound = await this.findCheckboxByText(page, query);
                
                if (smartCheckboxFound) {
                    this.bot.log(this.bot.isMobile, '搜索-真人检测页面处理', `[${query}] 智能查找复选框成功`);
                    
                    // 等待验证提交
                    await this.bot.utils.wait(3000);
                    
                    // 尝试查找并点击提交按钮
                    const submitSelectors = [
                        'button:has-text("提交")',
                        'button:has-text("Submit")',
                        'button:has-text("验证")',
                        'button:has-text("Verify")',
                        'button:has-text("确认")',
                        'button:has-text("Confirm")',
                        'button:has-text("继续")',
                        'button:has-text("Continue")',
                        'input[type="submit"]',
                        '[role="button"]',
                        // 必应特有的提交按钮
                        'button[aria-label*="Submit"]',
                        'button[aria-label*="提交"]',
                        'button[aria-label*="Verify"]',
                        'button[aria-label*="验证"]'
                    ];
                    
                    for (const submitSelector of submitSelectors) {
                        try {
                            const submitButton = page.locator(submitSelector);
                            if (await submitButton.isVisible()) {
                                this.bot.log(this.bot.isMobile, '搜索-真人检测页面处理', `[${query}] 找到提交按钮，正在点击...`);
                                await submitButton.click();
                                await this.bot.utils.wait(2000);
                                break;
                            }
                        } catch (submitError) {
                            continue;
                        }
                    }
                    
                    // 等待验证结果
                    await this.bot.utils.wait(3000);
                    
                    // 验证完成后的快照已禁用
                    // if (this.bot.isMobile) {
                    //     await this.takeSearchSnapshot(page, 'human_verification_page_completed', query, 0);
                    // }
                    
                } else {
                    this.bot.log(this.bot.isMobile, '搜索-真人检测页面处理', `[${query}] 智能查找复选框也失败了`, 'warn');
                    
                    // 未找到复选框时的快照已禁用
                }
            }
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '搜索-真人检测页面处理', `[${query}] 处理真人检测页面时出错: ${errorMessage}`, 'error');
            
            // 出错时的快照已禁用
        }
    }

    // [新增] 智能查找复选框：基于页面文本内容定位
    private async findCheckboxByText(page: Page, query: string): Promise<boolean> {
        try {
            this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] 开始智能查找复选框...`);
            
            // 等待页面完全加载
            await this.bot.utils.wait(1000);
            
            // 智能查找复选框的快照已禁用
            
            // [新增] 方法0：使用更精确的XPath选择器
            try {
                this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] 尝试使用XPath选择器查找复选框...`);
                
                // 查找包含"确认您是真人"文本的label元素，然后找到其关联的复选框
                const checkboxByXPath = page.locator('xpath=//label[contains(text(), "确认您是真人")]/input[@type="checkbox"]');
                if (await checkboxByXPath.isVisible()) {
                    this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] 通过XPath找到复选框，尝试勾选...`);
                    
                    await checkboxByXPath.click();
                    await this.bot.utils.wait(1000);
                    
                    const isChecked = await checkboxByXPath.isChecked().catch(() => false);
                    if (isChecked) {
                        this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] XPath方法复选框勾选成功`);
                        
                        // XPath复选框点击快照已禁用
                        
                        return true;
                    }
                }
                
                // 如果上面的XPath不工作，尝试更通用的XPath
                const genericCheckboxXPath = page.locator('xpath=//input[@type="checkbox" and not(@checked)]');
                if (await genericCheckboxXPath.isVisible()) {
                    this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] 通过通用XPath找到复选框，尝试勾选...`);
                    
                    await genericCheckboxXPath.click();
                    await this.bot.utils.wait(1000);
                    
                    const isChecked = await genericCheckboxXPath.isChecked().catch(() => false);
                    if (isChecked) {
                        this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] 通用XPath方法复选框勾选成功`);
                        
                        // 通用XPath复选框点击快照已禁用
                        
                        return true;
                    }
                }
            } catch (xpathError) {
                this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] XPath方法查找复选框失败: ${xpathError}`, 'warn');
            }
            
            // 方法1：查找包含"确认您是真人"文本附近的复选框
            try {
                this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] 尝试基于文本内容查找复选框...`);
                
                // 先查找文本元素
                const textElement = page.locator('text=确认您是真人');
                if (await textElement.isVisible()) {
                    this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] 找到"确认您是真人"文本，查找附近的复选框...`);
                    
                    // [新增] 专门针对"确认您是真人"页面的复选框查找策略
                    // 策略1：查找文本元素前面的复选框（优先策略）
                    try {
                        this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] 尝试查找"确认您是真人"文字前面的复选框...`);
                        
                        // 使用XPath查找文本元素前面的复选框
                        const precedingCheckboxes = page.locator('xpath=//text()[contains(., "确认您是真人")]/preceding-sibling::*[self::input[@type="checkbox"] or self::div[@role="checkbox"] or self::span[@role="checkbox"] or self::button[@role="checkbox"]]');
                        const precedingCount = await precedingCheckboxes.count();
                        
                        if (precedingCount > 0) {
                            this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] 找到 ${precedingCount} 个前置复选框，尝试点击第一个...`);
                            
                            for (let i = 0; i < precedingCount; i++) {
                                try {
                                    const checkbox = precedingCheckboxes.nth(i);
                                    if (await checkbox.isVisible()) {
                                        this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] 尝试点击前置复选框 ${i + 1}...`);
                                        
                                        await checkbox.click();
                                        await this.bot.utils.wait(1000);
                                        
                                        const isChecked = await checkbox.isChecked().catch(() => false);
                                        if (isChecked) {
                                            this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] 前置复选框勾选成功！`);
                                            
                                            // 前置复选框点击快照已禁用
                                            
                                            return true;
                                        }
                                    }
                                } catch (clickError) {
                                    this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] 点击前置复选框 ${i + 1} 失败: ${clickError}`, 'warn');
                                    continue;
                                }
                            }
                        } else {
                            this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] 未找到前置复选框，尝试其他策略...`);
                        }
                    } catch (precedingError) {
                        this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] 前置复选框查找失败: ${precedingError}`, 'warn');
                    }
                    
                    // 策略2：查找文本元素的父容器中的复选框
                    try {
                        // 查找文本元素的父容器
                        const parentContainer = textElement.locator('xpath=..');
                        if (await parentContainer.count() > 0) {
                            this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] 查找文本元素父容器中的复选框...`);
                            
                            // 在父容器中查找复选框
                            const nearbyCheckboxes = parentContainer.locator('input[type="checkbox"], [role="checkbox"], [aria-checked="false"]');
                            const nearbyCount = await nearbyCheckboxes.count();
                            
                            if (nearbyCount > 0) {
                                this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] 在父容器中找到 ${nearbyCount} 个复选框`);
                                
                                for (let i = 0; i < nearbyCount; i++) {
                                    try {
                                        const checkbox = nearbyCheckboxes.nth(i);
                                        if (await checkbox.isVisible()) {
                                            this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] 尝试点击父容器中的第 ${i + 1} 个复选框...`);
                                            
                                            await checkbox.click();
                                            await this.bot.utils.wait(1000);
                                            
                                            const isChecked = await checkbox.isChecked().catch(() => false);
                                            if (isChecked) {
                                                this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] 父容器复选框勾选成功`);
                                                
                                                // 父容器复选框点击快照已禁用
                                                
                                                return true;
                                            }
                                        }
                                    } catch (clickError) {
                                        continue;
                                    }
                                }
                            }
                        }
                    } catch (parentError) {
                        this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] 父容器查找失败: ${parentError}`, 'warn');
                    }
                    
                    // 策略2：使用JavaScript查找页面中最大的复选框
                    try {
                        this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] 使用JavaScript查找最大的复选框...`);
                        
                        // 简化JavaScript逻辑，避免复杂的类型推断
                        const largestCheckboxInfo = await page.evaluate(() => {
                            const checkboxes = document.querySelectorAll('input[type="checkbox"], [role="checkbox"]');
                            let largestIndex = -1;
                            let maxArea = 0;
                            
                            for (let i = 0; i < checkboxes.length; i++) {
                                const checkbox = checkboxes[i] as HTMLElement;
                                if (checkbox.offsetParent !== null) { // 检查是否可见
                                    const rect = checkbox.getBoundingClientRect();
                                    const area = rect.width * rect.height;
                                    
                                    if (area > maxArea) {
                                        maxArea = area;
                                        largestIndex = i;
                                    }
                                }
                            }
                            
                            return { largestIndex, maxArea };
                        });
                        
                        if (largestCheckboxInfo.largestIndex >= 0) {
                            this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] JavaScript找到最大的复选框，索引: ${largestCheckboxInfo.largestIndex}`);
                            
                            // 使用索引重新查找元素，避免传递复杂的DOM对象
                            const largestCheckbox = page.locator('input[type="checkbox"], [role="checkbox"]').nth(largestCheckboxInfo.largestIndex);
                            
                            if (await largestCheckbox.isVisible()) {
                                this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] 尝试点击最大的复选框...`);
                                
                                await largestCheckbox.click();
                                await this.bot.utils.wait(1000);
                                
                                const isChecked = await largestCheckbox.isChecked().catch(() => false);
                                if (isChecked) {
                                    this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] JavaScript最大复选框勾选成功`);
                                    
                                                                                    // JavaScript最大复选框点击快照已禁用
                                    
                                    return true;
                                }
                            }
                        }
                    } catch (jsError) {
                        this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] JavaScript查找最大复选框失败: ${jsError}`, 'warn');
                    }
                    
                    // 策略3：尝试多种方式查找附近的复选框
                    const checkboxSelectors = [
                        'input[type="checkbox"]',
                        'input[type="checkbox"]:not([checked])',
                        'input[type="checkbox"]:not([checked="checked"])',
                        '[role="checkbox"]',
                        '[aria-checked="false"]',
                        // [新增] 更宽松的选择器
                        'input[type="checkbox"]:not([checked="true"])',
                        'input[type="checkbox"]:not([checked="checked"])',
                        '[class*="checkbox"]',
                        '[class*="check"]',
                        '[id*="checkbox"]',
                        '[id*="check"]'
                    ];
                    
                    for (const selector of checkboxSelectors) {
                        try {
                            const checkboxes = page.locator(selector);
                            const count = await checkboxes.count();
                            
                            if (count > 0) {
                                this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] 使用选择器 ${selector} 找到 ${count} 个复选框`);
                                
                                // 尝试点击第一个可见的复选框
                                for (let i = 0; i < count; i++) {
                                    try {
                                        const checkbox = checkboxes.nth(i);
                                        if (await checkbox.isVisible()) {
                                            this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] 尝试点击第 ${i + 1} 个复选框...`);
                                            
                                            await checkbox.click();
                                            await this.bot.utils.wait(1000);
                                            
                                            const isChecked = await checkbox.isChecked().catch(() => false);
                                            if (isChecked) {
                                                this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] 基于文本的复选框勾选成功`);
                                                
                                                if (this.bot.isMobile) {
                                                    await this.takeSearchSnapshot(page, 'text_based_checkbox_clicked', query, 0);
                                                }
                                                
                                                return true;
                                            }
                                        }
                                    } catch (clickError) {
                                        this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] 点击第 ${i + 1} 个复选框失败: ${clickError}`, 'warn');
                                        continue;
                                    }
                                }
                            }
                        } catch (selectorError) {
                            continue;
                        }
                    }
                }
            } catch (textError) {
                this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] 基于文本查找复选框失败: ${textError}`, 'warn');
            }
            
            // 方法2：使用JavaScript查找复选框
            try {
                this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] 尝试使用JavaScript查找复选框...`);
                
                const checkboxFound = await page.evaluate(() => {
                    // 查找所有复选框
                    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
                    if (checkboxes.length === 0) return false;
                    
                    this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] JavaScript找到 ${checkboxes.length} 个复选框`);
                    
                    // 查找第一个未勾选的复选框
                    for (let i = 0; i < checkboxes.length; i++) {
                        const checkbox = checkboxes[i] as HTMLInputElement;
                        if (!checkbox.checked && checkbox.offsetParent !== null) { // 检查是否可见
                            this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] JavaScript找到第 ${i + 1} 个未勾选复选框，尝试勾选...`);
                            
                            // 尝试勾选
                            checkbox.checked = true;
                            checkbox.click();
                            
                            // 触发change事件
                            const event = new Event('change', { bubbles: true });
                            checkbox.dispatchEvent(event);
                            
                            return true;
                        }
                    }
                    return false;
                });
                
                if (checkboxFound) {
                    this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] JavaScript勾选复选框成功`);
                    
                    // 等待一下让页面响应
                    await this.bot.utils.wait(2000);
                    
                    // JavaScript勾选成功后的快照
                    if (this.bot.isMobile) {
                        await this.takeSearchSnapshot(page, 'javascript_checkbox_clicked', query, 0);
                    }
                    
                    return true;
                }
            } catch (jsError) {
                this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] JavaScript勾选复选框失败: ${jsError}`, 'warn');
            }
            
            // 方法3：查找所有可见的复选框并尝试点击
            try {
                this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] 尝试查找所有可见复选框...`);
                
                const allCheckboxes = page.locator('input[type="checkbox"]');
                const count = await allCheckboxes.count();
                
                if (count > 0) {
                    this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] 找到 ${count} 个复选框，尝试逐个点击...`);
                    
                    for (let i = 0; i < count; i++) {
                        try {
                            const checkbox = allCheckboxes.nth(i);
                            const isVisible = await checkbox.isVisible();
                            
                            if (isVisible) {
                                this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] 尝试点击第 ${i + 1} 个复选框...`);
                                
                                // 尝试点击勾选
                                await checkbox.click();
                                await this.bot.utils.wait(1000);
                                
                                // 检查是否勾选成功
                                const isChecked = await checkbox.isChecked().catch(() => false);
                                if (isChecked) {
                                    this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] 第 ${i + 1} 个复选框勾选成功`);
                                    
                                    // 勾选成功后的快照
                                    if (this.bot.isMobile) {
                                        await this.takeSearchSnapshot(page, 'fallback_checkbox_clicked', query, 0);
                                    }
                                    
                                    return true;
                                }
                            }
                        } catch (checkboxError) {
                            this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] 点击第 ${i + 1} 个复选框失败: ${checkboxError}`, 'warn');
                            continue;
                        }
                    }
                }
            } catch (fallbackError) {
                this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] 备用方法查找复选框失败: ${fallbackError}`, 'warn');
            }
            
            // [新增] 方法4：使用更宽松的选择器
            try {
                this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] 尝试使用更宽松的选择器...`);
                
                const looseSelectors = [
                    'input[type="checkbox"]',
                    'input[type="radio"]',
                    '[role="checkbox"]',
                    '[role="radio"]',
                    '[aria-checked="false"]',
                    '[aria-checked="unchecked"]',
                    'input[checked="false"]',
                    'input[checked="unchecked"]'
                ];
                
                for (const selector of looseSelectors) {
                    try {
                        const elements = page.locator(selector);
                        const count = await elements.count();
                        
                        if (count > 0) {
                            this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] 使用宽松选择器 ${selector} 找到 ${count} 个元素`);
                            
                            for (let i = 0; i < count; i++) {
                                try {
                                    const element = elements.nth(i);
                                    if (await element.isVisible()) {
                                        this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] 尝试点击宽松选择器找到的第 ${i + 1} 个元素...`);
                                        
                                        await element.click();
                                        await this.bot.utils.wait(1000);
                                        
                                        // 检查是否勾选成功
                                        const isChecked = await element.isChecked().catch(() => false);
                                        if (isChecked) {
                                            this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] 宽松选择器方法勾选成功`);
                                            
                                            if (this.bot.isMobile) {
                                                await this.takeSearchSnapshot(page, 'loose_selector_checkbox_clicked', query, 0);
                                            }
                                            
                                            return true;
                                        }
                                    }
                                } catch (elementError) {
                                    continue;
                                }
                            }
                        }
                    } catch (selectorError) {
                        continue;
                    }
                }
            } catch (looseError) {
                this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] 宽松选择器方法失败: ${looseError}`, 'warn');
            }
            
            this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] 所有智能查找方法都失败了`);
            return false;
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '搜索-智能查找复选框', `[${query}] 智能查找复选框时出错: ${errorMessage}`, 'error');
            
            // 出错时的快照
            if (this.bot.isMobile) {
                await this.takeSearchSnapshot(page, 'smart_checkbox_error', query, 0, undefined, errorMessage);
            }
            
            return false;
        }
    }

    private calculatePoints(counters: Counters) {
        if (this.bot.isMobile) {
            // 移动端搜索：优先使用移动端数据
            const mobileData = counters.mobileSearch?.[0];
            if (mobileData) {
                const missingPoints = mobileData.pointProgressMax - mobileData.pointProgress;
                this.bot.log(this.bot.isMobile, '搜索-积分计算', `移动端搜索积分: ${mobileData.pointProgress}/${mobileData.pointProgressMax}, 剩余: ${missingPoints}`);
                return Math.max(0, missingPoints); // 确保不返回负数
            } else {
                this.bot.log(this.bot.isMobile, '搜索-积分计算', '未找到移动端搜索数据，尝试使用桌面端数据', 'warn');
                // 如果没有移动端数据，尝试使用桌面端数据
                const genericData = counters.pcSearch?.[0];
                const edgeData = counters.pcSearch?.[1];
                let totalMissing = 0;
                
                if (genericData) {
                    totalMissing += Math.max(0, genericData.pointProgressMax - genericData.pointProgress);
                }
                if (edgeData) {
                    totalMissing += Math.max(0, edgeData.pointProgressMax - edgeData.pointProgress);
                }
                
                this.bot.log(this.bot.isMobile, '搜索-积分计算', `使用桌面端数据计算积分，剩余: ${totalMissing}`);
                return totalMissing;
            }
        } else {
            // 桌面端搜索
            const genericData = counters.pcSearch?.[0];
            const edgeData = counters.pcSearch?.[1];
            let totalMissing = 0;
            
            if (genericData) {
                const genericMissing = Math.max(0, genericData.pointProgressMax - genericData.pointProgress);
                totalMissing += genericMissing;
                this.bot.log(false, '搜索-积分计算', `桌面端必应搜索积分: ${genericData.pointProgress}/${genericData.pointProgressMax}, 剩余: ${genericMissing}`);
            }
            
            if (edgeData) {
                const edgeMissing = Math.max(0, edgeData.pointProgressMax - edgeData.pointProgress);
                totalMissing += edgeMissing;
                this.bot.log(false, '搜索-积分计算', `桌面端Edge搜索积分: ${edgeData.pointProgress}/${edgeData.pointProgressMax}, 剩余: ${edgeMissing}`);
            }
            
            this.bot.log(false, '搜索-积分计算', `桌面端搜索总计剩余积分: ${totalMissing}`);
            return totalMissing;
        }
    }


}
