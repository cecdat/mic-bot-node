"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Webhook = Webhook;
const axios_1 = __importDefault(require("axios"));
async function Webhook(configData, content) {
    const webhook = configData.webhook; // Safely access the webhook property
    if (!webhook || !webhook.enabled || !webhook.url || webhook.url.length < 10)
        return;
    try {
        await axios_1.default.post(webhook.url, { content: content }, { headers: { 'Content-Type': 'application/json' } });
    }
    catch (error) {
        // Silent fail
        console.error('Failed to send webhook notification:', error);
    }
}
//# sourceMappingURL=Webhook.js.map