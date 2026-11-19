# Adds (or with -Remove, removes) a Windows Startup shortcut that runs start-app.ps1 hidden at login.
#   powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -Remove
param([switch]$Remove)

$lnk = Join-Path ([Environment]::GetFolderPath("Startup")) "RSC Classroom.lnk"
if ($Remove) {
  if (Test-Path $lnk) { Remove-Item $lnk -Force; "Removed: $lnk" } else { "Not installed." }
  exit 0
}

$script = Join-Path $PSScriptRoot "start-app.ps1"
$sh = New-Object -ComObject WScript.Shell
$s = $sh.CreateShortcut($lnk)
$s.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$s.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""
$s.WorkingDirectory = Split-Path -Parent $PSScriptRoot
$s.WindowStyle = 7 # minimized
$s.Description = "Starts RSC Classroom (Docker, database, app) at login"
$s.Save()
"Installed: $lnk"
