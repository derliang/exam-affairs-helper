import { describe, expect, it } from 'vitest';
import { codeOf, type PlanInput, type PlanMode, type PlanOutput } from './contract';
import { classRoom, grid, makeClass, reserveRoom } from './fixtures';
import { countHardLimits } from './hardLimits';

const code = (classNo: number, seatNo: number) => codeOf({ classNo, seatNo });
const exam = (roomId: string, c: string, row: number) => ({ slotId: 'S1', roomId, code: c, row, depth: 1, subjectId: 'math' });
const study = (roomId: string, c: string) => ({ slotId: 'S1', roomId, code: c });

function input(mode: PlanMode): PlanInput {
  return {
    mode,
    rooms: [classRoom(1, grid(3, 3)), classRoom(2, grid(3, 3)), reserveRoom('R', grid(3, 3))],
    slots: [{ id: 'S1', subjectIds: ['math'] }],
    students: [...makeClass(1, 3), ...makeClass(2, 3)],
  };
}
const out = (exams: object[], st: object[]) => ({ exams, study: st }) as unknown as PlanOutput;

describe('countHardLimits（#659，D221）', () => {
  it('home-exam：本班同學在原班教室標 X，與本班考生同室不算違規', () => {
    const o = out([exam('C1', code(1, 1), 1)], [study('C1', code(1, 2)), study('C1', code(1, 3))]);
    expect(countHardLimits(input('home-exam'), o).both).toBe(0);
  });
  it('其他模式：同教室考試又自習仍判違規', () => {
    const o = out([exam('C1', code(1, 1), 1)], [study('C1', code(1, 2))]);
    expect(countHardLimits(input('fewest-rooms'), o).both).toBe(1);
    expect(countHardLimits(input('least-movement'), o).both).toBe(1);
  });
  it('home-exam：他班同學的自習混進考場仍判違規', () => {
    const o = out([exam('C1', code(1, 1), 1)], [study('C1', code(2, 1))]);
    expect(countHardLimits(input('home-exam'), o).both).toBe(1);
  });
  it('home-exam：綜合教室考試又自習仍判違規', () => {
    const o = out([exam('R', code(1, 1), 1)], [study('R', code(1, 2))]);
    expect(countHardLimits(input('home-exam'), o).both).toBe(1);
  });
  it('座位與自習容量超量照舊計算', () => {
    const i = input('home-exam');
    const o = out(Array.from({ length: 10 }, (_, k) => exam('C1', code(1, 1), k)), []);
    expect(countHardLimits(i, o).seatOver).toBe(1);
  });
});
