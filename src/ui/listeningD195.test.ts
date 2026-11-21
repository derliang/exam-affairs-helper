/** #549、D67、D195：學測第 1、2 次英聽人人都考——名單沒有英聽欄時，統計與總帳也不得把英聽全算自習。全部假資料。 */
import { describe, expect, it } from 'vitest';
import { examEntries } from './seating';
import { defaultSubjects } from './subjects';
import type { Doc } from './store';

const mk = (round: number, entries: { classNo: number; seatNo: number; name: string; subjectIds: string[] }[]) => {
  const exam = { id: 'e1', kind: 'gsat', round, division: 'senior', subjects: defaultSubjects('gsat', round) };
  const doc = { examFiles: { e1: { entries } }, settings: {}, exams: [exam] } as unknown as Doc;
  return { doc, exam: exam as never };
};
const ppl = [
  { classNo: 301, seatNo: 1, name: '甲', subjectIds: ['chinese', 'english', 'math', 'science'] },
  { classNo: 301, seatNo: 2, name: '乙', subjectIds: [] },
];
describe('英聽人人都考（D67、D195）', () => {
  it('第 1 次：有考科的人補上英聽；全科缺考者不補', () => {
    const { doc, exam } = mk(1, ppl);
    const e = examEntries(doc, exam);
    expect(e[0]!.subjectIds).toContain('en-listen');
    expect(e[1]!.subjectIds).toEqual([]);
  });
  it('第 3 次沒有英聽：名單不變', () => {
    const { doc, exam } = mk(3, ppl);
    expect(examEntries(doc, exam)[0]!.subjectIds).not.toContain('en-listen');
  });
});
