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
  // 有不參加者時（D137 起他們進排座、算進標示人數），數學不考的比例接近一半，照使用者會做的選擇鎖定 X；沒有不參加者時與舊版相同
  const lock = opts.absentRoster ? { locked: true } : {};
  const u = updateExam(doc, exam0.id, { classroomIds: rooms.map((x) => x.id), markRules: [{ track: 'science', subjectId: math, mode: 'mark-absent', ...lock }, { track: 'liberal', subjectId: math, mode: 'mark-absent', ...lock }] });
  if (!u.ok) throw new Error(u.error);
  doc = u.doc;
  const exam = doc.exams[0]!;
  const s = autoSeat(doc, exam, '2026-11-10T03:00:00Z');
  if (!s || !s.ok) throw new Error(`排座失敗 ${JSON.stringify(s)}`);
  return { doc: s.doc, exam: s.doc.exams[0]! };
}


/**
 * 理組 1～3 班 46／46／47 人、文組 4～6 班 44／44／43 人，共 270。
 * 理組：11 人不考數B、46 人不考社會，其餘全考；文組：2 人考自然、39 人考數A、全部考數B（libMathB='none' 則全不考數B）。
 * junior：另有國中部 1～6 班（沒有組別），排在高中班之後，與高中班號重疊（真實學校常見）。
 * notJoined：第 1、4 班各最後 N 人不在考試名單（不參加，#400 WP-1 的實測情境）；fullyAbsent：第 2、5 班各前 N 人全科缺考（名單上沒有考科）；
 * reserve2：多一間預備教室（49 座）；noSeat：不自動排座（測容量不足時用）。
 */
export function gsat270Doc(opts: { junior?: boolean; libMathB?: 'all' | 'none'; notJoined?: number; fullyAbsent?: number; reserve2?: boolean; noSeat?: boolean } = {}) {
  const sizes = [46, 46, 47, 44, 44, 43];
  const classes: ClassInfo[] = NAMES.map((name, i) => ({ no: i + 1, name, division: 'senior', colorIndex: i + 1, track: i < 3 ? 'science' : 'liberal' }));
  const juniorClasses: ClassInfo[] = opts.junior ? NAMES.map((name, i) => ({ no: i + 1, name: `國${name}`, division: 'junior', colorIndex: i + 1 })) : [];
  const roster: Student[] = classes.flatMap((c, i) => Array.from({ length: sizes[i]! }, (_, k) => ({ classNo: c.no, seatNo: k + 1, name: `假生${c.no}${String(k + 1).padStart(2, '0')}` })));
  const rooms: Classroom[] = [
    ...classes.map((c): Classroom => ({ id: `c${c.no}`, name: c.name, kind: 'class', rows: 7, depth: 7, seatCount: 49, division: 'senior', track: c.track })),
    { id: 'k1', name: '預備一', kind: 'reserve', rows: 7, depth: 7, seatCount: 49, division: 'senior' },
    ...(opts.reserve2 ? [{ id: 'k2', name: '預備二', kind: 'reserve', rows: 7, depth: 7, seatCount: 49, division: 'senior' } as Classroom] : []),
  ];
  const base = emptyDoc();
  let doc: Doc = { ...base, settings: { ...base.settings, classes: [...classes, ...juniorClasses], classrooms: rooms }, rosters: { senior: roster, junior: [] } };
  const r = newExam(doc, 'gsat', '假學測四', NOW, { round: 4 });
  if (!r.ok) throw new Error(r.error);
  doc = r.doc;
  const exam0 = doc.exams[0]!;
  let sciN = 0; let libN = 0;
  const entries: ExamEntry[] = roster.map((s) => {
    const ids = new Set(['chinese', 'english', 'math-a', 'math-b', 'social', 'science']);
    if (s.classNo <= 3) {
      sciN++;
      if (sciN <= 11) ids.delete('math-b');
      else if (sciN <= 57) ids.delete('social');
    } else {
      libN++;
      if (opts.libMathB === 'none') ids.delete('math-b');
      if (libN > 2) ids.delete('science');
      if (libN > 39) ids.delete('math-a');
    }
    const absent = (s.classNo === 2 || s.classNo === 5) && s.seatNo <= (opts.fullyAbsent ?? 0);
    return { classNo: s.classNo, seatNo: s.seatNo, name: s.name, subjectIds: absent ? [] : exam0.subjects.map((x) => x.id).filter((id) => ids.has(id)) };
  }).filter((e) => !((e.classNo === 1 || e.classNo === 4) && e.seatNo > sizes[e.classNo - 1]! - (opts.notJoined ?? 0)));
  doc = { ...doc, examFiles: { ...(doc.examFiles ?? {}), [exam0.id]: { entries, diffs: [], overrides: [] } } };
  const u = updateExam(doc, exam0.id, { classroomIds: rooms.map((x) => x.id) });
  if (!u.ok) throw new Error(u.error);
  doc = u.doc;
  if (opts.noSeat) return { doc, exam: doc.exams[0]! };
  const s = autoSeat(doc, doc.exams[0]!, '2026-11-18T03:00:00Z');
  if (!s || !s.ok) throw new Error(`排座失敗 ${JSON.stringify(s)}`);
  return { doc: s.doc, exam: s.doc.exams[0]! };
}


/** 會考：甲乙兩班各 10 人。missing／fullyAbsent：改成匯入考試名單，甲班最後 N 人不在名單、乙班前 N 人全科缺考（WP-5：會考名冊每人都要排座） */
export function bcctDoc(opts: { missing?: number; fullyAbsent?: number } = {}): { doc: Doc; exam: ExamConfig } {
  const classes: ClassInfo[] = ['甲', '乙'].map((name, i) => ({ no: i + 1, name, division: 'junior', colorIndex: i + 1 }));
  const roster: Student[] = classes.flatMap((c) => Array.from({ length: 10 }, (_, k) => ({ classNo: c.no, seatNo: k + 1, name: `假生${c.no}${String(k + 1).padStart(2, '0')}` })));
  const rooms: Classroom[] = classes.map((c) => ({ id: `j${c.no}`, name: c.name, kind: 'class', rows: 5, depth: 5, seatCount: 25, division: 'junior' }));
  const base = emptyDoc();
  let doc: Doc = { ...base, settings: { ...base.settings, classes, classrooms: rooms }, rosters: { senior: [], junior: roster } };
  const r = newExam(doc, 'bcct', '假會考', NOW);
  if (!r.ok) throw new Error(r.error);
  doc = r.doc;
  if (opts.missing || opts.fullyAbsent) {
    const e0 = doc.exams[0]!;
    const all = e0.subjects.map((x) => x.id);
    const entries: ExamEntry[] = roster
      .filter((s) => !(s.classNo === 1 && s.seatNo > 10 - (opts.missing ?? 0)))
      .map((s) => ({ classNo: s.classNo, seatNo: s.seatNo, name: s.name, subjectIds: s.classNo === 2 && s.seatNo <= (opts.fullyAbsent ?? 0) ? [] : [...all] }));
    doc = { ...doc, examFiles: { ...(doc.examFiles ?? {}), [e0.id]: { entries, diffs: [], overrides: [] } } };
  }
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

