$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$privateKeyPath = Join-Path $env:USERPROFILE ".tauri\elbarato.key"
$passwordPath = Join-Path $env:USERPROFILE ".tauri\elbarato.pass.txt"

if (-not (Test-Path $privateKeyPath)) {
  throw ("No se encontro la llave privada de updater en {0}. Genera la llave con npx tauri signer generate -w {0}." -f $privateKeyPath)
}

if (-not (Test-Path $passwordPath)) {
  throw ("No se encontro la clave del updater en {0}. Regenera la llave o vuelve a crear ese archivo." -f $passwordPath)
}

$privateKeyContent = Get-Content -Raw $privateKeyPath
$privateKeyPassword = Get-Content -Raw $passwordPath
$env:Path = "$env:USERPROFILE\.cargo\bin;" + $env:Path
$env:TAURI_BUILD = "1"
$env:TAURI_SIGNING_PRIVATE_KEY = $privateKeyContent
$env:TAURI_SIGNING_PRIVATE_KEY_PATH = $privateKeyPath
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $privateKeyPassword

Set-Location $projectRoot
Write-Host "Compilando release Tauri con updater firmado..."
npx tauri build
& (Join-Path $PSScriptRoot "generate-updater-assets.ps1")
