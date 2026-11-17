import { describe, expect, it } from 'vitest';
import { HEADER, fakeRow, fakeSettings, room, runAll } from './fixtures';
import {
  buildOutputs,
  buildSchedule,
  fmtTime,
  makeupEntries,
  parseMakeupSheet,
  peakLoad,
  resolveMakeup,
  runMakeupChecks,
  suggestPlan,
  type MakeupRoster,
} from './index';

/** 假名單：101 班 14 人數學、102 班 12 人數學＋英文、少數人國文；701 初中 5 人數學 */
function sample(): MakeupRoster {
  const rows: string[][] = [HEADER];
  let id = 0;
  const add = (cls: string, seat: number, subs: string[]) => {
    const sid = `9${String(++id).padStart(5, '0')}`;
    for (const s of subs) rows.push(fakeRow(sid, cls, seat, s));
  };
  for (let i = 1; i <= 14; i++) add('101', i, ['數學']);
  for (let i = 1; i <= 12; i++) add('102', i, i <= 10 ? ['數學', '英文'] : ['英文', '國文']);
  add('102', 20, ['數學', '英文', '化學', '國文']); // 4 科 200 分 > 150 → 建議提前開考
  for (let i = 1; i <= 5; i++) add('701', i, ['數學']);
  return resolveMakeup(parseMakeupSheet(rows));
}

describe('節次建議（F-20、D115）', () => {
  const roster = sample();
  const settings = fakeSettings(roster, [room(30), room(30), room(40, 'mixed'), room(10, 'special')]);
  const entries = makeupEntries(roster);
  const plan = suggestPlan(entries, settings);

  it('人數多的科目獨立成節，小科併綜合；多科生超過門檻建議提前開考', () => {
    const senior = plan.groups.find((g) => g.groupId === 'D1-senior');
    expect(senior?.early).toEqual(['900027']);
    expect(senior?.slots).toEqual([['數學'], ['英文']]); // 數學 24、英文 12 ≥ 10
    expect(senior?.combined).toEqual(['國文', '化學']);
    const junior = plan.groups.find((g) => g.groupId === 'D1-junior');
    expect(junior?.slots).toEqual([]); // 5 人不到門檻 → 只有綜合節
  });

  it('時間：高中 50 分、初中 45 分、休息 10 分；最後一節是綜合節（與最後獨立科同時段）', () => {
    const s = buildSchedule(entries, settings, plan);
    const senior = s.slots.filter((x) => x.groupId === 'D1-senior' && x.kind !== 'early');
    expect(senior.map((x) => [x.kind, fmtTime(x.start), fmtTime(x.end), x.subjects])).toEqual([
      ['independent', '08:00', '08:50', ['數學']],
      ['final', '09:00', '09:50', ['英文', '國文']],
    ]);
    const junior = s.slots.filter((x) => x.groupId === 'D1-junior');
    expect(junior.map((x) => [x.kind, fmtTime(x.start), fmtTime(x.end)])).toEqual([['final', '08:00', '08:45']]);
  });

  it('提前開考：特別教室、群組開始就考；最早離場＝他各科在全校最後一場結束（化學只有他考 → 自己考完）', () => {
    const s = buildSchedule(entries, settings, plan);
    const early = s.slots.find((x) => x.kind === 'early');
    expect(early?.start).toBe(8 * 60);
    expect(s.early).toHaveLength(1);
    expect(s.early[0]).toMatchObject({ studentId: '900027', groupId: 'D1-senior', totalMin: 200, leaveAt: 9 * 60 + 50 });
    expect([...(s.early[0]?.subjects ?? [])].sort()).toEqual(['化學', '國文', '數學', '英文'].sort());
    const sit = s.sittings.find((x) => x.studentId === '900027');
    expect(settings.rooms.find((r) => r.id === sit?.roomId)?.use).toBe('special');
    expect(sit?.leaveAt).toBe(9 * 60 + 50);
    const out = buildOutputs(s, entries, settings);
    expect(out.rollCalls.find((r) => r.kind === 'early')?.rows[0]?.note).toBe('09:50 前不得離場');
  });

  it('同班同科同室；座位依班級座號順序（D119）', () => {
    const s = buildSchedule(entries, settings, plan);
    const math = s.sittings.filter((x) => x.slotId === 'D1-senior#0');
    const byClass = new Map<string, Set<string>>();
    for (const x of math) byClass.set(x.oldClass, (byClass.get(x.oldClass) ?? new Set()).add(x.roomId));
    for (const set of byClass.values()) expect(set.size).toBe(1);
    const r1 = math.filter((x) => x.roomId === math[0]?.roomId);
    const key = (x: { oldClass: string; oldSeat: number }) => `${x.oldClass}-${String(x.oldSeat).padStart(2, '0')}`;
    expect(r1.map(key)).toEqual([...r1.map(key)].sort());
    expect(new Set(r1.map((x) => x.oldClass)).size).toBe(2); // 101、102 同一間（同班不拆）
    expect(r1[0]?.seat).toBe('1-1');
  });

  it('單多科同室（D118）：綜合節同班的單科生與多科生在同一間', () => {
    const s = buildSchedule(entries, settings, plan);
    const fin = s.sittings.filter((x) => x.slotId === 'D1-senior#1' && x.oldClass === '102');
    expect(new Set(fin.map((x) => x.roomId)).size).toBe(1);
    expect(fin.some((x) => x.subjects.length === 2)).toBe(true);
    expect(fin.some((x) => x.subjects.length === 1)).toBe(true);
  });
});

describe('教室分配（R-9、R-10、D116、F-15）', () => {
  it('放不下整班時整班搬混班教室，不拆班', () => {
    const rows: string[][] = [HEADER];
    for (let i = 1; i <= 20; i++) rows.push(fakeRow(`9001${String(i).padStart(2, '0')}`, '101', i, '數學'));
    for (let i = 1; i <= 15; i++) rows.push(fakeRow(`9002${String(i).padStart(2, '0')}`, '102', i, '數學'));
    const roster = resolveMakeup(parseMakeupSheet(rows));
    const cls = room(30, 'class', '高一溫室');
    const mixed = room(40, 'mixed', '綜合教室一');
    const settings = fakeSettings(roster, [cls, mixed]);
    const { schedule } = runAll(roster, settings);
    expect(schedule.splits).toEqual([]);
    const where = (c: string) => new Set(schedule.sittings.filter((x) => x.oldClass === c).map((x) => x.roomId));
    expect([...where('101')]).toEqual([cls.id]);
    expect([...where('102')]).toEqual([mixed.id]);
  });

  it('超大班（大於任何教室）才拆，記在 splits，C-13 琥珀', () => {
    const rows: string[][] = [HEADER];
    for (let i = 1; i <= 50; i++) rows.push(fakeRow(`9003${String(i).padStart(2, '0')}`, '101', i, '數學'));
    const roster = resolveMakeup(parseMakeupSheet(rows));
    const settings = fakeSettings(roster, [room(30), room(30, 'mixed')]);
    const all = runAll(roster, settings);
    expect(all.schedule.unplaced).toEqual([]);
    expect(all.schedule.splits).toHaveLength(1);
    const checks = runMakeupChecks({ roster, settings, plan: all.plan, outputs: all.outputs });
    expect(checks.find((c) => c.id === 'C-13')?.status).toBe('amber');
    expect(checks.filter((c) => c.status === 'red')).toEqual([]);
  });

  it('座位剛好坐滿（邊界）不算超額；少一席就排不進去並紅燈', () => {
    const rows: string[][] = [HEADER];
    for (let i = 1; i <= 30; i++) rows.push(fakeRow(`9004${String(i).padStart(2, '0')}`, '101', i, '數學'));
    const roster = resolveMakeup(parseMakeupSheet(rows));
    const ok = runAll(roster, fakeSettings(roster, [room(30)]));
    expect(ok.schedule.unplaced).toEqual([]);
    const tight = fakeSettings(roster, [room(29)]);
    const bad = runAll(roster, tight);
    expect(bad.schedule.unplaced).toHaveLength(1);
    const checks = runMakeupChecks({ roster, settings: tight, plan: bad.plan, outputs: bad.outputs });
    expect(checks.find((c) => c.id === 'C-2')?.status).toBe('red');
    expect(checks.find((c) => c.id === 'C-3')?.status).toBe('red');
  });

  it('同考日高中、初中時間重疊時，同一間教室不會同時給兩組', () => {
    const rows: string[][] = [HEADER];
    for (let i = 1; i <= 10; i++) rows.push(fakeRow(`9005${String(i).padStart(2, '0')}`, '101', i, '數學'));
    for (let i = 1; i <= 10; i++) rows.push(fakeRow(`9006${String(i).padStart(2, '0')}`, '701', i, '數學'));
    const roster = resolveMakeup(parseMakeupSheet(rows));
    const settings = fakeSettings(roster, [room(40), room(40)]);
    const { schedule } = runAll(roster, settings);
    const rs = (c: string) => new Set(schedule.sittings.filter((x) => x.oldClass === c).map((x) => x.roomId));
    expect([...rs('101')][0]).not.toBe([...rs('701')][0]);
  });

  it('F-15：最擁擠時段同時在考人數與座位比較（座位每時段重複使用）', () => {
    const roster = sample();
    const settings = fakeSettings(roster, [room(30), room(30), room(40, 'mixed'), room(10, 'special')]);
    const { schedule } = runAll(roster, settings);
    const [p] = peakLoad(schedule, settings);
    // 08:00：高中數學 24（提前開考那位不算在內）＋提前開考 1＋初中 5
    expect(p).toMatchObject({ dayId: 'D1', at: 480, peak: 24 + 1 + 5, seats: 110, ok: true });
  });

  it('RoomPin：使用者指定某班的考場', () => {
    const roster = sample();
    const rooms = [room(30), room(30), room(40, 'mixed'), room(10, 'special')];
    const settings = fakeSettings(roster, rooms);
    const entries = makeupEntries(roster);
    const plan = { ...suggestPlan(entries, settings), pins: [{ groupId: 'D1-senior', slot: 0, oldClass: '101', roomId: rooms[2]?.id as string }] };
    const s = buildSchedule(entries, settings, plan);
    expect(new Set(s.sittings.filter((x) => x.slotId === 'D1-senior#0' && x.oldClass === '101').map((x) => x.roomId))).toEqual(new Set([rooms[2]?.id]));
  });

  it('年級沒有指定考日 → unplaced，C-2／C-3 紅燈', () => {
    const roster = sample();
    const settings = fakeSettings(roster, [room(40), room(40), room(10, 'special')]);
    settings.groups = settings.groups.filter((g) => g.id !== 'D1-junior');
    const all = runAll(roster, settings);
    expect(all.schedule.unplaced.map((u) => u.reason)).toContain('初一沒有指定考日與時間');
    const checks = runMakeupChecks({ roster, settings, plan: all.plan, outputs: all.outputs });
    expect(checks.find((c) => c.id === 'C-3')?.status).toBe('red');
  });

  it('多考日：高三另一天，各自從 08:00 開始', () => {
    const rows: string[][] = [HEADER, fakeRow('900701', '101', 1, '數學'), fakeRow('900702', '301', 1, '數學')];
    const roster = resolveMakeup(parseMakeupSheet(rows));
    const settings = fakeSettings(roster, [room(40)]);
    settings.days.push({ id: 'D0', label: '1/16（六）' });
    settings.groups = [
      { id: 'G12', dayId: 'D1', label: '高一二', grades: ['S1', 'S2'], start: 480, periodMin: 50, breakMin: 10 },
      { id: 'G3', dayId: 'D0', label: '高三', grades: ['S3'], start: 480, periodMin: 50, breakMin: 10 },
    ];
    const all = runAll(roster, settings);
    expect(all.schedule.unplaced).toEqual([]);
    expect(all.schedule.slots.map((s) => [s.dayId, s.start])).toEqual([
      ['D1', 480],
      ['D0', 480],
    ]);
    const checks = runMakeupChecks({ roster, settings, plan: all.plan, outputs: all.outputs });
    expect(checks.filter((c) => c.status === 'red')).toEqual([]);
  });
});
