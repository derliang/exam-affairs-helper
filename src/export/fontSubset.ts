/**
 * TrueType 字型「清空未用字形」子集化（#630）。
 *
 * Word 檔要內嵌字型（D44），但整套 Big5 字型約 4.8MB（粗體 1.9MB），壓進每個 .docx 都約 4MB。
 * 這裡只保留文件實際用到的字形輪廓，其餘字形清成空字形：字形編號、cmap、hmtx、GSUB 等表一律不動，
 * 所以字形對應與字距不變，只是 glyf 表（佔 96%）縮到幾十 KB；沒用到的字在 Word 內編輯時會退回電腦字型。
 * 不改字形編號是刻意的：這樣不必重寫 cmap／hmtx／vmtx，出錯的機會最小。
 */

const u16 = (dv: DataView, o: number): number => dv.getUint16(o);
const u32 = (dv: DataView, o: number): number => dv.getUint32(o);

interface Table { tag: string; off: number; len: number }

function readTables(dv: DataView): Table[] {
  const n = u16(dv, 4);
  const out: Table[] = [];
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    out.push({ tag: String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3)), off: u32(dv, o + 8), len: u32(dv, o + 12) });
  }
  return out;
}

/** cmap 查字形編號（支援 format 4、12；0 表示沒有這個字） */
function cmapLookup(dv: DataView, cmapOff: number): (cp: number) => number {
  const n = u16(dv, cmapOff + 2);
  type Sub = { fmt: number; off: number; pri: number };
  const subs: Sub[] = [];
  for (let i = 0; i < n; i++) {
    const plat = u16(dv, cmapOff + 4 + i * 8);
    const enc = u16(dv, cmapOff + 6 + i * 8);
    const off = cmapOff + u32(dv, cmapOff + 8 + i * 8);
    const fmt = u16(dv, off);
    if (fmt !== 4 && fmt !== 12) continue;
    const pri = (plat === 3 && enc === 10) || (plat === 0 && enc === 4) ? 3 : plat === 3 && enc === 1 ? 2 : plat === 0 ? 1 : 0;
    subs.push({ fmt, off, pri });
  }
  const f4 = subs.filter((s) => s.fmt === 4).sort((a, b) => b.pri - a.pri)[0];
  const f12 = subs.filter((s) => s.fmt === 12).sort((a, b) => b.pri - a.pri)[0];
  const look4 = (cp: number): number => {
    if (!f4 || cp > 0xffff) return 0;
    const o = f4.off;
    const segX2 = u16(dv, o + 6);
    const endO = o + 14;
    const startO = endO + segX2 + 2;
    const deltaO = startO + segX2;
    const rangeO = deltaO + segX2;
    for (let i = 0; i < segX2; i += 2) {
      if (cp > u16(dv, endO + i)) continue;
      const start = u16(dv, startO + i);
      if (cp < start) return 0;
      const ro = u16(dv, rangeO + i);
      if (ro === 0) return (cp + dv.getInt16(deltaO + i)) & 0xffff;
      const g = u16(dv, rangeO + i + ro + (cp - start) * 2);
      return g === 0 ? 0 : (g + dv.getInt16(deltaO + i)) & 0xffff;
    }
    return 0;
  };
  const look12 = (cp: number): number => {
    if (!f12) return 0;
    const o = f12.off;
    const ng = u32(dv, o + 12);
    let lo = 0;
    let hi = ng - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const g = o + 16 + mid * 12;
      const s = u32(dv, g);
      const e = u32(dv, g + 4);
      if (cp < s) hi = mid - 1;
      else if (cp > e) lo = mid + 1;
      else return u32(dv, g + 8) + (cp - s);
    }
    return 0;
  };
  return (cp) => look12(cp) || look4(cp);
}

function checksum(b: Uint8Array, off: number, len: number): number {
  let sum = 0;
  const end = off + len;
  for (let i = off; i < end; i += 4) {
    const w = ((b[i] ?? 0) << 24) | ((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (i + 3 < end ? (b[i + 3] ?? 0) : 0);
    sum = (sum + (w >>> 0)) >>> 0;
  }
  return sum;
}

/** 只保留 chars 內每個字（加 .notdef、空白）的字形；其餘字形清空。字型格式不認得（不是 glyf 輪廓）就原樣回傳 */
export function subsetTtf(font: Uint8Array, chars: Iterable<string>): Uint8Array {
  const dv = new DataView(font.buffer, font.byteOffset, font.byteLength);
  if (u32(dv, 0) !== 0x00010000) return font;
  const tables = readTables(dv);
  const T = (tag: string) => tables.find((t) => t.tag === tag);
  const head = T('head');
  const maxp = T('maxp');
  const loca = T('loca');
  const glyf = T('glyf');
  const cmap = T('cmap');
  if (!head || !maxp || !loca || !glyf || !cmap) return font;
  const numGlyphs = u16(dv, maxp.off + 4);
  const longLoca = dv.getInt16(head.off + 50) === 1;
  const locaAt = (g: number): number => (longLoca ? u32(dv, loca.off + g * 4) : u16(dv, loca.off + g * 2) * 2);
  const look = cmapLookup(dv, cmap.off);

  const keep = new Set<number>([0]);
  const stack: number[] = [];
  const add = (g: number) => { if (g > 0 && g < numGlyphs && !keep.has(g)) { keep.add(g); stack.push(g); } };
  for (const ch of chars) { const cp = ch.codePointAt(0); if (cp !== undefined) add(look(cp)); }
  for (const g of [...keep]) stack.push(g);
  // 複合字形引用的零件也要留
  while (stack.length) {
    const g = stack.pop()!;
    const s = locaAt(g);
    const e = locaAt(g + 1);
    if (e - s < 10) continue;
    const o = glyf.off + s;
    if (dv.getInt16(o) >= 0) continue;
    let p = o + 10;
    for (;;) {
      const flags = u16(dv, p);
      add(u16(dv, p + 2));
      p += 4 + (flags & 1 ? 4 : 2);
      if (flags & 0x8) p += 2;
      else if (flags & 0x40) p += 4;
      else if (flags & 0x80) p += 8;
      if (!(flags & 0x20)) break;
    }
  }

  // 新 glyf／loca（一律長格式，避免短格式偏移溢位）
  const chunks: Uint8Array[] = [];
  const newLoca = new Uint8Array((numGlyphs + 1) * 4);
  const ldv = new DataView(newLoca.buffer);
  let pos = 0;
  for (let g = 0; g < numGlyphs; g++) {
    ldv.setUint32(g * 4, pos);
    if (!keep.has(g)) continue;
    const s = locaAt(g);
    const e = locaAt(g + 1);
    if (e <= s) continue;
    const padded = (e - s + 3) & ~3;
    const c = new Uint8Array(padded);
    c.set(font.subarray(glyf.off + s, glyf.off + e));
    chunks.push(c);
    pos += padded;
  }
  ldv.setUint32(numGlyphs * 4, pos);
  const newGlyf = new Uint8Array(pos);
  let w = 0;
  for (const c of chunks) { newGlyf.set(c, w); w += c.length; }

  // 重組：目錄 + 各表（4 位元組對齊），head 的 checkSumAdjustment 重算
  const parts = tables.map((t) => {
    let data = font.subarray(t.off, t.off + t.len);
    if (t.tag === 'glyf') data = newGlyf;
    else if (t.tag === 'loca') data = newLoca;
    else if (t.tag === 'head') { data = data.slice(); const hd = new DataView(data.buffer, data.byteOffset); hd.setInt16(50, 1); hd.setUint32(8, 0); }
    return { tag: t.tag, data };
  }).sort((a, b) => (a.tag < b.tag ? -1 : 1));
  const dirLen = 12 + parts.length * 16;
  let total = dirLen;
  const offs = parts.map((p) => { const o = total; total += (p.data.length + 3) & ~3; return o; });
  const out = new Uint8Array(total);
  const odv = new DataView(out.buffer);
  out.set(font.subarray(0, 12));
  const nT = parts.length;
  const es = 2 ** Math.floor(Math.log2(nT));
  odv.setUint16(4, nT);
  odv.setUint16(6, es * 16);
  odv.setUint16(8, Math.log2(es));
  odv.setUint16(10, nT * 16 - es * 16);
  parts.forEach((p, i) => {
    out.set(p.data, offs[i]!);
    const d = 12 + i * 16;
    for (let k = 0; k < 4; k++) out[d + k] = p.tag.charCodeAt(k);
    odv.setUint32(d + 4, checksum(out, offs[i]!, p.data.length));
    odv.setUint32(d + 8, offs[i]!);
    odv.setUint32(d + 12, p.data.length);
  });
  const headIdx = parts.findIndex((p) => p.tag === 'head');
  odv.setUint32(offs[headIdx]! + 8, (0xb1b0afba - checksum(out, 0, total)) >>> 0);
  return out;
}

/** 讀字形清單用於測試：回傳某字元在子集後字型的字形位元組長度（0＝空字形或沒有） */
export function glyphBytesOf(font: Uint8Array, ch: string): number {
  const dv = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const tables = readTables(dv);
  const T = (tag: string) => tables.find((t) => t.tag === tag)!;
  const longLoca = dv.getInt16(T('head').off + 50) === 1;
  const g = cmapLookup(dv, T('cmap').off)(ch.codePointAt(0)!);
  const at = (i: number) => (longLoca ? u32(dv, T('loca').off + i * 4) : u16(dv, T('loca').off + i * 2) * 2);
  return at(g + 1) - at(g);
}
