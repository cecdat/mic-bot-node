import { Page } from 'rebrowser-playwright';
import { MicrosoftRewardsBot } from '../index';
export default class BrowserUtil {
    private bot;
    constructor(bot: MicrosoftRewardsBot);
    /**
     * [最终修正] 增强弹窗处理能力
     * @param page
     */
    tryDismissAllMessages(page: Page): Promise<void>;
    getLatestTab(page: Page): Promise<Page>;
    getTabs(page: Page): Promise<{
        homeTab: Page;
        workerTab: Page;
    }>;
    reloadBadPage(page: Page): Promise<void>;
}
//# sourceMappingURL=BrowserUtil.d.ts.map