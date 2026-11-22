/** #503（驗收 1.27.28 不通過）：分科教室用途表列順序、自習座位頁序照共用設定的班級順序。全部匿名假資料 */
import { describe, expect, it } from 'vitest';
import type { ClassInfo, Classroom, ExamEntry } from '../../data';
import { demoDoc } from '../repository';
import type { Doc } from '../store';
import { newExam, updateExam } from '../store';
import { astPlan } from './model';
import { astOutputs } from './output';

const NAMES = ['溫', '良', '恭', '儉'];
const SCI = ['physics', 'chemistry', 'math-jia', 'biology'];
const LIB = ['history', 'geography', 'math-yi', 'civics'];

function fixture(order: string[]) {
  const r = newExam(demoDoc(), 'ast', '分科第一次', new Date('2026-09-01T02:00:00Z'));
  if (!r.ok) throw new Error(r.error);
  const exam0 = r.doc.exams[r.doc.exams.length - 1]!;
  const rooms: Classroom[] = NAMES.map((n, i) => ({ id: `c${i + 1}`, name: n, kind: 'class', rows: 7, depth: 7, seatCount: 49, track: i < 2 ? 'science' : 'liberal', division: 'senior' }));
  rooms.push({ id: 'k1', name: '綜合教室一', kind: 'reserve', rows: 5, depth: 5, seatCount: 25, division: 'senior' });
  const roster = NAMES.flatMap((_n, i) => Array.from({ length: 12 }, (_x, j) => ({ classNo: i + 1, seatNo: j + 1, name: `學生${i + 1}${j + 1}` })));
  const entries: ExamEntry[] = roster.map((s) => {
    const sci = s.classNo <= 2;
    const subjectIds = (sci ? SCI : LIB).filter((_, k) => !(s.seatNo % 5 === 0 && k === s.seatNo % 4));
    return { classNo: s.classNo, seatNo: s.seatNo, name: s.name, subjectIds, track: sci ? 'science' : 'liberal' };
  });
  const classes: ClassInfo[] = order.map((n) => { const i = NAMES.indexOf(n); return { no: i + 1, name: n, division: 'senior', track: i < 2 ? 'science' : 'liberal', colorIndex: i + 1 }; });
  let doc: Doc = { ...r.doc, settings: { ...r.doc.settings, classrooms: rooms, classes }, rosters: { ...r.doc.rosters, senior: roster }, examFiles: { ...(r.doc.examFiles ?? {}), [exam0.id]: { entries } } };
  const u = updateExam(doc, exam0.id, { classroomIds: rooms.map((x) => x.id), astFixedStudyRooms: ['k1'] });
  if (!u.ok) throw new Error(u.error);
  doc = u.doc;
  return { doc, exam: doc.exams.find((e) => e.id === exam0.id)! };
}

describe('#503 分科：教室順序照班級順序', () => {
  const { doc, exam } = fixture(['恭', '儉', '溫', '良']);
  const plan = astPlan(doc, exam)!;
  const o = astOutputs(doc, exam, plan, 'B4', true);
  it('每節教室用途表：班級教室依 恭、儉、溫、良，綜合教室排後面', () => {
    const use = o.use.find((t) => t.title.includes('每節教室用途表'))!;
    expect(use.rows.map((r) => r[0]).filter((n) => NAMES.includes(n!) || n!.includes('綜合'))).toEqual(['恭', '儉', '溫', '良', '綜合教室一']);
  });
});
