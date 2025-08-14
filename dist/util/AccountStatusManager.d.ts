declare class AccountStatusManager {
    private statusData;
    constructor();
    private loadStatusFile;
    private saveStatusFile;
    recordSuccess(email: string): void;
    recordFailure(email: string): void;
    isFrozen(email: string): boolean;
}
export declare const accountStatusManager: AccountStatusManager;
export {};
//# sourceMappingURL=AccountStatusManager.d.ts.map