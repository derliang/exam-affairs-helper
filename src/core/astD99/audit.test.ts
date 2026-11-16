/** 第三方稽核（#279）回歸測試：全部匿名假資料 */
import { describe, expect, it } from 'vitest';
import { checkPlan, type PlanInput, type PlanStudent } from './contract';
import { planD99 } from './engine';
import { classRoom, grid, makeClass, reserveRoom } from './fixtures';

describe('#279 文理組限制下的候選教室數', () => {
  it('理組 30 人只能進 S、文組 40 人要分 4 間綜合教室（共 5 間）：不可判成無解', () => {
    const sci: PlanStudent[] = makeClass(1, 30, () => ({ s1: 'A' })).map((s) => ({ ...s, track: 'science' as const }));
    const lib: PlanStudent[] = makeClass(2, 40, () => ({ s1: 'A' })).map((s) => ({ ...s, track: 'liberal' as const }));
    const S = { ...classRoom(1, grid(10, 10)), track: 'science' as const };
    const input: PlanInput = {
      mode: 'fewest-rooms',
      rooms: [S, reserveRoom('R1', grid(2, 5)), reserveRoom('R2', grid(2, 5)), reserveRoom('R3', grid(2, 5)), reserveRoom('R4', grid(2, 5))],
      slots: [{ id: 's1', subjectIds: ['A'] }],
      students: [...sci, ...lib],
    };
    for (const mode of ['fewest-rooms', 'least-movement'] as const) {
      const out = planD99({ ...input, mode });
      expect(out.infeasible, mode).toBeFalsy();
      expect(out.exams).toHaveLength(70);
      expect(checkPlan({ ...input, mode }, out)).toEqual([]);
    }
  });
});
