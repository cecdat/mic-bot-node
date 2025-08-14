"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ms_1 = __importDefault(require("ms"));
class Util {
    async wait(ms) {
        return new Promise((resolve) => {
            setTimeout(resolve, ms);
        });
    }
    async humanClick(locator) {
        await locator.hover({ timeout: 10000 });
        await this.wait(this.randomNumber(50, 200));
        await locator.dispatchEvent('mousedown');
        await this.wait(this.randomNumber(30, 100));
        await locator.dispatchEvent('mouseup');
        await locator.click({ force: true, timeout: 5000 });
    }
    getFormattedDate(ms = Date.now()) {
        const today = new Date(ms);
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        const year = today.getFullYear();
        return `${month}/${day}/${year}`;
    }
    getYYYYMMDD(date = new Date()) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    shuffleArray(array) {
        return array.map(value => ({ value, sort: Math.random() }))
            .sort((a, b) => a.sort - b.sort)
            .map(({ value }) => value);
    }
    randomNumber(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
    chunkArray(arr, numChunks) {
        const chunkSize = Math.ceil(arr.length / numChunks);
        const chunks = [];
        for (let i = 0; i < arr.length; i += chunkSize) {
            const chunk = arr.slice(i, i + chunkSize);
            chunks.push(chunk);
        }
        return chunks;
    }
    stringToMs(input) {
        const milisec = (0, ms_1.default)(input.toString());
        if (!milisec) {
            // [核心修改] 将错误信息中文化
            throw new Error('提供的时间字符串无法被正确解析！请使用类似 "1 min", "1m" 或 "1 minutes" 的格式。');
        }
        return milisec;
    }
}
exports.default = Util;
//# sourceMappingURL=Utils.js.map