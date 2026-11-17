import { describe, expect, it } from 'vitest';
import { readXlsx } from '../../import/xlsx';
import { writeXlsx } from '../../import/xlsxWrite';
import { HEADER, fakeRow } from './fixtures';
import {
  classSubjectMatrix,
  findMakeupHeader,
  gradeOfClass,
  makeupEntries,
  mapMakeupColumns,
  notifiedSummary,
  parseMakeupSheet,
  parseMakeupWorkbook,
  resolveMakeup,
  subjectCountDistribution,
} from './index';

describe('補考匯入：表頭與欄位', () => {
  it('認得原始匯出檔 12 欄，班級以舊班舊號為準（D122）', () => {
    const m = mapMakeupColumns(HEADER);
    expect(m).toMatchObject({ studentId: 0, newClass: 1, newSeat: 2, oldClass: 3, oldSeat: 4, name: 5, subjectCode: 6, subjectName: 7, credit: 8, attr: 9, term: 10, score: 11 });
  });
  it('只有「班級」「座號」時當作舊班舊號；有明確舊班時不被「班級」搶走', () => {
    expect(mapMakeupColumns(['學號', '班級', '座號', '姓名', '科目'])).toMatchObject({ oldClass: 1, oldSeat: 2, subjectName: 4 });
    expect(mapMakeupColumns(['學號', '班級', '舊班', '舊號', '座號', '姓名', '科目名稱'])).toMatchObject({ oldClass: 2, oldSeat: 3 });
  });
  it('表頭不在第一列也找得到', () => {
    expect(findMakeupHeader([['115 學年補考名單'], [], HEADER, fakeRow('900001', '101', 1, '數學')])).toBe(2);
  });
  it('缺必要欄位時回報 missing，不產生資料列', () => {
    const p = parseMakeupSheet([['學號', '科目名稱', '姓名'], ['900001', '數學', '測試一']]);
    expect(p.missing).toEqual(['oldClass', 'oldSeat']);
    expect(p.rows).toHaveLength(0);
  });
  it('使用者手動指定欄位對應（F-8）', () => {
    const rows = [['A', 'B', 'C', 'D', 'E'], ['900001', '測試一', '101', '3', '數學']];
    const p = parseMakeupSheet(rows, {}, '', { header: 0, columns: { studentId: 0, name: 1, oldClass: 2, oldSeat: 3, subjectName: 4 } });
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0]).toMatchObject({ studentId: '900001', oldClass: '101', oldSeat: 3, subjectName: '數學' });
  });
});

describe('補考匯入：年級判斷', () => {
  it.each([
    ['101', 'S1'],
    ['305', 'S3'],
    ['702', 'J1'],
    ['903', 'J3'],
    ['高一溫', 'S1'],
    ['初二良', 'J2'],
    ['國3忠', 'J3'],
    ['ＡＢ', null],
    ['501', null],
  ])('%s → %s', (c, g) => expect(gradeOfClass(c)).toBe(g));
});

describe('補考匯入：問題列分類與處理（F-10、D123）', () => {
  const sheet = [
    HEADER,
    fakeRow('900001', '101', 1, '數學'),
    fakeRow('900001', '101', 1, '英文'),
    fakeRow('900002', '101', 2, '數學', '0', ''), // 缺姓名
    fakeRow('900003', '501', 3, '數學'), // 舊班無法判斷年級
    fakeRow('900001', '101', 1, '數學'), // 同學號同科重複
    fakeRow('900004', '101', 4, ''), // 科目不認識（空白）
    fakeRow('900005', '101', 1, '化學'), // 舊班舊號屬於別人
    fakeRow('900006', '102', 6, '生命教育', '1'), // 另行通知
    fakeRow('', '102', 7, '數學'), // 沒有學號
  ];

  it('每種問題各抓到一筆，好的列照常納入', () => {
    const p = parseMakeupSheet(sheet);
    expect(p.rawCount).toBe(9);
    expect(p.rows.map((r) => r.srcRow)).toEqual([2, 3, 9]);
    expect(p.problems.map((x) => [x.srcRow, x.kind])).toEqual([
      [4, 'no-name'],
      [5, 'bad-class'],
      [6, 'dup'],
      [7, 'unknown-subject'],
      [8, 'bad-class'],
      [10, 'no-id'],
    ]);
  });

  it('未處理的問題列留在 unresolved；處理後 匯入＝納入＋另行通知＋略過', () => {
    const p = parseMakeupSheet(sheet);
    const r0 = resolveMakeup(p);
    expect(r0.unresolved).toHaveLength(6);
    const fixRow = (srcRow: number, patch: object) => {
      const prob = p.problems.find((x) => x.srcRow === srcRow);
      return { rowId: String(srcRow), action: 'fix' as const, row: { ...(prob?.draft as NonNullable<typeof prob>['draft']), ...patch } };
    };
    const r = resolveMakeup(p, [
      fixRow(4, { name: '測試二' }),
      fixRow(5, { oldClass: '102' }),
      { rowId: '6', action: 'skip', reason: 'duplicate' },
      fixRow(7, { subjectName: '物理' }),
      { rowId: '8', action: 'skip', reason: 'other', note: '舊號打錯，教務處確認' },
      { rowId: '10', action: 'skip', reason: 'transferred' },
    ]);
    expect(r.unresolved).toEqual([]);
    expect(r.included).toHaveLength(5);
    expect(r.notified).toHaveLength(1);
    expect(r.skipped.map((s) => s.reason)).toEqual(['duplicate', 'other', 'transferred']);
    expect(r.included.length + r.notified.length + r.skipped.length).toBe(r.rawCount);
  });

  it('修改後仍有問題的列不會被默默納入', () => {
    const p = parseMakeupSheet(sheet);
    const prob = p.problems.find((x) => x.srcRow === 4);
    const r = resolveMakeup(p, [{ rowId: '4', action: 'fix', row: { ...(prob?.draft as NonNullable<typeof prob>['draft']), name: '' } }]);
    expect(r.unresolved.some((x) => x.srcRow === 4)).toBe(true);
  });

  it('沒問題的列也可以略過（例：非補考對象），並保留原因', () => {
    const p = parseMakeupSheet(sheet);
    const r = resolveMakeup(p, [{ rowId: '2', action: 'skip', reason: 'not-target' }]);
    expect(r.skipped).toEqual([expect.objectContaining({ rowId: '2', reason: 'not-target' })]);
    expect(r.included.some((x) => x.srcRow === 2)).toBe(false);
  });

  it('科屬性另行通知可參數化（U-1）', () => {
    const p = parseMakeupSheet([HEADER, fakeRow('900001', '101', 1, '數學', '1'), fakeRow('900001', '101', 1, '生涯規劃', '2')]);
    expect(resolveMakeup(p).notified.map((r) => r.subjectName)).toEqual(['數學']);
    expect(resolveMakeup(p, [], { notifyAttrs: ['2'] }).notified.map((r) => r.subjectName)).toEqual(['生涯規劃']);
  });

  it('同學號姓名不一致提示（F-12），不擋', () => {
    const p = parseMakeupSheet([HEADER, fakeRow('900001', '101', 1, '數學', '0', '測試甲'), fakeRow('900001', '101', 1, '英文', '0', '測試乙')]);
    expect(p.rows).toHaveLength(2);
    expect(p.warnings).toHaveLength(1);
  });

  it('knownSubjects 有給時，清單外的科目算「科目不認識」', () => {
    const p = parseMakeupSheet([HEADER, fakeRow('900001', '101', 1, '數學'), fakeRow('900001', '101', 1, '天文')], { knownSubjects: ['數學', '英文'] });
    expect(p.problems.map((x) => x.kind)).toEqual(['unknown-subject']);
  });
});

describe('補考匯入：多工作表與 xlsx（中文不亂碼）', () => {
  it('高一、高二分頁一起匯入，重複跨表抓得到', () => {
    const p = parseMakeupWorkbook([
      { name: '高一', rows: [HEADER, fakeRow('900001', '101', 1, '數學')] },
      { name: '高二', rows: [HEADER, fakeRow('900002', '201', 1, '英文'), fakeRow('900001', '101', 1, '數學')] },
    ]);
    expect(p.rawCount).toBe(3);
    expect(p.rows.map((r) => r.rowId)).toEqual(['高一!2', '高二!2']);
    expect(p.problems.map((x) => [x.rowId, x.kind])).toEqual([['高二!3', 'dup']]);
  });

  it('寫成 .xlsx 再讀回，中文科目與姓名完整', async () => {
    const buf = await writeXlsx([HEADER, fakeRow('900001', '高一溫', 12, '歷史', '0', '測試王小明'), fakeRow('900001', '高一溫', 12, '生命教育', '1', '測試王小明')], '補考名單');
    const p = parseMakeupWorkbook(await readXlsx(buf));
    const r = resolveMakeup(p);
    expect(r.included[0]).toMatchObject({ name: '測試王小明', oldClass: '高一溫', oldSeat: 12, subjectName: '歷史' });
    expect(r.notified[0]?.subjectName).toBe('生命教育');
  });
});

describe('補考統計（F-17～F-19）', () => {
  const p = parseMakeupSheet([
    HEADER,
    fakeRow('900001', '101', 1, '數學'),
    fakeRow('900001', '101', 1, '英文'),
    fakeRow('900002', '102', 1, '數學'),
    fakeRow('900003', '102', 2, '歷史'),
    fakeRow('900004', '101', 3, '歷史'),
    fakeRow('900005', '701', 1, '數學'),
    fakeRow('900006', '701', 2, '生命教育', '1'),
    fakeRow('900002', '102', 1, '生涯規劃', '1'),
  ]);
  const roster = resolveMakeup(p);
  const split = { subjects: ['歷史'], trackOfClass: { '101': '理組' as const, '102': '文組' as const } };
  const entries = makeupEntries(roster, split);

  it('班級×科目矩陣：初中高中分開、選組科目拆開、總計吻合', () => {
    const [senior, junior] = classSubjectMatrix(entries);
    expect(senior?.division).toBe('senior');
    expect(senior?.classes).toEqual(['101', '102']);
    expect(senior?.subjects).toEqual(['數學', '英文', '歷史〔文組〕', '歷史〔理組〕']);
    expect(senior?.cells['101']).toEqual({ 數學: 1, 英文: 1, '歷史〔理組〕': 1 });
    expect(senior?.total).toBe(5);
    expect(junior?.total).toBe(1);
    expect(Object.values(senior?.classTotals ?? {}).reduce((a, b) => a + b, 0)).toBe(5);
  });

  it('卷鍵帶年級：高一數學與初一數學是不同卷', () => {
    expect([...new Set(entries.map((e) => e.paper))].sort()).toEqual(['初一 數學', '高一 數學', '高一 歷史〔文組〕', '高一 歷史〔理組〕', '高一 英文'].sort());
  });

  it('另行通知清單與「全為另行通知」的學生', () => {
    const n = notifiedSummary(roster);
    expect(n.total).toBe(2);
    expect(n.bySubject).toEqual({ 生命教育: 1, 生涯規劃: 1 });
    expect(n.notifiedOnly).toEqual(['900006']);
  });

  it('科數分布：Σ 科數×人數＝人次', () => {
    const d = subjectCountDistribution(entries);
    expect(d.rows).toEqual([
      { subjects: 1, students: 4 },
      { subjects: 2, students: 1 },
    ]);
    expect(d.rows.reduce((n, r) => n + r.subjects * r.students, 0)).toBe(d.entries);
  });
});
