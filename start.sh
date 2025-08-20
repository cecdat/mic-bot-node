#!/bin/bash

# Node端启动脚本
# 用于在更新后重启服务

echo "启动 mic-bot-node..."

# 检查是否已经构建
if [ ! -d "dist" ]; then
    echo "构建项目..."
    npm run build
fi

# 启动服务
echo "启动服务..."
npm start
