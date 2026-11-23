param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$runtimePath = Join-Path $projectRoot '.runtime\node.exe'
if (-not (Test-Path -LiteralPath $runtimePath)) {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if ($nodeCommand) { $runtimePath = $nodeCommand.Source }
    else { throw 'Node.js 24 or later is required. Place node.exe in .runtime or install Node.js 24.' }
}
$appUrl = 'http://127.0.0.1:4310'
$alreadyRunning = $false
try {
    $health = Invoke-RestMethod -Uri "$appUrl/api/health" -TimeoutSec 2
    $alreadyRunning = $health.app -eq 'hongson-plan'
} catch { }
if (-not $alreadyRunning) {
    $logDir = Join-Path $projectRoot 'logs'
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    $process = Start-Process -FilePath $runtimePath -ArgumentList ('"' + (Join-Path $projectRoot 'server.mjs') + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir 'server.log') -RedirectStandardError (Join-Path $logDir 'server-error.log') -PassThru
    $process.Id | Set-Content -LiteralPath (Join-Path $logDir 'server.pid') -Encoding ASCII
    for ($attempt=0; $attempt -lt 25; $attempt++) {
        Start-Sleep -Milliseconds 400
        try { $health = Invoke-RestMethod -Uri "$appUrl/api/health" -TimeoutSec 1; if ($health.app -eq 'hongson-plan') { $alreadyRunning=$true; break } } catch { }
        if ($process.HasExited) { break }
    }
    if (-not $alreadyRunning) { throw "App did not start. Check $logDir\server-error.log" }
}
Write-Host "Hongson Plan: $appUrl"
if (-not $NoBrowser) { Start-Process $appUrl }
