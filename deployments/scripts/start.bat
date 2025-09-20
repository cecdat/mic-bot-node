@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

set IMAGE_NAME=local/bot-node-base:latest
set COMPOSE_FILE=docker-compose.yaml
set DOCKERFILE_PATH=..\..\deployments\docker\Dockerfile
set SIMPLE_DOCKERFILE_PATH=..\..\deployments\docker\Dockerfile.simple
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
set node_dir=..\..\node\!node_name!
set config_file=!node_dir!\config.json
set sessions_dir=!node_dir!\sessions

echo 检查节点 !node_num!: !node_name!

if exist "!node_dir!" (
    echo ✅ 节点目录 !node_dir! 已存在
    
    if exist "!config_file!" (
        echo ✅ 配置文件 !config_file! 已存在
    ) else (
        echo ⚠️ 配置文件不存在，创建默认配置...
        call :create_default_config "!config_file!" "!node_name!"
    )
    
    if exist "!sessions_dir!" (
        echo ✅ 会话目录 !sessions_dir! 已存在
    ) else (
        echo ⚠️ 会话目录不存在，创建目录...
        mkdir "!sessions_dir!" 2>nul
    )
    
    echo 📋 节点 !node_name! 配置检查完成，跳过创建
    goto :eof
)

echo 🆕 创建新节点 !node_name!...
mkdir "!node_dir!" 2>nul
mkdir "!sessions_dir!" 2>nul

call :create_default_config "!config_file!" "!node_name!"

echo 节点 !node_num! 配置创建完成
goto :eof

:build
echo 构建 Docker 镜像: !IMAGE_NAME!

cd ..\..\

if exist "deployments\docker\Dockerfile" (
    echo 使用标准 Dockerfile 构建...
    docker build -f "deployments\docker\Dockerfile" -t !IMAGE_NAME! .
    if !errorlevel! equ 0 (
        echo 镜像构建成功
    ) else (
        echo 镜像构建失败，尝试简化版本...
        if exist "deployments\docker\Dockerfile.simple" (
            echo 使用简化 Dockerfile 构建...
            docker build -f "deployments\docker\Dockerfile.simple" -t !IMAGE_NAME! .
            if !errorlevel! equ 0 (
                echo 简化版本镜像构建成功
            ) else (
                echo 简化版本镜像构建失败
                goto :end
            )
        ) else (
            echo 简化版本 Dockerfile 不存在
            goto :end
        )
    )
) else (
    echo Dockerfile 不存在: deployments\docker\Dockerfile
    goto :end
)

cd deployments\scripts\
goto :eof

:generate_compose
echo 生成 Docker Compose 文件: !COMPOSE_FILE!

cd ..\..\
set project_root=!cd!
cd deployments\scripts\

set compose_file=..\..\!COMPOSE_FILE!

echo version: '3.8' > "!compose_file!"
echo. >> "!compose_file!"
echo services: >> "!compose_file!"

for /L %%i in (1,1,%node_count%) do (
    set node_name=node-%%i
    echo   !node_name!: >> "!compose_file!"
    echo     image: !IMAGE_NAME! >> "!compose_file!"
    echo     container_name: mic-bot-!node_name! >> "!compose_file!"
    echo     restart: unless-stopped >> "!compose_file!"
    echo     volumes: >> "!compose_file!"
    echo       - !project_root!\node\!node_name!\config.json:/app/config.json:ro >> "!compose_file!"
    echo       - !project_root!\node\!node_name!\sessions:/app/sessions >> "!compose_file!"
    echo     environment: >> "!compose_file!"
    echo       - NODE_ENV=production >> "!compose_file!"
    echo     networks: >> "!compose_file!"
    echo       - bot-network >> "!compose_file!"
    echo. >> "!compose_file!"
)

echo networks: >> "!compose_file!"
echo   bot-network: >> "!compose_file!"
echo     driver: bridge >> "!compose_file!"

echo Docker Compose 文件生成完成
goto :eof

:start
echo 启动服务...
cd ..\..\
docker-compose -f !COMPOSE_FILE! up -d
cd deployments\scripts\
goto :end

:stop
echo 停止服务...
cd ..\..\
docker-compose -f !COMPOSE_FILE! down
cd deployments\scripts\
goto :end

:restart
echo 重启服务...
cd ..\..\
docker-compose -f !COMPOSE_FILE! restart
cd deployments\scripts\
goto :end

:logs
echo 查看日志...
cd ..\..\
docker-compose -f !COMPOSE_FILE! logs -f
cd deployments\scripts\
goto :end

:clean
echo 清理资源...
cd ..\..\
docker-compose -f !COMPOSE_FILE! down -v
docker system prune -f
cd deployments\scripts\
goto :end

:status
echo 查看服务状态...
cd ..\..\
docker-compose -f !COMPOSE_FILE! ps
cd deployments\scripts\
goto :end

:show_completion_info
echo.
echo ========================================
echo           部署完成！
echo ========================================
echo 已部署 %node_count% 个节点:
for /L %%i in (1,1,%node_count%) do (
    echo   - node-%%i
)
echo.
echo 重要提醒:
echo 1. 请编辑每个节点的配置文件，修改以下内容：
echo    - token：设置正确的认证令牌
echo    - updateUrl：设置正确的服务器地址
echo.
echo 2. 配置文件位置:
for /L %%i in (1,1,%node_count%) do (
    echo    - ..\..\node\node-%%i\config.json
)
echo.
echo 3. 常用命令:
echo    查看日志: docker-compose -f ..\..\!COMPOSE_FILE! logs
echo    停止服务: docker-compose -f ..\..\!COMPOSE_FILE! down
echo    重启服务: docker-compose -f ..\..\!COMPOSE_FILE! restart
echo.
goto :eof

:create_default_config
set config_file=%~1
set node_name=%~2

echo {> "!config_file!"
echo   "apiServer": {>> "!config_file!"
echo     "enabled": true,>> "!config_file!"
echo     "updateUrl": "!DEFAULT_SERVER_URL!",>> "!config_file!"
echo     "token": "YOUR_TOKEN_HERE",>> "!config_file!"
echo     "nodeName": "!node_name!",>> "!config_file!"
echo     "heartbeatInterval": "5m",>> "!config_file!"
echo     "heartbeatTimeout": "30s">> "!config_file!"
echo   },>> "!config_file!"
echo   "browser": {>> "!config_file!"
echo     "headless": true,>> "!config_file!"
echo     "slowMo": 100,>> "!config_file!"
echo     "timeout": 30000>> "!config_file!"
echo   },>> "!config_file!"
echo   "workers": {>> "!config_file!"
echo     "doSearch": true,>> "!config_file!"
echo     "doDailyCheckIn": true,>> "!config_file!"
echo     "doPunchCards": true,>> "!config_file!"
echo     "doDesktopSearch": true,>> "!config_file!"
echo     "doMobileSearch": true,>> "!config_file!"
echo     "doThisOrThat": true,>> "!config_file!"
echo     "doQuiz": true,>> "!config_file!"
echo     "doABC": true,>> "!config_file!"
echo     "doReadToEarn": true,>> "!config_file!"
echo     "doUrlReward": true>> "!config_file!"
echo   },>> "!config_file!"
echo   "search": {>> "!config_file!"
echo     "delayMin": 1000,>> "!config_file!"
echo     "delayMax": 3000,>> "!config_file!"
echo     "searchTerms": []>> "!config_file!"
echo   },>> "!config_file!"
echo   "snapshots": {>> "!config_file!"
echo     "taskExecution": false,>> "!config_file!"
echo     "searchResults": false>> "!config_file!"
echo   }>> "!config_file!"
echo }>> "!config_file!"
goto :eof

:end
pause