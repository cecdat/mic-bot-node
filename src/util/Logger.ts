import chalk from 'chalk';
import { Webhook } from './Webhook';
import { Ntfy } from './Ntfy';
import { loadConfig } from './Load';
import { logManager } from './LogManager';

// 定义日志级别
type LogLevel = 'debug' | 'log' | 'warn' | 'error';

export async function log(isMobile: boolean | 'main', title: string, message: string, type: LogLevel = 'log', color?: keyof typeof chalk) {
    const configData = loadConfig();

    // 检查是否启用调试模式
    if (type === 'debug' && !configData.debug) {
        return;
    }

    // 过滤非关键信息日志，减少输出
    const nonCriticalTitles = [
        '搜索-随机滚动', '搜索-随机点击', '搜索-必应', '搜索-资源清理',
        '浏览器', '主流程', '内存监控', '配置加载', '节点管理',
        '热搜脚本', '任务执行', '执行单个任务', '主流程-WORKER'
    ];
    
    // 如果是非关键信息且不是错误或警告，则跳过
    if (type === 'log' && nonCriticalTitles.some(t => title.includes(t))) {
        // 只保留关键信息，减少日志噪音
        return;
    }

    // [CORE FIX] Safely check if logExcludeFunc exists and is an array before using it.
    if (Array.isArray(configData.logExcludeFunc) && configData.logExcludeFunc.some((x: string) => x.toLowerCase() === title.toLowerCase())) {
        return;
    }

    // 使用Asia/Shanghai时区格式化时间
    const currentTime = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
    const platformText = isMobile === 'main' ? '主进程' : isMobile ? '移动端' : '桌面端';
    const chalkedPlatform = isMobile === 'main' ? chalk.bgCyan('主进程') : isMobile ? chalk.bgBlue('移动端') : chalk.bgMagenta('桌面端');

    const cleanStr = `[${currentTime}] [PID: ${process.pid}] [${type.toUpperCase()}] ${platformText} [${title}] ${message}`;

    // 添加到日志管理器 - 将debug级别转换为log级别
    const logLevel = type === 'debug' ? 'log' : type;
    logManager.addLog(logLevel, platformText, title, message, process.pid);

    // [CORE FIX] Safely check if webhookLogExcludeFunc exists.
    if (!Array.isArray(configData.webhookLogExcludeFunc) || !configData.webhookLogExcludeFunc.some((x: string) => x.toLowerCase() === title.toLowerCase())) {
        Webhook(configData, cleanStr);
    }
    
    // Ntfy function has its own internal safety checks - 转换类型
    const ntfyLevel = type === 'debug' ? 'log' : type;
    await Ntfy(cleanStr, ntfyLevel);

    const str = `[${currentTime}] [PID: ${process.pid}] [${type.toUpperCase()}] ${chalkedPlatform} [${title}] ${message}`;
    const applyChalk = color && typeof chalk[color] === 'function' ? chalk[color] as (msg: string) => string : null;

    switch (type) {
        case 'warn':
            applyChalk ? console.warn(applyChalk(str)) : console.warn(str);
            break;
        case 'error':
            applyChalk ? console.error(applyChalk(str)) : console.error(str);
            break;
        case 'debug':
            // 调试日志只在调试模式下输出
            if (configData.debug) {
                applyChalk ? console.log(applyChalk(str)) : console.log(str);
            }
            break;
        default:
            applyChalk ? console.log(applyChalk(str)) : console.log(str);
            break;
    }
}

// 添加便捷的调试日志函数
export function debug(isMobile: boolean | 'main', title: string, message: string, color?: keyof typeof chalk) {
    return log(isMobile, title, message, 'debug', color);
}
