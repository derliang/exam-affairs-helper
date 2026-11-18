/** 領卷統計與全科缺考（D79；文案稽核 42-27 核實）：不論排不排座，全科缺考者都不計入領卷份數 */
import { describe, expect, it } from 'vitest';
import { pickupCounts, runSeating, type RunSeatingInput } from '../core';

// 全部是假資料：1 班 4 人，座號 2 全科缺考
const base = (): RunSeatingInput => ({
  examId: 'E',
  division: 'junior',
  classes: [{ no: 1, name: 'A', division: 'junior', colorIndex: 0 }],
  classrooms: [{ id: 'R', name: 'R', kind: 'class', rows: 1, depth: 6, seatCount: 6 }],
  entries: [
    { classNo: 1, seatNo: 1, name: '甲生0101', subjectIds: ['x', 'y'] },
    { classNo: 1, seatNo: 2, name: '甲生0102', subjectIds: [] },
    { classNo: 1, seatNo: 3, name: '甲生0103', subjectIds: ['x'] },
    { classNo: 1, seatNo: 4, name: '甲生0104', subjectIds: ['x', 'y'] },
  ],
  subjects: [{ id: 'x', name: '自然' }, { id: 'y', name: '社會' }],
  markRules: [],
  overrides: [],
  now: '2026-11-14T08:00:00Z',
});

const counts = (i: RunSeatingInput) => {
  const r = runSeating(i);
  if (!r.ok) throw new Error(r.errors.join());
  const room = pickupCounts({ rooms: i.classrooms, assignments: r.result.assignments, entries: i.entries, subjects: i.subjects, detaches: r.result.detaches, special: r.special });
  return { room: room[0]!, seated: r.result.assignments.length };
};

describe('領卷統計排除全科缺考者（D79 份數規則；排座預設改 D137）', () => {
  it('選「不排座」（學測）：份數只含有考該科的人', () => {
    const b = base();
    const { room, seated } = counts({ ...b, entries: b.entries.filter((e) => e.subjectIds.length > 0) });
    expect(seated).toBe(3);
    expect(room.subjects.map((s) => [s.subjectId, s.count])).toEqual([['x', 3], ['y', 2]]);
    expect(room.total).toBe(5);
  });
  it('預設排座（D137）：全科缺考者佔座位，但領卷份數仍不計他', () => {
    const { room, seated } = counts(base());
    expect(seated).toBe(4);
    expect(room.subjects.map((s) => [s.subjectId, s.count])).toEqual([['x', 3], ['y', 2]]);
    expect(room.total).toBe(5);
  });
});
