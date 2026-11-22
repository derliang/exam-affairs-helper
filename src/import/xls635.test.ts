import { describe, expect, it } from 'vitest';
import { readXlsx, xlsxReadErrorText } from './xlsx';

/** #635 ①：直接讀 .xls。這裡用最小的 OLE2＋BIFF8 組一個假檔（假資料），不依賴任何套件。 */
const le16 = (n: number): number[] => [n & 255, (n >> 8) & 255];
const le32 = (n: number): number[] => [...le16(n & 0xffff), ...le16((n >>> 16) & 0xffff)];
const rec = (id: number, data: number[]): number[] => [...le16(id), ...le16(data.length), ...data];
const f64 = (x: number): number[] => [...new Uint8Array(new Float64Array([x]).buffer)];
const wideStr = (s: string): number[] => [...le16(s.length), 1, ...[...s].flatMap((c) => le16(c.charCodeAt(0)))];

interface Cell { r: number; c: number; kind: 'sst' | 'num' | 'rk' | 'label'; v: number | string }

function buildXls(opts: { sst: number[][]; sstCount: number; sheets: { name: string; cells: Cell[]; mulrk?: { r: number; c: number; vals: number[] } }[] }): Uint8Array {
  const sheetRecs = opts.sheets.map((s) => {
    const body: number[] = [...rec(0x809, [...le16(0x600), ...le16(0x10), ...le16(0), ...le16(0)])];
    for (const x of s.cells) {
      if (x.kind === 'sst') body.push(...rec(0xfd, [...le16(x.r), ...le16(x.c), ...le16(0), ...le32(x.v as number)]));
      else if (x.kind === 'num') body.push(...rec(0x203, [...le16(x.r), ...le16(x.c), ...le16(0), ...f64(x.v as number)]));
      else if (x.kind === 'rk') body.push(...rec(0x27e, [...le16(x.r), ...le16(x.c), ...le16(0), ...le32(((x.v as number) << 2) | 2)]));
      else body.push(...rec(0x204, [...le16(x.r), ...le16(x.c), ...le16(0), ...wideStr(x.v as string)]));
    }
    if (s.mulrk) {
      const m = s.mulrk;
      body.push(...rec(0xbd, [...le16(m.r), ...le16(m.c), ...m.vals.flatMap((v) => [...le16(0), ...le32((v << 2) | 2)]), ...le16(m.c + m.vals.length - 1)]));
    }
    body.push(...rec(0x0a, []));
    return body;
  });
  const sstRecs = opts.sst.map((d, i) => rec(i === 0 ? 0xfc : 0x3c, i === 0 ? [...le32(opts.sstCount), ...le32(opts.sstCount), ...d] : d)).flat();
  const bsLen = (name: string): number => 4 + 4 + 2 + 1 + 1 + name.length + 4 - 4 + 4;
  const bsRec = (name: string, off: number): number[] => rec(0x85, [...le32(off), 0, 0, name.length, 1, ...[...name].flatMap((c) => le16(c.charCodeAt(0)))]);
  const bof = rec(0x809, [...le16(0x600), ...le16(5), ...le16(0), ...le16(0)]);
  const eof = rec(0x0a, []);
  void bsLen;
  const globalsLen = bof.length + opts.sheets.reduce((a, s) => a + bsRec(s.name, 0).length, 0) + sstRecs.length + eof.length;
  let off = globalsLen;
  const bs = opts.sheets.flatMap((s, i) => { const r = bsRec(s.name, off); off += sheetRecs[i]!.length; return r; });
  let wb = [...bof, ...bs, ...sstRecs, ...eof, ...sheetRecs.flat()];
  while (wb.length < 4096) wb.push(0);
  while (wb.length % 512) wb.push(0);
  const wbSecs = wb.length / 512;
  // OLE2：0 = FAT、1 = 目錄、2.. = Workbook
  const fat = new Array(128).fill(0xffffffff);
  fat[0] = 0xfffffffd;
  fat[1] = 0xfffffffe;
  for (let i = 0; i < wbSecs; i++) fat[2 + i] = i === wbSecs - 1 ? 0xfffffffe : 3 + i;
  const fatBytes = fat.flatMap((n) => le32(n));
  const entry = (name: string, type: number, start: number, size: number): number[] => {
    const nm = [...name].flatMap((c) => le16(c.charCodeAt(0)));
    const e = new Array(128).fill(0);
    nm.forEach((v, i) => { e[i] = v; });
    e.splice(0x40, 2, ...le16(nm.length + 2));
    e[0x42] = type;
    e.splice(0x74, 4, ...le32(start));
    e.splice(0x78, 4, ...le32(size));
    return e;
  };
  const dir = [...entry('Root Entry', 5, 0xfffffffe, 0), ...entry('Workbook', 2, 2, wb.length)];
  while (dir.length < 512) dir.push(0);
  const header = new Array(512).fill(0);
  header.splice(0, 8, 0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
  header.splice(0x1e, 2, ...le16(9));
  header.splice(0x20, 2, ...le16(6));
  header.splice(0x2c, 4, ...le32(1));
  header.splice(0x30, 4, ...le32(1));
  header.splice(0x38, 4, ...le32(4096));
  header.splice(0x3c, 4, ...le32(0xfffffffe));
  header.splice(0x44, 4, ...le32(0xfffffffe));
  for (let i = 0; i < 109; i++) header.splice(0x4c + i * 4, 4, ...le32(i === 0 ? 0 : 0xffffffff));
  return new Uint8Array([...header, ...fatBytes, ...dir, ...wb]);
}

describe('#635 ① 直接讀 .xls（BIFF8）', () => {
  it('字串（含跨 CONTINUE 且字元寬度切換）、數字、RK、MULRK、多工作表', async () => {
    // SST 3 筆：'甲班'（寬）、'ab'（窄，從 CONTINUE 續）、'Z'
    const s0 = [...le16(2), 1, ...le16(0x7532), ...le16(0x73ed)]; // 甲班（'甲'=0x7532、'班'=0x73ed）
    const first = [...s0, ...le16(4), 0, 0x61]; // 第二筆：cch=4，窄字元，先放 'a'
    const cont = [0, 0x62, 0x63, 0x64, ...le16(1), 0, 0x5a]; // 續：旗標 0（窄）'bcd'；第三筆 'Z'
    const bytes = buildXls({
      sst: [first, cont],
      sstCount: 3,
      sheets: [
        { name: '名單', cells: [{ r: 0, c: 0, kind: 'sst', v: 0 }, { r: 0, c: 1, kind: 'sst', v: 1 }, { r: 1, c: 0, kind: 'num', v: 3.5 }, { r: 1, c: 2, kind: 'rk', v: 17 }, { r: 2, c: 0, kind: 'label', v: '直接字串' }, { r: 2, c: 1, kind: 'sst', v: 2 }], mulrk: { r: 3, c: 1, vals: [5, 6, 7] } },
        { name: '第二張', cells: [{ r: 0, c: 0, kind: 'num', v: 301 }] },
      ],
    });
    const sheets = await readXlsx(bytes);
    expect(sheets.map((s) => s.name)).toEqual(['名單', '第二張']);
    expect(sheets[0]!.rows[0]).toEqual(['甲班', 'abcd']);
    expect(sheets[0]!.rows[1]).toEqual(['3.5', '', '17']);
    expect(sheets[0]!.rows[2]).toEqual(['直接字串', 'Z']);
    expect(sheets[0]!.rows[3]).toEqual(['', '5', '6', '7']);
    expect(sheets[1]!.rows[0]).toEqual(['301']);
  });

  it('損壞的 .xls：中文步驟提示（請用 Excel 另存成 .xlsx），不外露英文', async () => {
    const bytes = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...new Array(600).fill(0)]);
    let err: unknown;
    try { await readXlsx(bytes); } catch (e) { err = e; }
    expect(err).toBeDefined();
    const t = xlsxReadErrorText(err);
    expect(t).toContain('另存新檔');
    expect(t).toContain('.xlsx');
  });
});
