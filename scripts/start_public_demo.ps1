$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $root 'data\runtime\hosting'
$env:ALLOW_LOCALHOST_DEMO = 'false'
$env:ANTHROPIC_API_KEY = ' '
$env:DATABASE_URL = 'sqlite:///' + ((Join-Path $runtime 'public-demo.db') -replace '\\', '/')

$api = Start-Process -FilePath (Join-Path $root '.venv\Scripts\python.exe') `
    -ArgumentList '-m uvicorn scripts.public_demo:app --host 127.0.0.1 --port 8787 --limit-concurrency 24' `
    -WorkingDirectory $root -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $runtime 'api.log') -RedirectStandardError (Join-Path $runtime 'api-error.log')
try {
    $tunnel = Start-Process -FilePath (Join-Path $runtime 'cloudflared.exe') `
        -ArgumentList 'tunnel --url http://127.0.0.1:8787 --protocol http2' `
        -WorkingDirectory $root -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $runtime 'tunnel-output.log') -RedirectStandardError (Join-Path $runtime 'tunnel.log')
    while (-not $api.HasExited -and -not $tunnel.HasExited) { Start-Sleep -Seconds 2 }
    exit 1
} finally {
    foreach ($process in @($api, $tunnel)) {
        if ($process -and -not $process.HasExited) { taskkill /PID $process.Id /T /F | Out-Null }
    }
}
