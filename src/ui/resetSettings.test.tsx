/** 新學年重置、全部重置（#353、#354；D163、D164）：全部假資料 */
import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import type { Classroom } from '../data';
import { demoDoc } from './repository';
import { fullReset, newYearReset, resetCounts } from './resetSettings';
import { Settings } from './pages/Settings';
import type { Doc } from './store';

function base(): Doc {
  const d = demoDoc();
  const room: Classroom = { id: 'r1', name: '溫', kind: 'class', rows: 5, depth: 8, seatCount: 38, disabled: ['1-1'], rowDepths: [8, 8, 8, 8, 8], noSeat: true };
  const reserve: Classroom = { id: 'r2', name: '預備A', kind: 'reserve', rows: 4, depth: 4, seatCount: 16 };
  return { ...d, settings: { ...d.settings, schoolName: '假學校', features: { quick: true }, classrooms: [room, reserve] }, exams: [{ id: 'e1', name: 'x', kind: 'gsat', division: 'senior', semester: 'first', subjects: [], markRules: [], classroomIds: ['r1'], labelLayout: { paper: 'B4', cols: 6, rows: 8 }, createdAt: '2026-01-01T00:00:00Z' } as Doc['exams'][number]] };
}

describe('新學年重置', () => {
  it('清名單與班級教室座位配置；保留考試、學校、教室清單與預備教室、選用功能', () => {
    const d = base();
    const n = newYearReset(d);
    expect(n.rosters.senior).toEqual([]);
    expect(n.rosters.junior).toEqual([]);
    const r1 = n.settings.classrooms.find((r) => r.id === 'r1')!;
    expect(r1.disabled).toBeUndefined();
    expect(r1.rowDepths).toBeUndefined();
    expect(r1.noSeat).toBeUndefined();
    expect(r1.rows * r1.depth).toBe(r1.seatCount);
    expect(n.settings.classrooms.find((r) => r.id === 'r2')).toEqual(d.settings.classrooms[1]);
    expect(n.exams).toEqual(d.exams);
    expect(n.settings.schoolName).toBe('假學校');
    expect(n.settings.features).toEqual({ quick: true });
  });
});

describe('全部重置', () => {
  it('共用設定回到預設；選用功能、模擬考保留', () => {
    const d = base();
    const n = fullReset(d);
    expect(n.rosters).toEqual({ senior: [], junior: [] });
    expect(n.settings.schoolName).toBe('');
    expect(n.settings.classrooms).toEqual([]);
    expect(n.settings.classes.length).toBeGreaterThan(0);
    expect(n.settings.features).toEqual({ quick: true });
    expect(n.exams).toEqual(d.exams);
  });
  it('計數', () => { const c = resetCounts(base()); expect(c.classRooms).toBe(1); expect(c.rooms).toBe(2); });
});

describe('危險操作區', () => {
  it('共用設定最下方有「危險操作」與兩顆鈕；沒有輸入框（不用打字）', () => {
    const html = renderToString(<Settings doc={base()} onChange={() => undefined} />);
    expect(html).toContain('危險操作');
    expect(html).toContain('新學年重置');
    expect(html).toContain('全部重置');
    expect(html.indexOf('危險操作')).toBeGreaterThan(html.indexOf('utabs'));
  });
});
