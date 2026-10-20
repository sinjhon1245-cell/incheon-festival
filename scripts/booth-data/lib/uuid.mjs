// 계획 UUID — 문서키(S01 · M01 · T01 · P01)에서 정해지는 v5 UUID.
// 다시 계산해도 같은 값이라, 등록 · 되돌리기 때 정확히 승인된 부스만 고를 수 있습니다.
// 이름공간을 바꾸면 모든 계획 UUID 가 바뀝니다. 등록한 뒤에는 절대 바꾸지 않습니다.
import { createHash } from 'node:crypto';

export const BOOTH_NS = '6f0b8c1e-2d4a-5b7c-9e1f-2a3b4c5d6e7f';
export const UUID_V5_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function uuidV5(name, ns = BOOTH_NS) {
  const h = createHash('sha1').update(Buffer.concat([Buffer.from(ns.replace(/-/g, ''), 'hex'), Buffer.from(name, 'utf8')])).digest();
  h[6] = (h[6] & 0x0f) | 0x50; h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}
export const plannedBoothId = docKey => uuidV5(`incheon-festival-2026/booth/${docKey}`);
