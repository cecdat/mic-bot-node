import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * 版本号管理工具
 */
export class VersionManager {
    private static instance: VersionManager;
    private version: string = '1.5.3';
    private buildNumber: number = 0;

    private constructor() {
        this.loadVersion();
    }

    /**
     * 获取单例实例
     */
    public static getInstance(): VersionManager {
        if (!VersionManager.instance) {
            VersionManager.instance = new VersionManager();
        }
        return VersionManager.instance;
    }

    /**
     * 从 package.json 和构建信息文件加载版本号
     */
    private loadVersion(): void {
        try {
            // 首先尝试从构建信息文件读取
            const buildInfoPath = join(__dirname, '../../build-info.json');
            if (existsSync(buildInfoPath)) {
                const buildInfo = JSON.parse(readFileSync(buildInfoPath, 'utf8'));
                this.version = buildInfo.version || '1.5.3';
                this.buildNumber = buildInfo.buildNumber || 0;
                return;
            }
            
            // 从 package.json 读取基础版本号
            const packagePath = join(__dirname, '../../package.json');
            const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
            this.version = packageJson.version || '1.5.3';
            
            // 尝试从环境变量获取构建号
            this.buildNumber = parseInt(process.env.BUILD_NUMBER || '0');
        } catch (error) {
            console.warn('无法加载版本信息，使用默认版本:', error);
        }
    }

    /**
     * 获取完整版本号
     */
    public getFullVersion(): string {
        if (this.buildNumber > 0) {
            return `${this.version}.${this.buildNumber}`;
        }
        return this.version;
    }

    /**
     * 获取基础版本号
     */
    public getVersion(): string {
        return this.version;
    }

    /**
     * 获取构建号
     */
    public getBuildNumber(): number {
        return this.buildNumber;
    }

    /**
     * 获取版本信息对象
     */
    public getVersionInfo(): {
        version: string;
        buildNumber: number;
        fullVersion: string;
        buildTime: string;
        nodeVersion: string;
    } {
        return {
            version: this.version,
            buildNumber: this.buildNumber,
            fullVersion: this.getFullVersion(),
            buildTime: process.env.BUILD_TIME || new Date().toISOString(),
            nodeVersion: process.version
        };
    }

    /**
     * 显示版本信息
     */
    public displayVersionInfo(): void {
        const info = this.getVersionInfo();
        console.log('╔══════════════════════════════════════════════════════════════╗');
        console.log('║                    Mic-Bot Node 版本信息                      ║');
        console.log('╠══════════════════════════════════════════════════════════════╣');
        console.log(`║  版本号: ${info.fullVersion.padEnd(50)} ║`);
        console.log(`║  构建号: ${info.buildNumber.toString().padEnd(50)} ║`);
        console.log(`║  构建时间: ${info.buildTime.padEnd(48)} ║`);
        console.log(`║  Node版本: ${info.nodeVersion.padEnd(48)} ║`);
        console.log('╚══════════════════════════════════════════════════════════════╝');
    }
}

/**
 * 获取版本管理器实例
 */
export function getVersionManager(): VersionManager {
    return VersionManager.getInstance();
}

/**
 * 快速获取版本号
 */
export function getVersion(): string {
    return getVersionManager().getFullVersion();
}

/**
 * 快速显示版本信息
 */
export function displayVersion(): void {
    getVersionManager().displayVersionInfo();
}
