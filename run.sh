#!/usr/bin/env bash
# PromptCard Studio for NovelAI - single entry point (macOS / Linux).
# First run creates .venv and installs dependencies, then starts the service
# and opens the browser. Every run uses this same file.
# Press Ctrl+C (or close the terminal) to stop the service.
set -u
cd "$(dirname "$0")"

# 1. locate Python
PY=""
if command -v python3 >/dev/null 2>&1; then
  PY="python3"
elif command -v python >/dev/null 2>&1; then
  PY="python"
else
  echo "[ERROR] Python was not found."
  echo "Please install Python 3.10 or newer from https://www.python.org/downloads/"
  exit 1
fi

# 2. check Python version
if ! "$PY" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' >/dev/null 2>&1; then
  echo "[ERROR] Python 3.10 or newer is required."
  exit 1
fi

# 3. create virtual environment
VPY=".venv/bin/python"
if [ ! -f .venv/pyvenv.cfg ]; then
  if [ -d .venv ]; then
    rm -rf .venv || { echo "[ERROR] Cannot remove the broken .venv folder. Close programs using it and retry."; exit 1; }
  fi
  echo "[1/3] Creating virtual environment..."
  "$PY" -m venv .venv || { echo "[ERROR] Failed to create the virtual environment."; exit 1; }
fi

# 4. install dependencies if needed
echo "[2/3] Checking backend dependencies..."
if ! "$VPY" -c 'import fastapi, uvicorn, PIL, send2trash, multipart' >/dev/null 2>&1; then
  echo "Installing backend dependencies..."
  "$VPY" -m pip install --only-binary :all: -r backend/requirements.txt || { echo "[ERROR] Dependency installation failed. Check your network connection."; exit 1; }
fi

# 5. build frontend only if the bundle is missing
if [ ! -f frontend/dist/index.html ]; then
  echo "[3/3] Frontend build is missing. Trying to build with Node.js..."
  if ! command -v node >/dev/null 2>&1; then
    echo "[ERROR] Node.js is required to build the frontend."
    echo "Please install Node.js from https://nodejs.org/ and retry."
    exit 1
  fi
  (cd frontend && npm install && npm run build) || { echo "[ERROR] Frontend build failed."; exit 1; }
fi

echo "Starting service... The browser will open automatically."
echo "Press Ctrl+C to stop the service."
exec "$VPY" start.py
