// CSV 읽기 · 쓰기(엑셀 호환: UTF-8 BOM · CRLF · 큰따옴표)
import { readFileSync, writeFileSync } from 'node:fs';

export function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  text = String(text).replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter(r => r.length > 1 || r[0] !== '');
  return body.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}
export const readCsv = file => parseCsv(readFileSync(file, 'utf8'));

const cell = v => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const toCsv = (header, rows) => [header, ...rows].map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
export const writeCsv = (file, header, rows) => writeFileSync(file, '﻿' + toCsv(header, rows));
