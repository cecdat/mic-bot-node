import { MorePromotion, PromotionalItem, DashboardData } from '../interface/DashboardData';
export type UnifiedTask = MorePromotion | PromotionalItem;
declare class AIOrcestrator {
    private utils;
    /**
     * 从 dashboardData 中提取所有未完成的任务
     * @param data 仪表板数据
     * @returns 一个包含所有可执行任务的统一列表
     */
    getAllIncompleteTasks(data: DashboardData): UnifiedTask[];
    /**
     * 调用AI，获取最优的任务执行计划
     * @param tasks 未排序的任务列表
     * @returns 一个经过AI优化排序的任务列表
     */
    getTaskExecutionPlan(tasks: UnifiedTask[]): Promise<UnifiedTask[]>;
}
export declare const aiOrchestrator: AIOrcestrator;
export {};
//# sourceMappingURL=AIOrcestrator.d.ts.map