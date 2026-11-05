@echo off
chcp 65001 >nul
title Amber · 琥珀 —— 动漫观影档案放映室
cd /d "%~dp0"

echo =======================================================
echo   Amber · 琥珀 —— 动漫观影档案放映室
echo   数据源: Obsidian 媒体档案（只读，可在页面「数据源」中更换）
echo   本地服务地址: http://127.0.0.1:8790 （服务就绪后自动打开浏览器）
echo   提示: 关闭本窗口即可停止服务
echo =======================================================
echo.

set AMBER_OPEN=1
node server.js

pause
