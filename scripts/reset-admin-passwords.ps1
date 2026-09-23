<#
  관리자 비밀번호 재설정 — aisw01 ~ aisw20
  ────────────────────────────────────────────────────────────────
  scripts/reset-admin-passwords.mjs 를 안전하게 돌려 주는 껍데기입니다.
  실제 일은 .mjs 가 합니다.

  이미 있는 계정의 비밀번호만 바꿉니다. 계정을 만들거나 지우지
  않습니다. 계정을 새로 만들려면 create-admin-users.ps1 을 쓰세요.

  service_role 키를 화면에 보이지 않게 입력받아, 이 PowerShell
  프로세스 안에서만 환경변수로 둡니다. 파일에 남기지 않습니다.

  쓰는 법
    .\scripts\reset-admin-passwords.ps1            # 확인만 (기본)
    .\scripts\reset-admin-passwords.ps1 -DryRun    # 새 비밀번호까지 만들어 검사
    .\scripts\reset-admin-passwords.ps1 -Apply     # 실제 변경

  키를 미리 넣어 두었다면 그대로 씁니다.
    $env:SUPABASE_SERVICE_ROLE_KEY = '...'
#>

[CmdletBinding()]
param(
  [switch]$Apply,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

# 어디서 실행하든 저장소 뿌리에서 돌도록 맞춥니다.
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$script = Join-Path $PSScriptRoot 'reset-admin-passwords.mjs'
if (-not (Test-Path $script)) {
  Write-Host "[중단] $script 를 찾을 수 없습니다." -ForegroundColor Red
  exit 1
}

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

# ── 모드 ────────────────────────────────────────────────────────
$modeArg = '--check'
if ($DryRun) { $modeArg = '--dry-run' }
if ($Apply)  { $modeArg = '--apply' }

# 실제 변경은 한 번 더 묻습니다. 바꾸고 나면 예전 비밀번호는
# 되돌릴 수 없고, 20명에게 새 비밀번호를 다시 돌려야 합니다.
if ($Apply) {
  Write-Host ''
  Write-Host 'aisw01 ~ aisw20 의 비밀번호를 새로 바꿉니다.' -ForegroundColor Yellow
  Write-Host '  · 계정은 그대로 둡니다. UID · staff_profiles · role 은 바뀌지 않습니다.'
  Write-Host '  · 기존 계정(aifest@ice.go.kr) 은 건드리지 않습니다.'
  Write-Host '  · 예전 비밀번호는 즉시 못 쓰게 됩니다. 이미 나눠 준 것이 있다면 다시 전달해야 합니다.'
  Write-Host '  · 새 비밀번호는 admin-accounts.csv 에 덮어써집니다 (git 제외).'
  Write-Host ''
  $answer = Read-Host '계속하려면 yes 를 입력하세요'
  if ($answer -ne 'yes') {
    Write-Host '취소했습니다. 아무것도 바꾸지 않았습니다.'
    if ($keyWasTemporary) { Remove-Item Env:\SUPABASE_SERVICE_ROLE_KEY -ErrorAction SilentlyContinue }
    exit 0
  }
}

try {
  & node $script $modeArg
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
