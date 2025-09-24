@echo off
setlocal enabledelayedexpansion

REM Mic-Bot Node 构建脚本 (Windows)
REM 自动递增版本号并构建项目

echo 🚀 开始构建 Mic-Bot Node...

REM 进入应用目录
cd app

REM 检查 Node.js 版本
echo 📋 检查 Node.js 版本...
node --version
npm --version

REM 安装依赖
echo 📦 安装依赖...
npm install

REM 递增版本号并构建
echo 🔄 递增版本号并构建...
npm run build

REM 显示构建结果
echo ✅ 构建完成！
echo 📋 构建信息：
if exist "build-info.json" (
    type build-info.json
) else (
    echo    未找到构建信息文件
)

echo 🎉 构建成功完成！
pause
