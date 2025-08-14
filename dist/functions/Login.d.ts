import { Page } from 'rebrowser-playwright';
import { MicrosoftRewardsBot } from '../index';
export declare const LoginStatusCode: {
    Success: number;
    PasswordError: number;
    Locked: number;
    VerificationRequired: number;
    AuthorizationRequired: number;
    GenericFailure: number;
};
export declare class Login {
    private bot;
    constructor(bot: MicrosoftRewardsBot);
    private gotoWithRetry;
    login(page: Page, email: string, password: string): Promise<void>;
    private execLogin;
    private enterEmail;
    private enterPassword;
    private handle2FA;
    private get2FACode;
    private authAppVerification;
    getMobileAccessToken(page: Page, email: string): Promise<string>;
    private checkLoggedIn;
    private dismissLoginMessages;
    private handleVerifyEmailPage;
    /**
     * 处理其他类型的验证页面
     */
    private handleOtherVerificationPages;
    private saveSnapshot;
    private checkAccountLocked;
}
//# sourceMappingURL=Login.d.ts.map