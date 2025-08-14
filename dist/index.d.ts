import { Page } from 'rebrowser-playwright';
import BrowserFunc from './browser/BrowserFunc';
import BrowserUtil from './browser/BrowserUtil';
import { log } from './util/Logger';
import Util from './util/Utils';
import Activities from './functions/Activities';
import { Account } from './interface/Account';
import Axios from './util/Axios';
import { Config } from './interface/Config';
export declare class MicrosoftRewardsBot {
    log: typeof log;
    config: Config;
    utils: Util;
    activities: Activities;
    browser: {
        func: BrowserFunc;
        utils: BrowserUtil;
    };
    checkStopStatus: () => boolean;
    isMobile: boolean;
    homePage: Page;
    private browserFactory;
    private workers;
    private login;
    private accessToken;
    axios: Axios;
    accountStatus: string;
    account: Account;
    sendStatusUpdate: (type: 'pc' | 'mobile', status: boolean, code: number, message: string) => Promise<void>;
    constructor();
    private Desktop;
    private Mobile;
    runFor(account: Account): Promise<void>;
}
//# sourceMappingURL=index.d.ts.map