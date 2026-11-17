/**
 * 補考統計（F-17～F-19）：班級×科目矩陣、各科總計、選組拆分、各生科數分布、另行通知清單。
 * 輸入是處理完問題列的名單（MakeupRoster），不看排程。
 */
import { GRADE_ORDER, GRADE_TEXT, divisionOf, gradeOfClass } from './importRows';
import type { GradeKey, MakeupDivision, MakeupRoster, MakeupRow, TrackSplit } from './types';

/** 一筆納入排程的「學生＋科目」（人次） */
export interface MakeupEntry {
  studentId: string;
  name: string;
  oldClass: string;
  oldSeat: number;
  grade: GradeKey;
  /** 科目鍵（選組拆分後，例「歷史〔文組〕」） */
  subject: string;
  /** 卷鍵（年級＋科目鍵，例「高一 數學」） */
  paper: string;
  rowId: string;
}

export const entryKey = (studentId: string, subject: string): string => `${studentId}|${subject}`;
export const paperKey = (grade: GradeKey, subject: string): string => `${GRADE_TEXT[grade]} ${subject}`;

/** 科目鍵：選組拆分的科目依班級文理組加〔文組〕〔理組〕；查不到組別就不拆 */
export function subjectKeyOf(row: Pick<MakeupRow, 'subjectName' | 'oldClass'>, split?: TrackSplit): string {
  if (!split || !split.subjects.includes(row.subjectName)) return row.subjectName;
  const t = split.trackOfClass[row.oldClass];
  return t ? `${row.subjectName}〔${t}〕` : row.subjectName;
}

/** 名單 → 人次清單（只含納入排程的列） */
export function makeupEntries(roster: Pick<MakeupRoster, 'included' | 'gradeOfClass'>, split?: TrackSplit): MakeupEntry[] {
  return roster.included.map((r) => {
    const grade = roster.gradeOfClass[r.oldClass] ?? gradeOfClass(r.oldClass) ?? 'S1';
    const subject = subjectKeyOf(r, split);
    return { studentId: r.studentId, name: r.name, oldClass: r.oldClass, oldSeat: r.oldSeat, grade, subject, paper: paperKey(grade, subject), rowId: r.rowId };
  });
}

const collator = new Intl.Collator('zh-Hant', { numeric: true });

/** 班級排序：年級（初一→高三）再依班名自然排序 */
export function compareClass(gradeOf: Record<string, GradeKey>) {
  return (a: string, b: string): number => {
    const ga = GRADE_ORDER.indexOf(gradeOf[a] ?? 'S3');
    const gb = GRADE_ORDER.indexOf(gradeOf[b] ?? 'S3');
    return ga - gb || collator.compare(a, b);
  };
}

/** 學生排序：班級、座號、學號（座位表與點名單依此，D119） */
export function compareStudent(gradeOf: Record<string, GradeKey>) {
  const cc = compareClass(gradeOf);
  return (a: { oldClass: string; oldSeat: number; studentId: string }, b: { oldClass: string; oldSeat: number; studentId: string }): number =>
    cc(a.oldClass, b.oldClass) || a.oldSeat - b.oldSeat || collator.compare(a.studentId, b.studentId);
}

export interface ClassSubjectMatrix {
  division: MakeupDivision;
  classes: string[];
  /** 依人數多到少，同數依名稱 */
  subjects: string[];
  /** cells[班][科] 人次；沒有就是 0（不存） */
  cells: Record<string, Record<string, number>>;
  classTotals: Record<string, number>;
  subjectTotals: Record<string, number>;
  total: number;
}

/** F-17：班級×科目矩陣，初中、高中分開 */
export function classSubjectMatrix(entries: readonly MakeupEntry[]): ClassSubjectMatrix[] {
  const gradeOf: Record<string, GradeKey> = {};
  for (const e of entries) gradeOf[e.oldClass] = e.grade;
  const out: ClassSubjectMatrix[] = [];
  for (const division of ['senior', 'junior'] as const) {
    const es = entries.filter((e) => divisionOf(e.grade) === division);
    if (es.length === 0) continue;
    const cells: Record<string, Record<string, number>> = {};
    const classTotals: Record<string, number> = {};
    const subjectTotals: Record<string, number> = {};
    for (const e of es) {
      const row = (cells[e.oldClass] ??= {});
      row[e.subject] = (row[e.subject] ?? 0) + 1;
      classTotals[e.oldClass] = (classTotals[e.oldClass] ?? 0) + 1;
      subjectTotals[e.subject] = (subjectTotals[e.subject] ?? 0) + 1;
    }
    const classes = Object.keys(cells).sort(compareClass(gradeOf));
    const subjects = Object.keys(subjectTotals).sort((a, b) => (subjectTotals[b] ?? 0) - (subjectTotals[a] ?? 0) || collator.compare(a, b));
    out.push({ division, classes, subjects, cells, classTotals, subjectTotals, total: es.length });
  }
  return out;
}

/** 各卷人數（備卷依據）：卷鍵 → 人次 */
export function paperTotals(entries: readonly MakeupEntry[]): Record<string, number> {
  const t: Record<string, number> = {};
  for (const e of entries) t[e.paper] = (t[e.paper] ?? 0) + 1;
  return t;
}

export interface NotifiedSummary {
  /** 科目 → 人次 */
  bySubject: Record<string, number>;
  total: number;
  /** 只有另行通知科目的學生（不會出現在考程，但在 C-2 學生對帳） */
  notifiedOnly: string[];
}

/** F-18：另行通知科目清單與人數 */
export function notifiedSummary(roster: Pick<MakeupRoster, 'included' | 'notified'>): NotifiedSummary {
  const bySubject: Record<string, number> = {};
  for (const r of roster.notified) bySubject[r.subjectName] = (bySubject[r.subjectName] ?? 0) + 1;
  const inc = new Set(roster.included.map((r) => r.studentId));
  const notifiedOnly = [...new Set(roster.notified.map((r) => r.studentId))].filter((id) => !inc.has(id)).sort();
  return { bySubject, total: roster.notified.length, notifiedOnly };
}

export interface CountDistribution {
  /** 科數 → 學生數，依科數遞增 */
  rows: { subjects: number; students: number }[];
  students: number;
  entries: number;
}

/** F-19：每位學生的科數分布（Σ 科數×人數 ＝ 人次） */
export function subjectCountDistribution(entries: readonly MakeupEntry[]): CountDistribution {
  const per = new Map<string, number>();
  for (const e of entries) per.set(e.studentId, (per.get(e.studentId) ?? 0) + 1);
  const dist = new Map<number, number>();
  for (const n of per.values()) dist.set(n, (dist.get(n) ?? 0) + 1);
  const rows = [...dist.entries()].sort((a, b) => a[0] - b[0]).map(([subjects, students]) => ({ subjects, students }));
  return { rows, students: per.size, entries: entries.length };
}

/** 學生 → 他的科目（依科目鍵排序） */
export function subjectsByStudent(entries: readonly MakeupEntry[]): Map<string, MakeupEntry[]> {
  const m = new Map<string, MakeupEntry[]>();
  for (const e of entries) {
    const a = m.get(e.studentId);
    if (a) a.push(e);
    else m.set(e.studentId, [e]);
  }
  for (const a of m.values()) a.sort((x, y) => collator.compare(x.subject, y.subject));
  return m;
}
