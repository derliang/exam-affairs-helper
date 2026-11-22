/** #636 第三種排法「原班應考標 X」走完整畫面管線：排座、輸出、對帳。全部匿名假資料 */
import { describe, expect, it } from 'vitest';
import type { Classroom, ExamEntry } from '../../data';
import { demoDoc } from '../repository';
import { newExam, updateExam } from '../store';
import { gateOf, reconcile } from '../reconcile';
import { astPlan } from './model';
import { astOutputs } from './output';

const NAMES = ['溫', '良', '恭', '儉', '勤', '誠'];
const SCI = ['physics', 'chemistry', 'math-jia', 'biology'];
const LIB = ['history', 'geography', 'math-yi', 'civics'];

function fixture() {
  const r = newExam(demoDoc(), 'ast', '分科第一次', new Date('2026-09-01T02:00:00Z'));
  if (!r.ok) throw new Error(r.error);
  let doc = r.doc;
  const exam0 = doc.exams[doc.exams.length - 1]!;
  const rooms: Classroom[] = NAMES.map((n, i) => ({ id: `c${i + 1}`, name: n, kind: 'class', rows: 7, depth: 7, seatCount: 49, track: i < 3 ? 'science' : 'liberal', division: 'senior' }));
  rooms.push({ id: 'k1', name: '綜合教室一', kind: 'reserve', rows: 5, depth: 5, seatCount: 25, division: 'senior' });
  const roster = NAMES.flatMap((_n, i) => Array.from({ length: 12 }, (_x, j) => ({ classNo: i + 1, seatNo: j + 1, name: `學生${i + 1}${j + 1}` })));
  const entries: ExamEntry[] = roster.map((s) => {
    const sci = s.classNo <= 3;
    const subjectIds = (sci ? SCI : LIB).filter((_, k) => !(s.seatNo % 5 === 0 && k === s.seatNo % 4));
    return { classNo: s.classNo, seatNo: s.seatNo, name: s.name, subjectIds, track: sci ? 'science' : 'liberal' };
  });
  doc = { ...doc, settings: { ...doc.settings, classrooms: rooms, classes: NAMES.map((n, i) => ({ no: i + 1, name: n, division: 'senior' as const, track: i < 3 ? 'science' as const : 'liberal' as const, colorIndex: i + 1 })) }, rosters: { ...doc.rosters, senior: roster }, examFiles: { ...(doc.examFiles ?? {}), [exam0.id]: { entries } } };
  const u = updateExam(doc, exam0.id, { classroomIds: rooms.map((x) => x.id), astMode: 'home-exam' as const });
  if (!u.ok) throw new Error(u.error);
  return { doc: u.doc, exam: u.doc.exams.find((e) => e.id === exam0.id)! };
}

describe('原班應考標 X：畫面管線', () => {
  const { doc, exam } = fixture();
  const plan = astPlan(doc, exam)!;
  it('排座沒有硬性違規、沒有排不進的人、離開原班 0 人', () => {
    expect(plan.infeasible).toBeUndefined();
    expect(plan.errors).toEqual([]);
    expect(plan.unplaced).toBe(0);
    expect(plan.out.metrics!.leaveHome).toBe(0);
  });
  it('輸出與對帳：每人每節只有一個去處，不把本班標 X 的同學當成考試與自習混用', () => {
    const o = astOutputs(doc, exam, plan, 'B4', true);
    expect(o.label.length).toBeGreaterThan(0);
    const r = reconcile(doc, exam, o);
    expect(JSON.stringify(r)).not.toContain('同時有考試');
    expect(r.state).toBe('ready');
    expect(gateOf(r).why).toBe(''); // 沒有紅燈，可以下載
  });
});
