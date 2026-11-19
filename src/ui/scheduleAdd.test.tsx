/** 節次設定：每天新增考科、把這一天的考科全部移到第 1 天、結束時間自動算（#365、#389；D164 G） */
import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import { addRow, defaultSchedule, numberRows } from '../core/periods';
import { demoDoc } from './repository';
import { endTimeOf, moveDayToFirst, ScheduleTab } from './pages/Schedule';

describe('每天新增考科', () => {
  it('新增後那一天多一科', () => {
    const t = addRow(defaultSchedule('ast'), 1, '自訂科');
    expect(t.days[1]![t.days[1]!.length - 1]!.name).toBe('自訂科');
  });
  it('把第 2 天全部移到第 1 天：第 2 天保留成空天、順序接在第 1 天最後', () => {
    const t0 = defaultSchedule('g12');
    const n1 = t0.days[0]!.length; const n2 = t0.days[1]!.length;
    const t = moveDayToFirst(t0, 1);
    expect(t.days).toHaveLength(2);
    expect(t.days[1]).toEqual([]);
    expect(t.days[0]).toHaveLength(n1 + n2);
    expect(numberRows(t).length).toBe(n1 + n2);
    expect(moveDayToFirst(t, 1)).toBe(t); // 空天再按不動
  });
  it('結束時間由開始時間與時長自動算', () => {
    expect(endTimeOf('08:40', 80)).toBe('10:00');
    expect(endTimeOf('23:30', 60)).toBe('00:30');
    expect(endTimeOf(undefined, 80)).toBe('');
    expect(endTimeOf('08:40', undefined)).toBe('');
  });
  it('畫面：每天表尾有「＋ 新增考科」；第 2 天有「全部移到第 1 天」，第 1 天沒有', () => {
    const html = renderToString(<ScheduleTab doc={demoDoc()} onChange={() => undefined} />);
    expect(html.match(/＋ 新增考科/g)!.length).toBeGreaterThanOrEqual(2);
    expect(html.match(/全部移到第 1 天/g)!.length).toBe(1);
  });
});
