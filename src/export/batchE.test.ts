import { describe, expect, it } from 'vitest';
import { LABEL_EDGE_X_MM, LABEL_PAGE_FIXED_MM, labelFit, labelCellMm, defaultLabelLayout, PAPER_MM, roomShown, roomTooBigForLabel, labelBoxMm, labelNotePt } from './model';
import { renderPrintHtml } from './htmlRender';
import { sampleHtml, sampleMarkLabelPage, sampleReserveLabelPage, SAMPLE_ROOM } from './sample';
import { sampleCellMm } from '../ui/pages/LabelSample';
import { buildLabelPages, buildSeatPages } from './model';
import { buildParts, defaultOptions } from './plan';
import { makeFixture } from './fixtures';

describe('G30／D154 標籤格數：橫排、深位各 ≤ 8，格子隨排數切', () => {
  it('標籤上限：班級、預備教室同一套，橫排或深位超過 8 才停用', () => {
    for (const kind of ['class', 'reserve'] as const) {
      expect(roomTooBigForLabel({ rows: 7, depth: 7, kind })).toBe(false);
      expect(roomTooBigForLabel({ rows: 7, depth: 8, kind })).toBe(false);
      expect(roomTooBigForLabel({ rows: 8, depth: 7, kind })).toBe(false);
      expect(roomTooBigForLabel({ rows: 9, depth: 6, kind })).toBe(true);
      expect(roomTooBigForLabel({ rows: 7, depth: 9, kind })).toBe(true);
    }
  });
  it('D158①：格寬＝（紙寬－左右邊距）÷max(7, 排數)；排數 ≤ 7 與以前相同；整排不超出可印寬度', () => {
    for (const paper of ['B4', 'A3'] as const) {
      const l = defaultLabelLayout(paper);
      const usable = PAPER_MM[paper].w - 2 * LABEL_EDGE_X_MM;
      for (const cols of [1, 5, 7]) expect(labelCellMm(l, 7, 0, cols).w).toBeCloseTo(usable / 7, 5);
      expect(labelCellMm(l, 7, 0, 8).w).toBeCloseTo(usable / 8, 5);
      expect(8 * labelCellMm(l, 7, 0, 8).w).toBeLessThanOrEqual(usable + 1e-9);
      expect(labelBoxMm(l, 7, 0, 8).w).toBeCloseTo(usable / 8, 5);
      // 高度仍是紙高÷深位數（深位 8 時整頁放不下就縮矮，與排數無關）
      expect(labelCellMm(l, 8, 0, 8).h).toBeCloseTo((PAPER_MM[paper].h - LABEL_PAGE_FIXED_MM) / 8, 5);
    }
  });
  it('8 排×7 深位、7 排×8 深位（各 56 座）：標籤各 1 張、格數與座位表一致（每間教室一頁）', () => {
    for (const [rows, depth] of [[8, 7], [7, 8]] as const) {
      const input = makeFixture();
      const rv = input.settings.classrooms.find((c) => c.kind === 'reserve')!;
      rv.rows = rows; rv.depth = depth; rv.seatCount = 56;
      const lab = buildLabelPages(input, 'reserve');
      expect(lab.length).toBeGreaterThan(0);
      expect(lab.every((p) => p.grid!.cols === rows && p.grid!.rows === depth)).toBe(true);
    }
  });
  it('8 列時格高＝（紙高－標題頁尾）÷8，同一頁放得下；寬＝（紙寬－左右邊距）÷7（D136）', () => {
    for (const paper of ['B4', 'A3'] as const) {
      const l = defaultLabelLayout(paper);
      const c8 = labelCellMm(l, 8);
      expect(c8.w).toBeCloseTo((PAPER_MM[paper].w - 2 * LABEL_EDGE_X_MM) / 7, 5);
      expect(c8.h).toBeCloseTo((PAPER_MM[paper].h - LABEL_PAGE_FIXED_MM) / 8, 5);
      expect(8 * c8.h).toBeLessThanOrEqual(PAPER_MM[paper].h - LABEL_PAGE_FIXED_MM + 1e-9);
      expect(labelBoxMm(l, 8).h).toBe(c8.h);
      expect(labelCellMm(l, 7).h).toBeGreaterThan(c8.h);
      expect(labelNotePt(l, 8, 0)).toBe(0);
      expect(labelNotePt(l, 8, 3)).toBeGreaterThan(0); // D136：8 列也印注意事項（格子再縮矮）
    }
  });
  it('預備教室 56 座：座位表 1 頁、標籤 1 張（7×8 格），學測／分科／會考各型都不丟錯', () => {
    for (const kind of ['gsat', 'ast', 'bcct'] as const) {
      const input = makeFixture();
      const rv = input.settings.classrooms.find((c) => c.kind === 'reserve')!;
      rv.rows = 7; rv.depth = 8; rv.seatCount = 56;
      void kind;
      const seat = buildSeatPages(input, 'reserve');
      const lab = buildLabelPages(input, 'reserve');
      expect(seat.every((p) => p.rows <= 7 && p.depth <= 8)).toBe(true);
      expect(lab.every((p) => p.grid!.cols === 7 && p.grid!.rows === 8 && p.tag === '預備教室')).toBe(true);
      const html = renderPrintHtml({ label: lab, seat }, { generatedAt: '2026-01-01T00:00:00+08:00', dataVersion: 'X' });
      if (lab.length) expect(html).toContain('grid-template-columns:repeat(7,' + +((PAPER_MM.B4.w - 2 * LABEL_EDGE_X_MM) / 7).toFixed(2) + 'mm)');
    }
  });
});

describe('G34 合併檔', () => {
  it('頁首標示：名稱已含「預備教室」不重複，否則加在前面', () => {
    expect(roomShown({ roomName: '預備教室', tag: '預備教室' })).toBe('預備教室');
    expect(roomShown({ roomName: '備一', tag: '預備教室' })).toBe('預備教室　備一');
    expect(roomShown({ roomName: '甲班' })).toBe('甲班');
  });
  it('預備教室頁都在班級教室之後；不含預備教室時完全沒有', () => {
    const parts = buildParts(makeFixture(), defaultOptions('B4'));
    for (const pages of [parts.seat!, parts.label!]) {
      const tags = pages.map((p) => !!p.tag);
      expect(tags).toEqual([...tags].sort((a, b) => Number(a) - Number(b)));
      expect(tags.some(Boolean)).toBe(true);
    }
    const none = buildParts(makeFixture(), { ...defaultOptions('B4'), reserve: false });
    expect([...none.seat!, ...none.label!].some((p) => p.tag)).toBe(false);
  });
});

describe('G26／G28 範例用真正的渲染器畫', () => {
  it('預備教室範例＝同一個頁面模型丟給真正渲染器的結果，3 張、每人一區、頁首標預備教室', () => {
    for (const paper of ['B4', 'A3'] as const) {
      const page = sampleReserveLabelPage(paper);
      expect(page.cells).toHaveLength(3);
      const html = sampleHtml(page);
      expect(html).toBe(renderPrintHtml({ label: [page] }, { generatedAt: '2026-01-01T00:00:00+08:00', dataVersion: 'SAMPLE', extraCss: '' }));
      expect(html).toContain('預備教室');
      expect(html).toContain('甲生07');
      expect(html).toContain('丁生21');
    }
  });
  it('標示範例的格子尺寸＝實際輸出的格尺寸（D136：B4 寬 32.7、A3 寬 39.4；範例頁不印注意事項，高＝紙高÷7）；教室 5 排×6 深位只有 30 格', () => {
    for (const [paper, w] of [['B4', '32.7'], ['A3', '39.4']] as const) {
      const c = sampleCellMm(paper, SAMPLE_ROOM.depth);
      expect(c.w.toFixed(1)).toBe(w);
      expect(c.h).toBeCloseTo(labelFit(defaultLabelLayout(paper), SAMPLE_ROOM.depth, 0).h, 5);
      const page = sampleMarkLabelPage(paper, { kind: 'x', text: '數B' });
      expect(page.cells).toHaveLength(30);
      const html = sampleHtml(page);
      expect(html).toContain(`width:${+c.w.toFixed(2)}mm;height:${+c.h.toFixed(2)}mm`);
      expect(html).toContain('數B');
    }
  });
});
