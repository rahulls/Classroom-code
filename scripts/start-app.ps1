# Starts RSC Classroom in the background: Docker Desktop -> database containers -> production app.
# Run at Windows login by the Startup shortcut (see install-autostart.ps1). Restarts the app if it stops.
# Logs: %LOCALAPPDATA%\RSC Classroom\logs (outside OneDrive).

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $env:LOCALAPPDATA "RSC Classroom\logs"
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir ("app-" + (Get-Date -Format "yyyy-MM-dd") + ".log")
function Log($m) { Add-Content -Path $log -Value ("[" + (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + "] " + $m) }
$env:Path = "C:\Program Files\nodejs;" + $env:Path
Set-Location $root

# Only one copy of this script at a time
$mutex = New-Object System.Threading.Mutex($false, "Local\RSCClassroomApp")
if (-not $mutex.WaitOne(0)) { Log "Already running; nothing to do."; exit 0 }

$port = 4310
$line = Select-String -Path (Join-Path $root ".env") -Pattern '^\s*WEB_PORT\s*=\s*(\d+)' | Select-Object -First 1
if ($line) { $port = [int]$line.Matches[0].Groups[1].Value }

function PortBusy { [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) }
if (PortBusy) { Log "Port $port is already in use (app already running?). Exiting."; exit 0 }

# 1. Docker Desktop
docker info *> $null
if ($LASTEXITCODE -ne 0) {
  Log "Starting Docker Desktop..."
  Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
  $ready = $false
  for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep -Seconds 4
    docker info *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
  }
  if (-not $ready) { Log "Docker Desktop did not start within 6 minutes. Giving up."; exit 1 }
}

# 2. Database and mail containers
cmd /c "docker compose up -d >> `"$log`" 2>&1"
$dbReady = $false
for ($i = 0; $i -lt 60; $i++) {
  docker exec rsc-classroom-postgres-1 pg_isready -U rsc *> $null
  if ($LASTEXITCODE -eq 0) { $dbReady = $true; break }
  Start-Sleep -Seconds 2
}
if (-not $dbReady) { Log "Database did not become ready. Giving up."; exit 1 }
Log "Database ready."

# 3. The app (production build), restarted if it stops. Stops retrying after 5 quick failures in a row.
$quickFails = 0
while ($true) {
  if (-not (Test-Path (Join-Path $root ".next\BUILD_ID"))) {
    Log "No build found; building (takes a minute)..."
    cmd /c "npm.cmd run build >> `"$log`" 2>&1"
  }
  Log "Starting app on http://localhost:$port"
  $t0 = Get-Date
  cmd /c "node scripts\run.mjs start >> `"$log`" 2>&1"
  $ranFor = ((Get-Date) - $t0).TotalSeconds
  Log ("App stopped (exit code " + $LASTEXITCODE + ") after " + [int]$ranFor + " s.")
  if ($ranFor -lt 60) { $quickFails++ } else { $quickFails = 0 }
  if ($quickFails -ge 5) { Log "App keeps failing at start. Giving up; see the lines above."; exit 1 }
  if (PortBusy) { Log "Port $port taken by something else. Exiting."; exit 0 }
  Start-Sleep -Seconds 10
}
