@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

set IMAGE_NAME=local/bot-node-base:latest
set COMPOSE_FILE=docker-compose.generated.yaml
set DOCKERFILE_PATH=.\Dockerfile
set SIMPLE_DOCKERFILE_PATH=.\Dockerfile.simple
set DEFAULT_SERVER_URL=https://bot.2020310.xyz/

echo ========================================
echo    mic-bot-node Windows 部署脚本
echo ========================================

if "%1"=="deploy" goto :deploy
if "%1"=="build" goto :build
if "%1"=="start" goto :start
if "%1"=="stop" goto :stop
if "%1"=="restart" goto :restart
if "%1"=="logs" goto :logs
if "%1"=="clean" goto :clean
if "%1"=="status" goto :status

echo 用法: %0 [命令]
echo 命令: deploy, build, start, stop, restart, logs, clean, status
goto :end

:deploy
echo 完整部署流程

set /p node_count="请输入要部署的节点数量 (1-10): "

if "!node_count!"=="" goto :deploy
if !node_count! LSS 1 goto :deploy
if !node_count! GTR 10 goto :deploy

echo 将创建 !node_count! 个节点

for /L %%i in (1,1,%node_count%) do (
    call :create_node_config %%i
)

call :build
call :generate_compose
call :show_completion_info
goto :end

:create_node_config
set node_num=%1
set node_name=node-!node_num!
set node_dir=!node_name!
set config_file=!node_dir!\config.json
set sessions_dir=!node_dir!\sessions

echo 创建节点 !node_num!: !node_name!

if exist "!node_dir!" (
    echo 警告: 节点目录已存在: !node_dir!
    set /p overwrite="是否覆盖现有配置? (y/N): "
    if /i not "!overwrite!"=="y" (
        echo 跳过节点 !node_num!
        goto :eof
    )
)

if not exist "!node_dir!" mkdir "!node_dir!"
if not exist "!sessions_dir!" mkdir "!sessions_dir!"

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
echo         "updateUrl": "%DEFAULT_SERVER_URL%",
echo         "token": "your-token-here",
echo         "nodeName": "!node_name!",
echo         "heartbeatInterval": "45s",
echo         "heartbeatTimeout": "10m"
echo     },
echo     "hotSearchApi": {
echo         "enabled": true,
echo         "baseUrl": "https://hots.237890.xyz"
echo     },
echo     "logPush": {
echo         "enabled": false,
echo         "serverUrl": "%DEFAULT_SERVER_URL%web_api/logs/receive",
echo         "token": "your-token-here",
echo         "interval": 30
echo     }
echo }
) > "!config_file!"

echo 节点 !node_num! 创建完成: !node_dir!
goto :eof

:show_completion_info
echo.
echo 部署完成！
echo ================

set node_count=0
for /d %%i in (node-*) do (
    set /a node_count+=1
    echo   %%i
)

echo.
echo 重要提醒:
echo 1. 请编辑每个节点的配置文件，修改以下内容:
echo    - token: 设置正确的认证令牌
echo    - updateUrl: 设置正确的服务器地址
echo.
echo 2. 配置文件位置:
for /d %%i in (node-*) do (
    echo    - %%i\config.json
)

echo.
echo 启动命令:
echo start.bat start
echo.
echo 其他常用命令:
echo 查看日志: start.bat logs
echo 停止服务: start.bat stop
echo 重启服务: start.bat restart
echo 清理资源: start.bat clean
goto :eof

:build
echo 构建通用业务镜像: %IMAGE_NAME%
if not exist "%DOCKERFILE_PATH%" (
    echo 错误: Dockerfile 不存在: %DOCKERFILE_PATH%
    pause
    exit /b 1
)

echo 尝试使用标准 Dockerfile 构建...
docker build -f "%DOCKERFILE_PATH%" -t "%IMAGE_NAME%" .
if errorlevel 1 (
    echo 标准 Dockerfile 构建失败，尝试使用简化版...
    if exist "%SIMPLE_DOCKERFILE_PATH%" (
        echo 使用简化版 Dockerfile 构建...
        docker build -f "%SIMPLE_DOCKERFILE_PATH%" -t "%IMAGE_NAME%" .
        if errorlevel 1 (
            echo 简化版 Dockerfile 构建也失败
            echo 请检查网络连接或手动构建镜像
            pause
            exit /b 1
        )
        echo 简化版镜像构建成功
    ) else (
        echo 简化版 Dockerfile 不存在: %SIMPLE_DOCKERFILE_PATH%
        echo 镜像构建失败
        pause
        exit /b 1
    )
) else (
    echo 标准镜像构建成功
)
goto :eof

:generate_compose
echo 生成 docker-compose 文件: %COMPOSE_FILE%

(
echo version: '3.8'
echo.
echo services:
) > "%COMPOSE_FILE%"

set node_count=0
for /d %%i in (node-*) do (
    set name=%%i
    
    REM 跳过模板目录
    if "!name!"=="node-template" (
        echo 跳过模板目录: !name!
    ) else (
        set /a node_count+=1
        set config_path=./%%i/config.json
        
        if exist "!config_path!" (
            (
            echo   !name!:
            echo     image: %IMAGE_NAME%
            echo     container_name: !name!
            echo     restart: unless-stopped
            echo     volumes:
            echo       - ./!name!/config.json:/app/dist/config.json:ro
            echo       - ./!name!/sessions:/app/sessions
            echo     environment:
            echo       TZ: "Asia/Shanghai"
            echo       NODE_ENV: "production"
            echo     dns:
            echo       - 8.8.8.8
            echo       - 1.1.1.1
            echo     mem_limit: 2g
            echo     cpus: 2
            echo     security_opt:
            echo       - no-new-privileges:true
            echo.
            ) >> "%COMPOSE_FILE%"
        ) else (
            echo 警告: 节点 !name! 的配置文件不存在: !config_path!
        )
    )
)

if !node_count! EQU 0 (
    echo 警告: 未找到任何有效的节点目录
) else (
    echo docker-compose 文件生成完成: %COMPOSE_FILE% (包含 !node_count! 个节点)
)
goto :eof

:start
echo 启动所有节点服务
if not exist "%COMPOSE_FILE%" (
    echo 错误: docker-compose 文件不存在: %COMPOSE_FILE%
    echo 请先运行: %0 build
    pause
    exit /b 1
)

docker-compose -f "%COMPOSE_FILE%" up -d
if errorlevel 1 (
    echo 服务启动失败
    pause
    exit /b 1
)

echo 服务启动成功
goto :eof

:stop
echo 停止所有节点服务
if not exist "%COMPOSE_FILE%" (
    echo 错误: docker-compose 文件不存在: %COMPOSE_FILE%
    pause
    exit /b 1
)

docker-compose -f "%COMPOSE_FILE%" stop
echo 服务停止成功
goto :eof

:restart
echo 重启所有节点服务
if not exist "%COMPOSE_FILE%" (
    echo 错误: docker-compose 文件不存在: %COMPOSE_FILE%
    pause
    exit /b 1
)

docker-compose -f "%COMPOSE_FILE%" restart
echo 服务重启成功
goto :eof

:logs
echo 查看服务日志
if not exist "%COMPOSE_FILE%" (
    echo 错误: docker-compose 文件不存在: %COMPOSE_FILE%
    pause
    exit /b 1
)

docker-compose -f "%COMPOSE_FILE%" logs -f
goto :eof

:status
echo 查看服务状态
if not exist "%COMPOSE_FILE%" (
    echo 错误: docker-compose 文件不存在: %COMPOSE_FILE%
    pause
    exit /b 1
)

docker-compose -f "%COMPOSE_FILE%" ps
goto :eof

:clean
echo 清理所有资源
echo 这将删除所有容器、镜像和生成的文件
set /p confirm="确认清理? (y/N): "
if /i not "!confirm!"=="y" (
    echo 操作已取消
    goto :end
)

if exist "%COMPOSE_FILE%" (
    docker-compose -f "%COMPOSE_FILE%" down
)

docker rmi "%IMAGE_NAME%" 2>nul

if exist "%COMPOSE_FILE%" del "%COMPOSE_FILE%"

for /d %%i in (node-*) do (
    echo 删除节点目录: %%i
    rmdir /s /q "%%i"
)

echo 清理完成
goto :end

:end
pause
