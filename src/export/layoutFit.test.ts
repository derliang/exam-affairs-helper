/** 座位表與標籤的字級／統計表版面（Issue #217、#218、#222、#213、#219）：假資料，不含真實姓名 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { makeFixture } from './fixtures';
import { buildDetachList, buildLabelPages, buildSeatPages, renderDocx, renderPrintHtml } from './index';
import { namePtFit, SEAT_PAGE, seatGeometry, statLayout, textWidthMm, type SeatPageModel } from './model';

const fontDir = new URL('./fonts/', import.meta.url);
const fonts = {
  regular: new Uint8Array(readFileSync(new URL('NotoSansTC-Regular-big5.ttf', fontDir))),
  bold: new Uint8Array(readFileSync(new URL('NotoSansTC-Bold-core.ttf', fontDir))),
};
const meta = { generatedAt: '2026-11-08T08:30:00Z', dataVersion: 'A1B2C3D4' };

describe('格內「班級｜姓名」字級（#222）', () => {
  it('在格寬放得下的前提下取最大：短姓名較大、四字姓名較小，且都不超過上限', () => {
    const w = 23.6;
    const four = namePtFit('良', '王小明華', w, 12);
    const three = namePtFit('良', '王小明', w, 12);
    expect(three).toBeGreaterThan(four);
    expect(four).toBeGreaterThan(8.5); // 原本固定 8.5pt
    expect(three).toBeLessThanOrEqual(12);
    // 放得下：估算寬度不超過格內可用寬度
    expect(textWidthMm('良', four, true) + textWidthMm('王小明華', four)).toBeLessThanOrEqual(w);
  });
});

describe('統計表（#217）', () => {
  const page = (): SeatPageModel => {
    const p = buildSeatPages(makeFixture())[0]!;
    // 六班、很長的第一欄列名
    p.stats.table = {
      classes: ['溫', '良', '恭', '儉', '勤', '誠'],
      rows: [
        { label: '本教室考生人數', per: [7, 7, 7, 7, 6, 6], total: 40 },
        { label: '考國文、英語聽力、數學甲、數學乙、自然', per: [7, 7, 7, 7, 6, 6], total: 40 },
      ],
    };
    return p;
  };
  it('長列名折行、列高隨行數撐開，不被固定列高切掉', () => {
    const L = statLayout(page());
    expect(L.rowH[2]!).toBeGreaterThan(L.rowH[1]!);
    expect(L.cols.reduce((a, b) => a + b, 0)).toBeCloseTo(SEAT_PAGE.w - 2 * SEAT_PAGE.padX, 1);
    expect(L.cols[0]!).toBeGreaterThanOrEqual(55);
  });
  it('座位格高度扣掉的就是統計表實際總高：整頁放得下', () => {
    const p = page();
    p.depth = 8;
    const { ch } = seatGeometry(p);
    const used = 22 + 12 + 4 + 5 + 11 + 5 + statLayout(p).total + 16 + ch * p.depth;
    expect(used).toBeLessThanOrEqual(SEAT_PAGE.h - 2 * SEAT_PAGE.padY + 0.1);
  });
});

describe('標籤：沒有標示的格子（#218）', () => {
  it('列印頁：一般格子不留標示區、整塊垂直置中（class fr）；有標示的格子不受影響', () => {
    const f = makeFixture();
    const html = renderPrintHtml({ label: buildLabelPages(f) }, meta);
    expect(html).toContain('pp-c fr');
  });
  it('Word：無標示格子少一個空段落', async () => {
    const f = makeFixture();
    const buf = await renderDocx({ label: buildLabelPages(f) }, { fonts, ...meta });
    const z = await JSZip.loadAsync(buf);
    const xml = await z.file('word/document.xml')!.async('string');
    expect(xml.length).toBeGreaterThan(1000);
  });
});

describe('名單表頭：班級、座號分兩欄（#213、#219）', () => {
  it('抽離名單列印頁表頭＝科目、班級、座號、姓名、去處、用途；座號欄只放座號', () => {
    const f = makeFixture();
    const l = buildDetachList(f);
    expect(l.rows.find((r) => r.code === '0105')!.seatNo).toBe('05');
    const html = renderPrintHtml({ list: l }, meta);
    expect(html).toContain('<th>班級</th><th>座號</th>');
    expect(html).not.toContain('考生編號');
  });
});
