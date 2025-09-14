# mic-bot-node 节点创建脚本
# 用于快速创建新的节点配置

param(
    [Parameter(Mandatory=$true)]
    [string]$NodeName,
    
    [string]$Token = "",
    [string]$ServerUrl = "http://host.docker.internal:2003/",
    [switch]$Help
)

# 颜色输出函数
function Write-ColorOutput {
    param(
        [string]$Message,
        [string]$Color = "White"
    )
    Write-Host $Message -ForegroundColor $Color
}

# 显示帮助信息
function Show-Help {
    Write-ColorOutput "mic-bot-node 节点创建脚本" "Cyan"
    Write-ColorOutput "=========================" "Cyan"
    Write-ColorOutput ""
    Write-ColorOutput "用法: .\create-node.ps1 -NodeName <节点名称> [参数]" "White"
    Write-ColorOutput ""
    Write-ColorOutput "必需参数:" "Yellow"
    Write-ColorOutput "  -NodeName    节点名称 (例如: node-1, node-2)" "White"
    Write-ColorOutput ""
    Write-ColorOutput "可选参数:" "Yellow"
    Write-ColorOutput "  -Token       服务端认证令牌" "White"
    Write-ColorOutput "  -ServerUrl   服务端地址 (默认: http://host.docker.internal:2003/)" "White"
    Write-ColorOutput "  -Help        显示此帮助信息" "White"
    Write-ColorOutput ""
    Write-ColorOutput "示例:" "Yellow"
    Write-ColorOutput "  .\create-node.ps1 -NodeName node-1" "White"
    Write-ColorOutput "  .\create-node.ps1 -NodeName node-2 -Token your-token-here" "White"
    Write-ColorOutput "  .\create-node.ps1 -NodeName test-node -ServerUrl https://your-server.com/" "White"
}

# 主程序
function Main {
    if ($Help) {
        Show-Help
        return
    }
    
    # 验证节点名称
    if (-not $NodeName -match '^[a-zA-Z0-9_-]+$') {
        Write-ColorOutput "❌ 错误: 节点名称只能包含字母、数字、下划线和连字符" "Red"
        return
    }
    
    $nodeDir = "node-$NodeName"
    $configFile = "$nodeDir\config.json"
    $sessionsDir = "$nodeDir\sessions"
    
    Write-ColorOutput ">>> 创建节点: $NodeName" "Cyan"
    Write-ColorOutput "节点目录: $nodeDir" "Green"
    
    # 检查节点是否已存在
    if (Test-Path $nodeDir) {
        Write-ColorOutput "⚠️  警告: 节点目录已存在: $nodeDir" "Yellow"
        $overwrite = Read-Host "是否覆盖现有配置? (y/N)"
        if ($overwrite -ne "y" -and $overwrite -ne "Y") {
            Write-ColorOutput "❌ 操作已取消" "Red"
            return
        }
    }
    
    # 创建节点目录
    if (-not (Test-Path $nodeDir)) {
        New-Item -ItemType Directory -Path $nodeDir -Force | Out-Null
        Write-ColorOutput "📁 创建节点目录: $nodeDir" "Green"
    }
    
    # 创建 sessions 目录
    if (-not (Test-Path $sessionsDir)) {
        New-Item -ItemType Directory -Path $sessionsDir -Force | Out-Null
        Write-ColorOutput "📁 创建 sessions 目录: $sessionsDir" "Green"
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
            updateUrl = $ServerUrl
            token = if ($Token) { $Token } else { "your-token-here" }
            nodeName = $NodeName
            heartbeatInterval = "45s"
            heartbeatTimeout = "10m"
        }
        hotSearchApi = @{
            enabled = $true
            baseUrl = "https://hots.237890.xyz"
        }
        logPush = @{
            enabled = $false
            serverUrl = "$ServerUrl" + "web_api/logs/receive"
            token = if ($Token) { $Token } else { "your-token-here" }
            interval = 30
        }
    }
    
    # 转换为 JSON 并写入文件
    $jsonContent = $configContent | ConvertTo-Json -Depth 10
    $jsonContent | Out-File -FilePath $configFile -Encoding UTF8
    
    Write-ColorOutput "📄 创建配置文件: $configFile" "Green"
    
    # 显示下一步操作
    Write-ColorOutput ""
    Write-ColorOutput "✅ 节点创建完成!" "Green"
    Write-ColorOutput ""
    Write-ColorOutput "下一步操作:" "Yellow"
    Write-ColorOutput "1. 编辑配置文件: $configFile" "White"
    Write-ColorOutput "2. 修改 token 和其他配置项" "White"
    Write-ColorOutput "3. 运行部署脚本:" "White"
    Write-ColorOutput "   .\start.ps1 -Build -Start" "Cyan"
    Write-ColorOutput ""
    
    if (-not $Token -or $Token -eq "your-token-here") {
        Write-ColorOutput "⚠️  注意: 请记得在配置文件中设置正确的 token" "Yellow"
    }
}

# 运行主程序
Main
