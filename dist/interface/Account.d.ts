export interface Account {
    email: string;
    password: string;
    proxy: AccountProxy;
    userAgents?: {
        desktop?: string;
        mobile?: string;
    };
    hotSearchEndpoints?: string[];
}
export interface AccountProxy {
    proxyAxios: boolean;
    url: string;
    port: number;
    password: string;
    username: string;
}
//# sourceMappingURL=Account.d.ts.map