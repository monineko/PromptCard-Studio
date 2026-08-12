@echo off
rem 日常启动脚本（Windows）：调用 start_local.ps1 隐藏启动后端并打开浏览器。
cd /d "%~dp0"

echo ============================================
echo   PromptCard Studio for NovelAI - Quick Start
echo ============================================

if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] Virtualenv not found at .venv
    pause
    exit /b 1
)

echo Starting backend fully hidden (port 14419, auto-shift if occupied)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_local.ps1"

echo.
echo Note: to stop the service, use Settings - "Close local service" in the app.
pause
