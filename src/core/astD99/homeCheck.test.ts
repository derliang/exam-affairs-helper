import { describe, expect, it } from 'vitest';
import { computeMetrics, type PlanInput, type PlanMode } from './contract';
import { planD99 } from './engine';
import { classRoom, grid, makeClass, reserveRoom } from './fixtures';
import { homeIssues } from './homeCheck';

const slots = [{ id: 's1', subjectIds: ['phy'] }, { id: 's2', subjectIds: ['chem', 'his'] }];
const students = [1, 2, 3, 4, 5, 6].flatMap((c) =>
  makeClass(c, 22, (n) => ({ ...(c <= 3 && n <= 8 ? { s1: 'phy' } : {}), s2: c <= 3 ? 'chem' : 'his' })),
);
const input = (mode: PlanMode, homes: number[]): PlanInput => ({
  mode, slots, students,
  rooms: [...homes.map((c) => classRoom(c)), reserveRoom('R1', grid(7, 7)), reserveRoom('R2', grid(7, 7)), reserveRoom('R3', grid(7, 7))],
});

describe('#199 原班教室對應', () => {
  it('六班都有原班教室：兩種模式的離開原班人次不同，未被徵用班級的參加者不考時留原班', () => {
    const a = planD99(input('fewest-rooms', [1, 2, 3, 4, 5, 6]));
    const b = planD99(input('least-movement', [1, 2, 3, 4, 5, 6]));
    expect(computeMetrics(input('least-movement', [1, 2, 3, 4, 5, 6]), b).leaveHome).toBeLessThan(computeMetrics(input('fewest-rooms', [1, 2, 3, 4, 5, 6]), a).leaveHome);
    // 時段 s1 只有理組 3 班有人考，文組 4～6 班的班級教室沒被徵用 → 這三班全員留原班
    for (const out of [a, b]) {
      const stu = out.study.filter((s) => s.slotId === 's1' && ['04', '05', '06'].includes(s.code.slice(0, 2)));
      expect(stu.length).toBe(66);
      for (const s of stu) expect(s.roomId).toBe(`C${Number(s.code.slice(0, 2))}`);
    }
  });
  it('原班教室對不上時診斷出哪些班、幾人；對得上不誤報', () => {
    expect(homeIssues(input('fewest-rooms', [1, 2, 3, 4, 5, 6]))).toEqual([]);
    expect(homeIssues(input('fewest-rooms', [1, 2, 3]))).toEqual([
      { classNo: 4, students: 22, kind: 'none', cap: 0 },
      { classNo: 5, students: 22, kind: 'none', cap: 0 },
      { classNo: 6, students: 22, kind: 'none', cap: 0 },
    ]);
    const small = { ...input('fewest-rooms', [1, 2, 3, 4, 5, 6]), rooms: [classRoom(1, grid(7, 7), 10)] };
    expect(homeIssues(small)[0]).toMatchObject({ classNo: 1, kind: 'small', cap: 10 });
  });
});
