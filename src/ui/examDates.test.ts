/** 考試日期與列表分群（#352、#389；D163、D164）：全部假資料 */
import { describe, expect, it } from 'vitest';
import type { ExamConfig } from '../data';
import { dateRangeText, examGroup, groupExams, isRealDate, lastDate, shortDate, todayTaipei, weekdayOf } from './examDates';

const ex = (id: string, patch: Partial<ExamConfig> = {}): ExamConfig => ({
  id, name: id, kind: 'gsat', division: 'senior', semester: 'first', subjects: [], markRules: [], classroomIds: [], labelLayout: { paper: 'B4', cols: 6, rows: 8 }, createdAt: '2026-01-01T00:00:00Z', ...patch,
}) as ExamConfig;

describe('日期格式', () => {
  it('星期由日期算出；不合法的日期被擋掉', () => {
    expect(weekdayOf('2026-12-14')).toBe('一');
    expect(shortDate('2026-12-15')).toBe('12/15（二）');
    expect(shortDate('0000-00-00')).toBe('');
    expect(isRealDate('2026-02-30')).toBe(false);
    expect(dateRangeText({ examDates: ['2026-12-14', '2026-12-15'] })).toBe('2026-12-14（一）～12-15（二）');
    expect(dateRangeText({ examDates: ['2026-12-14'] })).toBe('2026-12-14（一）');
    expect(dateRangeText({})).toBe('');
    expect(lastDate({ examDates: ['2026-12-15', '2026-12-14'] })).toBe('2026-12-15');
  });
  it('台北時間今天', () => { expect(todayTaipei(new Date('2026-11-19T17:00:00Z'))).toBe('2026-11-20'); });
});

describe('分群（D164）', () => {
  const today = '2026-11-19';
  it('考試當天算還沒開始；多天以最後一天為準；沒日期放還沒開始', () => {
    expect(examGroup(ex('a', { examDates: ['2026-11-19'] }), today)).toBe('upcoming');
    expect(examGroup(ex('b', { examDates: ['2026-11-18'] }), today)).toBe('ended');
    expect(examGroup(ex('c', { examDates: ['2026-11-18', '2026-11-19'] }), today)).toBe('upcoming');
    expect(examGroup(ex('d'), today)).toBe('upcoming');
  });
  it('舊的已封存且沒日期的考試一次性歸已經結束；補填日期後改依日期', () => {
    expect(examGroup(ex('e', { archived: true }), today)).toBe('ended');
    expect(examGroup(ex('f', { archived: true, examDates: ['2026-12-01'] }), today)).toBe('upcoming');
  });
  it('排序：還沒開始＝近的在上、未填日期最下；已經結束＝最近結束的在上', () => {
    const list = [ex('n'), ex('far', { examDates: ['2027-01-10'] }), ex('near', { examDates: ['2026-12-14'] }), ex('old1', { examDates: ['2026-09-14'] }), ex('old2', { examDates: ['2026-10-12'] })];
    const g = groupExams(list, today, () => '');
    expect(g.upcoming.map((e) => e.id)).toEqual(['near', 'far', 'n']);
    expect(g.ended.map((e) => e.id)).toEqual(['old2', 'old1']);
  });
});
