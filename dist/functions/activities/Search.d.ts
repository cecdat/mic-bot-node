import { Page } from 'rebrowser-playwright';
import { Workers } from '../Workers';
import { DashboardData } from '../../interface/DashboardData';
export declare class Search extends Workers {
    private bingHome;
    doSearch(page: Page, data: DashboardData, email: string): Promise<void>;
    private bingSearch;
    private getLocalSearchWords;
    private randomScroll;
    private clickRandomLink;
    private calculatePoints;
}
//# sourceMappingURL=Search.d.ts.map