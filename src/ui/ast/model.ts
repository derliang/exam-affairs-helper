/**
 * 分科（D99）畫面的純邏輯：從 Doc 組出規劃輸入、跑引擎（planD99）、整理成 ③④⑤ 要顯示的資料。
 * 引擎契約在 src/core/astD99/contract.ts，這裡只讀、不改契約。全部純函式，可單元測試。
 * - 時段：依共用設定「節次與時長」的分科節次表；每節一個 slot（id＝`p<節次>`），同節的科目放同一 slot。
 * - 考生：本次考試名單（examEntries 去掉全缺考者）；文理組以考生自己的為準，沒有就看班級（D93）。
 * - 教室：沿用步驟③ 勾選（ExamConfig.classroomIds），預備教室＝綜合教室（D99）。
 * - 排座模式、允許他班原班自習、已核可的替代方案存在 ExamConfig（astMode／astAllowOtherStudy／astApprovals）。
 */
import type { Classroom, ExamConfig, Track } from '../../data';
import { classroomSeats, effectiveRooms, studyCapacityOf } from '../../data';
import { dayName, slotName, examSubjectPeriods } from '../../core/periods';
import { planD99 } from '../../core/astD99/engine';
import { checkPlan, codeOf, homeRoomIds, type PlanInput, type PlanMode, type PlanOutput, type PlanRoom, type PlanSlot, type PlanStudent, type Proposal } from '../../core/astD99/contract';
import { toPlanRooms } from '../../core/astD99/rooms';
import { refinePlan, type CarrySummary, type LockConflict } from '../../core/astD99/refine';
import { buildCandidates, scheduleConflicts, scheduleNeedsApproval, type Candidate, type Days } from '../../core/astD99/schedule';
import type { PrevSeat } from '../../data/types';
import { examEntries, examRooms, seatableEntries } from '../seating';
import { examYear, type Doc } from '../store';
import { dataVersion } from '../../core/version';
import { snapOf } from '../../core/astD99/release';

export const MODE_LABEL: Record<PlanMode, string> = { 'fewest-rooms': '少教室優先', 'least-movement': '少移動優先' };
export const astModeOf = (exam: ExamConfig): PlanMode => exam.astMode ?? 'fewest-rooms';

export interface AstSlot extends PlanSlot {
  /** 0 起的天別、當天第幾個時段（1 起） */
  day: number;
  slot: number;
  /** 「第一天 時段一」 */
  label: string;
  /** 科目名稱（同節多科以「、」連接） */
  subjectLabel: string;
}

/** 本次考試的時段（依節次排序）。節次表沒有的科目排在最後各自一節（與 subjectPeriods 一致） */
export function astSlots(doc: Doc, exam: ExamConfig): AstSlot[] {
  const name0 = new Map(exam.subjects.map((x) => [x.id, x.name]));
  if (exam.astSchedule && exam.astSchedule.days.length > 0) {
    // AST-3：選定的時程（候選 B～D）取代節次表；時段 id 仍是 p1、p2…（依序）
    let n = 0;
    return exam.astSchedule.days.flatMap((d, di) => d.map((ids, si) => {
      n++;
      return { id: `p${n}`, subjectIds: ids, day: di, slot: si + 1, label: `${dayName(di)} ${slotName(si + 1)}`, subjectLabel: ids.map((i) => name0.get(i) ?? i).join('、') };
    }));
  }
  const map = examSubjectPeriods(exam, doc.settings);
  const byPeriod = new Map<number, { day?: number; slot?: number; ids: string[] }>();
  for (const [id, list] of map) {
    for (const x of list) {
      const cur = byPeriod.get(x.period) ?? { ids: [] };
      cur.ids.push(id);
      if (x.day !== undefined) cur.day = x.day;
      if (x.slot !== undefined) cur.slot = x.slot;
      byPeriod.set(x.period, cur);
    }
  }
  const name = new Map(exam.subjects.map((s) => [s.id, s.name]));
  return [...byPeriod.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([period, v]) => ({
      id: `p${period}`,
      subjectIds: v.ids,
      day: v.day ?? 0,
      slot: v.slot ?? period,
      label: v.day === undefined ? `時段${period}` : `${dayName(v.day)} ${slotName(v.slot ?? 1)}`,
      subjectLabel: v.ids.map((i) => name.get(i) ?? i).join('、'),
    }));
}

/** 規劃用的考生：各節考的科目（slotId → subjectId）、文理組（考生自己的，沒有就看班級） */
export function astStudents(doc: Doc, exam: ExamConfig, slots: readonly AstSlot[]): PlanStudent[] {
  const slotOf = new Map<string, string>();
  for (const s of slots) for (const id of s.subjectIds) slotOf.set(id, s.id);
  const classTrack = new Map(doc.settings.classes.filter((c) => c.division === exam.division).map((c) => [c.no, c.track]));
  return seatableEntries(doc, exam).map((e) => {
    const takes: Record<string, string> = {};
    for (const id of e.subjectIds) {
      const sid = slotOf.get(id);
      if (sid) takes[sid] = id;
    }
    const track: Track | undefined = e.track ?? classTrack.get(e.classNo);
    return { classNo: e.classNo, seatNo: e.seatNo, name: e.name, takes, ...(track ? { track } : {}) };
  });
}

export function astRooms(doc: Doc, exam: ExamConfig): PlanRoom[] {
  return toPlanRooms(effectiveRooms(exam, doc.settings.classrooms), exam.classroomIds, doc.settings.classes.filter((c) => c.division === exam.division));
}

/** 基準時程（候選 A）：共用設定的分科節次表，同節的科目放同一時段 */
export function astBaseDays(doc: Doc, exam: ExamConfig): Days {
  const { astSchedule: _s, ...plain } = exam;
  void _s;
  const slots = astSlots(doc, plain as ExamConfig);
  const days: Days = [];
  for (const s of slots) { (days[s.day] ??= []).push([...s.subjectIds]); }
  return days.filter(Boolean);
}

/**
 * 跨次沿用的來源：匯入的座位優先，沒有就找本機上一場有定案座位的分科考試（最近建立的）。
 * #277：自動找來源只看「同一學年度」（D105 名冊按學年度分開，不同學年度的班級座號是不同的人）；
 * 同學年度也要姓名一致才算同一位學生，姓名對不上的座位不沿用（excluded＝排除幾人）。
 */
export function carrySource(doc: Doc, exam: ExamConfig): { seats: PrevSeat[]; from: string; excluded?: number } | undefined {
  if (!exam.astCarry?.on) return undefined;
  if (exam.astCarry.seats?.length) return { seats: exam.astCarry.seats, from: '匯入的上次座位' };
  const year = examYear(exam);
  const prev = doc.exams.filter((e) => e.id !== exam.id && e.kind === 'ast' && e.astFinalSeats?.length && examYear(e) === year).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!prev) return undefined;
  const nameOf = (e: ExamConfig) => new Map(examEntries(doc, e).map((x) => [codeOf(x), x.name]));
  const was = nameOf(prev);
  const now = nameOf(exam);
  const seats = prev.astFinalSeats!.filter((s) => { const a = was.get(s.code); const b = now.get(s.code); return !a || !b || a === b; });
  const excluded = prev.astFinalSeats!.length - seats.length;
  return { seats, from: prev.name, ...(excluded ? { excluded } : {}) };
}

export function astInput(doc: Doc, exam: ExamConfig, mode: PlanMode = astModeOf(exam)): PlanInput {
  const slots = astSlots(doc, exam);
  const carry = carrySource(doc, exam);
  const L = exam.astLocks;
  const hasLocks = !!L && ((L.seats?.length ?? 0) + (L.classes?.length ?? 0) + (L.rooms?.length ?? 0) > 0);
  return {
    mode,
    rooms: astRooms(doc, exam),
    slots: slots.map((s) => ({ id: s.id, subjectIds: s.subjectIds })),
    students: astStudents(doc, exam, slots),
    ...(exam.astReserveLayout === 'min-rows' ? { reserveLayout: 'min-rows' as const } : {}),
    ...(exam.astAllowOtherStudy ? { allowOtherClassStudy: true } : {}),
    ...(exam.astApprovals?.length ? { approvals: exam.astApprovals } : {}),
    ...(hasLocks ? { locks: L } : {}),
    ...(carry ? { carry: carry.seats } : {}),
  };
}

export interface AstPlan {
  input: PlanInput;
  out: PlanOutput;
  /** 硬性限制不通過的說明（空＝通過） */
  errors: string[];
  pending: Proposal[];
  approved: Proposal[];
  unplaced: number;
  /** 引擎排不出方案（例如某時段考生比座位多）：out 是空的，畫面請使用者先回 ③ */
  infeasible?: boolean;
  /** AST-3：鎖定衝突（只回報、不自動解鎖）與跨次沿用結果 */
  conflicts: LockConflict[];
  carry?: CarrySummary;
}

const cache = new Map<string, AstPlan>();

// ───── #249：③ 編輯座位時不在每次點擊都同步重跑引擎 ─────
// 只改教室（座位、自習容量、勾選）而考生與時段沒變時，③ 先沿用上一份結果、停手 PLAN_DEBOUNCE_MS 之後才重算一次，
// 重算完通知畫面更新；連點幾個座位只算最後一次。只有 ③ 開啟（setPlanDefer(true)），其他步驟照舊同步取得精確結果。
const PLAN_DEBOUNCE_MS = 350;
let deferOn = false;
let lastPlan: { plan: AstPlan; people: string } | undefined;
let pendingTimer: ReturnType<typeof setTimeout> | undefined;
const readyListeners = new Set<() => void>();

export const setPlanDefer = (on: boolean): void => { deferOn = on; };
/** 延後重算還沒完成（畫面上的統計還是上一份） */
export const astPlanPending = (): boolean => pendingTimer !== undefined;
/** 延後重算完成時通知（回傳取消訂閱） */
export function onAstPlanReady(f: () => void): () => void {
  readyListeners.add(f);
  return () => { readyListeners.delete(f); };
}

/** 跑引擎（同一份輸入只算一次）；沒有考生或沒有教室時回 undefined */
export function runAstPlan(input: PlanInput): AstPlan | undefined {
  if (input.students.length === 0 || input.rooms.length === 0 || input.slots.length === 0) return undefined;
  const key = JSON.stringify(input);
  const people = JSON.stringify([input.mode, input.students, input.slots]);
  const hit = cache.get(key);
  if (hit) {
    lastPlan = { plan: hit, people };
    return hit;
  }
  if (deferOn && lastPlan) {
    if (people === lastPlan.people) {
      if (pendingTimer !== undefined) clearTimeout(pendingTimer);
      pendingTimer = setTimeout(() => {
        pendingTimer = undefined;
        const was = deferOn;
        deferOn = false;
        try { runAstPlan(input); } finally { deferOn = was; }
        for (const f of readyListeners) f();
      }, PLAN_DEBOUNCE_MS);
      return lastPlan.plan;
    }
  }
  const plan = computeAstPlan(input, key);
  lastPlan = { plan, people };
  return plan;
}

function computeAstPlan(input: PlanInput, key: string): AstPlan {
  let out: PlanOutput | undefined;
  try {
    out = planD99(input);
  } catch {
    out = undefined; // 保險：引擎現在無解會回報 infeasible，這裡只防意外例外
  }
  if (!out || out.infeasible) {
    // 座位比考生少等無解情況：畫面改請使用者先回 ③ 補座位
    const empty: AstPlan = { input, out: { usage: {}, exams: [], study: [], mixedRows: [], proposals: [] }, errors: ['座位不夠，排不出方案'], pending: [], approved: [], unplaced: 0, infeasible: true, conflicts: [] };
    cache.set(key, empty);
    return empty;
  }
  const refined = refinePlan(input, out);
  out = refined.out;
  const plan: AstPlan = {
    input,
    out,
    conflicts: refined.conflicts,
    ...(refined.carry ? { carry: refined.carry } : {}),
    errors: checkPlan(input, out),
    pending: out.proposals.filter((p) => p.status === 'pending'),
    approved: out.proposals.filter((p) => p.status === 'approved'),
    unplaced: out.unplaced?.length ?? 0,
  };
  if (cache.size > 24) cache.clear();
  cache.set(key, plan);
  return plan;
}

export const astPlan = (doc: Doc, exam: ExamConfig, mode: PlanMode = astModeOf(exam)): AstPlan | undefined => runAstPlan(astInput(doc, exam, mode));

// ───── ③ 狀態檢核 ─────

export interface AstCapacity {
  /** 理組／文組考場座位（班級教室依組別）與最多一個時段的考生數 */
  science: { seats: number; need: number };
  liberal: { seats: number; need: number };
  /** 綜合教室：已勾幾間、共幾間、自習容量合計、最多一個時段的自習人數 */
  study: { on: number; total: number; capacity: number; need: number; slotsShort: number };
  hasList: boolean;
}

export function astCapacity(doc: Doc, exam: ExamConfig, plan: AstPlan | undefined = astPlan(doc, exam)): AstCapacity {
  const slots = astSlots(doc, exam);
  const students = astStudents(doc, exam, slots);
  const rooms = examRooms(doc, exam);
  const classRooms = rooms.filter((r) => r.kind === 'class');
  const trackOf = (r: Classroom): Track | undefined => r.track ?? doc.settings.classes.find((c) => c.name === r.name && c.division === exam.division)?.track;
  const seatsOf = (t: Track) => classRooms.filter((r) => trackOf(r) === t).reduce((n, r) => n + classroomSeats(r).length, 0);
  const need = (t: Track) => slots.reduce((m, s) => Math.max(m, students.filter((x) => x.track === t && x.takes[s.id]).length), 0);
  const reservesAll = doc.settings.classrooms.filter((r) => r.kind === 'reserve' && (r.division ?? 'senior') === 'senior');
  const reserveOn = rooms.filter((r) => r.kind === 'reserve');
  const reserveIds = new Set(reserveOn.map((r) => r.id));
  let needStudy = 0;
  let slotsShort = 0;
  if (plan) {
    for (const s of slots) {
      const n = plan.out.study.filter((p) => p.slotId === s.id && reserveIds.has(p.roomId)).length + (plan.out.unplaced?.filter((u) => u.slotId === s.id).length ?? 0);
      needStudy = Math.max(needStudy, n);
      if (plan.pending.some((p) => p.slotId === s.id) || plan.out.unplaced?.some((u) => u.slotId === s.id)) slotsShort++;
    }
  }
  return {
    science: { seats: seatsOf('science'), need: need('science') },
    liberal: { seats: seatsOf('liberal'), need: need('liberal') },
    study: { on: reserveOn.length, total: reservesAll.length, capacity: reserveOn.reduce((n, r) => n + studyCapacityOf(r), 0), need: needStudy, slotsShort },
    hasList: students.length > 0,
  };
}

// ───── ⑤ 教室用途表 ─────

export type CellKind = 'exam' | 'study' | 'borrow' | 'pending' | 'home' | 'none';
export interface UsageCell { kind: CellKind; count: number; subjectLabel?: string }

/** 一間教室在一個時段的用途；原班沒被徵用＝home（同學留在原班）。borrow＝原班教室被借來給抽離者自習 */
export function usageCell(plan: AstPlan, slot: AstSlot, room: PlanRoom): UsageCell {
  const u = plan.out.usage[slot.id]?.[room.id];
  if (u === 'exam') return { kind: 'exam', count: plan.out.exams.filter((e) => e.slotId === slot.id && e.roomId === room.id).length, subjectLabel: slot.subjectLabel };
  if (u === 'study') {
    const here = plan.out.study.filter((e) => e.slotId === slot.id && e.roomId === room.id);
    // 原班教室裡只有自己班的人在自習＝同學留在原班（沒被徵用），不算借用；有別班的人來自習才是借用（需核可，或已允許他班原班自習）
    if (room.kind === 'class' && here.every((e) => Number(e.code.slice(0, 2)) === room.classNo)) return { kind: 'home', count: 0 };
    return { kind: room.kind === 'class' ? 'borrow' : 'study', count: here.length };
  }
  const pend = plan.pending.find((p) => p.slotId === slot.id && p.roomId === room.id);
  if (pend) return { kind: 'pending', count: pend.count ?? 0 };
  return { kind: room.kind === 'class' ? 'home' : 'none', count: 0 };
}

/** 這個時段誰在哪間教室：來源班級人數（例 { 1: 20, 2: 5 }） */
export function slotRoster(plan: AstPlan, slotId: string): { exam: Map<string, Map<number, number>>; study: Map<string, Map<number, number>> } {
  const exam = new Map<string, Map<number, number>>();
  const study = new Map<string, Map<number, number>>();
  const add = (m: Map<string, Map<number, number>>, room: string, code: string) => {
    const cls = Number(code.slice(0, 2));
    const per = m.get(room) ?? new Map<number, number>();
    per.set(cls, (per.get(cls) ?? 0) + 1);
    m.set(room, per);
  };
  for (const e of plan.out.exams) if (e.slotId === slotId) add(exam, e.roomId, e.code);
  for (const s of awayStudy(plan, slotId)) add(study, s.roomId, s.code);
  return { exam, study };
}

/** 這個時段離開原班去自習的人（留在自己班教室自習的不算）；自習地點＝綜合教室或借用的他班原班教室 */
export function awayStudy(plan: AstPlan, slotId: string): { code: string; roomId: string }[] {
  const home = homeRoomIds(plan.input.rooms);
  return plan.out.study.filter((s) => s.slotId === slotId && home.get(Number(s.code.slice(0, 2))) !== s.roomId);
}

export { codeOf, homeRoomIds };

// ───── 存回 ExamConfig ─────

export const withApproval = (exam: ExamConfig, slotId: string, roomId: string): { slotId: string; roomId: string }[] =>
  [...(exam.astApprovals ?? []).filter((a) => !(a.slotId === slotId && a.roomId === roomId)), { slotId, roomId }];
export const withoutApproval = (exam: ExamConfig, slotId: string, roomId?: string): { slotId: string; roomId: string }[] =>
  (exam.astApprovals ?? []).filter((a) => !(a.slotId === slotId && (roomId === undefined || a.roomId === roomId)));

// ───── AST-3：時程推薦、能不能定案 ─────

/** 每位考生考的科目（時程推薦算共同考生用） */
export const astSubjectSets = (doc: Doc, exam: ExamConfig): string[][] => seatableEntries(doc, exam).map((e) => [...e.subjectIds]);

export const astInvigilators = (exam: ExamConfig): number => Math.min(6, Math.max(1, Math.floor(exam.astInvigilators ?? 1)));

/** 四個候選時程（基準永遠是共用設定的節次表，不受已選候選影響） */
export function astCandidates(doc: Doc, exam: ExamConfig): Candidate[] {
  const rooms = examRooms(doc, exam).filter((r) => r.kind === 'class');
  const seats = rooms.length ? Math.round(rooms.reduce((n, r) => n + classroomSeats(r).length, 0) / rooms.length) : 45;
  return buildCandidates({ base: astBaseDays(doc, exam), subjectSets: astSubjectSets(doc, exam), seatsPerRoom: seats, invigilators: astInvigilators(exam) });
}

/** 目前實際生效的時程（基準 A 取節次表、B～D 取選定的時程）有沒有「同節兩科有共同考生」的衝突（#281：基準也要查，否則同節兩科的共同考生會被靜默只排一科） */
export function astScheduleConflicts(doc: Doc, exam: ExamConfig) {
  const days: Days = [];
  for (const s of astSlots(doc, exam)) (days[s.day] ??= []).push([...s.subjectIds]);
  return scheduleConflicts(days.filter(Boolean), astSubjectSets(doc, exam));
}

/**
 * 考科與時程對不對得起來（#275）：每個目前的考科恰好出現在時程一次；時程裡不能有已不存在的科目；
 * 名單裡每位考生選的科目都要是目前的考科。回傳要擋定案的說明（空＝沒問題）。
 */
export function astCoverageProblems(doc: Doc, exam: ExamConfig): string[] {
  const out: string[] = [];
  const name = new Map(exam.subjects.map((s) => [s.id, s.name]));
  const seen = new Map<string, number>();
  const unknown = new Set<string>();
  for (const sl of astSlots(doc, exam)) for (const id of sl.subjectIds) { seen.set(id, (seen.get(id) ?? 0) + 1); if (!name.has(id)) unknown.add(id); }
  const missing = exam.subjects.filter((s) => !seen.has(s.id)).map((s) => s.name);
  const dup = exam.subjects.filter((s) => (seen.get(s.id) ?? 0) > 1).map((s) => s.name);
  if (missing.length) out.push(`考科「${missing.join('、')}」沒有排進時程，請到 ④ 重選時程`);
  if (dup.length) out.push(`考科「${dup.join('、')}」在時程裡出現不只一次`);
  if (unknown.size) out.push('時程裡有已不存在的考科，請到 ④ 重選時程');
  const bad = seatableEntries(doc, exam).filter((e) => e.subjectIds.some((id) => !name.has(id)));
  if (bad.length) out.push(`有 ${bad.length} 位考生選了已不存在的考科，請到 ② 重新匯入名單`);
  return out;
}

/**
 * 定案快照指紋（#274）：排座輸入（考生、教室、時段、鎖定…；不含跨次沿用來源）、考科與考試名稱、方案座位。
 * 定案時存下來；之後任何會改變這些的更動，指紋就對不上，⑥ 的下載與公告都會擋下，直到解除定案、重新定案。
 */
export function astFingerprint(exam: ExamConfig, plan: AstPlan): string {
  const { carry: _c, ...input } = plan.input;
  void _c;
  return dataVersion({ i: input, s: exam.subjects, n: exam.name, o: snapOf(plan.out) });
}

/** 定案或公告後，目前的方案與定案當下不同時回傳說明（沒有定案指紋的舊資料不檢查） */
export function astSnapshotMismatch(exam: ExamConfig, plan: AstPlan | undefined): string | undefined {
  if (!exam.astPhase || exam.astPhase === 'planning' || !exam.astFinalFp || !plan) return undefined;
  return astFingerprint(exam, plan) === exam.astFinalFp
    ? undefined
    : '定案之後，考試設定、考試名單、教室或座位被改過，目前的方案和定案當下不一樣，不能下載或公告。請先解除定案、確認內容，重新定案。';
}

/** 定案前還有哪些事沒處理（空＝可以定案） */
export function astFinalizeBlockers(doc: Doc, exam: ExamConfig, plan: AstPlan | undefined): string[] {
  const b: string[] = [];
  if (!plan) return ['還沒有可排的方案（名單或教室沒設好）'];
  if (plan.infeasible) return ['座位不夠，排不出方案'];
  if (plan.pending.length > 0) b.push(`有 ${plan.pending.length} 個時段的替代方案待核可`);
  if (plan.unplaced > 0 && plan.pending.length === 0) b.push(`有 ${plan.unplaced} 人排不進自習空間`);
  if (plan.conflicts.length > 0) b.push(`有 ${plan.conflicts.length} 項鎖定衝突`);
  if (plan.errors.length > 0 && plan.pending.length === 0 && plan.unplaced === 0) b.push(`硬性限制有 ${plan.errors.length} 項不通過`);
  if (scheduleNeedsApproval(exam.astSchedule)) b.push('選的時程不是基準，要管理者核准');
  const nm = new Map(exam.subjects.map((x) => [x.id, x.name]));
  const conf = astScheduleConflicts(doc, exam);
  if (conf.length > 0) b.push(`選的時程有同節兩科共同考生：${conf.slice(0, 3).map((c) => `${c.slot} ${nm.get(c.a) ?? c.a}與${nm.get(c.b) ?? c.b}（${c.count} 人）`).join('、')}`);
  b.push(...astCoverageProblems(doc, exam));
  return b;
}
