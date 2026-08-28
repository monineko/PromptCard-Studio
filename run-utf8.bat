@echo off
rem ============================================================================
rem PromptCard Studio for NovelAI - Windows bootstrap
rem
rem Startup flow:
rem   1. Find a supported CPython 3.10+ runtime.
rem   2. Create or validate the project virtual environment.
rem   3. Validate or install backend dependencies.
rem   4. Validate or rebuild the frontend when required.
rem   5. Start the local backend through start.py.
rem
rem Startup never overwrites user data such as promptcards, library, vibes, or config.json.
rem Close this window to stop the project. Keep the output above when reporting an error.
rem ============================================================================

setlocal EnableExtensions
cd /d "%~dp0"

rem run.bat switches the console to UTF-8 before loading this file.
rem [ERROR] and [INFO] labels remain readable in terminals without color support.
set "PCS_FORCE_COLOR=1"
title PromptCard Studio for NovelAI

echo.
echo [START] Preparing the PromptCard Studio runtime...
echo [START] Project directory: %CD%
echo.

rem ---------- 1/4 Find Python ----------
echo [1/4] Checking the Python runtime...
set "PY="
set "VPY="
set "PORTABLE_MODE=0"

rem Portable packages use the bundled Python and never create a development .venv.
set "BUNDLED_PY=runtime\python\python.exe"
if exist "%BUNDLED_PY%" (
  set "PY=%BUNDLED_PY%"
  set "VPY=%BUNDLED_PY%"
  set "PORTABLE_MODE=1"
  echo [OK] Bundled Python detected: %BUNDLED_PY%
  goto python_ready
)

rem Accept standard CPython 3.10+ only. Skip free-threading or no-GIL builds because
rem some runtime dependencies, including onnxruntime, do not support them yet.
where python >nul 2>nul
if not errorlevel 1 (
  python -c "import sys, sysconfig; raise SystemExit(0 if sys.version_info >= (3, 10) and sysconfig.get_config_var('Py_GIL_DISABLED') != 1 else 1)" >nul 2>nul
  if not errorlevel 1 set "PY=python"
)
if not defined PY (
  where py >nul 2>nul
  if not errorlevel 1 (
    py -3 -c "import sys, sysconfig; raise SystemExit(0 if sys.version_info >= (3, 10) and sysconfig.get_config_var('Py_GIL_DISABLED') != 1 else 1)" >nul 2>nul
    if not errorlevel 1 set "PY=py -3"
  )
)
if not defined PY (
  where python3 >nul 2>nul
  if not errorlevel 1 (
    python3 -c "import sys, sysconfig; raise SystemExit(0 if sys.version_info >= (3, 10) and sysconfig.get_config_var('Py_GIL_DISABLED') != 1 else 1)" >nul 2>nul
    if not errorlevel 1 set "PY=python3"
  )
)

if not defined PY (
  echo [ERROR] Standard Python 3.10 or newer was not found.
  echo [ERROR] Install Python from https://www.python.org/downloads/ and enable Add Python to PATH.
  echo [ERROR] Experimental free-threading or no-GIL builds are not supported.
  pause
  exit /b 1
)
:python_ready
for /f "delims=" %%V in ('%PY% --version 2^>^&1') do echo [OK] %%V

rem ---------- 2/4 Validate the environment ----------
if "%PORTABLE_MODE%"=="1" (
  echo [2/4] Checking the bundled runtime...
) else (
  echo [2/4] Checking the project virtual environment...
  set "VPY=.venv\Scripts\python.exe"
)
if not exist "%VPY%" goto create_venv
"%VPY%" -c "import sys, sysconfig; raise SystemExit(0 if sys.version_info >= (3, 10) and sysconfig.get_config_var('Py_GIL_DISABLED') != 1 else 1)" >nul 2>nul
if errorlevel 1 goto create_venv
echo [OK] Python environment is ready: %VPY%
goto venv_ready

:create_venv
echo [INFO] Creating or repairing the virtual environment. This may take a moment...
if exist ".venv" rmdir /s /q ".venv"
if exist ".venv" (
  echo [ERROR] Could not remove the broken .venv. Close programs using it and retry.
  pause
  exit /b 1
)
%PY% -m venv .venv
if errorlevel 1 (
  echo [ERROR] Failed to create the virtual environment.
  pause
  exit /b 1
)
echo [OK] Virtual environment created.

:venv_ready
rem ---------- 3/4 Validate backend dependencies ----------
echo [3/4] Checking backend dependencies...
"%VPY%" -c "import fastapi, uvicorn, PIL, send2trash, multipart" >nul 2>nul
if errorlevel 1 (
  echo [INFO] Dependencies are incomplete. Installing backend\requirements.txt...
  echo [INFO] This step requires network access and may take several minutes.
  "%VPY%" -m pip install --only-binary :all: -r backend\requirements.txt
  if errorlevel 1 (
    echo [ERROR] Backend dependency installation failed. Check the network, proxy, and requirements.txt.
    pause
    exit /b 1
  )
  echo [OK] Backend dependencies installed.
) else (
  echo [OK] Backend dependencies are already installed.
)

rem ---------- 4/4 Validate the frontend build ----------
echo [4/4] Checking the frontend build...
rem Portable packages ship only the prebuilt frontend. User backgrounds must never
rem trigger npm or require Node.js in portable mode.
if "%PORTABLE_MODE%"=="1" (
  if exist "frontend\dist\index.html" (
    echo [OK] Portable mode is using the prebuilt frontend. Node.js is not required.
    goto frontend_ready
  ) else (
    echo [ERROR] Portable package is missing frontend\dist\index.html.
    pause
    exit /b 1
  )
)

set "FRONTEND_BUILD_NEEDED=0"
if not exist "frontend\dist\index.html" set "FRONTEND_BUILD_NEEDED=1"
if "%FRONTEND_BUILD_NEEDED%"=="0" (
  rem Rebuild only when frontend source is newer than dist\index.html.
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$dist = Get-Item 'frontend\dist\index.html'; $src = Get-ChildItem 'frontend\src' -Recurse -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1; if ($src -and $src.LastWriteTime -gt $dist.LastWriteTime) { exit 1 }"
  if errorlevel 1 set "FRONTEND_BUILD_NEEDED=1"
)
if "%FRONTEND_BUILD_NEEDED%"=="0" (
  echo [OK] Frontend build is current.
) else (
  echo [INFO] Frontend source changed or the build is missing. Preparing a rebuild...
  where node >nul 2>nul
  if errorlevel 1 (
    if exist "frontend\dist\index.html" (
      echo [WARN] Frontend source changed, but Node.js was not found.
      echo [WARN] Continuing with the existing build. Install Node.js to rebuild it.
      set "FRONTEND_BUILD_NEEDED=0"
    ) else (
      echo [ERROR] Node.js is required because frontend\dist is missing.
      echo [ERROR] Install Node.js from https://nodejs.org/ and retry.
      pause
      exit /b 1
    )
  ) else (
    for /f "delims=" %%V in ('node --version 2^>^&1') do echo [OK] Node.js %%V
    cd frontend
    if not exist "node_modules" (
      echo [INFO] Frontend dependencies are missing. Running npm install...
      call npm.cmd install -s || goto :frontend_failed
    )
    echo [INFO] Building the frontend. Keep this window open...
    call npm.cmd run build || goto :frontend_failed
    cd ..
    echo [OK] Frontend build completed.
  )
)

:frontend_ready
echo.
echo [START] Runtime preparation completed. Starting the local service...
echo [START] The browser opens automatically. Close this window to stop the project.
echo.
"%VPY%" start.py
echo.
echo [STOP] Project service stopped.
pause
exit /b 0

:frontend_failed
cd ..
echo [ERROR] Frontend build failed. Keep the output above and check Node.js, npm, and frontend.
pause
exit /b 1
