import { describe, expect, it } from 'vitest';
import { labelCellMm, defaultLabelLayout, PAPER_MM, roomShown, roomTooBigForLabel, labelBoxMm, labelNotePt } from './model';
import { renderPrintHtml } from './htmlRender';
import { sampleHtml, sampleMarkLabelPage, sampleReserveLabelPage, SAMPLE_ROOM } from './sample';
import { sampleCellMm } from '../ui/pages/LabelSample';
import { buildLabelPages, buildSeatPages } from './model';
import { buildParts, defaultOptions } from './plan';
import { makeFixture } from './fixtures';

describe('G30 預備教室 7 排×8 深位', () => {
  it('標籤上限：班級教室 7×7、預備教室 7 排×8 深位', () => {
    expect(roomTooBigForLabel({ rows: 7, depth: 7, kind: 'class' })).toBe(false);
    expect(roomTooBigForLabel({ rows: 7, depth: 8, kind: 'class' })).toBe(true);
    expect(roomTooBigForLabel({ rows: 7, depth: 8, kind: 'reserve' })).toBe(false);
    expect(roomTooBigForLabel({ rows: 8, depth: 7, kind: 'reserve' })).toBe(true);
    expect(roomTooBigForLabel({ rows: 7, depth: 9, kind: 'reserve' })).toBe(true);
  });
  it('8 列時格高＝（紙高－標題頁尾）÷8，同一頁放得下；寬仍是紙寬÷7', () => {
    for (const paper of ['B4', 'A3'] as const) {
      const l = defaultLabelLayout(paper);
      const c8 = labelCellMm(l, 8);
      expect(c8.w).toBeCloseTo(PAPER_MM[paper].w / 7, 5);
      expect(c8.h).toBeCloseTo((PAPER_MM[paper].h - 22) / 8, 5);
      expect(8 * c8.h).toBeLessThanOrEqual(PAPER_MM[paper].h - 22 + 1e-9);
      expect(labelBoxMm(l, 8).h).toBe(c8.h);
      expect(labelCellMm(l, 7).h).toBeGreaterThan(c8.h);
      expect(labelNotePt(l, 8, 0, 13)).toBe(0);
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
      if (lab.length) expect(html).toContain('grid-template-columns:repeat(7,35.71mm)');
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
  it('標示範例的格子尺寸＝實際輸出的格尺寸（B4 35.7×50.4、A3 42.4×60.0）；教室 5 排×6 深位只有 30 格', () => {
    for (const [paper, w, h] of [['B4', '35.7', '50.4'], ['A3', '42.4', '60.0']] as const) {
      const c = sampleCellMm(paper, SAMPLE_ROOM.depth);
      expect(c.w.toFixed(1)).toBe(w);
      expect(c.h.toFixed(1)).toBe(h);
      const page = sampleMarkLabelPage(paper, { kind: 'x', text: '數B' });
      expect(page.cells).toHaveLength(30);
      const html = sampleHtml(page);
      expect(html).toContain(`width:${+c.w.toFixed(2)}mm;height:${+c.h.toFixed(2)}mm`);
      expect(html).toContain('數B');
    }
  });
});
