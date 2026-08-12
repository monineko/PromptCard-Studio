# 日常启动逻辑：隐藏启动后端（端口 14419，被占用自动顺延），就绪后打开浏览器。
param(
    [int]$PreferredPort = 14419
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$py = Join-Path $root ".venv\Scripts\python.exe"

if (-not (Test-Path -LiteralPath $py)) {
    Write-Host "[ERROR] 虚拟环境不存在，请先运行 run.bat 完成初始化"
    exit 1
}

# 端口自动选择：从首选端口开始，被占用则 +1，最多尝试 20 个
$port = $PreferredPort
for ($i = 0; $i -lt 20; $i++) {
    $inUse = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if (-not $inUse) { break }
    $port++
}
if ($port -ge $PreferredPort + 20) {
    Write-Host "[ERROR] 端口 $PreferredPort~$port 均被占用，请关闭占用进程后重试"
    exit 1
}

$outLog = Join-Path $env:TEMP "npm_uvicorn.out.log"
$errLog = Join-Path $env:TEMP "npm_uvicorn.err.log"

Write-Host "启动后端（完全隐藏）…"
Start-Process -FilePath $py `
    -ArgumentList "-m", "uvicorn", "app.main:app", "--app-dir", "backend", "--host", "127.0.0.1", "--port", "$port" `
    -WorkingDirectory $root -WindowStyle Hidden `
    -RedirectStandardOutput $outLog -RedirectStandardError $errLog

$ready = $false
for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 2 -UseBasicParsing
        if ($r.StatusCode -eq 200) { $ready = $true; break }
    } catch {
        # 尚未就绪，继续等待
    }
}

if (-not $ready) {
    Write-Host "[ERROR] 服务启动失败，请查看日志：$errLog"
    exit 1
}

Write-Host "服务已启动：http://127.0.0.1:$port"
Write-Host "停止：应用设置页「关闭本地服务」；日志：$errLog"
Start-Process "http://127.0.0.1:$port"
