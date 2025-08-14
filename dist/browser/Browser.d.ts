import { Browser as PlaywrightBrowser, BrowserContext } from 'rebrowser-playwright';
import { MicrosoftRewardsBot } from '../index';
import { Account } from '../interface/Account';
declare class Browser {
    private bot;
    constructor(bot: MicrosoftRewardsBot);
    launchBrowser(account: Account): Promise<PlaywrightBrowser>;
    createContext(browser: PlaywrightBrowser, account: Account): Promise<BrowserContext>;
    generateFingerprint(): Promise<import("fingerprint-generator").BrowserFingerprintWithHeaders>;
}
export default Browser;
//# sourceMappingURL=Browser.d.ts.map