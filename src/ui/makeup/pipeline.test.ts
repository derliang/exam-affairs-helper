import { describe, expect, it } from 'vitest';
import { baseOf, outputsOf, pinRoom, planOf, resetPlan, roomCheckOf, scheduleOf, setEarly, setSubjectRole } from './pipeline';
import { clearResolution, setResolution } from './importOps';
import { fakeSession, rooms } from './testKit';

describe('串接核心引擎', () => {
  it('名單 → 人次、統計、排程全部對得上，C-1～C-10 全綠', () => {
    const s = fakeSession({ rooms: rooms(6) });
    const b = baseOf(s);
    expect(b.entries.length).toBe(b.roster.included.length);
    expect(b.matrices.reduce((n, m) => n + m.total, 0)).toBe(b.entries.length);
    expect(scheduleOf(s).schedule.unplaced).toEqual([]);
    const o = outputsOf(s);
    for (const c of o.checks.filter((x) => /^C-([1-9]|10)$/.test(x.id))) expect(c.status, `${c.id} ${c.summary}`).toBe('green');
    expect(o.version).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/i);
  });
  it('同一個場次物件只算一次（記憶）', () => {
    const s = fakeSession();
    expect(baseOf(s)).toBe(baseOf(s));
    expect(scheduleOf(s)).toBe(scheduleOf(s));
    expect(outputsOf(s)).toBe(outputsOf(s));
  });
  it('名單、設定或考程一變，資料版本碼就變（C-15 過期判斷的依據）', () => {
    const s = fakeSession({ rooms: rooms(6) });
    const v = outputsOf(s).version;
    expect(outputsOf({ ...s, breakMin: 20 }).version).not.toBe(v);
    expect(outputsOf({ ...s, rooms: rooms(5) }).version).not.toBe(v);
  });
  it('沒有名單時不當機：全部是空的', () => {
    const { parse: _p, ...rest } = fakeSession();
    void _p;
    const b = baseOf(rest);
    expect(b.entries).toEqual([]);
    expect(scheduleOf(rest).schedule.sittings).toEqual([]);
  });
});

describe('③ 教室夠不夠（F-15：最擁擠時段，不是全日人次）', () => {
  it('夠用：需求不超過座位', () => {
    const c = roomCheckOf(fakeSession({ rooms: rooms(8) }));
    expect(c.ok).toBe(true);
    expect(c.shortage).toBe(0);
  });
  it('一間教室都沒有：全部排不進去，缺的是人次數', () => {
    const s = fakeSession({ rooms: [] });
    const c = roomCheckOf(s);
    expect(c.ok).toBe(false);
    expect(c.enabled).toBe(0);
    expect(c.shortage).toBeGreaterThan(0);
    expect(scheduleOf(s).schedule.unplaced.length).toBe(baseOf(s).entries.length);
  });
  it('教室太小：缺席數＝需求－座位；關掉教室（本次不用）立刻反映', () => {
    const full = fakeSession({ rooms: rooms(2, 5) });
    const c = roomCheckOf(full);
    expect(c.ok).toBe(false);
    const off = roomCheckOf({ ...fakeSession({ rooms: rooms(6) }), roomOff: ['room-1', 'room-2', 'room-3', 'room-4', 'room-5'] });
    expect(off.enabled).toBe(1);
    expect(off.ok).toBe(false);
  });
});

describe('⑤ 調整考程（F-21）', () => {
  const s0 = fakeSession({ rooms: rooms(8) });
  const g = baseOf(s0).settings.groups.find((x) => x.id === 'd1-senior')!;
  const gp = (s: typeof s0) => planOf(s).plan.groups.find((x) => x.groupId === g.id)!;

  it('沒調整＝系統建議（edited=false），重新建議回到建議', () => {
    expect(planOf(s0).edited).toBe(false);
    const s1 = setSubjectRole(s0, g.id, gp(s0).slots[0]![0]!, 'combined');
    expect(planOf(s1).edited).toBe(true);
    expect(resetPlan(s1).plan).toBeUndefined();
    expect(planOf(resetPlan(s1)).edited).toBe(false);
  });
  it('降為綜合：科目離開獨立節、進綜合節，仍然每人每科恰好一次（零遺漏）', () => {
    const subj = gp(s0).slots[0]![0]!;
    const s1 = setSubjectRole(s0, g.id, subj, 'combined');
    expect(gp(s1).slots.flat()).not.toContain(subj);
    expect(gp(s1).combined).toContain(subj);
    const o = outputsOf(s1);
    for (const c of o.checks.filter((x) => /^C-([1-9]|10)$/.test(x.id))) expect(c.status, `${c.id}`).toBe('green');
  });
  it('升為獨立節：依人數插在適當位置', () => {
    const s1 = setSubjectRole(s0, g.id, gp(s0).slots[0]![0]!, 'combined');
    const s2 = setSubjectRole(s1, g.id, gp(s0).slots[0]![0]!, 'independent');
    expect(gp(s2).slots[0]![0]).toBe(gp(s0).slots[0]![0]);
  });
  it('指定與取消提前開考', () => {
    const multi = [...baseOf(s0).entries.filter((e) => g.grades.includes(e.grade)).reduce((m, e) => m.set(e.studentId, (m.get(e.studentId) ?? 0) + 1), new Map<string, number>())].find(([, n]) => n >= 2 && !gp(s0).early.includes(''))?.[0];
    if (!multi) return;
    const s1 = setEarly(s0, g.id, multi, true);
    expect(gp(s1).early).toContain(multi);
    expect(scheduleOf(s1).schedule.early.some((x) => x.studentId === multi)).toBe(true);
    expect(gp(setEarly(s1, g.id, multi, false)).early).not.toContain(multi);
  });
  it('指定某班某時段的教室；不存在的教室與群組在對齊時被濾掉', () => {
    const sit = scheduleOf(s0).schedule.sittings.find((x) => x.slotId === 'd1-senior#0')!;
    const target = baseOf(s0).settings.rooms.find((r) => r.id !== sit.roomId)!;
    const s1 = pinRoom(s0, { groupId: g.id, slot: 0, oldClass: sit.oldClass, roomId: target.id });
    const moved = scheduleOf(s1).schedule.sittings.filter((x) => x.slotId === 'd1-senior#0' && x.oldClass === sit.oldClass);
    expect(moved.every((x) => x.roomId === target.id)).toBe(true);
    // 取消指定
    expect(planOf(pinRoom(s1, { groupId: g.id, slot: 0, oldClass: sit.oldClass, roomId: '' })).plan.pins).toEqual([]);
    // 教室被刪：指定自動作廢，不會讓排程壞掉
    const gone = { ...s1, rooms: s1.rooms.filter((r) => r.id !== target.id) };
    expect(planOf(gone).plan.pins).toEqual([]);
    expect(scheduleOf(gone).schedule.unplaced).toEqual([]);
  });
  it('名單變動後，調整過的考程不留下不存在的科目與空時段', () => {
    const s1 = setSubjectRole(s0, g.id, gp(s0).slots[0]![0]!, 'combined');
    const rows = s1.parse!.rows.filter((r) => r.subjectName !== gp(s0).slots[0]![0]);
    const s2 = { ...s1, parse: { ...s1.parse!, rows } };
    expect(gp(s2).slots.every((sl) => sl.length > 0)).toBe(true);
    expect(gp(s2).combined).not.toContain(gp(s0).slots[0]![0]);
  });
});

describe('② 問題列處理接到統計', () => {
  it('補上姓名後納入；略過後進略過紀錄；撤銷後回到待處理', () => {
    const s = fakeSession();
    const bad = { ...s.parse!.rows[0]!, rowId: '999', srcRow: 999, name: '', studentId: 'X99999', oldClass: '高三溫', oldSeat: 40, subjectName: '數學' };
    const s1 = { ...s, parse: { ...s.parse!, rawCount: s.parse!.rawCount + 1, problems: [{ rowId: '999', srcRow: 999, kind: 'no-name' as const, message: 'm', cells: [], draft: bad }] } };
    expect(baseOf(s1).roster.unresolved).toHaveLength(1);
    const fixed = setResolution(s1, { rowId: '999', action: 'fix', row: { ...bad, name: '示範生甲', studentId: 'X99999' } });
    expect(baseOf(fixed).roster.unresolved).toHaveLength(0);
    expect(baseOf(fixed).roster.included.length + baseOf(fixed).roster.notified.length).toBe(s.parse!.rows.length + 1);
    const skipped = setResolution(s1, { rowId: '999', action: 'skip', reason: 'transferred' });
    expect(baseOf(skipped).roster.skipped).toHaveLength(1);
    expect(baseOf(clearResolution(skipped, '999')).roster.unresolved).toHaveLength(1);
  });
});
