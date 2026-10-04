# 부스 Live 부하 계산 (관람객 100명 ~ 100,000명)

Production 에 부하를 걸지 않고 **계산으로** 본 결과입니다. 숫자는 측정값이 아니라
`model.mjs` 가 화면 코드의 되풀이 규칙을 그대로 흉내 내어 낸 추정치입니다.
전체 표는 [RESULTS.md](RESULTS.md) (같은 인자로 돌리면 같은 표가 나옵니다).

```bash
node scripts/loadtest/model.mjs > scripts/loadtest/RESULTS.md
```

## Phase 2 (이 브랜치) — 관람객 → Vercel CDN → `/api/live-snapshot` → Supabase

Phase 1 감사(아래)의 B 구조를 만들었습니다. Production 에는 아직 반영하지 않았습니다.

| 층 | 무엇 | 값 | 코드 |
|---|---|---|---|
| 브라우저 | 스냅샷 1개를 20초 ±4초마다. 가려지면 멈춤, 보이면 곧바로. 겹쳐 보내지 않음. 실패하면 40 → 80 → 120초(±20%), 성공하면 20초로. 마지막 값 유지. **Supabase fallback 없음** | `Cache-Control: no-store` | [visitor.html](../../visitor.html) `refresh` · `schedule` · `resume`, [booth-core.js](../../assets/booth-core.js) `getLiveSnapshot` |
| Vercel CDN | 같은 주소 하나를 캐시. 질의 문자열이 붙으면 400 | `Vercel-CDN-Cache-Control: max-age=10, stale-while-revalidate=30, stale-if-error=600` | [live/api/live-snapshot.mjs](../../live/api/live-snapshot.mjs) |
| 함수 | 인스턴스 memo(booth_live 5초 · 목록 60초), single-flight, Supabase 실패 때 last-good 10분 · 5초 쉼 | | 같은 파일 |
| Supabase | 공개용 키 · RLS 그대로. 관람객 몫은 관람객 수와 무관하게 최대 약 0.75 RPS | | |

확인된 사실(2026-10-04): Supabase 프로젝트는 **Free 플랜 · ap-south-1(뭄바이)** 입니다.
한국에서 REST 첫 바이트까지 0.56~1.3초(서버 처리 18ms)라, CDN 이 받아 주는 효과가 지연에서도 큽니다.

### Preview 실측 (2026-10-04, 커밋 8eb0f82, 부하 시험 아님)

Preview 배포(`incheon-live-4nhddw0kv-jin-jin2.vercel.app`, Vercel 인증 뒤)에서 브라우저 한 개로 잰 값입니다.
경로는 엣지 icn1(서울) → 함수 iad1(미국 동부) → Supabase(뭄바이)입니다(`x-vercel-id`).
Preview 는 Production Supabase 를 공개용 키로 **읽기만** 합니다.

| 시험 | 결과 |
|---|---|
| 48초 쉬고 첫 요청 | `x-vercel-cache: MISS`, 992ms (함수 안 Supabase 734ms, `Server-Timing`) |
| 곧바로 5번 | 모두 `HIT`, 43~59ms, `generatedAt` 같음(함수가 다시 만들지 않음) |
| 만료(10초) 뒤 | `STALE` 68ms(기다리지 않음) → 뒤에서 1번 갱신 → 다음부터 새 `generatedAt` 으로 `HIT` |
| 초당 2건 · 40초(79건) | MISS 0 · HIT 71 · STALE 8, 새 스냅샷 4개(약 11초에 1번), p50 49ms · p95 71ms |
| 만료 순간 동시 20건 | 20건 모두 `STALE`, 그 뒤 새 스냅샷 1개(갱신이 하나로 묶임) |
| 같은 구간 Supabase 기록 | 함수(IAD · `node`)의 REST 요청: 13:29:10~13:30:00 UTC 에 booth_live 4 + 목록 3 = **7건**(브라우저 79건). 시험 전체에서 분당 최대 8건 |
| 요청 머리 `Cache-Control: no-cache`(fetch `cache:'no-store'`) | `STALE`·`HIT` — CDN 을 우회하지 못함 |
| `?t=…` 붙인 요청 · POST | 400 · 405 |
| 응답 머리 | 브라우저 `Cache-Control: no-store`, `Vercel-CDN-Cache-Control` 은 밖으로 나오지 않음, `br` 압축(3,235B 압축 전) |
| 공개 값 점검 | 최상위 `version, generatedAt, liveReady, event, zones, booths`, 부스 `id, no, code, zone, name, org, program, status, waitMinutes, updatedAt`. token · pin · session · phone · manager · memo · private · email · `[예시]` · 키 문자열 0건 |
| 관람객 화면 | 12개 부스 정상, 요청은 `/api/live-snapshot` 뿐(supabase.co 0건) |
| 간격 · 숨김 · 묶음 | 20초 ±4초(18.4~23.0초). 창이 실제로 가려진 48초 동안 0건, 숨김 흉내 30초 0건, 보이면 0~2ms 안에 1건. 받는 중 16번 깨워도 1건 |
| 실패(응답을 503 으로 바꿔치기) | 35.4 → 87.7 → 101.3초로 늦춤, 목록 그대로, 3분 뒤 '현황 연결이 잠시 지연되고 있습니다.' 한 줄. 실패 동안 다른 주소 · Supabase 요청 0건. 풀리자 다음 시도에서 회복 → 23.0 · 22.7초 간격으로 돌아옴 |

## Hobby(무료) 운영 (이 브랜치)

무료 플랜에서 먼저 닳는 것은 Supabase 가 아니라 **Vercel 월 CDN 요청 100만 건**입니다. 캐시 HIT 도 1건이라
캐시 비율이 아니라 요청 '개수' 를 줄였습니다.

| 무엇 | 지금 | 코드 |
|---|---|---|
| 받는 간격 | 60초 ±10초(설정 `pollingIntervalMs: 60000`). 처음 열 때는 곧바로 1건 | `visitor.html` `schedule` |
| 행사 시간 | 행사 날 여는 시각 30분 전 ~ 닫는 시각 30분 뒤(설정의 시작 · 종료 시각, 한국 시각 — 지금 DB 값으로 11/6 · 11/7 09:30~17:30)에만 자동으로 받음. 그 밖에는 처음 열 때 · 화면에 돌아올 때만. 시간대가 열리면 관람객마다 0~60초 흩뜨려 깨어남 | `liveWindow` |
| 화면 숨김 | 가려지면 멈춤, 돌아오면 곧바로 1건(30초 안에 받았으면 건너뜀 · 실패가 이어지는 동안은 늦춘 간격을 지킴) | `resume` |
| 받기 방식 | Vercel 환경 변수 `VISITOR_TRAFFIC_MODE` = `normal`(60초) · `conserve`(120초) · `manual`(자동 없음, 띠에 작은 '새로고침'). 스냅샷의 `mode` 로 전해짐. 바꾸려면 값을 고치고 Redeploy | `live/api/live-snapshot.mjs` |
| 실패 | 90초 → 120초 → 180초(±15%), 지금 간격보다 짧아지지 않음. manual · 행사 시간 밖에서는 다시 시도하지 않음 | `schedule` |
| '연결 지연' 한 줄 | 자동으로 받는 동안 새 `generatedAt` 을 간격 × 2.5(60초면 180초, 120초면 300초) 넘게 못 받을 때. 자동으로 받지 않을 때는 마지막 받기가 실패했을 때만 | `isLagging` |
| 정적 파일 | 빌드 때 이름에 내용 지문(`visitor.3616346835.css`) + `Cache-Control: public, max-age=31536000, immutable`. HTML 은 그대로 열 때마다 확인(`no-cache`). 빈 아이콘(`data:,`)으로 `/favicon.ico` 요청 없앰 | `live/build.sh`, `live/vercel.json` |

**받기 방식 바꾸는 법** (코드 · DB 그대로, QR · PIN · 운영자 저장 · 관리 화면 영향 없음)

1. vercel.com → 팀 jin-jin2 → incheon-live → Settings → Environment Variables
2. `VISITOR_TRAFFIC_MODE` 를 `conserve` 또는 `manual` 로(없으면 추가, Environment: Production)
3. Deployments → 맨 위 Production 배포 → ⋯ → Redeploy(1분 안팎)
4. 관람객 화면은 CDN 사본이 바뀐 뒤(10~40초) 다음 받기부터 따릅니다. 되돌리려면 `normal` 로 같은 순서.

**GREEN · YELLOW · RED** — 행사 시간에 한 시간마다 Vercel → Usage 의 **CDN Requests(최근 30일)** 숫자를 적고,
한 시간 전과의 차이(= 지난 한 시간 요청)를 봅니다. 예산은 월 100만 건 중 행사 전 30일 몫(미리보기 · 리허설 · 운영자)
15만 건을 남겨 두고 행사 이틀에 85만 건, 하루 42.5만 건, 자동으로 받는 8시간에 시간당 약 5.3만 건입니다.

| 단계 | 지난 한 시간 | 최근 30일 합계 | 받기 방식 | 대략 동시 관람객(그 방식에서) |
|---|---|---|---|---|
| GREEN | 3.5만 건 아래 | 55만 건 아래 | `normal` 60초 | ~390명 아래 |
| YELLOW | 3.5만~5.5만 건 | 55만~75만 건 | `conserve` 120초 | ~920명까지 |
| RED | 5.5만 건 넘음 | 75만 건 넘음 | `manual` | ~1,800명까지 |

1일째가 끝났을 때 30일 합계가 60만 건을 넘었으면 2일째는 `conserve` 로 시작합니다. 90만 건을 넘으면 `manual` 로
두고, 그래도 넘칠 것 같으면 Pro 전환(결제)을 판단합니다. Hobby 는 넘는 순간 기능이 30일 동안 멈추고, 관람객
화면과 운영자 화면(booth-ctrl)이 같은 프로젝트라 함께 멈춥니다.

**GitHub Pages 비상 경로**

- 운영자 화면(`booth-ctrl.html`)은 포털(GitHub Pages)에도 함께 올라가 있습니다. 주소에 묶인 코드가 없고 연결 값은
  설정 파일(같은 Supabase · 같은 공개용 키)에서 와서, 포털 설정 그대로 띄운 화면에서 시작 화면 · 구역 · 부스 목록을
  Supabase 에서 정상으로 읽었습니다(2026-10-04, 로컬 · 읽기만, PIN 로그인은 하지 않음 — Production DB 에 세션이 생기므로).
  Vercel 이 멈추면 운영본부가 포털의 `booth-ctrl.html` 주소를 알려 주고 **PIN 으로** 시작하게 할 수 있습니다.
  QR 카드는 Vercel 주소를 담고 있어 그대로는 쓸 수 없고, 저장 기기(localStorage)가 사이트마다 따로라 새로 로그인해야
  합니다. 실제 PIN 은 지금 A-01 · A-02 에만 발급되어 있으니, 비상 경로로 쓰려면 행사 전에 실제 부스 PIN 을 발급해
  두어야 합니다. 운영자가 포털 주소를 알게 되는 것도 감수해야 합니다(관리 화면은 로그인으로 막혀 있음).
- 관람객 비상 안내 페이지는 만들지 않았습니다. 관람객 QR 은 Vercel 주소라 Vercel 이 멈추면 포털에 둔 페이지로
  데려갈 길이 없고(QR 을 다시 인쇄할 수 없음), 포털에 따로 알려 줄 주소는 현장 안내판과 다를 것이 없습니다.
  Vercel 이 멈추면 현장 안내(종이 배치도 · 방송)로 대신합니다.

## Production 반영 전 확인 (2026-10-04)

**Vercel 요금제** (팀 jin-jin2 · 대시보드 Settings → Billing / Usage 에서 확인)

- **Hobby 플랜**, 결제 수단 없음. 월 포함량은 CDN 요청 100만 · Fast Data Transfer 100GB ·
  함수 호출 100만 · Active CPU 4시간입니다. 넘으면 대부분 **30일 동안 그 기능이 멈춥니다**(과금 아님).
  Hobby 는 비상업 · 개인 용도로만 쓸 수 있습니다(docs/plans/hobby).
- 최근 30일 사용량(10/4 07:00 기준): CDN 요청 1.8만, 전송 430MB, 함수 호출 0.
- Pro 는 $20/월에 $20 크레딧이 들어 있습니다. Flat Rate CDN 기본 등급(요청 100만 · 1TB)이 포함되고,
  상위 등급은 $20(1천만) · $100(5천만) · $300(1억5천만, 각 50TB)입니다.
  하루 급증으로는 등급이 오르지 않고, 한 달 합계가 넘으면 다음 달부터 상위 등급이 됩니다
  (docs/pricing/flat-rate-cdn).

| 동시 관람객(화면이 모두 켜져 있다고 봄) | CDN 요청/시간 | 전송/시간 | Hobby 100만 건이 바닥나는 시간 | 7시간 × 2일 내내 이 수준이면 |
|---|---|---|---|---|
| 5,000 | 108만 | 3.3GB | 56분 | 1,512만 건 · 47GB |
| 10,000 | 216만 | 6.6GB | 28분 | 3,024만 건 · 93GB |
| 30,000 | 648만 | 19.9GB | 9분 | 9,072만 건 · 279GB |
| 100,000 | 2,160만 | 66.4GB | 3분 | 3억 240만 건 · 930GB |

**Preview 에서 더 확인한 것**

- Fluid compute 켜짐. 함수 리전은 Hobby 에서 1곳만 고를 수 있고 bom1 을 고를 수 있습니다.
- 캐시가 빈 상태에서 동시 20건 → MISS 1 · HIT 19, Supabase 요청 booth_live **1건**(CDN 이 기다리게 묶음 + 함수 memo).
- 함수 리전 A/B(각 5번, 40초 넘게 쉬고 MISS):

  | 리전 | MISS 전체 응답 중앙값 | 함수→Supabase 중앙값 | Supabase 게이트웨이 시간(기록) |
  |---|---|---|---|
  | iad1(지금) | 1,023ms (964~1,210) | 751ms | 582~736ms |
  | bom1(실험 브랜치 `claude/region-bom1-experiment`) | 845ms (492~959) | 581ms | 210~496ms |

  DB 처리는 25~40ms 이고 나머지는 Supabase 게이트웨이까지의 길입니다. HIT · STALE 은 두 리전 모두 20~70ms 라
  관람객이 느끼는 차이는 캐시가 40초 넘게 빈 뒤의 첫 요청에만 있습니다.
- GitHub Pages 사본(포털 설정): `?demo=1` 은 그 자리에서 열림(서버 요청 0), 일반 접근은
  `https://incheon-live.vercel.app/?b=…` 로 옮겨짐. Live 배포본(`visitorSiteUrl: './'`)은 옮기지 않음.
- '연결 지연' 한 줄: 새 `generatedAt` 을 90초 넘게 못 받을 때(한 번 실패 → 40초 뒤 회복은 넘지 않음).
- 저단계 시험기: `preview-load-browser.js`(로그인한 Preview 탭 콘솔에서), `preview-load.mjs`(Node).

## Phase 1 감사 결론 (이전 구조)

1. **지금 구조는 목표를 만족하지 않습니다.** 관람객 화면이 Supabase REST 를 직접 부르고
   (`cache: 'no-store'`), 그 사이에 CDN 이 없습니다. 관람객 요청이 **100% Supabase 에 닿습니다**
   (데이터 cache hit 0%). 100,000명이면 정상일 때도 초당 약 6,300건, 무너진 뒤에는 약 42,000건입니다.
2. **5,000명 운영 보장도 Supabase 처리 한도에 달려 있습니다.** 한도를 400 RPS 로 가정하면 5,000명은
   사용률 81%로 버티지만 붕괴선(약 5,600명)과 12%밖에 떨어져 있지 않습니다. 한도가 200 RPS 면 약 2,700명에서
   무너집니다. 한도는 아직 잰 적이 없습니다(아래 '확인할 것' 1).
3. **한 번 무너지면 스스로 돌아오지 못합니다(metastable failure).** 실패한 관람객은 10초 고정 재시도를 하고,
   5분이 지나면 재시도마다 GET 4개를 보냅니다. 그래서 100,000명이 5,000명으로 줄어도 요청은 초당
   약 2,000건으로 남고, 30분이 지나도 성공률은 20%에 머뭅니다. 스스로 회복하려면 붕괴선의 약 61%
   아래로 줄어야 합니다.
4. **관람객 과부하가 운영자 입력을 함께 막습니다.** 운영자와 관리자 요청(최대 7.7 RPS)은 같은 Supabase 를
   씁니다. 100,000명이 몰리면 부스 운영자의 저장 성공률은 약 1%로 떨어집니다.
5. **목표 구조(B)**는 관람객 polling 을 Vercel CDN 이 받고(짧은 s-maxage + stale-while-revalidate +
   stale-if-error), Supabase 에는 엣지 리전당 만료마다 한 번만 갑니다. 이렇게 하면 관람객 origin 부하가
   **약 0.4 RPS(최선)에서 157 RPS(최악, 100,000명)** 가 되어 Supabase 한도 아래에 머뭅니다.
   이 구조는 Phase 2 에서 만들었습니다(위).

## Phase 1 관람객 화면이 보내던 요청 (코드 근거 · 줄 번호는 41ef96b 기준)

| 무엇 | 값 | 어디 |
|---|---|---|
| 데이터는 Supabase REST 직접, 캐시 금지 | `cache: 'no-store'` | [booth-core.js:469](../../assets/booth-core.js:469) |
| 되풀이 | 20초 ±20%, 화면이 가려지면 건너뜀 | [booth-core.js:874](../../assets/booth-core.js:874), [visitor.html:168](../../visitor.html:168) |
| 열 때 · 5분마다 전체 받기 | `load()` = settings · zones · booths · booth_live **GET 4개**, `Promise.all` | [booth-core.js:846](../../assets/booth-core.js:846), [visitor.html:1217](../../visitor.html:1217) |
| 전체 받기 시각은 **성공했을 때만** 갱신 | 5분 넘게 실패하면 이후 재시도가 모두 GET 4개 | [visitor.html:1225](../../visitor.html:1225) |
| 실패 뒤 재시도 | **고정 10초**, 지수 백오프 · 흩뜨림 없음. poll 도 따로 계속 돎 | [visitor.html:170](../../visitor.html:170), [visitor.html:1247](../../visitor.html:1247) |
| 시간 초과 | 8초 | [booth-core.js:171](../../assets/booth-core.js:171) |
| last-good snapshot | localStorage 에 마지막 성공 결과. 열 때 먼저 그림 | [booth-core.js:812](../../assets/booth-core.js:812), [visitor.html:1497](../../visitor.html:1497) |

정적 파일(HTML · JS · CSS)은 Vercel CDN 에서 나가므로 문제가 아닙니다. 문제는 데이터 요청입니다.

## 가정

| 항목 | 값 | 바꾸는 법 / 근거 |
|---|---|---|
| Supabase 처리 한도 (오류 없이) | **400 RPS** | `--capacity=` — **측정해서 바꿀 값**. 가장 큰 불확실성 |
| 페이지를 새로 여는 간격 (관람객 1명) | 600초 | `--open-every=` (새 관람객 교대 포함) |
| 켜진 화면 비율 | 100% (가장 나쁜 경우) | 가려진 탭은 polling 하지 않습니다. 실제로는 더 낮습니다 |
| 부스 수 | 80 | `--booths=` — 응답 크기를 gzip 으로 직접 잼 |
| 과부하 실패 중 timeout : 5xx | 50 : 50 | 합계가 중요하고 비율은 가정 |
| 429 | 0 | Supabase REST 기본 한도 없음, 화면도 429 를 따로 다루지 않음 |
| 지연 (낮은 부하) | Supabase p50 90ms, Vercel 엣지 p50 25ms | 로그정규 + 대기열(ρ/(1−ρ)) |
| 운영자 저장 | 부스마다 2분에 한 번 | 붐빌 때 기준 |
| B: s-maxage live / master | 5초 / 60초 | `CDN` 상수 |
| B: stale-while-revalidate / stale-if-error | 25초 / 86,400초 | 행사 하루 동안 마지막 정상본 유지 |
| B: 엣지 리전 | 2곳 (icn1 · hnd1 가정) | |

## 단계별 요약 (Phase 1 감사 때 계산 · Supabase 한도 400 RPS)

B 열은 감사 때의 제안 값(5초 · 60초 두 경로)입니다. Phase 2 에서 실제로 만든 값으로 다시 계산한 표는 [RESULTS.md](RESULTS.md) 의 B 절입니다.

전체 열(browser/CDN RPS, p50/p95/p99, 5xx, timeout, 증폭, egress)은 [RESULTS.md](RESULTS.md) 에 있습니다.

| 동시 관람객 | A: Supabase RPS | A: 오류(5xx+timeout) | A: p99 | A: 운영자 저장 | B: browser→CDN RPS | B: Supabase RPS 최선/최악 | B: hit 최선/최악 |
|---|---|---|---|---|---|---|---|
| 100 | 14 | 0% | 459ms | 100% | 6.5 | 8.1 / 8.3 | 92% / 90% |
| 1,000 | 71 | 0% | 508ms | 100% | 65 | 8.1 / 9.7 | 99.2% / 96.5% |
| 3,000 | 197 | 0% | 721ms | 100% | 195 | 8.1 / 13 | 99.8% / 97.0% |
| **5,000** | **323** | 0% | **2.5s** | 100% | 325 | 8.1 / 16 | 99.9% / 97.1% |
| 10,000 | 4,174 | **90%** | timeout | 9.6% | 650 | 8.1 / 24 | 99.9% / 97.2% |
| 30,000 | 12,662 | 97% | timeout | 3.2% | 1,950 | 8.1 / 55 | 99.97% / 97.2% |
| 50,000 | 21,145 | 98% | timeout | 1.9% | 3,250 | 8.1 / 86 | 99.98% / 97.2% |
| **100,000** | **42,336** | **99%** | timeout | **0.95%** | 6,500 | 8.1 / 164 | 99.99% / 97.2% |

- B 의 Supabase RPS 에는 운영자 · 관리자 7.7 RPS 가 들어 있습니다(캐시할 수 없는 요청).
- A 의 10,000명 줄: 정상이라면 약 630 RPS 지만 한도를 넘는 순간 재시도로 4,174 RPS(8.3배)까지 불어납니다.
- 한도를 900 RPS 로 바꾸면(`--capacity=900`) A 는 10,000명까지 버티고 30,000명에서 무너집니다.
  어느 쪽이든 100,000명은 버티지 못합니다.

### A 구조의 붕괴선과 회복선

| Supabase 한도 | 무너지기 시작 | 100,000명 뒤 스스로 회복하려면 |
|---|---|---|
| 200 RPS | 약 2,700명 | 약 1,700명 아래 |
| 400 RPS | 약 5,600명 | 약 3,500명 아래 |
| 800 RPS | 약 11,400명 | 약 7,000명 아래 |
| 1,600 RPS | 약 23,100명 | 약 14,100명 아래 |

## 100,000명 스트레스 평가

| 보는 것 | A 지금 | B 목표 |
|---|---|---|
| 시스템 붕괴 | **무너짐.** 요청 성공 약 1%, Supabase 요청이 정상의 8.5배 | 무너지지 않음(가정). Supabase 요청은 관람객 수와 거의 무관 |
| CDN 의 origin 보호 | **없음** (hit 0%) | hit 97.2~99.99% |
| 오류 시 backoff | **없음.** 10초 고정 재시도에 poll 이 겹치고, 5분 뒤에는 시도마다 GET 4개 | 고쳐야 함: 지수 백오프 20→40→80→120초, 전체 흩뜨림, 한 번에 GET 1개 |
| last-good snapshot | **있음.** localStorage 의 마지막 결과를 먼저 그리고, '연결 불안정' 으로 표시 | 같은 것을 쓰고, 엣지도 stale-if-error 로 마지막 정상본을 줌 |
| 부하 감소 후 자동 회복 | **안 됨.** 5,000명으로 줄어도 30분 동안 성공률 20% (타임라인은 RESULTS.md) | 됨. 쌓인 재시도가 origin 에 닿지 않으므로 다음 갱신(≤5초)에 회복 |

A 에서 한 번 무너진 뒤 회복하는 현실적인 방법은 관람객이 페이지를 닫는 것뿐입니다
(다시 열어도 GET 4개로 시작합니다).

## B 구조 설계 (Phase 1 감사 때 제안 — Phase 2 에서 구현, 실제 값은 맨 위 Phase 2 표)

1. **관람객 데이터를 같은 출처의 캐시 경로로 옮깁니다.** `live/vercel.json` 에 외부 rewrite 를 둡니다. 예:
   `/data/live` → Supabase `booth_live`(또는 `generated_at` 을 함께 주는 읽기 전용 RPC), `/data/master` →
   settings · zones · booths. 응답 머리는
   `x-vercel-enable-rewrite-caching: 1` 과
   `CDN-Cache-Control: max-age=5, stale-while-revalidate=25, stale-if-error=86400` 입니다(master 는 60초).
   Vercel 문서상 외부 rewrite 캐시는 이 두 머리로 켭니다.
   브라우저 쪽 `Cache-Control` 은 지금처럼 짧게 둡니다.
2. **관람객 화면 요청을 GET 4개에서 1개로 줄입니다.** 20초마다 `/data/live` 하나를 받고, `/data/master` 는
   열 때와 5분마다 받습니다. 하나가 실패해도 다른 하나는 버리지 않습니다(`Promise.all` 묶음을 풂).
3. **실패 시 지수 백오프를 넣습니다.** 20→40→80→120초에 전체 흩뜨림을 둡니다. poll 과 retry 가 겹치지 않게
   하나의 타이머로 합칩니다. `S.lastFull` 이 실패 중에 GET 4개를 부르는 문제도 2번에서 함께 사라집니다.
4. **데이터 나이를 서버 시각으로 표시합니다.** 엣지가 오래된 사본을 줄 수 있으므로, 스냅샷의
   `generated_at`(또는 `Age` 머리)으로 '몇 분 전 기준' 을 계산합니다. 지금의 `S.lastOk` 는
   '받은 시각' 이라 엣지가 오래된 사본을 주면 실제보다 새것처럼 보입니다.
5. **운영자 · 관리자는 지금처럼 Supabase 에 직접 갑니다.** 토큰 · 세션이 붙은 POST 라 캐시하면 안 됩니다.
   B 에서는 관람객이 Supabase 를 쓰지 않으므로 운영자 입력이 관람객 수의 영향을 받지 않습니다.
6. **비상 스위치를 둡니다.** `pollingIntervalMs` 를 올리는 것은 배포가 필요합니다. `/data/live` 응답에
   `poll_ms` 를 넣으면 서버에서 간격을 늘릴 수 있습니다(15초 아래로는 내리지 않음).

## 확인할 것 (이 계산이 기대는 사실)

1. **Supabase 처리 한도.** 같은 compute 크기의 **복제 프로젝트(또는 branch)** 에서 단계적으로 부하를 올려
   p99 < 1초를 지키는 최대 RPS 를 잽니다. 그 값을 `--capacity=` 에 넣고 다시 돌립니다.
   Production 의 요금제와 compute 크기는 이 문서를 쓸 때(2026-10-04) 확인하지 못했습니다.
2. **Supabase egress.** A 구조는 5,000명에서 시간당 약 1.2GB, 100,000명에서 약 156GB 입니다(gzip 기준).
   요금제의 포함 egress 와 비교해야 합니다.
3. **Vercel 요금제.** `incheon-live` 는 `jin-jin2` 팀 범위에 있고, 이 문서를 쓸 때 그 팀의 요금제는 확인하지
   못했습니다. B 에서 100,000명이면 엣지 요청이 초당 6,500건, 전송량이 시간당 약 41GB 입니다. 포함량을 넘었을 때
   **프로젝트가 일시 정지되는 요금제인지** 확인해야 합니다. 정지되면 관람객 화면과 운영자 화면이 함께 내려갑니다.
4. **Vercel 이 외부 rewrite 에서 SWR · stale-if-error 와 묶음 요청(collapsing)을 실제로 지키는지.** 이것이
   '최선' 과 '최악' 을 가릅니다. 스테이징에서 `x-vercel-cache`(HIT / STALE / MISS) 를 세고, Supabase 쪽
   요청 기록을 함께 봅니다.
5. **Supabase 요청에 apikey 를 붙이는 방법.** rewrite 대상 주소에 `?apikey=` 질의 문자열을 붙여도 되는지,
   아니면 머리를 붙이는 작은 Vercel Function 이 필요한지 확인합니다. anon 키는 이미 공개되어 있으므로
   URL 에 들어가도 새로 노출되는 것은 없습니다.
6. **행사장 공유 IP.** 많은 관람객이 한 와이파이 NAT 주소를 쓰면 Vercel DDoS 완화나 Supabase 앞단이 그 주소를
   막을 수 있습니다(429/403). 관람객 경로에는 IP 별 요청 한도 규칙을 두지 않습니다.

## Production 아닌 곳에서 재는 법

- **Production 에는 큰 부하를 걸지 않습니다.** Production 주소는 Supabase `ynixjjqozkbzxjmishbe` 와
  `incheon-live.vercel.app` 입니다.
- **Supabase 한도:** 복제 프로젝트에 `supabase/` 마이그레이션과 예시 부스 80곳을 넣습니다. k6 같은 도구로
  20 → 50 → 100 → 200 → 400 → 800 RPS 를 각 3분씩 올립니다. 각 단계에서 p50/p95/p99, 5xx, timeout 을 기록하고,
  오류가 1%를 넘거나 p99 가 1초를 넘는 단계에서 멈춥니다.
- **CDN 동작:** Vercel **preview** 배포(Production alias 가 아님)에 B 구조를 올려 낮은 RPS(≤ 50)로
  `x-vercel-cache` 비율, stale-if-error(복제 Supabase 를 일시 정지해서), 회복 시간을 확인합니다.
  엣지 자체의 대량 처리량은 Vercel 이 감당하는 영역이라 직접 재지 않습니다. 각 플랫폼의 부하 시험 정책은
  시험 전에 확인합니다.
- 잰 값으로 `model.mjs` 의 가정(`--capacity`, 지연, `CDN` 상수)을 바꿔 이 표를 다시 만듭니다.
