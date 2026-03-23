param(
  [string]$Repo = "DarkFlams/elbarato",
  [string]$Token = "",
  [string]$NotesFile = "",
  [switch]$Build,
  [switch]$Draft,
  [switch]$Prerelease
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$packageJsonPath = Join-Path $projectRoot "package.json"
$tauriConfigPath = Join-Path $projectRoot "src-tauri\tauri.conf.json"
$bundlePath = Join-Path $projectRoot "src-tauri\target\release\bundle\nsis"

function Get-AuthToken {
  param(
    [string]$ExplicitToken,
    [string]$GhPath
  )

  if ($ExplicitToken) {
    return $ExplicitToken
  }

  if ($env:GITHUB_TOKEN) {
    return $env:GITHUB_TOKEN
  }

  if ($env:GH_TOKEN) {
    return $env:GH_TOKEN
  }

  if ($GhPath -and (Test-GitHubCliAuth -GhPath $GhPath)) {
    return ((& $GhPath auth token) | Out-String).Trim()
  }

  throw "No se encontro token de GitHub. Define GITHUB_TOKEN o usa -Token."
}

function Get-GitHubCliPath {
  $commonPaths = @(
    $env:GITHUB_CLI_PATH,
    "C:\Program Files\GitHub CLI\gh.exe",
    (Join-Path $env:LOCALAPPDATA "GitHub CLI\gh.exe")
  ) | Where-Object { $_ }

  foreach ($path in $commonPaths) {
    if (Test-Path $path) {
      return $path
    }
  }

  if ($env:GITHUB_CLI_PATH -and (Test-Path $env:GITHUB_CLI_PATH)) {
    return $env:GITHUB_CLI_PATH
  }

  try {
    $command = Get-Command gh -ErrorAction Stop
    if ($command -and $command.Source) {
      return $command.Source
    }
  } catch {
  }

  return $null
}

function Get-GitHubHeaders {
  param([string]$AuthToken)

  return @{
    "Accept" = "application/vnd.github+json"
    "Authorization" = "Bearer $AuthToken"
    "User-Agent" = "elbarato-pos-release-script"
    "X-GitHub-Api-Version" = "2022-11-28"
  }
}

function Invoke-GitHubJson {
  param(
    [string]$Method,
    [string]$Uri,
    [hashtable]$Headers,
    [object]$Body = $null
  )

  $params = @{
    Method = $Method
    Uri = $Uri
    Headers = $Headers
    ErrorAction = "Stop"
  }

  if ($null -ne $Body) {
    $params.ContentType = "application/json; charset=utf-8"
    $params.Body = ($Body | ConvertTo-Json -Depth 10)
  }

  return Invoke-RestMethod @params
}

function Get-ReleaseByTag {
  param(
    [string]$RepoName,
    [string]$Tag,
    [hashtable]$Headers
  )

  try {
    return Invoke-GitHubJson -Method "GET" -Uri ("https://api.github.com/repos/{0}/releases/tags/{1}" -f $RepoName, $Tag) -Headers $Headers
  } catch {
    $statusCode = 0
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      $statusCode = [int]$_.Exception.Response.StatusCode
    }

    if ($statusCode -eq 404) {
      return $null
    }

    throw
  }
}

function Upload-ReleaseAsset {
  param(
    [string]$UploadUrlTemplate,
    [hashtable]$Headers,
    [System.IO.FileInfo]$Asset
  )

  $uploadUrl = $UploadUrlTemplate -replace "\{\?name,label\}", ""
  $uploadUrl = "{0}?name={1}" -f $uploadUrl, [System.Uri]::EscapeDataString($Asset.Name)
  $contentType = switch -Regex ($Asset.Extension.ToLowerInvariant()) {
    "\.json$" { "application/json" }
    "\.sig$" { "text/plain" }
    default { "application/octet-stream" }
  }

  Invoke-RestMethod -Method "POST" -Uri $uploadUrl -Headers $Headers -InFile $Asset.FullName -ContentType $contentType -ErrorAction Stop | Out-Null
}

function Test-GitHubCliAuth {
  param([string]$GhPath)

  cmd.exe /c "`"$GhPath`" auth status >nul 2>&1"
  return ($LASTEXITCODE -eq 0)
}

Set-Location $projectRoot

$ghPath = Get-GitHubCliPath
$packageJson = Get-Content -Raw $packageJsonPath | ConvertFrom-Json
$tauriConfig = Get-Content -Raw $tauriConfigPath | ConvertFrom-Json
$version = $packageJson.version
$tag = "v$version"
$productName = $tauriConfig.productName
$releaseName = "$productName v$version"
$defaultNotes = "Actualizacion $version de $productName."
$releaseNotes = $defaultNotes

if ($NotesFile) {
  if (-not (Test-Path $NotesFile)) {
    throw ("No existe el archivo de notas: {0}" -f $NotesFile)
  }

  $releaseNotes = (Get-Content -Raw $NotesFile).Trim()
  if (-not $releaseNotes) {
    $releaseNotes = $defaultNotes
  }
}

if ($Build) {
  & (Join-Path $PSScriptRoot "tauri-build.ps1")
}

if ($NotesFile) {
  & (Join-Path $PSScriptRoot "generate-updater-assets.ps1") -NotesFile $NotesFile
}

$installerAsset = Get-ChildItem $bundlePath -Filter "*setup.exe" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $installerAsset) {
  throw ("Falta artefacto para publicar: no se encontro ningun setup.exe en {0}. Ejecuta npm run tauri:build primero." -f $bundlePath)
}

$signatureAsset = Get-Item ("{0}.sig" -f $installerAsset.FullName) -ErrorAction SilentlyContinue

if (-not $signatureAsset) {
  throw ("Falta artefacto para publicar: no se encontro la firma {0}. Ejecuta npm run tauri:build primero." -f ("{0}.sig" -f $installerAsset.FullName))
}

$requiredAssets = @(
  $installerAsset.FullName,
  $signatureAsset.FullName,
  (Join-Path $bundlePath "latest.json")
)

foreach ($assetPath in $requiredAssets) {
  if (-not (Test-Path $assetPath)) {
    throw ("Falta artefacto para publicar: {0}. Ejecuta npm run tauri:build primero." -f $assetPath)
  }
}

$authToken = Get-AuthToken -ExplicitToken $Token -GhPath $ghPath
$headers = Get-GitHubHeaders -AuthToken $authToken
$release = Get-ReleaseByTag -RepoName $Repo -Tag $tag -Headers $headers

if ($release) {
  Write-Host ("Actualizando release existente: {0}" -f $tag)
  $release = Invoke-GitHubJson -Method "PATCH" -Uri ("https://api.github.com/repos/{0}/releases/{1}" -f $Repo, $release.id) -Headers $headers -Body @{
    tag_name = $tag
    name = $releaseName
    body = $releaseNotes
    draft = [bool]$Draft
    prerelease = [bool]$Prerelease
    make_latest = "true"
  }
} else {
  Write-Host ("Creando release nueva: {0}" -f $tag)
  $release = Invoke-GitHubJson -Method "POST" -Uri ("https://api.github.com/repos/{0}/releases" -f $Repo) -Headers $headers -Body @{
    tag_name = $tag
    name = $releaseName
    body = $releaseNotes
    draft = [bool]$Draft
    prerelease = [bool]$Prerelease
    make_latest = "true"
  }
}

$assetsToDelete = @()
foreach ($asset in $release.assets) {
  if ($asset.name -eq "latest.json" -or $asset.name -match "setup\.exe(?:\.sig)?$") {
    $assetsToDelete += $asset
  }
}

foreach ($asset in $assetsToDelete) {
  Write-Host ("Borrando asset previo: {0}" -f $asset.name)
  Invoke-RestMethod -Method "DELETE" -Uri ("https://api.github.com/repos/{0}/releases/assets/{1}" -f $Repo, $asset.id) -Headers $headers -ErrorAction Stop | Out-Null
}

$installerAsset = Get-Item $requiredAssets[0]
$signatureAsset = Get-Item $requiredAssets[1]

Write-Host ("Subiendo asset: {0}" -f $installerAsset.Name)
Upload-ReleaseAsset -UploadUrlTemplate $release.upload_url -Headers $headers -Asset $installerAsset

Write-Host ("Subiendo asset: {0}" -f $signatureAsset.Name)
Upload-ReleaseAsset -UploadUrlTemplate $release.upload_url -Headers $headers -Asset $signatureAsset

$release = Get-ReleaseByTag -RepoName $Repo -Tag $tag -Headers $headers
$remoteInstaller = $release.assets | Where-Object { $_.name -match "setup\.exe$" } | Select-Object -First 1

if (-not $remoteInstaller) {
  throw "No se encontro el asset remoto del instalador despues de subirlo."
}

& (Join-Path $PSScriptRoot "generate-updater-assets.ps1") -Notes $releaseNotes -InstallerAssetName $remoteInstaller.name

$latestAsset = Get-Item $requiredAssets[2]
Write-Host ("Subiendo asset: {0}" -f $latestAsset.Name)
Upload-ReleaseAsset -UploadUrlTemplate $release.upload_url -Headers $headers -Asset $latestAsset

Write-Host ("Release publicada: https://github.com/{0}/releases/tag/{1}" -f $Repo, $tag)
