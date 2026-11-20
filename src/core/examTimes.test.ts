import { describe, expect, it } from 'vitest';
import type { PeriodTable } from '../data';
import { hasBlockingTimeIssue, rangeText, setBreak, setFirst, setManual, slotRange, slotTimes, timeIssues } from './examTimes';

const T: PeriodTable = { days: [
  [{ name: '國綜', minutes: 70 }, { name: '數學A', minutes: 100 }, { name: '英文', minutes: 100 }, { name: '英聽', minutes: 30, samePrev: true }],
  [{ name: '物理', minutes: 70 }, { name: '化學', minutes: 70 }],
] };

describe('每場考試各自的各節時間（D177）', () => {
  it('沒設定：沒有時間；共用表有填就沿用', () => {
    expect(slotTimes(T, undefined).every((t) => t.source === 'none' && !t.start)).toBe(true);
    const shared: PeriodTable = { days: [[{ name: '國綜', minutes: 70, start: '08:00' }]] };
    expect(slotTimes(shared)[0]).toMatchObject({ start: '08:00', end: '09:10', source: 'shared' });
  });
  it('方案 B：填第一節＋休息，後面自動接；同節多科結束取最晚', () => {
    const dt = setFirst(undefined, 0, '08:30');
    const ts = slotTimes(T, dt).filter((t) => t.day === 0);
    expect(ts.map((t) => rangeText(t))).toEqual(['08:30–09:40', '09:50–11:30', '11:40–13:20']);
    expect(slotRange(T, setBreak(dt, 0, 20), 0, 2)).toBe('10:00–11:40');
  });
  it('手動覆寫某時段，後面接在它後面；取消後回到自動', () => {
    let dt = setFirst(undefined, 0, '08:30');
    dt = setManual(dt, 0, 3, '13:00');
    expect(slotRange(T, dt, 0, 3)).toBe('13:00–14:40');
    expect(slotTimes(T, dt).find((t) => t.slot === 3)?.source).toBe('manual');
    expect(setManual(dt, 0, 3, '')![0]!.manual).toBeUndefined();
  });
  it('只存填過的：全部清空回 undefined', () => {
    expect(setFirst(setFirst(undefined, 1, '09:00'), 1, '')).toBeUndefined();
    expect(setBreak(undefined, 0, 10)).toBeUndefined();
  });
  it('防呆：重疊、格式、太晚（只提醒）、跨午夜', () => {
    const ov = setManual(setFirst(undefined, 0, '08:30'), 0, 2, '09:30');
    expect(timeIssues(T, ov).map((i) => i.kind)).toContain('overlap');
    expect(hasBlockingTimeIssue(timeIssues(T, ov))).toBe(true);
    expect(timeIssues(T, [{ first: '8點半' }]).map((i) => i.kind)).toContain('format');
    const late = timeIssues(T, [{ first: '16:00' }]);
    expect(late.map((i) => i.kind)).toContain('late');
    expect(hasBlockingTimeIssue(late.filter((i) => i.kind === 'late'))).toBe(false);
    expect(timeIssues(T, [{ first: '22:30' }]).map((i) => i.kind)).toContain('overnight');
    expect(timeIssues(T, setFirst(undefined, 0, '08:30'))).toEqual([]);
  });
});
