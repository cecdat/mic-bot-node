"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.log = log;
const chalk_1 = __importDefault(require("chalk"));
const Webhook_1 = require("./Webhook");
const Ntfy_1 = require("./Ntfy");
const Load_1 = require("./Load");
async function log(isMobile, title, message, type = 'log', color) {
    const configData = (0, Load_1.loadConfig)();
    // [CORE FIX] Safely check if logExcludeFunc exists and is an array before using it.
    if (Array.isArray(configData.logExcludeFunc) && configData.logExcludeFunc.some((x) => x.toLowerCase() === title.toLowerCase())) {
        return;
    }
    // 使用Asia/Shanghai时区格式化时间
    const currentTime = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
    const platformText = isMobile === 'main' ? '主进程' : isMobile ? '移动端' : '桌面端';
    const chalkedPlatform = isMobile === 'main' ? chalk_1.default.bgCyan('主进程') : isMobile ? chalk_1.default.bgBlue('移动端') : chalk_1.default.bgMagenta('桌面端');
    const cleanStr = `[${currentTime}] [PID: ${process.pid}] [${type.toUpperCase()}] ${platformText} [${title}] ${message}`;
    // [CORE FIX] Safely check if webhookLogExcludeFunc exists.
    if (!Array.isArray(configData.webhookLogExcludeFunc) || !configData.webhookLogExcludeFunc.some((x) => x.toLowerCase() === title.toLowerCase())) {
        (0, Webhook_1.Webhook)(configData, cleanStr);
    }
    // Ntfy function has its own internal safety checks.
    await (0, Ntfy_1.Ntfy)(cleanStr, type);
    const str = `[${currentTime}] [PID: ${process.pid}] [${type.toUpperCase()}] ${chalkedPlatform} [${title}] ${message}`;
    const applyChalk = color && typeof chalk_1.default[color] === 'function' ? chalk_1.default[color] : null;
    switch (type) {
        case 'warn':
            applyChalk ? console.warn(applyChalk(str)) : console.warn(str);
            break;
        case 'error':
            applyChalk ? console.error(applyChalk(str)) : console.error(str);
            break;
        default:
            applyChalk ? console.log(applyChalk(str)) : console.log(str);
            break;
    }
}
//# sourceMappingURL=Logger.js.map