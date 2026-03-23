$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$debugExe = Join-Path $repoRoot "src-tauri\target\debug\app.exe"
$ports = @(4310, 3000)

Write-Host "[tauri-dev-reset] Closing app.exe instances..."
$running = Get-Process -Name "app" -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -eq $debugExe }
if ($running) {
  $running | Stop-Process -Force
  Start-Sleep -Milliseconds 300
}

foreach ($port in $ports) {
  Write-Host "[tauri-dev-reset] Releasing port $port ..."
  $listeners = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -eq $port } |
    Select-Object -ExpandProperty OwningProcess -Unique

  foreach ($ownerPid in $listeners) {
    if ($ownerPid -and $ownerPid -ne $PID) {
      Stop-Process -Id $ownerPid -Force -ErrorAction SilentlyContinue
    }
  }
}

$nextDir = Join-Path $repoRoot ".next"
if (Test-Path $nextDir) {
  Write-Host "[tauri-dev-reset] Clearing .next cache..."
  Remove-Item -Path $nextDir -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "[tauri-dev-reset] Starting tauri dev..."
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "tauri-dev.ps1")
