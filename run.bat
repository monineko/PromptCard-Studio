@echo off
rem First-run setup (Windows): create venv, install dependencies, build frontend if needed, then start.
rem For daily start, use start_local.cmd instead.
chcp 65001 >nul
cd /d "%~dp0"

echo [1/4] Preparing virtual environment...
if not exist .venv (
  python -m venv .venv || (echo Failed to create venv. Please install Python 3.10+ & pause & exit /b 1)
)
call .venv\Scripts\activate.bat

echo [2/4] Installing backend dependencies...
python -m pip install -r backend\requirements.txt -q || (echo Dependency install failed & pause & exit /b 1)

echo [3/4] Checking frontend build...
if not exist frontend\dist\index.html (
  echo Frontend not built. Trying to build (requires Node.js)...
  cd frontend
  call npm.cmd install -s || (echo npm install failed. Please install Node.js & pause & exit /b 1)
  call npm.cmd run build || (echo Frontend build failed & pause & exit /b 1)
  cd ..
)

echo [4/4] Starting service (port 14419, auto-shift if occupied)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_local.ps1"

pause
