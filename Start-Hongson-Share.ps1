param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$runtimePath = Join-Path $projectRoot '.runtime\node.exe'
if (-not (Test-Path -LiteralPath $runtimePath)) {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if ($nodeCommand) { $runtimePath = $nodeCommand.Source }
    else { throw 'Node.js 24 or later is required.' }
}
$logDir = Join-Path $projectRoot 'logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$statePath = Join-Path $logDir 'share-state.json'
function Get-ShareStatus {
    try {
        $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
        if ($state.controlPort -lt 1 -or $state.controlPort -gt 65535) { return $null }
        $status = Invoke-RestMethod -Uri ('http://127.0.0.1:' + $state.controlPort + '/status') -Headers @{Authorization = 'Bearer ' + $state.controlKey} -TimeoutSec 2
        if ($status.app -eq 'hongson-share') { return $status }
    } catch { }
    return $null
}
$status = Get-ShareStatus
if (-not $status) {
    $process = Start-Process -FilePath $runtimePath -ArgumentList ('"' + (Join-Path $projectRoot 'scripts\share-runner.mjs') + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir 'share-output.log') -RedirectStandardError (Join-Path $logDir 'share-error.log') -PassThru
}
for ($attempt = 0; $attempt -lt 100; $attempt++) {
    $status = Get-ShareStatus
    if ($status -and $status.ready) { break }
    if ($process -and $process.HasExited -and -not $status -and $attempt -ge 5) { throw 'Sharing stopped. Check logs\share-error.log and logs\share-tunnel.log.' }
    Start-Sleep -Milliseconds 1000
}
if (-not $status -or -not $status.ready) { throw 'Sharing did not become ready. Check logs\share-tunnel.log.' }
Write-Host ('Share link: ' + $status.url)
Write-Host 'Keep this PC awake and connected. Stop sharing with Stop-Hongson-Share.cmd.'
Write-Host 'Trial data is separate: data\hongson-share.sqlite'
if (-not $NoBrowser) { Start-Process $status.url }
