"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Search_1 = require("./activities/Search");
const ABC_1 = require("./activities/ABC");
const Poll_1 = require("./activities/Poll");
const Quiz_1 = require("./activities/Quiz");
const ThisOrThat_1 = require("./activities/ThisOrThat");
const UrlReward_1 = require("./activities/UrlReward");
const SearchOnBing_1 = require("./activities/SearchOnBing");
const ReadToEarn_1 = require("./activities/ReadToEarn");
const DailyCheckIn_1 = require("./activities/DailyCheckIn");
class Activities {
    constructor(bot) {
        this.doSearch = async (page, data, email) => {
            const search = new Search_1.Search(this.bot);
            await search.doSearch(page, data, email);
        };
        this.doABC = async (page) => {
            const abc = new ABC_1.ABC(this.bot);
            await abc.doABC(page);
        };
        this.doPoll = async (page) => {
            const poll = new Poll_1.Poll(this.bot);
            await poll.doPoll(page);
        };
        this.doThisOrThat = async (page) => {
            const thisOrThat = new ThisOrThat_1.ThisOrThat(this.bot);
            await thisOrThat.doThisOrThat(page);
        };
        this.doQuiz = async (page) => {
            const quiz = new Quiz_1.Quiz(this.bot);
            await quiz.doQuiz(page);
        };
        this.doUrlReward = async (page) => {
            const urlReward = new UrlReward_1.UrlReward(this.bot);
            await urlReward.doUrlReward(page);
        };
        this.doSearchOnBing = async (page, activity) => {
            const searchOnBing = new SearchOnBing_1.SearchOnBing(this.bot);
            await searchOnBing.doSearchOnBing(page, activity);
        };
        this.doReadToEarn = async (accessToken, data) => {
            const readToEarn = new ReadToEarn_1.ReadToEarn(this.bot);
            await readToEarn.doReadToEarn(accessToken, data);
        };
        this.doDailyCheckIn = async (accessToken, data) => {
            const dailyCheckIn = new DailyCheckIn_1.DailyCheckIn(this.bot);
            await dailyCheckIn.doDailyCheckIn(accessToken, data);
        };
        this.bot = bot;
    }
}
exports.default = Activities;
//# sourceMappingURL=Activities.js.map