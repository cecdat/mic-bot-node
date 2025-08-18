import ms from 'ms'
import { Locator } from 'rebrowser-playwright'

export default class Util {

    async wait(ms: number): Promise<void> {
        return new Promise<void>((resolve) => {
            setTimeout(resolve, ms)
        })
    }

    async humanClick(locator: Locator): Promise<void> {
        try {
            // 首先检查元素是否存在
            const isVisible = await locator.isVisible({ timeout: 5000 }).catch(() => false);
            if (!isVisible) {
                throw new Error('元素不可见或不存在');
            }

            // 尝试hover，如果失败则跳过
            try {
                await locator.hover({ timeout: 5000 });
            } catch (hoverError) {
                console.warn('Hover操作失败，继续执行点击:', hoverError);
            }

            await this.wait(this.randomNumber(50, 200));
            
            // 尝试dispatchEvent，如果失败则跳过
            try {
                await locator.dispatchEvent('mousedown');
                await this.wait(this.randomNumber(30, 100));
                await locator.dispatchEvent('mouseup');
            } catch (eventError) {
                console.warn('鼠标事件分发失败，继续执行点击:', eventError);
            }

            // 尝试点击，如果失败则重试
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    await locator.click({ timeout: 5000 });
                    return; // 成功点击，退出函数
                } catch (clickError) {
                    const errorMessage = clickError instanceof Error ? clickError.message : String(clickError);
                    console.warn(`点击尝试 ${attempt}/3 失败: ${errorMessage}`, 'warn');
                    
                    if (attempt < 3) {
                        await this.wait(1000); // 等待1秒后重试
                    }
                }
            }

            // 所有重试都失败了，使用强制点击作为最后手段
            try {
                console.warn('所有点击尝试失败，使用强制点击', 'warn');
                await locator.click({ force: true, timeout: 10000 });
            } catch (finalClickError) {
                const finalErrorMessage = finalClickError instanceof Error ? finalClickError.message : String(finalClickError);
                console.error(`强制点击也失败了: ${finalErrorMessage}`, 'error');
                throw finalClickError instanceof Error ? finalClickError : new Error(String(finalClickError));
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('humanClick执行失败:', errorMessage);
            // 如果所有操作都失败，尝试强制点击
            try {
                await locator.click({ force: true, timeout: 3000 });
            } catch (finalError) {
                const finalErrorMessage = finalError instanceof Error ? finalError.message : String(finalError);
                throw new Error(`humanClick完全失败: ${errorMessage}, 强制点击也失败: ${finalErrorMessage}`);
            }
        }
    }

    getFormattedDate(ms = Date.now()): string {
        const today = new Date(ms)
        const month = String(today.getMonth() + 1).padStart(2, '0')
        const day = String(today.getDate()).padStart(2, '0')
        const year = today.getFullYear()

        return `${month}/${day}/${year}`
    }
    
    getYYYYMMDD(date = new Date()): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }


    shuffleArray<T>(array: T[]): T[] {
        return array.map(value => ({ value, sort: Math.random() }))
            .sort((a, b) => a.sort - b.sort)
            .map(({ value }) => value)
    }

    randomNumber(min: number, max: number): number {
        return Math.floor(Math.random() * (max - min + 1)) + min
    }

    chunkArray<T>(arr: T[], numChunks: number): T[][] {
        const chunkSize = Math.ceil(arr.length / numChunks)
        const chunks: T[][] = []

        for (let i = 0; i < arr.length; i += chunkSize) {
            const chunk = arr.slice(i, i + chunkSize)
            chunks.push(chunk)
        }

        return chunks
    }

    stringToMs(input: string | number): number {
        const milisec = ms(input.toString())
        if (!milisec) {
            // [核心修改] 将错误信息中文化
            throw new Error('提供的时间字符串无法被正确解析！请使用类似 "1 min", "1m" 或 "1 minutes" 的格式。')
        }
        return milisec
    }

}