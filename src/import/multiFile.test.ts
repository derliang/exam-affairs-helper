import { describe, expect, it } from 'vitest';
import { groupByKey, mergeRosterFiles, okFiles, readFiles, resolveConflicts } from './multiFile';
import { parseRoster } from './roster';

const HEAD = ['班級', '座號', '姓名', '學號'];
const roster = (rows: string[][], sheetName = '名單') => ({ ...parseRoster([HEAD, ...rows], { classNames: ['溫', '良'] }), sheetName });

describe('#506 多檔：逐檔讀取', () => {
  it('壞檔混入：只有那一檔失敗，其他檔照常、順序不變', async () => {
    const files = [{ name: 'a.xlsx' }, { name: 'bad.xlsx' }, { name: 'c.xlsx' }];
    const rs = await readFiles(files, async (f) => { if (f.name === 'bad.xlsx') throw new Error('不是 xlsx'); return f.name.length; });
    expect(rs.map((r) => r.ok)).toEqual([true, false, true]);
    expect(rs[1]).toEqual({ name: 'bad.xlsx', ok: false, error: '不是 xlsx' });
    expect(okFiles(rs).map((r) => r.name)).toEqual(['a.xlsx', 'c.xlsx']);
  });
});

describe('#506 多檔：名冊合併（跨檔衝突轉成逐列問題）', () => {
  it('多檔無衝突：全部合併、沒有問題列', () => {
    const m = mergeRosterFiles([
      { file: '溫班.xlsx', result: roster([['溫', '1', '甲'], ['溫', '2', '乙']]) },
      { file: '良班.xlsx', result: roster([['良', '1', '丙'], ['良', '2', '丁']]) },
    ]);
    expect(m.students.map((s) => s.name)).toEqual(['甲', '乙', '丙', '丁']);
    expect(m.problems).toEqual([]);
    expect(m.perFile.map((p) => p.students)).toEqual([2, 2]);
  });
  it('跨檔重複學生（同班同座號）：後一檔那一列變成問題列，指出是哪個檔案哪一列，不覆蓋、不靜默略過', () => {
    const m = mergeRosterFiles([
      { file: 'A.xlsx', result: roster([['溫', '1', '甲'], ['溫', '2', '乙']]) },
      { file: 'B.xlsx', result: roster([['溫', '2', '乙乙'], ['溫', '3', '丙']]) },
    ]);
    expect(m.students.map((s) => s.name)).toEqual(['甲', '乙', '丙']);
    expect(m.problems).toHaveLength(1);
    const pr = m.problems[0]!;
    expect(pr).toMatchObject({ kind: 'dup', file: 'B.xlsx', sheet: '名單', row: 2 });
    expect(pr.message).toContain('A.xlsx');
    expect(pr.draft).toMatchObject({ classNo: 1, seatNo: 2, name: '乙乙' });
  });
  it('跨檔同學號（不同座號）：學號重複問題列', () => {
    const m = mergeRosterFiles([
      { file: 'A.xlsx', result: roster([['溫', '1', '甲', '1150001']]) },
      { file: 'B.xlsx', result: roster([['溫', '9', '甲甲', '1150001']]) },
    ]);
    expect(m.students).toHaveLength(1);
    expect(m.problems[0]).toMatchObject({ kind: 'dup-school-id', file: 'B.xlsx' });
  });
  it('同檔內重複座號：沿用單檔既有的問題列（kind=dup），並標上檔名', () => {
    const m = mergeRosterFiles([{ file: 'A.xlsx', result: roster([['溫', '1', '甲'], ['溫', '1', '乙']]) }]);
    expect(m.students.map((s) => s.name)).toEqual(['甲']);
    expect(m.problems).toHaveLength(1);
    expect(m.problems[0]).toMatchObject({ kind: 'dup', file: 'A.xlsx' });
  });
  it('單檔：結果與沒合併時相同（不誤報）', () => {
    const r = roster([['溫', '1', '甲'], ['溫', '2', '']]);
    const m = mergeRosterFiles([{ file: 'A.xlsx', result: r }]);
    expect(m.students).toEqual(r.students);
    expect(m.problems.map((p) => p.kind)).toEqual(r.problems.map((p) => p.kind));
  });
});

describe('#506 多檔：鍵值衝突逐筆決定', () => {
  const parts = [
    { file: 'A', items: [{ k: '1-1', n: '甲' }, { k: '1-2', n: '乙' }] },
    { file: 'B', items: [{ k: '1-2', n: '乙乙' }, { k: '1-3', n: '丙' }, { k: '1-3', n: '丙丙' }] },
  ];
  const g = groupByKey(parts, (x) => x.k);
  it('跨檔與同檔內重複都列為衝突；只出現一次的不算', () => {
    expect(g.unique.map((u) => u.item.n)).toEqual(['甲']);
    expect(g.conflicts.map((c) => c.key)).toEqual(['1-2', '1-3']);
    expect(g.conflicts[1]!.candidates.map((c) => c.file)).toEqual(['B', 'B']);
  });
  it('沒決定就不能完成，也不會悄悄選一個', () => {
    const r = resolveConflicts(g.unique, g.conflicts, { '1-2': 0 });
    expect(r.ready).toBe(false);
    expect(r.pending).toEqual(['1-3']);
    expect(r.items.map((i) => i.n)).toEqual(['甲', '乙']);
  });
  it('逐筆決定：保留指定的一份、或都不匯入，順序依讀入順序', () => {
    const r = resolveConflicts(g.unique, g.conflicts, { '1-2': 1, '1-3': 'skip' });
    expect(r.ready).toBe(true);
    expect(r.items.map((i) => i.n)).toEqual(['甲', '乙乙']);
    expect(r.skipped).toBe(1);
  });
});
