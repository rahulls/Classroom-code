# Adds (or with -Remove, removes) the Windows task that runs scripts\daily-backup.mjs every day at 23:00.
# If the PC is off or asleep at 23:00, it runs as soon as it's back on.
#   powershell -ExecutionPolicy Bypass -File scripts\install-daily-backup.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\install-daily-backup.ps1 -Remove
param([switch]$Remove, [string]$At = "23:00")

$name = "RSC Classroom daily backup"
if ($Remove) {
  if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $name -Confirm:$false; "Removed: $name" } else { "Not installed." }
  exit 0
}

$root = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node).Source
$cmd = "Set-Location -LiteralPath '$root'; & '$node' scripts\daily-backup.mjs"
$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command `"$cmd`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Backs up the RSC Classroom databases and app data, then commits and pushes the code" -Force | Out-Null
"Installed: $name (daily at $At)"
