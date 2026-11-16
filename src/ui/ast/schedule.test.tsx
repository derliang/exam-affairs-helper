/** 分科時程、鎖定、請假、版本、跨次沿用（AST-3）：T-15～T-20、T-24～T-26 與可重現（T-21）。全部匿名假資料。 */
import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import type { Classroom, ExamConfig, ExamEntry } from '../../data';
import { demoDoc } from '../repository';
import { newExam, updateExam, type Doc } from '../store';
import { checkPlan, codeOf } from '../../core/astD99/contract';
import { buildCandidates, scheduleConflicts, scheduleNeedsApproval } from '../../core/astD99/schedule';
import { estimateStudy, finalize, publish, unfinalize, diffSnap, exportVersions, parseVersions, versionsImportBlock } from '../../core/astD99/release';
import { scheduleOf } from '../../core/periods';
import { examEntries } from '../seating';
import { ScheduleCard } from './AstSchedule';
import { seatsOfPlan } from '../../core/astD99/refine';
import { astBaseDays, astCandidates, astFinalizeBlockers, astFingerprint, astInput, astPlan, astSlots, astSnapshotMismatch, carrySource } from './model';
import { astOutputBlockers, astOutputs } from './output';
import { AstStep3 } from './AstStep3';
import { AstStep4 } from './AstStep4';
import { AstStep5 } from './AstStep5';
import { AstStep6 } from './AstStep6';

const NAMES = ['溫', '良', '恭', '儉', '勤', '誠'];
const SCI = ['physics', 'chemistry', 'math-jia', 'biology'];
const LIB = ['history', 'geography', 'math-yi', 'civics'];

/** 6 個班各 per 人、6 間 7×7 班級教室、1 間綜合教室；理組班考理科、文組班考文科；座號 5 的倍數的人有一科不考 */
function fixture(per = 12, extra?: (e: ExamEntry) => ExamEntry): { doc: Doc; exam: ExamConfig } {
  const r = newExam(demoDoc(), 'ast', '分科第一次', new Date('2026-09-01T02:00:00Z'));
  if (!r.ok) throw new Error(r.error);
  let doc = r.doc;
  let exam = doc.exams[doc.exams.length - 1]!;
  const rooms: Classroom[] = NAMES.map((n, i) => ({ id: `c${i + 1}`, name: n, kind: 'class', rows: 7, depth: 7, seatCount: 49, track: i < 3 ? 'science' : 'liberal', division: 'senior' }));
  rooms.push({ id: 'k1', name: '綜合教室一', kind: 'reserve', rows: 3, depth: 4, seatCount: 12, division: 'senior' });
  const roster = NAMES.flatMap((_, i) => Array.from({ length: per }, (__, j) => ({ classNo: i + 1, seatNo: j + 1, name: `學生${i + 1}${j + 1}` })));
  const entries: ExamEntry[] = roster.map((s) => {
    const sci = s.classNo <= 3;
    const subjectIds = (sci ? SCI : LIB).filter((_, k) => !(s.seatNo % 5 === 0 && k === s.seatNo % 4));
    const e: ExamEntry = { classNo: s.classNo, seatNo: s.seatNo, name: s.name, subjectIds, track: sci ? 'science' : 'liberal' };
    return extra ? extra(e) : e;
  });
  doc = { ...doc, settings: { ...doc.settings, classrooms: rooms, classes: NAMES.map((n, i) => ({ no: i + 1, name: n, division: 'senior' as const, track: i < 3 ? 'science' as const : 'liberal' as const, colorIndex: i + 1 })) }, rosters: { ...doc.rosters, senior: roster }, examFiles: { ...(doc.examFiles ?? {}), [exam.id]: { entries } } };
  const u = updateExam(doc, exam.id, { classroomIds: rooms.map((x) => x.id) });
  if (!u.ok) throw new Error(u.error);
  doc = u.doc;
  exam = doc.exams.find((e) => e.id === exam.id)!;
  return { doc, exam };
}
const patch = (doc: Doc, exam: ExamConfig, p: Partial<ExamConfig>): { doc: Doc; exam: ExamConfig } => {
  const r = updateExam(doc, exam.id, p);
  if (!r.ok) throw new Error(r.error);
  return { doc: r.doc, exam: r.doc.exams.find((e) => e.id === exam.id)! };
};

// ───── 時程（T-19、T-20） ─────

describe('分科時程推薦（T-19、T-20）', () => {
  const { doc, exam } = fixture();
  const cands = astCandidates(doc, exam);
  const by = (id: string) => cands.find((c) => c.id === id)!;

  it('四個候選：A 基準、B 調序無改善、C 文理同節、D 縮成一天；基準取自節次表、不寫死', () => {
    expect(cands.map((c) => c.id)).toEqual(['A', 'B', 'C', 'D']);
    expect(by('A').verdict).toBe('baseline');
    expect(by('A').days).toEqual(astBaseDays(doc, exam));
    expect(by('A').days).toHaveLength(2);
    expect(by('A').metrics).toMatchObject({ days: 2, slots: 8 });
    expect(by('B').verdict).toBe('same');
    expect(by('B').note).toContain('沒有改善');
  });
  it('T-19 文理沒有共同選考：可提同時段（C）與縮成一天（D）；兩者都是「可行但代價較高」，需人工確認', () => {
    expect(by('C').verdict).toBe('costly');
    expect(by('C').metrics!.slots).toBe(4);
    expect(by('C').metrics!.days).toBe(2);
    expect(by('D').verdict).toBe('costly');
    expect(by('D').metrics).toMatchObject({ days: 1, slots: 4 });
    expect(by('D').metrics!.peakRooms).toBeGreaterThan(by('A').metrics!.peakRooms);
    for (const c of [by('C'), by('D')]) expect(scheduleConflicts(c.days, exam ? [...SCI, ...LIB].map(() => []) : [])).toEqual([]);
    // 設為草案與核准分開：非基準候選沒核准就不能定案
    expect(scheduleNeedsApproval({ cand: 'C' })).toBe(true);
    expect(scheduleNeedsApproval({ cand: 'C', approved: true })).toBe(false);
    expect(scheduleNeedsApproval({ cand: 'A' })).toBe(false);
    const draft = patch(doc, exam, { astSchedule: { cand: 'C', days: by('C').days } });
    expect(astFinalizeBlockers(draft.doc, draft.exam, astPlan(draft.doc, draft.exam))).toContain('選的時程不是基準，要管理者核准');
    const ok = patch(draft.doc, draft.exam, { astSchedule: { cand: 'C', days: by('C').days, approved: true } });
    expect(astFinalizeBlockers(ok.doc, ok.exam, astPlan(ok.doc, ok.exam))).toEqual([]);
  });
  it('選了 C 之後 ⑤ 也能排座：時段數變 4、同節兩科、全量驗證通過（稿「⑤ 以任意時程排」）', () => {
    const f = patch(doc, exam, { astSchedule: { cand: 'C', days: by('C').days, approved: true } });
    const slots = astSlots(f.doc, f.exam);
    expect(slots).toHaveLength(4);
    expect(slots[0]!.subjectIds).toHaveLength(2);
    const plan = astPlan(f.doc, f.exam)!;
    expect(plan.errors).toEqual([]);
    expect(plan.unplaced).toBe(0);
  });
  it('T-20 文組跨組加考物理：任何候選都不會讓他的兩科同節', () => {
    const f = fixture(12, (e) => (e.classNo === 4 && e.seatNo === 1 ? { ...e, subjectIds: [...e.subjectIds, 'physics'] } : e));
    const cs = astCandidates(f.doc, f.exam);
    const sets = f.doc.examFiles![f.exam.id]!.entries!.map((e: ExamEntry) => [...e.subjectIds]);
    for (const c of cs) expect(scheduleConflicts(c.days, sets)).toEqual([]);
    // 物理與歷史因為這個人有共同考生，不可同節
    for (const c of cs.filter((x) => x.verdict !== 'infeasible')) for (const slot of c.days.flat()) expect(slot.includes('physics') && slot.includes('history')).toBe(false);
    // 反例：若硬把物理與歷史放同節，驗證器會抓到並寫出共同考生數
    const bad = scheduleConflicts([[['physics', 'history']]], sets);
    expect(bad).toEqual([{ slot: '第 1 時段', a: 'physics', b: 'history', count: 1 }]);
  });
  it('每科都有共同考生：C、D 不可行，只列擋住的科目對與人數，不提供調整方案、不虛構', () => {
    const all = [...SCI, ...LIB];
    const cs = buildCandidates({ base: [[['a'], ['b']], [['c'], ['d']]], subjectSets: [['a', 'b', 'c', 'd'], ['a', 'b'], ['c', 'd']], seatsPerRoom: 45 });
    expect(all).toHaveLength(8);
    expect(cs.find((c) => c.id === 'C')!.verdict).toBe('infeasible');
    expect(cs.find((c) => c.id === 'D')!.verdict).toBe('infeasible');
    expect(cs.find((c) => c.id === 'D')!.blockers[0]).toMatchObject({ a: 'a', b: 'b', count: 2 });
    expect(cs.find((c) => c.id === 'D')!.metrics).toBeUndefined();
  });
  it('監考人數只算人數：預設 1，改成 3 後人力峰值與總人次乘 3、考場數不變', () => {
    const one = astCandidates(doc, exam)[0]!.metrics!;
    const f = patch(doc, exam, { astInvigilators: 3 });
    const three = astCandidates(f.doc, f.exam)[0]!.metrics!;
    expect(three.peakRooms).toBe(one.peakRooms);
    expect(three.invigPeak).toBe(one.invigPeak * 3);
    expect(three.invigTotal).toBe(one.invigTotal * 3);
  });
});

// ───── 鎖定（T-17、T-18、T-21） ─────

const examAt = (plan: NonNullable<ReturnType<typeof astPlan>>, slotId: string, code: string) => plan.out.exams.find((e) => e.slotId === slotId && e.code === code)!;

describe('分科鎖定（T-17、T-18、T-21）', () => {
  const { doc, exam } = fixture();
  const plan0 = astPlan(doc, exam)!;

  it('鎖單一座位：把人換到指定空位，重排（換模式）後鎖定值不變；相同輸入得相同結果', () => {
    const a = examAt(plan0, 'p1', '0101');
    const used = new Set(plan0.out.exams.filter((e) => e.slotId === 'p1' && e.roomId === a.roomId).map((e) => `${e.row}-${e.depth}`));
    const room = plan0.input.rooms.find((r) => r.id === a.roomId)!;
    const free = room.seats.find((s) => !used.has(`${s.row}-${s.depth}`))!;
    const f = patch(doc, exam, { astLocks: { seats: [{ slotId: 'p1', code: '0101', roomId: a.roomId, row: free.row, depth: free.depth }] } });
    for (const mode of ['fewest-rooms', 'least-movement'] as const) {
      const p = astPlan(f.doc, f.exam, mode)!;
      expect(p.conflicts).toEqual([]);
      const e = examAt(p, 'p1', '0101');
      expect([e.roomId, e.row, e.depth]).toEqual([a.roomId, free.row, free.depth]);
      expect(p.errors).toEqual([]);
    }
    const again = fixture();
    const g = patch(again.doc, again.exam, { astLocks: f.exam.astLocks! });
    expect(astPlan(g.doc, g.exam)!.out).toEqual(astPlan(f.doc, f.exam)!.out);
    // 鎖定算進輸入：加鎖定與不加，輸入不同
    expect(JSON.stringify(astInput(f.doc, f.exam))).not.toBe(JSON.stringify(astInput(doc, exam)));
  });
  it('鎖定座位被別人坐時互換，不破壞硬性規則', () => {
    const a = examAt(plan0, 'p1', '0101');
    const b = examAt(plan0, 'p1', '0102');
    const f = patch(doc, exam, { astLocks: { seats: [{ slotId: 'p1', code: '0101', roomId: b.roomId, row: b.row, depth: b.depth }] } });
    const p = astPlan(f.doc, f.exam)!;
    expect(p.conflicts).toEqual([]);
    expect(examAt(p, 'p1', '0101')).toMatchObject({ roomId: b.roomId, row: b.row, depth: b.depth });
    expect(examAt(p, 'p1', '0102')).toMatchObject({ roomId: a.roomId, row: a.row, depth: a.depth });
    expect(checkPlan(p.input, p.out)).toEqual([]);
  });
  it('T-17 鎖定同時段同座位兩人：明確報錯（時段、教室、座位、學生、規則、原因），不自行解鎖、兩筆都不套用', () => {
    const a = examAt(plan0, 'p1', '0101');
    const f = patch(doc, exam, { astLocks: { seats: [
      { slotId: 'p1', code: '0101', roomId: a.roomId, row: 6, depth: 6 },
      { slotId: 'p1', code: '0102', roomId: a.roomId, row: 6, depth: 6 },
    ] } });
    const p = astPlan(f.doc, f.exam)!;
    expect(p.conflicts).toHaveLength(1);
    expect(p.conflicts[0]).toMatchObject({ kind: 'seat', slotId: 'p1', roomId: a.roomId, seat: '6-6', students: ['0101', '0102'] });
    expect(p.conflicts[0]!.rule).toContain('同一座位只能坐一個人');
    expect(p.conflicts[0]!.reason).toContain('不會自行解鎖');
    expect(f.exam.astLocks!.seats).toHaveLength(2); // 鎖定仍在，沒被自動拿掉
    expect(examAt(p, 'p1', '0101')).toEqual(examAt(plan0, 'p1', '0101'));
    expect(astFinalizeBlockers(f.doc, f.exam, p)).toContain('有 1 項鎖定衝突');
  });
  it('T-18 鎖定造成容量不足：指出教室、時段、鎖定的人數與超出人數，不套用', () => {
    const big = fixture(20);
    const p0 = astPlan(big.doc, big.exam)!;
    const room = p0.out.exams.find((e) => e.slotId === 'p1' && e.code === '0101')!.roomId;
    const f = patch(big.doc, big.exam, { astLocks: { classes: [1, 2, 3].map((c) => ({ slotId: 'p1', classNo: c, roomId: room })) } });
    const p = astPlan(f.doc, f.exam)!;
    const need = p0.out.exams.filter((e) => e.slotId === 'p1' && Number(e.code.slice(0, 2)) <= 3).length;
    expect(need).toBeGreaterThan(49);
    const c = p.conflicts.find((x) => x.kind === 'class')!;
    expect(c).toMatchObject({ slotId: 'p1', roomId: room });
    expect(c.students).toHaveLength(need);
    expect(c.reason).toContain(`只有 49 個座位`);
    expect(c.reason).toContain(`超出 ${need - 49} 人`);
    expect(c.reason).toContain('不會自行解鎖');
  });
  it('班級考場鎖定：一班應考者全進指定教室；教室用途鎖定與方案不同就回報衝突', () => {
    const p0 = plan0;
    const home2 = p0.out.exams.find((e) => e.slotId === 'p1' && e.code === '0201')!.roomId;
    const f = patch(doc, exam, { astLocks: { classes: [{ slotId: 'p1', classNo: 1, roomId: home2 }], rooms: [{ slotId: 'p1', roomId: 'k1', use: 'exam' }] } });
    const p = astPlan(f.doc, f.exam)!;
    const kinds = p.conflicts.map((c) => c.kind).sort();
    expect(kinds).toContain('room'); // k1 是綜合教室，不是考場
    const room = p.conflicts.find((c) => c.kind === 'room')!;
    expect(room).toMatchObject({ slotId: 'p1', roomId: 'k1' });
    if (!p.conflicts.some((c) => c.kind === 'class')) {
      for (const e of p.out.exams.filter((x) => x.slotId === 'p1' && Number(x.code.slice(0, 2)) === 1)) expect(e.roomId).toBe(home2);
    }
    expect(checkPlan(p.input, p.out)).toEqual([]);
  });
  it('鎖定的學生這時段不考試：回報原因，不亂排', () => {
    const f = patch(doc, exam, { astLocks: { seats: [{ slotId: 'p1', code: '0405', roomId: 'c1', row: 1, depth: 1 }] } });
    const p = astPlan(f.doc, f.exam)!;
    expect(p.conflicts[0]!.rule).toContain('要考試');
    expect(p.out.exams).toEqual(plan0.out.exams);
  });
});

// ───── 請假與階段（T-15、T-16） ─────

describe('分科請假（T-15、T-16）', () => {
  const { doc, exam } = fixture();
  const plan = astPlan(doc, exam)!;
  const sum = (rows: ReturnType<typeof estimateStudy>) => rows.reduce((n, r) => ({ e: n.e + r.enrolled, s: n.s + r.estimated }), { e: 0, s: 0 });

  it('T-15 預估請假：只估算自習人數、不超過報名全數；請假 0 人時等於報名全數；未定案可隨時重算', () => {
    const none = estimateStudy(plan.input, plan.out, {});
    expect(none.every((r) => r.estimated === r.enrolled)).toBe(true);
    expect(sum(none).e).toBeGreaterThan(0);
    const all = (n: number) => ({ 1: n, 2: n, 3: n, 4: n, 5: n, 6: n });
    const three = estimateStudy(plan.input, plan.out, all(3));
    const six = estimateStudy(plan.input, plan.out, all(12));
    for (let i = 0; i < three.length; i++) {
      expect(three[i]!.enrolled).toBe(none[i]!.enrolled);
      expect(three[i]!.estimated).toBeLessThanOrEqual(three[i]!.enrolled);
      expect(six[i]!.estimated).toBeLessThanOrEqual(three[i]!.estimated);
    }
    expect(sum(six).s).toBeLessThan(sum(none).s);
    // 請假數超過班級人數：最多當全班請假，不會讓估計變負數或超量
    const huge = estimateStudy(plan.input, plan.out, { 1: 999 });
    expect(huge.every((r) => r.estimated >= 0 && r.estimated <= r.enrolled)).toBe(true);
  });
  it('容量檢核與排座仍用報名全數：請假填了很多人，方案（座位、教室、人數）完全不變', () => {
    const f = patch(doc, exam, { astLeave: { mode: 'estimate', byClass: { 1: 12, 2: 12, 3: 12, 4: 12, 5: 12, 6: 12 } } });
    expect(JSON.stringify(astInput(f.doc, f.exam))).toBe(JSON.stringify(astInput(doc, exam)));
    expect(astPlan(f.doc, f.exam)!.out).toEqual(plan.out);
  });
  it('T-16 已公告後臨時請假 20 人：安排不變、版本不新增、階段不變', () => {
    const blockers = astFinalizeBlockers(doc, exam, plan);
    expect(blockers).toEqual([]);
    const fin = finalize(exam, blockers, seatsOfPlan(plan.out, plan.input.slots.map((s) => s.id)));
    if (!fin.ok) throw new Error(fin.error);
    const a = patch(doc, exam, fin.patch);
    const pub = publish(a.exam, plan.out, astOutputs(a.doc, a.exam, plan).version, new Date('2026-10-01T02:00:00Z'));
    if (!pub.ok) throw new Error(pub.error);
    const b = patch(a.doc, a.exam, pub.patch);
    expect(b.exam.astPhase).toBe('announced');
    expect(b.exam.astVersions).toHaveLength(1);
    const before = astPlan(b.doc, b.exam)!;
    const c = patch(b.doc, b.exam, { astLeave: { mode: 'actual', byClass: { 1: 4, 2: 4, 3: 4, 4: 4, 5: 4 } } }); // 共 20 人
    const after = astPlan(c.doc, c.exam)!;
    expect(after.out).toEqual(before.out);
    expect(astOutputs(c.doc, c.exam, after).version).toBe(astOutputs(b.doc, b.exam, before).version);
    expect(c.exam.astVersions).toHaveLength(1);
    expect(c.exam.astPhase).toBe('announced');
    expect(c.exam.astFinalSeats).toEqual(b.exam.astFinalSeats);
  });
});

// ───── 版本清單（T-26） ─────

describe('分科版本清單（T-26）', () => {
  it('公告後修正：保留舊版、新版與差異；重新發布理由必填；標籤與班級公告同一版', () => {
    const { doc, exam } = fixture();
    const p1 = astPlan(doc, exam)!;
    const ids = p1.input.slots.map((s) => s.id);
    // 沒定案不能公告
    expect(publish(exam, p1.out, 'X', new Date()).ok).toBe(false);
    const fin = finalize(exam, [], seatsOfPlan(p1.out, ids));
    if (!fin.ok) throw new Error(fin.error);
    const a = patch(doc, exam, fin.patch);
    const o1 = astOutputs(a.doc, a.exam, p1);
    const pub1 = publish(a.exam, p1.out, o1.version, new Date('2026-10-01T02:00:00Z'));
    if (!pub1.ok) throw new Error(pub1.error);
    const b = patch(a.doc, a.exam, pub1.patch);
    expect(b.exam.astVersions![0]).toMatchObject({ n: 1, reason: '首次公告', changes: '首次公告', code: o1.version });
    // 解除定案：已公告要理由
    expect(unfinalize(b.exam, '  ').ok).toBe(false);
    const un = unfinalize(b.exam, '教室 c1 漏水，0101 改坐別處');
    if (!un.ok) throw new Error(un.error);
    const c = patch(b.doc, b.exam, un.patch);
    expect(c.exam.astPhase).toBe('planning');
    // 修正：鎖定 0101 到別的座位
    const a1 = examAt(p1, 'p1', '0101');
    const used = new Set(p1.out.exams.filter((e) => e.slotId === 'p1' && e.roomId === a1.roomId).map((e) => `${e.row}-${e.depth}`));
    const free = p1.input.rooms.find((r) => r.id === a1.roomId)!.seats.find((s) => !used.has(`${s.row}-${s.depth}`))!;
    const d = patch(c.doc, c.exam, { astLocks: { seats: [{ slotId: 'p1', code: '0101', roomId: a1.roomId, row: free.row, depth: free.depth }] } });
    const p2 = astPlan(d.doc, d.exam)!;
    const fin2 = finalize(d.exam, astFinalizeBlockers(d.doc, d.exam, p2), seatsOfPlan(p2.out, ids));
    if (!fin2.ok) throw new Error(fin2.error);
    const e = patch(d.doc, d.exam, fin2.patch);
    const o2 = astOutputs(e.doc, e.exam, p2);
    const pub2 = publish(e.exam, p2.out, o2.version, new Date('2026-10-02T02:00:00Z'));
    if (!pub2.ok) throw new Error(pub2.error);
    const f = patch(e.doc, e.exam, pub2.patch);
    const vs = f.exam.astVersions!;
    expect(vs).toHaveLength(2);
    // 舊版保留且沒被改動
    expect(vs[0]).toEqual(b.exam.astVersions![0]);
    expect(vs[1]!.reason).toBe('教室 c1 漏水，0101 改坐別處');
    expect(vs[1]!.n).toBe(2);
    expect(vs[0]!.code).not.toBe(vs[1]!.code);
    // 差異：只有 0101（與被換位的人）改變
    const diff = diffSnap(vs[0]!.snap, vs[1]!.snap);
    expect(diff.changed).toBeGreaterThan(0);
    expect(diff.students).toContain('0101');
    expect(vs[1]!.affected.students).toBe(diff.students.length);
    expect(vs[1]!.affected.rooms.length).toBeGreaterThan(0);
    expect(vs[1]!.changes).toContain('改變');
    // 不混版：兩版的輸出各用自己的版本碼；同一版的標籤與公告用同一個碼
    expect(o1.version).not.toBe(o2.version);
    for (const o of [o1, o2]) {
      expect(o.label.length).toBeGreaterThan(0);
      expect(o.ann.length).toBeGreaterThan(0);
    }
    expect(vs[1]!.code).toBe(o2.version);
    // 重新發布沒理由（且沒有解除定案時留的理由）要擋
    expect(publish({ ...f.exam, astPhase: 'final' }, p2.out, 'Z', new Date()).ok).toBe(false);
    // 匯出匯入往返
    const back = parseVersions(exportVersions(f.exam));
    expect(back.ok && back.versions).toEqual(vs);
    expect(parseVersions('{}').ok).toBe(false);
    expect(parseVersions('不是json').ok).toBe(false);
  });
  it('有待處理（替代方案待核可）或鎖定衝突時不能定案', () => {
    const small = fixture(12);
    const dis = patch(small.doc, small.exam, { astLocks: { seats: [{ slotId: 'p1', code: '0405', roomId: 'c1', row: 1, depth: 1 }] } });
    const p = astPlan(dis.doc, dis.exam)!;
    const bl = astFinalizeBlockers(dis.doc, dis.exam, p);
    expect(bl.length).toBeGreaterThan(0);
    const r = finalize(dis.exam, bl, []);
    expect(r.ok).toBe(false);
  });
});

// ───── 跨次座位沿用 ─────

describe('分科跨次座位沿用', () => {
  it('開關打開後沿用上次定案座位：不破壞硬性規則、不增加標籤張數；結果四類人數加總＝考生數', () => {
    const { doc, exam } = fixture();
    const base = astPlan(doc, exam, 'least-movement')!;
    const ids = base.input.slots.map((s) => s.id);
    const prev = seatsOfPlan(base.out, ids);
    expect(prev).toHaveLength(new Set(base.out.exams.map((e) => e.code)).size);
    const f = patch(doc, exam, { astCarry: { on: true, seats: prev } });
    const p = astPlan(f.doc, f.exam, 'fewest-rooms')!;
    const plain = astPlan(doc, exam, 'fewest-rooms')!;
    expect(p.errors).toEqual([]);
    expect(p.out.metrics!.labels).toBeLessThanOrEqual(plain.out.metrics!.labels);
    const c = p.carry!;
    expect(c.same + c.sameRoom + c.otherRoom + c.none).toBe(new Set(p.out.exams.map((e) => e.code)).size);
    expect(c.same).toBeGreaterThan(0);
    expect(c.reasons.length).toBe(c.sameRoom + c.otherRoom + c.none);
    // 沒開：沒有沿用結果
    expect(plain.carry).toBeUndefined();
  });
  it('上次與這次完全相同的方案：全部同教室同座位', () => {
    const { doc, exam } = fixture();
    const base = astPlan(doc, exam)!;
    const f = patch(doc, exam, { astCarry: { on: true, seats: seatsOfPlan(base.out, base.input.slots.map((s) => s.id)) } });
    const p = astPlan(f.doc, f.exam)!;
    expect(p.carry).toMatchObject({ sameRoom: 0, otherRoom: 0, none: 0 });
    expect(p.carry!.same).toBe(new Set(p.out.exams.map((e) => e.code)).size);
    expect(p.errors).toEqual([]);
  });
  it('沒有上次紀錄的人標「沒沿用」並寫原因；沒匯入時用本機上一場有定案座位的分科考試', () => {
    const { doc, exam } = fixture();
    const base = astPlan(doc, exam)!;
    const some = seatsOfPlan(base.out, base.input.slots.map((s) => s.id)).slice(0, 5);
    const f = patch(doc, exam, { astCarry: { on: true, seats: some } });
    const p = astPlan(f.doc, f.exam)!;
    expect(p.carry!.none).toBeGreaterThan(0);
    expect(p.carry!.reasons.some((r) => r.reason === '上次沒有座位紀錄')).toBe(true);
    // 本機來源：另一場分科考試有定案座位
    const prevExam = patch(doc, exam, { astFinalSeats: seatsOfPlan(base.out, base.input.slots.map((s) => s.id)) });
    const r = newExam(prevExam.doc, 'ast', '分科第二次', new Date('2026-12-01T02:00:00Z'));
    if (!r.ok) throw new Error(r.error);
    const e2 = r.doc.exams[r.doc.exams.length - 1]!;
    const entries = r.doc.examFiles![exam.id]!.entries!;
    const d2 = { ...r.doc, examFiles: { ...r.doc.examFiles, [e2.id]: { entries } } };
    const u = updateExam(d2, e2.id, { classroomIds: exam.classroomIds, astCarry: { on: true } });
    if (!u.ok) throw new Error(u.error);
    const p2 = astPlan(u.doc, u.doc.exams.find((x) => x.id === e2.id)!)!;
    expect(p2.carry!.same).toBeGreaterThan(0);
  });
});

// ───── 輸出內容（T-24、T-25） ─────

describe('分科輸出：T-24 班級公告、T-25 整合標籤', () => {
  const { doc, exam } = fixture();
  const plan = astPlan(doc, exam)!;
  const o = astOutputs(doc, exam, plan);
  it('T-24 以原班列印公告：每人每節都查得到「考試教室＋排－深位」或「自習教室」，逐筆等於方案', () => {
    const slots = astSlots(doc, exam);
    const roomName = new Map(doc.settings.classrooms.map((c) => [c.id, c.name]));
    const students = plan.input.students;
    expect(o.ann).toHaveLength(6);
    let checked = 0;
    o.ann.forEach((t, ci) => {
      expect(t.heads).toHaveLength(2 + slots.length);
      for (const r of t.rows) {
        const code = codeOf({ classNo: ci + 1, seatNo: Number(r[0]) });
        slots.forEach((sl, i) => {
          const cell = r[2 + i]!;
          const e = plan.out.exams.find((x) => x.slotId === sl.id && x.code === code);
          const st = plan.out.study.find((x) => x.slotId === sl.id && x.code === code);
          const home = plan.input.rooms.find((r2) => r2.kind === 'class' && r2.classNo === ci + 1)?.id;
          // #215：考試＝粗體座位，教室與本班相同就省略，不同才寫教室
          if (e) { expect(cell).toBe(e.roomId === home ? `${e.row}－${e.depth}` : `${e.row}－${e.depth} ${roomName.get(e.roomId)}`); expect(t.cellKinds![t.rows.indexOf(r)]![2 + i]).toBe('exam'); }
          else if (st) { expect(cell).toBe(`自習 ${roomName.get(st.roomId)}`); expect(cell).not.toMatch(/d－d/); }
          else expect.fail(`${code} ${sl.id} 沒有任何安排`);
          checked++;
        });
      }
    });
    expect(checked).toBe(students.length * slots.length);
  });
  it('T-25 整合標籤：一座位一張、各時段一行、行內容對得上方案；沒匯入應試編號就不印', () => {
    const seats = new Set(plan.out.exams.map((e) => `${e.roomId}:${e.row}-${e.depth}`));
    expect(o.label.reduce((n, p) => n + p.cells.length, 0)).toBe(seats.size);
    const lines = o.label.flatMap((p) => p.cells.flatMap((c) => c.periodLines!));
    expect(lines).toHaveLength(plan.out.exams.length);
    for (const e of plan.out.exams) expect(lines.some((l) => l.text.includes(e.code))).toBe(true);
    expect(JSON.stringify(o.label)).not.toContain('應試');
  });
  it('T-25 有匯入應試編號：標籤行尾才印', () => {
    const f = fixture(12, (e) => ({ ...e, examNo: `A${e.classNo}${String(e.seatNo).padStart(2, '0')}` }));
    const op = astOutputs(f.doc, f.exam, astPlan(f.doc, f.exam)!);
    const lines = op.label.flatMap((p) => p.cells.flatMap((c) => c.periodLines!));
    expect(lines.every((l) => /A\d+\d{2}/.test(l.text))).toBe(true);
  });
});

// ───── 畫面（階段、時程、請假、鎖定、版本） ─────

describe('分科 AST-3 畫面', () => {
  const { doc, exam } = fixture();
  const noop = () => undefined;
  it('④ 有時程推薦（四個候選、監考人數、核准）與跨次沿用', () => {
    const html = renderToString(<AstStep4 doc={doc} exam={exam} onChange={noop} onStep={noop} />);
    for (const t of ['時程推薦', '每間考場監考人數', '基準（目前的分科節次表）', '調整順序', '文理同節考不同科', '縮短成一天', '設為草案', '管理者核准', '跨次座位沿用', '沒有開啟']) expect(html).toContain(t);
    expect(html).toContain('可行但代價較高');
    expect(html).toContain('無改善');
  });
  it('③ 最下面有請假輸入；已公告後仍可輸入（不在凍結範圍內）', () => {
    const f = patch(doc, exam, { astPhase: 'announced' });
    const html = renderToString(<AstStep3 doc={f.doc} exam={f.exam} onChange={noop} onStep={noop} />);
    expect(html).toContain('請假（預估）');
    expect(html).toContain('已公告');
    expect(html).toMatch(/<fieldset[^>]*phfs[^>]*disabled/);
    const idx = html.indexOf('</fieldset>');
    expect(html.indexOf('請假（預估）')).toBeGreaterThan(idx);
  });
  it('⑤ 有階段卡、鎖定卡；定案後控制項停用、階段卡仍可操作', () => {
    const plain = renderToString(<AstStep5 doc={doc} exam={exam} onChange={noop} onStep={noop} />);
    for (const t of ['目前階段', '規劃中', '確認定案', '鎖定單一座位', '目前沒有鎖定']) expect(plain).toContain(t);
    const f = patch(doc, exam, { astPhase: 'final' });
    const html = renderToString(<AstStep5 doc={f.doc} exam={f.exam} onChange={noop} onStep={noop} />);
    expect(html).toMatch(/<fieldset[^>]*phfs[^>]*disabled/);
    expect(html.indexOf('目前階段')).toBeLessThan(html.indexOf('<fieldset'));
  });
  it('⑤ 鎖定衝突顯示：時段、教室、座位、學生、違反的規則、原因', () => {
    const p0 = astPlan(doc, exam)!;
    const a = examAt(p0, 'p1', '0101');
    const f = patch(doc, exam, { astLocks: { seats: [{ slotId: 'p1', code: '0101', roomId: a.roomId, row: 6, depth: 6 }, { slotId: 'p1', code: '0102', roomId: a.roomId, row: 6, depth: 6 }] } });
    const html = renderToString(<AstStep5 doc={f.doc} exam={f.exam} onChange={noop} onStep={noop} />);
    for (const t of ['鎖定與規則衝突', '違反的規則', '同一時段同一座位只能坐一個人', '程式不會自己解除鎖定']) expect(html).toContain(t);
    expect(html).toContain('<td>6-6</td>');
  });
  it('⑥ 有版本清單；階段卡在規劃中可定案', () => {
    const html = renderToString(<AstStep6 doc={doc} exam={exam} onGoStep={noop} onChange={noop} />);
    for (const t of ['版本清單', '目前階段', '匯出版本清單', '規劃中']) expect(html).toContain(t);
  });
  it('定案流程（畫面用的純函式）：有鎖定衝突不能定案', () => {
    const p0 = astPlan(doc, exam)!;
    const a = examAt(p0, 'p1', '0101');
    const f = patch(doc, exam, { astLocks: { seats: [{ slotId: 'p1', code: '0101', roomId: a.roomId, row: 6, depth: 6 }, { slotId: 'p1', code: '0102', roomId: a.roomId, row: 6, depth: 6 }] } });
    const bl = astFinalizeBlockers(f.doc, f.exam, astPlan(f.doc, f.exam));
    expect(finalize(f.exam, bl, []).ok).toBe(false);
  });
});

// ───── 第三方稽核 #274～#281 回歸（全部假資料） ─────

describe('第三方稽核回歸', () => {
  const noop = () => undefined;
  const finalOf = (f: { doc: Doc; exam: ExamConfig }) => {
    const p = astPlan(f.doc, f.exam)!;
    const r = finalize(f.exam, astFinalizeBlockers(f.doc, f.exam, p), seatsOfPlan(p.out, p.input.slots.map((s) => s.id)), astFingerprint(f.exam, p));
    if (!r.ok) throw new Error(r.error);
    return patch(f.doc, f.exam, r.patch);
  };

  it('#281 基準時程同節兩科有共同考生：擋定案、說明科目與人數；沒有共同考生同節則合法', () => {
    const base = fixture();
    const tbl = structuredClone(scheduleOf(base.doc.settings, 'ast'));
    for (const day of tbl.days) for (const row of day) if (row.name.includes('化學')) row.samePrev = true;
    const sameDoc: Doc = { ...base.doc, settings: { ...base.doc.settings, schedules: { ...(base.doc.settings.schedules ?? {}), ast: tbl } } };
    expect(astSlots(sameDoc, base.exam).some((s) => s.subjectIds.includes('physics') && s.subjectIds.includes('chemistry'))).toBe(true);
    const bl = astFinalizeBlockers(sameDoc, base.exam, astPlan(sameDoc, base.exam));
    expect(bl.join('；')).toMatch(/同節兩科共同考生.*物理.*化學/);
    // 沒人同時考兩科：不擋
    const only = { ...sameDoc, examFiles: { ...sameDoc.examFiles, [base.exam.id]: { entries: examEntries(sameDoc, base.exam).map((e) => ({ ...e, subjectIds: e.subjectIds.filter((i) => i !== 'chemistry') })) } } };
    expect(astFinalizeBlockers(only, base.exam, astPlan(only, base.exam)).join('；')).not.toContain('同節兩科');
  });

  it('#275 選定時程後新增考科：新考科沒排進時程要擋定案；名單有已不存在的考科也擋', () => {
    const base = fixture();
    const days = astBaseDays(base.doc, base.exam);
    const sched = patch(base.doc, base.exam, { astSchedule: { cand: 'B', days, approved: true } });
    expect(astFinalizeBlockers(sched.doc, sched.exam, astPlan(sched.doc, sched.exam))).toEqual([]);
    const added = patch(sched.doc, sched.exam, { subjects: [...sched.exam.subjects, { id: 'extra', name: '地科' }] });
    expect(astFinalizeBlockers(added.doc, added.exam, astPlan(added.doc, added.exam)).join('；')).toContain('考科「地科」沒有排進時程');
    const dropped = patch(sched.doc, sched.exam, { subjects: sched.exam.subjects.filter((s) => s.id !== 'physics') });
    const bl = astFinalizeBlockers(dropped.doc, dropped.exam, astPlan(dropped.doc, dropped.exam)).join('；');
    expect(bl).toContain('已不存在的考科');
    expect(bl).toContain('選了已不存在的考科');
  });

  it('#278 已選的候選按鈕停用（再按一次不會清掉核准與鎖定）；其他候選仍可設為草案', () => {
    const { doc, exam } = fixture();
    const days = astCandidates(doc, exam).find((c) => c.id === 'C')!.days;
    const f = patch(doc, exam, { astSchedule: { cand: 'C', days, approved: true }, astApprovals: [{ slotId: 'p1', roomId: 'c1' }] });
    const html = renderToString(<ScheduleCard doc={f.doc} exam={f.exam} onChange={noop} />);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>目前草案 ✓/);
    expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>設為草案/);
  });

  it('#274 定案後改名單／考科：方案指紋對不上，擋下載與公告；解除定案重新定案後恢復；舊資料不檢查', () => {
    const f0 = fixture();
    const fin = finalOf(f0);
    expect(astSnapshotMismatch(fin.exam, astPlan(fin.doc, fin.exam))).toBeUndefined();
    expect(astOutputBlockers(astPlan(fin.doc, fin.exam), true, astSnapshotMismatch(fin.exam, astPlan(fin.doc, fin.exam)))).toEqual([]);
    const entries = examEntries(fin.doc, fin.exam).map((e, i) => (i === 0 ? { ...e, subjectIds: e.subjectIds.slice(0, 1) } : e));
    const edited = { ...fin.doc, examFiles: { ...fin.doc.examFiles, [fin.exam.id]: { entries } } };
    const m1 = astSnapshotMismatch(fin.exam, astPlan(edited, fin.exam));
    expect(m1).toContain('定案之後');
    expect(astOutputBlockers(astPlan(edited, fin.exam), true, m1)[0]!.text).toContain('定案之後');
    const renamed = { ...fin.doc, examFiles: { ...fin.doc.examFiles, [fin.exam.id]: { entries: examEntries(fin.doc, fin.exam).map((e, i) => (i === 0 ? { ...e, name: '改名' } : e)) } } };
    expect(astSnapshotMismatch(fin.exam, astPlan(renamed, fin.exam))).toBeTruthy();
    const sub = patch(fin.doc, fin.exam, { subjects: fin.exam.subjects.map((s, i) => (i === 0 ? { ...s, name: '改科名' } : s)) });
    expect(astSnapshotMismatch(sub.exam, astPlan(sub.doc, sub.exam))).toBeTruthy();
    const p = astPlan(edited, fin.exam)!;
    expect(publish(fin.exam, p.out, 'X', new Date(), '', m1).ok).toBe(false);
    const un = unfinalize(fin.exam, '');
    if (!un.ok) throw new Error(un.error);
    const reopened = patch(edited, fin.exam, un.patch);
    const again = finalOf(reopened);
    expect(astSnapshotMismatch(again.exam, astPlan(again.doc, again.exam))).toBeUndefined();
    const legacy = patch(fin.doc, fin.exam, { astFinalFp: undefined });
    expect(astSnapshotMismatch(legacy.exam, astPlan(edited, legacy.exam))).toBeUndefined();
  });

  it('#276 版本清單匯入：別場考試、已公告、讓紀錄變少、舊檔覆寫既有紀錄都擋；同場備份可還原', () => {
    const base = fixture();
    const fin = finalOf(base);
    const p = astPlan(fin.doc, fin.exam)!;
    const pub = publish(fin.exam, p.out, 'V1', new Date('2026-09-02T00:00:00Z'));
    if (!pub.ok) throw new Error(pub.error);
    const ann = patch(fin.doc, fin.exam, pub.patch);
    const mine = parseVersions(exportVersions(ann.exam));
    if (!mine.ok) throw new Error(mine.error);
    expect(mine.examId).toBe(ann.exam.id);
    expect(versionsImportBlock(ann.exam, mine)).toContain('已公告');
    const un = unfinalize(ann.exam, '修正');
    if (!un.ok) throw new Error(un.error);
    const plan = patch(ann.doc, ann.exam, un.patch).exam;
    expect(versionsImportBlock(plan, mine)).toBe('');
    expect(versionsImportBlock(plan, { versions: [], examId: plan.id })).toContain('會讓公告紀錄消失');
    expect(versionsImportBlock(plan, { versions: mine.versions, examId: 'other-exam' })).toContain('別場考試');
    expect(versionsImportBlock(plan, { versions: mine.versions })).toContain('沒有記錄來源考試');
    expect(versionsImportBlock({ ...plan, astVersions: [] }, { versions: mine.versions })).toBe('');
    const bad = JSON.parse(exportVersions(ann.exam));
    bad.versions = [bad.versions[0], bad.versions[0]];
    expect(parseVersions(JSON.stringify(bad)).ok).toBe(false);
  });

  it('#277 跨次沿用只用同學年度、姓名一致的定案座位', () => {
    const a = fixture();
    const fin = finalOf(patch(a.doc, a.exam, { schoolYear: 114 }));
    const r = newExam(fin.doc, 'ast', '分科第二次', new Date('2026-10-01T02:00:00Z'));
    if (!r.ok) throw new Error(r.error);
    const second = r.doc.exams[r.doc.exams.length - 1]!;
    const entries = examEntries(fin.doc, fin.exam);
    const d2: Doc = { ...r.doc, examFiles: { ...r.doc.examFiles, [second.id]: { entries } } };
    const on = patch(d2, second, { schoolYear: 115, astCarry: { on: true } });
    expect(carrySource(on.doc, on.exam)).toBeUndefined();
    const same = patch(on.doc, on.exam, { schoolYear: 114 });
    expect(carrySource(same.doc, same.exam)!.seats.length).toBe(fin.exam.astFinalSeats!.length);
    const renamed: Doc = { ...same.doc, examFiles: { ...same.doc.examFiles, [second.id]: { entries: entries.map((e, i) => (i === 0 ? { ...e, name: '另一人' } : e)) } } };
    const cs = carrySource(renamed, same.exam)!;
    expect(cs.excluded).toBe(1);
    expect(cs.seats.some((s) => s.code === codeOf(entries[0]!))).toBe(false);
  });
});
