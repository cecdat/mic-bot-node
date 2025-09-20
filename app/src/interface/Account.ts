export interface Account {
    email: string;
    password: string;
    auxiliary_email?: string; // 辅助邮箱，用于接收验证码
    proxy: AccountProxy;
    userAgents?: { // <--- 将 "userAgent" 修改为 "userAgents" 对象
        desktop?: string; // <--- 桌面端UA
        mobile?: string;  // <--- 移动端UA
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
