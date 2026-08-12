#!/usr/bin/env bash
# 首次初始化脚本（macOS / Linux）：准备虚拟环境与依赖后启动。
set -e
cd "$(dirname "$0")"

echo "[1/4] 准备虚拟环境..."
if [ ! -d .venv ]; then
  python3 -m venv .venv
fi
source .venv/bin/activate

echo "[2/4] 安装后端依赖..."
python3 -m pip install -r backend/requirements.txt -q

echo "[3/4] 检查前端构建..."
if [ ! -f frontend/dist/index.html ]; then
  echo "前端未构建，尝试自动构建（需要 Node.js）..."
  (cd frontend && npm install -s && npm run build)
fi

echo "[4/4] 启动服务（端口 14419，被占用时自动顺延）..."
PORT=14419
while lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; do
  PORT=$((PORT+1))
done
python3 -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port $PORT
