/** 考試日期進座位表標題（#392、#389；D164 H）：有填日期寫「第 N 天 M/D（週）」，沒填只寫第幾天；標籤不加新日期。全部假資料。 */
import { describe, expect, it } from 'vitest';
import { buildLabelPages, buildSeatPages, buildStudyLists } from './index';
import { makeFixture } from './fixtures';

const real = () => JSON.parse(JSON.stringify(makeFixture()).replace(/"zh"/g, '"chinese"').replace(/"en"/g, '"english"').replace(/"ma"/g, '"math"')) as ReturnType<typeof makeFixture>;

describe('座位表標題的日期', () => {
  it('填了兩天日期：座位表標題帶日期與星期', () => {
    const f = real();
    f.exam = { ...f.exam, examDates: ['2026-12-14', '2026-12-15'] };
    expect(buildSeatPages(f, 'class')[0]!.dateText).toBe('第 1 天 12/14（一）～第 2 天 12/15（二）');
  });
  it('只填第 1 天：第 2 天只寫第幾天；都沒填：不出現 0/0 之類占位', () => {
    const f = real();
    f.exam = { ...f.exam, examDates: ['2026-12-14'] };
    expect(buildSeatPages(f, 'class')[0]!.dateText).toBe('第 1 天 12/14（一）～第 2 天');
    f.exam = { ...f.exam };
    delete f.exam.examDates;
    const t = buildSeatPages(f, 'class')[0]!.dateText ?? '';
    expect(t).toBe('第 1 天～第 2 天');
    expect(t).not.toMatch(/0\/0/);
  });
  it('標籤不加新日期（維持 D147④ 只寫第幾天）', () => {
    const f = real();
    f.exam = { ...f.exam, examDates: ['2026-12-14', '2026-12-15'] };
    expect(buildLabelPages(f, 'class')[0]!.dateText).toBe('第 1 天～第 2 天');
  });
  it('#389：抽離自習名單副標與預備教室座位表的天別帶日期；沒填日期維持原寫法', () => {
    const f = real();
    const sub = (x: ReturnType<typeof real>) => buildStudyLists(x).map((p) => p.subtitle ?? '').join('|');
    const before = sub(f);
    f.exam = { ...f.exam, examDates: ['2026-12-14', '2026-12-15'] };
    const after = sub(f);
    if (/第.天/.test(before)) expect(after).toMatch(/第.天 12\/1[45]（[一二]）/);
    delete f.exam.examDates;
    expect(sub(f)).toBe(before);
  });
});
