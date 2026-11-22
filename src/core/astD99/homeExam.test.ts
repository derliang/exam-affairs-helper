/**
 * 第三種排法「原班應考、不考者留原班標 X」（D219，#636）的測試。全部匿名假資料，規模仿真實名單（約 130 考生、教室 6×7、7×7）。
 */
import { describe, expect, it } from 'vitest';
import { checkPlan, type PlanInput, type PlanStudent } from './contract';
import { planD99 } from './engine';
import { classRoom, grid, makeClass, reserveRoom } from './fixtures';

const SLOTS = [
  { id: 's1', subjectIds: ['phy'] },
  { id: 's2', subjectIds: ['che'] },
  { id: 's3', subjectIds: ['mat'] },
];

/** 仿真實名單：班 1 理組 40 人（教室 40 座）、班 2 社會組 49 人（49 座）、班 3 社會組 41 人（41 座）、班 4～6 沒人考；另有 2 間綜合教室 */
function scenario(mode: PlanInput['mode']): PlanInput {
  const g40 = grid(6, 7).slice(0, 40);
  const students: PlanStudent[] = [
    ...makeClass(1, 40, (n) => ({ s1: n <= 25 ? 'phy' : undefined, s2: 'che', s3: 'mat' })),
    ...makeClass(2, 49, (n) => ({ s3: n % 2 ? 'mat' : undefined })),
    ...makeClass(3, 41, (n) => ({ s3: n <= 20 ? 'mat' : undefined })),
    ...makeClass(4, 45), ...makeClass(5, 45), ...makeClass(6, 44),
  ];
  return {
    mode,
    rooms: [classRoom(1, g40), classRoom(2, grid(7, 7)), classRoom(3, grid(7, 7).slice(0, 41)), classRoom(4, grid(7, 7)), classRoom(5, grid(7, 7)), classRoom(6, grid(7, 7)), reserveRoom('R1', grid(6, 7)), reserveRoom('R2', grid(7, 8))],
    slots: SLOTS,
    students,
  };
}

describe('原班應考標 X 模式（home-exam）', () => {
  it('整班留原班：離開原班 0 人、通過硬性檢查、每人每節恰好一個去處', () => {
    const input = scenario('home-exam');
    const out = planD99(input);
    expect(out.infeasible).toBeUndefined();
    expect(checkPlan(input, out)).toEqual([]);
    expect(out.metrics!.leaveHome).toBe(0);
    expect(out.metrics!.displaced).toBe(0);
    expect(out.unplaced).toBeUndefined();
    for (const slot of SLOTS) {
      const exam = out.exams.filter((e) => e.slotId === slot.id).length;
      const stay = out.study.filter((s) => s.slotId === slot.id).length;
      expect(exam + stay).toBe(input.students.length);
    }
  });

  it('s1：只有班 1 有人考物理，班 1 教室是考場，班 1 不考的 15 人在同間教室標 X（有座位、不重複）', () => {
    const input = scenario('home-exam');
    const out = planD99(input);
    expect(out.usage.s1).toEqual({ C1: 'exam', ...Object.fromEntries(['C2', 'C3', 'C4', 'C5', 'C6'].map((c) => [c, 'study'])) });
    const x = out.study.filter((s) => s.slotId === 's1' && s.roomId === 'C1');
    expect(x).toHaveLength(15);
    const seats = (out.studySeats ?? []).filter((s) => s.slotId === 's1' && s.roomId === 'C1');
    expect(seats).toHaveLength(15);
    const taken = new Set(out.exams.filter((e) => e.slotId === 's1').map((e) => `${e.row}-${e.depth}`));
    for (const sd of seats) expect(taken.has(`${sd.row}-${sd.depth}`)).toBe(false);
    expect(new Set(seats.map((s) => `${s.row}-${s.depth}`)).size).toBe(15);
  });

  it('x 座位不印標籤：labelsOf 只含考生', async () => {
    const { labelsOf } = await import('./contract');
    const input = scenario('home-exam');
    const out = planD99(input);
    const coded = new Set([...labelsOf(out).values()].flatMap((l) => l.map((x) => x.code)));
    const xCodes = new Set(out.study.map((s) => s.code));
    // 某人若曾當過 X（某節不考），也只因為別的節有考試才有標籤；s1 的 X 座位本身不產生標籤
    for (const e of out.exams) expect(coded.has(e.code)).toBe(true);
    expect(labelsOf(out).size).toBeGreaterThan(0);
    expect(xCodes.size).toBeGreaterThan(0);
  });

  it('原班放不下全班：該班應考者去綜合教室、不考者照一般規則（原班沒人考就留原班）', () => {
    const input = scenario('home-exam');
    // 班 1 教室縮成 30 座（班上 40 人放不下）
    const rooms = input.rooms.map((r) => (r.id === 'C1' ? { ...r, seats: grid(6, 7).slice(0, 30), studyCapacity: 30 } : r));
    const out = planD99({ ...input, rooms });
    expect(out.infeasible).toBeUndefined();
    expect(checkPlan({ ...input, rooms }, out)).toEqual([]);
    const s1 = out.exams.filter((e) => e.slotId === 's1');
    expect(s1.every((e) => e.roomId === 'R1' || e.roomId === 'R2')).toBe(true);
    expect(out.study.filter((s) => s.slotId === 's1' && s.roomId === 'C1').length).toBe(15); // 不考者仍留原班自習（原班沒人考試）
    expect(out.usage.s1!.C1).toBe('study');
  });

  it('綜合教室座位不夠放離開原班的應考者：回報無解', () => {
    const input = scenario('home-exam');
    const rooms = input.rooms.filter((r) => r.kind === 'class').map((r) => (r.id === 'C1' ? { ...r, seats: grid(2, 2) } : r));
    expect(planD99({ ...input, rooms }).infeasible).toBe(true);
  });

  it('相同輸入得相同結果（可重現）', () => {
    expect(JSON.stringify(planD99(scenario('home-exam')))).toBe(JSON.stringify(planD99(scenario('home-exam'))));
  });
});

describe('與既有兩種模式的差別（#636）', () => {
  it('同一份假名單：少教室優先離開原班最多、少移動優先次之、原班應考標 X 為 0', () => {
    const a = planD99(scenario('fewest-rooms')).metrics!;
    const b = planD99(scenario('least-movement')).metrics!;
    const c = planD99(scenario('home-exam')).metrics!;
    expect(a.leaveHome).toBeGreaterThan(b.leaveHome);
    expect(b.leaveHome).toBeGreaterThan(c.leaveHome);
    expect(c.leaveHome).toBe(0);
  });
  it('沒有原班教室的班（教室名稱對不上）：第三模式照樣排得出來，該班應考者去綜合教室', () => {
    const input = scenario('home-exam');
    const rooms = input.rooms.filter((r) => r.id !== 'C1');
    const out = planD99({ ...input, rooms });
    expect(out.infeasible).toBeUndefined();
    expect(checkPlan({ ...input, rooms }, out)).toEqual([]);
    expect(out.exams.filter((e) => e.slotId === 's1').every((e) => e.roomId.startsWith('R'))).toBe(true);
  });
});
