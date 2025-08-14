import { BrowserFingerprintWithHeaders } from 'fingerprint-generator';
/**
 * [已修改] 不再进行网络请求，而是调用新的本地函数
 * @param isMobile
 * @returns
 */
export declare function getUserAgent(isMobile: boolean): Promise<{
    userAgent: string;
    userAgentMetadata: {
        isMobile: boolean;
        platform: string;
        fullVersionList: {
            brand: string;
            version: string;
        }[];
        brands: {
            brand: string;
            version: string | undefined;
        }[];
        platformVersion: string;
        architecture: string;
        bitness: string;
        model: string;
    };
    componentData: {
        edge_version: string;
        chrome_version: string;
        edge_major_version: string | undefined;
        chrome_major_version: string | undefined;
        not_a_brand_version: string;
        not_a_brand_major_version: string;
        chrome_reduced_version: string;
    };
}>;
/**
 * [已修改] 这个函数现在只是为了兼容性，直接从本地函数获取数据
 * @param isMobile
 * @returns
 */
export declare function getAppComponents(isMobile: boolean): Promise<{
    edge_version: string;
    chrome_version: string;
    edge_major_version: string | undefined;
    chrome_major_version: string | undefined;
    not_a_brand_version: string;
    not_a_brand_major_version: string;
    chrome_reduced_version: string;
}>;
export declare function getSystemComponents(mobile: boolean): string;
/**
 * [已修改] 使用新的本地数据来更新指纹中的User-Agent
 * @param fingerprint
 * @param isMobile
 * @returns
 */
export declare function updateFingerprintUserAgent(fingerprint: BrowserFingerprintWithHeaders, isMobile: boolean): Promise<BrowserFingerprintWithHeaders>;
//# sourceMappingURL=UserAgent.d.ts.map