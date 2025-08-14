import { BrowserContext, Page } from 'rebrowser-playwright';
import { CheerioAPI } from 'cheerio';
import { MicrosoftRewardsBot } from '../index';
import { DashboardData, MorePromotion, PromotionalItem } from './../interface/DashboardData';
import { QuizData } from './../interface/QuizData';
import { EarnablePoints } from '../interface/Points';
export default class BrowserFunc {
    private bot;
    constructor(bot: MicrosoftRewardsBot);
    private gotoWithRetry;
    goHome(page: Page): Promise<void>;
    getDashboardData(page: Page): Promise<DashboardData>;
    getBrowserEarnablePoints(data: DashboardData): EarnablePoints;
    getAppEarnablePoints(data: DashboardData, accessToken: string): Promise<{
        readToEarn: number;
        checkIn: number;
        totalEarnablePoints: number;
    }>;
    getQuizData(page: Page): Promise<QuizData>;
    waitForQuizRefresh(page: Page): Promise<boolean>;
    checkQuizCompleted(page: Page): Promise<boolean>;
    loadInCheerio(page: Page): Promise<CheerioAPI>;
    getPunchCardActivity(page: Page, activity: PromotionalItem | MorePromotion): Promise<string>;
    closeBrowser(browser: BrowserContext, email: string): Promise<void>;
}
//# sourceMappingURL=BrowserFunc.d.ts.map