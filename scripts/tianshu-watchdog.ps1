$ErrorActionPreference = "SilentlyContinue"
$root = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node).Source
$service = Join-Path $root "scripts/tianshu-service.mjs"
while ($true) {
  $healthy = $false
  try {
    $response = Invoke-RestMethod "http://127.0.0.1:4317/health" -TimeoutSec 2
    $healthy = $response.status -eq "ok"
  } catch {}
  if (-not $healthy) {
    $process = Start-Process -FilePath $node -ArgumentList ('"' + $service + '"') -WorkingDirectory $root -WindowStyle Hidden -PassThru
    try { Wait-Process -Id $process.Id -ErrorAction SilentlyContinue } catch {}
  }
  Start-Sleep -Seconds 3
}