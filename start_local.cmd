@echo off
cd /d "%~dp0"

echo ============================================
echo   NovelAI Prompt Manager - Quick Start
echo ============================================

if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] Virtualenv not found at .venv
    pause
    exit /b 1
)

echo [1/2] Starting backend (frontend is served by backend, port 11451)...
start "npm-backend" /min ".venv\Scripts\python.exe" -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 11451

echo [2/2] Waiting for service to become ready...
set /a tries=0
:wait
set /a tries+=1
if %tries% gtr 30 (
    echo [ERROR] Timeout: check port 11451 or read the "npm-backend" window.
    pause
    exit /b 1
)
timeout /t 1 /nobreak >nul
powershell -NoProfile -Command "try { (Invoke-WebRequest -Uri 'http://127.0.0.1:11451/api/health' -TimeoutSec 2 -UseBasicParsing).StatusCode | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 goto wait

echo Service ready: http://127.0.0.1:11451
start "" "http://127.0.0.1:11451"
echo.
echo Note: closing this window will NOT stop the service.
echo To stop it: close the "npm-backend" window, or run: taskkill /F /IM python.exe
pause
