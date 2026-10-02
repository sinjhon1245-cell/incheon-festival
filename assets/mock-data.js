/* ===================================================================
   부스 대기 현황 — 협의용 · 시연용 예시 부스 (실제 정보 아님)

   주소 끝에 ?demo(?demo=1)를 붙였을 때만 씁니다. 실제 모드에서는 이
   파일이 실려 있어도 읽지 않습니다 — 서버를 못 읽었다고 꾸며낸 대기
   시간을 관람객에게 보여 주면 안 되기 때문입니다.
     관람객 화면    협의용 예시 화면. 실제 부스가 들어오면 어떤 모습이
                    되는지 행사 관계자와 함께 보며 협의할 때 씁니다.
     운영자 화면    시연(연수). 여기서 누른 값은 같은 브라우저의 관람객
                    예시 화면에 바로 보입니다.
   어느 쪽도 DB 에 쓰지 않습니다(assets/booth-core.js 의 시연 모드 참고).

   실제 학교 · 기관 · 구역으로 읽히지 않게 이름을 붙입니다.
     기관   '협의용 예시 학교' · '협의용 예시 기관' 만 씁니다.
     구역   '예시 구역 A · B · C'. 실제로 정해진 구역 이름(스쿨존 등)을
            가져다 쓰지 않습니다 — 확정된 배치처럼 보이면 안 됩니다.
   담당자 · 연락처 · 비밀번호는 넣지 않습니다.

   칸 설명
     id · code · zone_key · zone_label   부스와 구역 (코드는 영문·숫자만)
     name · org · program                화면에 보이는 이름과 설명
     congestion · wait_minutes           처음 펼칠 때의 상태. null 이면 '입력 전'
     age_min                             그 값을 몇 분 전에 넣은 것으로 칠지.
                                         펼친 시각이 아니라 '지금' 에서 셉니다 — 예시를
                                         오래 띄워 둬도 이 나이 그대로이고, 시연 화면에서
                                         그 부스를 눌러야 비로소 시간이 흐릅니다.

   상태는 서버 규칙과 같게 맞춰 두었습니다(10분 이하 여유, 25분 이하 보통,
   그 위 혼잡 · 중단과 마감은 0분). 협의 때 보여야 할 경우를 하나씩 넣었습니다.
     여유 0분(바로) · 여유 5분 · 여유 10분
     보통 15분 · 보통 20분 · 보통 25분
     혼잡 30분 · 혼잡 45분
     잠시 중단 · 오늘 마감
     현황 미등록(아직 아무것도 넣지 않음)
     30분 넘게 그대로라 '확인 필요' 로 흐려지는 부스(50분 전 입력)

   이 목록을 고치면 다음에 열 때 예시가 새 목록으로 다시 펼쳐집니다
   (booth-core.js 가 목록 내용 전체를 견줍니다).
   =================================================================== */
window.MOCK_BOOTHS = [
  /* ── 예시 구역 A ──────────────────────────────────────────── */
  {
    id: 'ex-a01', code: 'A-01', zone_key: 'A', zone_label: '예시 구역 A',
    name: 'AI 그림책 만들기',
    org: '협의용 예시 학교',
    program: '생성형 AI로 이야기와 삽화를 만들어 작은 그림책으로 엮어 봅니다.',
    congestion: '여유', wait_minutes: 0, age_min: 2
  },
  {
    id: 'ex-a02', code: 'A-02', zone_key: 'A', zone_label: '예시 구역 A',
    name: 'AI 캐릭터 만들기',
    org: '협의용 예시 학교',
    program: '그림 AI로 나만의 캐릭터를 그리고 이름과 성격을 붙여 봅니다.',
    congestion: '여유', wait_minutes: 5, age_min: 4
  },
  {
    id: 'ex-a03', code: 'A-03', zone_key: 'A', zone_label: '예시 구역 A',
    name: '로봇 미션 체험',
    org: '협의용 예시 기관',
    program: '코딩 로봇으로 정해진 길을 따라가는 미션을 풉니다.',
    congestion: '보통', wait_minutes: 15, age_min: 3
  },
  {
    id: 'ex-a04', code: 'A-04', zone_key: 'A', zone_label: '예시 구역 A',
    name: '블록코딩 방탈출',
    org: '협의용 예시 학교',
    program: '블록코딩 퀴즈를 풀며 방을 하나씩 탈출합니다.',
    congestion: '혼잡', wait_minutes: 30, age_min: 1
  },

  /* ── 예시 구역 B ──────────────────────────────────────────── */
  {
    id: 'ex-b01', code: 'B-01', zone_key: 'B', zone_label: '예시 구역 B',
    name: 'AI 작곡 체험',
    org: '협의용 예시 학교',
    program: 'AI 멜로디 생성기로 짧은 노래를 만들어 들어 봅니다.',
    congestion: '보통', wait_minutes: 20, age_min: 6
  },
  {
    id: 'ex-b02', code: 'B-02', zone_key: 'B', zone_label: '예시 구역 B',
    name: '모션인식 미니게임',
    org: '협의용 예시 기관',
    program: '카메라가 몸동작을 알아보는 미니게임을 해 봅니다.',
    congestion: '혼잡', wait_minutes: 45, age_min: 2
  },
  {
    // 잠시 중단 — 재료 준비 · 회차 사이
    id: 'ex-b03', code: 'B-03', zone_key: 'B', zone_label: '예시 구역 B',
    name: '음성인식 AI 퀴즈',
    org: '협의용 예시 학교',
    program: '말로 답하면 음성 AI가 알아듣고 채점합니다.',
    congestion: '중단', wait_minutes: 0, age_min: 5
  },
  {
    // 50분 동안 그대로 — 숫자가 흐려지고 '확인 필요' 로 바뀌는 모습
    id: 'ex-b04', code: 'B-04', zone_key: 'B', zone_label: '예시 구역 B',
    name: '센서로 키우는 반려식물',
    org: '협의용 예시 학교',
    program: '토양 센서로 화분 상태를 읽고 물 주는 때를 정해 봅니다.',
    congestion: '보통', wait_minutes: 15, age_min: 50
  },

  /* ── 예시 구역 C ──────────────────────────────────────────── */
  {
    // 오늘 마감 — 마감은 그날 안에는 오래돼도 흐려지지 않습니다.
    id: 'ex-c01', code: 'C-01', zone_key: 'C', zone_label: '예시 구역 C',
    name: '디지털 컬링',
    org: '협의용 예시 기관',
    program: '바닥에 비춘 표적 위로 스톤을 굴려 점수를 겨룹니다.',
    congestion: '마감', wait_minutes: 0, age_min: 40
  },
  {
    // 아직 아무것도 넣지 않은 부스 — '정보 없음'
    id: 'ex-c02', code: 'C-02', zone_key: 'C', zone_label: '예시 구역 C',
    name: '태블릿 로봇 축구',
    org: '협의용 예시 학교',
    program: '바퀴 로봇을 태블릿으로 움직여 골을 넣습니다.',
    congestion: null, wait_minutes: null, age_min: null
  },
  {
    id: 'ex-c03', code: 'C-03', zone_key: 'C', zone_label: '예시 구역 C',
    name: 'AI 사진 엽서 만들기',
    org: '협의용 예시 기관',
    program: '찍은 사진을 AI로 꾸며 엽서로 뽑아 갑니다.',
    congestion: '보통', wait_minutes: 25, age_min: 8
  },
  {
    id: 'ex-c04', code: 'C-04', zone_key: 'C', zone_label: '예시 구역 C',
    name: '데이터로 보는 우리 동네',
    org: '협의용 예시 학교',
    program: '공공데이터 지도를 보며 동네 퀴즈를 풉니다.',
    congestion: '여유', wait_minutes: 10, age_min: 12
  }
];
