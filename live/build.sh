#!/bin/sh
# ===================================================================
# 부스 Live 사이트 배포본 만들기 (관람객 화면 + 부스 운영자 화면)
#
# 저장소 뿌리의 두 화면과 그 화면들이 쓰는 파일만 live/dist 로 복사합니다.
#   visitor.html     → index.html       관람객 화면 (사이트 첫 화면)
#   booth-ctrl.html  → booth-ctrl.html  부스 운영자 화면 (운영자 카드 QR 의 #k=열쇠)
#   live/example/    → example/         화면 안내 (/example · 정적 · 스크립트 없음)
# 운영 포털 · 관리자 화면 · QR 인쇄 화면은 넣지 않습니다 — 이 사이트 주소에서
# 뒤를 지우거나 이름을 짐작해 쳐도 운영 포털이 나오지 않게 하려는 것입니다.
# QR 인쇄 화면(print-qr.html)은 관리자 화면(admin.html)과 같은 사이트의
# 로그인 정보로 열쇠를 받으므로 운영 포털에 남습니다. 관람객 QR 과 운영자
# 카드 QR 은 둘 다 이 사이트를 가리키므로, 종이에 운영 포털 주소가 찍히지 않습니다.
#
# 설정 파일(assets/config.js)도 그대로 복사하지 않습니다. 거기에는
# 관리자 로그인 도메인이 있습니다. 두 화면에 필요한 값만 뽑아
# 새 설정 파일을 만듭니다.
#
# 마지막으로 배포본 전체에서 운영 포털의 흔적(인쇄 · 관리자 화면 이름,
# 포털 주소, 관리자 도메인)을 찾고, 하나라도 있으면 빌드를 멈춥니다. 누가
# 공통 엔진이나 두 화면에 운영 포털 이야기를 적어 넣어도 그대로 관람객에게
# 나가지 않게 하는 마지막 그물입니다.
#
# Netlify(live/netlify.toml) · Vercel(live/vercel.json) 이 배포할 때 자동으로
# 돌립니다. 둘 다 이 폴더(live)를 사이트의 뿌리로 두고 sh build.sh → dist 입니다.
# 손으로 확인하려면:  sh live/build.sh   →  live/dist/index.html
# (live/dist 는 .gitignore 에 걸려 있습니다. 확인한 뒤 지워도 됩니다.)
#
# 이 폴더 밖(../)의 원본을 읽습니다. Vercel 은 Root Directory 를 live 로 두면
# 설정에 따라 그 밖의 파일을 빌드에 넣지 않을 수 있습니다. 그러면 아래 첫 확인에서
# 멈추므로, 빈 사이트가 올라가는 일은 없습니다(README '배포' 참고).
#
# POSIX sh 로 씁니다. Netlify 빌드 서버(우분투, sh = dash) · Vercel 빌드 서버
# (Amazon Linux 2023, sh = bash) · Windows 의 Git Bash 에서 같은 결과가 나와야 합니다.
# ===================================================================
set -e
cd "$(dirname "$0")"

# 글자를 바이트로 다룹니다. 빌드 서버와 내 컴퓨터의 언어 설정(로캘)이 달라도
# 아래 sed · grep · awk 가 한글 값을 똑같이 읽게 하려는 것입니다. 찾는 기호
# (따옴표 · 콜론 · 역슬래시)는 모두 ASCII 라서 UTF-8 한글 바이트와 섞이지 않습니다.
LC_ALL=C
export LC_ALL

SRC=../assets/config.js

# echo 가 아니라 printf '%s\n' 으로 찍습니다. Netlify 의 /bin/sh(dash)에서는
# echo 가 \n · \c 같은 역슬래시를 풀어 버려, 역슬래시가 문제라고 알려 주는
# 메시지에서 정작 그 역슬래시가 사라지거나 메시지가 중간에 잘립니다.
fail() {
  printf '%s\n' "빌드 중단: $1" >&2
  exit 1
}

# 설정 파일을 줄 끝의 CR 을 뺀 채로 읽습니다. Windows 에서 CRLF 로
# 받아 둔 저장소에서도 아래 패턴의 '줄 끝($)' 이 똑같이 맞게 하려는 것입니다.
src_lines() {
  tr -d '\r' < "$SRC"
}

# 설정 파일에서 주석(// … 와 /* … */)만 지운 줄들. 따옴표 안의 // 와 /* 는
# 글자로 둡니다('https://…' 뒤가 잘리지 않게). 줄 수는 그대로라(주석만 있던
# 줄은 빈 줄이 됨) 줄 번호가 원본 설정 파일과 같습니다.
# 값을 꺼내는 pick_str · pick_num · pick_help 와 아래 검사들은 모두 이 줄들만
# 봅니다. 설정 파일은 /* */ 주석만 쓰므로, 옛 주소나 옛 숫자를 주석으로 감싸
# 남겨 두기 쉽습니다. 원본 줄(src_lines)을 그대로 읽으면 그 주석 속 옛 값이
# 진짜 값보다 먼저 잡혀, 브라우저(주석을 건너뜀)를 쓰는 운영 포털과 Live
# 사이트가 서로 다른 Supabase 프로젝트를 보게 되는데 빌드는 조용히 통과합니다.
# (문자열이 줄을 넘지 않는다고 봅니다. 설정 파일에는 그런 값이 없습니다.)
code_lines() {
  src_lines | awk -v sq="'" '
    {
      out = ""; n = length($0); i = 1; q = ""
      while (i <= n) {
        c = substr($0, i, 1); d = substr($0, i, 2)
        if (inc) { if (d == "*/") { inc = 0; out = out " "; i += 2 } else i++; continue }
        if (q != "") {
          out = out c
          if (c == "\\") { out = out substr($0, i + 1, 1); i += 2; continue }
          if (c == q) q = ""
          i++; continue
        }
        if (d == "//") break
        if (d == "/*") { inc = 1; i += 2; continue }
        if (c == "\"" || c == sq || c == "`") q = c
        out = out c; i++
      }
      print out
    }'
}

# 줄 맨 앞이 아닌 곳이나 따옴표 친 이름으로 적힌 '이름:' 이 주석 밖에 있는지.
# 진짜 JS 는 그 값을 쓰는데 이 빌드는 못 읽는 모양입니다.
other_form() {
  code_lines | grep -E "(^|[^A-Za-z0-9_\$])[\"'\`]?$1[\"'\`]?[[:space:]]*:" | head -n 1
}

# 같은 이름이 주석 밖에 두 번 이상 적혔으면 멈춥니다(한 줄에 두 번도 셉니다).
# 브라우저는 마지막 값을 쓰는데 아래 pick_* 는 첫 값을 꺼내므로, 그대로 두면
# 운영 포털과 Live 사이트가 다른 값을 씁니다. 어느 쪽이 맞는지는 빌드가
# 정할 수 없으니 사람에게 하나만 남겨 달라고 합니다.
# 메시지에는 줄 번호만 적습니다. 줄 내용을 찍으면 supabaseAnonKey 의 키 값이
# 빌드 로그(사이트 관리자가 모두 봄)에 남기 때문입니다.
only_once() {
  _hits=$(code_lines | grep -noE "(^|[^A-Za-z0-9_\$])[\"'\`]?$1[\"'\`]?[[:space:]]*:" | cut -d: -f1)
  set -- "$1" $_hits
  [ $# -le 2 ] && return 0
  _at=$(printf '%s\n' $_hits | uniq | tr '\n' ' ')
  _at=${_at% }
  fail "assets/config.js 에 $1 가 주석 밖에 두 번 이상 있습니다 (줄 $_at). 브라우저는 마지막 값을 쓰는데 이 빌드는 어느 값을 옮길지 정할 수 없습니다. 하나만 남기고, 옛 값은 지우거나 /* */ 주석으로 감싸 두세요."
}

# 이름: '값', 한 줄을 찾아 값만 꺼냅니다(주석을 지운 줄에서).
# 작은따옴표 · 큰따옴표 둘 다 받지만, 여는 따옴표와 닫는 따옴표가 같아야 하고
# 그 뒤에는 쉼표만 올 수 있습니다. 'https://a' + '.supabase.co' 처럼 이어 붙인
# 값이나 한 줄에 다른 이름을 함께 적은 줄을 앞 토막만 떼어 가면 Live 사이트만
# 엉뚱한 주소 · 키를 쓰게 되므로, 그런 줄은 빈 값(→ 아래에서 빌드 중단)으로 둡니다.
pick_str() {
  code_lines | sed -n "s/^[[:space:]]*$1[[:space:]]*:[[:space:]]*\\([\"']\\)\\([^\"']*\\)\\1[[:space:]]*,\\{0,1\\}[[:space:]]*\$/\\2/p" | head -n 1
}

# 숫자 값(따옴표 없음)을 꺼냅니다. 이름이 어디에도 없으면 빈 값
# (→ 아래에서 기본값)이 됩니다.
# 줄이 있으면 '이름: 숫자,' 와 뒤따르는 주석만 받습니다. 앞자리 숫자만
# 떼어 가면 '20 * 1000' 이나 '20_000' 이 20 이 되어, 운영 포털(진짜 JS 로
# 계산해 20000)에서는 멀쩡한데 관람객 휴대폰 수천 대가 0.02초마다 읽는
# 일이 생깁니다. 그래서 식 · 밑줄 · 0 으로 시작하는 숫자(옛 JS 에서는
# 8진수)는 고쳐 달라고 하고 빌드를 멈춥니다.
# 이름을 따옴표로 감쌌거나("pollingIntervalMs": 60000) 줄 맨 앞이 아닌 곳에
# 적었으면({ … pollingIntervalMs: 60000 }) 진짜 JS 는 그 값을 쓰는데 위 모양에는
# 걸리지 않습니다. '없음' 으로 보고 기본값을 쓰면 운영 포털(60000)과 Live
# 사이트(20000)가 조용히 달라지므로, 주석 밖에 '이름:' 이 있으면 멈춥니다.
# 주석을 지운 줄(code_lines)에서 찾습니다. 주석으로 감싸 둔 옛 값
# (/* pollingIntervalMs: 30000, */)이 진짜 값보다 먼저 잡히지 않게 하려는 것입니다.
# 명령 치환 $( ) 안에서 부르므로 fail 은 이 함수만 끝냅니다. 부르는 쪽에서
# '|| exit 1' 로 빌드를 멈춥니다(메시지는 stderr 로 이미 나갔습니다).
pick_num() {
  _line=$(code_lines | grep "^[[:space:]]*$1[[:space:]]*:" | head -n 1)
  if [ -z "$_line" ]; then
    _other=$(other_form "$1")
    [ -z "$_other" ] || fail "assets/config.js 의 $1 를 읽지 못했습니다. 이름에 따옴표 없이 줄 맨 앞에서 한 줄로 '$1: 숫자,' 처럼 적어 주세요. 이대로 두면 Live 사이트만 기본값을 써서 운영 포털과 값이 달라집니다. 지금 줄:$_other"
    return 0
  fi
  _num=$(printf '%s\n' "$_line" | sed -n 's|^[[:space:]]*'"$1"'[[:space:]]*:[[:space:]]*\([1-9][0-9]*\)[[:space:]]*,\{0,1\}[[:space:]]*\(/[/*].*\)\{0,1\}$|\1|p')
  [ -n "$_num" ] || fail "assets/config.js 의 $1 는 계산식 없이 숫자 하나만 적어 주세요 (예: 20000 · 30). 계산식 · 밑줄 · 0 으로 시작하는 숫자는 읽지 않습니다. 지금 줄:$_line"
  printf '%s\n' "$_num"
}

# 운영자 화면의 도움 요청 한 줄(boothHelpLine)을 꺼냅니다.
# 받는 모양은 하나뿐입니다:  boothHelpLine: '글',   (한 줄 · 작은따옴표)
# 꺼낸 글은 새 설정 파일에 작은따옴표 문자열로 그대로 다시 적습니다. 그래서
# 그 안에 작은따옴표 · 역슬래시(\' · \n 같은 이스케이프)가 있으면 받지 않습니다
# — 고쳐 옮기다 뜻이 바뀌거나, 설정 파일이 깨져 운영자 화면 전체가 "연결 설정을
# 불러오지 못했습니다" 가 되는 것보다 빌드를 멈추는 편이 낫습니다.
# 줄이 아예 없으면 빈 값을 돌려줍니다(운영자 화면이 '운영본부에 문의해 주세요' 를 씁니다).
# 주석을 지운 줄(code_lines)에서 찾습니다. 설명 주석의 예시 줄이 진짜 값보다
# 먼저 잡혀 카드 · 화면에 엉뚱한 글이 찍히지 않게 하려는 것입니다.
# 값이 비었는지와 '모양이 틀려 못 읽었는지' 를 가르려고 sed 가 '=' 를 앞에 붙입니다.
pick_help() {
  _line=$(code_lines | grep "^[[:space:]]*boothHelpLine[[:space:]]*:" | head -n 1)
  if [ -z "$_line" ]; then
    _other=$(other_form boothHelpLine)
    [ -z "$_other" ] || fail "assets/config.js 의 boothHelpLine 을 읽지 못했습니다. 이름에 따옴표 없이 줄 맨 앞에서 한 줄로 boothHelpLine: '글', 처럼 적어 주세요. 지금 줄:$_other"
    return 0
  fi
  _val=$(printf '%s\n' "$_line" | sed -n 's|^[[:space:]]*boothHelpLine[[:space:]]*:[[:space:]]*'"'"'\([^'"'"']*\)'"'"'[[:space:]]*,\{0,1\}[[:space:]]*\(/[/*].*\)\{0,1\}$|=\1|p')
  [ -n "$_val" ] || fail "assets/config.js 의 boothHelpLine 은 한 줄에 작은따옴표로 boothHelpLine: '글', 처럼 적어 주세요. 큰따옴표 · 여러 줄 · 글 안의 작은따옴표는 읽지 않습니다. 지금 줄:$_line"
  _val=${_val#=}
  case "$_val" in
    *\\*) fail "assets/config.js 의 boothHelpLine 에 역슬래시(\\)가 있습니다. 이스케이프 없이 글자만 적어 주세요. 지금 줄:$_line" ;;
  esac
  # 줄 나눔 문자 U+2028 · U+2029 는 눈에 보이지 않지만 옛 브라우저의 JS 문자열을 깹니다.
  if printf '%s\n' "$_val" | grep -q -e "$(printf '\342\200\250')" -e "$(printf '\342\200\251')"; then
    fail "assets/config.js 의 boothHelpLine 에 보이지 않는 줄 나눔 문자(U+2028 · U+2029)가 있습니다. 그 줄을 지우고 다시 쳐 주세요."
  fi
  printf '%s\n' "$_val"
}

# Vercel 에서 이 줄에 걸리면 저장소 뿌리의 파일이 빌드에 들어오지 않은 것입니다.
[ -f "$SRC" ] || fail "$SRC 가 없습니다. Vercel 이면 Settings → Build and Deployment → Root Directory 의 'Include files outside the root directory in the Build Step' 을 켜고 다시 배포하세요."

# 값을 꺼내기 전에 이름마다 주석 밖에 한 번만 있는지 봅니다(only_once).
# 여기는 명령 치환 밖이라 fail 이 곧바로 빌드를 멈춥니다.
for _key in supabaseUrl supabaseAnonKey pollingIntervalMs freshnessThresholdMinutes boothHelpLine; do
  only_once "$_key"
done

SB_URL=$(pick_str supabaseUrl) || exit 1
SB_KEY=$(pick_str supabaseAnonKey) || exit 1
POLL_MS=$(pick_num pollingIntervalMs) || exit 1
FRESH_MIN=$(pick_num freshnessThresholdMinutes) || exit 1
HELP_LINE=$(pick_help) || exit 1

# 연결 정보가 없으면 두 화면은 "연결 설정을 불러오지 못했습니다" 만
# 보여 줍니다. 그런 배포본을 조용히 올리느니 빌드를 멈추는 편이
# 낫습니다 — Netlify · Vercel 모두 실패한 빌드는 올리지 않고 앞 배포본을 그대로 둡니다.
[ -n "$SB_URL" ] || fail "assets/config.js 에서 supabaseUrl 을 읽지 못했습니다. 주석 밖에 supabaseUrl: '...', 한 줄만(이어 붙이기 · 다른 이름 없이) 적었는지 확인하세요."
[ -n "$SB_KEY" ] || fail "assets/config.js 에서 supabaseAnonKey 를 읽지 못했습니다. 주석 밖에 supabaseAnonKey: '...', 한 줄만(이어 붙이기 · 다른 이름 없이) 적었는지 확인하세요."

case "$SB_URL" in
  https://*) ;;
  *) fail "supabaseUrl 이 https:// 로 시작하지 않습니다: $SB_URL" ;;
esac

# secret · service_role 키가 실수로 들어갔다면 관람객 수천 명에게 RLS 를
# 무시하는 마스터 키를 나눠 주는 셈입니다. 그래서 '나쁜 키를 거르는'
# 대신 '공개용 키만 통과' 시킵니다(모르는 모양은 멈춤).
#   sb_publishable_…  새 공개용 키 → 통과
#   eyJ…(JWT)         예전(legacy) 키. 대시보드에 anon 과 service_role 이
#                     나란히 있어 헷갈리기 쉽습니다. 가운데 토막을 풀어
#                     "role":"anon" 일 때만 통과시킵니다. 풀리지 않아도 멈춤.
#   그 밖(sb_secret_… 포함)            → 멈춤
# 멈출 때도 키 값은 로그에 찍지 않습니다(빌드 로그는 사이트 관리자가 모두 봅니다).
case "$SB_KEY" in
  sb_publishable_*) ;;
  eyJ*)
    # JWT 가운데 토막은 base64url(+ 대신 -, / 대신 _, 끝의 = 생략)이라
    # base64 -d 가 읽도록 되돌린 뒤 풉니다.
    P=$(printf '%s' "$SB_KEY" | cut -d. -f2 | tr '_-' '/+')
    case $(( ${#P} % 4 )) in
      2) P="$P==" ;;
      3) P="$P=" ;;
    esac
    printf '%s' "$P" | base64 -d 2>/dev/null | grep -q '"role"[[:space:]]*:[[:space:]]*"anon"' ||
      fail "supabaseAnonKey 가 anon 키가 아닙니다(service_role 키일 수 있습니다). Supabase → Project Settings → API Keys 의 Publishable key 를 넣으세요."
    ;;
  sb_secret_*) fail "supabaseAnonKey 에 secret 키가 들어 있습니다. Publishable key(sb_publishable_…)만 넣으세요." ;;
  *) fail "supabaseAnonKey 는 Publishable key(sb_publishable_…)여야 합니다." ;;
esac

# 아래에서 두 값을 작은따옴표 문자열로 다시 적습니다. 위 pick_str 은 따옴표만
# 빼고 읽으므로, 역슬래시가 섞여 있으면 새 설정 파일이 깨지거나 뜻이 바뀝니다.
# 주소와 공개용 키에는 원래 없는 글자라 있으면 잘못 붙여 넣은 것입니다.
case "$SB_URL$SB_KEY" in
  *\\*) fail "supabaseUrl · supabaseAnonKey 에 역슬래시(\\)가 있습니다. 대시보드에서 값을 다시 복사해 넣으세요." ;;
esac

# 숫자가 없으면 화면 쪽 기본값과 같은 값을 씁니다.
[ -n "$POLL_MS" ] || POLL_MS=20000
[ -n "$FRESH_MIN" ] || FRESH_MIN=30

# 너무 짧은 간격은 관람객 휴대폰 수만큼 요청을 늘려 행사 날 Supabase 를
# 막을 수 있습니다. 숫자 읽기가 맞아도 값 자체가 너무 작으면 멈춥니다.
[ "$POLL_MS" -ge 15000 ] || fail "pollingIntervalMs 가 너무 작습니다: $POLL_MS (15000 이상, 권장 20000)"
[ "$FRESH_MIN" -ge 5 ] || fail "freshnessThresholdMinutes 가 너무 작습니다: $FRESH_MIN (5 이상, 권장 30)"

rm -rf dist
mkdir -p dist/assets

cp ../visitor.html dist/index.html
cp ../booth-ctrl.html dist/booth-ctrl.html
cp ../assets/booth-core.js ../assets/mock-data.js ../assets/visitor.css ../assets/booth-ctrl.css dist/assets/

# 화면 안내(/example): 두 화면을 소개하고 각 화면으로 보내는 정적 페이지.
# 스크립트 · 데이터 요청이 없고, 이 폴더(live/example) 안의 두 파일만 씁니다.
mkdir -p dist/example
cp example/index.html example/example.css dist/example/

# Live 사이트용 설정 파일. 운영 포털 설정에서 두 화면이 쓰는 값만 옮깁니다.
# visitorSiteUrl 은 운영자 화면의 '관람객 화면' 링크입니다. 관람객 화면이
# 이 사이트의 첫 화면(index.html)이라 원본 값과 관계없이 './' 로 둡니다.
# 값은 printf '%s' 로 적어 셸이 다시 풀지 않게 합니다($ · ` · \ 그대로).
{
  printf '%s\n' \
    '/* Live 사이트(관람객 화면 · 부스 운영자 화면)용 연결 정보.' \
    '   live/build.sh 가 배포 때마다 저장소의 설정 파일에서 필요한 값만' \
    '   골라 만듭니다. 여기를 고치지 말고 원본 설정 파일을 고치세요.' \
    '   supabaseAnonKey 는 브라우저 공개용 키입니다. 실제 권한은' \
    '   데이터베이스의 RLS 정책과 부스 열쇠가 막습니다. */' \
    'window.FESTIVAL_CONFIG = {'
  printf "  supabaseUrl: '%s',\n" "$SB_URL"
  printf "  supabaseAnonKey: '%s',\n" "$SB_KEY"
  printf '  pollingIntervalMs: %s,\n' "$POLL_MS"
  printf '  freshnessThresholdMinutes: %s,\n' "$FRESH_MIN"
  printf "  boothHelpLine: '%s',\n" "$HELP_LINE"
  printf "  visitorSiteUrl: './'\n"
  printf '};\n'
} > dist/assets/config.js

printf 'User-agent: *\nDisallow: /\n' > dist/robots.txt

# 두 화면이 부르는 이 사이트 안의 파일(src · href)이 배포본에 모두 있는지 봅니다.
# 누가 화면에 새 스크립트나 스타일을 더하고 위 복사 목록에 빠뜨리면, 운영자
# 화면이 행사 날 빈 화면이 됩니다. 주소(https:// · //) · # 링크 · JS 로 이어 붙인
# 문자열(따옴표가 섞인 값)은 건너뜁니다. visitor.html 은 live/netlify.toml ·
# live/vercel.json 이 첫 화면(index.html)으로 이어 줍니다.
MISSING=$(grep -ohE '(src|href)="[^"]*"' dist/index.html dist/booth-ctrl.html |
  sed -e 's/^[a-z]*="//' -e 's/"$//' -e 's/[?#].*$//' | sort -u |
  while IFS= read -r ref; do
    case "$ref" in
      ''|.|./|*:*|/*|*"'"*|*' '*|visitor.html) continue ;;
    esac
    [ -f "dist/$ref" ] || printf ' %s' "$ref"
  done)
[ -z "$MISSING" ] || fail "배포본에 없는 파일을 화면이 부릅니다:$MISSING — live/build.sh 의 복사 목록과 live/netlify.toml 의 ignore 목록에 더하세요(assets/ 밖의 파일이면 live/vercel.json 의 ignoreCommand 에도)."

# 운영 포털의 흔적이 배포본에 섞였는지 마지막으로 확인합니다.
# 부스 운영자 화면(booth-ctrl)은 이 사이트에 있어야 하므로 찾지 않습니다.
LEAK='print-qr|admin\.html|incheon-aisw-festival|github\.io|adminIdDomain'
if grep -rqiE "$LEAK" dist; then
  printf '%s\n' "빌드 중단: Live 사이트 배포본에 운영 포털 흔적이 있습니다" >&2
  grep -rniE "$LEAK" dist >&2 || true
  exit 1
fi

printf '%s\n' "부스 Live 사이트 배포본: $(pwd)/dist"
ls -R dist
