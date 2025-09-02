import { randomBytes } from 'crypto'
import { AxiosRequestConfig } from 'axios'
import { Workers } from '../Workers'
import { DashboardData } from '../../interface/DashboardData'


export class DailyCheckIn extends Workers {
    public async doDailyCheckIn(accessToken: string, data: DashboardData) {
        this.bot.log(this.bot.isMobile, 'DAILY-CHECK-IN', '开始执行每日签到任务（API方式）')

        try {
            let geoLocale = data.userProfile.attributes.country
            geoLocale = (this.bot.config.searchSettings.useGeoLocaleQueries && geoLocale.length === 2) ? geoLocale.toLowerCase() : 'us'

            const jsonData = {
                amount: 1,
                country: geoLocale,
                id: randomBytes(64).toString('hex'),
                type: 101,
                attributes: {
                    offerid: 'Gamification_Sapphire_DailyCheckIn'
                }
            }

            const claimRequest: AxiosRequestConfig = {
                url: 'https://prod.rewardsplatform.microsoft.com/dapi/me/activities',
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'X-Rewards-Country': geoLocale,
                    'X-Rewards-Language': 'en'
                },
                data: JSON.stringify(jsonData)
            }

            this.bot.log(this.bot.isMobile, 'DAILY-CHECK-IN', `正在向Microsoft Rewards API发送签到请求...`);
            this.bot.log(this.bot.isMobile, 'DAILY-CHECK-IN', `请求参数: ${JSON.stringify(jsonData)}`);

            const claimResponse = await this.bot.axios.request(claimRequest)
            const responseData = await claimResponse.data
            const claimedPoint = parseInt(responseData?.response?.activity?.p) ?? 0

            if (claimedPoint > 0) {
                this.bot.log(this.bot.isMobile, 'DAILY-CHECK-IN', `✅ 签到成功！获得 ${claimedPoint} 积分`);
                return { success: true, points: claimedPoint, message: `签到成功，获得 ${claimedPoint} 积分` };
            } else {
                this.bot.log(this.bot.isMobile, 'DAILY-CHECK-IN', 'ℹ️ 今日已签到或签到失败');
                return { success: true, points: 0, message: '今日已签到或签到失败' };
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.bot.log(this.bot.isMobile, 'DAILY-CHECK-IN', `❌ 每日签到任务执行失败: ${errorMessage}`, 'error');
            return { success: false, points: 0, message: errorMessage };
        }
    }
}
