import { Page } from 'rebrowser-playwright'

import { Workers } from '../Workers'

export class UrlReward extends Workers {

    async doUrlReward(page: Page, destinationUrl?: string) {
        this.bot.log(this.bot.isMobile, 'URL奖励', '尝试完成URL奖励')

        if (!destinationUrl) {
            this.bot.log(this.bot.isMobile, 'URL奖励', '缺少目标URL，无法完成URL奖励', 'error')
            return
        }

        try {
            // 导航到目标URL
            await page.goto(destinationUrl, { 
                waitUntil: 'domcontentloaded',
                timeout: 15000 
            })

            // 等待页面基本加载
            await this.bot.utils.wait(2000)

            // 检查是否已经完成（URL包含rewards相关）
            const currentUrl = page.url()
            if (currentUrl.includes('rewards.bing.com') || currentUrl.includes('bing.com/rewards')) {
                this.bot.log(this.bot.isMobile, 'URL奖励', '检测到rewards页面，任务可能已完成')
                return
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
                '[data-bi-name*="Rewards"]'
            ]

            let clicked = false
            for (const selector of rewardSelectors) {
                try {
                    const elements = page.locator(selector)
                    const count = await elements.count()
                    
                    for (let i = 0; i < count; i++) {
                        const element = elements.nth(i)
                        if (await element.isVisible({ timeout: 1000 })) {
                            await element.click()
                            this.bot.log(this.bot.isMobile, 'URL奖励', `点击了奖励元素: ${selector}`)
                            clicked = true
                            await this.bot.utils.wait(1000)
                            break
                        }
                    }
                    
                    if (clicked) break
                } catch (error) {
                    // 继续尝试下一个选择器
                }
            }

            if (clicked) {
                this.bot.log(this.bot.isMobile, 'URL奖励', '成功点击奖励元素，任务可能已完成')
            } else {
                this.bot.log(this.bot.isMobile, 'URL奖励', '未找到可点击的奖励元素，任务可能已完成或需要手动处理')
            }

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            this.bot.log(this.bot.isMobile, 'URL奖励', `发生错误: ${errorMessage}`, 'error')
        }
    }
}
