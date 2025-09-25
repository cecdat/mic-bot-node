import { BrowserContext, Page } from 'rebrowser-playwright'
import { CheerioAPI, load } from 'cheerio'
import { AxiosRequestConfig } from 'axios'

import { MicrosoftRewardsBot } from '../index'
import { saveSessionData } from '../util/Load'

import { DashboardData, MorePromotion, PromotionalItem } from './../interface/DashboardData'
import { QuizData } from './../interface/QuizData'
import { AppUserData } from '../interface/AppUserData'
import { EarnablePoints } from '../interface/Points'

export default class BrowserFunc {
    private bot: MicrosoftRewardsBot

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot
    }
    
    private async gotoWithRetry(page: Page, url: string, retries = 3) {
        for (let i = 0; i < retries; i++) {
            try {
                const navigationTimeoutMs = this.bot.utils.stringToMs(this.bot.config.navigationTimeout);
                await page.goto(url, { timeout: navigationTimeoutMs, waitUntil: 'domcontentloaded' });
                
                // 检查是否出现 chrome-error 页面
                const currentUrl = page.url();
                if (currentUrl.includes('chrome-error://') || currentUrl.includes('chromewebdata')) {
                    this.bot.log(this.bot.isMobile, '页面导航', `检测到 chrome-error 页面: ${currentUrl}，尝试清理缓存并重试`, 'warn');
                    await this.clearPageCache(page);
                    if (i < retries - 1) {
                        await this.bot.utils.wait(2000);
                        continue;
                    }
                }
                
                return; 
            } catch (error) {
                this.bot.log(this.bot.isMobile, '页面导航', `导航到 ${url} 失败，尝试次数 ${i + 1}/${retries}。错误: ${error}`, 'warn');
                if (i === retries - 1) {
                    throw error;
                }
                await this.bot.utils.wait(3000);
            }
        }
    }

    async goHome(page: Page) {
        try {
            const dashboardURL = new URL(this.bot.config.baseURL)
            if (page.url() === dashboardURL.href) return;
            await this.gotoWithRetry(page, this.bot.config.baseURL);
        } catch (error) {
            throw this.bot.log(this.bot.isMobile, '访问主页', `发生错误: ${error}`, 'error');
        }
    }

    async getDashboardData(page: Page): Promise<DashboardData> {
        try {
            this.bot.log(this.bot.isMobile, '仪表板数据', '正在获取最新的仪表板数据...');
            await this.gotoWithRetry(page, this.bot.config.baseURL);

            // 等待页面加载完成，增加超时时间并添加重试机制
            let loadSuccess = false;
            let retryCount = 0;
            const maxRetries = 3;
            
            while (!loadSuccess && retryCount < maxRetries) {
                try {
                    await page.waitForLoadState('networkidle', { timeout: 30000 });
                    loadSuccess = true;
                    this.bot.log(this.bot.isMobile, '仪表板数据', '页面加载完成');
                } catch (error) {
                    retryCount++;
                    this.bot.log(this.bot.isMobile, '仪表板数据', `页面加载超时 (${retryCount}/${maxRetries}): ${error}`, 'warn');
                    
                    if (retryCount < maxRetries) {
                        this.bot.log(this.bot.isMobile, '仪表板数据', '尝试刷新页面...');
                        await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
                        await page.waitForTimeout(2000);
                    }
                }
            }
            
            if (!loadSuccess) {
                throw new Error(`页面加载失败，已重试${maxRetries}次`);
            }

            // 移动端需要更长的等待时间和不同的脚本查找策略
            const waitTime = this.bot.isMobile ? 5000 : 3000;
            const maxScriptRetries = this.bot.isMobile ? 5 : 3;
            
            let scriptContent = null;
            let scriptRetryCount = 0;
            
            while (!scriptContent && scriptRetryCount < maxScriptRetries) {
                scriptContent = await page.evaluate(() => {
                    const scripts = Array.from(document.querySelectorAll('script'));
                    // 尝试多种脚本查找模式
                    const patterns = [
                        'var dashboard',
                        'window.dashboard',
                        'dashboard =',
                        'userStatus',
                        'availablePoints'
                    ];
                    
                    for (const pattern of patterns) {
                        const targetScript = scripts.find(script => 
                            script.innerText && script.innerText.includes(pattern)
                        );
                        if (targetScript) {
                            return targetScript.innerText;
                        }
                    }
                    return null;
                });
                
                if (!scriptContent) {
                    scriptRetryCount++;
                    this.bot.log(this.bot.isMobile, '仪表板数据', `未找到仪表板脚本 (${scriptRetryCount}/${maxScriptRetries})，等待${waitTime/1000}秒后重试...`, 'warn');
                    
                    if (scriptRetryCount < maxScriptRetries) {
                        await page.waitForTimeout(waitTime);
                        
                        // 尝试刷新页面（仅移动端）
                        if (this.bot.isMobile && scriptRetryCount === 2) {
                            this.bot.log(this.bot.isMobile, '仪表板数据', '移动端页面刷新...');
                            await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
                            await page.waitForTimeout(3000);
                        }
                    }
                }
            }
            
            if (!scriptContent) {
                throw new Error(`在脚本中未找到仪表板数据，页面可能未完全加载（已重试${maxScriptRetries}次）`);
            }

            const dashboardData = await page.evaluate(scriptContent => {
                // 尝试多种正则表达式模式来解析仪表板数据
                const patterns = [
                    /var dashboard = (\{.*?\});/s,
                    /window\.dashboard = (\{.*?\});/s,
                    /dashboard = (\{.*?\});/s,
                    /const dashboard = (\{.*?\});/s,
                    /let dashboard = (\{.*?\});/s
                ];
                
                for (const pattern of patterns) {
                    const match = pattern.exec(scriptContent);
                    if (match && match[1]) {
                        try {
                            return JSON.parse(match[1]);
                        } catch (e) {
                            continue; // 尝试下一个模式
                        }
                    }
                }
                
                // 如果正则表达式失败，尝试直接查找JSON对象
                try {
                    const jsonMatch = scriptContent.match(/\{.*"userStatus".*\}/s);
                    if (jsonMatch) {
                        return JSON.parse(jsonMatch[0]);
                    }
                } catch (e) {
                    // 忽略解析错误
                }
                
                return null;
            }, scriptContent);

            if (!dashboardData) {
                this.bot.log(this.bot.isMobile, '仪表板数据', '无法解析仪表板脚本，尝试备用方法...', 'warn');
                
                // 备用方法：直接尝试从页面获取数据
                try {
                    const fallbackData = await page.evaluate(() => {
                        // 尝试从全局变量获取数据
                        if ((window as any).dashboard) {
                            return (window as any).dashboard;
                        }
                        
                        // 尝试从其他可能的全局变量获取
                        if ((window as any).userStatus) {
                            return { userStatus: (window as any).userStatus };
                        }
                        
                        return null;
                    });
                    
                    if (fallbackData) {
                        this.bot.log(this.bot.isMobile, '仪表板数据', '使用备用方法成功获取仪表板数据');
                        return fallbackData;
                    }
                } catch (e) {
                    this.bot.log(this.bot.isMobile, '仪表板数据', `备用方法也失败: ${e}`, 'warn');
                }
                
                throw new Error('无法解析仪表板脚本，所有方法都失败');
            }
            
            // 验证关键数据是否存在
            if (!dashboardData.userStatus || !dashboardData.userStatus.availablePoints) {
                this.bot.log(this.bot.isMobile, '仪表板数据', '仪表板数据不完整，缺少用户状态信息', 'warn');
                throw new Error('仪表板数据不完整，缺少用户状态信息');
            }
            
            this.bot.log(this.bot.isMobile, '仪表板数据', `成功获取仪表板数据，当前积分: ${dashboardData.userStatus.availablePoints}`);
            return dashboardData;
        } catch (error) {
            const errorMessage = `获取仪表板数据时出错: ${error}`;
            this.bot.log(this.bot.isMobile, '获取仪表板数据', errorMessage, 'error');
            throw new Error(errorMessage);
        }
    }

    getBrowserEarnablePoints(data: DashboardData): EarnablePoints {
        let desktopSearchPoints = 0, mobileSearchPoints = 0, dailySetPoints = 0, morePromotionsPoints = 0;
        if (data.userStatus.counters.pcSearch?.length) data.userStatus.counters.pcSearch.forEach(x => desktopSearchPoints += (x.pointProgressMax - x.pointProgress));
        if (data.userStatus.counters.mobileSearch?.length) data.userStatus.counters.mobileSearch.forEach(x => mobileSearchPoints += (x.pointProgressMax - x.pointProgress));
        data.dailySetPromotions[this.bot.utils.getFormattedDate()]?.forEach(x => dailySetPoints += (x.pointProgressMax - x.pointProgress));
        if (data.morePromotions?.length) data.morePromotions.forEach(x => {
            if (['quiz', 'urlreward'].includes(x.promotionType) && x.exclusiveLockedFeatureStatus !== 'locked') morePromotionsPoints += (x.pointProgressMax - x.pointProgress);
        });
        const totalEarnablePoints = desktopSearchPoints + mobileSearchPoints + dailySetPoints + morePromotionsPoints;
        return { dailySetPoints, morePromotionsPoints, desktopSearchPoints, mobileSearchPoints, totalEarnablePoints };
    }

    async getAppEarnablePoints(data: DashboardData, accessToken: string) {
        try {
            const points = { readToEarn: 0, checkIn: 0, totalEarnablePoints: 0 };
            const eligibleOffers = ['ENUS_readarticle3_30points', 'Gamification_Sapphire_DailyCheckIn'];
            let geoLocale = data.userProfile.attributes.country;
            
            // 增加安全检查，确保searchSettings存在
            const useGeoLocaleQueries = this.bot.config.searchSettings?.useGeoLocaleQueries ?? true;
            geoLocale = (useGeoLocaleQueries && geoLocale.length === 2) ? geoLocale.toLowerCase() : 'us';
            
            const userDataRequest: AxiosRequestConfig = {
                url: 'https://prod.rewardsplatform.microsoft.com/dapi/me?channel=SAAndroid&options=613',
                method: 'GET',
                headers: { 'Authorization': `Bearer ${accessToken}`, 'X-Rewards-Country': geoLocale, 'X-Rewards-Language': 'en' }
            };
            const userDataResponse: AppUserData = (await this.bot.axios.request(userDataRequest)).data;
            const userData = userDataResponse.response;
            const eligibleActivities = userData.promotions.filter((x) => eligibleOffers.includes(x.attributes.offerid ?? ''));
            for (const item of eligibleActivities) {
                if (item.attributes.type === 'msnreadearn') {
                    points.readToEarn = parseInt(item.attributes.pointmax ?? '0') - parseInt(item.attributes.pointprogress ?? '0');
                } else if (item.attributes.type === 'checkin') {
                    const checkInDay = parseInt(item.attributes.progress ?? '0') % 7;
                    const today = new Date().getDate();
                    const lastUpdated = new Date(item.attributes.last_updated ?? '').getDate();
                    
                    // 修复签到积分检测逻辑：
                    // 1. 如果今天还没签到（last_updated不是今天），且还有可签到的天数，则显示可获得的积分
                    // 2. 如果今天已经签到（last_updated是今天），则显示已获得的积分
                    if (checkInDay < 6) {
                        if (today != lastUpdated) {
                            // 今天还没签到，显示可获得的积分
                            points.checkIn = parseInt(item.attributes['day_' + (checkInDay + 1) + '_points'] ?? '0');
                        } else {
                            // 今天已经签到，显示已获得的积分
                            points.checkIn = parseInt(item.attributes['day_' + checkInDay + '_points'] ?? '0');
                        }
                    }
                }
            }
            points.totalEarnablePoints = points.readToEarn + points.checkIn;
            return points;
        } catch (error) {
            throw this.bot.log(this.bot.isMobile, '获取APP可赚取点数', `发生错误: ${error}`, 'error');
        }
    }
    
    async getQuizData(page: Page): Promise<QuizData> {
        try {
            const html = await page.content()
            const $ = load(html)
            const scriptContent = $('script').filter((_, element) => $(element).text().includes('_w.rewardsQuizRenderInfo')).text()
            if (scriptContent) {
                const match = /_w\.rewardsQuizRenderInfo\s*=\s*({.*?});/s.exec(scriptContent);
                if (match?.[1]) return JSON.parse(match[1]);
            }
            throw new Error('未找到或无法解析测验数据');
        } catch (error) {
            throw this.bot.log(this.bot.isMobile, '获取测验数据', `发生错误: ${error}`, 'error');
        }
    }

    async waitForQuizRefresh(page: Page): Promise<boolean> {
        try {
            await page.waitForSelector('span.rqMCredits', { state: 'visible', timeout: 10000 })
            await this.bot.utils.wait(2000)
            return true
        } catch (error) {
            this.bot.log(this.bot.isMobile, '测验刷新', `发生错误: ${error}`, 'error')
            return false
        }
    }

    async checkQuizCompleted(page: Page): Promise<boolean> {
        try {
            await page.waitForSelector('#quizCompleteContainer', { state: 'visible', timeout: 2000 })
            await this.bot.utils.wait(2000)
            return true
        } catch (error) {
            return false
        }
    }

    async loadInCheerio(page: Page): Promise<CheerioAPI> {
        const html = await page.content()
        return load(html)
    }

    async getPunchCardActivity(page: Page, activity: PromotionalItem | MorePromotion): Promise<string> {
        let selector = ''
        try {
            const html = await page.content()
            const $ = load(html)
            const element = $('.offer-cta').toArray().find(x => x.attribs.href?.includes(activity.offerId))
            if (element) {
                selector = `a[href*="${element.attribs.href}"]`
            }
        } catch (error) {
            this.bot.log(this.bot.isMobile, '获取打卡活动', `发生错误: ${error}`, 'error')
        }
        return selector
    }

    /**
     * 清理页面缓存和存储数据
     */
    async clearPageCache(page: Page) {
        try {
            this.bot.log(this.bot.isMobile, '缓存清理', '开始清理页面缓存和存储数据...');
            
            const cacheConfig = this.bot.config.cacheManagement;
            
            // 清理页面级别的存储
            await page.evaluate(() => {
                try {
                    // 清理 localStorage
                    if (typeof localStorage !== 'undefined') {
                        localStorage.clear();
                    }
                    // 清理 sessionStorage
                    if (typeof sessionStorage !== 'undefined') {
                        sessionStorage.clear();
                    }
                    // 清理 IndexedDB
                    if (typeof indexedDB !== 'undefined') {
                        indexedDB.databases().then(databases => {
                            databases.forEach(db => {
                                if (db.name) {
                                    indexedDB.deleteDatabase(db.name);
                                }
                            });
                        }).catch(() => {
                            // 忽略 IndexedDB 清理错误
                        });
                    }
                    // 清理 WebSQL (如果存在)
                    if (typeof openDatabase !== 'undefined') {
                        // WebSQL 已废弃，但为了兼容性保留
                    }
                    // 清理 Cache API
                    if (typeof caches !== 'undefined') {
                        caches.keys().then(cacheNames => {
                            cacheNames.forEach(cacheName => {
                                caches.delete(cacheName);
                            });
                        }).catch(() => {
                            // 忽略 Cache API 清理错误
                        });
                    }
                } catch (error) {
                    console.warn('清理页面存储时出现错误:', error);
                }
            });
            
            // 清理浏览器上下文级别的数据
            const context = page.context();
            try {
                if (cacheConfig?.clearCookies !== false) {
                    await context.clearCookies();
                }
                if (cacheConfig?.clearPermissions !== false) {
                    await context.clearPermissions();
                }
            } catch (error) {
                this.bot.log(this.bot.isMobile, '缓存清理', `清理上下文数据时出现错误: ${error}`, 'warn');
            }
            
            this.bot.log(this.bot.isMobile, '缓存清理', '页面缓存和存储数据清理完成');
        } catch (error) {
            this.bot.log(this.bot.isMobile, '缓存清理', `清理页面缓存时出现错误: ${error}`, 'warn');
        }
    }

    /**
     * 检测并处理 chrome-error 页面
     */
    async handleChromeError(page: Page, originalUrl: string): Promise<boolean> {
        try {
            const currentUrl = page.url();
            if (currentUrl.includes('chrome-error://') || currentUrl.includes('chromewebdata')) {
                this.bot.log(this.bot.isMobile, '错误处理', `检测到 chrome-error 页面: ${currentUrl}，尝试恢复...`);
                
                const cacheConfig = this.bot.config.cacheManagement;
                
                // 根据配置决定是否自动清理缓存
                if (cacheConfig?.autoClearOnChromeError !== false) {
                    // 清理缓存
                    await this.clearPageCache(page);
                    
                    // 等待一段时间
                    await this.bot.utils.wait(3000);
                } else {
                    this.bot.log(this.bot.isMobile, '错误处理', '配置禁用了自动缓存清理，跳过清理步骤');
                }
                
                // 尝试重新导航到原始URL
                try {
                    await page.goto(originalUrl, { 
                        waitUntil: 'domcontentloaded', 
                        timeout: 30000 
                    });
                    
                    // 检查是否成功恢复
                    const newUrl = page.url();
                    if (!newUrl.includes('chrome-error://') && !newUrl.includes('chromewebdata')) {
                        this.bot.log(this.bot.isMobile, '错误处理', `成功从 chrome-error 页面恢复，当前URL: ${newUrl}`);
                        return true;
                    } else {
                        this.bot.log(this.bot.isMobile, '错误处理', `恢复失败，仍然在错误页面: ${newUrl}`, 'warn');
                        return false;
                    }
                } catch (error) {
                    this.bot.log(this.bot.isMobile, '错误处理', `重新导航失败: ${error}`, 'warn');
                    return false;
                }
            }
            return true; // 没有检测到错误页面
        } catch (error) {
            this.bot.log(this.bot.isMobile, '错误处理', `处理 chrome-error 时出现异常: ${error}`, 'error');
            return false;
        }
    }

    async closeBrowser(browser: BrowserContext, email: string) {
        try {
            await saveSessionData(this.bot.config.sessionPath, browser, email, this.bot.isMobile)
            await this.bot.utils.wait(2000)
            await browser.close()
            this.bot.log(this.bot.isMobile, '关闭浏览器', '浏览器已干净地关闭！')
        } catch (error) {
            throw this.bot.log(this.bot.isMobile, '关闭浏览器', `发生错误: ${error}`, 'error')
        }
    }
}
