/**
 * 最小 .xls（BIFF8，Excel 97–2003）讀取器（#635 ①）：只讀、不依賴 DOM、不新增套件。
 * 只取每個工作表的儲存格文字，回傳與 readXlsx 相同的 string[][]。公式取其快取值，日期不轉換（與 .xlsx 讀法一致）。
 * 步驟：OLE2 複合檔 → 取出 Workbook 串流 → 解 BIFF 記錄（BOUNDSHEET、SST、各種儲存格）。
 */
import type { Sheet } from './xlsx';

export class XlsParseError extends Error {}

const u16 = (b: Uint8Array, o: number): number => (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8);
const u32 = (b: Uint8Array, o: number): number => (u16(b, o) | (u16(b, o + 2) << 16)) >>> 0;

/** OLE2 複合檔：回傳指定名稱的串流位元組 */
function oleStream(b: Uint8Array, names: string[]): Uint8Array {
  const secShift = u16(b, 0x1e);
  const miniShift = u16(b, 0x20);
  if (secShift < 7 || secShift > 16) throw new XlsParseError('不是有效的 .xls 檔');
  const secSize = 1 << secShift;
  const miniSize = 1 << miniShift;
  const secOff = (s: number): number => (s + 1) * secSize;
  const slice = (s: number): Uint8Array => b.subarray(secOff(s), secOff(s) + secSize);
  const ENDOFCHAIN = 0xfffffffe;

  // FAT 扇區清單：檔頭 109 個 + DIFAT 鏈
  const fatSecs: number[] = [];
  for (let i = 0; i < 109; i++) {
    const s = u32(b, 0x4c + i * 4);
    if (s < 0xfffffffa) fatSecs.push(s);
  }
  let difat = u32(b, 0x44);
  const perDifat = secSize / 4 - 1;
  for (let guard = 0; difat < 0xfffffffa && guard < 10000; guard++) {
    const d = slice(difat);
    for (let i = 0; i < perDifat; i++) {
      const s = u32(d, i * 4);
      if (s < 0xfffffffa) fatSecs.push(s);
    }
    difat = u32(d, perDifat * 4);
  }
  const fat: number[] = [];
  for (const fs of fatSecs) {
    const d = slice(fs);
    for (let i = 0; i < secSize / 4; i++) fat.push(u32(d, i * 4));
  }
  const chain = (start: number, table: number[]): number[] => {
    const out: number[] = [];
    let s = start;
    while (s < 0xfffffffa && out.length <= table.length) {
      out.push(s);
      s = table[s] ?? ENDOFCHAIN;
    }
    return out;
  };
  const readChain = (start: number): Uint8Array => {
    const secs = chain(start, fat);
    const out = new Uint8Array(secs.length * secSize);
    secs.forEach((s, i) => out.set(slice(s), i * secSize));
    return out;
  };

  const dir = readChain(u32(b, 0x30));
  type Entry = { name: string; type: number; start: number; size: number };
  const entries: Entry[] = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const nlen = Math.max(0, u16(dir, o + 0x40) - 2);
    let name = '';
    for (let i = 0; i < nlen; i += 2) name += String.fromCharCode(u16(dir, o + i));
    entries.push({ name, type: dir[o + 0x42] ?? 0, start: u32(dir, o + 0x74), size: u32(dir, o + 0x78) });
  }
  const target = entries.find((e) => e.type === 2 && names.includes(e.name));
  if (!target) throw new XlsParseError('找不到 Workbook 資料（不是 Excel 檔，或已加密）');
  const cutoff = u32(b, 0x38) || 4096;
  if (target.size >= cutoff) return readChain(target.start).subarray(0, target.size);

  // 小串流：存在根項目的資料裡，用 mini FAT
  const root = entries.find((e) => e.type === 5);
  if (!root) throw new XlsParseError('不是有效的 .xls 檔');
  const miniData = readChain(root.start);
  const miniFatBytes = readChain(u32(b, 0x3c));
  const miniFat: number[] = [];
  for (let i = 0; i + 4 <= miniFatBytes.length; i += 4) miniFat.push(u32(miniFatBytes, i));
  const secs = chain(target.start, miniFat);
  const out = new Uint8Array(secs.length * miniSize);
  secs.forEach((s, i) => out.set(miniData.subarray(s * miniSize, (s + 1) * miniSize), i * miniSize));
  return out.subarray(0, target.size);
}

interface Rec { id: number; data: Uint8Array }

function records(wb: Uint8Array): Rec[] {
  const out: Rec[] = [];
  let o = 0;
  while (o + 4 <= wb.length) {
    const id = u16(wb, o);
    const len = u16(wb, o + 2);
    out.push({ id, data: wb.subarray(o + 4, o + 4 + len) });
    o += 4 + len;
  }
  return out;
}

/** 可跨 CONTINUE 記錄的字串讀取器（SST 用） */
class ChunkReader {
  private ci = 0;
  private pos = 0;
  constructor(private chunks: Uint8Array[]) {}
  get done(): boolean {
    while (this.ci < this.chunks.length && this.pos >= (this.chunks[this.ci]?.length ?? 0)) { this.ci++; this.pos = 0; }
    return this.ci >= this.chunks.length;
  }
  private left(): number { return (this.chunks[this.ci]?.length ?? 0) - this.pos; }
  u8(): number {
    if (this.done) return 0;
    return this.chunks[this.ci]![this.pos++] ?? 0;
  }
  u16(): number { return this.u8() | (this.u8() << 8); }
  u32(): number { return (this.u16() | (this.u16() << 16)) >>> 0; }
  skip(n: number): void {
    while (n > 0 && !this.done) {
      const k = Math.min(n, this.left());
      this.pos += k;
      n -= k;
    }
  }
  /** 讀 n 個字元；跨 CONTINUE 時下一段開頭有一個旗標位元組決定是否雙位元組 */
  chars(n: number, wide: boolean): string {
    let s = '';
    while (n > 0) {
      if (this.ci >= this.chunks.length) break;
      if (this.left() <= 0) {
        this.ci++;
        this.pos = 0;
        if (this.ci < this.chunks.length) wide = (this.u8() & 1) === 1;
        continue;
      }
      const per = wide ? 2 : 1;
      const can = Math.min(n, Math.floor(this.left() / per));
      if (can === 0) { this.pos = this.chunks[this.ci]!.length; continue; }
      const c = this.chunks[this.ci]!;
      for (let i = 0; i < can; i++) {
        s += String.fromCharCode(wide ? u16(c, this.pos + i * 2) : c[this.pos + i]!);
      }
      this.pos += can * per;
      n -= can;
    }
    return s;
  }
}

function parseSst(recs: Rec[], at: number): string[] {
  const chunks = [recs[at]!.data];
  for (let i = at + 1; i < recs.length && recs[i]!.id === 0x3c; i++) chunks.push(recs[i]!.data);
  const r = new ChunkReader(chunks);
  r.u32();
  const unique = r.u32();
  const out: string[] = [];
  for (let i = 0; i < unique && !r.done; i++) {
    const cch = r.u16();
    const flags = r.u8();
    const rich = (flags & 8) !== 0 ? r.u16() : 0;
    const phon = (flags & 4) !== 0 ? r.u32() : 0;
    out.push(r.chars(cch, (flags & 1) !== 0));
    if (rich) r.skip(rich * 4);
    if (phon) r.skip(phon);
  }
  return out;
}

/** 單一記錄內的 BIFF8 字串（LABEL、公式字串）：長度 2 位元組 */
function strIn(d: Uint8Array, o: number): string {
  const cch = u16(d, o);
  const flags = d[o + 2] ?? 0;
  let p = o + 3;
  if (flags & 8) p += 2;
  if (flags & 4) p += 4;
  let s = '';
  for (let i = 0; i < cch; i++) {
    if (flags & 1) { s += String.fromCharCode(u16(d, p)); p += 2; } else { s += String.fromCharCode(d[p] ?? 0); p += 1; }
  }
  return s;
}

const numText = (n: number): string => (Number.isFinite(n) ? (Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(15)))) : '');

function rkValue(rk: number): number {
  let v: number;
  if (rk & 2) v = rk >> 2;
  else {
    const buf = new DataView(new ArrayBuffer(8));
    buf.setUint32(4, (rk & 0xfffffffc) >>> 0, true);
    v = buf.getFloat64(0, true);
  }
  return rk & 1 ? v / 100 : v;
}

const f64 = (d: Uint8Array, o: number): number => new DataView(d.buffer, d.byteOffset + o, 8).getFloat64(0, true);

function parseSheet(recs: Rec[], start: number, shared: string[]): string[][] {
  const rows: string[][] = [];
  const put = (r: number, c: number, v: string): void => {
    while (rows.length <= r) rows.push([]);
    const row = rows[r]!;
    while (row.length < c) row.push('');
    row[c] = v;
  };
  let depth = 0;
  let lastFormula: [number, number] | null = null;
  for (let i = start; i < recs.length; i++) {
    const { id, data: d } = recs[i]!;
    if (id === 0x809) { depth++; continue; }
    if (id === 0x0a) { if (--depth <= 0) break; continue; }
    if (depth !== 1) continue;
    switch (id) {
      case 0xfd: put(u16(d, 0), u16(d, 2), shared[u32(d, 6)] ?? ''); break;
      case 0x204: put(u16(d, 0), u16(d, 2), strIn(d, 6)); break;
      case 0xd6: put(u16(d, 0), u16(d, 2), strIn(d, 6)); break;
      case 0x203: put(u16(d, 0), u16(d, 2), numText(f64(d, 6))); break;
      case 0x27e: put(u16(d, 0), u16(d, 2), numText(rkValue(u32(d, 6) | 0))); break;
      case 0xbd: {
        const r = u16(d, 0);
        const c0 = u16(d, 2);
        const n = (d.length - 6) / 6;
        for (let k = 0; k < n; k++) put(r, c0 + k, numText(rkValue(u32(d, 4 + k * 6 + 2) | 0)));
        break;
      }
      case 0x205: {
        const isErr = d[7] === 1;
        put(u16(d, 0), u16(d, 2), isErr ? '' : d[6] ? 'TRUE' : 'FALSE');
        break;
      }
      case 0x06: {
        const r = u16(d, 0);
        const c = u16(d, 2);
        if (d[12] === 0xff && d[13] === 0xff) {
          const t = d[6];
          if (t === 0) { lastFormula = [r, c]; put(r, c, ''); } else if (t === 1) put(r, c, d[8] ? 'TRUE' : 'FALSE'); else put(r, c, '');
        } else put(r, c, numText(f64(d, 6)));
        break;
      }
      case 0x207:
        if (lastFormula) { put(lastFormula[0], lastFormula[1], strIn(d, 0)); lastFormula = null; }
        break;
      default: break;
    }
  }
  return rows;
}

export function readXls(data: ArrayBuffer | Uint8Array): Sheet[] {
  const b = data instanceof Uint8Array ? data : new Uint8Array(data);
  const wb = oleStream(b, ['Workbook', 'Book']);
  const recs = records(wb);
  const first = recs[0];
  if (!first || first.id !== 0x809) throw new XlsParseError('不是有效的 .xls 檔');
  if (u16(first.data, 0) !== 0x0600) throw new XlsParseError('這個 .xls 版本太舊（Excel 95 以前），請用 Excel 另存成 .xlsx');
  const posToIdx = new Map<number, number>();
  let o = 0;
  recs.forEach((r, i) => { posToIdx.set(o, i); o += 4 + r.data.length; });
  let shared: string[] = [];
  const sheetsInfo: { name: string; offset: number; type: number }[] = [];
  let depth = 0;
  for (let i = 0; i < recs.length; i++) {
    const { id, data: d } = recs[i]!;
    if (id === 0x809) depth++;
    else if (id === 0x0a) { if (--depth <= 0) break; }
    else if (depth === 1 && id === 0xfc) shared = parseSst(recs, i);
    else if (depth === 1 && id === 0x85) {
      const cch = d[6] ?? 0;
      const wide = ((d[7] ?? 0) & 1) === 1;
      let name = '';
      for (let k = 0; k < cch; k++) name += String.fromCharCode(wide ? u16(d, 8 + k * 2) : (d[8 + k] ?? 0));
      sheetsInfo.push({ name, offset: u32(d, 0), type: d[5] ?? 0 });
    }
  }
  const sheets: Sheet[] = [];
  for (const s of sheetsInfo) {
    if (s.type !== 0) continue;
    const idx = posToIdx.get(s.offset);
    if (idx === undefined) continue;
    sheets.push({ name: s.name, rows: parseSheet(recs, idx, shared) });
  }
  return sheets;
}
