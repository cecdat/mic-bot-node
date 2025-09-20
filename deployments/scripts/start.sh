#!/bin/bash
set -e

# 调试模式
DEBUG=${DEBUG:-false}
if [ "$DEBUG" = "true" ]; then
    set -x
fi

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# 配置变量
IMAGE_NAME="local/bot-node-base:latest"
COMPOSE_FILE="docker-compose.yaml"
DOCKERFILE_PATH="deployments/docker/Dockerfile"
SIMPLE_DOCKERFILE_PATH="deployments/docker/Dockerfile.simple"
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

# 创建默认配置文件
create_default_config() {
    local config_file=$1
    local node_name=$2
    
    cat > "$config_file" << EOF
{
  "apiServer": {
    "enabled": true,
    "updateUrl": "$DEFAULT_SERVER_URL",
    "token": "YOUR_TOKEN_HERE",
    "nodeName": "$node_name",
    "heartbeatInterval": "5m",
    "heartbeatTimeout": "30s"
  },
  "browser": {
    "headless": true,
    "slowMo": 100,
    "timeout": 30000
  },
  "workers": {
    "doSearch": true,
    "doDailyCheckIn": true,
    "doPunchCards": true,
    "doDesktopSearch": true,
    "doMobileSearch": true,
    "doThisOrThat": true,
    "doQuiz": true,
    "doABC": true,
    "doReadToEarn": true,
    "doUrlReward": true
  },
  "search": {
    "delayMin": 1000,
    "delayMax": 3000,
    "searchTerms": []
  },
  "snapshots": {
    "taskExecution": false,
    "searchResults": false
  }
}
EOF
}

# 创建节点配置
create_node_config() {
    local node_num=$1
    local node_name="node-$node_num"
    local node_dir="../../node/$node_name"
    local config_file="$node_dir/config.json"
    local sessions_dir="$node_dir/sessions"
    
    print_color $CYAN ">>> 检查节点 $node_num: $node_name"
    
    # 检查节点目录是否存在
    if [ -d "$node_dir" ]; then
        print_color $GREEN "✅ 节点目录 $node_dir 已存在"
        
        # 检查配置文件是否存在
        if [ -f "$config_file" ]; then
            print_color $GREEN "✅ 配置文件 $config_file 已存在"
        else
            print_color $YELLOW "⚠️ 配置文件不存在，创建默认配置..."
            create_default_config "$config_file" "$node_name"
        fi
        
        # 检查会话目录是否存在
        if [ -d "$sessions_dir" ]; then
            print_color $GREEN "✅ 会话目录 $sessions_dir 已存在"
        else
            print_color $YELLOW "⚠️ 会话目录不存在，创建目录..."
            mkdir -p "$sessions_dir"
        fi
        
        print_color $BLUE "📋 节点 $node_name 配置检查完成，跳过创建"
        return
    fi
    
    print_color $CYAN "🆕 创建新节点 $node_name..."
    mkdir -p "$node_dir"
    mkdir -p "$sessions_dir"
    
    # 创建配置文件
    create_default_config "$config_file" "$node_name"
    
    print_color $GREEN "✅ 节点 $node_num 配置创建完成"
    print_color $BLUE "   配置文件: $config_file"
    print_color $BLUE "   会话目录: $sessions_dir"
}

# 生成 Docker Compose 文件
generate_compose_file() {
    local node_count=$1
    local compose_file="../../$COMPOSE_FILE"
    
    print_color $CYAN ">>> 生成 Docker Compose 文件: $compose_file"
    print_color $BLUE "   节点数量: $node_count"
    print_color $BLUE "   当前目录: $(pwd)"
    
    # 确保项目根目录存在
    print_color $BLUE "   确保项目根目录存在: ../../"
    if [ ! -d "../../" ]; then
        print_color $RED "❌ 项目根目录不存在"
        exit 1
    fi
    
    cat > "$compose_file" << EOF
version: '3.8'

services:
EOF
    
    # 获取项目根目录的绝对路径
    local project_root=$(cd ../../ && pwd)
    print_color $BLUE "   项目根目录: $project_root"
    
    # 为每个节点生成服务配置
    print_color $BLUE "   开始生成 $node_count 个节点的配置..."
    for i in $(seq 1 $node_count); do
        local node_name="node-$i"
        print_color $BLUE "   生成节点 $i: $node_name"
        cat >> "$compose_file" << EOF
  $node_name:
    image: $IMAGE_NAME
    container_name: mic-bot-$node_name
    restart: unless-stopped
    volumes:
      - $project_root/node/$node_name/config.json:/app/config.json:ro
      - $project_root/node/$node_name/sessions:/app/sessions
    environment:
      - NODE_ENV=production
    networks:
      - bot-network

EOF
    done
    
    # 添加网络配置
    print_color $BLUE "   添加网络配置..."
    cat >> "$compose_file" << EOF
networks:
  bot-network:
    driver: bridge
EOF
    
    # 检查文件是否生成成功
    if [ -f "$compose_file" ]; then
        local file_size=$(wc -c < "$compose_file")
        local file_lines=$(wc -l < "$compose_file")
        print_color $GREEN "✅ Docker Compose 文件生成完成"
        print_color $BLUE "   文件大小: $file_size 字节"
        print_color $BLUE "   文件行数: $file_lines 行"
    else
        print_color $RED "❌ Docker Compose 文件生成失败"
        exit 1
    fi
}

# 构建镜像
build_image() {
    print_color $CYAN ">>> 构建 Docker 镜像: $IMAGE_NAME"
    
    # 切换到项目根目录
    cd ../../
    
    print_color $BLUE "   当前目录: $(pwd)"
    print_color $BLUE "   Dockerfile路径: $DOCKERFILE_PATH"
    
    # 检查 Dockerfile 是否存在
    if [ ! -f "$DOCKERFILE_PATH" ]; then
        print_color $RED "❌ Dockerfile 不存在: $DOCKERFILE_PATH"
        handle_error "Dockerfile 文件不存在"
    fi
    
    # 尝试使用标准 Dockerfile 构建
    if docker build -f "$DOCKERFILE_PATH" -t "$IMAGE_NAME" .; then
        print_color $GREEN "✅ 镜像构建成功"
    else
        print_color $YELLOW "⚠️ 标准 Dockerfile 构建失败，尝试简化版本..."
        # 检查简化版本是否存在
        if [ -f "$SIMPLE_DOCKERFILE_PATH" ]; then
            if docker build -f "$SIMPLE_DOCKERFILE_PATH" -t "$IMAGE_NAME" .; then
                print_color $GREEN "✅ 简化版本镜像构建成功"
            else
                handle_error "简化版本镜像构建失败"
            fi
        else
            handle_error "镜像构建失败，且简化版本不存在"
        fi
    fi
    
    # 返回脚本目录
    cd deployments/scripts/
}

# 启动服务
start_services() {
    local node_count=$1
    local compose_file="../../$COMPOSE_FILE"
    
    print_color $CYAN ">>> 启动 $node_count 个节点服务"
    
    # 切换到项目根目录
    cd ../../
    
    print_color $BLUE "   当前工作目录: $(pwd)"
    print_color $BLUE "   Compose文件: $COMPOSE_FILE"
    
    # 检查 Compose 文件是否存在
    if [ ! -f "$COMPOSE_FILE" ]; then
        print_color $RED "❌ Compose文件不存在: $COMPOSE_FILE"
        print_color $YELLOW "请先运行 ./start.sh deploy 生成配置文件"
        cd ../deployments/scripts/
        exit 1
    fi
    
    # 启动服务
    docker-compose -f "$COMPOSE_FILE" up -d
    
    print_color $GREEN "✅ 服务启动完成"
    
    # 返回脚本目录
    cd ../../deployments/scripts/
}

# 显示完成信息
show_completion_info() {
    local node_count=$1
    
    print_color $GREEN "🎉 部署完成！"
    print_color $BLUE "已部署 $node_count 个节点:"
    
    for i in $(seq 1 $node_count); do
        print_color $BLUE "  - node-$i"
    done
    
    print_color $YELLOW "重要提醒:"
    print_color $YELLOW "1. 请编辑每个节点的配置文件，修改以下内容:"
    print_color $YELLOW "   - token: 设置正确的认证令牌"
    print_color $YELLOW "   - updateUrl: 设置正确的服务器地址"
    print_color $YELLOW ""
    print_color $YELLOW "2. 配置文件位置:"
    for i in $(seq 1 $node_count); do
        print_color $YELLOW "   - ../../node/node-$i/config.json"
    done
    
    print_color $YELLOW ""
    print_color $YELLOW "3. 常用命令:"
    print_color $YELLOW "   查看日志: docker-compose -f $COMPOSE_FILE logs"
    print_color $YELLOW "   停止服务: docker-compose -f $COMPOSE_FILE down"
    print_color $YELLOW "   重启服务: docker-compose -f $COMPOSE_FILE restart"
}

# 主函数
main() {
    local action=$1
    local node_count=${2:-1}
    
    # 检查参数
    if [ -z "$action" ]; then
        print_color $RED "用法: $0 <action> [node_count]"
        print_color $YELLOW "  action: deploy, build, start, stop, restart, logs, stats, clean"
        print_color $YELLOW "  node_count: 节点数量 (默认: 1)"
        exit 1
    fi
    
    # 检查 Docker
    check_docker
    
    case $action in
        "deploy")
            # 如果没有指定节点数量，询问用户
            if [ "$node_count" = "1" ] && [ -z "$2" ]; then
                print_color $CYAN "请选择要部署的节点数量:"
                print_color $YELLOW "  1) 1 个节点"
                print_color $YELLOW "  2) 2 个节点"
                print_color $YELLOW "  3) 3 个节点"
                print_color $YELLOW "  4) 4 个节点"
                print_color $YELLOW "  5) 自定义数量"
                echo -n "请输入选择 (1-5, 默认: 1): "
                read -r choice
                
                case $choice in
                    1) node_count=1 ;;
                    2) node_count=2 ;;
                    3) node_count=3 ;;
                    4) node_count=4 ;;
                    5) 
                        echo -n "请输入节点数量 (1-10): "
                        read -r custom_count
                        if [[ "$custom_count" =~ ^[1-9]$|^10$ ]]; then
                            node_count=$custom_count
                        else
                            print_color $RED "无效的节点数量，使用默认值 1"
                            node_count=1
                        fi
                        ;;
                    "") node_count=1 ;;
                    *) 
                        print_color $RED "无效选择，使用默认值 1"
                        node_count=1
                        ;;
                esac
            fi
            
            print_color $GREEN "🚀 开始部署 $node_count 个节点..."
            
            # 创建节点配置
            for i in $(seq 1 $node_count); do
                create_node_config $i
            done
            
            # 生成 Docker Compose 文件
            generate_compose_file $node_count
            
            # 构建镜像
            build_image
            
            # 启动服务
            start_services $node_count
            
            # 显示完成信息
            show_completion_info $node_count
            ;;
        "build")
            print_color $GREEN "🔨 构建 Docker 镜像..."
            build_image
            ;;
        "start")
            print_color $GREEN "▶️ 启动服务..."
            start_services $node_count
            ;;
        "stop")
            print_color $YELLOW "⏹️ 停止服务..."
            cd ../../
            print_color $BLUE "   当前目录: $(pwd)"
            print_color $BLUE "   Compose文件: $COMPOSE_FILE"
            if [ -f "$COMPOSE_FILE" ]; then
                docker-compose -f "$COMPOSE_FILE" down
            else
                print_color $RED "❌ Compose文件不存在: $COMPOSE_FILE"
                print_color $YELLOW "请先运行 ./start.sh deploy 生成配置文件"
            fi
            cd ../../deployments/scripts/
            ;;
        "restart")
            print_color $BLUE "🔄 重启服务..."
            cd ../../
            print_color $BLUE "   当前目录: $(pwd)"
            print_color $BLUE "   Compose文件: $COMPOSE_FILE"
            if [ -f "$COMPOSE_FILE" ]; then
                docker-compose -f "$COMPOSE_FILE" restart
            else
                print_color $RED "❌ Compose文件不存在: $COMPOSE_FILE"
                print_color $YELLOW "请先运行 ./start.sh deploy 生成配置文件"
            fi
            cd ../../deployments/scripts/
            ;;
        "logs")
            print_color $BLUE "📋 查看日志..."
            cd ../../
            print_color $BLUE "   当前目录: $(pwd)"
            print_color $BLUE "   Compose文件: $COMPOSE_FILE"
            if [ -f "$COMPOSE_FILE" ]; then
                docker-compose -f "$COMPOSE_FILE" logs -f
            else
                print_color $RED "❌ Compose文件不存在: $COMPOSE_FILE"
                print_color $YELLOW "请先运行 ./start.sh deploy 生成配置文件"
            fi
            cd ../../deployments/scripts/
            ;;
        "stats")
            print_color $CYAN "📊 查看服务状态..."
            cd ../../
            print_color $BLUE "   当前目录: $(pwd)"
            print_color $BLUE "   Compose文件: $COMPOSE_FILE"
            if [ -f "$COMPOSE_FILE" ]; then
                print_color $GREEN "=== Docker Compose 服务状态 ==="
                docker-compose -f "$COMPOSE_FILE" ps
                print_color $GREEN ""
                print_color $GREEN "=== Docker 容器状态 ==="
                docker ps --filter "name=mic-bot-node" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}\t{{.Image}}"
                print_color $GREEN ""
                print_color $GREEN "=== 容器资源使用情况 ==="
                docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}\t{{.BlockIO}}" $(docker ps --filter "name=mic-bot-node" -q)
            else
                print_color $RED "❌ Compose文件不存在: $COMPOSE_FILE"
                print_color $YELLOW "请先运行 ./start.sh deploy 生成配置文件"
            fi
            cd ../../deployments/scripts/
            ;;
        "clean")
            print_color $RED "🧹 清理资源..."
            cd ../../
            print_color $BLUE "   当前目录: $(pwd)"
            print_color $BLUE "   Compose文件: $COMPOSE_FILE"
            if [ -f "$COMPOSE_FILE" ]; then
                docker-compose -f "$COMPOSE_FILE" down -v
                docker system prune -f
            else
                print_color $RED "❌ Compose文件不存在: $COMPOSE_FILE"
                print_color $YELLOW "请先运行 ./start.sh deploy 生成配置文件"
            fi
            cd ../../deployments/scripts/
            ;;
        *)
            print_color $RED "❌ 未知操作: $action"
            exit 1
            ;;
    esac
}

# 执行主函数
main "$@"