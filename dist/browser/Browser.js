"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const rebrowser_playwright_1 = __importDefault(require("rebrowser-playwright"));
const fingerprint_injector_1 = require("fingerprint-injector");
const fingerprint_generator_1 = require("fingerprint-generator");
const Load_1 = require("../util/Load");
const UserAgent_1 = require("../util/UserAgent");
class Browser {
    constructor(bot) {
        this.bot = bot;
    }
    async launchBrowser(account) {
        const proxy = account.proxy;
        const browser = await rebrowser_playwright_1.default.chromium.launch({
            headless: this.bot.config.headless,
            ...(proxy.url && { proxy: { username: proxy.username, password: proxy.password, server: `${proxy.url}:${proxy.port}` } }),
            args: [
                '--no-sandbox',
                '--mute-audio',
                '--disable-setuid-sandbox',
                '--ignore-certificate-errors',
                '--ignore-certificate-errors-spki-list',
                '--ignore-ssl-errors',
                // [新增] 尝试禁用HTTP/2协议，回退到HTTP/1.1，可能会解决协议错误
                '--disable-http2',
                // [新增] 禁用GPU硬件加速，可以减少资源占用并避免一些兼容性问题
                '--disable-gpu'
            ]
        });
        return browser;
    }
    async createContext(browser, account) {
        const email = account.email;
        const sessionData = await (0, Load_1.loadSessionData)(this.bot.config.sessionPath, email, this.bot.isMobile, this.bot.config.saveFingerprint);
        let fingerprint;
        const customUserAgent = this.bot.isMobile ? account.userAgents?.mobile : account.userAgents?.desktop;
        if (customUserAgent && customUserAgent.trim() !== '') {
            this.bot.log(this.bot.isMobile, '浏览器', `[${email}] 检测到自定义User-Agent，将使用该配置。`);
            fingerprint = new fingerprint_generator_1.FingerprintGenerator().getFingerprint({
                devices: this.bot.isMobile ? ['mobile'] : ['desktop'],
                operatingSystems: this.bot.isMobile ? ['android'] : ['windows'],
            });
            fingerprint.fingerprint.navigator.userAgent = customUserAgent;
            fingerprint.headers['user-agent'] = customUserAgent;
        }
        else {
            this.bot.log(this.bot.isMobile, '浏览器', `[${email}] 未配置${this.bot.isMobile ? '移动端' : '桌面端'}自定义User-Agent，将自动生成。`);
            fingerprint = sessionData.fingerprint ? sessionData.fingerprint : await this.generateFingerprint();
        }
        // 设置浏览器语言为中文
        // 使用 newContextOptions 来设置 locale
        const context = await (0, fingerprint_injector_1.newInjectedContext)(browser, {
            fingerprint: fingerprint,
            newContextOptions: { locale: 'zh-CN' }
        });
        context.setDefaultTimeout(this.bot.utils.stringToMs(this.bot.config?.globalTimeout ?? 30000));
        await context.addCookies(sessionData.cookies);
        if (this.bot.config.saveFingerprint) {
            await (0, Load_1.saveFingerprintData)(this.bot.config.sessionPath, email, this.bot.isMobile, fingerprint);
        }
        this.bot.log(this.bot.isMobile, '浏览器', `创建浏览器上下文，User-Agent: "${fingerprint.fingerprint.navigator.userAgent}"`);
        return context;
    }
    async generateFingerprint() {
        const fingerPrintData = new fingerprint_generator_1.FingerprintGenerator().getFingerprint({
            devices: this.bot.isMobile ? ['mobile'] : ['desktop'],
            operatingSystems: this.bot.isMobile ? ['android'] : ['windows'],
            browsers: [{ name: 'edge' }]
        });
        return await (0, UserAgent_1.updateFingerprintUserAgent)(fingerPrintData, this.bot.isMobile);
    }
}
exports.default = Browser;
//# sourceMappingURL=Browser.js.map