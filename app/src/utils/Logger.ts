/**
 * 日志级别枚举
 */
export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
    FATAL = 4
}

/**
 * 日志记录接口
 */
export interface LogRecord {
    timestamp: Date;
    level: LogLevel;
    category: string;
    message: string;
    details?: any;
    context?: Record<string, any>;
}

/**
 * 日志配置接口
 */
export interface LoggerConfig {
    level: LogLevel;
    enableConsole: boolean;
    enableFile: boolean;
    enableRemote: boolean;
    maxFileSize: number;
    maxFiles: number;
    logDirectory: string;
    remoteEndpoint?: string;
}

/**
 * 日志管理器
 */
export class Logger {
    private static instance: Logger;
    private config: LoggerConfig;
    private logBuffer: LogRecord[] = [];
    private bufferSize: number = 100;
    
    private constructor() {
        this.config = {
            level: LogLevel.INFO,
            enableConsole: true,
            enableFile: false,
            enableRemote: false,
            maxFileSize: 10 * 1024 * 1024, // 10MB
            maxFiles: 5,
            logDirectory: 'logs'
        };
    }
    
    /**
     * 获取单例实例
     */
    public static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }
    
    /**
     * 配置日志器
     */
    public configure(config: Partial<LoggerConfig>): void {
        this.config = { ...this.config, ...config };
    }
    
    /**
     * 记录调试日志
     */
    public debug(category: string, message: string, details?: any, context?: Record<string, any>): void {
        this.log(LogLevel.DEBUG, category, message, details, context);
    }
    
    /**
     * 记录信息日志
     */
    public info(category: string, message: string, details?: any, context?: Record<string, any>): void {
        this.log(LogLevel.INFO, category, message, details, context);
    }
    
    /**
     * 记录警告日志
     */
    public warn(category: string, message: string, details?: any, context?: Record<string, any>): void {
        this.log(LogLevel.WARN, category, message, details, context);
    }
    
    /**
     * 记录错误日志
     */
    public error(category: string, message: string, details?: any, context?: Record<string, any>): void {
        this.log(LogLevel.ERROR, category, message, details, context);
    }
    
    /**
     * 记录致命错误日志
     */
    public fatal(category: string, message: string, details?: any, context?: Record<string, any>): void {
        this.log(LogLevel.FATAL, category, message, details, context);
    }
    
    /**
     * 记录日志的核心方法
     */
    private log(level: LogLevel, category: string, message: string, details?: any, context?: Record<string, any>): void {
        // 检查日志级别
        if (level < this.config.level) {
            return;
        }
        
        const logRecord: LogRecord = {
            timestamp: new Date(),
            level,
            category,
            message,
            details,
            context
        };
        
        // 添加到缓冲区
        this.logBuffer.push(logRecord);
        
        // 如果缓冲区满了，处理日志
        if (this.logBuffer.length >= this.bufferSize) {
            this.processLogBuffer();
        }
        
        // 立即输出到控制台（如果启用）
        if (this.config.enableConsole) {
            this.outputToConsole(logRecord);
        }
    }
    
    /**
     * 输出到控制台
     */
    private outputToConsole(record: LogRecord): void {
        const timestamp = record.timestamp.toISOString();
        const levelStr = LogLevel[record.level];
        const prefix = `[${timestamp}] [${levelStr}] [${record.category}]`;
        
        let output = `${prefix} ${record.message}`;
        
        if (record.details) {
            output += ` | ${JSON.stringify(record.details)}`;
        }
        
        if (record.context) {
            output += ` | Context: ${JSON.stringify(record.context)}`;
        }
        
        // 根据日志级别使用不同的控制台方法
        switch (record.level) {
            case LogLevel.DEBUG:
                console.debug(output);
                break;
            case LogLevel.INFO:
                console.info(output);
                break;
            case LogLevel.WARN:
                console.warn(output);
                break;
            case LogLevel.ERROR:
            case LogLevel.FATAL:
                console.error(output);
                break;
        }
    }
    
    /**
     * 处理日志缓冲区
     */
    private processLogBuffer(): void {
        if (this.logBuffer.length === 0) {
            return;
        }
        
        // 这里可以添加文件日志和远程日志的逻辑
        // 暂时清空缓冲区
        this.logBuffer = [];
    }
    
    /**
     * 强制处理所有待处理的日志
     */
    public flush(): void {
        this.processLogBuffer();
    }
    
    /**
     * 获取日志级别名称
     */
    public static getLevelName(level: LogLevel): string {
        return LogLevel[level];
    }
    
    /**
     * 从字符串解析日志级别
     */
    public static parseLevel(levelStr: string): LogLevel {
        const upperLevel = levelStr.toUpperCase();
        if (upperLevel in LogLevel) {
            return LogLevel[upperLevel as keyof typeof LogLevel];
        }
        return LogLevel.INFO; // 默认级别
    }
}

/**
 * 异常处理专用日志器
 */
export class ExceptionHandlerLogger {
    private logger: Logger;
    
    constructor() {
        this.logger = Logger.getInstance();
    }
    
    /**
     * 记录登录异常处理日志
     */
    public logLoginException(email: string, operation: string, message: string, details?: any): void {
        this.logger.info('登录异常处理', `[${email}] ${operation}: ${message}`, details, { email, operation });
    }
    
    /**
     * 记录任务异常处理日志
     */
    public logTaskException(taskName: string, operation: string, message: string, details?: any): void {
        this.logger.info('任务异常处理', `[${taskName}] ${operation}: ${message}`, details, { taskName, operation });
    }
    
    /**
     * 记录异常处理警告
     */
    public logWarning(category: string, message: string, details?: any): void {
        this.logger.warn(category, message, details);
    }
    
    /**
     * 记录异常处理错误
     */
    public logError(category: string, message: string, details?: any): void {
        this.logger.error(category, message, details);
    }
}
