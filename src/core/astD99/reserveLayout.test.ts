/** #258 綜合教室座位平均分配：最少深位（預設）／最少排數。匿名假資料。 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { checkPlan, type PlanInput } from './contract';
import { balanceRows } from '../../data/helpers';
import { planD99 } from './engine';
import { classRoom, grid, makeClass, reserveRoom } from './fixtures';

const PHY = { s1: 'phy' };
const slots = [{ id: 's1', subjectIds: ['phy'] }];
/** 1 班 17 人考物理、班級教室只有 1 座：17 人全進綜合教室（7 排 × 7 深位），正是 #258 的案例 */
const input = (layout?: 'min-depth' | 'min-rows', n = 17): PlanInput => ({
  mode: 'fewest-rooms',
  rooms: [classRoom(1, grid(1, 1)), reserveRoom('R1', grid(7, 7))],
  slots,
  students: makeClass(1, n, () => PHY),
  ...(layout ? { reserveLayout: layout } : {}),
});
const inRoom = (i: PlanInput, room: string) => planD99(i).exams.filter((e) => e.roomId === room);
const byRow = (xs: { row: number }[]) => {
  const m = new Map<number, number>();
  for (const x of xs) m.set(x.row, (m.get(x.row) ?? 0) + 1);
  return m;
};

describe('balanceRows（#258）', () => {
  const rows = Array.from({ length: 7 }, (_, i) => ({ row: i + 1, depths: [1, 2, 3, 4, 5, 6, 7] }));
  it('17 人、7 排 → 3,3,3,2,2,2,2（各排差不超過 1、深位 3）', () => {
    expect(balanceRows(rows, 17).map((r) => r.depths.length)).toEqual([3, 3, 3, 2, 2, 2, 2]);
  });
  it('人數少於排數：每排至多 1 人、不排的排整排拿掉', () => {
    expect(balanceRows(rows, 4).map((r) => r.row)).toEqual([1, 2, 3, 4]);
  });
  it('排的容量不同：受限的排不超過自己的深位數', () => {
    const r = balanceRows([{ row: 1, depths: [1] }, { row: 2, depths: [1, 2, 3, 4] }], 4);
    expect(r.map((x) => x.depths.length)).toEqual([1, 3]);
  });
});

describe('綜合教室排法（#258）', () => {
  it('預設最少深位：17 人進綜合教室，7 排各 2～3 人、深位最多 3、各排人數差不超過 1、不超過上限', () => {
    const i = input(undefined, 17);
    expect(checkPlan(i, planD99(i))).toEqual([]);
    const xs = inRoom(i, 'R1');
    expect(xs.length).toBe(17);
    const counts = [...byRow(xs).values()];
    expect(byRow(xs).size).toBe(7);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    expect(Math.max(...xs.map((x) => x.depth))).toBeLessThanOrEqual(3);
    expect(xs.every((x) => x.row <= 7 && x.depth <= 7)).toBe(true);
  });
  it('最少排數：沿用舊排法（一排排滿再下一排），與預設不同', () => {
    const xs = inRoom(input('min-rows'), 'R1');
    expect(byRow(xs).size).toBe(3);
    expect(Math.max(...xs.map((x) => x.depth))).toBe(7);
    expect(JSON.stringify(inRoom(input('min-rows'), 'R1'))).not.toBe(JSON.stringify(inRoom(input(), 'R1')));
  });
  it('明說 min-depth 與不設相同', () => {
    expect(JSON.stringify(planD99(input('min-depth')))).toBe(JSON.stringify(planD99(input())));
  });
  it('沒有綜合教室的情境輸出不受影響（兩種設定逐位一致）', () => {
    const base: PlanInput = { mode: 'fewest-rooms', rooms: [classRoom(1, grid(5, 8)), classRoom(2, grid(5, 8))], slots, students: [...makeClass(1, 30, () => PHY), ...makeClass(2, 30, () => PHY)] };
    const h = (i: PlanInput) => createHash('sha256').update(JSON.stringify(planD99(i))).digest('hex');
    expect(h({ ...base, reserveLayout: 'min-rows' })).toBe(h(base));
  });
});
