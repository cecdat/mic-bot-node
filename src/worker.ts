import Axios from './util/Axios';
import { Account } from './interface/Account';
import { MicrosoftRewardsBot } from './index';
import { log } from './util/Logger';

async function main() {
    try {
        const accountJson = process.env.ACCOUNT;
        if (!accountJson) {
            throw new Error('ACCOUNT env not provided');
        }
        const account: Account = JSON.parse(accountJson);

        const bot = new MicrosoftRewardsBot();
        bot.account = account;
        bot.axios = new Axios(account.proxy);

        await bot.runFor(account);
        process.exit(0);
    } catch (err: any) {
        log('main', '子进程', `执行失败: ${err?.message || String(err)}`, 'error');
        process.exit(1);
    }
}

main();


