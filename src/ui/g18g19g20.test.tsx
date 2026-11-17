/** 批次 C「名單與匯入」G18 G19 G20：學測、分科、會考三種類型各測一遍（只用假資料） */
import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import type { ExamConfig, Student } from '../data';
import { compareRosters } from '../import';
import { applyImport, planImport } from './rosterIO';
import { CONFIRMABLE, resolveProblems, type ProblemDecision } from './rosterProblems';
import { parseRosterWorkbook } from './step2';
import { Step2 } from './pages/Step2';
import { ImportWizard } from './pages/ImportWizard';
import { RowFix, classLabel, humanizeClasses } from './pages/RowFix';
import { demoDoc } from './repository';
import { newExam, type Doc } from './store';

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

describe('G18 問題列用真實班名', () => {
  it('有班名用班名；沒有名稱才寫「未命名班級（第 N 班）」', () => {
    expect(classLabel(4, ['甲', '乙', '丙', '丁'])).toBe('丁班');
    expect(classLabel(4, [])).toBe('未命名班級（第 4 班）');
    expect(classLabel(2, ['甲', ' '])).toBe('未命名班級（第 2 班）');
    expect(humanizeClasses('第 4 班座號 17 沒有姓名', ['甲', '乙', '丙', '丁'])).toBe('丁班座號 17 沒有姓名');
    expect(humanizeClasses('班級 4 座號 17 重複', [])).toBe('未命名班級（第 4 班） 座號 17 重複');
  });
  it('RowFix：說明用真實班名、三個明顯按鈕（aria-pressed）、缺姓名可確認無誤、班號重複不可', () => {
    const base = { where: '工作表「高三」第 9 列', cells: ['4', '17'], draft: { classNo: 4, seatNo: 17, name: '' }, onDecide: noop, classNames: ['甲', '乙', '丙', '丁'] };
    const a = renderToString(<RowFix {...base} kindText="缺少姓名" message="第 4 班座號 17 沒有姓名，已略過" confirmHint="保留為空位" />);
    expect(a).toContain('丁班座號 17 沒有姓名');
    expect(a).not.toContain('第 4 班');
    for (const t of ['手動補上（新增）', '修改內容', '確認無誤', '不匯入這列', 'aria-pressed']) expect(a).toContain(t);
    expect(a).not.toContain('略過');
    expect(a).toContain('min-height:44px');
    const b = renderToString(<RowFix {...base} kindText="班級與座號重複" message="班級 4 座號 17 重複，已略過這一列" />);
    expect(b).not.toContain('確認無誤');
    expect(b).toContain('不匯入這列');
  });
  it('只有缺姓名、學號重複可確認無誤', () => {
    expect([...CONFIRMABLE].sort()).toEqual(['dup-school-id', 'no-name']);
  });
  const rows = [
    ['班級', '座號', '姓名', '學號'],
    ['01', '1', '假甲', 'S1'],
    ['01', '2', '', 'S2'], // 缺姓名
    ['01', '1', '假丙', 'S3'], // 班座重複
    ['01', '6', '假己', 'S1'], // 學號重複
  ];
  for (const kind of KINDS) {
    it(`${kind}：確認無誤＝缺姓名保留空位不建學生、學號重複照原樣匯入；其他類型確認無誤不成立`, () => {
      const r = parseRosterWorkbook([{ name: '名冊', rows }], []);
      const kinds = r.problems.map((p) => p.kind);
      expect(kinds).toEqual(['no-name', 'dup', 'dup-school-id']);
      const dec: Record<number, ProblemDecision> = { 0: { action: 'confirm' }, 1: { action: 'skip' }, 2: { action: 'confirm' } };
      const res = resolveProblems(r.students, r.problems, dec);
      expect(res.ready).toBe(true);
      expect(res.confirmed).toBe(2);
      expect(res.students.map((s) => s.name)).toEqual(['假甲', '假己']); // 缺姓名沒建學生
      const { doc } = withExam(kind, []);
      const division = divisionOf(kind);
      const next = applyImport(doc, division, planImport(doc, division, res.students), 'add');
      expect(next.rosters[division].map((s) => s.name)).toEqual(['假甲', '假己']);
      const bad = resolveProblems(r.students, r.problems, { 0: { action: 'confirm' }, 1: { action: 'confirm' }, 2: { action: 'confirm' } });
      expect(bad.ready).toBe(false);
      expect(bad.invalid[1]).toContain('不能確認無誤');
    });
  }
});

describe('G19 取消「誰會參加」切換：名單沒有的人＝未參加', () => {
  for (const kind of KINDS) {
    it(`${kind}：Step2 沒有切換；compare 一律只算未參加人數`, () => {
      const { doc, exam } = withExam(kind, fake(3));
      const html = renderToString(<Step2 doc={doc} exam={exam} onChange={noop} onToRoster={noop} />);
      for (const t of ['誰會參加', '全部學生參加', '只有部分學生參加']) expect(html).not.toContain(t);
      if (kind !== 'bcct') expect(html).toContain('學生名單＝全體學生'); // 會考沒有考試名單匯入區
      const entries = [{ classNo: 1, seatNo: 1, name: '假生1', subjectIds: [] }];
      const r = compareRosters(fake(3), entries, 'partial');
      expect(r.diffs).toHaveLength(0);
      expect(r.notParticipating).toBe(2);
    });
  }
});

describe('G20 匯入預覽統計一行、用詞統一', () => {
  for (const kind of KINDS) {
    it(`${kind}：統計一行，用「新報名／改報名內容／取消報名／沒變」`, () => {
      const { doc, exam } = withExam(kind, fake(2));
      const sheets = [{ name: '考試名單', rows: [['班級', '座號', '姓名', '組別'], ['01', '1', '假生1', '1'], ['01', '2', '', '1']] }];
      const html = renderToString(<ImportWizard sheets={sheets} exam={exam} classNames={['甲']} saved={{}} onCancel={noop} onDone={noop} />);
      expect(html).toContain('data-stats="oneline"');
      for (const t of ['新報名', '改報名內容', '取消報名', '沒變']) expect(html).toContain(t);
      for (const t of ['>新增<', '>變更<', '>移除<', '>不變<']) expect(html).not.toContain(t);
      expect(html).not.toContain('標示統計：有 0 筆'); // 0 筆不顯示
      expect(doc).toBeTruthy();
    });
  }
});
