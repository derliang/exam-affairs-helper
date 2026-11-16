/** #249 效能回歸：分科 ③ 編輯座位不能每次都卡數十秒（約 270 人、20 間班級教室＋4 間綜合教室的假資料） */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Classroom, ExamEntry } from '../../data';
import { demoDoc } from '../repository';
import { newExam, updateExam } from '../store';
import { astPlan, astPlanPending, onAstPlanReady, setPlanDefer } from './model';
import { toggleSeat } from './roomEdit';

const SCI = ['physics', 'chemistry', 'math-jia', 'biology'];
const LIB = ['history', 'geography', 'math-yi', 'civics'];

function big(nCls = 20, nReserve = 4, total = 270) {
  const r = newExam(demoDoc(), 'ast', '分科', new Date('2026-09-01T02:00:00Z'));
  if (!r.ok) throw new Error(r.error);
  let doc = r.doc;
  const e0 = doc.exams[doc.exams.length - 1]!;
  const per = Math.round(total / nCls);
  const sci = (i: number) => i <= nCls / 2;
  const rooms: Classroom[] = Array.from({ length: nCls }, (_, i) => ({ id: `c${i + 1}`, name: `班${i + 1}`, kind: 'class' as const, rows: 6, depth: 7, seatCount: 42, track: sci(i + 1) ? 'science' as const : 'liberal' as const, division: 'senior' as const }));
  for (let k = 1; k <= nReserve; k++) rooms.push({ id: `k${k}`, name: `綜${k}`, kind: 'reserve', rows: 5, depth: 6, seatCount: 30, division: 'senior' });
  const roster = Array.from({ length: nCls }, (_, i) => Array.from({ length: per }, (_, j) => ({ classNo: i + 1, seatNo: j + 1, name: `學生${i + 1}-${j + 1}` }))).flat();
  const entries: ExamEntry[] = roster.map((s) => {
    const ids = (sci(s.classNo) ? SCI : LIB).filter((_, k) => !(s.seatNo % 3 === 0 && k === s.seatNo % 4));
    return { classNo: s.classNo, seatNo: s.seatNo, name: s.name, subjectIds: ids, track: sci(s.classNo) ? 'science' as const : 'liberal' as const };
  });
  doc = { ...doc, settings: { ...doc.settings, classrooms: rooms, classes: Array.from({ length: nCls }, (_, i) => ({ no: i + 1, name: `班${i + 1}`, division: 'senior' as const, track: sci(i + 1) ? 'science' as const : 'liberal' as const, colorIndex: i + 1 })) }, rosters: { ...doc.rosters, senior: roster }, examFiles: { ...(doc.examFiles ?? {}), [e0.id]: { entries } } };
  const u = updateExam(doc, e0.id, { classroomIds: rooms.map((x) => x.id) });
  if (!u.ok) throw new Error(u.error);
  return { doc: u.doc, examId: e0.id };
}

const editSeat = (doc: ReturnType<typeof big>['doc'], depth: number) => {
  const nr = toggleSeat(doc.settings.classrooms[0]!, 1, depth, 56);
  return { ...doc, settings: { ...doc.settings, classrooms: [nr, ...doc.settings.classrooms.slice(1)] } };
};

afterEach(() => { setPlanDefer(false); vi.useRealTimers(); });

describe('#249 ③ 編輯座位的效能', () => {
  it('引擎：270 人、24 間教室重排一次在 2.5 秒內（修前約 4 秒以上；逐組合掃全部教室 → 累計值）', () => {
    const { doc, examId } = big();
    const t0 = performance.now();
    const plan = astPlan(doc, doc.exams.find((e) => e.id === examId)!);
    const ms = performance.now() - t0;
    expect(plan?.infeasible).toBeFalsy();
    expect(ms).toBeLessThan(2500);
  });

  it('③ 延後重算：連續編輯座位不在每次點擊時同步重排，停手後只重算一次並通知畫面', () => {
    vi.useFakeTimers();
    const { doc, examId } = big(12, 3);
    const ex = (d: typeof doc) => d.exams.find((e) => e.id === examId)!;
    const base = astPlan(doc, ex(doc))!; // 第一次進 ③：沒有舊結果，同步算出
    setPlanDefer(true);
    let ready = 0;
    const off = onAstPlanReady(() => { ready++; });
    let d = doc;
    const t0 = performance.now();
    for (let i = 1; i <= 5; i++) {
      d = editSeat(d, i);
      expect(astPlan(d, ex(d))).toBe(base); // 還沒重算：沿用上一份
      expect(astPlanPending()).toBe(true);
    }
    expect(performance.now() - t0).toBeLessThan(300); // 五次編輯合計 < 300ms（修前每次都是整次重排）
    expect(ready).toBe(0);
    vi.advanceTimersByTime(400);
    expect(astPlanPending()).toBe(false);
    expect(ready).toBe(1);
    const fresh = astPlan(d, ex(d))!; // 命中快取，是精確結果
    expect(fresh).not.toBe(base);
    expect(fresh.input.rooms[0]!.seats.length).toBe(base.input.rooms[0]!.seats.length - 5);
    off();
  });

  it('考生變了（不是只改教室）就不沿用舊結果，一律同步重算', () => {
    vi.useFakeTimers();
    const { doc, examId } = big(8, 2, 120);
    const ex = (d: typeof doc) => d.exams.find((e) => e.id === examId)!;
    const base = astPlan(doc, ex(doc))!;
    setPlanDefer(true);
    const entries = doc.examFiles![examId]!.entries!.slice(1);
    const d2 = { ...doc, examFiles: { ...doc.examFiles, [examId]: { entries } } };
    const p2 = astPlan(d2, ex(d2))!;
    expect(p2).not.toBe(base);
    expect(astPlanPending()).toBe(false);
  });

  it('不開延後（④⑤⑥ 等）永遠同步拿到精確結果', () => {
    const { doc, examId } = big(8, 2, 120);
    const ex = (d: typeof doc) => d.exams.find((e) => e.id === examId)!;
    const base = astPlan(doc, ex(doc))!;
    const d = editSeat(doc, 1);
    const p = astPlan(d, ex(d))!;
    expect(p).not.toBe(base);
    expect(astPlanPending()).toBe(false);
  });
});
