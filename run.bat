@echo off
rem 首次初始化脚本（Windows）：创建虚拟环境、安装依赖、必要时构建前端，然后启动。
rem 日常启动请用 start_local.cmd。
chcp 65001 >nul
cd /d "%~dp0"

echo [1/4] 准备虚拟环境...
if not exist .venv (
  python -m venv .venv || (echo 创建虚拟环境失败，请确认已安装 Python 3.10+ & pause & exit /b 1)
)
call .venv\Scripts\activate.bat

echo [2/4] 安装后端依赖...
python -m pip install -r backend\requirements.txt -q || (echo 依赖安装失败 & pause & exit /b 1)

echo [3/4] 检查前端构建...
if not exist frontend\dist\index.html (
  echo 前端未构建，尝试自动构建（需要 Node.js）...
  cd frontend
  call npm.cmd install -s || (echo npm 安装失败，请安装 Node.js 后重试 & pause & exit /b 1)
  call npm.cmd run build || (echo 前端构建失败 & pause & exit /b 1)
  cd ..
)

echo [4/4] 启动服务（端口 14419，被占用时自动顺延）...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_local.ps1"

pause
