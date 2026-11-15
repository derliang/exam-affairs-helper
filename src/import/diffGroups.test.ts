import { describe, expect, it } from 'vitest';
import type { ExamEntry, Student } from '../data';
import { compareRosters } from './compare';
import { applyGroupChoice, classifyDiff, groupDiffs } from './diffGroups';

const S = (classNo: number, seatNo: number, name: string): Student => ({ classNo, seatNo, name });
const E = (classNo: number, seatNo: number, name: string): ExamEntry => ({ classNo, seatNo, name, subjectIds: ['chinese'] });

describe('#201 差異分組', () => {
  const roster = [S(1, 1, '王小明'), S(1, 2, '李大華'), S(1, 3, '張三'), S(1, 4, '趙四')];
  const entries = [E(1, 1, '王小'), E(1, 2, '陳美玲'), E(1, 3, '張三'), E(1, 9, '新人')];
  const { diffs } = compareRosters(roster, entries, 'all');

  it('缺字（子字串）歸 A，座號相同姓名完全不同歸 B', () => {
    const byCode = Object.fromEntries(diffs.map((d) => [d.code, classifyDiff(d)]));
    expect(byCode['0101']).toBe('A');
    expect(byCode['0102']).toBe('B');
  });
  it('共用一個字但不是子字串的不當同一人（B）；考試名單比較長但含學生名單姓名也算 A', () => {
    expect(classifyDiff({ kind: 'mismatch', code: 'x', exam: S(1, 1, '王小華'), roster: S(1, 1, '王大明') })).toBe('B');
    expect(classifyDiff({ kind: 'mismatch', code: 'x', exam: S(1, 1, '王小明明'), roster: S(1, 1, '王小明') })).toBe('A');
  });
  it('只缺漏的歸 C；groupDiffs 依 A／B／C 分開', () => {
    const g = groupDiffs(diffs);
    expect(g.A.map((d) => d.code)).toEqual(['0101']);
    expect(g.B.map((d) => d.code)).toEqual(['0102']);
    expect(g.C.map((d) => d.code).sort()).toEqual(['0104', '0109']);
    expect(g.other).toEqual([]);
  });
  it('整組套用某一邊：只動該組、不覆蓋已選', () => {
    const pre = diffs.map((d) => (d.code === '0101' ? { ...d, choice: 'use-roster' as const } : d));
    const next = applyGroupChoice(pre, 'B', 'use-roster');
    expect(next.find((d) => d.code === '0102')?.choice).toBe('use-roster');
    expect(next.find((d) => d.code === '0101')?.choice).toBe('use-roster');
    expect(next.find((d) => d.code === '0104')?.choice).toBeUndefined();
    const over = applyGroupChoice(pre, 'A', 'use-exam');
    expect(over.find((d) => d.code === '0101')?.choice).toBe('use-exam');
  });
});
