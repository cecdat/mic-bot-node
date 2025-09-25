import playwright, { Browser as PlaywrightBrowser, BrowserContext } from 'rebrowser-playwright'
import { newInjectedContext } from 'fingerprint-injector'
import { FingerprintGenerator } from 'fingerprint-generator'
import { MicrosoftRewardsBot } from '../index'
import { loadSessionData, saveFingerprintData } from '../util/Load'
import { updateFingerprintUserAgent } from '../util/UserAgent'
import { Account } from '../interface/Account'

class Browser {
    private bot: MicrosoftRewardsBot

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot
    }

    async launchBrowser(account: Account): Promise<PlaywrightBrowser> {
        const browser = await playwright.chromium.launch({
            headless: this.bot.config.headless,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--use-fake-ui-for-media-stream',
                '--use-fake-device-for-media-stream',
                '--allow-running-insecure-content',
                '--disable-web-security',
                '--disable-features=VizDisplayCompositor',
                // 中文环境设置
                '--lang=zh-CN',
                '--accept-lang=zh-CN,zh,en-US,en',
                '--disable-translate',
                '--disable-ipc-flooding-protection',
                // 缓存清理相关参数
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                '--disable-background-networking',
                '--disable-default-apps',
                '--disable-extensions',
                '--disable-sync',
                '--disable-plugins',
                '--disable-plugins-discovery',
                '--disable-preconnect',
                '--disable-hang-monitor',
                '--disable-prompt-on-repost',
                '--disable-domain-reliability',
                '--disable-component-extensions-with-background-pages',
                '--disable-background-downloads',
                '--disable-client-side-phishing-detection',
                '--disable-component-update',
                '--disable-features=TranslateUI,BlinkGenPropertyTrees',
                '--disable-ipc-flooding-protection',
                '--disable-logging',
                '--disable-permissions-api',
                '--disable-popup-blocking',
                '--disable-prompt-on-repost',
                '--disable-sync-preferences',
                '--disable-web-resources',
                '--disable-features=VizDisplayCompositor,TranslateUI',
                '--aggressive-cache-discard',
                '--memory-pressure-off',
                '--max_old_space_size=4096',
                // 移动端特殊参数：模拟Bing客户端
                ...(this.bot.isMobile ? [
                    '--user-agent="Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 BingApp/1.0"',
                    '--touch-events=enabled',
                    '--enable-touch-drag-drop',
                    '--enable-features=TouchEventFeature',
                    '--disable-features=TranslateUI',
                    '--force-device-scale-factor=3',
                    '--device-scale-factor=3',
                    '--high-dpi-support=1',
                    '--force-prefers-reduced-motion',
                    '--enable-low-end-device-mode'
                ] : [])
            ]
        });
        
        if (this.bot.isMobile) {
            this.bot.log(this.bot.isMobile, '浏览器', '移动端浏览器已启动，启用Bing客户端模拟模式');
        }
        
        return browser;
    }

    async createContext(browser: PlaywrightBrowser, account: Account): Promise<BrowserContext> {
        const email = account.email;
        const sessionData = await loadSessionData(this.bot.config.sessionPath, email, this.bot.isMobile, this.bot.config.saveFingerprint);

        let fingerprint;
        const customUserAgent = this.bot.isMobile ? account.userAgents?.mobile : account.userAgents?.desktop;

        if (customUserAgent && customUserAgent.trim() !== '') {
            this.bot.log(this.bot.isMobile, '浏览器', `[${email}] 检测到自定义User-Agent: ${customUserAgent}`);
            fingerprint = new FingerprintGenerator().getFingerprint({
                devices: this.bot.isMobile ? ['mobile'] : ['desktop'],
                operatingSystems: this.bot.isMobile ? ['android'] : ['windows'],
            });
            fingerprint.fingerprint.navigator.userAgent = customUserAgent;
            fingerprint.headers['user-agent'] = customUserAgent;
        } else {
            this.bot.log(this.bot.isMobile, '浏览器', `[${email}] 未配置${this.bot.isMobile ? '移动端' : '桌面端'}自定义User-Agent，将自动生成。`);
            fingerprint = sessionData.fingerprint ? sessionData.fingerprint : await this.generateFingerprint();
        }

        // 设置浏览器语言为中文
        // 使用 newContextOptions 来设置 locale 和录像选项
        const newContextOptions: any = {
            locale: 'zh-CN',
            timezoneId: 'Asia/Shanghai',
            geolocation: { latitude: 39.9042, longitude: 116.4074 }, // 北京坐标
            permissions: ['geolocation'],
            extraHTTPHeaders: {
                'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7'
            }
        };

        // 屏幕录像功能已禁用（根据配置）

        // 根据配置决定是否启用HAR记录
        if (this.bot.config.recording?.enableHar) {
            newContextOptions.recordHar = {
                path: `${this.bot.config.recording.videoDir || 'sessions/task_videos'}/har.json`
            };
        }

        const context = await newInjectedContext(browser, { 
            fingerprint: fingerprint,
            newContextOptions: newContextOptions
        });
        
        // 屏幕录像功能已禁用（根据配置）
        
        // 移动端特殊配置：模拟Bing客户端
        if (this.bot.isMobile) {
            // 设置移动设备视口
            await context.addInitScript(() => {
                // 模拟触摸事件支持
                Object.defineProperty(navigator, 'maxTouchPoints', {
                    get: () => 5
                });
                
                // 模拟移动设备特性
                Object.defineProperty(navigator, 'platform', {
                    get: () => 'iPhone'
                });
                
                // 模拟Bing应用标识
                Object.defineProperty(navigator, 'appName', {
                    get: () => 'BingApp'
                });
                
                // 模拟触摸事件
                if (typeof TouchEvent === 'undefined') {
                    (window as any).TouchEvent = class TouchEvent extends Event {
                        touches: TouchList;
                        targetTouches: TouchList;
                        changedTouches: TouchList;
                        
                        constructor(type: string, init?: TouchEventInit) {
                            super(type, init);
                            this.touches = new TouchList();
                            this.targetTouches = new TouchList();
                            this.changedTouches = new TouchList();
                        }
                    };
                }
                
                // 模拟TouchList
                if (typeof TouchList === 'undefined') {
                    (window as any).TouchList = class TouchList extends Array {
                        item(index: number): Touch | null {
                            return this[index] || null;
                        }
                    };
                }
                
                // 模拟Touch对象
                if (typeof Touch === 'undefined') {
                    (window as any).Touch = class Touch {
                        identifier: number;
                        target: EventTarget;
                        clientX: number;
                        clientY: number;
                        pageX: number;
                        pageY: number;
                        radiusX: number;
                        radiusY: number;
                        rotationAngle: number;
                        force: number;
                        
                        constructor(init: TouchInit) {
                            this.identifier = init.identifier || 0;
                            this.target = init.target;
                            this.clientX = init.clientX || 0;
                            this.clientY = init.clientY || 0;
                            this.pageX = init.pageX || 0;
                            this.pageY = init.pageY || 0;
                            this.radiusX = init.radiusX || 0;
                            this.radiusY = init.radiusY || 0;
                            this.rotationAngle = init.rotationAngle || 0;
                            this.force = init.force || 0;
                        }
                    };
                }
            });
            
            this.bot.log(this.bot.isMobile, '浏览器', '已启用Bing移动客户端模拟模式');
        }

        context.setDefaultTimeout(this.bot.utils.stringToMs(this.bot.config?.globalTimeout ?? 30000));
        await context.addCookies(sessionData.cookies);

        // 根据配置清理浏览器缓存和存储
        const cacheConfig = this.bot.config.cacheManagement;
        if (cacheConfig?.clearCacheOnStart) {
            try {
                const pages = context.pages();
                for (const page of pages) {
                    try {
                        // 清理页面缓存
                        await page.evaluate(() => {
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
                        });
                    } catch (error) {
                        // 忽略页面缓存清理错误
                    }
                }
                
                // 清理浏览器上下文缓存
                if (cacheConfig.clearCookies) {
                    await context.clearCookies();
                }
                if (cacheConfig.clearPermissions) {
                    await context.clearPermissions();
                }
                
                this.bot.log(this.bot.isMobile, '浏览器', `[${email}] 已根据配置清理浏览器缓存和存储数据`);
            } catch (error) {
                this.bot.log(this.bot.isMobile, '浏览器', `[${email}] 清理浏览器缓存时出现错误: ${error}`, 'warn');
            }
        }

        if (this.bot.config.saveFingerprint) {
            await saveFingerprintData(this.bot.config.sessionPath, email, this.bot.isMobile, fingerprint);
        }

        this.bot.log(this.bot.isMobile, '浏览器', `创建浏览器上下文，User-Agent: "${fingerprint.fingerprint.navigator.userAgent}"`);
        // 屏幕录像功能已禁用（根据配置）

        return context as BrowserContext;
    }

    async generateFingerprint() {
        const fingerPrintData = new FingerprintGenerator().getFingerprint({
            devices: this.bot.isMobile ? ['mobile'] : ['desktop'],
            operatingSystems: this.bot.isMobile ? ['android'] : ['windows'],
            browsers: [{ name: 'edge' }]
        });
        return await updateFingerprintUserAgent(fingerPrintData, this.bot.isMobile);
    }
}

export default Browser;
