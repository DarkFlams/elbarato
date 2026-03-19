$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$debugExe = Join-Path $repoRoot "src-tauri\target\debug\app.exe"
$devPort = 4310

# Evita bloqueo de recompilacion cuando queda una instancia previa abierta.
$running = Get-Process -Name "app" -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -eq $debugExe }

if ($running) {
  $running | Stop-Process -Force
  Start-Sleep -Milliseconds 250
}

# Evita choques por procesos viejos ocupando el puerto dev dedicado.
$listener = Get-NetTCPConnection -LocalAddress "127.0.0.1" -LocalPort $devPort -State Listen -ErrorAction SilentlyContinue |
  Select-Object -First 1
if ($listener) {
  $owner = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
  if ($owner) {
    Stop-Process -Id $owner.Id -Force
    Start-Sleep -Milliseconds 250
  }
}

$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
npx tauri dev
