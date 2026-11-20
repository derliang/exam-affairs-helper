/** K5：對帳快照隨補考場次存檔（規格 6.1）；全部假資料 */
import { describe, expect, it } from 'vitest';
import { describeChange } from '../describeChange';
import { dashboardOf, snapshotOf, withSnapshot } from './dashboard';
import { newMakeupSession, reviveSession } from './session';
import { demoDoc } from '../repository';
import { fakeSession, NOW, rooms } from './testKit';

describe('對帳快照（規格 6.1）', () => {
  const s = { ...fakeSession({ rooms: rooms(6), id: 'mk-snap' }), days: [{ id: 'd1', date: '2027-01-16', start: 480 }] };
  it('快照列出 C-1～C-15，數字與儀表板一致，且只存數字不存學生資料', () => {
    const snap = snapshotOf(s, '2026-11-20T03:00:00.000Z');
    const d = dashboardOf(s);
    expect(snap.rows.map((r) => r.id)).toEqual(d.checks.map((c) => c.id));
    expect(snap.rows).toHaveLength(15);
    expect(snap.version).toBe(d.version);
    expect(snap.gate).toBe(d.state);
    expect(JSON.stringify(snap)).not.toMatch(/studentId|姓名/);
  });
  it('withSnapshot 記到場次上；結果沒變就原樣回傳（不多一筆存檔）', () => {
    const a = withSnapshot(s, '2026-11-20T03:00:00.000Z');
    expect(a.snapshot?.at).toBe('2026-11-20T03:00:00.000Z');
    expect(withSnapshot(a, '2026-11-20T04:00:00.000Z')).toBe(a);
  });
  it('資料變了（少一間教室）快照跟著重記；沒有名單的場次不記', () => {
    const a = withSnapshot(s, '2026-11-20T03:00:00.000Z');
    const b = withSnapshot({ ...a, rooms: rooms(1, 5) }, '2026-11-20T05:00:00.000Z');
    expect(b.snapshot?.at).toBe('2026-11-20T05:00:00.000Z');
    expect(b.snapshot?.gate).toBe('blocked');
    const empty = newMakeupSession({ id: 'mk-empty', name: '', year: 115, semester: 'first', now: NOW });
    expect(withSnapshot(empty)).toBe(empty);
  });
  it('下載前 C-14 是待執行，不假裝綠燈', () => {
    const a = withSnapshot(s, '2026-11-20T03:00:00.000Z');
    expect(a.snapshot!.rows.find((r) => r.id === 'C-14')!.status).toBe('pending');
  });
  it('存檔往返：JSON 轉回來快照還在', () => {
    const a = withSnapshot(s, '2026-11-20T03:00:00.000Z');
    const back = reviveSession(JSON.parse(JSON.stringify(a)));
    expect(back.snapshot).toEqual(a.snapshot);
  });
  it('復原清單的名稱：只有快照變時叫「記錄補考對帳結果」', () => {
    const a = withSnapshot(s, '2026-11-20T03:00:00.000Z');
    const doc = (m: typeof s) => ({ ...demoDoc(), makeups: [m] });
    expect(describeChange(doc(s), doc(a))).toBe('記錄補考對帳結果');
  });
});
