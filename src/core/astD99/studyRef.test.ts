/**
 * G36 分科：不考的人（自習）排參考座位；固定自習教室全程不當考場、同人同室、不足不硬排。
 * WP-2（D141）：參考座位每個時段各自排（不再全日固定、不保留去考試的人的座位）；自習教室自動「盡量同一間」。
 * 全部匿名假資料。
 */
import { describe, expect, it } from 'vitest';
import { checkPlan, codeOf, type PlanInput, type PlanOutput } from './contract';
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

/** 每個時段：參考座位＝這節在該間自習的人，一人一座、座位不重複，不含去考試的人 */
function expectSeatsPerSlot(out: PlanOutput): void {
  const seats = out.studySeats ?? [];
  for (const s of slots) {
    const here = out.study.filter((x) => x.slotId === s.id);
    const mine = seats.filter((x) => x.slotId === s.id);
    const unseated = (out.studyUnseated ?? []).filter((x) => x.slotId === s.id);
    expect(mine.length + unseated.length, s.id).toBe(here.length);
    for (const x of mine) expect(here.some((h) => h.code === x.code && h.roomId === x.roomId), `${s.id} ${x.code}`).toBe(true);
    expect(new Set(mine.map((x) => x.code)).size).toBe(mine.length);
    expect(new Set(mine.map((x) => `${x.roomId}:${x.row}-${x.depth}`)).size).toBe(mine.length);
  }
}

describe('G36 分科自習參考座位', () => {
  it('固定自習教室：全程不當考場；每人整天只去同一間自習；座位每節各自排，不保留去考試的人的座位（WP-2）', () => {
    const input = { ...base(), fixedStudyRooms: ['R1'] };
    const out = planD99(input);
    expect(checkPlan(input, out)).toEqual([]);
    expect(out.exams.some((e) => e.roomId === 'R1')).toBe(false); // 全程不當考場
    const rooms = new Map<string, Set<string>>();
    for (const s of out.study) rooms.set(s.code, (rooms.get(s.code) ?? new Set()).add(s.roomId));
    for (const [code, set] of rooms) expect([...set], code).toEqual(['R1']); // 不換教室
    expect(rooms.size).toBe(10); // 丙班 10 人各有一節自習
    expectSeatsPerSlot(out);
    // 丙班 1～5 號第 1 節去考試：第 1 節的參考座位沒有他們（不再保留「考試中」座位）
    const s1 = (out.studySeats ?? []).filter((x) => x.slotId === 's1').map((x) => x.code);
    for (let n = 1; n <= 5; n++) expect(s1).not.toContain(codeOf({ classNo: 3, seatNo: n }));
  });
  it('固定教室放不下：不硬排，列為未排入（不會偷偷排到別間）', () => {
    const input: PlanInput = { ...base(), rooms: [classRoom(1), classRoom(2), classRoom(3), reserveRoom('R1', grid(2, 2)), reserveRoom('R2', grid(4, 4))], fixedStudyRooms: ['R1'] };
    const out = planD99(input);
    expect(out.unplaced?.length ?? 0).toBeGreaterThan(0);
    for (const s of slots) expect((out.studySeats ?? []).filter((x) => x.slotId === s.id).length).toBeLessThanOrEqual(4);
    expect(out.study.every((s) => s.roomId === 'R1')).toBe(true);
  });
  it('沒指定固定教室：選教室與考試座位和 fixedStudyRooms=[] 逐位相同，另外多出參考座位（只加不改）', () => {
    const a = planD99(base());
    const b = planD99({ ...base(), fixedStudyRooms: [] });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(checkPlan(base(), a)).toEqual([]);
    for (const s of a.study) expect(a.studySeats?.some((x) => x.slotId === s.slotId && x.roomId === s.roomId && x.code === s.code)).toBe(true); // 每個自習的人該節在該教室都有座位
    const noSeats = { ...a } as Record<string, unknown>; delete noSeats.studySeats; delete noSeats.studyUnseated;
    expect(noSeats.exams).toEqual(a.exams); // 考試座位沒被動到
  });
  it('參考座位不超過教室座位數、同一節同教室座位不重複（含不指定固定教室）', () => {
    const out = planD99(base());
    for (const s of slots) {
      const by = new Map<string, number>();
      for (const x of (out.studySeats ?? []).filter((y) => y.slotId === s.id)) by.set(x.roomId, (by.get(x.roomId) ?? 0) + 1);
      for (const [id, n] of by) expect(n).toBeLessThanOrEqual(id.startsWith('R') ? 16 : 49);
    }
    expectSeatsPerSlot(out);
  });
});

describe('WP-2 分科自習「盡量同一地點」（D141）', () => {
  /**
   * 甲、乙班沒有自己的教室（自習一律去綜合教室 R1、R2，各 6 座）；考場是沒有學生的第 9 班教室。
   * 第 1 節自習：甲 1～5、乙 1（6 人，R1 剛好坐滿）。
   * 第 2 節自習：甲 3～8、乙 1（7 人）。舊排法依班級座號切片：甲 3～8 坐滿 R1，乙 1 被擠到 R2（換教室）。
   */
  function sticky(): PlanInput {
    const takes = (cls: number) => (n: number) => ({
      s1: (cls === 1 && n <= 5) || (cls === 2 && n === 1) ? undefined : 'A',
      s2: (cls === 1 && n >= 3 && n <= 8) || (cls === 2 && n === 1) ? undefined : 'B',
    });
    return {
      mode: 'fewest-rooms',
      rooms: [classRoom(9), reserveRoom('R1', grid(2, 3)), reserveRoom('R2', grid(2, 3))],
      slots,
      students: [...makeClass(1, 10, takes(1)), ...makeClass(2, 10, takes(2))],
    };
  }
  it('前一節已在 R1 自習的人，下一節 R1 還有空位就留在 R1；每間人數不變、對帳無誤', () => {
    const input = sticky();
    const out = planD99(input);
    expect(checkPlan(input, out)).toEqual([]);
    const at = (slot: string, code: string) => out.study.find((x) => x.slotId === slot && x.code === code)?.roomId;
    const b1 = codeOf({ classNo: 2, seatNo: 1 });
    expect(at('s1', b1)).toBe('R1');
    expect(at('s2', b1)).toBe('R1'); // 不換教室
    for (let n = 3; n <= 5; n++) expect(at('s2', codeOf({ classNo: 1, seatNo: n }))).toBe('R1');
    // 每間人數照第一階段：R1 6 人、R2 1 人
    const count = (slot: string, room: string) => out.study.filter((x) => x.slotId === slot && x.roomId === room).length;
    expect([count('s2', 'R1'), count('s2', 'R2')]).toEqual([6, 1]);
    expect(out.metrics?.studyMoves).toBe(0); // 沒有人換自習教室（去 R2 的甲 8 第 1 節不自習）
  });
  it('同班盡量同處：沒有前一節教室的人，去同班同學最多的那間', () => {
    const out = planD99(sticky());
    const s2 = out.study.filter((x) => x.slotId === 's2');
    const r2 = s2.filter((x) => x.roomId === 'R2').map((x) => x.code);
    expect(r2).toEqual([codeOf({ classNo: 1, seatNo: 8 })]); // 乙班留在 R1，甲班最後一人去 R2
  });
});
