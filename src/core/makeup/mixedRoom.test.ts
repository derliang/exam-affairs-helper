/** D180（U-4）：混班教室由系統自動挑；D135⑥：補考沒有自習，同一間教室不會同時有人考試與自習。全部假資料。 */
import { describe, expect, it } from 'vitest';
import { HEADER, fakeRow, fakeSettings, room, runAll } from './fixtures';
import { mixedRoomsOf, parseMakeupSheet, resolveMakeup } from './index';

const roster = () => {
  const rows: string[][] = [HEADER];
  for (let i = 1; i <= 20; i++) rows.push(fakeRow(`9001${String(i).padStart(2, '0')}`, '101', i, '數學'));
  for (let i = 1; i <= 15; i++) rows.push(fakeRow(`9002${String(i).padStart(2, '0')}`, '102', i, '數學'));
  for (let i = 1; i <= 8; i++) rows.push(fakeRow(`9003${String(i).padStart(2, '0')}`, '103', i, '數學'));
  return resolveMakeup(parseMakeupSheet(rows));
};

describe('U-4 系統自動挑混班教室', () => {
  const rooms = () => [room(30, 'class', '甲'), room(30, 'class', '乙')];
  it('沒有任何教室被標成混班：兩個班湊進同一間，不拆班、全部排進', () => {
    const settings = fakeSettings(roster(), rooms());
    expect(settings.rooms.every((r) => r.use !== 'mixed')).toBe(true);
    const out = runAll(roster(), settings).schedule;
    expect(out.unplaced).toEqual([]);
    expect(out.splits).toEqual([]);
    expect(out.sittings).toHaveLength(43);
    const mixed = mixedRoomsOf(out, settings.rooms);
    expect(mixed).toHaveLength(1);
    expect(mixed[0]!.classes).toHaveLength(2);
  });
  it('舊存檔標成 mixed 的教室行為與一般教室相同（結果一樣）', () => {
    const a = fakeSettings(roster(), [room(30, 'class', '甲'), room(30, 'class', '乙')]);
    const b = fakeSettings(roster(), [room(30, 'class', '甲'), room(30, 'mixed', '乙')]);
    const sig = (s: typeof a) => runAll(roster(), s).schedule.sittings.map((x) => `${x.studentId}@${s.rooms.findIndex((r) => r.id === x.roomId)}`).join();
    expect(sig(b)).toBe(sig(a));
  });
  it('D135⑥：補考沒有自習生，每個有人的考場每位在座者都有考試科目；特別教室不算混班', () => {
    const settings = fakeSettings(roster(), [...rooms(), room(10, 'special', '特')]);
    const out = runAll(roster(), settings).schedule;
    for (const s of out.sittings) expect(s.subjects.length).toBeGreaterThan(0);
    const special = settings.rooms.find((r) => r.use === 'special')!;
    expect(mixedRoomsOf(out, settings.rooms).some((m) => m.roomId === special.id)).toBe(false);
  });
});
