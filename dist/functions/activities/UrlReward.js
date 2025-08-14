"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UrlReward = void 0;
const Workers_1 = require("../Workers");
class UrlReward extends Workers_1.Workers {
    async doUrlReward(page) {
        this.bot.log(this.bot.isMobile, 'URL奖励', '尝试完成URL奖励');
        try {
            this.bot.utils.wait(2000);
            await page.close();
            this.bot.log(this.bot.isMobile, 'URL奖励', '成功完成URL奖励');
        }
        catch (error) {
            await page.close();
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, 'URL奖励', `发生错误: ${errorMessage}`, 'error');
        }
    }
}
exports.UrlReward = UrlReward;
//# sourceMappingURL=UrlReward.js.map