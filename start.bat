@echo off
REM Node端启动脚本 (Windows)
REM 用于在更新后重启服务

echo 启动 mic-bot-node...

REM 检查是否已经构建
if not exist "dist" (
    echo 构建项目...
    npm run build
)

REM 启动服务
echo 启动服务...
npm start
