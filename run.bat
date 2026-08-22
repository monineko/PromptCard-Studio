@echo off
rem ============================================================================
rem PromptCard Studio for NovelAI - Windows 启动入口
rem
rem 启动流程：
rem   1. 查找可用的标准 CPython 3.10+；
rem   2. 创建或检查项目专用虚拟环境 .venv；
rem   3. 检查并安装后端依赖 backend\requirements.txt；
rem   4. 检查前端源码与 frontend\dist 是否同步，必要时重新构建；
rem   5. 启动本地后端，并由 start.py 自动打开浏览器。
rem
rem 用户数据（promptcards、library、vibes、config.json 等）不会因启动流程被覆盖。
rem 关闭此窗口即可停止项目；遇到问题请保留本窗口中的错误信息。
rem ============================================================================

setlocal EnableExtensions
cd /d "%~dp0"

rem 使用 UTF-8 代码页显示中文提示。Windows Terminal / Windows 11 通常可正常显示；
rem 若旧版控制台仍乱码，错误行中的 [ERROR] / [INFO] 英文关键词仍可用于排查。
chcp 65001 >nul
title PromptCard Studio for NovelAI

echo.
echo ============================================================
echo   PromptCard Studio for NovelAI
echo   本地启动程序
echo ============================================================
echo [INFO] 项目目录：%CD%
echo.

rem ---------- 1/4 查找 Python ----------
echo [1/4] 正在检查 Python 环境...
set "PY="
set "VPY="
set "PORTABLE_MODE=0"

rem 便携整合包优先使用内置 Python，不要求用户安装系统 Python 或创建 .venv。
set "BUNDLED_PY=runtime\python\python.exe"
if exist "%BUNDLED_PY%" (
  set "PY=%BUNDLED_PY%"
  set "VPY=%BUNDLED_PY%"
  set "PORTABLE_MODE=1"
  echo [OK] 检测到内置 Python：%BUNDLED_PY%
  goto python_ready
)

rem 只接受标准 CPython 3.10+，跳过 free-threading / no-GIL 构建，
rem 因为部分运行时依赖（例如 onnxruntime）尚未兼容这类 Python。
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
  echo [ERROR] 未找到标准 Python 3.10 或更高版本。
  echo [ERROR] 请从 https://www.python.org/downloads/ 安装 Python，并勾选 Add Python to PATH。
  echo [ERROR] 未支持 free-threading / no-GIL 实验版本。
  pause
  exit /b 1
)
:python_ready
for /f "delims=" %%V in ('%PY% --version 2^>^&1') do echo [OK] %%V

rem ---------- 2/4 检查或创建虚拟环境 ----------
if "%PORTABLE_MODE%"=="1" (
  echo [2/4] 正在检查整合包内置运行环境...
) else (
  echo [2/4] 正在检查项目虚拟环境 .venv...
  set "VPY=.venv\Scripts\python.exe"
)
if not exist "%VPY%" goto create_venv
"%VPY%" -c "import sys, sysconfig; raise SystemExit(0 if sys.version_info >= (3, 10) and sysconfig.get_config_var('Py_GIL_DISABLED') != 1 else 1)" >nul 2>nul
if errorlevel 1 goto create_venv
echo [OK] 虚拟环境可用：%VPY%
goto venv_ready

:create_venv
echo [INFO] 正在创建或修复虚拟环境，这可能需要一点时间...
if exist ".venv" rmdir /s /q ".venv"
if exist ".venv" (
  echo [ERROR] 无法移除损坏的 .venv，请关闭占用该目录的程序后重试。
  pause
  exit /b 1
)
%PY% -m venv .venv
if errorlevel 1 (
  echo [ERROR] 创建虚拟环境失败。
  pause
  exit /b 1
)
echo [OK] 虚拟环境创建完成。

:venv_ready
rem ---------- 3/4 检查后端依赖 ----------
echo [3/4] 正在检查后端依赖...
"%VPY%" -c "import fastapi, uvicorn, PIL, send2trash, multipart" >nul 2>nul
if errorlevel 1 (
  echo [INFO] 依赖不完整，正在根据 backend\requirements.txt 安装...
  echo [INFO] 此步骤可能需要网络，并可能持续数分钟。
  "%VPY%" -m pip install --only-binary :all: -r backend\requirements.txt
  if errorlevel 1 (
    echo [ERROR] 后端依赖安装失败，请检查网络、代理或 requirements.txt。
    pause
    exit /b 1
  )
  echo [OK] 后端依赖安装完成。
) else (
  echo [OK] 后端依赖已安装，无需重复下载。
)

rem ---------- 4/4 检查前端构建 ----------
echo [4/4] 正在检查前端构建产物...
set "FRONTEND_BUILD_NEEDED=0"
if not exist "frontend\dist\index.html" set "FRONTEND_BUILD_NEEDED=1"
if "%FRONTEND_BUILD_NEEDED%"=="0" (
  rem 仅当 frontend\src 中最新文件晚于 dist\index.html 时重建，
  rem 因此普通启动不会反复构建，也不会要求用户每次安装 Node 依赖。
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$dist = Get-Item 'frontend\dist\index.html'; $src = Get-ChildItem 'frontend\src' -Recurse -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1; if ($src -and $src.LastWriteTime -gt $dist.LastWriteTime) { exit 1 }"
  if errorlevel 1 set "FRONTEND_BUILD_NEEDED=1"
)
if "%FRONTEND_BUILD_NEEDED%"=="0" (
  echo [OK] 前端构建产物是最新的。
) else (
  echo [INFO] 前端源码有更新或构建产物缺失，准备重新构建...
  where node >nul 2>nul
  if errorlevel 1 (
    if exist "frontend\dist\index.html" (
      echo [WARN] 检测到前端源码更新，但未找到 Node.js。
      echo [WARN] 将继续使用现有前端构建；如需应用源码更新，请安装 Node.js 后再次启动。
      set "FRONTEND_BUILD_NEEDED=0"
    ) else (
      echo [ERROR] 前端构建需要 Node.js，且当前没有可用的 frontend\dist 构建产物。
      echo [ERROR] 请从 https://nodejs.org/ 安装 Node.js 后重试。
      pause
      exit /b 1
    )
  ) else (
    for /f "delims=" %%V in ('node --version 2^>^&1') do echo [OK] Node.js %%V
    cd frontend
    if not exist "node_modules" (
      echo [INFO] 未找到前端依赖，正在执行 npm install...
      call npm.cmd install -s || goto :frontend_failed
    )
    echo [INFO] 正在执行前端构建，请不要关闭此窗口...
    call npm.cmd run build || goto :frontend_failed
    cd ..
    echo [OK] 前端构建完成。
  )
)

echo.
echo [START] 正在启动本地服务，浏览器将自动打开。
echo [START] 关闭本窗口即可停止项目。
echo.
"%VPY%" start.py
echo.
echo [STOP] 项目服务已停止。
pause
exit /b 0

:frontend_failed
cd ..
echo [ERROR] 前端构建失败，请保留以上日志并检查 Node.js、npm 和 frontend 目录。
pause
exit /b 1
