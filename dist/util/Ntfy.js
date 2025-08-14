"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Ntfy = Ntfy;
const Load_1 = require("./Load");
const axios_1 = __importDefault(require("axios"));
const NOTIFICATION_TYPES = {
    error: { priority: 'max', tags: 'rotating_light' },
    warn: { priority: 'high', tags: 'warning' },
    log: { priority: 'default', tags: 'medal_sports' }
};
async function Ntfy(message, type = 'log') {
    const config = (0, Load_1.loadConfig)().ntfy; // Safely access the ntfy property
    if (!config || !config.enabled || !config.url || !config.topic)
        return;
    try {
        const { priority, tags } = NOTIFICATION_TYPES[type];
        const headers = {
            Title: 'Microsoft Rewards Script',
            Priority: priority,
            Tags: tags,
        };
        if (config.authToken) {
            headers['Authorization'] = `Bearer ${config.authToken}`;
        }
        await axios_1.default.post(`${config.url}/${config.topic}`, message, { headers });
    }
    catch (error) {
        // Silent fail to prevent crashing the main app
        console.error('Failed to send NTFY notification:', error);
    }
}
//# sourceMappingURL=Ntfy.js.map