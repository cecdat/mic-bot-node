import { BrowserContext, Cookie } from 'rebrowser-playwright';
import { BrowserFingerprintWithHeaders } from 'fingerprint-generator';
import { Account } from '../interface/Account';
import { Config, ConfigSaveFingerprint } from '../interface/Config';
export interface DailyPoints {
    date: string;
    initialPoints: number;
}
export interface NodeConfig {
    cron_schedule: string;
    min_sleep_minutes: number;
    max_sleep_minutes: number;
    clusters: number;
    search_delay_min: string;
    search_delay_max: string;
}
export declare function loadNodeConfig(): Promise<NodeConfig | null>;
export declare function loadAccounts(): Promise<Account[]>;
export declare function loadConfig(): Config;
export declare function loadDailyPoints(sessionPath: string, email: string): Promise<DailyPoints | null>;
export declare function saveDailyPoints(sessionPath: string, email: string, data: DailyPoints): Promise<void>;
export declare function loadSessionData(sessionPath: string, email: string, isMobile: boolean, saveFingerprint: ConfigSaveFingerprint): Promise<{
    cookies: Cookie[];
    fingerprint: BrowserFingerprintWithHeaders;
}>;
export declare function saveSessionData(sessionPath: string, browser: BrowserContext, email: string, isMobile: boolean): Promise<string>;
export declare function saveFingerprintData(sessionPath: string, email: string, isMobile: boolean, fingerpint: BrowserFingerprintWithHeaders): Promise<string>;
//# sourceMappingURL=Load.d.ts.map