#!/bin/bash
set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# 配置变量
IMAGE_NAME="local/bot-node-base:latest"
COMPOSE_FILE="docker-compose.generated.yaml"
DOCKERFILE_PATH="./Dockerfile"
SIMPLE_DOCKERFILE_PATH="./Dockerfile.simple"
DEFAULT_SERVER_URL="https://bot.2020310.xyz/"

# 颜色输出函数
print_color() {
    local color=$1
    local message=$2
    echo -e "${color}${message}${NC}"
}

# 错误处理函数
handle_error() {
    print_color $RED "❌ 错误: $1"
    exit 1
}

# 检查 Docker 是否运行
check_docker() {
    if ! docker version >/dev/null 2>&1; then
        handle_error "Docker 未运行或未安装，请先启动 Docker"
    fi
}

# 创建节点配置
create_node_config() {
    local node_num=$1
    local node_name="node-$node_num"
    local node_dir="$node_name"
    local config_file="$node_dir/config.json"
    local sessions_dir="$node_dir/sessions"
    
    print_color $CYAN ">>> 创建节点 $node_num: $node_name"
    
    # 创建节点目录
    if [ -d "$node_dir" ]; then
        print_color $YELLOW "⚠️  警告: 节点目录已存在: $node_dir"
        read -p "是否覆盖现有配置? (y/N): " overwrite
        if [[ ! "$overwrite" =~ ^[Yy]$ ]]; then
            print_color $RED "❌ 跳过节点 $node_num"
            return
        fi
    fi
    
    mkdir -p "$node_dir"
    mkdir -p "$sessions_dir"
    
    # 生成配置文件
    cat > "$config_file" <<EOL
{
    "baseURL": "https://rewards.bing.com",
    "sessionPath": "sessions",
    "headless": true,
    "parallel": false,
    "runOnZeroPoints": false,
    "debug": false,
    "snapshots": {
        "login": false,
        "taskExecution": false,
        "cookies": false
    },
    "debugOptions": {
        "saveTaskDebugInfo": false,
        "saveTaskScreenshots": false,
        "saveTaskHtml": false,
        "logTaskDetails": false
    },
    "saveFingerprint": {
        "mobile": false,
        "desktop": false
    },
    "recording": {
        "enableVideo": false,
        "enableHar": false,
        "videoDir": "sessions/task_videos",
        "videoSize": {
            "width": 1280,
            "height": 720
        }
    },
    "workers": {
        "doDailySet": true,
        "doMorePromotions": true,
        "doPunchCards": true,
        "doDesktopSearch": true,
        "doMobileSearch": true,
        "doDailyCheckIn": true,
        "doReadToEarn": true
    },
    "searchOnBingLocalQueries": true,
    "globalTimeout": "30s",
    "navigationTimeout": "120s",
    "apiServer": {
        "enabled": true,
        "updateUrl": "$DEFAULT_SERVER_URL",
        "token": "your-token-here",
        "nodeName": "$node_name",
        "heartbeatInterval": "45s",
        "heartbeatTimeout": "10m"
    },
    "hotSearchApi": {
        "enabled": true,
        "baseUrl": "https://hots.237890.xyz"
    },
    "logPush": {
        "enabled": false,
        "serverUrl": "${DEFAULT_SERVER_URL}web_api/logs/receive",
        "token": "your-token-here",
        "interval": 30
    }
}
EOL
    
    print_color $GREEN "✅ 节点 $node_num 创建完成: $node_dir"
}

# 构建镜像
build_image() {
    print_color $CYAN ">>> 构建通用业务镜像: $IMAGE_NAME"
    
    if [ ! -f "$DOCKERFILE_PATH" ]; then
        handle_error "Dockerfile 不存在: $DOCKERFILE_PATH"
    fi
    
    print_color $YELLOW "尝试使用标准 Dockerfile 构建..."
    if docker build -f "$DOCKERFILE_PATH" -t "$IMAGE_NAME" .; then
        print_color $GREEN "✅ 标准镜像构建成功"
    else
        print_color $YELLOW "标准 Dockerfile 构建失败，尝试使用简化版..."
        if [ -f "$SIMPLE_DOCKERFILE_PATH" ]; then
            print_color $YELLOW "使用简化版 Dockerfile 构建..."
            if docker build -f "$SIMPLE_DOCKERFILE_PATH" -t "$IMAGE_NAME" .; then
                print_color $GREEN "✅ 简化版镜像构建成功"
            else
                handle_error "简化版 Dockerfile 构建也失败"
            fi
        else
            handle_error "简化版 Dockerfile 不存在: $SIMPLE_DOCKERFILE_PATH"
        fi
    fi
}

# 生成 docker-compose 文件
generate_compose_file() {
    print_color $CYAN ">>> 生成 docker-compose 文件: $COMPOSE_FILE"
    
    # 创建 compose 文件头部
    cat > "$COMPOSE_FILE" <<EOL
version: '3.8'

services:
EOL
    
    # 遍历 node-* 目录生成服务
    local node_count=0
    for dir in node-*; do
        if [ -d "$dir" ]; then
            local name=$(basename "$dir")
            local config_path="./$dir/config.json"
            
            # 跳过模板目录
            if [ "$name" = "node-template" ]; then
                print_color $YELLOW "⚠️  跳过模板目录: $name"
                continue
            fi
            
            # 检查配置文件是否存在
            if [ ! -f "$config_path" ]; then
                print_color $YELLOW "⚠️  警告: 节点 $name 的配置文件不存在: $config_path"
                continue
            fi
            
            # 添加服务配置
            cat >> "$COMPOSE_FILE" <<EOL
  $name:
    image: $IMAGE_NAME
    container_name: $name
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

EOL
            ((node_count++))
        fi
    done
    
    if [ $node_count -eq 0 ]; then
        print_color $YELLOW "⚠️  警告: 未找到任何有效的节点目录"
    else
        print_color $GREEN "✅ docker-compose 文件生成完成: $COMPOSE_FILE (包含 $node_count 个节点)"
    fi
}

# 显示部署完成信息
show_completion_info() {
    print_color $GREEN ""
    print_color $GREEN "🎉 部署完成！"
    print_color $GREEN "================"
    print_color $GREEN ""
    
    # 统计节点数量
    local node_count=$(ls -d node-* 2>/dev/null | wc -l)
    print_color $CYAN "📊 已创建 $node_count 个节点:"
    
    for dir in node-*; do
        if [ -d "$dir" ]; then
            print_color $GREEN "  ✅ $dir"
        fi
    done
    
    print_color $YELLOW ""
    print_color $YELLOW "⚠️  重要提醒:"
    print_color $YELLOW "1. 请编辑每个节点的配置文件，修改以下内容:"
    print_color $YELLOW "   - token: 设置正确的认证令牌"
    print_color $YELLOW "   - updateUrl: 设置正确的服务器地址"
    print_color $YELLOW ""
    print_color $YELLOW "2. 配置文件位置:"
    for dir in node-*; do
        if [ -d "$dir" ]; then
            print_color $YELLOW "   - $dir/config.json"
        fi
    done
    
    print_color $CYAN ""
    print_color $CYAN "🚀 启动命令:"
    print_color $CYAN "docker-compose -f $COMPOSE_FILE up -d"
    print_color $CYAN ""
    print_color $CYAN "📋 其他常用命令:"
    print_color $CYAN "查看日志: docker-compose -f $COMPOSE_FILE logs -f"
    print_color $CYAN "停止服务: docker-compose -f $COMPOSE_FILE stop"
    print_color $CYAN "重启服务: docker-compose -f $COMPOSE_FILE restart"
    print_color $CYAN "删除服务: docker-compose -f $COMPOSE_FILE down"
}

# 主程序
main() {
    print_color $BLUE "========================================"
    print_color $BLUE "    mic-bot-node Linux 部署脚本"
    print_color $BLUE "========================================"
    print_color $BLUE ""
    
    # 检查 Docker
    check_docker
    
    # 获取节点数量
    print_color $CYAN "请输入要部署的节点数量:"
    read -p "节点数量 (1-10): " node_count
    
    # 验证输入
    if ! [[ "$node_count" =~ ^[0-9]+$ ]] || [ "$node_count" -lt 1 ] || [ "$node_count" -gt 10 ]; then
        handle_error "节点数量必须是 1-10 之间的数字"
    fi
    
    print_color $GREEN ">>> 将创建 $node_count 个节点"
    print_color $BLUE ""
    
    # 创建节点配置
    for ((i=1; i<=node_count; i++)); do
        create_node_config $i
    done
    
    print_color $BLUE ""
    
    # 构建镜像
    build_image
    
    # 生成 compose 文件
    generate_compose_file
    
    # 显示完成信息
    show_completion_info
}

# 运行主程序
main


