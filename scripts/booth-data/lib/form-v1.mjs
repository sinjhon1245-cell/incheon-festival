/* ===================================================================
   운영자료 수합 양식 v1.0 — 탭 · 머리(scripts/import/validate-collection.ps1 과 같음)
   ───────────────────────────────────────────────────────────────────
   검증기의 $SHEETS 를 바꾸면 여기도 같이 고칩니다. 머리가 다르면 검증기가
   HEADER_CHANGED 로 막습니다.
   =================================================================== */

export const SHEETS_V1 = {
  '구역': ['구역코드', '구역명', '설명', '순서'],
  '부스': ['부스번호', '구역코드', '부스명', '운영기관', '기관유형', '체험·전시 내용', '전기필요', '네트워크필요', '운영시간', '준비물', '부스담당자', '상태', '운영메모', '특이사항'],
  '일정': ['날짜', '시작', '종료', '일정명', '구분', '장소', '담당팀', '담당자', '상태', '핵심일정', '메모'],
  '운영인력': ['성명', '소속', '역할그룹', '담당업무', '운영인력여부', '연락처분류', '공개메모', '개인연락처', '비공개메모'],
  '업무': ['업무키', '업무분야', '업무명', '시작', '종료', '장소', '상태', '설명'],
  '업무배정': ['업무키', '성명', '소속', '이 업무에서의 역할'],
  '물품': ['물품명', '단위', '분류', '메모'],
  '배부대상': ['대상명', '구분', '배부담당', '인원', '상태', '메모'],
  '배부수량': ['대상명']
};
export const HEADER_ROW = 4;   // 1~3행은 제목 · 안내, 4행 머리, 5행부터 자료

// 운영메모(관리자 전용)에 남기는 문서 근거. '문서키 S01' 은 GO-LIVE 검사가 부스를 찾는 열쇠입니다.
export const boothMemo = b => [`문서키 ${b.key}`, b.category, b.policy, b.level && `학교급 ${b.level}`,
  b.doc_place && `문서상 장소 ${b.doc_place}`, `운영계획(안내용) ${b.source_page}쪽`].filter(Boolean).join(' · ');
export const docKeyOf = memo => (String(memo || '').match(/문서키\s+([A-Z]\d{2})/) || [])[1] || '';

// 부스 탭 한 줄(부스번호 · 구역코드 · 담당자 등은 비워 둠)
export const boothRowV1 = b => ['', '', b.name, b.org, b.org_type, b.program, '', '', '', '', '', '준비 전', boothMemo(b),
  b.school_count > 1 ? `공동 부스 — ${b.schools.join(', ')}` : ''];

export function workbookV1(guideLines, boothRows, zoneRows = []) {
  const data = { '부스': boothRows, '구역': zoneRows };
  return [
    { name: '작성안내', rows: guideLines.map(l => [l]) },
    ...Object.entries(SHEETS_V1).map(([name, header]) => ({
      name, rows: [[name], [], [], header, ...(data[name] || [])]
    }))
  ];
}
