import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { log } from '../util/Logger';

const execAsync = promisify(exec);

interface UpdateInfo {
    version: string;
    version_name: string;
    description: string;
    git_branch: string;
    git_commit_hash: string;
    image_name: string;
}

interface VersionCheckResponse {
    hasUpdate: boolean;
    message?: string;
    updateInfo?: UpdateInfo;
}

export class UpdateManager {
    private config: any;
    private isMobile: boolean;
    private localVersion: string;
    private updateInProgress: boolean = false;

    constructor(config: any, isMobile: boolean) {
        this.config = config;
        this.isMobile = isMobile;
        this.localVersion = this.getLocalVersion();
    }

    /**
     * 获取本地版本号
     */
    private getLocalVersion(): string {
        try {
            // 从package.json读取版本号
            const packagePath = path.join(process.cwd(), 'package.json');
            if (fs.existsSync(packagePath)) {
                const packageData = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
                return packageData.version || '1.0.0';
            }
        } catch (error) {
            log(this.isMobile, '更新管理', `读取本地版本失败: ${error}`, 'warn');
        }
        return '1.0.0';
    }

    /**
     * 检查是否有更新
     */
    async checkForUpdates(): Promise<boolean> {
        if (this.updateInProgress) {
            log(this.isMobile, '更新管理', '更新正在进行中，跳过检查');
            return false;
        }

        try {
            log(this.isMobile, '更新管理', `检查更新，本地版本: ${this.localVersion}`);

            const response = await axios.get<VersionCheckResponse>(
                `${this.config.apiServer.updateUrl}/bot_api/check_version`,
                {
                    headers: {
                        'Authorization': `Bearer ${this.config.apiServer.token}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                }
            );

            if (response.data.hasUpdate && response.data.updateInfo) {
                const updateInfo = response.data.updateInfo;
                log(this.isMobile, '更新管理', `发现新版本: ${updateInfo.version} (${updateInfo.version_name})`);

                // 比较版本号
                if (this.isNewerVersion(updateInfo.version)) {
                    log(this.isMobile, '更新管理', '开始执行更新');
                    await this.performUpdate(updateInfo);
                    return true;
                } else {
                    log(this.isMobile, '更新管理', '版本已是最新');
                }
            } else {
                log(this.isMobile, '更新管理', '没有可用更新');
            }

            return false;
        } catch (error) {
            log(this.isMobile, '更新管理', `检查更新失败: ${error}`, 'error');
            return false;
        }
    }

    /**
     * 比较版本号
     */
    private isNewerVersion(newVersion: string): boolean {
        try {
            const current = this.parseVersion(this.localVersion);
            const latest = this.parseVersion(newVersion);
            
            for (let i = 0; i < Math.max(current.length, latest.length); i++) {
                const currentPart = current[i] || 0;
                const latestPart = latest[i] || 0;
                
                if (latestPart > currentPart) return true;
                if (latestPart < currentPart) return false;
            }
            
            return false; // 版本相同
        } catch (error) {
            log(this.isMobile, '更新管理', `版本比较失败: ${error}`, 'warn');
            return false;
        }
    }

    /**
     * 解析版本号
     */
    private parseVersion(version: string): number[] {
        return version.split('.').map(part => {
            const num = parseInt(part.replace(/[^0-9]/g, ''), 10);
            return isNaN(num) ? 0 : num;
        });
    }

    /**
     * 执行更新
     */
    private async performUpdate(updateInfo: UpdateInfo): Promise<void> {
        this.updateInProgress = true;
        
        try {
            log(this.isMobile, '更新管理', `开始更新到版本 ${updateInfo.version}`);

            // 1. 备份重要文件
            await this.backupImportantFiles();

            // 2. 拉取新镜像
            await this.pullNewImage(updateInfo);

            // 3. 更新本地版本号
            await this.updateLocalVersion(updateInfo.version);

            // 4. 重启进程
            await this.restartProcess();

            log(this.isMobile, '更新管理', '更新完成，准备重启');
            
        } catch (error) {
            log(this.isMobile, '更新管理', `更新失败: ${error}`, 'error');
            
            // 恢复备份
            await this.restoreBackup();
            
        } finally {
            this.updateInProgress = false;
        }
    }

    /**
     * 备份重要文件
     */
    private async backupImportantFiles(): Promise<void> {
        try {
            log(this.isMobile, '更新管理', '备份重要文件');
            
            const backupDir = path.join(process.cwd(), 'backup', new Date().toISOString().replace(/[:.]/g, '-'));
            fs.mkdirSync(backupDir, { recursive: true });

            // 备份配置文件
            const configPath = path.join(process.cwd(), 'src', 'config.json');
            if (fs.existsSync(configPath)) {
                fs.copyFileSync(configPath, path.join(backupDir, 'config.json'));
            }

            // 备份sessions目录
            const sessionsPath = path.join(process.cwd(), 'sessions');
            if (fs.existsSync(sessionsPath)) {
                this.copyDirectory(sessionsPath, path.join(backupDir, 'sessions'));
            }

            log(this.isMobile, '更新管理', `备份完成: ${backupDir}`);
        } catch (error) {
            log(this.isMobile, '更新管理', `备份失败: ${error}`, 'error');
            throw error;
        }
    }

    /**
     * 复制目录
     */
    private copyDirectory(src: string, dest: string): void {
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }

        const items = fs.readdirSync(src);
        for (const item of items) {
            const srcPath = path.join(src, item);
            const destPath = path.join(dest, item);
            
            if (fs.statSync(srcPath).isDirectory()) {
                this.copyDirectory(srcPath, destPath);
            } else {
                fs.copyFileSync(srcPath, destPath);
            }
        }
    }

    /**
     * 删除目录（兼容性方法）
     */
    private removeDirectory(dirPath: string): void {
        if (fs.existsSync(dirPath)) {
            const items = fs.readdirSync(dirPath);
            for (const item of items) {
                const fullPath = path.join(dirPath, item);
                if (fs.statSync(fullPath).isDirectory()) {
                    this.removeDirectory(fullPath);
                } else {
                    fs.unlinkSync(fullPath);
                }
            }
            fs.rmdirSync(dirPath);
        }
    }

    /**
     * 拉取新镜像
     */
    private async pullNewImage(updateInfo: UpdateInfo): Promise<void> {
        try {
            log(this.isMobile, '更新管理', '拉取新Docker镜像');

            // 拉取新镜像
            const pullCmd = `docker pull ${updateInfo.image_name}`;
            const result = await execAsync(pullCmd);
            
            if (result.stderr && !result.stderr.includes('Downloaded newer image')) {
                log(this.isMobile, '更新管理', `拉取镜像失败: ${result.stderr}`, 'error');
                throw new Error(`拉取镜像失败: ${result.stderr}`);
            }

            log(this.isMobile, '更新管理', '新镜像拉取成功');
        } catch (error) {
            log(this.isMobile, '更新管理', `拉取镜像失败: ${error}`, 'error');
            throw error;
        }
    }

    /**
     * 更新本地版本号
     */
    private async updateLocalVersion(newVersion: string): Promise<void> {
        try {
            log(this.isMobile, '更新管理', `更新本地版本号到: ${newVersion}`);
            
            // 更新package.json中的版本号
            const packagePath = path.join(process.cwd(), 'package.json');
            if (fs.existsSync(packagePath)) {
                const packageData = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
                packageData.version = newVersion;
                fs.writeFileSync(packagePath, JSON.stringify(packageData, null, 2));
            }

            this.localVersion = newVersion;
        } catch (error) {
            log(this.isMobile, '更新管理', `更新版本号失败: ${error}`, 'error');
            throw error;
        }
    }

    /**
     * 重启进程
     */
    private async restartProcess(): Promise<void> {
        try {
            log(this.isMobile, '更新管理', '准备重启进程');
            
            // 延迟重启，让日志输出完成
            setTimeout(() => {
                process.exit(0);
            }, 2000);
            
        } catch (error) {
            log(this.isMobile, '更新管理', `重启失败: ${error}`, 'error');
            throw error;
        }
    }

    /**
     * 恢复备份
     */
    private async restoreBackup(): Promise<void> {
        try {
            log(this.isMobile, '更新管理', '恢复备份文件');
            
            const backupDir = path.join(process.cwd(), 'backup');
            if (fs.existsSync(backupDir)) {
                const backups = fs.readdirSync(backupDir).sort().reverse();
                if (backups.length > 0) {
                    const latestBackup = path.join(backupDir, backups[0]!);
                    
                    // 恢复配置文件
                    const configBackup = path.join(latestBackup, 'config.json');
                    if (fs.existsSync(configBackup)) {
                        fs.copyFileSync(configBackup, path.join(process.cwd(), 'src', 'config.json'));
                    }

                    // 恢复sessions目录
                    const sessionsBackup = path.join(latestBackup, 'sessions');
                    if (fs.existsSync(sessionsBackup)) {
                        const sessionsPath = path.join(process.cwd(), 'sessions');
                        if (fs.existsSync(sessionsPath)) {
                            this.removeDirectory(sessionsPath);
                        }
                        this.copyDirectory(sessionsBackup, sessionsPath);
                    }

                    log(this.isMobile, '更新管理', '备份恢复完成');
                }
            }
        } catch (error) {
            log(this.isMobile, '更新管理', `恢复备份失败: ${error}`, 'error');
        }
    }

    /**
     * 获取当前版本
     */
    getCurrentVersion(): string {
        return this.localVersion;
    }

    /**
     * 检查是否正在更新
     */
    isUpdating(): boolean {
        return this.updateInProgress;
    }
}
