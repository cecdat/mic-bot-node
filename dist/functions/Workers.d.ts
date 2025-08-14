import { Page } from 'rebrowser-playwright';
import { DashboardData } from '../interface/DashboardData';
import { UnifiedTask } from '../util/AIOrcestrator';
import { MicrosoftRewardsBot } from '../index';
export declare class Workers {
    bot: MicrosoftRewardsBot;
    constructor(bot: MicrosoftRewardsBot);
    /**
     * [新增] 执行由AI调度器派发的单个任务
     * @param dashboardPage 仪表盘主页面
     * @param task 要执行的单个任务对象
     */
    executeSingleTask(dashboardPage: Page, task: UnifiedTask): Promise<void>;
    private routeTaskToSolver;
    doPunchCard(page: Page, data: DashboardData): Promise<void>;
}
//# sourceMappingURL=Workers.d.ts.map