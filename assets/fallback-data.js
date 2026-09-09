/* ===================================================================
   Supabase 를 아직 연결하지 않았을 때(또는 연결이 실패했을 때) 쓰는
   기본 내용입니다. 연결이 되면 이 파일은 쓰이지 않습니다.

   supabase/schema.sql 의 초기 데이터와 같은 내용입니다.
   =================================================================== */
window.FESTIVAL_FALLBACK = {
  settings: {
    event_title: '제1회 인천 AI디지털 교육 페스티벌',
    event_start: '2026-10-17T10:00:00+09:00',
    date_label: '2026. 10. 17. 토',
    time_label: '10:00 – 17:00',
    venue: '인천교육과학연구원',
    venue_address: '인천광역시 남동구 예술로 000',
    contact_phone: '032-000-0000',
    contact_email: 'aifest@ice.go.kr',
    footer_note: '일정·부스·주차 정보는 검토용 예시 데이터입니다.',
    venue_detail: '인천교육과학연구원 대강당 · 야외광장',
    host_line: '주최 인천광역시교육청 · 주관 인천교육과학연구원',
    booth_dept: '미래교육과',
    booth_apply_period: '2026. 9. 7.(월) ~ 9. 25.(금)',
    show_ops_track: false,
    show_parking_table: false,
    show_countdown: true
  },

  programs: [
    { no: '01', title: 'AI 체험 부스',       description: '직접 만들고 실험하는 40개 부스. 네 구역으로 나뉘어 운영됩니다.',  meta: '야외광장 일대 · 11:00–16:00', tint: '#D7E6FF', deep: '#17458F' },
    { no: '02', title: '기조 강연·특강',     description: '교실의 AI 전환을 먼저 실천한 교사와 연구자의 세 편의 강연.',      meta: '대강당 · 세미나실 A·B',       tint: '#D9EFF7', deep: '#0F5468' },
    { no: '03', title: '학생 작품 전시',     description: '학생들이 만든 AI·디지털 프로젝트 100선. 폐막식에서 시상합니다.',  meta: '1층 전시홀 · 11:00–16:00',    tint: '#DCEFE6', deep: '#14573F' },
    { no: '04', title: '에듀테크 기업 전시', description: '수업에 바로 쓰는 도구를 만드는 기업의 기업관 시연.',              meta: '기업관(D존) · 14:00–15:00',   tint: '#E3E1F9', deep: '#392C86' },
    { no: '05', title: '무대 공연·이벤트',   description: '로봇 퍼포먼스와 학생 밴드·댄스 공연이 야외무대에서 이어집니다.',  meta: '야외무대 · 13:00–16:40',      tint: '#DAE8F5', deep: '#1F4468' }
  ],

  schedule_items: [
    { half: 'am', time_label: '09:00 – 10:00', duration: '1시간', title: '운영진 집결 및 부스 세팅',             place: '야외광장 · 운영본부',    category: '운영' },
    { half: 'am', time_label: '10:00 – 10:20', duration: '20분',  title: '개막식 및 환영 인사',                  place: '야외무대',               category: '기조·강연' },
    { half: 'am', time_label: '10:20 – 11:00', duration: '40분',  title: '기조강연 「교실의 AI 전환, 무엇부터」', place: '대강당',                 category: '기조·강연' },
    { half: 'am', time_label: '11:00 – 16:00', duration: '5시간', title: 'AI 체험 부스 운영 (40개 부스)',        place: '야외광장 일대',          category: '체험·전시' },
    { half: 'am', time_label: '11:00 – 16:00', duration: '5시간', title: '학생 작품 전시 100선',                 place: '1층 전시홀',             category: '체험·전시' },
    { half: 'am', time_label: '11:30 – 12:10', duration: '40분',  title: '특강 「데이터로 읽는 학습」',           place: '세미나실 A',             category: '기조·강연' },
    { half: 'pm', time_label: '12:00 – 13:00', duration: '1시간', title: '점심 및 부스 교대',                    place: '학생식당 · 부스별 자율', category: '운영' },
    { half: 'pm', time_label: '13:00 – 13:40', duration: '40분',  title: '로봇 퍼포먼스',                        place: '야외무대',               category: '무대 공연' },
    { half: 'pm', time_label: '13:40 – 14:20', duration: '40분',  title: '학생 공연 (밴드 · 댄스)',              place: '야외무대',               category: '무대 공연' },
    { half: 'pm', time_label: '14:00 – 15:00', duration: '1시간', title: '에듀테크 기업관 시연 세션',            place: '기업관(D존)',            category: '체험·전시' },
    { half: 'pm', time_label: '15:00 – 15:40', duration: '40분',  title: '특강 「AI와 함께 쓰는 글쓰기 수업」',   place: '세미나실 B',             category: '기조·강연' },
    { half: 'pm', time_label: '16:00 – 16:40', duration: '40분',  title: '폐막식 및 우수 작품 시상',             place: '야외무대',               category: '무대 공연' },
    { half: 'pm', time_label: '16:40 – 17:20', duration: '40분',  title: '정리 및 철수',                         place: '전체 구역',              category: '운영' }
  ],

  zones: [
    { key: 'A', label: '함께배움존',    sub: '협력 놀이',     range_from: 1,  range_to: 10, tint: '#D7E6FF', solid: '#2563C9', deep: '#17458F' },
    { key: 'B', label: '만들기존',      sub: '피지컬 컴퓨팅', range_from: 11, range_to: 22, tint: '#D9EFF7', solid: '#0E7490', deep: '#0B4C5E' },
    { key: 'C', label: '데이터·로봇존', sub: '전원 필요',     range_from: 23, range_to: 32, tint: '#DCEFE6', solid: '#12805C', deep: '#0E5941' },
    { key: 'D', label: '전시·기업관',   sub: '실내 전시홀',   range_from: 33, range_to: 40, tint: '#E3E1F9', solid: '#4B3FBF', deep: '#332A87' }
  ],

  booths: [
    { no: 1,  zone_key: 'A', name: '프롬프트로 그리는 우리 반 이야기', org: '인천남동초등학교' },
    { no: 3,  zone_key: 'A', name: 'AI 튜터와 함께 푸는 수학 한 문제', org: '인천교육청 미래교육과' },
    { no: 5,  zone_key: 'A', name: '생성형 AI 저작권 골든벨',          org: '인천논현중학교' },
    { no: 8,  zone_key: 'A', name: '목소리로 만드는 우리 반 화음',     org: '인천예술고등학교' },
    { no: 11, zone_key: 'B', name: '마이크로비트 교실 알림봇 만들기',  org: '인천서창초등학교' },
    { no: 14, zone_key: 'B', name: '3D 펜으로 짓는 미래 학교',         org: '인천만수중학교' },
    { no: 17, zone_key: 'B', name: '드론 코딩 미션 존',                org: '인천부평공업고등학교' },
    { no: 21, zone_key: 'B', name: '재활용 재료로 만드는 로봇 팔',     org: '인천교육과학연구원' },
    { no: 23, zone_key: 'C', name: '우리 학교 급식 데이터 분석소',     org: '인천송도고등학교' },
    { no: 26, zone_key: 'C', name: '자율주행 트랙 도전',               org: '인천청라중학교' },
    { no: 29, zone_key: 'C', name: '센서로 읽는 교실 공기',            org: '인천대 SW중심대학사업단' },
    { no: 31, zone_key: 'C', name: '개인정보 지킴이 미션',             org: '인천교육청 정보화지원과' },
    { no: 33, zone_key: 'D', name: 'AI디지털 프로젝트 100선 전시',     org: '학생 작품 전시관' },
    { no: 35, zone_key: 'D', name: '수업에 바로 쓰는 도구 시연',       org: '에듀테크 기업관' },
    { no: 37, zone_key: 'D', name: 'AI 시대 진로 상담 부스',           org: '인천진로교육원' },
    { no: 39, zone_key: 'D', name: '학부모 AI 리터러시 상담소',        org: '인천교육청 학교교육과' }
  ],

  faqs: [
    { question: '참가비가 있나요?',                  answer: '없습니다. 전 프로그램과 체험 부스가 모두 무료이고, 현장 안내 데스크에서 프로그램 책자를 받으실 수 있습니다.' },
    { question: '신청을 하고 가야 하나요?',          answer: '아니요. 사전신청 절차가 없어 당일 그냥 오시면 됩니다. 다만 정원을 두고 회차별로 운영하는 일부 체험 부스는 현장에서 선착순으로 참여하실 수 있습니다.' },
    { question: '몇 살부터 참여할 수 있나요?',       answer: '초등학교 1학년부터 고등학교 3학년까지 참여할 수 있습니다. 미취학 아동은 보호자와 함께 입장해 주세요.' },
    { question: '보호자도 함께 볼 수 있나요?',       answer: '네. 본관 1층에 보호자 쉼터를 운영하고, D존에서 학부모 대상 AI 리터러시 상담소를 함께 운영합니다.' },
    { question: '학교나 기관도 부스를 운영할 수 있나요?', answer: '9월 7일부터 25일까지 운영계획서를 공문으로 접수합니다. 전기 사용과 부스 규격을 함께 적어 주시면 배치 검토가 빠릅니다.' },
    { question: '비가 오면 어떻게 되나요?',          answer: '실내 프로그램으로 대체 운영합니다. 당일 오전 8시에 누리집 공지로 변경된 배치도를 안내합니다.' }
  ]
};
