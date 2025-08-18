import { Page } from 'rebrowser-playwright'
import { load } from 'cheerio'

import { MicrosoftRewardsBot } from '../index'


export default class BrowserUtil {
    private bot: MicrosoftRewardsBot

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot
    }

    /**
     * [最终修正] 增强弹窗处理能力
     * @param page
     */
    async tryDismissAllMessages(page: Page): Promise<void> {
        const buttons = [
            // [新增] 专门用来关闭拦截任务点击的弹窗
            { selector: '#popUpModal [aria-label="Close"]', label: '主要弹窗关闭按钮 (Aria Label)' },
            { selector: '#popUpModal .rw_icon_close', label: '主要弹窗关闭按钮 (Icon)' },
            { selector: '#bnp_btn_accept', label: '必应Cookie横幅' },
            { selector: '#reward_pivot_earn', label: '奖励优惠券接受' },
            { selector: '#acceptButton', label: '通用接受按钮' },
            { selector: '.c-glyph.glyph-cancel', label: '移动端欢迎按钮' },
            { selector: '.maybe-later', label: '移动端App推广横幅' },
            { selector: '#iNext', label: 'iNext' },
            { selector: '#iLooksGood', label: 'iLooksGood' },
            { selector: '#idSIButton9', label: 'idSIButton9' }
        ]

        for (const button of buttons) {
            try {
                const element = page.locator(button.selector).first();
                await element.click({ timeout: 1500 }); // 使用较短的超时，避免卡住
                await page.waitForTimeout(500);
                this.bot.log(this.bot.isMobile, '关闭消息', `成功关闭了: ${button.label}`);
            } catch (error) {
                // 静默失败，因为这些元素不一定总会出现
            }
        }
    }

    public async getLatestTab(currentPage: Page): Promise<Page> {
        // 检查页面是否已关闭
        if (currentPage.isClosed()) {
            throw new Error('当前页面已关闭，无法获取最新标签页');
        }

        const pages = currentPage.context().pages();
        
        // 过滤掉已关闭的页面
        const activePages = pages.filter(page => !page.isClosed());
        
        if (activePages.length === 0) {
            throw new Error('没有可用的活动页面');
        }
        
        const newTab = activePages[activePages.length - 1];
        
        // 确保newTab不为undefined
        if (!newTab) {
            throw new Error('无法获取有效的标签页');
        }
        
        // 最终检查新标签页是否有效
        if (newTab.isClosed()) {
            throw new Error('获取到的新标签页已关闭');
        }
        
        return newTab;
    }

    async getTabs(page: Page) {
        try {
            const browser = page.context()
            const pages = browser.pages()

            const homeTab = pages[1]
            let homeTabURL: URL

            if (!homeTab) {
                const errorMsg = '找不到主页标签！';
                await this.bot.log(this.bot.isMobile, '获取标签页', errorMsg, 'error');
                throw new Error(errorMsg);
            } else {
                homeTabURL = new URL(homeTab.url())
                if (homeTabURL.hostname !== 'rewards.bing.com') {
                    const errorMsg = '奖励页面主机名无效: ' + homeTabURL.host;
                    await this.bot.log(this.bot.isMobile, '获取标签页', errorMsg, 'error');
                    throw new Error(errorMsg);
                }
            }

            const workerTab = pages[2]
            if (!workerTab) {
                const errorMsg = '找不到工作标签！';
                await this.bot.log(this.bot.isMobile, '获取标签页', errorMsg, 'error');
                throw new Error(errorMsg);
            }

            return {
                homeTab: homeTab,
                workerTab: workerTab
            }
        } catch (error) {
            const errorMsg = `获取标签页时发生错误: ${error instanceof Error ? error.message : String(error)}`;
            await this.bot.log(this.bot.isMobile, '获取标签页', errorMsg, 'error');
            throw new Error(errorMsg);
        }
    }

    async reloadBadPage(page: Page): Promise<void> {
        try {
            const html = await page.content().catch(() => '')
            const $ = load(html)
            const isNetworkError = $('body.neterror').length
            if (isNetworkError) {
                this.bot.log(this.bot.isMobile, '重新加载坏页', '检测到坏页，正在重新加载！')
                await page.reload()
            }
        } catch (error) {
            const errorMsg = `重新加载坏页时发生错误: ${error instanceof Error ? error.message : String(error)}`;
            await this.bot.log(this.bot.isMobile, '重新加载坏页', errorMsg, 'error');
            throw new Error(errorMsg);
        }
    }
}
