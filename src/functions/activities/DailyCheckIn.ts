import { randomBytes, randomUUID } from 'crypto'
import { AxiosRequestConfig } from 'axios'
import { Workers } from '../Workers'
import { DashboardData } from '../../interface/DashboardData'


export class DailyCheckIn extends Workers {
    private generateUserAgent(): string {
        if (this.bot.isMobile) {
            // 移动端User-Agent
            const iosVersions = ['16.3.1', '16.4', '16.5', '16.6', '16.7', '17.0', '17.1', '17.2', '17.3', '17.4', '17.5', '18.0', '18.1', '18.2'];
            const safariVersions = ['16.3.1', '16.4', '16.5', '16.6', '16.7', '17.0', '17.1', '17.2', '17.3', '17.4', '17.5', '18.0', '18.1', '18.2'];
            const bingVersions = ['31.4.430430001', '31.5.430430002', '31.6.430430003', '32.0.430430004', '32.1.430430005'];
            
            const iosVersion = iosVersions[Math.floor(Math.random() * iosVersions.length)];
            const safariVersion = safariVersions[Math.floor(Math.random() * safariVersions.length)];
            const bingVersion = bingVersions[Math.floor(Math.random() * bingVersions.length)];
            
            return `Mozilla/5.0 (iPhone; CPU iPhone OS ${iosVersion} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${safariVersion} Mobile/15E148 Safari/605.1.15 BingSapphire/${bingVersion}`;
        } else {
            // 桌面端User-Agent
            const chromeVersions = ['120.0.0.0', '121.0.0.0', '122.0.0.0', '123.0.0.0', '124.0.0.0', '125.0.0.0', '126.0.0.0', '127.0.0.0'];
            const edgeVersions = ['120.0.0.0', '121.0.0.0', '122.0.0.0', '123.0.0.0', '124.0.0.0', '125.0.0.0', '126.0.0.0', '127.0.0.0'];
            
            const chromeVersion = chromeVersions[Math.floor(Math.random() * chromeVersions.length)];
            const edgeVersion = edgeVersions[Math.floor(Math.random() * edgeVersions.length)];
            
            return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36 Edg/${edgeVersion}`;
        }
    }

    public async doDailyCheckIn(accessToken: string, data: DashboardData) {
        this.bot.log(this.bot.isMobile, 'DAILY-CHECK-IN', '开始执行每日签到任务（API方式）')

        try {
            let geoLocale = data.userProfile.attributes.country
            geoLocale = (this.bot.config.searchSettings.useGeoLocaleQueries && geoLocale.length === 2) ? geoLocale.toLowerCase() : 'us'

            const jsonData = {
                amount: 1,
                type: 103,
                risk_context: {},
                id: randomUUID(), // 使用UUID格式
                attributes: {},
                channel: "SAIOS",
                country: geoLocale
            }

            const claimRequest: AxiosRequestConfig = {
                url: 'https://prod.rewardsplatform.microsoft.com/dapi/me/activities',
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'X-Rewards-Country': geoLocale,
                    'X-Rewards-Language': 'zh',
                    'X-Rewards-AppId': 'SAIOS/31.4.430430001',
                    'X-Rewards-PartnerId': 'startapp',
                    'X-Rewards-IsMobile': '',
                    'X-Rewards-Flights': 'rwgobig',
                    'User-Agent': this.generateUserAgent()
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
