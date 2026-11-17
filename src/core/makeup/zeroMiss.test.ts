/**
 * 零遺漏專項測試（規格第十章、D120）：隨機產生多組假名單，排完後
 * ① 每位學生每一科恰有一個考場、一個時段；② 任何刻意拿掉或重複一筆，C-2／C-3 都要抓到。
 * 全部假資料。
 */
import { describe, expect, it } from 'vitest';
import { fakeRoster, fakeSettings, rng, room, runAll, type FakeClass } from './fixtures';
import { buildOutputs, makeupVersion, runMakeupChecks, type MakeupRoom, type MakeupSchedule } from './index';

interface Case {
  seed: number;
  classes: FakeClass[];
  maxSubjects: number;
  notifyOnly: number;
  twoDays: boolean;
}

function randomCase(seed: number): Case {
  const r = rng(seed * 7919 + 13);
  const classes: FakeClass[] = [];
  const size = () => (r() < 0.08 ? 60 : r() < 0.15 ? 1 : 1 + Math.floor(r() * 40)); // 偶爾超大班、偶爾一人班
  const names = ['溫', '良', '恭', '儉'];
  for (const g of [1, 2]) for (let i = 0; i < 2 + Math.floor(r() * 3); i++) classes.push({ oldClass: `高${'一二'[g - 1]}${names[i]}`, students: size() });
  if (r() < 0.6) for (let i = 0; i < 1 + Math.floor(r() * 2); i++) classes.push({ oldClass: `${7 + Math.floor(r() * 2)}0${i + 1}`, students: size() });
  const twoDays = r() < 0.5;
  if (twoDays) classes.push({ oldClass: '高三溫', students: size() });
  return { seed, classes, maxSubjects: r() < 0.2 ? 1 : 2 + Math.floor(r() * 5), notifyOnly: Math.floor(r() * 3), twoDays };
}

function roomsFor(students: number, seed: number): MakeupRoom[] {
  const r = rng(seed);
  // 每 4 組有一組只有小教室（20～30 座），讓大班一定要拆，測拆班也不漏人
  const small = seed % 4 === 0;
  const rooms: MakeupRoom[] = [room(20, 'special'), room(small ? 30 : 42, 'mixed')];
  let seats = small ? 50 : 62;
  while (seats < students * 1.5 + 60) {
    const n = small ? 20 + Math.floor(r() * 11) : 30 + Math.floor(r() * 27); // 20～30 或 30～56 座
    rooms.push(room(n, r() < 0.2 ? 'mixed' : 'class'));
    seats += n;
  }
  return rooms;
}

function build(c: Case) {
  const roster = fakeRoster({ seed: c.seed, classes: c.classes, maxSubjects: c.maxSubjects, notifyOnlyPerClass: c.notifyOnly, notifyExtraRatio: 0.15 });
  const students = new Set(roster.included.map((x) => x.studentId)).size;
  const settings = fakeSettings(roster, roomsFor(students, c.seed));
  if (c.twoDays) {
    settings.days.push({ id: 'D0', label: '1/16（六）' });
    settings.groups = settings.groups.map((g) => (g.grades.includes('S3') ? { ...g, grades: g.grades.filter((x) => x !== 'S3') } : g)).filter((g) => g.grades.length);
    settings.groups.push({ id: 'D0-S3', dayId: 'D0', label: '高三', grades: ['S3'], start: 480, periodMin: 50, breakMin: 10 });
  }
  const all = runAll(roster, settings);
  const currentVersion = makeupVersion(roster, settings, all.plan);
  return { roster, settings, ...all, currentVersion };
}

const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

describe('零遺漏：隨機假名單排完後，每人每科恰一個考場一個時段', () => {
  it.each(SEEDS)('seed %i', (seed) => {
    const c = randomCase(seed);
    const b = build(c);
    expect(b.roster.unresolved).toEqual([]);
    expect(b.schedule.unplaced).toEqual([]);

    // ① 每筆人次恰好出現一次（R-1）
    const seen = new Map<string, number>();
    for (const x of b.schedule.sittings) for (const s of x.subjects) seen.set(`${x.studentId}|${s}`, (seen.get(`${x.studentId}|${s}`) ?? 0) + 1);
    for (const e of b.entries) expect(seen.get(`${e.studentId}|${e.subject}`), `${e.studentId} ${e.subject}`).toBe(1);
    expect([...seen.values()].reduce((a, n) => a + n, 0)).toBe(b.entries.length);

    // ② 同一學生不會同時在兩個地方；每個座位唯一
    const slot = new Map(b.schedule.slots.map((s) => [s.id, s]));
    const per = new Map<string, MakeupSchedule['sittings']>();
    for (const x of b.schedule.sittings) per.set(x.studentId, [...(per.get(x.studentId) ?? []), x]);
    for (const list of per.values()) {
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++) {
          const a = slot.get(list[i]?.slotId as string);
          const d = slot.get(list[j]?.slotId as string);
          if (a && d && a.dayId === d.dayId) expect(a.start < d.end && d.start < a.end).toBe(false);
        }
    }
    const seatKeys = b.schedule.sittings.map((x) => `${x.slotId}|${x.roomId}|${x.seat}`);
    expect(b.schedule.sittings.every((x) => x.seat !== null)).toBe(true);
    expect(new Set(seatKeys).size).toBe(seatKeys.length);

    // ③ 硬規則檢核全綠，閘門只剩琥珀與 C-14
    const cs = runMakeupChecks({ roster: b.roster, settings: b.settings, plan: b.plan, outputs: b.outputs, currentVersion: b.currentVersion });
    for (const c2 of cs.filter((x) => ['C-1', 'C-2', 'C-3', 'C-4', 'C-5', 'C-6', 'C-7', 'C-8', 'C-9', 'C-10'].includes(x.id))) {
      expect(c2.status, `${c2.id} ${c2.summary} ${c2.details.slice(0, 3).map((d) => d.text).join('；')}`).toBe('green');
    }
    expect(cs.find((x) => x.id === 'C-14')?.status).toBe('pending');
  });
});

describe('零遺漏：刻意拿掉或重複任何一筆，C-2／C-3 一定抓到', () => {
  it.each(SEEDS.slice(0, 20))('seed %i', (seed) => {
    const b = build(randomCase(seed));
    const r = rng(seed + 99);
    const run = (s: MakeupSchedule) =>
      runMakeupChecks({ roster: b.roster, settings: b.settings, plan: b.plan, outputs: buildOutputs(s, b.entries, b.settings), currentVersion: b.currentVersion });
    const status = (cs: ReturnType<typeof run>, id: string) => cs.find((x) => x.id === id)?.status;

    for (let k = 0; k < 5; k++) {
      const s = structuredClone(b.schedule);
      const i = Math.floor(r() * s.sittings.length);
      const x = s.sittings[i] as MakeupSchedule['sittings'][number];
      const removed = x.subjects[Math.floor(r() * x.subjects.length)] as string;
      // 拿掉一筆：多科入座只拿掉一科，單科入座整筆拿掉
      if (x.subjects.length > 1) {
        const j = x.subjects.indexOf(removed);
        x.subjects.splice(j, 1);
        x.papers.splice(j, 1);
      } else s.sittings.splice(i, 1);
      const cs = run(s);
      expect(status(cs, 'C-3'), `拿掉 ${x.studentId} ${removed}`).toBe('red');
      expect(cs.find((c) => c.id === 'C-3')?.details.some((d) => d.studentId === x.studentId && d.subject === removed)).toBe(true);
      const stillThere = s.sittings.some((y) => y.studentId === x.studentId);
      if (!stillThere) expect(status(cs, 'C-2'), `整位學生 ${x.studentId} 消失`).toBe('red');
    }

    // 重複一筆
    const s = structuredClone(b.schedule);
    const dup = s.sittings[Math.floor(r() * s.sittings.length)] as MakeupSchedule['sittings'][number];
    s.sittings.push({ ...dup, subjects: [dup.subjects[0] as string], papers: [dup.papers[0] as string], seat: null });
    expect(status(run(s), 'C-3')).toBe('red');
  });
});

describe('零遺漏：隨機案例涵蓋度', () => {
  it('40 組中有提前開考、超大班拆班、混班教室、兩天考日、全單科、另行通知', () => {
    let early = 0, splits = 0, mixed = 0, twoDays = 0, single = 0, notified = 0;
    for (const seed of SEEDS) {
      const c = randomCase(seed);
      const b = build(c);
      early += b.schedule.early.length;
      splits += b.schedule.splits.length;
      mixed += b.schedule.sittings.filter((x) => b.settings.rooms.find((r) => r.id === x.roomId)?.use === 'mixed').length > 0 ? 1 : 0;
      twoDays += c.twoDays ? 1 : 0;
      single += c.maxSubjects === 1 ? 1 : 0;
      notified += b.roster.notified.length;
    }
    expect({ early: early > 0, splits: splits > 0, mixed: mixed > 0, twoDays: twoDays > 0, single: single > 0, notified: notified > 0 }).toEqual({
      early: true, splits: true, mixed: true, twoDays: true, single: true, notified: true,
    });
  });
});

describe('零遺漏：邊界名單', () => {
  it('全為另行通知者（沒有任何要排的人次）：排程為空、C-2 只算另行通知學生、硬規則全綠', () => {
    const roster = fakeRoster({ seed: 5, classes: [{ oldClass: '101', students: 0 }], notifyOnlyPerClass: 4 });
    expect(roster.included).toEqual([]);
    const settings = fakeSettings(roster, [room(30)]);
    const all = runAll(roster, settings);
    expect(all.schedule.sittings).toEqual([]);
    const cs = runMakeupChecks({ roster, settings, plan: all.plan, outputs: all.outputs });
    expect(cs.find((c) => c.id === 'C-2')).toMatchObject({ status: 'green', expected: 4, actual: 4 });
    expect(cs.filter((c) => c.status === 'red')).toEqual([]);
  });

  it('全部單科生、同班同科：每班一間、不拆班', () => {
    const roster = fakeRoster({ seed: 8, classes: [{ oldClass: '101', students: 25 }, { oldClass: '102', students: 25 }], maxSubjects: 1 });
    const settings = fakeSettings(roster, [room(30), room(30), room(30)]);
    const all = runAll(roster, settings);
    expect(all.schedule.unplaced).toEqual([]);
    expect(all.schedule.splits).toEqual([]);
    const cs = runMakeupChecks({ roster, settings, plan: all.plan, outputs: all.outputs });
    expect(cs.find((c) => c.id === 'C-13')?.status).toBe('green');
  });
});
