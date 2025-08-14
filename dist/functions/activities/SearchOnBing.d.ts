import { Page } from 'rebrowser-playwright';
import { Workers } from '../Workers';
import { MorePromotion, PromotionalItem } from '../../interface/DashboardData';
export declare class SearchOnBing extends Workers {
    doSearchOnBing(page: Page, activity: MorePromotion | PromotionalItem): Promise<void>;
    private getSearchQuery;
    private normalizeString;
}
//# sourceMappingURL=SearchOnBing.d.ts.map