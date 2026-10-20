/* ===================================================================
   PDF 글자 좌표 읽기(검증용 · 의존성 없음)
   ───────────────────────────────────────────────────────────────────
   내용 스트림의 글자를 ToUnicode 로 풀어 쪽 · 좌표 · 폭과 함께 돌려줍니다.
   pdftotext 는 줄 끝 공백을 지우므로, 줄바꿈 자리에 원문 공백이 있었는지는
   이 좌표로만 가릴 수 있습니다(extract-plan.mjs 의 줄바꿈 판정).
   FlateDecode · 객체 스트림 · Type0(Identity) · 단순 글꼴 · Form XObject 만 다룹니다.
   =================================================================== */

import { inflateSync } from 'node:zlib';

export function pdfGlyphs(buf) {
  const lat = buf.toString('latin1');
  const objs = new Map();   // num -> { dict: string, stream: Buffer|null }

  function parseTop() {
    const re = /(\d+)\s+(\d+)\s+obj\b/g; let m;
    while ((m = re.exec(lat))) {
      const start = m.index + m[0].length;
      const end = lat.indexOf('endobj', start);
      const body = lat.slice(start, end);
      const si = body.indexOf('stream');
      let dict = body, stream = null;
      if (si >= 0 && /^\s*<</.test(body)) {
        dict = body.slice(0, si);
        let ds = start + si + 6;
        if (lat[ds] === '\r') ds++; if (lat[ds] === '\n') ds++;
        const lenM = dict.match(/\/Length\s+(\d+)(\s+\d+\s+R)?/);
        let len = lenM && !lenM[2] ? +lenM[1] : lat.indexOf('endstream', ds) - ds;
        stream = buf.subarray(ds, ds + len);
      }
      objs.set(+m[1], { dict, stream });
    }
  }
  function decode(o) {
    if (!o.stream) return null;
    if (/\/FlateDecode/.test(o.dict)) { try { return inflateSync(o.stream); } catch { return inflateSync(o.stream, { finishFlush: 2 }); } }
    return o.stream;
  }
  parseTop();
  for (const [num, o] of [...objs]) {
    if (!/\/Type\s*\/ObjStm/.test(o.dict)) continue;
    const data = decode(o).toString('latin1');
    const N = +o.dict.match(/\/N\s+(\d+)/)[1], First = +o.dict.match(/\/First\s+(\d+)/)[1];
    const head = data.slice(0, First).trim().split(/\s+/).map(Number);
    for (let i = 0; i < N; i++) {
      const on = head[2 * i], off = head[2 * i + 1];
      const next = i + 1 < N ? head[2 * i + 3] : data.length - First;
      objs.set(on, { dict: data.slice(First + off, First + next), stream: null });
    }
  }
  const ref = s => { const m = String(s).match(/^\s*(\d+)\s+\d+\s+R/); return m ? +m[1] : null; };
  const get = n => objs.get(n);
  function dictVal(dict, key) {
    // 값 하나(참조 · 이름 · 숫자 · 배열 · 사전)를 문자열로
    const i = dict.indexOf('/' + key); if (i < 0) return null;
    let j = i + key.length + 1; while (/\s/.test(dict[j])) j++;
    const r = dict.slice(j).match(/^(\d+\s+\d+\s+R)/); if (r) return r[1];
    if (dict[j] === '[') { let d = 0, k = j; for (; k < dict.length; k++) { if (dict[k] === '[') d++; else if (dict[k] === ']' && --d === 0) break; } return dict.slice(j, k + 1); }
    if (dict.startsWith('<<', j)) { let d = 0, k = j; for (; k < dict.length; k++) { if (dict.startsWith('<<', k)) { d++; k++; } else if (dict.startsWith('>>', k)) { d--; k++; if (d === 0) break; } } return dict.slice(j, k + 1); }
    return dict.slice(j).match(/^(\/?[^\s/<>\[\]()]+)/)[1];
  }
  const deref = v => { const r = ref(v); return r != null ? get(r).dict : v; };

  // 글꼴: ToUnicode · 폭
  const fontCache = new Map();
  function font(num) {
    if (fontCache.has(num)) return fontCache.get(num);
    const d = get(num).dict;
    const type0 = /\/Subtype\s*\/Type0/.test(d);
    const map = new Map();
    const tu = ref(dictVal(d, 'ToUnicode'));
    if (tu != null) {
      const cm = decode(get(tu)).toString('latin1');
      const hex = h => Buffer.from(h, 'hex');
      const u16 = h => { const b = hex(h); let s = ''; for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode(b.readUInt16BE(i)); return s; };
      for (const blk of cm.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) for (const m of blk[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) map.set(parseInt(m[1], 16), u16(m[2]));
      for (const blk of cm.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) for (const m of blk[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]+>|\[[^\]]*\])/g)) {
        const a = parseInt(m[1], 16), b = parseInt(m[2], 16);
        if (m[3][0] === '<') { const base = u16(m[3].slice(1, -1)); for (let c = a; c <= b; c++) map.set(c, base.slice(0, -1) + String.fromCharCode(base.charCodeAt(base.length - 1) + (c - a))); }
        else { const arr = [...m[3].matchAll(/<([0-9a-fA-F]+)>/g)].map(x => u16(x[1])); for (let c = a; c <= b; c++) map.set(c, arr[c - a]); }
      }
    }
    const widths = new Map(); let dw = 1000;
    if (type0) {
      const df = deref(dictVal(d, 'DescendantFonts')); const dfn = ref(df.replace(/^\[|\]$/g, '').trim()); const dd = get(dfn).dict;
      const dwv = dictVal(dd, 'DW'); if (dwv) dw = +deref(dwv);
      const W = deref(dictVal(dd, 'W') || '[]');
      const toks = W.replace(/^\[|\]$/g, '').match(/\[[^\]]*\]|[-\d.]+/g) || [];
      for (let i = 0; i < toks.length;) {
        const c = +toks[i];
        if (toks[i + 1] && toks[i + 1][0] === '[') { toks[i + 1].slice(1, -1).trim().split(/\s+/).forEach((w, k) => widths.set(c + k, +w)); i += 2; }
        else { const c2 = +toks[i + 1], w = +toks[i + 2]; for (let k = c; k <= c2; k++) widths.set(k, w); i += 3; }
      }
    } else {
      const fc = +(dictVal(d, 'FirstChar') || 0); const W = deref(dictVal(d, 'Widths') || '[]');
      (W.replace(/^\[|\]$/g, '').trim().split(/\s+/)).forEach((w, k) => widths.set(fc + k, +w)); dw = 0;
    }
    const f = { type0, map, widths, dw };
    fontCache.set(num, f); return f;
  }
  function resFonts(resDict) {
    const r = deref(resDict || '<<>>'); const fd = deref(dictVal(r, 'Font') || '<<>>');
    const out = {}; for (const m of fd.matchAll(/\/([^\s/<>\[\]]+)\s+(\d+)\s+\d+\s+R/g)) out[m[1]] = +m[2]; return out;
  }
  function resXObj(resDict) {
    const r = deref(resDict || '<<>>'); const xd = deref(dictVal(r, 'XObject') || '<<>>');
    const out = {}; for (const m of xd.matchAll(/\/([^\s/<>\[\]]+)\s+(\d+)\s+\d+\s+R/g)) out[m[1]] = +m[2]; return out;
  }

  // 페이지 순서
  const catalog = [...objs.values()].find(o => /\/Type\s*\/Catalog/.test(o.dict));
  const pages = [];
  (function walk(n, inheritedRes) {
    const d = get(n).dict; const res = dictVal(d, 'Resources') || inheritedRes;
    if (/\/Type\s*\/Pages/.test(d)) { for (const m of deref(dictVal(d, 'Kids')).matchAll(/(\d+)\s+\d+\s+R/g)) walk(+m[1], res); }
    else pages.push({ n, d, res });
  })(ref(dictVal(catalog.dict, 'Pages')));

  // 내용 스트림 해석
  const mul = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
  const glyphs = [];
  function tokenize(s) {
    const t = []; let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '%') { while (i < s.length && s[i] !== '\n') i++; continue; }
      if (c === '(') { let d = 0, j = i, out = []; for (; j < s.length; j++) { const ch = s[j]; if (ch === '\\') { const nx = s[++j]; const esc = { n: 10, r: 13, t: 9, b: 8, f: 12 }[nx]; if (esc != null) out.push(esc); else if (/[0-7]/.test(nx)) { let o = nx; while (o.length < 3 && /[0-7]/.test(s[j + 1])) o += s[++j]; out.push(parseInt(o, 8)); } else if (nx === '\n' || nx === '\r') {} else out.push(nx.charCodeAt(0)); continue; } if (ch === '(') { if (d++ > 0) out.push(40); continue; } if (ch === ')') { if (--d === 0) break; out.push(41); continue; } out.push(ch.charCodeAt(0)); } t.push({ str: Buffer.from(out) }); i = j + 1; continue; }
      if (c === '<' && s[i + 1] !== '<') { const j = s.indexOf('>', i); t.push({ str: Buffer.from(s.slice(i + 1, j).replace(/\s/g, ''), 'hex') }); i = j + 1; continue; }
      if (c === '<' || c === '>') { t.push({ op: s.slice(i, i + 2) }); i += 2; continue; }
      if (c === '[' || c === ']') { t.push({ op: c }); i++; continue; }
      if (c === '/') { const m = s.slice(i).match(/^\/[^\s/<>\[\]()%{}]*/); t.push({ name: m[0].slice(1) }); i += m[0].length; continue; }
      const m = s.slice(i).match(/^[^\s/<>\[\]()%{}]+/); const w = m[0]; i += w.length;
      if (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(w)) t.push({ num: +w }); else t.push({ op: w });
    }
    return t;
  }
  function run(content, resDict, page, ctm0) {
    const fonts = resFonts(resDict), xobj = resXObj(resDict);
    const toks = tokenize(content.toString('latin1'));
    let st = [], ctm = ctm0.slice(), gsStack = [];
    let Tm = [1, 0, 0, 1, 0, 0], Tlm = Tm.slice(), f = null, fs = 0, Tc = 0, Tw = 0, Th = 1, TL = 0, Trise = 0;
    const show = arr => {
      for (const it of arr) {
        if (typeof it === 'number') { Tm = mul([1, 0, 0, 1, -it / 1000 * fs * Th, 0], Tm); continue; }
        const b = it; const two = f && f.type0;
        for (let k = 0; k < b.length; k += two ? 2 : 1) {
          const code = two ? b.readUInt16BE(k) : b[k];
          const ch = f ? (f.map.get(code) ?? '') : '';
          const w0 = f ? (f.widths.get(code) ?? f.dw) : 0;
          const M = mul(mul([fs * Th, 0, 0, fs, 0, Trise], Tm), ctm);
          const adv = (w0 / 1000 * fs + Tc + (ch === ' ' && !two ? Tw : 0)) * Th;
          glyphs.push({ p: page, x: +M[4].toFixed(2), y: +M[5].toFixed(2), w: +(adv * Math.hypot(ctm[0], ctm[1])).toFixed(2), s: +(fs * Math.hypot(ctm[0], ctm[1]) * Math.hypot(Tm[0], Tm[1])).toFixed(2), ch });
          Tm = mul([1, 0, 0, 1, adv, 0], Tm);
        }
      }
    };
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.op === undefined) { st.push(t); continue; }
      const n = k => st[st.length - k].num;
      switch (t.op) {
        case '[': { const arr = []; i++; while (toks[i].op !== ']') { arr.push(toks[i].str ?? toks[i].num); i++; } st.push({ arr }); continue; }
        case 'q': gsStack.push(ctm.slice()); break;
        case 'Q': ctm = gsStack.pop() || ctm; break;
        case 'cm': ctm = mul([n(6), n(5), n(4), n(3), n(2), n(1)], ctm); break;
        case 'BT': Tm = [1, 0, 0, 1, 0, 0]; Tlm = Tm.slice(); break;
        case 'Tf': f = fonts[st[st.length - 2].name] != null ? font(fonts[st[st.length - 2].name]) : null; fs = n(1); break;
        case 'Tc': Tc = n(1); break; case 'Tw': Tw = n(1); break; case 'Tz': Th = n(1) / 100; break; case 'TL': TL = n(1); break; case 'Ts': Trise = n(1); break;
        case 'Td': Tlm = mul([1, 0, 0, 1, n(2), n(1)], Tlm); Tm = Tlm.slice(); break;
        case 'TD': TL = -n(1); Tlm = mul([1, 0, 0, 1, n(2), n(1)], Tlm); Tm = Tlm.slice(); break;
        case 'Tm': Tlm = [n(6), n(5), n(4), n(3), n(2), n(1)]; Tm = Tlm.slice(); break;
        case 'T*': Tlm = mul([1, 0, 0, 1, 0, -TL], Tlm); Tm = Tlm.slice(); break;
        case 'Tj': show([st[st.length - 1].str]); break;
        case "'": Tlm = mul([1, 0, 0, 1, 0, -TL], Tlm); Tm = Tlm.slice(); show([st[st.length - 1].str]); break;
        case 'TJ': show(st[st.length - 1].arr); break;
        case 'Do': { const xn = xobj[st[st.length - 1].name]; if (xn != null) { const o = get(xn); if (/\/Subtype\s*\/Form/.test(o.dict)) { const mt = dictVal(o.dict, 'Matrix'); const M = mt ? mt.replace(/[\[\]]/g, '').trim().split(/\s+/).map(Number) : [1, 0, 0, 1, 0, 0]; run(decode(o), dictVal(o.dict, 'Resources') || resDict, page, mul(M, ctm)); } } break; }
      }
      st = [];
    }
  }
  pages.forEach((pg, idx) => {
    const refs = [...String(dictVal(pg.d, 'Contents')).matchAll(/(\d+)\s+\d+\s+R/g)].map(m => +m[1]);
    const data = Buffer.concat(refs.flatMap(r => { const o = get(r); if (o.stream) return [decode(o), Buffer.from('\n')]; return [...o.dict.matchAll(/(\d+)\s+\d+\s+R/g)].flatMap(m => [decode(get(+m[1])), Buffer.from('\n')]); }));
    run(data, pg.res, idx + 1, [1, 0, 0, 1, 0, 0]);
  });
  return glyphs;
}
