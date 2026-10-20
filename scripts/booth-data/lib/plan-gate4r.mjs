// Gate 4-R 배치안 — 리허설용 임시 배치(R1~R4 · 21곳씩 · 번호 01~21)
// 문서 번호 순(S01~S84)으로 21곳씩 끊어 R1 · R2 · R3 · R4 에 1번부터 넣습니다. 임의로 섞지 않습니다.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// 구역 이름 = 코드 + 이 말(예: 'R1 실제 위치 아닌 리허설용 임시구역'). 코드를 앞에 둬야 포털 구역 칩 네 개가 서로 구별됩니다.
// 관람객 탭은 코드 + 마지막 낱말('R1 임시구역')로, 제목은 이름 그대로 보입니다.
export const DEFAULT_LABEL = '실제 위치 아닌 리허설용 임시구역';
export const DEFAULT_SUB = '리허설용 임시 배치 — 실제 행사 위치가 아닙니다. 최종 배치도 확정 뒤 같은 부스 · 같은 QR 로 구역 · 번호만 바꿉니다.';
export const ZONE_ORDER_FROM = 11;   // A~J 가 1~10 을 씁니다

export const codeOf = (zone, no) => `${zone}-${String(no).padStart(Math.max(2, String(no).length), '0')}`;

export function rehearsalPlan(manifest, { label = DEFAULT_LABEL, sub = DEFAULT_SUB, per = 21, count = 4 } = {}) {
  const docs = manifest.slice().sort((a, b) => a.doc_key.localeCompare(b.doc_key));
  if (docs.length !== per * count) throw new Error(`부스 ${docs.length}곳 — ${per}×${count} 이 아닙니다`);
  const zones = Array.from({ length: count }, (_, i) => ({
    key: `R${i + 1}`, label: `R${i + 1} ${label}`, sub, order: ZONE_ORDER_FROM + i, from: 1, to: per
  }));
  const plan = docs.map((m, i) => {
    const zone = `R${Math.floor(i / per) + 1}`, no = (i % per) + 1;
    return { doc: m.doc_key, id: m.booth_id, org: m.org, name: m.name, zone, no, code: codeOf(zone, no) };
  });
  return { zones, plan };
}

export function planCsv(plan) {
  const esc = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  return ['문서번호,부스ID,학교명,부스명,구역,번호,표시코드', ...plan.map(p => [p.doc, p.id, p.org, p.name, p.zone, p.no, p.code].map(esc).join(','))].join('\n') + '\n';
}
export const sha256 = s => createHash('sha256').update(s, 'utf8').digest('hex');
// manifest 해시는 Gate 3 과 같은 방식(파일 머리의 BOM 을 뺀 내용)
export const manifestSha = path => sha256(readFileSync(path, 'utf8').replace(/^﻿/, ''));
