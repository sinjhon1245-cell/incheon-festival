<#
  관리자 계정 생성 — 범위로 지정합니다 (aisw01 ~ aisw50)
  ────────────────────────────────────────────────────────────────
  scripts/create-admin-users.mjs 를 안전하게 돌려 주는 껍데기입니다.
  실제 일은 .mjs 가 합니다.

  계정을 늘릴 때마다 스크립트를 고치지 않도록, 만들 번호를
  인자로 받습니다. 이미 있는 계정은 건너뜁니다 — 같은 명령을
  두 번 돌려도 결과가 같습니다.

  service_role 키를 화면에 보이지 않게 입력받아, 이 PowerShell
  프로세스 안에서만 환경변수로 둡니다. 파일에 남기지 않습니다.

  쓰는 법
    # 점검만 (아무것도 만들지 않습니다)
    .\scripts\create-admin-users.ps1 -Start 21 -End 25

    # 실제 생성
    .\scripts\create-admin-users.ps1 -Start 21 -End 25 -Apply

  허용 범위: 1 ~ 50 (aisw01 ~ aisw50), 그리고 Start <= End
  기존 계정: 자동으로 건너뜁니다(SKIP). 비밀번호를 바꾸지 않습니다.

  기존 계정의 비밀번호를 바꾸려면 이 파일이 아니라
  reset-admin-passwords.ps1 을 쓰세요.

  키를 미리 넣어 두었다면 그대로 씁니다.
    $env:SUPABASE_SERVICE_ROLE_KEY = '...'
#>

[CmdletBinding()]
param(
  # 0 은 "안 줬다"는 뜻입니다. 아래에서 함께 걸러냅니다 —
  # 0 을 직접 넣어도 허용 범위 밖이라 어차피 멈춥니다.
  [int]$Start = 0,
  [int]$End = 0,
  [switch]$Apply,
  # 기본이 이미 점검 모드라 없어도 같습니다. 예전 습관을 위해 받습니다.
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

# ── 범위 확인 ───────────────────────────────────────────────────
# .mjs 도 같은 검사를 합니다. 여기서 먼저 걸러 주는 이유는,
# 잘못된 범위 때문에 service_role 키를 물어보는 일이 없게 하기
# 위해서입니다.
$RangeMin = 1
$RangeMax = 50

if ($Start -eq 0 -and $End -eq 0) {
  Write-Host ''
  Write-Host '[중단] 만들 범위를 지정해 주세요.' -ForegroundColor Red
  Write-Host "  예:  .\scripts\create-admin-users.ps1 -Start 21 -End 25"
  Write-Host "  허용 범위: $RangeMin ~ $RangeMax (aisw01 ~ aisw$RangeMax)"
  Write-Host ''
  exit 1
}

$problem = $null
if ($Start -lt $RangeMin -or $Start -gt $RangeMax) {
  $problem = "시작 번호가 허용 범위를 벗어났습니다: $Start (허용 $RangeMin~$RangeMax)"
} elseif ($End -lt $RangeMin -or $End -gt $RangeMax) {
  $problem = "끝 번호가 허용 범위를 벗어났습니다: $End (허용 $RangeMin~$RangeMax)"
} elseif ($Start -gt $End) {
  $problem = "시작 번호가 끝 번호보다 큽니다: $Start > $End"
}

if ($problem) {
  Write-Host ''
  Write-Host "[중단] $problem" -ForegroundColor Red
  Write-Host '  아무것도 하지 않았습니다.'
  Write-Host ''
  exit 1
}

# 어디서 실행하든 저장소 뿌리에서 돌도록 맞춥니다.
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$script = Join-Path $PSScriptRoot 'create-admin-users.mjs'
if (-not (Test-Path $script)) {
  Write-Host "[중단] $script 를 찾을 수 없습니다." -ForegroundColor Red
  exit 1
}

# node 확인 — 없으면 무슨 일이 난 건지 알기 어려운 오류만 납니다.
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host '[중단] node 를 찾을 수 없습니다. https://nodejs.org 에서 설치해 주세요.' -ForegroundColor Red
  exit 1
}

# ── service_role 키 ─────────────────────────────────────────────
if (-not $env:SUPABASE_SERVICE_ROLE_KEY) {
  Write-Host ''
  Write-Host 'Supabase service_role 키가 필요합니다.' -ForegroundColor Yellow
  Write-Host '  Supabase → Project Settings → API → service_role (secret)'
  Write-Host '  이 키는 RLS 를 전부 무시하는 마스터 키입니다. 파일이나 git 에 남기지 마세요.'
  Write-Host ''

  $secure = Read-Host -Prompt 'service_role 키 붙여넣기' -AsSecureString
  if (-not $secure -or $secure.Length -eq 0) {
    Write-Host '[중단] 키를 입력하지 않았습니다.' -ForegroundColor Red
    exit 1
  }

  # SecureString → 평문. 이 프로세스의 환경변수로만 넘기고
  # 끝나면 지웁니다. 디스크에는 쓰지 않습니다.
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    $env:SUPABASE_SERVICE_ROLE_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
  $keyWasTemporary = $true
}

# ── 인자 ────────────────────────────────────────────────────────
# --apply 가 없으면 .mjs 는 무조건 점검만 합니다.
$nodeArgs = @('--start', $Start, '--end', $End)
if ($Apply) { $nodeArgs += '--apply' }

$firstId = 'aisw' + $Start.ToString('00')
$lastId  = 'aisw' + $End.ToString('00')
$count   = $End - $Start + 1

# 실제 생성은 한 번 더 묻습니다. 되돌리려면 Supabase 에서
# 사용자를 손으로 지워야 하기 때문입니다.
if ($Apply) {
  Write-Host ''
  Write-Host "실제로 Supabase Auth 에 계정을 만듭니다: $firstId ~ $lastId (최대 $count 개)" -ForegroundColor Yellow
  Write-Host '  · 이미 있는 계정은 건너뜁니다. 비밀번호를 바꾸지 않습니다.'
  Write-Host '  · 기존 계정(aifest@ice.go.kr) 은 건드리지 않습니다.'
  Write-Host '  · 새로 만든 계정의 비밀번호만 admin-accounts.csv 에 저장됩니다 (git 제외).'
  Write-Host '  · 예전 admin-accounts.csv 가 있으면 지우지 않고 옆으로 옮겨 둡니다.'
  Write-Host ''
  $answer = Read-Host '계속하려면 yes 를 입력하세요'
  if ($answer -ne 'yes') {
    Write-Host '취소했습니다. 아무것도 만들지 않았습니다.'
    if ($keyWasTemporary) { Remove-Item Env:\SUPABASE_SERVICE_ROLE_KEY -ErrorAction SilentlyContinue }
    exit 0
  }
}

try {
  & node $script @nodeArgs
  $code = $LASTEXITCODE
} finally {
  # 이 창에서 키를 입력받았다면 남겨 두지 않습니다.
  if ($keyWasTemporary) { Remove-Item Env:\SUPABASE_SERVICE_ROLE_KEY -ErrorAction SilentlyContinue }
}

if ($Apply -and $code -eq 0) {
  Write-Host ''
  Write-Host 'admin-accounts.csv 는 .gitignore 로 제외되어 있습니다.' -ForegroundColor Yellow
  Write-Host '전달이 끝나면 지우세요.'
  Write-Host ''
}

exit $code
