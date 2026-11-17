/** G35 對帳測試與畫面實操用的虛構資料（學測、會考、分科）：全部是「假生」「甲乙丙班」這類代號，不含任何真實學生資料。 */
import type { ClassInfo, Classroom, ExamConfig, ExamEntry, Student } from '../data';
import { demoDoc, emptyDoc } from './repository';
import { newExam, updateExam, type Doc } from './store';
import { autoSeat } from './seating';

export const NOW = new Date('2026-11-10T02:00:00Z');
export const NAMES = ['溫', '良', '恭', '儉', '勤', '誠'];

/** 學測：三班各 10 人，教室夠大；每班座號 4、8 不考數學（標示 X），預備教室可容納抽離自習 */
export function gsatDoc(opts: { absentRoster?: number } = {}): { doc: Doc; exam: ExamConfig } {
  const classes: ClassInfo[] = NAMES.slice(0, 3).map((name, i) => ({ no: i + 1, name, division: 'senior', colorIndex: i + 1, track: i === 1 ? 'liberal' : 'science' }));
  const roster: Student[] = classes.flatMap((c) => Array.from({ length: 10 }, (_, k) => ({ classNo: c.no, seatNo: k + 1, name: `假生${c.no}${String(k + 1).padStart(2, '0')}` })));
  const rooms: Classroom[] = [
    ...classes.map((c): Classroom => ({ id: `c${c.no}`, name: c.name, kind: 'class', rows: 5, depth: 5, seatCount: 25, division: 'senior', track: c.track })),
    { id: 'k1', name: '預備一', kind: 'reserve', rows: 3, depth: 4, seatCount: 12, division: 'senior' },
    { id: 'k2', name: '預備二', kind: 'reserve', rows: 3, depth: 4, seatCount: 12, division: 'senior' },
  ];
  const base = emptyDoc();
  let doc: Doc = { ...base, settings: { ...base.settings, classes, classrooms: rooms }, rosters: { senior: roster, junior: [] } };
  const r = newExam(doc, 'gsat', '假學測', NOW);
  if (!r.ok) throw new Error(r.error);
  doc = r.doc;
  const exam0 = doc.exams[0]!;
  const ids = exam0.subjects.map((s) => s.id);
  const math = ids.find((id) => /ma/.test(id)) ?? ids[2]!;
  const entries: ExamEntry[] = roster.filter((s) => s.seatNo <= 10 - (opts.absentRoster ?? 0)).map((s) => ({ classNo: s.classNo, seatNo: s.seatNo, name: s.name, subjectIds: s.seatNo % 4 === 0 ? ids.filter((i) => i !== math) : [...ids] }));
  doc = { ...doc, examFiles: { ...(doc.examFiles ?? {}), [exam0.id]: { entries, diffs: [], overrides: [] } } };
  const u = updateExam(doc, exam0.id, { classroomIds: rooms.map((x) => x.id), markRules: [{ track: 'science', subjectId: math, mode: 'mark-absent' }, { track: 'liberal', subjectId: math, mode: 'mark-absent' }] });
  if (!u.ok) throw new Error(u.error);
  doc = u.doc;
  const exam = doc.exams[0]!;
  const s = autoSeat(doc, exam, '2026-11-10T03:00:00Z');
  if (!s || !s.ok) throw new Error(`排座失敗 ${JSON.stringify(s)}`);
  return { doc: s.doc, exam: s.doc.exams[0]! };
}


export function bcctDoc(): { doc: Doc; exam: ExamConfig } {
  const classes: ClassInfo[] = ['甲', '乙'].map((name, i) => ({ no: i + 1, name, division: 'junior', colorIndex: i + 1 }));
  const roster: Student[] = classes.flatMap((c) => Array.from({ length: 10 }, (_, k) => ({ classNo: c.no, seatNo: k + 1, name: `假生${c.no}${String(k + 1).padStart(2, '0')}` })));
  const rooms: Classroom[] = classes.map((c) => ({ id: `j${c.no}`, name: c.name, kind: 'class', rows: 5, depth: 5, seatCount: 25, division: 'junior' }));
  const base = emptyDoc();
  let doc: Doc = { ...base, settings: { ...base.settings, classes, classrooms: rooms }, rosters: { senior: [], junior: roster } };
  const r = newExam(doc, 'bcct', '假會考', NOW);
  if (!r.ok) throw new Error(r.error);
  doc = r.doc;
  const u = updateExam(doc, doc.exams[0]!.id, { classroomIds: rooms.map((x) => x.id) });
  if (!u.ok) throw new Error(u.error);
  doc = u.doc;
  const s = autoSeat(doc, doc.exams[0]!, '2026-11-10T03:00:00Z');
  if (!s || !s.ok) throw new Error(`排座失敗 ${JSON.stringify(s)}`);
  return { doc: s.doc, exam: s.doc.exams[0]! };
}

const SCI = ['physics', 'chemistry', 'math-jia', 'biology'];
const LIB = ['history', 'geography', 'math-yi', 'civics'];
export function astDoc(per = 12, reserveSeats = 12, skipEvery = 5): { doc: Doc; exam: ExamConfig } {
  const r = newExam(demoDoc(), 'ast', '分科假考', NOW);
  if (!r.ok) throw new Error(r.error);
  let doc = r.doc;
  const exam0 = doc.exams[doc.exams.length - 1]!;
  const rooms: Classroom[] = NAMES.map((n, i) => ({ id: `c${i + 1}`, name: n, kind: 'class', rows: 7, depth: 7, seatCount: 49, track: i < 3 ? 'science' : 'liberal', division: 'senior' }));
  rooms.push({ id: 'k1', name: '綜合教室一', kind: 'reserve', rows: 3, depth: 4, seatCount: reserveSeats, division: 'senior' });
  const roster = NAMES.flatMap((_, i) => Array.from({ length: per }, (__, j) => ({ classNo: i + 1, seatNo: j + 1, name: `學生${i + 1}${j + 1}` })));
  const entries: ExamEntry[] = roster.map((s) => {
    const sci = s.classNo <= 3;
    return { classNo: s.classNo, seatNo: s.seatNo, name: s.name, subjectIds: (sci ? SCI : LIB).filter((_, k) => !(s.seatNo % skipEvery === 0 && k === s.seatNo % 4)), track: sci ? 'science' : 'liberal' };
  });
  doc = { ...doc, settings: { ...doc.settings, classrooms: rooms, classes: NAMES.map((n, i) => ({ no: i + 1, name: n, division: 'senior' as const, track: i < 3 ? 'science' as const : 'liberal' as const, colorIndex: i + 1 })) }, rosters: { ...doc.rosters, senior: roster }, examFiles: { ...(doc.examFiles ?? {}), [exam0.id]: { entries } } };
  const u = updateExam(doc, exam0.id, { classroomIds: rooms.map((x) => x.id) });
  if (!u.ok) throw new Error(u.error);
  return { doc: u.doc, exam: u.doc.exams.find((e) => e.id === exam0.id)! };
}

