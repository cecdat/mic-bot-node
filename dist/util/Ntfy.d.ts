declare const NOTIFICATION_TYPES: {
    error: {
        priority: string;
        tags: string;
    };
    warn: {
        priority: string;
        tags: string;
    };
    log: {
        priority: string;
        tags: string;
    };
};
export declare function Ntfy(message: string, type?: keyof typeof NOTIFICATION_TYPES): Promise<void>;
export {};
//# sourceMappingURL=Ntfy.d.ts.map