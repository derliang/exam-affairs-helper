import { describe, expect, it } from 'vitest';
import type { ExamEntry, Student } from '../data';
import { compareRosters } from './compare';
import { applyGroupChoice, classifyDiff, groupDiffs, manyDiffs, nameSimilar } from './diffGroups';

const S = (classNo: number, seatNo: number, name: string): Student => ({ classNo, seatNo, name });
const E = (classNo: number, seatNo: number, name: string): ExamEntry => ({ classNo, seatNo, name, subjectIds: ['chinese'] });

describe('#201 差異分組', () => {
  const roster = [S(1, 1, '王小明'), S(1, 2, '李大華'), S(1, 3, '張三'), S(1, 4, '趙四')];
  const entries = [E(1, 1, '王小'), E(1, 2, '陳美玲'), E(1, 3, '張三'), E(1, 9, '新人')];
  const { diffs } = compareRosters(roster, entries);

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
    expect(g.C.map((d) => d.code).sort()).toEqual(['0109']); // 學生名單單邊（0104）D143 起不算差異
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

describe('#208 疑似缺字（差一字）與差異過多提示', () => {
  it('差一個字（換字、少字、多字）視為相似；兩字名換一字不算', () => {
    expect(nameSimilar('王小明', '王曉明')).toBe(true);
    expect(nameSimilar('王小明', '王明')).toBe(true);
    expect(nameSimilar('王小明', '王大小明')).toBe(true);
    expect(nameSimilar('王小', '王大')).toBe(false);
    expect(nameSimilar('王小明', '陳美玲')).toBe(false);
    expect(nameSimilar('王小明', '李曉華')).toBe(false);
  });
  it('姓名差一字的 mismatch 歸 A', () => {
    const { diffs } = compareRosters([S(1, 1, '王小明')], [E(1, 1, '王曉明')]);
    expect(groupDiffs(diffs).A).toHaveLength(1);
  });
  it('差異超過 30% 才提示', () => {
    expect(manyDiffs(3, 10)).toBe(false);
    expect(manyDiffs(4, 10)).toBe(true);
    expect(manyDiffs(0, 0)).toBe(false);
  });
});
