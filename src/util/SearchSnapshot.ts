import fs from 'fs';
import path from 'path';
import { Page } from 'rebrowser-playwright';

export interface SearchSnapshotInfo {
    snapshotType: string;
    query: string;
    missingPoints: number;
    maxLoop?: number;
    errorMessage?: string;
    timestamp: string;
}

export class SearchSnapshot {
    private baseDir: string;
    private accountEmail: string;

    constructor(accountEmail: string) {
        this.accountEmail = accountEmail;
        this.baseDir = path.join(process.cwd(), 'sessions', accountEmail, 'search_snapshots');
        this.ensureDirectoryExists();
    }

    private ensureDirectoryExists(): void {
        if (!fs.existsSync(this.baseDir)) {
            fs.mkdirSync(this.baseDir, { recursive: true });
        }
    }

    public async takeSnapshot(page: Page, info: Omit<SearchSnapshotInfo, 'timestamp'>): Promise<string | null> {
        try {
            const timestamp = new Date().toISOString().replace(/[:.-]/g, '');
            const fileName = `${info.snapshotType}_${timestamp}.png`;
            const filePath = path.join(this.baseDir, fileName);

            // 保存PNG截图
            await page.screenshot({ path: filePath });
            
            // [已禁用] HTML源码保存功能已关闭，避免生成大量HTML文件
            // try {
            //     const htmlContent = await page.content();
            //     const htmlFileName = `${info.snapshotType}_${timestamp}.html`;
            //     const htmlFilePath = path.join(this.baseDir, htmlFileName);
            //     fs.writeFileSync(htmlFilePath, htmlContent, 'utf-8');
            //     
            //     console.log(`HTML源码已保存: ${htmlFilePath}`);
            // } catch (htmlError) {
            //     console.error(`保存HTML源码失败: ${htmlError}`);
            // }
            
            // 保存快照信息到JSON文件
            const infoFileName = `${info.snapshotType}_${timestamp}.json`;
            const infoFilePath = path.join(this.baseDir, infoFileName);
            const snapshotInfo: SearchSnapshotInfo = {
                ...info,
                timestamp
            };
            
            fs.writeFileSync(infoFilePath, JSON.stringify(snapshotInfo, null, 2), 'utf-8');
            
            return filePath;
        } catch (error) {
            console.error(`拍摄快照失败: ${error}`);
            return null;
        }
    }

    public getSnapshotDirectory(): string {
        return this.baseDir;
    }

    public getAccountEmail(): string {
        return this.accountEmail;
    }

    public listSnapshots(): string[] {
        try {
            if (!fs.existsSync(this.baseDir)) {
                return [];
            }
            return fs.readdirSync(this.baseDir)
                .filter(file => file.endsWith('.png'))
                .sort()
                .reverse(); // 最新的在前面
        } catch (error) {
            console.error(`列出快照失败: ${error}`);
            return [];
        }
    }

    public cleanupOldSnapshots(maxCount: number = 50): void {
        try {
            const snapshots = this.listSnapshots();
            if (snapshots.length <= maxCount) {
                return;
            }

            const toDelete = snapshots.slice(maxCount);
            for (const snapshot of toDelete) {
                const filePath = path.join(this.baseDir, snapshot);
                const infoPath = filePath.replace('.png', '.json');
                
                try {
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                    if (fs.existsSync(infoPath)) {
                        fs.unlinkSync(infoPath);
                    }
                } catch (error) {
                    console.error(`删除快照失败: ${filePath}`, error);
                }
            }
            
            console.log(`清理了 ${toDelete.length} 个旧快照`);
        } catch (error) {
            console.error(`清理快照失败: ${error}`);
        }
    }
}
