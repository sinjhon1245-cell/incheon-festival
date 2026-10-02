/* ===================================================================
   부스 대기 현황 — 시연용 예시 부스 (실제 정보 아님)

   주소 끝에 ?demo 를 붙였을 때만 씁니다. 실제 모드에서는 이 파일이
   실려 있어도 읽지 않습니다 — 서버를 못 읽었다고 꾸며낸 대기 시간을
   관람객에게 보여 주면 안 되기 때문입니다.

   칸 설명
     id · code · zone_key · zone_label   부스와 구역 (코드는 영문·숫자만)
     name · org · program                화면에 보이는 이름과 설명
     congestion · wait_minutes           처음 펼칠 때의 상태. null 이면 '입력 전'
     age_min                             그 값을 몇 분 전에 넣은 것으로 칠지.
                                         펼친 시각이 아니라 '지금' 에서 셉니다 — 시연을
                                         오래 띄워 둬도 이 나이 그대로이고, 시연 화면에서
                                         그 부스를 눌러야 비로소 시간이 흐릅니다.

   상태는 서버 규칙과 같게 맞춰 두었습니다(10분 이하 여유, 25분 이하 보통,
   그 위 혼잡 · 중단과 마감은 0분). 화면 시험에 필요한 경우를 하나씩
   넣었습니다 — 바로(0분), 잠시 중단, 마감, 30분 넘게 그대로인 부스(45분),
   아직 아무것도 넣지 않은 부스.

   학교 이름 · 담당자 · 연락처 · 비밀번호는 넣지 않습니다.
   =================================================================== */
window.MOCK_BOOTHS = [
  /* ── A 수업체험관 ──────────────────────────────────────────── */
  {
    id: 'booth-edu01', code: 'A-01', zone_key: 'A', zone_label: '수업체험관',
    name: '생성형 AI 동화 작가와 함께 만드는 나만의 그림책',
    org: '국어 융합수업 체험팀',
    program: '프롬프트로 이야기를 짜고 생성형 AI로 삽화를 그려 작은 그림책으로 출력합니다.',
    congestion: '여유', wait_minutes: 0, age_min: 2
  },
  {
    id: 'booth-edu02', code: 'A-02', zone_key: 'A', zone_label: '수업체험관',
    name: '수학 규칙성 탐정단! 블록코딩 방탈출',
    org: '수학 융합수업 체험팀',
    program: '규칙성 문제를 블록코딩 퀴즈로 풀며 방을 하나씩 탈출합니다.',
    congestion: '보통', wait_minutes: 15, age_min: 5
  },
  {
    id: 'booth-edu03', code: 'A-03', zone_key: 'A', zone_label: '수업체험관',
    name: 'IoT 온습도 센서로 돌보는 우리 교실 반려식물',
    org: '과학 융합수업 체험팀',
    program: '토양 수분 센서와 보드를 연결해 화분에 물을 주는 자동 급수 장치를 만들어 봅니다.',
    congestion: '혼잡', wait_minutes: 35, age_min: 3
  },
  {
    id: 'booth-edu04', code: 'A-04', zone_key: 'A', zone_label: '수업체험관',
    name: '자율주행 코딩카로 떠나는 우리 지역 역사 탐방',
    org: '사회 융합수업 체험팀',
    program: '대형 지도 위를 컬러 센서 코딩카로 달리며 지역 역사 퀴즈를 풉니다.',
    congestion: '여유', wait_minutes: 5, age_min: 8
  },
  {
    // 45분 동안 그대로 — '30분 넘게 바뀌지 않음' 표시를 시험합니다.
    id: 'booth-edu05', code: 'A-05', zone_key: 'A', zone_label: '수업체험관',
    name: 'AI 작곡가와 함께하는 디지털 사운드 음악회',
    org: '음악 융합수업 체험팀',
    program: 'AI 멜로디 생성기로 학급 노래와 효과음을 만들어 들어 봅니다.',
    congestion: '보통', wait_minutes: 20, age_min: 45
  },

  /* ── B 우리반 오락실 ───────────────────────────────────────── */
  {
    id: 'booth-fun01', code: 'B-01', zone_key: 'B', zone_label: '우리반 오락실',
    name: 'AI 북큐레이터 배틀! 독서 퀴즈 쇼',
    org: '독서교육 체험팀',
    program: '학생이 만든 AI 챗봇과 독서 퀴즈를 겨루고 추천 도서 영수증을 받아 갑니다.',
    congestion: '혼잡', wait_minutes: 40, age_min: 1
  },
  {
    id: 'booth-fun02', code: 'B-02', zone_key: 'B', zone_label: '우리반 오락실',
    name: '스텝퍼로 달리는 버추얼 런 챌린지',
    org: '신체활동 게임 체험팀',
    program: '발판 센서를 밟으며 화면 속 산책로를 달리고 건강 점수를 모읍니다.',
    congestion: '여유', wait_minutes: 10, age_min: 12
  },
  {
    // 잠시 중단 — 재료 준비 · 회차 사이를 시험합니다.
    id: 'booth-fun03', code: 'B-03', zone_key: 'B', zone_label: '우리반 오락실',
    name: '음성인식 AI 마이크 배틀! 4줄 동시 챔피언',
    org: 'AI 문해력 창작팀',
    program: '마이크에 짧은 시를 읊으면 음성 AI가 받아 적고 운율 점수를 매깁니다.',
    congestion: '중단', wait_minutes: 0, age_min: 6
  },
  {
    id: 'booth-fun04', code: 'B-04', zone_key: 'B', zone_label: '우리반 오락실',
    name: 'AI 카메라 모션인식 과일 베기 대전',
    org: '비전 AI 체험팀',
    program: '웹캠이 손동작을 알아보고 날아오는 과일을 화면 속에서 벱니다.',
    congestion: '혼잡', wait_minutes: 30, age_min: 4
  },
  {
    id: 'booth-fun05', code: 'B-05', zone_key: 'B', zone_label: '우리반 오락실',
    name: '레트로 조이스틱 아케이드 코딩 명예의 전당',
    org: '게임 만들기 동아리',
    program: '학생들이 블록코딩으로 만든 픽셀 게임을 오락기로 해 봅니다.',
    congestion: '보통', wait_minutes: 25, age_min: 9
  },

  /* ── C 뉴스포츠 ────────────────────────────────────────────── */
  {
    id: 'booth-spo01', code: 'C-01', zone_key: 'C', zone_label: '뉴스포츠',
    name: '레이저 타깃 스마트 양궁 챌린지',
    org: '디지털 체육 융합팀',
    program: '안전한 레이저 활로 디지털 표적을 맞히면 불빛과 효과음이 터집니다.',
    congestion: '여유', wait_minutes: 0, age_min: 1
  },
  {
    // 오늘 마감 — 마감은 그날 안에는 오래돼도 흐려지지 않습니다.
    id: 'booth-spo02', code: 'C-02', zone_key: 'C', zone_label: '뉴스포츠',
    name: '바닥 프로젝션 디지털 컬링 대전',
    org: '스마트 체육 체험팀',
    program: '바닥에 비춘 표적 위로 전용 스톤을 굴려 점수를 겨룹니다.',
    congestion: '마감', wait_minutes: 0, age_min: 50
  },
  {
    // 아직 아무것도 넣지 않은 부스 — '정보 없음' 을 시험합니다.
    id: 'booth-spo03', code: 'C-03', zone_key: 'C', zone_label: '뉴스포츠',
    name: '태블릿으로 조종하는 4:4 로봇 축구',
    org: '로봇 스포츠 연구팀',
    program: '바퀴 로봇을 태블릿으로 움직여 패스하고 골을 넣습니다.',
    congestion: null, wait_minutes: null, age_min: null
  },
  {
    id: 'booth-spo04', code: 'C-04', zone_key: 'C', zone_label: '뉴스포츠',
    name: '라이트 터치 반응속도 배틀',
    org: '뉴스포츠 협력팀',
    program: '불이 켜지는 버튼을 재빨리 눌러 순발력을 재 봅니다.',
    congestion: '보통', wait_minutes: 15, age_min: 14
  }
];
