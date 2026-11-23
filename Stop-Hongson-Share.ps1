$ErrorActionPreference = 'Stop'
$statePath = Join-Path $PSScriptRoot 'logs\share-state.json'
if (-not (Test-Path -LiteralPath $statePath)) { Write-Host 'Sharing is already stopped.'; exit 0 }
$state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
if ($state.controlPort -lt 1 -or $state.controlPort -gt 65535) { throw 'Invalid sharing control port.' }
try {
    $result = Invoke-RestMethod -Method Post -Uri ('http://127.0.0.1:' + $state.controlPort + '/stop') -Headers @{Authorization = 'Bearer ' + $state.controlKey} -TimeoutSec 5
    if ($result.stopped) { Write-Host 'Sharing stopped. The public link is no longer available.' }
} catch { throw 'Cannot contact the sharing process. Check logs\share-error.log. Restarting the PC also stops sharing.' }
