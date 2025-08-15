import { Page } from 'rebrowser-playwright'
import fs from 'fs' 
import path from 'path' 

import { Workers } from '../Workers'
import { Counters, DashboardData } from '../../interface/DashboardData'

export class Search extends Workers {
    private bingHome = 'https://bing.com'

    // [修改] doSearch 方法现在需要接收 email
    public async doSearch(page: Page, data: DashboardData, email: string) {
        this.bot.log(this.bot.isMobile, '搜索-必应', '开始必应搜索')

        let searchCounters: Counters = data.userStatus.counters;
        let missingPoints = this.calculatePoints(searchCounters)

        if (missingPoints === 0) {
            this.bot.log(this.bot.isMobile, '搜索-必应', '必应搜索任务已完成')
            return
        }

        // [核心修改] 传入email，让脚本能找到专属的搜索词文件
        let allQueries = await this.getLocalSearchWords(email);
        const uniqueQueries = [...new Set(allQueries)];
        let searchQueries: string[];

        if (uniqueQueries.length > 0) {
            const requiredSearches = Math.ceil(missingPoints / 3) + 2;
            this.bot.log(this.bot.isMobile, '搜索-本地词库', `剩余 ${missingPoints} 积分，将从 ${uniqueQueries.length} 个词中随机抽取 ${requiredSearches} 个进行搜索。`);
            const shuffledQueries = this.bot.utils.shuffleArray(uniqueQueries);
            searchQueries = shuffledQueries.slice(0, requiredSearches);
        } else {
            this.bot.log(this.bot.isMobile, '搜索-必应', '本地搜索词文件为空或读取失败，将使用默认词条', 'warn');
            searchQueries = ['天气', '新闻', '电影', '音乐', '游戏', '购物', '旅游', '美食', '体育', '科技', '财经', '汽车', '房产', '教育', '健康'];
        }
        
        let maxLoop = 0;
        let currentQueries = [...searchQueries];

        while (missingPoints > 0 && currentQueries.length > 0 && maxLoop <= 10) {
            // [新增] 每次搜索前清理多余标签页，避免资源占用
            await this.closeExtraPages(page);
            
            const query = currentQueries.shift()!;
            this.bot.log(this.bot.isMobile, '搜索-必应', `剩余 ${missingPoints} 积分 | 查询: ${query}`);

            const newCounters = await this.bingSearch(page, query);
            const newMissingPoints = this.calculatePoints(newCounters);

            if (newMissingPoints === missingPoints) {
                maxLoop++;
                this.bot.log(this.bot.isMobile, '搜索-必应', `本次搜索未获得积分，连续失败次数: ${maxLoop}/10`, 'warn');
            } else {
                maxLoop = 0;
            }

            missingPoints = newMissingPoints;
            searchCounters = newCounters;
        }

        if (missingPoints > 0) {
            this.bot.log(this.bot.isMobile, '搜索-必应', `搜索任务结束，但仍有 ${missingPoints} 积分未获取。可能是因为连续失败次数过多或搜索词已用尽。`, 'warn');
        }

        this.bot.log(this.bot.isMobile, '搜索-必应', '完成搜索任务');
    }

    private async bingSearch(page: Page, query: string): Promise<Counters> {
        try {
            await page.goto(this.bingHome, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await this.bot.browser.utils.tryDismissAllMessages(page);

            const searchBarSelector = '#sb_form_q';
            await page.waitForSelector(searchBarSelector, { state: 'visible', timeout: 15000 });
            await page.fill(searchBarSelector, query);
            await page.press(searchBarSelector, 'Enter');

            const navigationTimeoutMs = this.bot.utils.stringToMs(this.bot.config.navigationTimeout);
            await page.waitForSelector('#b_results', { timeout: navigationTimeoutMs });
            
            const resultPage = await this.bot.browser.utils.getLatestTab(page);

            if (this.bot.config.searchSettings?.scrollRandomResults) {
                await this.bot.utils.wait(1000);
                await this.randomScroll(resultPage);
            }
            if (this.bot.config.searchSettings?.clickRandomResults) {
                await this.bot.utils.wait(1000);
                await this.clickRandomLink(resultPage);
            }

            // --- 这是核心修改部分 ---
            // 定义安全的默认延迟
            const defaultMinDelay = this.bot.utils.stringToMs('5s');
            const defaultMaxDelay = this.bot.utils.stringToMs('15s');

            // 检查配置是否存在，如果不存在则使用默认值
            const minDelay = this.bot.config.searchSettings?.searchDelay?.min
                ? this.bot.utils.stringToMs(this.bot.config.searchSettings.searchDelay.min)
                : defaultMinDelay;
            
            const maxDelay = this.bot.config.searchSettings?.searchDelay?.max
                ? this.bot.utils.stringToMs(this.bot.config.searchSettings.searchDelay.max)
                : defaultMaxDelay;

            const delay = Math.floor(this.bot.utils.randomNumber(minDelay, maxDelay));
            this.bot.log(this.bot.isMobile, '搜索-必应', `等待 ${delay / 1000} 秒...`);
            await this.bot.utils.wait(delay);
            // --- 修改结束 ---

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '搜索-必应', `单次搜索失败: ${errorMessage}`, 'error');
        }

        const latestData = await this.bot.browser.func.getDashboardData(page);
        return latestData.userStatus.counters;
    }

    // [核心修改] getLocalSearchWords 现在能智能加载专属或默认的词库
    private async getLocalSearchWords(email: string): Promise<string[]> {
        // Python脚本现在会把所有搜索词文件输出到 dist/search_terms/ 目录下
        const baseDir = path.join(__dirname, '..', '..', 'search_terms');
        const userFilePath = path.join(baseDir, `${email}.txt`);
        const defaultFilePath = path.join(baseDir, 'default.txt');
        
        let filePathToUse: string;

        if (fs.existsSync(userFilePath)) {
            // 如果存在专属文件，就用它
            this.bot.log(this.bot.isMobile, '搜索-本地词库', `发现账户 ${email} 的专属搜索词文件，正在加载...`);
            filePathToUse = userFilePath;
        } else {
            // 否则，使用通用文件
            this.bot.log(this.bot.isMobile, '搜索-本地词库', `未找到账户 ${email} 的专属搜索词文件，将使用通用热搜词。`);
            filePathToUse = defaultFilePath;
        }

        try {
            if (!fs.existsSync(filePathToUse)) {
                this.bot.log(this.bot.isMobile, '搜索-本地词库', `搜索词文件 ${path.basename(filePathToUse)} 不存在`, 'warn');
                return [];
            }
            const fileContent = fs.readFileSync(filePathToUse, 'utf-8');
            return fileContent.split('\n').map(term => term.trim()).filter(term => term.length > 0);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '搜索-本地词库', `读取搜索词文件时发生错误: ${errorMessage}`, 'error');
            return [];
        }
    }

    private async randomScroll(page: Page) {
        try {
            // 添加更安全的DOM元素检查
            const viewportHeight = await page.evaluate(() => {
                // 检查页面是否完全加载
                if (!document.body || !document.documentElement) {
                    return 0;
                }
                return window.innerHeight || 0;
            });
            
            const totalHeight = await page.evaluate(() => {
                // 检查页面是否完全加载，并提供备用方案
                if (!document.body || !document.documentElement) {
                    return 0;
                }
                // 优先使用documentElement.scrollHeight，如果失败则使用body.scrollHeight
                return document.documentElement.scrollHeight || document.body.scrollHeight || 0;
            });
            
            // 只有在有效高度时才进行滚动
            if (viewportHeight > 0 && totalHeight > viewportHeight) {
                const randomScrollPosition = Math.floor(Math.random() * (totalHeight - viewportHeight));
                await page.evaluate((scrollPos: number) => {
                    if (window && typeof (window as any).scrollTo === 'function') {
                        (window as any).scrollTo(0, scrollPos);
                    }
                }, randomScrollPosition);
                
                this.bot.log(this.bot.isMobile, '搜索-随机滚动', `成功滚动到位置: ${randomScrollPosition}/${totalHeight}`);
            } else {
                this.bot.log(this.bot.isMobile, '搜索-随机滚动', `页面高度不足，跳过滚动 (viewport: ${viewportHeight}, total: ${totalHeight})`);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '搜索-随机滚动', `发生错误: ${errorMessage}`, 'error');
        }
    }

    private async clickRandomLink(page: Page) {
        try {
            // 添加更安全的元素检查
            const resultsContainer = page.locator('#b_results');
            
            // 检查结果容器是否存在
            const isVisible = await resultsContainer.isVisible({ timeout: 3000 }).catch(() => false);
            if (!isVisible) {
                this.bot.log(this.bot.isMobile, '搜索-随机点击', '搜索结果容器不可见，跳过点击');
                return;
            }
            
            const links = resultsContainer.getByRole('link');
            const count = await links.count();
            
            if (count > 0) {
                const clickMaxIndex = Math.min(count, 5);
                const randomIndex = Math.floor(Math.random() * clickMaxIndex);
                
                // [新增] 捕获可能的新开标签页
                const popupPromise = page.waitForEvent('popup', { timeout: 5000 }).catch(() => null);
                let popupOpened = null as null | Page;
                
                // 使用 JS 触发点击，避免 Playwright 为导航自动等待
                const beforeUrl = page.url();
                try {
                    const handle = await links.nth(randomIndex).elementHandle({ timeout: 3000 });
                    if (handle) {
                        await page.evaluate((el) => {
                            (el as HTMLElement).click();
                        }, handle);
                    } else {
                        throw new Error('未获取到可点击的链接句柄');
                    }
                    popupOpened = await popupPromise;
                } catch (clickError) {
                    this.bot.log(this.bot.isMobile, '搜索-随机点击', `点击链接失败: ${clickError}`, 'warn');
                }
                
                // 如果没有弹窗，等待短暂的同页导航或 URL 变化
                if (!popupOpened) {
                    await Promise.race([
                        page.waitForNavigation({ timeout: 4000 }).catch(() => null),
                        page.waitForURL(u => u.toString() !== beforeUrl, { timeout: 4000 }).catch(() => null)
                    ]);
                }
                
                if (popupOpened) {
                    await popupOpened.waitForLoadState('domcontentloaded').catch(() => {});
                    await this.bot.utils.wait(2000);
                    const popupUrl = popupOpened.url();
                    this.bot.log(this.bot.isMobile, '搜索-随机点击', `检测到新标签页: ${popupUrl}，将关闭以节省资源`);
                    await popupOpened.close().catch(() => {});
                    return;
                }
                
                // 若当前页发生了同页跳转，则尝试回退
                await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
                const currentUrl = page.url();
                if (!/bing\.com\/search/i.test(currentUrl)) {
                    this.bot.log(this.bot.isMobile, '搜索-随机点击', `检测到同页跳转至非搜索页: ${currentUrl}，将回退到搜索结果`);
                    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
                }
            } else {
                this.bot.log(this.bot.isMobile, '搜索-随机点击', '未找到可点击的链接');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, '搜索-随机点击', `发生错误: ${errorMessage}`, 'error');
        }
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

    private calculatePoints(counters: Counters) {
        const mobileData = counters.mobileSearch?.[0]
        const genericData = counters.pcSearch?.[0]
        const edgeData = counters.pcSearch?.[1]
        const missingPoints = (this.bot.isMobile && mobileData)
            ? mobileData.pointProgressMax - mobileData.pointProgress
            : (edgeData ? edgeData.pointProgressMax - edgeData.pointProgress : 0)
            + (genericData ? genericData.pointProgressMax - genericData.pointProgress : 0)
        return missingPoints
    }
}
