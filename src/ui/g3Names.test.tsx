/** 第 3 批「名單與匯入」G8 G9 G10：學測、分科、會考三種類型各測一遍（只用假資料） */
import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import type { Classroom, ExamConfig, Student } from '../data';
import { parseRoster } from '../import';
import { applyImport, clearRoster, examsAffectedByClear, planImport } from './rosterIO';
import { PROBLEM_KIND_TEXT, problemBlockers, resolveProblems, type ProblemDecision } from './rosterProblems';
import { Step2 } from './pages/Step2';
import { RowFix } from './pages/RowFix';
import { ClearRoster, CLEAR_KEYWORD } from './pages/RosterIO';
import { demoDoc } from './repository';
import { reseat } from './seating';
import { newExam, type Doc } from './store';
import { parseRosterWorkbook } from './step2';

const noop = () => undefined;
type Kind = 'gsat' | 'ast' | 'bcct';
const KINDS: Kind[] = ['gsat', 'ast', 'bcct'];
const divisionOf = (k: Kind) => (k === 'bcct' ? 'junior' : 'senior') as 'junior' | 'senior';

function withExam(kind: Kind, roster: Student[]): { doc: Doc; exam: ExamConfig } {
  const d0 = demoDoc();
  const d = { ...d0, rosters: { ...d0.rosters, [divisionOf(kind)]: roster } };
  const r = newExam(d, kind, `${kind}測試考`, new Date('2026-11-01T02:00:00Z'));
  if (!r.ok) throw new Error(r.error);
  return { doc: r.doc, exam: r.doc.exams[r.doc.exams.length - 1] as ExamConfig };
}
const fake = (n: number): Student[] => Array.from({ length: n }, (_, i) => ({ classNo: 1, seatNo: i + 1, name: `假生${i + 1}` }));

describe('G8 第 2 步：名單空的直接匯入、已有名單改成「修改學生名單」', () => {
  for (const kind of KINDS) {
    it(`${kind}：共用名單空的 → 可直接匯入（醒目匯入區），警告只有一個`, () => {
      const { doc, exam } = withExam(kind, []);
      const html = renderToString(<Step2 doc={doc} exam={exam} onChange={noop} onToRoster={noop} />);
      expect(html).toContain('選擇學生名單檔（.xlsx）並匯入');
      expect(html).toContain('下載名單範本');
      expect(html).toContain('同一份資料');
      expect(html).toContain('尚未匯入');
      expect((html.match(/學生名單是空的/g) ?? []).length).toBe(1); // 原本上下兩個黃框重複
      expect(html).not.toContain('去匯入學生名單');
      expect(html).not.toContain('請先到「共用設定」匯入');
    });
    it(`${kind}：已有名單 → 匯入區變成「修改學生名單」，並說明怎麼回到這一步`, () => {
      const { doc, exam } = withExam(kind, fake(3));
      const html = renderToString(<Step2 doc={doc} exam={exam} onChange={noop} onToRoster={noop} />);
      const sn = kind === 'bcct' ? '國三學生名單' : '高三學生名單';
      expect(html).toContain(`修改${sn}`);
      expect(html).toContain('3 人');
      expect(html).toContain('頁首路徑列');
      expect(html).not.toContain('選擇學生名單檔（.xlsx）並匯入');
      expect(html).not.toContain('學生名單是空的');
    });
  }
  it('學測、分科：共用學生名單與本次考試名單分兩區；會考只有學生名單', () => {
    for (const kind of ['gsat', 'ast'] as const) {
      const { doc, exam } = withExam(kind, fake(2));
      const html = renderToString(<Step2 doc={doc} exam={exam} onChange={noop} onToRoster={noop} />);
      expect(html).toContain('高三學生名單（共用設定）');
      expect(html).toContain('本次考試名單（含考科、組別）');
    }
    const { doc, exam } = withExam('bcct', fake(2));
    const html = renderToString(<Step2 doc={doc} exam={exam} onChange={noop} onToRoster={noop} />);
    expect(html).toContain('國三學生名單（共用設定）');
    expect(html).not.toContain('本次考試名單');
  });
  it('匯入寫進共用名單：同一份資料，第 2 步立刻看到', () => {
    const { doc, exam } = withExam('bcct', []);
    const rows = [['班級', '座號', '姓名'], ['01', '1', '假生甲'], ['01', '2', '假生乙']];
    const parsed = parseRosterWorkbook([{ name: '名單', rows }], []);
    const next = applyImport(doc, 'junior', planImport(doc, 'junior', parsed.students), 'add');
    expect(next.rosters.junior).toHaveLength(2); // 共用設定的學生名單
    expect(renderToString(<Step2 doc={next} exam={exam} onChange={noop} onToRoster={noop} />)).toContain('2 人'); // 這一步
  });
});

describe('G9 刪除全部名單', () => {
  for (const kind of KINDS) {
    it(`${kind}：只清所選部別這一份；列出同部別同學年度的模擬考`, () => {
      const { doc } = withExam(kind, fake(4));
      const division = divisionOf(kind);
      const other = division === 'senior' ? 'junior' : 'senior';
      const affected = examsAffectedByClear(doc, division);
      expect(affected.map((a) => a.name)).toEqual([`${kind}測試考`]);
      const next = clearRoster(doc, division);
      expect(next.rosters[division]).toEqual([]);
      expect(next.rosters[other]).toEqual(doc.rosters[other]);
      expect(next.settings.classes).toEqual(doc.settings.classes); // 班級資料不動
      expect(doc.rosters[division]).toHaveLength(4); // 不改原物件，頁首「復原」才還原得回
    });
  }
  it('已排座的模擬考標「會變過期」', () => {
    const room = { id: 'g3-room', name: 'g3-room', kind: 'class', rows: 1, depth: 12, seatCount: 12, division: 'junior' } as unknown as Classroom;
    const { doc: d0, exam: e0 } = withExam('bcct', fake(6));
    const doc1 = { ...d0, settings: { ...d0.settings, classrooms: [...d0.settings.classrooms, room] }, exams: d0.exams.map((e) => (e.id === e0.id ? { ...e, classroomIds: ['g3-room'] } : e)) };
    const exam = doc1.exams.find((e) => e.id === e0.id) as ExamConfig;
    const r = reseat(doc1, exam, '2026-11-02T00:00:00Z');
    if (!r.ok) throw new Error(r.error);
    expect(examsAffectedByClear(r.doc, 'junior')).toEqual([{ name: 'bcct測試考', willBeStale: true }]);
  });
  it('按鈕與確認字樣', () => {
    const { doc } = withExam('gsat', fake(2));
    const html = renderToString(<ClearRoster doc={doc} division="senior" onChange={noop} />);
    expect(html).toContain('btn-danger');
    expect(html).toContain('刪除全部名單');
    expect(html).not.toContain('disabled');
    const empty = renderToString(<ClearRoster doc={clearRoster(doc, 'senior')} division="senior" onChange={noop} />);
    expect(empty).toContain('disabled');
    expect(CLEAR_KEYWORD).toBe('刪除全部名單');
  });
});

describe('G10 匯入名單有問題的列：逐列決定，不默默略過', () => {
  const header = ['班級', '座號', '姓名', '學號'];
  const tall = [
    header,
    ['01', '1', '假甲', 'S1'],
    ['01', '2', '', 'S2'], // 第 3 列：缺姓名
    ['01', '1', '假丙', 'S3'], // 第 4 列：班級座號重複
    ['XX', '4', '假丁', 'S4'], // 第 5 列：班級對不上
    ['01', '3A', '假戊', 'S5'], // 第 6 列：座號格式錯誤
    ['01', '6', '假己', 'S1'], // 第 7 列：學號重複
    ['01', '7', '假庚', 'S7'],
  ];
  it('盤點：缺姓名、班級座號重複、班級對不上、座號格式錯誤、學號重複，各自帶出原始檔位置與內容', () => {
    const r = parseRosterWorkbook([{ name: '一年級名冊', rows: tall }], []);
    expect(r.sheetName).toBe('一年級名冊');
    expect(r.students.map((s) => s.name)).toEqual(['假甲', '假庚']);
    expect(r.problems.map((p) => [p.row, p.kind])).toEqual([[3, 'no-name'], [4, 'dup'], [5, 'bad-id'], [6, 'bad-id'], [7, 'dup-school-id']]);
    expect(r.problems[0]!.cells).toEqual(['01', '2', 'S2']);
    expect(r.problems[0]!.draft).toMatchObject({ classNo: 1, seatNo: 2, name: '' });
    expect(r.problems[2]!.draft).toMatchObject({ seatNo: 4, name: '假丁' }); // 班級讀不出來，留給使用者補
    expect(r.problems[2]!.draft.classNo).toBeUndefined();
    expect(Object.values(PROBLEM_KIND_TEXT)).toHaveLength(4);
  });
  it('寬表與區塊版式也回報問題列', () => {
    const wide = [['座號', '姓名', '座號', '姓名'], ['1', '假甲', '1', '假乙'], ['2', '', '2B', '假丙'], ['3', '假丁', '1', '假重']];
    const r = parseRoster(wide, {});
    expect(r.problems.map((p) => p.kind).sort()).toEqual(['bad-id', 'dup', 'no-name']);
    expect(r.problems.every((p) => p.row >= 3 && p.cells.length > 0)).toBe(true);
  });
  it('沒決定前不能確認；「略過」「補上」「修改」逐列決定後合成名單', () => {
    const r = parseRosterWorkbook([{ name: '名冊', rows: tall }], []);
    const none = resolveProblems(r.students, r.problems, {});
    expect(none.ready).toBe(false);
    expect(none.pending).toHaveLength(5);
    expect(problemBlockers(none)).toEqual(['還有 5 列問題沒有決定']);
    const dec: Record<number, ProblemDecision> = {
      0: { action: 'add', classNo: 1, seatNo: 2, name: '補上的名字' }, // 缺姓名 → 補姓名
      1: { action: 'edit', classNo: 1, seatNo: 8, name: '假丙', schoolId: 'S3' }, // 重複 → 改座號
      2: { action: 'edit', classNo: 1, seatNo: 4, name: '假丁' }, // 班級補 1
      3: { action: 'skip' },
      4: { action: 'edit', classNo: 1, seatNo: 6, name: '假己' }, // 學號重複 → 清空學號
    };
    const done = resolveProblems(r.students, r.problems, dec);
    expect(done.ready).toBe(true);
    expect(done.added).toBe(4);
    expect(done.skipped).toBe(1);
    expect(done.students).toHaveLength(6);
    expect(done.students.find((s) => s.name === '假己')?.schoolId).toBeUndefined();
  });
  it('補上的內容不合法（空白、座號格式、撞號、撞學號）一樣不能確認，並說明原因', () => {
    const r = parseRosterWorkbook([{ name: '名冊', rows: tall }], []);
    const bad = resolveProblems(r.students, r.problems, {
      0: { action: 'add', classNo: 1, seatNo: 2, name: ' ' },
      1: { action: 'edit', classNo: 1, seatNo: 1, name: '假丙' }, // 撞「假甲」
      2: { action: 'edit', classNo: 1, seatNo: 100, name: '假丁' },
      3: { action: 'skip' },
      4: { action: 'edit', classNo: 1, seatNo: 6, name: '假己', schoolId: 'S1' }, // 撞學號
    });
    expect(bad.ready).toBe(false);
    expect(bad.invalid[0]).toContain('姓名');
    expect(bad.invalid[1]).toContain('已經有「假甲」');
    expect(bad.invalid[2]).toContain('座號');
    expect(bad.invalid[4]).toContain('學號');
    expect(problemBlockers(bad)).toEqual(['4 列補上的內容還有錯']);
  });
  it('三種類型都能把決定後的名單取代進共用名單（學測、分科＝高中部，會考＝國中部）', () => {
    const r = parseRosterWorkbook([{ name: '名冊', rows: tall }], []);
    const dec: Record<number, ProblemDecision> = Object.fromEntries(r.problems.map((_, i) => [i, { action: 'skip' } as ProblemDecision]));
    for (const kind of KINDS) {
      const { doc } = withExam(kind, fake(1));
      const division = divisionOf(kind);
      const res = resolveProblems(r.students, r.problems, dec);
      const next = applyImport(doc, division, planImport(doc, division, res.students), 'add');
      expect(next.rosters[division].map((s) => s.name)).toEqual(['假甲', '假庚']);
    }
  });
  it('逐列處理介面：位置、原始內容、三個選項，沒有「稍後處理」', () => {
    const html = renderToString(<RowFix where="工作表「名冊」第 3 列" kindText="缺少姓名" message="班級 1 座號 2 沒有姓名，已略過" cells={['01', '2', 'S2']} draft={{ classNo: 1, seatNo: 2, name: '' }} withSchoolId onDecide={noop} />);
    for (const t of ['工作表「名冊」第 3 列', '缺少姓名', '01｜2｜S2', '手動補上（新增）', '修改內容', '略過', '待處理']) expect(html).toContain(t);
    expect(html).not.toContain('稍後');
  });
});
