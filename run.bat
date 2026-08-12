@echo off
rem PromptCard Studio for NovelAI - single entry point (Windows).
rem First run creates .venv and installs dependencies, then starts the service
rem and opens the browser. Every run uses this same file.
rem Close this window to stop the service.
setlocal
cd /d "%~dp0"

rem ---------- 1. locate Python ----------
set "PY="
where py >nul 2>nul
if not errorlevel 1 set "PY=py -3"
if not defined PY (
  where python >nul 2>nul
  if not errorlevel 1 set "PY=python"
)
if not defined PY (
  echo [ERROR] Python was not found.
  echo Please install Python 3.10 or newer from https://www.python.org/downloads/
  echo and check "Add Python to PATH" during installation.
  pause
  exit /b 1
)

rem ---------- 2. check Python version ----------
%PY% -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python 3.10 or newer is required.
  pause
  exit /b 1
)

rem ---------- 3. create virtual environment ----------
if not exist ".venv\pyvenv.cfg" (
  if exist ".venv" rmdir /s /q ".venv"
  if errorlevel 1 (
    echo [ERROR] Cannot remove the broken .venv folder. Close programs using it and retry.
    pause
    exit /b 1
  )
  echo [1/3] Creating virtual environment...
  %PY% -m venv .venv
  if errorlevel 1 (
    echo [ERROR] Failed to create the virtual environment.
    pause
    exit /b 1
  )
)
set "VPY=.venv\Scripts\python.exe"

rem ---------- 4. install dependencies if needed ----------
echo [2/3] Checking backend dependencies...
"%VPY%" -c "import fastapi, uvicorn, PIL, send2trash, multipart" >nul 2>nul
if errorlevel 1 (
  echo Installing backend dependencies...
  "%VPY%" -m pip install --only-binary :all: -r backend\requirements.txt
  if errorlevel 1 (
    echo [ERROR] Dependency installation failed. Check your network connection.
    pause
    exit /b 1
  )
)

rem ---------- 5. build frontend only if the bundle is missing ----------
if not exist "frontend\dist\index.html" (
  echo [3/3] Frontend build is missing. Trying to build with Node.js...
  where node >nul 2>nul
  if errorlevel 1 (
    echo [ERROR] Node.js is required to build the frontend.
    echo Please install Node.js from https://nodejs.org/ and retry.
    pause
    exit /b 1
  )
  cd frontend
  call npm.cmd install -s || goto :frontend_failed
  call npm.cmd run build || goto :frontend_failed
  cd ..
)

echo Starting service... The browser will open automatically.
echo Close this window to stop the service.
"%VPY%" start.py
echo.
echo Service stopped.
pause
exit /b 0

:frontend_failed
cd ..
echo [ERROR] Frontend build failed.
pause
exit /b 1
