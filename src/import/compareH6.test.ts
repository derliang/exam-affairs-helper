import { describe, expect, it } from 'vitest';
import type { ExamEntry, RosterDiff, Student } from '../data';
import { allResolved, applyDiffs, compareRosters, isResolved, refreshDiffs, validateResolved } from './compare';

// 假資料：只用「甲乙丙」這類虛構名稱
const S = (classNo: number, seatNo: number, name: string, groupCode?: string): Student => ({ classNo, seatNo, name, ...(groupCode ? { groupCode } : {}) });
const E = (classNo: number, seatNo: number, name: string, groupCode?: string): ExamEntry => ({ classNo, seatNo, name, subjectIds: ['chi'], ...(groupCode ? { groupCode } : {}) });
const known = new Set([1, 2]);

describe('H-6 組別不同', () => {
  const roster = [S(1, 1, '甲', 'D'), S(1, 2, '乙', 'E'), S(1, 3, '丙')];
  it('同一人兩邊組別不同才列出；沒填的不比；同組別不同寫法（2-自然組）視為相同', () => {
    const entries = [E(1, 1, '甲', 'E'), E(1, 2, '乙', 'E-文組'), E(1, 3, '丙', 'D')];
    const { diffs } = compareRosters(roster, entries, { groups: true });
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ kind: 'group-diff', code: '0101', groups: { exam: 'E', roster: 'D' } });
  });
  it('沒開 groups 選項（分科、國中部）不偵測', () => {
    expect(compareRosters(roster, [E(1, 1, '甲', 'E')]).diffs).toHaveLength(0);
  });
  it('姓名也不同時只列「姓名不同」，不重複列組別', () => {
    const { diffs } = compareRosters(roster, [E(1, 1, '甲甲', 'E')], { groups: true });
    expect(diffs.map((d) => d.kind)).toEqual(['mismatch']);
  });
  it('以考試名單為準：學生名單的組別改成考試名單的', () => {
    const entries = [E(1, 1, '甲', 'E')];
    const diffs = compareRosters(roster, entries, { groups: true }).diffs.map((d): RosterDiff => ({ ...d, choice: 'use-exam' }));
    expect(applyDiffs(roster, entries, diffs).students.find((s) => s.seatNo === 1)?.groupCode).toBe('E');
  });
  it('以學生名單為準：考試名單的組別與考科改成學生名單的', () => {
    const entries = [E(1, 1, '甲', 'E')];
    const diffs = compareRosters(roster, entries, { groups: true }).diffs.map((d): RosterDiff => ({ ...d, choice: 'use-roster' }));
    const r = applyDiffs(roster, entries, diffs, { subjectsOfGroup: (k) => (k === 'D' ? ['chi', 'sci'] : undefined) });
    expect(r.entries[0]).toMatchObject({ groupCode: 'D', subjectIds: ['chi', 'sci'] });
    expect(r.students.find((s) => s.seatNo === 1)?.groupCode).toBe('D'); // 學生名單不動
  });
});

describe('H-6 考試名單有這個班級、班級資料沒有', () => {
  const roster = [S(1, 1, '甲')];
  const entries = [E(1, 1, '甲'), E(7, 3, '丁'), E(7, 7, '戊')];
  const diffsOf = (patch: Partial<RosterDiff>): RosterDiff[] =>
    compareRosters(roster, entries, { classNos: known }).diffs.map((d) => (d.kind === 'new-class' ? { ...d, ...patch } : d));

  it('整班一筆（不逐人列為「考試名單有、學生名單沒有」）', () => {
    const { diffs } = compareRosters(roster, entries, { classNos: known });
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ kind: 'new-class', code: 'new-class-7' });
    expect(diffs[0]?.members?.map((m) => m.seatNo)).toEqual([3, 7]);
  });
  it('沒給 classNos 時維持舊行為（逐人列出）', () => {
    expect(compareRosters(roster, entries).diffs.map((d) => d.kind)).toEqual(['only-in-exam', 'only-in-exam']);
  });
  it('新增班級：這班的人進學生名單，並回報要新增的班級序號', () => {
    const r = applyDiffs(roster, entries, diffsOf({ choice: 'add-class' }));
    expect(r.addedClasses).toEqual([7]);
    expect(r.students.map((s) => `${s.classNo}-${s.seatNo}`)).toEqual(['1-1', '7-3', '7-7']);
    expect(r.entries).toHaveLength(3);
    expect(validateResolved(r, new Set([1, 2, 7]))).toBeNull();
  });
  it('改成既有班級：考試名單與學生名單都改到目標班，座號照舊', () => {
    const r = applyDiffs(roster, entries, diffsOf({ choice: 'remap-class', targetClassNo: 2 }));
    expect(r.addedClasses).toEqual([]);
    expect(r.entries.map((e) => `${e.classNo}-${e.seatNo}`)).toEqual(['1-1', '2-3', '2-7']);
    expect(r.students.map((s) => `${s.classNo}-${s.seatNo}`)).toEqual(['1-1', '2-3', '2-7']);
    expect(validateResolved(r, known)).toBeNull();
  });
  it('改成既有班級時座號撞到人：套用前驗證擋下並指出兩人', () => {
    const r = applyDiffs([S(1, 1, '甲'), S(2, 3, '己')], [E(1, 1, '甲'), E(2, 3, '己'), E(7, 3, '丁')], compareRosters([S(1, 1, '甲'), S(2, 3, '己')], [E(1, 1, '甲'), E(2, 3, '己'), E(7, 3, '丁')], { classNos: known }).diffs.map((d) => ({ ...d, choice: 'remap-class' as const, targetClassNo: 2 })));
    const msg = validateResolved(r, known);
    expect(msg).toContain('重複');
    expect(msg).toContain('丁');
  });
  it('不匯入這班：這班的人從考試名單移除，學生名單不動', () => {
    const r = applyDiffs(roster, entries, diffsOf({ choice: 'skip-class' }));
    expect(r.entries.map((e) => e.classNo)).toEqual([1]);
    expect(r.students).toHaveLength(1);
    expect(r.addedClasses).toEqual([]);
  });
  it('已處理判斷：改成既有班級一定要有目標班', () => {
    const d = diffsOf({ choice: 'remap-class' });
    expect(allResolved(d)).toBe(false);
    expect(isResolved({ ...(d[0] as RosterDiff), targetClassNo: 2 })).toBe(true);
  });
  it('重算差異時沿用相同內容的選擇（含目標班）；內容變了就清掉', () => {
    const stored = diffsOf({ choice: 'remap-class', targetClassNo: 2 });
    const same = refreshDiffs(roster, entries, stored, { classNos: known });
    expect(same[0]).toMatchObject({ choice: 'remap-class', targetClassNo: 2 });
    const changed = refreshDiffs(roster, [...entries, E(7, 9, '庚')], stored, { classNos: known });
    expect(changed[0]?.choice).toBeUndefined();
  });
  it('班級資料後來補上這班：不再是整班一筆，改成逐人的「考試名單有、學生名單沒有」', () => {
    expect(compareRosters(roster, entries, { classNos: new Set([1, 7]) }).diffs.map((d) => d.kind)).toEqual(['only-in-exam', 'only-in-exam']);
  });
});

describe('C-9 以學生名單為準時保留個別 X／＋', () => {
  const roster = [S(1, 1, '甲', 'D'), S(1, 2, '乙', 'D')];
  const table: Record<string, string[]> = { D: ['chi', 'eng', 'sci'], E: ['chi', 'eng'] };
  const opts = { subjectsOfGroup: (k: string) => table[k] };
  const useRoster = (entries: ExamEntry[]) =>
    compareRosters(roster, entries, { groups: true }).diffs.map((d): RosterDiff => ({ ...d, choice: 'use-roster' }));

  it('套用前後：個別缺考與加考疊在新組別預設上，標示欄位也保留', () => {
    const entries: ExamEntry[] = [
      { classNo: 1, seatNo: 1, name: '甲', groupCode: 'E', subjectIds: ['chi', 'soc'], absentSubjectIds: ['eng'], extraSubjectIds: ['soc'] },
      { classNo: 1, seatNo: 2, name: '乙', groupCode: 'D', subjectIds: ['chi', 'eng', 'sci'] },
    ];
    const r = applyDiffs(roster, entries, useRoster(entries), opts);
    const a = r.entries.find((e) => e.seatNo === 1)!;
    expect(a.groupCode).toBe('D');
    expect(a.subjectIds).toEqual(['chi', 'sci', 'soc']); // D 預設去掉缺考的英文、加上社會
    expect(a.absentSubjectIds).toEqual(['eng']);
    expect(a.extraSubjectIds).toEqual(['soc']);
  });
  it('舊存檔（沒有這兩個欄位）：行為不變，直接用新組別預設', () => {
    const entries: ExamEntry[] = [{ classNo: 1, seatNo: 1, name: '甲', groupCode: 'E', subjectIds: ['chi'] }];
    const r = applyDiffs(roster, entries, useRoster(entries), opts);
    expect(r.entries[0]!.subjectIds).toEqual(['chi', 'eng', 'sci']);
    expect(r.entries[0]).not.toHaveProperty('absentSubjectIds');
  });
  it('查不到新組別的考科：考科不動（與原行為相同）', () => {
    const entries: ExamEntry[] = [{ classNo: 1, seatNo: 1, name: '甲', groupCode: 'E', subjectIds: ['chi'], absentSubjectIds: ['eng'] }];
    const r = applyDiffs(roster, entries, useRoster(entries), { subjectsOfGroup: () => undefined });
    expect(r.entries[0]!.subjectIds).toEqual(['chi']);
  });
});

describe('C-9 匯入時記下個別 X／＋', () => {
  it('parseExamList 把個別缺考與加考記在 entry', async () => {
    const { parseExamList } = await import('./examList');
    const rows = [['班級', '座號', '姓名', '組別', '備註', '加考'], ['1', '1', '甲', 'D', '缺英', '社'], ['1', '2', '乙', 'D', '', '']];
    const { entries } = parseExamList(rows, { round: 1 });
    expect(entries[0]!.absentSubjectIds?.length).toBeGreaterThan(0);
    expect(entries[0]!.extraSubjectIds?.length).toBeGreaterThan(0);
    expect(entries[1]).not.toHaveProperty('absentSubjectIds');
  });
});
