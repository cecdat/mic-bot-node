#!/bin/bash
# mic-bot-node 项目启动脚本
# 从项目根目录启动部署脚本

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 切换到部署脚本目录并执行
cd "$SCRIPT_DIR/deployments/scripts"
exec ./start.sh "$@"
