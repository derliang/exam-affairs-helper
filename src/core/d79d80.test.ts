/** D137（沒有考科的人預設排座，取代 D79 的預設）與 D80（單人特例 purpose 以手動設定為準）的回歸測試 */
import { describe, expect, it } from 'vitest';
import { roomStats, runSeating, seatingVersion, specialOf, type RunSeatingInput } from '../core';
import { dataVersion } from '../core/version';

const base = (): RunSeatingInput => ({
  examId: 'E',
  division: 'junior',
  classes: [{ no: 1, name: 'A', division: 'junior', colorIndex: 0 }],
  classrooms: [
    { id: 'R', name: 'R', kind: 'class', rows: 1, depth: 5, seatCount: 5 },
    { id: 'P', name: 'P', kind: 'reserve', rows: 1, depth: 3, seatCount: 3 },
  ],
  entries: [
    { classNo: 1, seatNo: 1, name: '甲生0101', subjectIds: ['x'] },
    { classNo: 1, seatNo: 2, name: '甲生0102', subjectIds: [] }, // 全科缺考
    { classNo: 1, seatNo: 3, name: '甲生0103', subjectIds: ['x'] },
  ],
  subjects: [{ id: 'x', name: '自然' }],
  markRules: [],
  overrides: [],
  now: '2026-11-08T08:00:00Z',
});

describe('D137（取代 D79 的預設）引擎一律排輸入的每個人，含沒有考科的人', () => {
  it('沒有考科的人也排座、佔座位', () => {
    const r = runSeating(base());
    expect(r.ok && r.result.assignments.map((a) => a.code)).toEqual(['0101', '0102', '0103']);
  });
  it('座位不夠所有人（含沒有考科的人）就報不足；要不要排誰由呼叫端決定（輸入去掉他就夠）', () => {
    const i = base();
    i.classrooms[0]!.seatCount = 2;
    expect(runSeating(i).ok).toBe(false);
    expect(runSeating({ ...i, entries: i.entries.filter((e) => e.subjectIds.length > 0) }).ok).toBe(true);
  });
  it('版本碼：有沒考科的人且排了座＝沿用舊鍵 seatFullyAbsent（舊存檔選「仍排座」的結果不會變過期）；沒有這種人時與舊版相同', () => {
    const none = { ...base(), entries: base().entries.filter((e) => e.subjectIds.length > 0) };
    expect(seatingVersion(base())).not.toBe(seatingVersion(none));
    expect(seatingVersion(none)).toBe(dataVersion({ examId: none.examId, division: none.division, classes: none.classes, classrooms: none.classrooms, entries: none.entries, subjects: none.subjects, markRules: none.markRules, overrides: none.overrides }));
    expect(seatingVersion(base())).toBe(dataVersion({ examId: 'E', division: 'junior', classes: base().classes, classrooms: base().classrooms, entries: base().entries, subjects: base().subjects, markRules: [], overrides: [], seatFullyAbsent: true }));
  });
});

describe('D80 單人特例 purpose 以手動設定為準', () => {
  const withMark = (purpose: 'exam' | 'study'): RunSeatingInput => ({
    ...base(),
    entries: [{ classNo: 1, seatNo: 1, name: '甲生0101', subjectIds: ['x'] }],
    // 標「加考」→ 標示方向是 exam
    markRules: [{ subjectId: 'x', mode: 'mark-extra' }],
    overrides: [{ kind: 'single', code: '0101', location: '教務處', purpose }],
  });
  it('override 說自習、標示方向是加考 → 特例歸類為自習', () => {
    const r = runSeating(withMark('study'));
    expect(r.ok && r.special).toEqual([{ code: '0101', subjectId: 'x', purpose: 'study', location: '教務處' }]);
  });
  it('override 說考試 → 特例歸類為考試', () => {
    const r = runSeating(withMark('exam'));
    expect(r.ok && r.special[0]?.purpose).toBe('exam');
  });
  it('specialOf（存檔還原）與 runSeating 一致', () => {
    for (const p of ['exam', 'study'] as const) {
      const r = runSeating(withMark(p));
      if (!r.ok) throw new Error('x');
      expect(specialOf(r.result)).toEqual(r.special);
    }
  });
  it('統計：自習特例不算「到他處考試」，考試特例才扣本教室人數', () => {
    for (const [p, inRoom] of [['exam', 0], ['study', 1]] as const) {
      const i = withMark(p);
      const r = runSeating(i);
      if (!r.ok) throw new Error('x');
      const s = roomStats('R', r.result.assignments, i.entries, i.subjects, r.result.detaches, specialOf(r.result));
      expect(s.perSubject[0]!.inRoom).toBe(inRoom);
    }
  });
});
