@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

REM mic-bot-node 节点创建脚本 (批处理版本)

if "%1"=="" goto :show_help
if "%1"=="help" goto :show_help
if "%1"=="-h" goto :show_help
if "%1"=="--help" goto :show_help

set NODE_NAME=%1
set TOKEN=%2
set SERVER_URL=%3

if "%SERVER_URL%"=="" set SERVER_URL=http://host.docker.internal:2003/

echo.
echo ========================================
echo    mic-bot-node 节点创建脚本
echo ========================================
echo.

echo >>> 创建节点: %NODE_NAME%
set NODE_DIR=node-%NODE_NAME%
set CONFIG_FILE=%NODE_DIR%\config.json
set SESSIONS_DIR=%NODE_DIR%\sessions

echo 节点目录: %NODE_DIR%

REM 检查节点是否已存在
if exist "%NODE_DIR%" (
    echo ⚠️  警告: 节点目录已存在: %NODE_DIR%
    set /p overwrite="是否覆盖现有配置? (y/N): "
    if /i not "!overwrite!"=="y" (
        echo ❌ 操作已取消
        pause
        exit /b 1
    )
)

REM 创建节点目录
if not exist "%NODE_DIR%" (
    mkdir "%NODE_DIR%" >nul 2>&1
    echo 📁 创建节点目录: %NODE_DIR%
)

REM 创建 sessions 目录
if not exist "%SESSIONS_DIR%" (
    mkdir "%SESSIONS_DIR%" >nul 2>&1
    echo 📁 创建 sessions 目录: %SESSIONS_DIR%
)

REM 生成配置文件
echo 📄 创建配置文件: %CONFIG_FILE%

REM 创建 JSON 配置文件
(
echo {
echo     "baseURL": "https://rewards.bing.com",
echo     "sessionPath": "sessions",
echo     "headless": true,
echo     "parallel": false,
echo     "runOnZeroPoints": false,
echo     "debug": false,
echo     "snapshots": {
echo         "login": false,
echo         "taskExecution": false,
echo         "cookies": false
echo     },
echo     "debugOptions": {
echo         "saveTaskDebugInfo": false,
echo         "saveTaskScreenshots": false,
echo         "saveTaskHtml": false,
echo         "logTaskDetails": false
echo     },
echo     "saveFingerprint": {
echo         "mobile": false,
echo         "desktop": false
echo     },
echo     "recording": {
echo         "enableVideo": false,
echo         "enableHar": false,
echo         "videoDir": "sessions/task_videos",
echo         "videoSize": {
echo             "width": 1280,
echo             "height": 720
echo         }
echo     },
echo     "workers": {
echo         "doDailySet": true,
echo         "doMorePromotions": true,
echo         "doPunchCards": true,
echo         "doDesktopSearch": true,
echo         "doMobileSearch": true,
echo         "doDailyCheckIn": true,
echo         "doReadToEarn": true
echo     },
echo     "searchOnBingLocalQueries": true,
echo     "globalTimeout": "30s",
echo     "navigationTimeout": "120s",
echo     "apiServer": {
echo         "enabled": true,
echo         "updateUrl": "%SERVER_URL%",
echo         "token": "%TOKEN%",
echo         "nodeName": "%NODE_NAME%",
echo         "heartbeatInterval": "45s",
echo         "heartbeatTimeout": "10m"
echo     },
echo     "hotSearchApi": {
echo         "enabled": true,
echo         "baseUrl": "https://hots.237890.xyz"
echo     },
echo     "logPush": {
echo         "enabled": false,
echo         "serverUrl": "%SERVER_URL%web_api/logs/receive",
echo         "token": "%TOKEN%",
echo         "interval": 30
echo     }
echo }
) > "%CONFIG_FILE%"

echo.
echo ✅ 节点创建完成!
echo.
echo 下一步操作:
echo 1. 编辑配置文件: %CONFIG_FILE%
echo 2. 修改 token 和其他配置项
echo 3. 运行部署脚本:
echo    start.bat build
echo    start.bat start
echo.

if "%TOKEN%"=="" (
    echo ⚠️  注意: 请记得在配置文件中设置正确的 token
)

pause
goto :end

:show_help
echo 用法: %0 ^<节点名称^> [token] [server_url]
echo.
echo 参数:
echo   节点名称    必需，节点名称 (例如: 1, 2, test)
echo   token       可选，服务端认证令牌
echo   server_url  可选，服务端地址 (默认: http://host.docker.internal:2003/)
echo.
echo 示例:
echo   %0 1                                    # 创建 node-1
echo   %0 2 your-token-here                   # 创建 node-2 并设置 token
echo   %0 test your-token https://server.com/ # 创建 node-test 并设置完整配置
echo.
echo 注意: 节点名称只能包含字母、数字、下划线和连字符
goto :end

:end
