$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$outPath = Join-Path $projectRoot "out"

Set-Location $projectRoot

$env:TAURI_BUILD = "1"
$env:NEXT_PUBLIC_BYPASS_AUTH = "0"

if (Test-Path $outPath) {
  Write-Host ("Limpiando dist previo: {0}" -f $outPath)
  Remove-Item $outPath -Recurse -Force
}

Write-Host "Generando export estatico actualizado para Tauri..."
npm run build

if (-not (Test-Path $outPath)) {
  throw ("Next no genero la carpeta out en {0}" -f $outPath)
}

Write-Host ("Dist listo: {0}" -f $outPath)
