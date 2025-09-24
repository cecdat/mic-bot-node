#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

/**
 * 版本号自动递增脚本
 */
class VersionBumper {
    constructor() {
        this.packageJsonPath = path.join(__dirname, '../package.json');
        this.versionFile = path.join(__dirname, '../version.json');
    }

    /**
     * 读取当前版本号
     */
    readCurrentVersion() {
        try {
            const packageJson = JSON.parse(fs.readFileSync(this.packageJsonPath, 'utf8'));
            return packageJson.version;
        } catch (error) {
            console.error('读取 package.json 失败:', error);
            return '1.0.0';
        }
    }

    /**
     * 读取构建号
     */
    readBuildNumber() {
        try {
            if (fs.existsSync(this.versionFile)) {
                const versionData = JSON.parse(fs.readFileSync(this.versionFile, 'utf8'));
                return versionData.buildNumber || 0;
            }
        } catch (error) {
            console.warn('读取版本文件失败，使用默认构建号:', error);
        }
        return 0;
    }

    /**
     * 递增构建号
     */
    incrementBuildNumber() {
        const currentBuildNumber = this.readBuildNumber();
        const newBuildNumber = currentBuildNumber + 1;
        
        // 保存构建号到版本文件
        const versionData = {
            buildNumber: newBuildNumber,
            lastBuildTime: new Date().toISOString(),
            version: this.readCurrentVersion()
        };
        
        fs.writeFileSync(this.versionFile, JSON.stringify(versionData, null, 2));
        return newBuildNumber;
    }

    /**
     * 递增版本号（主版本、次版本或修订版本）
     */
    incrementVersion(type = 'patch') {
        const currentVersion = this.readCurrentVersion();
        const versionParts = currentVersion.split('.').map(Number);
        
        switch (type) {
            case 'major':
                versionParts[0]++;
                versionParts[1] = 0;
                versionParts[2] = 0;
                break;
            case 'minor':
                versionParts[1]++;
                versionParts[2] = 0;
                break;
            case 'patch':
            default:
                versionParts[2]++;
                break;
        }
        
        const newVersion = versionParts.join('.');
        
        // 更新 package.json
        const packageJson = JSON.parse(fs.readFileSync(this.packageJsonPath, 'utf8'));
        packageJson.version = newVersion;
        fs.writeFileSync(this.packageJsonPath, JSON.stringify(packageJson, null, 2));
        
        return newVersion;
    }

    /**
     * 执行版本递增
     */
    bump(type = 'build') {
        console.log('🔄 开始版本递增...');
        
        let newVersion, newBuildNumber;
        
        if (type === 'build') {
            // 只递增构建号
            newBuildNumber = this.incrementBuildNumber();
            newVersion = this.readCurrentVersion();
            console.log(`✅ 构建号已递增: ${newVersion}.${newBuildNumber}`);
        } else {
            // 递增版本号并重置构建号
            newVersion = this.incrementVersion(type);
            newBuildNumber = this.incrementBuildNumber();
            console.log(`✅ 版本号已递增: ${newVersion}.${newBuildNumber}`);
        }
        
        // 生成构建信息
        const buildInfo = {
            version: newVersion,
            buildNumber: newBuildNumber,
            fullVersion: `${newVersion}.${newBuildNumber}`,
            buildTime: new Date().toISOString(),
            buildType: type
        };
        
        // 保存构建信息到文件
        const buildInfoPath = path.join(__dirname, '../build-info.json');
        fs.writeFileSync(buildInfoPath, JSON.stringify(buildInfo, null, 2));
        
        console.log('📋 构建信息:');
        console.log(`   版本号: ${buildInfo.version}`);
        console.log(`   构建号: ${buildInfo.buildNumber}`);
        console.log(`   完整版本: ${buildInfo.fullVersion}`);
        console.log(`   构建时间: ${buildInfo.buildTime}`);
        
        return buildInfo;
    }
}

// 命令行参数处理
const args = process.argv.slice(2);
const type = args[0] || 'build'; // 默认递增构建号

const bumper = new VersionBumper();
bumper.bump(type);
