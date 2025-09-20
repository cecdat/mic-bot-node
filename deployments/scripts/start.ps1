# mic-bot-node Windows 部署脚本
# PowerShell 版本

param(
    [switch]$Build,
    [switch]$Start,
    [switch]$Stop,
    [switch]$Restart,
    [switch]$Logs,
    [switch]$Clean,
    [switch]$Deploy,
    [string]$NodeName = "",
    [int]$NodeCount = 0
)

# 配置变量
$IMAGE_NAME = "local/bot-node-base:latest"
$COMPOSE_FILE = "docker-compose.yaml"
$DOCKERFILE_PATH = "..\..\deployments\docker\Dockerfile"
$SIMPLE_DOCKERFILE_PATH = "..\..\deployments\docker\Dockerfile.simple"
$DEFAULT_SERVER_URL = "http://host.docker.internal:2003/"

# 颜色输出函数
function Write-ColorOutput {
    param(
        [string]$Message,
        [string]$Color = "White"
    )
    Write-Host $Message -ForegroundColor $Color
}

# 错误处理
function Handle-Error {
    param([string]$ErrorMessage)
    Write-ColorOutput "❌ 错误: $ErrorMessage" "Red"
    exit 1
}

# 检查 Docker 是否运行
function Test-DockerRunning {
    try {
        docker version | Out-Null
        return $true
    }
    catch {
        return $false
    }
}

# 构建镜像
function Build-Image {
    Write-ColorOutput ">>> 构建通用业务镜像: $IMAGE_NAME" "Cyan"
    
    if (-not (Test-Path $DOCKERFILE_PATH)) {
        Handle-Error "Dockerfile 不存在: $DOCKERFILE_PATH"
    }
    
    Write-ColorOutput "尝试使用标准 Dockerfile 构建..." "Yellow"
    try {
        docker build -f $DOCKERFILE_PATH -t $IMAGE_NAME .
        Write-ColorOutput "✅ 标准镜像构建成功" "Green"
    }
    catch {
        Write-ColorOutput "标准 Dockerfile 构建失败，尝试使用简化版..." "Yellow"
        if (Test-Path $SIMPLE_DOCKERFILE_PATH) {
            try {
                Write-ColorOutput "使用简化版 Dockerfile 构建..." "Yellow"
                docker build -f $SIMPLE_DOCKERFILE_PATH -t $IMAGE_NAME .
                Write-ColorOutput "✅ 简化版镜像构建成功" "Green"
            }
            catch {
                Handle-Error "简化版 Dockerfile 构建也失败: $_"
            }
        } else {
            Handle-Error "简化版 Dockerfile 不存在: $SIMPLE_DOCKERFILE_PATH"
        }
    }
}

# 生成 docker-compose 文件
function Generate-ComposeFile {
    Write-ColorOutput ">>> 生成 docker-compose 文件: $COMPOSE_FILE" "Cyan"
    
    # 创建 compose 文件头部
    $composeContent = @"
version: '3.8'

services:
"@
    
    # 查找所有 node-* 目录
    $nodeDirs = Get-ChildItem -Path "." -Directory -Name "node-*"
    
    if ($nodeDirs.Count -eq 0) {
        Write-ColorOutput "⚠️  警告: 未找到任何 node-* 目录" "Yellow"
        Write-ColorOutput "请确保在项目根目录下创建 node-1, node-2 等目录" "Yellow"
        return
    }
    
    Write-ColorOutput "📁 发现节点目录: $($nodeDirs -join ', ')" "Green"
    
    # 为每个节点目录生成服务配置
    foreach ($dir in $nodeDirs) {
        $nodeName = $dir
        $configPath = ".\$dir\config.json"
        $sessionsPath = ".\$dir\sessions"
        
        # 检查配置文件是否存在
        if (-not (Test-Path $configPath)) {
            Write-ColorOutput "⚠️  警告: 节点 $nodeName 的配置文件不存在: $configPath" "Yellow"
            continue
        }
        
        # 创建 sessions 目录（如果不存在）
        if (-not (Test-Path $sessionsPath)) {
            New-Item -ItemType Directory -Path $sessionsPath -Force | Out-Null
            Write-ColorOutput "📁 创建 sessions 目录: $sessionsPath" "Green"
        }
        
        # 添加服务配置
        $serviceConfig = @"

  $nodeName`:
    image: $IMAGE_NAME
    container_name: $nodeName
    restart: unless-stopped
    volumes:
      - ./$dir/config.json:/app/dist/config.json:ro
      - ./$dir/sessions:/app/sessions
    environment:
      TZ: "Asia/Shanghai"
      NODE_ENV: "production"
    dns:
      - 8.8.8.8
      - 1.1.1.1
    mem_limit: 2g
    cpus: 2
    security_opt:
      - no-new-privileges:true
"@
        
        $composeContent += $serviceConfig
    }
    
    # 写入文件
    $composeContent | Out-File -FilePath $COMPOSE_FILE -Encoding UTF8
    Write-ColorOutput "✅ docker-compose 文件生成完成: $COMPOSE_FILE" "Green"
}

# 启动服务
function Start-Services {
    param([string]$SpecificNode = "")
    
    if (-not (Test-Path $COMPOSE_FILE)) {
        Write-ColorOutput "❌ docker-compose 文件不存在，请先运行构建" "Red"
        return
    }
    
    Write-ColorOutput ">>> 启动服务..." "Cyan"
    
    try {
        if ($SpecificNode) {
            Write-ColorOutput "🚀 启动节点: $SpecificNode" "Green"
            docker-compose -f $COMPOSE_FILE up -d $SpecificNode
        } else {
            Write-ColorOutput "🚀 启动所有节点" "Green"
            docker-compose -f $COMPOSE_FILE up -d
        }
        Write-ColorOutput "✅ 服务启动成功" "Green"
    }
    catch {
        Handle-Error "服务启动失败: $_"
    }
}

# 停止服务
function Stop-Services {
    param([string]$SpecificNode = "")
    
    if (-not (Test-Path $COMPOSE_FILE)) {
        Write-ColorOutput "❌ docker-compose 文件不存在" "Red"
        return
    }
    
    Write-ColorOutput ">>> 停止服务..." "Cyan"
    
    try {
        if ($SpecificNode) {
            Write-ColorOutput "🛑 停止节点: $SpecificNode" "Yellow"
            docker-compose -f $COMPOSE_FILE stop $SpecificNode
        } else {
            Write-ColorOutput "🛑 停止所有节点" "Yellow"
            docker-compose -f $COMPOSE_FILE stop
        }
        Write-ColorOutput "✅ 服务停止成功" "Green"
    }
    catch {
        Handle-Error "服务停止失败: $_"
    }
}

# 重启服务
function Restart-Services {
    param([string]$SpecificNode = "")
    
    Write-ColorOutput ">>> 重启服务..." "Cyan"
    Stop-Services -SpecificNode $SpecificNode
    Start-Sleep -Seconds 2
    Start-Services -SpecificNode $SpecificNode
}

# 查看日志
function Show-Logs {
    param([string]$SpecificNode = "")
    
    if (-not (Test-Path $COMPOSE_FILE)) {
        Write-ColorOutput "❌ docker-compose 文件不存在" "Red"
        return
    }
    
    Write-ColorOutput ">>> 查看日志..." "Cyan"
    
    try {
        if ($SpecificNode) {
            Write-ColorOutput "📋 显示节点日志: $SpecificNode" "Green"
            docker-compose -f $COMPOSE_FILE logs -f $SpecificNode
        } else {
            Write-ColorOutput "📋 显示所有节点日志" "Green"
            docker-compose -f $COMPOSE_FILE logs -f
        }
    }
    catch {
        Handle-Error "查看日志失败: $_"
    }
}

# 清理资源
function Clean-Resources {
    Write-ColorOutput ">>> 清理资源..." "Cyan"
    
    try {
        # 停止并删除容器
        if (Test-Path $COMPOSE_FILE) {
            Write-ColorOutput "🗑️  停止并删除容器..." "Yellow"
            docker-compose -f $COMPOSE_FILE down
        }
        
        # 删除生成的 compose 文件
        if (Test-Path $COMPOSE_FILE) {
            Remove-Item $COMPOSE_FILE -Force
            Write-ColorOutput "🗑️  删除生成的 compose 文件" "Yellow"
        }
        
        # 删除镜像（可选）
        $deleteImage = Read-Host "是否删除镜像 $IMAGE_NAME? (y/N)"
        if ($deleteImage -eq "y" -or $deleteImage -eq "Y") {
            docker rmi $IMAGE_NAME -f
            Write-ColorOutput "🗑️  删除镜像: $IMAGE_NAME" "Yellow"
        }
        
        Write-ColorOutput "✅ 清理完成" "Green"
    }
    catch {
        Handle-Error "清理失败: $_"
    }
}

# 创建节点配置
function Create-NodeConfig {
    param([int]$NodeNum)
    
    $nodeName = "node-$NodeNum"
    $nodeDir = $nodeName
    $configFile = "$nodeDir\config.json"
    $sessionsDir = "$nodeDir\sessions"
    
    Write-ColorOutput ">>> 创建节点 $NodeNum : $nodeName" "Cyan"
    
    # 创建节点目录
    if (Test-Path $nodeDir) {
        Write-ColorOutput "⚠️  警告: 节点目录已存在: $nodeDir" "Yellow"
        $overwrite = Read-Host "是否覆盖现有配置? (y/N)"
        if ($overwrite -ne "y" -and $overwrite -ne "Y") {
            Write-ColorOutput "❌ 跳过节点 $NodeNum" "Red"
            return
        }
    }
    
    # 创建目录
    if (-not (Test-Path $nodeDir)) {
        New-Item -ItemType Directory -Path $nodeDir -Force | Out-Null
    }
    if (-not (Test-Path $sessionsDir)) {
        New-Item -ItemType Directory -Path $sessionsDir -Force | Out-Null
    }
    
    # 生成配置文件
    $configContent = @{
        baseURL = "https://rewards.bing.com"
        sessionPath = "sessions"
        headless = $true
        parallel = $false
        runOnZeroPoints = $false
        debug = $false
        snapshots = @{
            login = $false
            taskExecution = $false
            cookies = $false
        }
        debugOptions = @{
            saveTaskDebugInfo = $false
            saveTaskScreenshots = $false
            saveTaskHtml = $false
            logTaskDetails = $false
        }
        saveFingerprint = @{
            mobile = $false
            desktop = $false
        }
        recording = @{
            enableVideo = $false
            enableHar = $false
            videoDir = "sessions/task_videos"
            videoSize = @{
                width = 1280
                height = 720
            }
        }
        workers = @{
            doDailySet = $true
            doMorePromotions = $true
            doPunchCards = $true
            doDesktopSearch = $true
            doMobileSearch = $true
            doDailyCheckIn = $true
            doReadToEarn = $true
        }
        searchOnBingLocalQueries = $true
        globalTimeout = "30s"
        navigationTimeout = "120s"
        apiServer = @{
            enabled = $true
            updateUrl = $DEFAULT_SERVER_URL
            token = "your-token-here"
            nodeName = $nodeName
            heartbeatInterval = "45s"
            heartbeatTimeout = "10m"
        }
        hotSearchApi = @{
            enabled = $true
            baseUrl = "https://hots.237890.xyz"
        }
    }
    
    # 转换为 JSON 并写入文件
    $jsonContent = $configContent | ConvertTo-Json -Depth 10
    $jsonContent | Out-File -FilePath $configFile -Encoding UTF8
    
    Write-ColorOutput "✅ 节点 $NodeNum 创建完成: $nodeDir" "Green"
}

# 完整部署流程
function Start-Deployment {
    Write-ColorOutput "========================================" "Blue"
    Write-ColorOutput "    mic-bot-node Windows 部署脚本" "Blue"
    Write-ColorOutput "========================================" "Blue"
    Write-ColorOutput ""
    
    # 检查 Docker
    if (-not (Test-DockerRunning)) {
        Handle-Error "Docker 未运行或未安装，请先启动 Docker Desktop"
    }
    
    # 获取节点数量
    if ($NodeCount -eq 0) {
        Write-ColorOutput "请输入要部署的节点数量:" "Cyan"
        do {
            $input = Read-Host "节点数量 (1-10)"
            if ([int]::TryParse($input, [ref]$NodeCount)) {
                if ($NodeCount -ge 1 -and $NodeCount -le 10) {
                    break
                } else {
                    Write-ColorOutput "节点数量必须是 1-10 之间的数字" "Red"
                }
            } else {
                Write-ColorOutput "请输入有效的数字" "Red"
            }
        } while ($true)
    }
    
    Write-ColorOutput ">>> 将创建 $NodeCount 个节点" "Green"
    Write-ColorOutput ""
    
    # 创建节点配置
    for ($i = 1; $i -le $NodeCount; $i++) {
        Create-NodeConfig -NodeNum $i
    }
    
    Write-ColorOutput ""
    
    # 构建镜像
    Build-Image
    
    # 生成 compose 文件
    Generate-ComposeFile
    
    # 显示完成信息
    Show-CompletionInfo
}

# 显示部署完成信息
function Show-CompletionInfo {
    Write-ColorOutput ""
    Write-ColorOutput "🎉 部署完成！" "Green"
    Write-ColorOutput "================" "Green"
    Write-ColorOutput ""
    
    # 统计节点数量
    $nodeDirs = Get-ChildItem -Path "." -Directory -Name "node-*"
    $nodeCount = $nodeDirs.Count
    
    Write-ColorOutput "📊 已创建 $nodeCount 个节点:" "Cyan"
    foreach ($dir in $nodeDirs) {
        Write-ColorOutput "  ✅ $dir" "Green"
    }
    
    Write-ColorOutput ""
    Write-ColorOutput "⚠️  重要提醒:" "Yellow"
    Write-ColorOutput "1. 请编辑每个节点的配置文件，修改以下内容:" "Yellow"
    Write-ColorOutput "   - token: 设置正确的认证令牌" "Yellow"
    Write-ColorOutput "   - updateUrl: 设置正确的服务器地址" "Yellow"
    Write-ColorOutput ""
    Write-ColorOutput "2. 配置文件位置:" "Yellow"
    foreach ($dir in $nodeDirs) {
        Write-ColorOutput "   - $dir\config.json" "Yellow"
    }
    
    Write-ColorOutput ""
    Write-ColorOutput "🚀 启动命令:" "Cyan"
    Write-ColorOutput ".\start.ps1 -Start" "Cyan"
    Write-ColorOutput ""
    Write-ColorOutput "📋 其他常用命令:" "Cyan"
    Write-ColorOutput "查看日志: .\start.ps1 -Logs" "Cyan"
    Write-ColorOutput "停止服务: .\start.ps1 -Stop" "Cyan"
    Write-ColorOutput "重启服务: .\start.ps1 -Restart" "Cyan"
    Write-ColorOutput "清理资源: .\start.ps1 -Clean" "Cyan"
}

# 显示帮助信息
function Show-Help {
    Write-ColorOutput "mic-bot-node Windows 部署脚本" "Cyan"
    Write-ColorOutput "================================" "Cyan"
    Write-ColorOutput ""
    Write-ColorOutput "用法: .\start.ps1 [参数]" "White"
    Write-ColorOutput ""
    Write-ColorOutput "参数:" "Yellow"
    Write-ColorOutput "  -Deploy     完整部署流程（推荐新手使用）" "White"
    Write-ColorOutput "  -Build      构建 Docker 镜像" "White"
    Write-ColorOutput "  -Start      启动所有节点服务" "White"
    Write-ColorOutput "  -Stop       停止所有节点服务" "White"
    Write-ColorOutput "  -Restart    重启所有节点服务" "White"
    Write-ColorOutput "  -Logs       查看服务日志" "White"
    Write-ColorOutput "  -Clean      清理所有资源" "White"
    Write-ColorOutput "  -NodeName   指定节点名称（配合其他参数使用）" "White"
    Write-ColorOutput "  -NodeCount  指定节点数量（配合 -Deploy 使用）" "White"
    Write-ColorOutput ""
    Write-ColorOutput "示例:" "Yellow"
    Write-ColorOutput "  .\start.ps1 -Deploy                  # 完整部署流程" "White"
    Write-ColorOutput "  .\start.ps1 -Deploy -NodeCount 3     # 部署3个节点" "White"
    Write-ColorOutput "  .\start.ps1 -Build                   # 仅构建镜像" "White"
    Write-ColorOutput "  .\start.ps1 -Start                   # 启动所有节点" "White"
    Write-ColorOutput "  .\start.ps1 -Logs                    # 查看日志" "White"
    Write-ColorOutput "  .\start.ps1 -Clean                   # 清理资源" "White"
    Write-ColorOutput ""
    Write-ColorOutput "快速开始:" "Yellow"
    Write-ColorOutput "  .\start.ps1 -Deploy    # 一键部署" "White"
    Write-ColorOutput "  .\start.ps1 -Start     # 启动服务" "White"
    Write-ColorOutput "  .\start.ps1 -Logs      # 查看日志" "White"
}

# 主程序
function Main {
    # 如果没有参数，显示帮助
    if ($args.Count -eq 0 -and -not $Build -and -not $Start -and -not $Stop -and -not $Restart -and -not $Logs -and -not $Clean -and -not $Deploy) {
        Show-Help
        return
    }
    
    # 执行相应操作
    if ($Deploy) {
        Start-Deployment
    }
    elseif ($Build) {
        Build-Image
        Generate-ComposeFile
    }
    elseif ($Start) {
        Start-Services -SpecificNode $NodeName
    }
    elseif ($Stop) {
        Stop-Services -SpecificNode $NodeName
    }
    elseif ($Restart) {
        Restart-Services -SpecificNode $NodeName
    }
    elseif ($Logs) {
        Show-Logs -SpecificNode $NodeName
    }
    elseif ($Clean) {
        Clean-Resources
    }
    else {
        Show-Help
    }
}

# 运行主程序
Main
