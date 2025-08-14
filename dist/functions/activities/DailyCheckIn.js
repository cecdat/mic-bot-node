"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DailyCheckIn = void 0;
const crypto_1 = require("crypto");
const Workers_1 = require("../Workers");
class DailyCheckIn extends Workers_1.Workers {
    async doDailyCheckIn(accessToken, data) {
        this.bot.log(this.bot.isMobile, 'DAILY-CHECK-IN', 'Starting Daily Check In');
        try {
            let geoLocale = data.userProfile.attributes.country;
            geoLocale = (this.bot.config.searchSettings.useGeoLocaleQueries && geoLocale.length === 2) ? geoLocale.toLowerCase() : 'us';
            const jsonData = {
                amount: 1,
                country: geoLocale,
                id: (0, crypto_1.randomBytes)(64).toString('hex'),
                type: 101,
                attributes: {
                    offerid: 'Gamification_Sapphire_DailyCheckIn'
                }
            };
            const claimRequest = {
                url: 'https://prod.rewardsplatform.microsoft.com/dapi/me/activities',
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'X-Rewards-Country': geoLocale,
                    'X-Rewards-Language': 'en'
                },
                data: JSON.stringify(jsonData)
            };
            const claimResponse = await this.bot.axios.request(claimRequest);
            const claimedPoint = parseInt((await claimResponse.data).response?.activity?.p) ?? 0;
            this.bot.log(this.bot.isMobile, 'DAILY-CHECK-IN', claimedPoint > 0 ? `Claimed ${claimedPoint} points` : 'Already claimed today');
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, 'DAILY-CHECK-IN', `An error occurred: ${errorMessage}`, 'error');
        }
    }
}
exports.DailyCheckIn = DailyCheckIn;
//# sourceMappingURL=DailyCheckIn.js.map