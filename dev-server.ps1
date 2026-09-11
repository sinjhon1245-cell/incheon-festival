# ===================================================================
# 미리보기용 정적 서버 (PowerShell 판)
#
# dev-server.js 와 하는 일이 같습니다. Node 가 설치되지 않은 PC 에서
# 쓰려고 따로 둡니다. Windows 에는 PowerShell 이 항상 있습니다.
#
#   실행: powershell -ExecutionPolicy Bypass -File dev-server.ps1 [포트]
#
# 배포에는 필요 없습니다. Netlify 는 파일을 그대로 서빙합니다.
# ===================================================================
param([int]$Port = 8321)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

$types = @{
  '.html' = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.txt'  = 'text/plain; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.webp' = 'image/webp'
  '.ico'  = 'image/x-icon'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")

try {
  $listener.Start()
} catch {
  Write-Error "포트 $Port 를 열지 못했습니다. 이미 다른 창에서 서버가 떠 있는지 확인해 주세요."
  exit 1
}

Write-Output "http://localhost:$Port 에서 실행 중 (멈추려면 Ctrl+C)"

while ($listener.IsListening) {
  $ctx = $listener.GetContext()

  # 요청 하나가 잘못돼도 서버는 계속 떠 있어야 합니다.
  # 미리보기 도구가 포트를 확인하려 보내는 요청까지 받아내야 합니다.
  try {
    $path = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)

    if ($path -eq '/') { $path = '/index.html' }
    # netlify.toml 의 /admin 리라이트와 똑같이 맞춰 둡니다.
    if ($path -eq '/admin') { $path = '/admin.html' }

    $file = Join-Path $root ($path.TrimStart('/') -replace '/', '\')
    $full = [System.IO.Path]::GetFullPath($file)

    $body = $null

    # 프로젝트 폴더 밖은 내주지 않습니다.
    if (-not $full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
      $ctx.Response.StatusCode = 403
      $ctx.Response.ContentType = 'text/plain; charset=utf-8'
      $body = [System.Text.Encoding]::UTF8.GetBytes('forbidden')
    } elseif (Test-Path $full -PathType Leaf) {
      $body = [System.IO.File]::ReadAllBytes($full)
      $ext = [System.IO.Path]::GetExtension($full).ToLower()
      $ctx.Response.ContentType = $(if ($types[$ext]) { $types[$ext] } else { 'application/octet-stream' })
      # 고친 내용이 바로 보여야 하므로 캐시하지 않습니다.
      $ctx.Response.Headers.Add('Cache-Control', 'no-store')
    } else {
      $ctx.Response.StatusCode = 404
      $ctx.Response.ContentType = 'text/plain; charset=utf-8'
      $body = [System.Text.Encoding]::UTF8.GetBytes("not found: $path")
    }

    # 길이를 먼저 알려 주고 씁니다. HEAD 요청에는 본문을 보내면
    # 안 됩니다 — 보내면 프로토콜 위반으로 예외가 납니다.
    $ctx.Response.ContentLength64 = $body.Length
    if ($ctx.Request.HttpMethod -ne 'HEAD') {
      $ctx.Response.OutputStream.Write($body, 0, $body.Length)
    }
  } catch {
    Write-Output "요청 처리 중 오류: $($_.Exception.Message)"
  } finally {
    try { $ctx.Response.Close() } catch {}
  }
}
