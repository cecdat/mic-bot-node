"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SearchOnBing = void 0;
const fs = __importStar(require("fs"));
const path_1 = __importDefault(require("path"));
const Workers_1 = require("../Workers");
class SearchOnBing extends Workers_1.Workers {
    async doSearchOnBing(page, activity) {
        this.bot.log(this.bot.isMobile, 'SEARCH-ON-BING', 'Trying to complete SearchOnBing');
        try {
            await this.bot.utils.wait(5000);
            await this.bot.browser.utils.tryDismissAllMessages(page);
            const query = await this.getSearchQuery(activity.title);
            const searchBar = '#sb_form_q';
            await page.waitForSelector(searchBar, { state: 'visible', timeout: 10000 });
            await page.click(searchBar);
            await this.bot.utils.wait(500);
            await page.keyboard.type(query);
            await page.keyboard.press('Enter');
            await this.bot.utils.wait(3000);
            await page.close();
            this.bot.log(this.bot.isMobile, 'SEARCH-ON-BING', 'Completed the SearchOnBing successfully');
        }
        catch (error) {
            await page.close();
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, 'SEARCH-ON-BING', `An error occurred: ${errorMessage}`, 'error');
        }
    }
    async getSearchQuery(title) {
        let queries = [];
        try {
            if (this.bot.config.searchOnBingLocalQueries) {
                const data = fs.readFileSync(path_1.default.join(__dirname, '../queries.json'), 'utf8');
                queries = JSON.parse(data);
            }
            else {
                // Fetch from the repo directly so the user doesn't need to redownload the script for the new activities
                const response = await this.bot.axios.request({
                    method: 'GET',
                    // [核心优化] 将 raw.githubusercontent.com 替换为 cdn.jsdelivr.net 以加速国内访问
                    url: 'https://cdn.jsdelivr.net/gh/TheNetsky/Microsoft-Rewards-Script@main/src/functions/queries.json'
                });
                queries = response.data;
            }
            const answers = queries.find(x => this.normalizeString(x.title) === this.normalizeString(title));
            const answer = answers ? this.bot.utils.shuffleArray(answers?.queries)[0] : title;
            this.bot.log(this.bot.isMobile, 'SEARCH-ON-BING-QUERY', `Fetched answer: ${answer} | question: ${title}`);
            return answer;
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, 'SEARCH-ON-BING-QUERY', `An error occurred: ${errorMessage}`, 'error');
            return title;
        }
    }
    normalizeString(string) {
        return string.normalize('NFD').trim().toLowerCase().replace(/[^\x20-\x7E]/g, '').replace(/[?!]/g, '');
    }
}
exports.SearchOnBing = SearchOnBing;
//# sourceMappingURL=SearchOnBing.js.map