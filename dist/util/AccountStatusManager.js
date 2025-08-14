"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.accountStatusManager = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const Logger_1 = require("./Logger");
const STATUS_FILE_PATH = path_1.default.join(__dirname, '..', 'browser', 'sessions', 'account_status.json');
const MAX_FAILURES = 3; // 连续失败3次后触发熔断
const FREEZE_DURATION_MS = 24 * 60 * 60 * 1000; // 熔断24小时
class AccountStatusManager {
    constructor() {
        this.statusData = {};
        this.loadStatusFile();
    }
    loadStatusFile() {
        try {
            if (fs_1.default.existsSync(STATUS_FILE_PATH)) {
                const fileContent = fs_1.default.readFileSync(STATUS_FILE_PATH, 'utf-8');
                this.statusData = JSON.parse(fileContent);
            }
        }
        catch (error) {
            (0, Logger_1.log)('main', '账户状态管理器', `读取状态文件失败: ${error}`, 'error');
            this.statusData = {};
        }
    }
    saveStatusFile() {
        try {
            const dir = path_1.default.dirname(STATUS_FILE_PATH);
            if (!fs_1.default.existsSync(dir)) {
                fs_1.default.mkdirSync(dir, { recursive: true });
            }
            fs_1.default.writeFileSync(STATUS_FILE_PATH, JSON.stringify(this.statusData, null, 2));
        }
        catch (error) {
            (0, Logger_1.log)('main', '账户状态管理器', `保存状态文件失败: ${error}`, 'error');
        }
    }
    recordSuccess(email) {
        if (this.statusData[email]) {
            (0, Logger_1.log)('main', '账户状态管理器', `账户 ${email} 运行成功，重置失败计数。`);
            delete this.statusData[email];
            this.saveStatusFile();
        }
    }
    recordFailure(email) {
        if (!this.statusData[email]) {
            this.statusData[email] = { consecutiveFailures: 0 };
        }
        const status = this.statusData[email];
        status.consecutiveFailures++;
        (0, Logger_1.log)('main', '账户状态管理器', `账户 ${email} 运行失败，连续失败次数: ${status.consecutiveFailures}/${MAX_FAILURES}。`, 'warn');
        if (status.consecutiveFailures >= MAX_FAILURES) {
            status.frozenUntil = Date.now() + FREEZE_DURATION_MS;
            const frozenUntilDate = new Date(status.frozenUntil).toLocaleString('zh-CN');
            (0, Logger_1.log)('main', '账户状态管理器', `账户 ${email} 已被熔断，将在 ${frozenUntilDate} 后自动尝试。`, 'error');
        }
        this.saveStatusFile();
    }
    isFrozen(email) {
        const status = this.statusData[email];
        if (!status || !status.frozenUntil) {
            return false;
        }
        if (Date.now() > status.frozenUntil) {
            (0, Logger_1.log)('main', '账户状态管理器', `账户 ${email} 的熔断时间已过，将进行解封。`);
            delete this.statusData[email];
            this.saveStatusFile();
            return false;
        }
        const frozenUntilDate = new Date(status.frozenUntil).toLocaleString('zh-CN');
        (0, Logger_1.log)('main', '账户状态管理器', `账户 ${email} 当前处于熔断状态，将跳过本次任务 (解封时间: ${frozenUntilDate})。`, 'warn');
        return true;
    }
}
// 导出一个单例，确保整个应用中只有一个状态管理器实例
exports.accountStatusManager = new AccountStatusManager();
//# sourceMappingURL=AccountStatusManager.js.map