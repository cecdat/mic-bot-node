@echo off
REM mic-bot-node 项目启动脚本
REM 从项目根目录启动部署脚本

cd /d "%~dp0deployments\scripts"
call start.bat %*
