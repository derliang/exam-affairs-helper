/** 依考日對帳與跨考日重複（U-8、D184）。全部假資料。 */
import { describe, expect, it } from 'vitest';
import { crossDayDuplicates, reconcileByDay } from './byDay';
import { fakeRoster, fakeSettings, room, runAll } from './fixtures';
import type { MakeupSettings } from './types';

function twoDay() {
  const roster = fakeRoster({ seed: 5, classes: [{ oldClass: '高一溫', students: 12 }, { oldClass: '高三良', students: 9 }], maxSubjects: 3 });
  const settings: MakeupSettings = fakeSettings(roster, [room(20, 'special'), room(42, 'mixed'), room(40), room(40)]);
  settings.days.push({ id: 'D0', label: '1/16（六）' });
  settings.groups = settings.groups.map((g) => (g.grades.includes('S3') ? { ...g, grades: g.grades.filter((x) => x !== 'S3') } : g)).filter((g) => g.grades.length);
  settings.groups.push({ id: 'D0-S3', dayId: 'D0', label: '高三', grades: ['S3'], start: 480, periodMin: 50, breakMin: 10 });
  return { roster, settings, ...runAll(roster, settings) };
}

describe('依考日對帳', () => {
  it('每天應有＝實有，合計等於全場次人次', () => {
    const { entries, schedule, settings } = twoDay();
    const rows = reconcileByDay(entries, schedule, settings);
    expect(rows).toHaveLength(2);
    for (const r of rows) { expect(r.expected).toBeGreaterThan(0); expect(r.diff).toBe(0); expect(r.details).toEqual([]); }
    expect(rows.reduce((n, r) => n + r.expected, 0)).toBe(entries.length);
  });

  it('拿掉某一天的一筆入座，那一天變紅、另一天不受影響', () => {
    const { entries, schedule, settings } = twoDay();
    const day = schedule.slots.find((s) => s.dayId === 'D0')!;
    const idx = schedule.sittings.findIndex((x) => x.slotId === day.id);
    const broken = { ...schedule, sittings: schedule.sittings.map((x, i) => (i === idx ? { ...x, subjects: x.subjects.slice(1), papers: x.papers.slice(1) } : x)) };
    const rows = reconcileByDay(entries, broken, settings);
    const hit = rows.find((r) => r.dayId === 'D0')!;
    expect(hit.diff).toBe(-1);
    expect(hit.details.length).toBeGreaterThan(0);
    expect(rows.find((r) => r.dayId === 'D1')!.diff).toBe(0);
  });
});

describe('跨考日重複補考', () => {
  it('同學號同科、舊班落在兩個考日 → 回報；單一考日或不同科不回報', () => {
    const { entries, settings } = twoDay();
    expect(crossDayDuplicates(entries, settings)).toEqual([]);
    const a = entries.find((e) => e.grade === 'S1')!;
    const dup = { ...a, grade: 'S3' as const, oldClass: '高三良', paper: `高三 ${a.subject}` };
    const r = crossDayDuplicates([...entries, dup], settings);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ studentId: a.studentId, subject: a.subject });
    expect(r[0]!.days).toHaveLength(2);
    expect(crossDayDuplicates([...entries, { ...dup, subject: '不同科目' }], settings)).toEqual([]);
  });
});
