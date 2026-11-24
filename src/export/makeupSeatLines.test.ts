/** 補考座位表格內三行（學號／班級 座號／姓名）、考程表一頁兩張表、點名單左右兩組（2026-11-24 使用者要求；稿 v2.107、D226）。全部匿名假資料。 */
import { describe, expect, it } from 'vitest';
import { renderPrintHtml as renderHtml } from './htmlRender';
import { threeLineFit } from './model';
import type { CellModel, SeatPageModel, TablePageModel } from './model';

const cell: CellModel = { coord: '1-1', seat: { row: 1, depth: 1 }, code: '05', classLabel: '高二溫', name: '510009', lines: ['510009', '高二溫 5號', '測試甲'], colorBg: 'FFFFFF', colorLine: '222222', colorFg: '22201B', tags: [], marks: [] };

describe('threeLineFit', () => {
  it('三行字級：在格內放得下、不小於 6、不大於 16', () => {
    const pt = threeLineFit(['510009', '高二溫 5號', '測試甲'], 28, 22);
    expect(pt).toBeGreaterThanOrEqual(6);
    expect(pt).toBeLessThanOrEqual(16);
  });
  it('格子很窄或很矮時縮小', () => {
    expect(threeLineFit(['510009', '高二溫 5號', '測試甲'], 14, 12)).toBeLessThan(threeLineFit(['510009', '高二溫 5號', '測試甲'], 40, 40));
  });
});

describe('補考座位格三行', () => {
  it('HTML：格內依序印學號、班級 座號、姓名三行，不印大號碼', () => {
    const page: SeatPageModel = {
      kind: 'seat', title: '測試補考座位表', examName: '測試', heading: '測試補考座位表', roomName: '教室一', chips: [], detachStyle: false, rows: 1, depth: 1,
      cells: new Map([['1-1', cell]]), usable: new Set(['1-1']),
      stats: { perClass: [], total: 1, perSubject: [], table: { classes: [], headLabel: '補考人數', rows: [] } },
    } as unknown as SeatPageModel;
    const html = renderHtml({ seat: [page] }, { generatedAt: '2026-11-24T00:00:00Z', dataVersion: 'x' } as never);
    const i1 = html.indexOf('510009');
    const i2 = html.indexOf('高二溫 5號');
    const i3 = html.indexOf('測試甲');
    expect(i1).toBeGreaterThan(-1);
    expect(i1).toBeLessThan(i2);
    expect(i2).toBeLessThan(i3);
    expect(html).toContain('pp-3l');
  });
});

describe('考程表一頁兩張表', () => {
  it('HTML：同一個 section 內有「補考時間、地點表」與「補考監考表」', () => {
    const t2: TablePageModel = { kind: 'table', landscape: true, title: '補考監考表', heads: ['監考時段', 'A'], widths: [1, 1], rows: [['監考老師', '']] };
    const t1: TablePageModel = { kind: 'table', landscape: true, title: '補考時間、地點表', heads: ['節次', 'A'], widths: [1, 1], rows: [['第一節・時間', '8:00']], second: t2 };
    const html = renderHtml({ table: [t1] }, { generatedAt: '2026-11-24T00:00:00Z', dataVersion: 'x' } as never);
    expect((html.match(/<section class="sheet a4 land"/g) ?? []).length).toBe(1);
    expect(html.indexOf('補考時間、地點表')).toBeLessThan(html.indexOf('補考監考表'));
  });
});
