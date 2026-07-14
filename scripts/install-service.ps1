param([switch]$Uninstall)
$ErrorActionPreference = "Stop"
$task = "TianShu Next"
$runKey = "HKCU:/Software/Microsoft/Windows/CurrentVersion/Run"
$runName = "TianShuNext"
if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue
  Remove-ItemProperty -Path $runKey -Name $runName -ErrorAction SilentlyContinue
  exit 0
}
$root = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node).Source
$script = Join-Path $root "scripts/tianshu-service.mjs"
try {
  $action = New-ScheduledTaskAction -Execute $node -Argument ('"' + $script + '"') -WorkingDirectory $root
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 3650)
  Register-ScheduledTask -TaskName $task -Action $action -Trigger $trigger -Settings $settings -Description "TianShu local orchestrator" -Force -ErrorAction Stop | Out-Null
  [pscustomobject]@{ mode = "scheduled_task"; task = $task }
} catch [Microsoft.Management.Infrastructure.CimException] {
  $command = 'powershell.exe -NoProfile -WindowStyle Hidden -Command "& ''' + $node + ''' ''' + $script + '''"'
  New-ItemProperty -Path $runKey -Name $runName -Value $command -PropertyType String -Force | Out-Null
  [pscustomobject]@{ mode = "current_user_run"; registry = $runKey; name = $runName }
}