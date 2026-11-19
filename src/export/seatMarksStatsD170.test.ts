/** D170（稿 v2.76、DESIGN §10.43；Issue #470 #471 #391 #472）：座位格標示帶、統計表欄位與垂直合併。全部匿名假資料。 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { buildSeatPages, renderDocx, renderPrintHtml, seatCellFit, statLayout, statMerge, type CellModel, type CornerTag } from './index';
import { makeFixture } from './fixtures';

const fontDir = new URL('./fonts/', import.meta.url);
const fonts = {
  regular: new Uint8Array(readFileSync(new URL('NotoSansTC-Regular-big5.ttf', fontDir))),
  bold: new Uint8Array(readFileSync(new URL('NotoSansTC-Bold-core.ttf', fontDir))),
};
const meta = { generatedAt: '2026-11-19T08:30:00Z', dataVersion: 'A1B2C3D4' };
const real = () => JSON.parse(JSON.stringify(makeFixture()).replace(/"zh"/g, '"chinese"').replace(/"en"/g, '"english"').replace(/"ma"/g, '"math"')) as ReturnType<typeof makeFixture>;

const cell = (corners: CornerTag[]): CellModel => ({
  coord: '2－5', seat: { row: 2, depth: 5 }, code: '0212', classLabel: '勇', name: '乙生12', colorBg: 'E7DCF5', colorLine: 'B39DD9', colorFg: '4A2E80', tags: [], marks: [], corners,
});
const X: CornerTag = { kind: 'x', text: 'X 數B　X 社' };
const XS: CornerTag = { kind: 'x', text: 'X 社' };
const D2: CornerTag = { kind: 'detach', text: '抽離 數A、自然 考試' };

describe('座位格標示帶（#470 #471）：標示佔實際高度，先縮標示再縮號碼，姓名不動', () => {
  it('沒有標示：號碼 19pt、沒有標示帶', () => {
    const f = seatCellFit(cell([]), 25, 19, 1.2);
    expect(f).toMatchObject({ codePt: 19, lines: [], bandMm: 0, ok: true });
  });
  it('一個不考標示：一行、字級在 6.5～7.5pt，號碼不低於 11pt', () => {
    for (const h of [23, 19, 15]) {
      const f = seatCellFit(cell([X]), 25, h, 1.2);
      expect(f.lines).toHaveLength(1);
      expect(f.markPt).toBeGreaterThanOrEqual(6.5);
      expect(f.markPt).toBeLessThanOrEqual(7.5);
      expect(f.codePt).toBeGreaterThanOrEqual(11);
    }
  });
  it('最壞（X 社＋抽離兩科）：3 行；格高 23mm 放得下、19mm 放不下（稿的紅框）', () => {
    expect(seatCellFit(cell([XS, D2]), 25, 23, 1.2)).toMatchObject({ ok: true });
    const bad = seatCellFit(cell([XS, D2]), 25, 19, 1.2);
    expect(bad.lines).toHaveLength(3);
    expect(bad.ok).toBe(false); // 稿的紅框：統計表換頁換格高
  });
  it('放得下時 號碼＋姓名＋標示帶＋座標保留 ≤ 格高（不會壓到姓名）', () => {
    for (const tags of [[], [XS], [X], [XS, D2]]) for (const top of [1.2, 2.8]) {
      const f = seatCellFit(cell(tags), 25, 23, top);
      if (!f.ok) continue;
      expect(top + f.codePt * 0.3528 * 1.1 + f.namePt * 0.3528 * 1.15 + f.bandMm).toBeLessThanOrEqual(23);
    }
  });
  it('PDF：標示帶是流程內的元素（pp-band），沒有浮動的 pp-cn；座標在格內右上', () => {
    const f = makeFixture();
    const p = buildSeatPages(f, 'class')[0]!;
    const h = renderPrintHtml({ seat: [p] }, meta);
    expect(h).not.toContain('class="pp-cn"');
    expect(h).toContain('pp-sc');
  });
});

describe('統計表（#391 #472）：日期｜第幾天｜時段｜科目｜各班｜總計，同天同時段垂直合併', () => {
  const withDates = () => { const f = real(); f.exam.examDates = ['2026-11-17', '2026-11-18']; return f; };
  it('有日期：多一個「日期」欄（含星期）；沒日期：整欄不出現', () => {
    const a = buildSeatPages(withDates(), 'class')[0]!.stats.table;
    expect(a.leadHeads).toEqual(['日期', '第幾天', '時段', '科目']);
    expect(a.rows.every((r) => r.lead!.length === 4)).toBe(true);
    expect(a.rows[0]!.lead![0]).toBe('11/17（二）');
    const b = buildSeatPages(real(), 'class')[0]!.stats.table;
    expect(b.leadHeads).toEqual(['第幾天', '時段', '科目']);
  });
  it('沒有「本教室考生人數」列；statMerge 同天同時段合併、每天最後一列 dayEnd', () => {
    const p = buildSeatPages(withDates(), 'class')[0]!;
    expect(p.stats.table.rows.some((r) => r.label === '本教室考生人數')).toBe(false);
    const m = statMerge(p);
    expect(m).toHaveLength(p.stats.table.rows.length);
    // 日期欄：每個 span>0 的列，後面 span-1 列必為 0
    m.forEach((r, i) => { if (r.span[0]! > 1) for (let k = 1; k < r.span[0]!; k++) expect(m[i + k]!.span[0]).toBe(0); });
    expect(m[m.length - 1]!.dayEnd).toBe(true);
    expect(m.filter((r) => r.dayEnd).length).toBe(2); // 兩天
  });
  it('列數 > 5：10.5pt、列高 6.4mm 起；≤ 5：12pt', () => {
    const p = buildSeatPages(withDates(), 'class')[0]!;
    const base = p.stats.table.rows[0]!;
    p.stats.table.rows = Array.from({ length: 5 }, () => base);
    expect(statLayout(p).pt).toBe(12);
    p.stats.table.rows = Array.from({ length: 6 }, () => base);
    const sl = statLayout(p);
    expect(sl.pt).toBe(10.5);
    expect(Math.min(...sl.rowH)).toBeGreaterThanOrEqual(6.4);
    expect(sl.rowH[1]).toBeLessThan(8);
  });
  it('預備教室：欄位同上，最後一列「使用人數（不重複）」標 foot', () => {
    const f = withDates();
    const p = buildSeatPages(f).find((x) => x.slotMode)!;
    const t = p.stats.table;
    expect(t.leadHeads![t.leadHeads!.length - 1]).toBe('科目');
    expect(t.rows[t.rows.length - 1]).toMatchObject({ label: '使用人數（不重複）', foot: true, total: p.stats.total });
  });
  it('PDF 有 rowspan、表頭與總計欄樣式；Word 有 vMerge 與雙線', async () => {
    const p = buildSeatPages(withDates(), 'class')[0]!;
    const h = renderPrintHtml({ seat: [p] }, meta);
    expect(h).toContain('rowspan="');
    expect(h).toContain('<th>日期</th><th>第幾天</th><th>時段</th><th>科目</th>');
    const x = await (await JSZip.loadAsync(await renderDocx({ seat: [p] }, { fonts, ...meta }))).file('word/document.xml')!.async('string');
    expect(x).toContain('<w:vMerge');
    expect(x).toContain('w:val="double"');
    expect(x).toContain('E8EDF8');
    expect(x).toContain('274690');
    expect(x).not.toContain('本教室考生人數');
  });
});
