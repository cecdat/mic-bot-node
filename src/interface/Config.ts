export interface ConfigApiServer {
    enabled: boolean;
    updateUrl: string;
    token: string;
    nodeName: string;
    heartbeatInterval?: string | number;
    heartbeatTimeout?: string | number;
}

export interface ConfigHotSearchApi {
    enabled: boolean;
    baseUrl: string;
}



export interface ConfigLogPush {
    enabled: boolean;
    serverUrl: string;
    token: string;
    interval: number; // 推送间隔（秒）
}

export interface ConfigSearchDelay {
    min: number | string;
    max: number | string;
}

export interface ConfigSearchSettings {
    useGeoLocaleQueries: boolean;
    scrollRandomResults: boolean;
    clickRandomResults: boolean;
    searchDelay: ConfigSearchDelay;
    retryMobileSearchAmount: number;
}

export interface ConfigWebhook {
    enabled: boolean;
    url: string;
}

export interface ConfigSnapshots {
    // 登录流程相关快照（HTML/PNG）
    login: boolean;
    // 任务执行相关快照（HTML/PNG）
    taskExecution?: boolean;
}

export interface ConfigDebugOptions {
    // 是否保存任务调试信息
    saveTaskDebugInfo?: boolean;
    // 是否保存任务截图
    saveTaskScreenshots?: boolean;
    // 是否保存任务HTML
    saveTaskHtml?: boolean;
    // 是否记录任务详细信息
    logTaskDetails?: boolean;
}

export interface ConfigNtfy {
    enabled: boolean;
    url: string;
    topic: string;
    authToken?: string;
}

export interface ConfigProxy {
    proxyGoogleTrends: boolean;
    proxyBingTerms: boolean;
}

export interface ConfigWorkers {
    doDailySet: boolean;
    doMorePromotions: boolean;
    doPunchCards: boolean;
    doDesktopSearch: boolean;
    doMobileSearch: boolean;
    doDailyCheckIn: boolean;
    doReadToEarn: boolean;
}

export interface ConfigSaveFingerprint {
    mobile: boolean;
    desktop: boolean;
}

export interface Config {
    baseURL: string;
    sessionPath: string;
    headless: boolean;
    parallel: boolean;
    // 并发账号数（从 service 端节点配置下发）
    clusters?: number;
    runOnZeroPoints: boolean;
    debug: boolean;
    saveFingerprint: ConfigSaveFingerprint;
    workers: ConfigWorkers;
    searchOnBingLocalQueries: boolean;
    globalTimeout: number | string;
    navigationTimeout: number | string;
    searchSettings: ConfigSearchSettings;
    logExcludeFunc: string[];
    webhookLogExcludeFunc: string[];
    proxy: ConfigProxy;
    webhook: ConfigWebhook;
    ntfy: ConfigNtfy;
    apiServer: ConfigApiServer;
    hotSearchApi: ConfigHotSearchApi;

    logPush?: ConfigLogPush;
    snapshots?: ConfigSnapshots;
    debugOptions?: ConfigDebugOptions;
}
