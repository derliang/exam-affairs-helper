import { describe, expect, it } from 'vitest';
import { fakeSheet } from '../../core/makeup/fixtures';
import { parseMakeupWorkbook } from '../../core/makeup';
import { diffImport, isEmptyBook, mergeImport, mergeImportWith, overlapKeys, overlapRows, parseWithMapping, pickSheets, replaceImport, rowKey } from './importOps';
import { baseOf } from './pipeline';
import { fakeParse, fakeSession, NOW } from './testKit';

describe('② 匯入：欄位對應', () => {
  const sheet = fakeSheet({ seed: 3, classes: [{ oldClass: '高一溫', students: 5 }] });
  it('自動找表頭與對應；多張工作表挑辨識欄位最多的', () => {
    const { picks, main } = pickSheets([{ name: '封面', rows: [['備註']] }, { name: '名單', rows: sheet }]);
    expect(main).toBe(1);
    expect(picks[1]!.header).toBe(0);
    expect(picks[1]!.columns.studentId).toBe(0);
    expect(picks[0]!.header).toBe(-1);
  });
  it('沒改對應就整本一起解析；改了對應只解析所選那張', () => {
    const { picks } = pickSheets([{ name: '名單', rows: sheet }]);
    const pk = picks[0]!;
    const a = parseWithMapping([{ name: '名單', rows: sheet }], pk, pk.columns, pk.header);
    expect(a.rawCount).toBe(sheet.length - 1);
    const cols = { ...pk.columns };
    delete cols.studentId;
    const b = parseWithMapping([{ name: '名單', rows: sheet }], pk, cols, pk.header);
    expect(b.missing).toContain('studentId');
  });
  it('空檔偵測', () => {
    expect(isEmptyBook([{ rows: [[''], ['  ']] }])).toBe(true);
    expect(isEmptyBook([{ rows: [['a']] }])).toBe(false);
  });
});

describe('② 重複匯入（F-11）', () => {
  const cur = fakeParse(5);
  it('同一份：全部相同，沒有新增、更新、移除', () => {
    const d = diffImport(cur, fakeParse(5), new Set());
    expect(d).toMatchObject({ added: 0, updated: 0, removed: 0, hasCurrent: true });
    expect(d.same).toBe(cur.rows.length + cur.problems.length);
  });
  it('新檔多了、少了、改了：數字對得上，並算出被移除且已排程的人次', () => {
    const rows = cur.rows.slice(2); // 少 2 列
    const changed = rows.map((r, i) => (i === 0 ? { ...r, score: '99' } : r));
    const extra = { ...cur.rows[0]!, rowId: 'n1', studentId: 'N00001', subjectName: '數學' };
    const next = { ...cur, rows: [...changed, extra], problems: cur.problems };
    const scheduled = new Set(cur.rows.slice(0, 2).map(rowKey));
    const d = diffImport(cur, next, scheduled);
    expect(d).toMatchObject({ added: 1, updated: 1, removed: 2, removedScheduled: 2 });
  });
  it('目前沒有名單時不必問（hasCurrent=false）', () => {
    expect(diffImport(undefined, cur, new Set()).hasCurrent).toBe(false);
  });
  it('取代：整份換掉、清掉先前的問題列處理；合併：只加新檔多出的列（列號不撞）', () => {
    const s = { ...fakeSession(), resolutions: [{ rowId: '3', action: 'skip' as const, reason: 'other' as const, note: 'x' }] };
    const next = parseMakeupWorkbook([{ name: 'S', rows: fakeSheet({ seed: 9, classes: [{ oldClass: '高三溫', students: 4 }] }) }]);
    const r = replaceImport(s, next, '新.xlsx', NOW);
    expect(r.parse!.rows.map((x) => x.rowId)).toEqual(next.rows.map((x) => x.rowId));
    expect(r.parse!.rows.every((x) => x.file === '新.xlsx')).toBe(true); // #566：每列記來自哪個檔
    expect(r.resolutions).toEqual([]);
    expect(r.source?.fileName).toBe('新.xlsx');
    const m = mergeImport(s, next, '新.xlsx', NOW);
    const ids = [...m.parse!.rows, ...m.parse!.problems].map((x) => x.rowId);
    expect(new Set(ids).size).toBe(ids.length);
    const addedN = m.parse!.rows.length - s.parse!.rows.length + m.parse!.problems.length - s.parse!.problems.length;
    expect(addedN).toBeGreaterThan(0);
    expect(m.parse!.rawCount).toBe(s.parse!.rawCount + addedN);
    expect(m.resolutions).toEqual(s.resolutions);
    // 合併同一份＝沒有新增
    expect(mergeImport(s, s.parse!, 'a', NOW).parse!.rows).toHaveLength(s.parse!.rows.length);
  });
});

describe('#506 補考多檔：重疊逐筆處理', () => {
  const cur = fakeParse(5);
  const base = { ...fakeSession(), parse: cur };
  it('兩檔無重疊：沒有衝突鍵，直接合併、列數相加', () => {
    const r0 = cur.rows[0]!;
    const other = { ...cur, rows: [{ ...r0, rowId: 'z1', studentId: 'Z99999' }], problems: [], rawCount: 1, warnings: [] };
    expect(overlapKeys(cur, other)).toEqual([]);
    const m = mergeImportWith(base, other, 'b.xlsx', NOW, new Set());
    expect(m.parse!.rawCount).toBe(cur.rawCount + 1);
    expect(m.parse!.rows).toHaveLength(cur.rows.length + 1);
  });
  it('跨檔同學號同科（內容相同也算）：列為重疊；保留目前的＝不動；改用本檔＝換成新檔那一列', () => {
    const r0 = cur.rows[0]!;
    const next = { ...cur, rows: [{ ...r0, rowId: 'x1', score: '5' }], problems: [], rawCount: 1, warnings: [] };
    const keys = overlapKeys(cur, next);
    expect(keys).toEqual([rowKey(r0)]);
    const keep = mergeImportWith(base, next, 'b.xlsx', NOW, new Set());
    expect(keep.parse!.rows.find((r) => rowKey(r) === keys[0])!.score).toBe(r0.score);
    expect(keep.parse!.rawCount).toBe(cur.rawCount);
    const use = mergeImportWith(base, next, 'b.xlsx', NOW, new Set(keys));
    expect(use.parse!.rows.filter((r) => rowKey(r) === keys[0])).toHaveLength(1);
    expect(use.parse!.rows.find((r) => rowKey(r) === keys[0])!.score).toBe('5');
    expect(use.parse!.rawCount).toBe(cur.rawCount);
  });
  it('overlapRows 回傳兩邊的列供畫面逐筆比對', () => {
    const r0 = cur.rows[0]!;
    const next = { ...cur, rows: [{ ...r0, rowId: 'x1', score: '5' }], problems: [] };
    const o = overlapRows(cur, next, overlapKeys(cur, next));
    expect(o).toHaveLength(1);
    expect(o[0]!.nxt.score).toBe('5');
  });
});
