#!/bin/bash

# Mic-Bot Node 构建脚本
# 自动递增版本号并构建项目

set -e

echo "🚀 开始构建 Mic-Bot Node..."

# 进入应用目录
cd app

# 检查 Node.js 版本
echo "📋 检查 Node.js 版本..."
node --version
npm --version

# 安装依赖
echo "📦 安装依赖..."
npm install

# 递增版本号并构建
echo "🔄 递增版本号并构建..."
npm run build

# 显示构建结果
echo "✅ 构建完成！"
echo "📋 构建信息："
if [ -f "build-info.json" ]; then
    cat build-info.json
else
    echo "   未找到构建信息文件"
fi

echo "🎉 构建成功完成！"
