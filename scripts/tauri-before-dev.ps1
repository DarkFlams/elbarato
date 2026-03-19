$ErrorActionPreference = "Stop"

$hostIp = "127.0.0.1"
$port = 4310
$url = "http://$hostIp`:$port"

function Test-NextDevServer {
  try {
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
    $xPoweredBy = $response.Headers["x-powered-by"]
    $isNext = $false

    if ($xPoweredBy -and $xPoweredBy -match "next\.js") {
      $isNext = $true
    }

    if (-not $isNext -and $response.Content -and $response.Content -match "__NEXT_DATA__") {
      $isNext = $true
    }

    return $isNext
  } catch {
    return $false
  }
}

$listener = Get-NetTCPConnection -LocalAddress $hostIp -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
  Select-Object -First 1

if ($listener) {
  if (Test-NextDevServer) {
    Write-Host "[tauri-before-dev] Reusing existing Next dev server at $url"
    exit 0
  }

  $pid = $listener.OwningProcess
  $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
  if ($proc) {
    Write-Error "[tauri-before-dev] Port $port is in use by PID $pid ($($proc.ProcessName)). Free the port and retry."
  } else {
    Write-Error "[tauri-before-dev] Port $port is in use by an unknown process. Free the port and retry."
  }
  exit 1
}

Write-Host "[tauri-before-dev] Starting Next dev server at $url"
npm run dev -- --hostname $hostIp --port $port
