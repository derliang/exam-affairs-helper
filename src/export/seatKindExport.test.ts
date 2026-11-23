import { describe, expect, it } from 'vitest';
import { makeFixture } from './fixtures';
import { buildLabelPages, buildSeatPages, renderPrintHtml } from './index';
import { SEAT_KINDS } from '../core/seatKind';

/** 2026-11-23：座位表與標籤的底色＝文理組＋加考科目；班級代表色不再出現；標籤底色與座位表一致；座位表有圖例 */
function input() {
  const f = makeFixture();
  f.exam.subjects = [{ id: 'chinese', name: '國文' }, { id: 'math-a', name: '數學A' }, { id: 'math-b', name: '數學B' }, { id: 'social', name: '社會' }, { id: 'science', name: '自然' }];
  f.entries = f.entries.map((e) => ({ ...e, subjectIds: ['chinese'] }));
  f.result.marks = [
    { code: '0101', subjectId: 'math-b', mode: 'extra' }, // 理組加數B
    { code: '0103', subjectId: 'social', mode: 'extra' }, // 理組加社會
    { code: '0103', subjectId: 'math-b', mode: 'extra' }, // 理組兩科都加
    { code: '0201', subjectId: 'math-a', mode: 'extra' }, // 文組加數A
    { code: '0102', subjectId: 'social', mode: 'absent' }, // 不考：不上色
  ];
  f.result.detaches = [];
  f.result.overrides = [];
  return f;
}

describe('底色依文理組與加考（座位表與標籤一致）', () => {
  it('座位表格子底色、標籤格子底色相同，一般考生白底', () => {
    const f = input();
    const seat = buildSeatPages(f).flatMap((p) => (p.kind === 'seat' ? [...p.cells.values()] : []));
    const label = buildLabelPages(f).flatMap((p) => (p.kind === 'label' ? p.cells : []));
    const bgOf = (cells: { code: string; colorBg: string }[], code: string) => cells.find((c) => c.code === code)?.colorBg;
    expect(bgOf(seat, '0101')).toBe(SEAT_KINDS['sci-b'].bg);
    expect(bgOf(seat, '0103')).toBe(SEAT_KINDS['sci-both'].bg);
    expect(bgOf(seat, '0201')).toBe(SEAT_KINDS['lib-a'].bg);
    expect(bgOf(seat, '0102')).toBe('FFFFFF'); // 不考、沒加考
    expect(bgOf(seat, '0104')).toBe('FFFFFF');
    for (const code of ['0101', '0103', '0201', '0102', '0104']) expect(bgOf(label, code)).toBe(bgOf(seat, code));
  });
  it('座位表有圖例（只列出現的底色），沒有加考時不印圖例', () => {
    const lg = buildSeatPages(input()).flatMap((p) => (p.kind === 'seat' && p.legend ? [p.legend.map((l) => l.label)] : []));
    expect(lg.length).toBeGreaterThan(0);
    expect(lg[0]).toContain('理組加考數B');
    expect(lg[0]).toContain('理組加考數B＋社會');
    expect(lg.flat().join('')).not.toContain('文組加考自然');
    const plain = makeFixture();
    plain.result.marks = [];
    expect(buildSeatPages(plain).some((p) => p.kind === 'seat' && p.legend)).toBe(false);
  });
  it('輸出 HTML 不再出現班級色與淺黃，圖例進得了列印頁', () => {
    const f = input();
    const h = renderPrintHtml({ seat: buildSeatPages(f), label: buildLabelPages(f) }, { generatedAt: '2026-11-08T08:30:00Z', dataVersion: 'A1B2C3D4' });
    expect(h).not.toMatch(/#FFE08A|#FBE7C6|#D8EFD3|#D6E6F8/);
    expect(h).toContain('pp-legend');
    expect(h).toContain(`background:#${SEAT_KINDS['sci-b'].bg}`);
  });
});
