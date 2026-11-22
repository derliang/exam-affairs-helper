/** D177（稿 v2.79 Q2、Q3）：統計表時段欄加「起–訖」小字；沒填時間輸出完全不變；標籤不印時間。全部匿名假資料。 */
import { describe, expect, it } from 'vitest';
import { buildSeatPages, statLayout, statMerge } from './index';
import { textWidthMm } from './model';
import { makeFixture } from './fixtures';

const real = () => JSON.parse(JSON.stringify(makeFixture()).replace(/"zh"/g, '"chinese"').replace(/"en"/g, '"english"').replace(/"ma"/g, '"math"')) as ReturnType<typeof makeFixture>;
const slotCells = (f: ReturnType<typeof real>) => buildSeatPages(f, 'class')[0]!.stats.table.rows.flatMap((r) => (r.foot ? [] : [r.lead![r.lead!.length - 2]!]));

describe('統計表時段欄的「起–訖」（D177）', () => {
  it('沒填時間：時段欄跟以前一模一樣', () => {
    const cells = slotCells(real());
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.every((c) => /^時段[一二三四五六七八九十]$/.test(c))).toBe(true);
  });
  it('填了第一節開始：時段欄多「08:30–09:40」這類小字；同時段仍垂直合併', () => {
    const f = real();
    f.exam.dayTimes = [{ first: '08:30' }, { first: '08:30' }];
    const cells = slotCells(f);
    expect(cells.some((c) => /^時段[一二三四五六七八九十] \d\d:\d\d–\d\d:\d\d$/.test(c))).toBe(true);
    const p = buildSeatPages(f, 'class')[0]!;
    const m = statMerge(p);
    expect(m).toHaveLength(p.stats.table.rows.length);
  });
  it('#640（D214）：有時間時「時段」欄寬放得下整句單行（不拆在 – 後面）；沒填時間欄寬不變', () => {
    const f = real();
    const p0 = buildSeatPages(f, 'class')[0]!;
    const i0 = p0.stats.table.leadHeads!.indexOf('時段');
    expect(statLayout(p0).cols[i0]).toBe(18);
    f.exam.dayTimes = [{ first: '08:30' }, { first: '08:30' }];
    const p = buildSeatPages(f, 'class')[0]!;
    const L = statLayout(p);
    const longest = Math.max(...p.stats.table.rows.map((r) => (r.lead?.[i0] ? textWidthMm(r.lead[i0]!, L.pt, false) : 0)));
    expect(L.cols[i0]!).toBeGreaterThanOrEqual(longest + 4);
    expect(L.cols.reduce((a, b) => a + b, 0)).toBeCloseTo(statLayout(p0).cols.reduce((a, b) => a + b, 0), 0); // 表總寬不變
  });
  it('標籤不印時間（D92、Q3）：座位格與標籤模型沒有開始時間', () => {
    const f = real();
    f.exam.dayTimes = [{ first: '08:30' }];
    const pages = buildSeatPages(f, 'class');
    const cells = JSON.stringify([...pages[0]!.cells.values()]);
    expect(cells).not.toMatch(/\d\d:\d\d/);
  });
});
