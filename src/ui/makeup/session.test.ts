import { describe, expect, it } from 'vitest';
import { demoDoc } from '../repository';
import { fakeSession, NOW, rooms } from './testKit';
import type { MakeupSession } from './session';
import { addDay,addMakeup, carrySourceOf, defaultMakeupName, deleteMakeup, findMakeup, makeupsOf, newMakeupId, newMakeupSession, removeDay, reviveSession, schoolYearOf, semesterOf, settingIssues, settingsOf, updateMakeup } from './session';

describe('補考場次：建立與沿用（F-1、F-6）', () => {
  it('學年度與學期依日期推算（8 月起新學年）', () => {
    expect(schoolYearOf(new Date('2026-11-17T00:00:00'))).toBe(115);
    expect(schoolYearOf(new Date('2027-01-10T00:00:00'))).toBe(115);
    expect(schoolYearOf(new Date('2026-08-01T00:00:00'))).toBe(115);
    expect(semesterOf(new Date('2027-03-01T00:00:00'))).toBe('second');
    expect(semesterOf(new Date('2026-11-17T00:00:00'))).toBe('first');
    expect(defaultMakeupName(115, 'first')).toBe('115 學年第一學期補考');
  });
  it('新場次預設：高中 50、初中 45、休息 10、8:00、座位表開標籤關；所有年級在考日 1', () => {
    const s = newMakeupSession({ id: 'a', name: '', year: 115, semester: 'first', now: NOW });
    expect(s.periodMin).toEqual({ senior: 50, junior: 45 });
    expect(s.breakMin).toBe(10);
    expect(s.days).toEqual([{ id: 'd1', date: '', start: 480 }]);
    expect(Object.values(s.gradeDay).every((d) => d === 'd1')).toBe(true);
    expect(s.options).toEqual({ seatChart: true, labels: false });
    expect(s.name).toBe('115 學年第一學期補考');
  });
  it('沿用上一次：帶教室與時長，不帶日期、考日對應與名單', () => {
    const prev = { ...fakeSession(), periodMin: { senior: 40, junior: 35 }, breakMin: 15, days: [{ id: 'd1', date: '2026-12-01', start: 540 }, { id: 'd2', date: '2026-12-02', start: 540 }] };
    const s = newMakeupSession({ id: 'b', name: 'x', year: 115, semester: 'second', now: NOW, prev });
    expect(s.rooms).toEqual(prev.rooms);
    expect(s.rooms).not.toBe(prev.rooms); // 深拷貝，改這邊不影響上次
    expect(s.periodMin).toEqual({ senior: 40, junior: 35 });
    expect(s.breakMin).toBe(15);
    expect(s.carriedFrom).toBe('mk-test');
    expect(s.days).toEqual([{ id: 'd1', date: '', start: 480 }]);
    expect(s.parse).toBeUndefined();
    expect(s.resolutions).toEqual([]);
  });
  it('沿用來源是最近建立、有教室的場次；場次代碼不重複', () => {
    const a = { ...fakeSession({ id: 'a' }), createdAt: '2026-01-01T00:00:00Z' };
    const b = { ...fakeSession({ id: 'b' }), createdAt: '2026-02-01T00:00:00Z' };
    const c = { ...fakeSession({ id: 'c', rooms: [] }), createdAt: '2026-03-01T00:00:00Z' };
    const d = [a, b, c].reduce(addMakeup, demoDoc());
    expect(carrySourceOf(d)?.id).toBe('b');
    expect(newMakeupId(['mk-x'], NOW)).toMatch(/^mk-/);
    expect(newMakeupId([newMakeupId([], NOW)], NOW)).toMatch(/-2$/);
  });
});

describe('補考場次：Doc 上的變更', () => {
  it('新增、更新（modifiedAt 跟著動）、刪除；沒變就回原 Doc', () => {
    const s = fakeSession();
    const d1 = addMakeup(demoDoc(), s);
    expect(makeupsOf(d1)).toHaveLength(1);
    const later = new Date('2026-11-21T00:00:00Z');
    const d2 = updateMakeup(d1, s.id, (x) => ({ ...x, name: '新名' }), later);
    expect(findMakeup(d2, s.id)?.name).toBe('新名');
    expect(findMakeup(d2, s.id)?.modifiedAt).toBe(later.toISOString());
    expect(updateMakeup(d2, s.id, (x) => x)).toBe(d2);
    expect(updateMakeup(d2, 'nope', (x) => ({ ...x, name: 'z' }))).toBe(d2);
    expect(makeupsOf(deleteMakeup(d2, s.id))).toHaveLength(0);
  });
});

describe('補考場次：設定 → 核心引擎的設定', () => {
  it('每個考日、每個部別一個群組；時長與開始時間照設定；只含本次使用的教室', () => {
    let s = fakeSession({ rooms: rooms(3) });
    s = { ...s, days: [{ id: 'd1', date: '2027-01-16', start: 480 }, { id: 'd2', date: '2027-01-23', start: 540 }], gradeDay: { S3: 'd1', J3: 'd1', S1: 'd2', S2: 'd2', J1: 'd2', J2: 'd2' }, roomOff: ['room-2'], periodMin: { senior: 40, junior: 30 } };
    const st = settingsOf(s);
    expect(st.days.map((d) => d.label)).toEqual(['1/16（六）', '1/23（六）']);
    expect(st.groups.map((g) => [g.id, g.label, g.grades.join('')])).toEqual([
      ['d1-senior', '高三', 'S3'], ['d1-junior', '初三', 'J3'], ['d2-senior', '高一、高二', 'S1S2'], ['d2-junior', '初一、初二', 'J1J2'],
    ]);
    expect(st.groups.find((g) => g.id === 'd2-senior')).toMatchObject({ start: 540, periodMin: 40, breakMin: 10 });
    expect(st.groups.find((g) => g.id === 'd1-junior')).toMatchObject({ start: 480, periodMin: 30 });
    expect(st.rooms.map((r) => r.id)).toEqual(['room-1', 'room-3']);
  });
  it('新增、移除考日：移除時這天的年級改回第一天，且作廢調整過的考程', () => {
    let s: MakeupSession = { ...fakeSession(), plan: { groups: [], pins: [] } };
    s = addDay(s);
    expect(s.days.map((d) => d.id)).toEqual(['d1', 'd2']);
    s = { ...s, gradeDay: { ...s.gradeDay, S3: 'd2' } };
    const r = removeDay(s, 'd2');
    expect(r.days).toHaveLength(1);
    expect(r.gradeDay.S3).toBe('d1');
    expect(r.plan).toBeUndefined();
    expect(removeDay(r, 'd1')).toBe(r); // 至少留一個考日
  });
});

describe('① 設定檢查（稿 S-2 的兩種錯誤）', () => {
  it('日期已過、沒填日期、年級沒指定考日', () => {
    let s = fakeSession();
    s = { ...s, days: [{ id: 'd1', date: '2026-09-12', start: 480 }, { id: 'd2', date: '', start: 480 }], gradeDay: { S1: 'd1' } };
    const is = settingIssues(s, '2026-11-20', ['S1', 'S2']);
    expect(is.map((i) => i.kind).sort()).toEqual(['day-empty', 'day-past', 'grade-unassigned']);
    expect(is.find((i) => i.kind === 'grade-unassigned')?.text).toContain('高二還沒有指定考日');
  });
  it('設好就沒有問題', () => {
    const s = { ...fakeSession(), days: [{ id: 'd1', date: '2026-12-01', start: 480 }] };
    expect(settingIssues(s, '2026-11-20', ['S1', 'J1'])).toEqual([]);
  });
});

describe('讀檔還原', () => {
  it('JSON 來回之後問題列草稿的 NaN 會變 null，要補回 NaN', () => {
    const s = fakeSession();
    const p = { ...s.parse!, problems: [{ rowId: 'x', srcRow: 9, kind: 'bad-class' as const, message: 'm', cells: [], draft: { ...s.parse!.rows[0]!, oldSeat: Number.NaN } }] };
    const back = reviveSession(JSON.parse(JSON.stringify({ ...s, parse: p })));
    expect(Number.isNaN(back.parse!.problems[0]!.draft.oldSeat)).toBe(true);
  });
});
