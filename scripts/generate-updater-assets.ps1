param(
  [string]$NotesFile,
  [string]$Notes,
  [string]$InstallerAssetName
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$bundlePath = Join-Path $projectRoot "src-tauri\target\release\bundle\nsis"
$privateKeyPath = Join-Path $env:USERPROFILE ".tauri\elbarato.key"
$passwordPath = Join-Path $env:USERPROFILE ".tauri\elbarato.pass.txt"
$packageJsonPath = Join-Path $projectRoot "package.json"
$releaseBaseUrl = "https://github.com/DarkFlams/elbarato/releases/latest/download"

if (-not (Test-Path $bundlePath)) {
  throw ("No existe la carpeta de bundle: {0}" -f $bundlePath)
}

if (-not (Test-Path $privateKeyPath)) {
  throw ("No se encontro la llave privada del updater en {0}" -f $privateKeyPath)
}

if (-not (Test-Path $passwordPath)) {
  throw ("No se encontro la clave del updater en {0}" -f $passwordPath)
}

$installer = Get-ChildItem $bundlePath -Filter "*setup.exe" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $installer) {
  throw ("No se encontro instalador NSIS dentro de {0}" -f $bundlePath)
}

$version = (Get-Content -Raw $packageJsonPath | ConvertFrom-Json).version
$password = Get-Content -Raw $passwordPath
$signaturePath = "{0}.sig" -f $installer.FullName
$releaseNotes = ""

if ($Notes) {
  $releaseNotes = $Notes.Trim()
} elseif ($NotesFile) {
  if (-not (Test-Path $NotesFile)) {
    throw ("No existe el archivo de notas: {0}" -f $NotesFile)
  }

  $releaseNotes = (Get-Content -Raw $NotesFile).Trim()
}

if (Test-Path $signaturePath) {
  Remove-Item $signaturePath -Force
}

Write-Host ("Firmando instalador: {0}" -f $installer.Name)
Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PATH -ErrorAction SilentlyContinue
Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
npx tauri signer sign -f $privateKeyPath -p $password $installer.FullName | Out-Null

if (-not (Test-Path $signaturePath)) {
  throw ("La firma no se genero en {0}" -f $signaturePath)
}

$signature = (Get-Content -Raw $signaturePath).Trim()
$latestJsonPath = Join-Path $bundlePath "latest.json"
$installerUrlName = if ($InstallerAssetName) { $InstallerAssetName } else { $installer.Name }
$latestJson = @{
  version = $version
  notes = $releaseNotes
  pub_date = (Get-Date).ToUniversalTime().ToString("o")
  platforms = @{
    "windows-x86_64" = @{
      signature = $signature
      url = "{0}/{1}" -f $releaseBaseUrl, $installerUrlName
    }
  }
} | ConvertTo-Json -Depth 5

[System.IO.File]::WriteAllText(
  $latestJsonPath,
  $latestJson,
  [System.Text.UTF8Encoding]::new($false)
)

Write-Host ("Updater listo: {0}" -f $latestJsonPath)
Write-Host ("Firma lista: {0}" -f $signaturePath)
