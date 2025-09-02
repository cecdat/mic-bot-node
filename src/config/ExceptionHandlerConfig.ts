/**
 * 异常处理配置管理模块
 * 统一管理所有异常处理相关的配置参数
 */
export interface ExceptionHandlerConfig {
    // 通用配置
    common: {
        maxRetries: number;
        defaultTimeout: number;
        waitBetweenRetries: number;
    };
    
    // 登录异常处理配置
    login: {
        cookiesConsent: {
            waitAfterClick: number;
            maxAttempts: number;
            selectors: string[];
        };
        accountLocked: {
            checkTimeout: number;
            selectors: string[];
        };
        verification: {
            checkTimeout: number;
            selectors: string[];
        };
    };
    
    // 任务异常处理配置
    task: {
        timeout: {
            default: number;
            pageLoad: number;
            elementFind: number;
            click: number;
        };
        retry: {
            maxAttempts: number;
            waitBetweenAttempts: number;
        };
        network: {
            checkTimeout: number;
            errorSelectors: string[];
        };
        completion: {
            waitAfterExecution: number;
            successIndicators: string[];
        };
    };
}

/**
 * 默认配置
 */
export const DEFAULT_EXCEPTION_HANDLER_CONFIG: ExceptionHandlerConfig = {
    common: {
        maxRetries: 3,
        defaultTimeout: 30000,
        waitBetweenRetries: 1000
    },
    
    login: {
        cookiesConsent: {
            waitAfterClick: 2000,
            maxAttempts: 3,
            selectors: [
                'button:has-text("接受")',
                'button:has-text("Accept")',
                'button:has-text("同意")',
                'button:has-text("Allow")',
                'button:has-text("确定")',
                'button:has-text("OK")',
                'button:has-text("是")',
                'button:has-text("Yes")'
            ]
        },
        accountLocked: {
            checkTimeout: 2000,
            selectors: [
                'text=账户已锁定',
                'text=Account locked',
                'text=需要验证',
                'text=Verification required'
            ]
        },
        verification: {
            checkTimeout: 2000,
            selectors: [
                'input[placeholder*="验证码"]',
                'input[placeholder*="verification"]',
                'input[name*="verification"]'
            ]
        }
    },
    
    task: {
        timeout: {
            default: 30000,
            pageLoad: 15000,
            elementFind: 5000,
            click: 5000
        },
        retry: {
            maxAttempts: 3,
            waitBetweenAttempts: 1000
        },
        network: {
            checkTimeout: 2000,
            errorSelectors: [
                'text=网络错误',
                'text=Network error',
                'text=连接失败',
                'text=Connection failed',
                'text=无法访问',
                'text=Unable to access'
            ]
        },
        completion: {
            waitAfterExecution: 3000,
            successIndicators: [
                'text=任务完成',
                'text=Task completed',
                'text=活动完成',
                'text=Activity completed'
            ]
        }
    }
};

/**
 * 配置管理器
 */
export class ExceptionHandlerConfigManager {
    private static instance: ExceptionHandlerConfigManager;
    private config: ExceptionHandlerConfig;
    
    private constructor() {
        this.config = DEFAULT_EXCEPTION_HANDLER_CONFIG;
    }
    
    /**
     * 获取单例实例
     */
    public static getInstance(): ExceptionHandlerConfigManager {
        if (!ExceptionHandlerConfigManager.instance) {
            ExceptionHandlerConfigManager.instance = new ExceptionHandlerConfigManager();
        }
        return ExceptionHandlerConfigManager.instance;
    }
    
    /**
     * 获取当前配置
     */
    public getConfig(): ExceptionHandlerConfig {
        return this.config;
    }
    
    /**
     * 更新配置
     */
    public updateConfig(newConfig: Partial<ExceptionHandlerConfig>): void {
        this.config = { ...this.config, ...newConfig };
    }
    
    /**
     * 重置为默认配置
     */
    public resetToDefault(): void {
        this.config = DEFAULT_EXCEPTION_HANDLER_CONFIG;
    }
    
    /**
     * 获取特定配置项
     */
    public get<T>(path: string): T | undefined {
        const keys = path.split('.');
        let current: any = this.config;
        
        for (const key of keys) {
            if (current && typeof current === 'object' && key in current) {
                current = current[key];
            } else {
                return undefined;
            }
        }
        
        return current as T;
    }
}
