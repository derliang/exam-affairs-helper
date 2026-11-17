/** G36 分科：不考的人（自習）排參考座位；固定自習教室全程不當考場、同人同室同座、去考試的時段座位保留、不足不硬排。全部匿名假資料 */
import { describe, expect, it } from 'vitest';
import { checkPlan, codeOf, type PlanInput } from './contract';
import { planD99 } from './engine';
import { classRoom, grid, makeClass, reserveRoom } from './fixtures';

const slots = [{ id: 's1', subjectIds: ['A'] }, { id: 's2', subjectIds: ['B'] }];
/** 三班各 10 人：甲、乙班兩節都考；丙班座號 1～5 只考第 1 節（第 2 節自習）、6～10 只考第 2 節（第 1 節自習） */
function base(): PlanInput {
  return {
    mode: 'fewest-rooms',
    rooms: [classRoom(1), classRoom(2), classRoom(3), reserveRoom('R1', grid(4, 4)), reserveRoom('R2', grid(4, 4))],
    slots,
    students: [
      ...makeClass(1, 10, () => ({ s1: 'A', s2: 'B' })),
      ...makeClass(2, 10, () => ({ s1: 'A', s2: 'B' })),
      ...makeClass(3, 10, (n) => (n <= 5 ? { s1: 'A' } : { s2: 'B' })),
    ],
  };
}

describe('G36 分科自習參考座位', () => {
  it('固定自習教室：全程不當考場；每人整天只去同一間自習、坐同一個座位；去考試的那節座位保留', () => {
    const input = { ...base(), fixedStudyRooms: ['R1'] };
    const out = planD99(input);
    expect(checkPlan(input, out)).toEqual([]);
    expect(out.exams.some((e) => e.roomId === 'R1')).toBe(false); // 全程不當考場
    const rooms = new Map<string, Set<string>>();
    for (const s of out.study) rooms.set(s.code, (rooms.get(s.code) ?? new Set()).add(s.roomId));
    for (const [code, set] of rooms) expect([...set], code).toEqual(['R1']); // 不換教室
    expect(rooms.size).toBe(10); // 丙班 10 人各有一節自習
    const seats = out.studySeats ?? [];
    expect(new Set(seats.map((x) => x.code)).size).toBe(seats.length); // 一人一座
    expect(new Set(seats.map((x) => `${x.roomId}:${x.row}-${x.depth}`)).size).toBe(seats.length); // 座位不重複
    // 丙班 1～5 號第 2 節自習、第 1 節去考試：座位表上 R1 仍保留他們的座位（考試中）
    for (let n = 1; n <= 5; n++) expect(seats.some((x) => x.code === codeOf({ classNo: 3, seatNo: n }))).toBe(true);
  });
  it('固定教室放不下：不硬排，列為未排入（不會偷偷排到別間）', () => {
    const input: PlanInput = { ...base(), rooms: [classRoom(1), classRoom(2), classRoom(3), reserveRoom('R1', grid(2, 2)), reserveRoom('R2', grid(4, 4))], fixedStudyRooms: ['R1'] };
    const out = planD99(input);
    expect(out.unplaced?.length ?? 0).toBeGreaterThan(0);
    expect((out.studySeats ?? []).length).toBeLessThanOrEqual(4);
    expect(out.study.every((s) => s.roomId === 'R1')).toBe(true);
  });
  it('沒指定固定教室：選教室與考試座位和 fixedStudyRooms=[] 逐位相同，另外多出參考座位（只加不改）', () => {
    const a = planD99(base());
    const b = planD99({ ...base(), fixedStudyRooms: [] });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(checkPlan(base(), a)).toEqual([]);
    for (const s of a.study) expect(a.studySeats?.some((x) => x.roomId === s.roomId && x.code === s.code)).toBe(true); // 每個自習的人在該教室都有座位
    const noSeats = { ...a } as Record<string, unknown>; delete noSeats.studySeats; delete noSeats.studyUnseated;
    expect(noSeats.exams).toEqual(a.exams); // 考試座位沒被動到
  });
  it('參考座位不超過教室座位數、同教室座位不重複（含不指定固定教室）', () => {
    const out = planD99(base());
    const by = new Map<string, number>();
    for (const x of out.studySeats ?? []) by.set(x.roomId, (by.get(x.roomId) ?? 0) + 1);
    for (const [id, n] of by) expect(n).toBeLessThanOrEqual(id.startsWith('R') ? 16 : 49);
    expect(new Set((out.studySeats ?? []).map((x) => `${x.roomId}:${x.row}-${x.depth}`)).size).toBe((out.studySeats ?? []).length);
  });
});
