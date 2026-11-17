/** G36 分科輸出：自習參考座位頁（每時段每間自習教室一頁、格內班級座號姓名、考試中保留座位）、取消勾選就不出、標籤不受影響。全部匿名假資料 */
import { describe, expect, it } from 'vitest';
import type { Classroom, ExamEntry } from '../../data';
import { demoDoc } from '../repository';
import { newExam, updateExam } from '../store';
import { astPlan } from './model';
import { astOutputs } from './output';

const NAMES = ['溫', '良', '恭', '儉', '勤', '誠'];
const SCI = ['physics', 'chemistry', 'math-jia', 'biology'];
const LIB = ['history', 'geography', 'math-yi', 'civics'];

function fixture(fixed: boolean) {
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
  const u = updateExam(doc, exam0.id, { classroomIds: rooms.map((x) => x.id), ...(fixed ? { astFixedStudyRooms: ['k1'] } : {}) });
  if (!u.ok) throw new Error(u.error);
  return { doc: u.doc, exam: u.doc.exams.find((e) => e.id === exam0.id)! };
}

describe('G36 分科自習參考座位頁', () => {
  const { doc, exam } = fixture(true);
  const plan = astPlan(doc, exam)!;
  it('固定自習教室 k1：每個有人自習的時段一頁，格內寫班級座號姓名，去考試的人標「考試中」', () => {
    const o = astOutputs(doc, exam, plan, 'B4', true);
    const refs = o.seat.filter((p) => p.title.includes('自習參考座位'));
    expect(refs.length).toBeGreaterThan(0);
    for (const p of refs) {
      expect(p.roomName).toContain('綜合教室一');
      for (const c of p.cells.values()) { expect(c.ref).toBe(true); expect(c.classLabel).not.toBe(''); expect(c.name).not.toBe(''); expect(c.code).toMatch(/^\d{4}$/); }
      expect(p.chips[0]).toContain('非考試座位');
    }
    expect(refs.some((p) => [...p.cells.values()].some((c) => c.corners?.[0]?.text === '考試中'))).toBe(true);
    expect(plan.out.exams.some((e) => e.roomId === 'k1')).toBe(false); // 固定自習教室全程不當考場
  });
  it('取消勾選：參考頁不出；標籤、其他檔案與版本碼不變', () => {
    const on = astOutputs(doc, exam, plan, 'B4', true);
    const off = astOutputs(doc, exam, plan, 'B4', false);
    expect(off.seat.some((p) => p.title.includes('自習參考座位'))).toBe(false);
    expect(on.label).toEqual(off.label);
    expect(on.version).toBe(off.version);
    expect(on.seat.length).toBeGreaterThan(off.seat.length);
  });
});
