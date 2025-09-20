# mic-bot-node 项目启动脚本
# 从项目根目录启动部署脚本

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location "$ScriptDir\deployments\scripts"
& ".\start.ps1" $args
