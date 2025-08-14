"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadNodeConfig = loadNodeConfig;
exports.loadAccounts = loadAccounts;
exports.loadConfig = loadConfig;
exports.loadDailyPoints = loadDailyPoints;
exports.saveDailyPoints = saveDailyPoints;
exports.loadSessionData = loadSessionData;
exports.saveSessionData = saveSessionData;
exports.saveFingerprintData = saveFingerprintData;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const axios_1 = __importDefault(require("axios"));
const Logger_1 = require("./Logger");
let configCache;
async function loadNodeConfig() {
    const config = loadConfig();
    const apiConfig = config.apiServer;
    if (!apiConfig || !apiConfig.enabled || !apiConfig.updateUrl || !apiConfig.nodeName) {
        (0, Logger_1.log)('main', '配置加载', 'API未启用，无法从服务器加载节点配置。', 'warn');
        return null;
    }
    try {
        const apiUrl = new URL(apiConfig.updateUrl);
        apiUrl.pathname = '/bot_api/get_config';
        const response = await axios_1.default.get(apiUrl.toString(), {
            headers: { 'Authorization': `Bearer ${apiConfig.token}` }
        });
        (0, Logger_1.log)('main', '配置加载', '成功从服务器加载节点配置。');
        return response.data;
    }
    catch (error) {
        let errorMessage;
        if (axios_1.default.isAxiosError(error)) {
            errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
        }
        else {
            errorMessage = String(error);
        }
        (0, Logger_1.log)('main', '配置加载', `从服务器加载节点配置失败: ${errorMessage}`, 'error');
        return null;
    }
}
async function loadAccounts() {
    const config = loadConfig();
    const apiConfig = config.apiServer;
    if (!apiConfig || !apiConfig.enabled || !apiConfig.updateUrl || !apiConfig.nodeName) {
        (0, Logger_1.log)('main', '账户加载', 'API未启用或节点名称未配置，将从本地 accounts.json 加载账户。', 'warn');
        try {
            const accountDir = path_1.default.join(__dirname, '../', 'accounts.json');
            if (!fs_1.default.existsSync(accountDir)) {
                (0, Logger_1.log)('main', '账户加载', '本地 accounts.json 文件不存在，返回空账户列表。', 'error');
                return [];
            }
            const accounts = fs_1.default.readFileSync(accountDir, 'utf-8');
            return JSON.parse(accounts);
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            (0, Logger_1.log)('main', '账户加载', `读取本地 accounts.json 失败: ${errorMessage}`, 'error');
            return [];
        }
    }
    try {
        const apiUrl = new URL(apiConfig.updateUrl);
        apiUrl.pathname = '/bot_api/accounts';
        apiUrl.searchParams.set('node_name', apiConfig.nodeName);
        (0, Logger_1.log)('main', '账户加载', `正在从API获取分配给节点 [${apiConfig.nodeName}] 的账户...`);
        const response = await axios_1.default.get(apiUrl.toString(), {
            headers: { 'Authorization': `Bearer ${apiConfig.token}` }
        });
        (0, Logger_1.log)('main', '账户加载', `成功获取到 ${response.data.length} 个账户。`);
        return response.data;
    }
    catch (error) {
        let errorMessage;
        if (axios_1.default.isAxiosError(error)) {
            errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
        }
        else {
            errorMessage = String(error);
        }
        (0, Logger_1.log)('main', '账户加载', `从API获取账户列表失败: ${errorMessage}`, 'error');
        return [];
    }
}
function loadConfig() {
    if (configCache) {
        return configCache;
    }
    try {
        const configDir = path_1.default.join(__dirname, '../', 'config.json');
        const config = fs_1.default.readFileSync(configDir, 'utf-8');
        configCache = JSON.parse(config);
        return configCache;
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`读取 config.json 失败: ${errorMessage}`);
    }
}
async function loadDailyPoints(sessionPath, email) {
    try {
        const pointsFile = path_1.default.join(__dirname, '../../sessions', email, 'daily_points.json');
        if (fs_1.default.existsSync(pointsFile)) {
            const pointsData = await fs_1.default.promises.readFile(pointsFile, 'utf-8');
            return JSON.parse(pointsData);
        }
        return null;
    }
    catch (error) {
        return null;
    }
}
async function saveDailyPoints(sessionPath, email, data) {
    try {
        const sessionDir = path_1.default.join(__dirname, '../../sessions', email);
        if (!fs_1.default.existsSync(sessionDir)) {
            await fs_1.default.promises.mkdir(sessionDir, { recursive: true });
        }
        await fs_1.default.promises.writeFile(path_1.default.join(sessionDir, 'daily_points.json'), JSON.stringify(data, null, 2));
    }
    catch (error) {
        console.error(`Failed to save daily points for ${email}:`, error);
    }
}
async function loadSessionData(sessionPath, email, isMobile, saveFingerprint) {
    try {
        const cookieFile = path_1.default.join(__dirname, '../../sessions', email, `${isMobile ? 'mobile_cookies' : 'desktop_cookies'}.json`);
        let cookies = [];
        if (fs_1.default.existsSync(cookieFile)) {
            const cookiesData = await fs_1.default.promises.readFile(cookieFile, 'utf-8');
            cookies = JSON.parse(cookiesData);
        }
        const fingerprintFile = path_1.default.join(__dirname, '../../sessions', email, `${isMobile ? 'mobile_fingerpint' : 'desktop_fingerpint'}.json`);
        let fingerprint;
        if (((saveFingerprint.desktop && !isMobile) || (saveFingerprint.mobile && isMobile)) && fs_1.default.existsSync(fingerprintFile)) {
            const fingerprintData = await fs_1.default.promises.readFile(fingerprintFile, 'utf-8');
            fingerprint = JSON.parse(fingerprintData);
        }
        return {
            cookies: cookies,
            fingerprint: fingerprint
        };
    }
    catch (error) {
        throw new Error(error);
    }
}
async function saveSessionData(sessionPath, browser, email, isMobile) {
    try {
        const cookies = await browser.cookies();
        const sessionDir = path_1.default.join(__dirname, '../../sessions', email);
        if (!fs_1.default.existsSync(sessionDir)) {
            await fs_1.default.promises.mkdir(sessionDir, { recursive: true });
        }
        await fs_1.default.promises.writeFile(path_1.default.join(sessionDir, `${isMobile ? 'mobile_cookies' : 'desktop_cookies'}.json`), JSON.stringify(cookies));
        return sessionDir;
    }
    catch (error) {
        throw new Error(error);
    }
}
async function saveFingerprintData(sessionPath, email, isMobile, fingerpint) {
    try {
        const sessionDir = path_1.default.join(__dirname, '../../sessions', email);
        if (!fs_1.default.existsSync(sessionDir)) {
            await fs_1.default.promises.mkdir(sessionDir, { recursive: true });
        }
        await fs_1.default.promises.writeFile(path_1.default.join(sessionDir, `${isMobile ? 'mobile_fingerpint' : 'desktop_fingerpint'}.json`), JSON.stringify(fingerpint));
        return sessionDir;
    }
    catch (error) {
        throw new Error(error);
    }
}
//# sourceMappingURL=Load.js.map