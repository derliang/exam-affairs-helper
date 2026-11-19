/**
 * 補考場次 → 核心引擎的串接（K2）。畫面只呼叫這裡，不直接拼引擎的輸入。
 * 全部是純函式；結果以場次物件為鍵記憶（Doc 是不可變更新，沒動的場次不會重算）。
 *
 *   baseOf      ② ④：名單（問題列處理後）、人次、統計、各年級
 *   planOf      ⑤：系統建議與「使用者調整過的」考程（過期的科目、學生會被濾掉，不會讓空時段出現）
 *   scheduleOf  ⑤ ③：排程與 F-15 最擁擠時段
 *   outputsOf   ⑥⑦（K3）：產出模型、檢核與版本碼；K4 的檔案產生見 produceFiles
 */
import {
  GRADE_ORDER,
  buildOutputs,
  buildSchedule,
  classSubjectMatrix,
  makeupEntries,
  makeupVersion,
  notifiedSummary,
  paperTotals,
  peakLoad,
  resolveMakeup,
  runMakeupChecks,
  subjectCountDistribution,
  suggestPlan,
  type ClassSubjectMatrix,
  type CountDistribution,
  type GradeKey,
  type GroupPlan,
  type MakeupEntry,
  type MakeupOutputs,
  type MakeupPlan,
  type MakeupRoster,
  type MakeupSchedule,
  type MakeupSettings,
  type NotifiedSummary,
  type PeakLoad,
  type RoomPin,
} from '../../core/makeup';
import type { ProduceMakeupOptions } from '../../export/makeupFiles';
import { settingsOf, type MakeupSession } from './session';

export const emptyRoster = (): MakeupRoster => ({ rawCount: 0, included: [], notified: [], skipped: [], unresolved: [], gradeOfClass: {} });

export interface MakeupBase {
  settings: MakeupSettings;
  roster: MakeupRoster;
  entries: MakeupEntry[];
  /** 名單（納入＋另行通知）裡實際出現的年級，依年級順序 */
  grades: GradeKey[];
  matrices: ClassSubjectMatrix[];
  notified: NotifiedSummary;
  dist: CountDistribution;
  /** 各卷（年級＋科目）人數 */
  papers: Record<string, number>;
}

const baseCache = new WeakMap<MakeupSession, MakeupBase>();

export function baseOf(s: MakeupSession): MakeupBase {
  const hit = baseCache.get(s);
  if (hit) return hit;
  const settings = settingsOf(s);
  const roster = s.parse ? resolveMakeup(s.parse, s.resolutions) : emptyRoster();
  const entries = makeupEntries(roster, settings.trackSplit);
  const gs = new Set<GradeKey>(Object.values(roster.gradeOfClass));
  const out: MakeupBase = {
    settings,
    roster,
    entries,
    grades: GRADE_ORDER.filter((g) => gs.has(g)),
    matrices: classSubjectMatrix(entries),
    notified: notifiedSummary(roster),
    dist: subjectCountDistribution(entries),
    papers: paperTotals(entries),
  };
  baseCache.set(s, out);
  return out;
}

// ───────────── 考程（F-20、F-21） ─────────────

export interface PlanState {
  suggested: MakeupPlan;
  /** 實際用來排的考程：使用者調整過就用調整後（濾掉已不存在的科目與學生），否則就是系統建議 */
  plan: MakeupPlan;
  /** 使用者調整過（名單變動時不會自動重排） */
  edited: boolean;
}

/** 把存下來的考程對齊目前的群組與名單：沒有的群組補系統建議；不存在的科目、學生、空時段拿掉 */
export function alignPlan(saved: MakeupPlan, suggested: MakeupPlan, b: Pick<MakeupBase, 'settings' | 'entries'>): MakeupPlan {
  const groups: GroupPlan[] = b.settings.groups.map((g) => {
    const sg = suggested.groups.find((x) => x.groupId === g.id);
    const gp = saved.groups.find((x) => x.groupId === g.id);
    if (!gp) return sg ?? { groupId: g.id, slots: [], combined: [], early: [] };
    const es = b.entries.filter((e) => g.grades.includes(e.grade));
    const subjects = new Set(es.map((e) => e.subject));
    const students = new Set(es.map((e) => e.studentId));
    return {
      groupId: g.id,
      slots: gp.slots.map((sl) => sl.filter((x) => subjects.has(x))).filter((sl) => sl.length > 0),
      combined: gp.combined.filter((x) => subjects.has(x)),
      early: gp.early.filter((x) => students.has(x)),
    };
  });
  const ids = new Set(groups.map((g) => g.groupId));
  const pins = (saved.pins ?? []).filter((p) => ids.has(p.groupId) && b.settings.rooms.some((r) => r.id === p.roomId));
  return { groups, pins };
}

const planCache = new WeakMap<MakeupSession, PlanState>();

export function planOf(s: MakeupSession): PlanState {
  const hit = planCache.get(s);
  if (hit) return hit;
  const b = baseOf(s);
  const suggested = suggestPlan(b.entries, b.settings);
  const out: PlanState = s.plan ? { suggested, plan: alignPlan(s.plan, suggested, b), edited: true } : { suggested, plan: suggested, edited: false };
  planCache.set(s, out);
  return out;
}

export interface ScheduleState {
  schedule: MakeupSchedule;
  peak: PeakLoad[];
}
const schedCache = new WeakMap<MakeupSession, ScheduleState>();

export function scheduleOf(s: MakeupSession): ScheduleState {
  const hit = schedCache.get(s);
  if (hit) return hit;
  const b = baseOf(s);
  const schedule = buildSchedule(b.entries, b.settings, planOf(s).plan);
  const out = { schedule, peak: peakLoad(schedule, b.settings) };
  schedCache.set(s, out);
  return out;
}

// ───────────── 調整考程（回傳新的場次；plan 一旦調整就整份存下來） ─────────────

const withPlan = (s: MakeupSession, f: (p: MakeupPlan) => MakeupPlan): MakeupSession => ({ ...s, plan: f(structuredClone(planOf(s).plan)) });

const countIn = (b: MakeupBase, groupId: string, subject: string): number => {
  const g = b.settings.groups.find((x) => x.id === groupId);
  return g ? b.entries.filter((e) => g.grades.includes(e.grade) && e.subject === subject).length : 0;
};

/** 把某科升為獨立節（依人數插在適當的位置）或降為綜合節（F-21） */
export function setSubjectRole(s: MakeupSession, groupId: string, subject: string, role: 'independent' | 'combined'): MakeupSession {
  const b = baseOf(s);
  return withPlan(s, (p) => {
    const g = p.groups.find((x) => x.groupId === groupId);
    if (!g) return p;
    g.slots = g.slots.map((sl) => sl.filter((x) => x !== subject)).filter((sl) => sl.length > 0);
    g.combined = g.combined.filter((x) => x !== subject);
    if (role === 'combined') g.combined.push(subject);
    else {
      const n = countIn(b, groupId, subject);
      let at = g.slots.findIndex((sl) => countIn(b, groupId, sl[0] ?? '') < n);
      if (at < 0) at = g.slots.length;
      g.slots.splice(at, 0, [subject]);
    }
    return p;
  });
}

/** 指定或取消某位學生提前開考（F-21） */
export function setEarly(s: MakeupSession, groupId: string, studentId: string, on: boolean): MakeupSession {
  return withPlan(s, (p) => {
    const g = p.groups.find((x) => x.groupId === groupId);
    if (!g) return p;
    g.early = on ? [...new Set([...g.early, studentId])] : g.early.filter((x) => x !== studentId);
    return p;
  });
}

/** 指定某班在某時段的教室（換教室、移動某班）；roomId 空字串＝取消指定 */
export function pinRoom(s: MakeupSession, pin: Omit<RoomPin, 'roomId'> & { roomId: string }): MakeupSession {
  return withPlan(s, (p) => {
    const rest = (p.pins ?? []).filter((x) => !(x.groupId === pin.groupId && x.slot === pin.slot && x.oldClass === pin.oldClass));
    return { ...p, pins: pin.roomId ? [...rest, pin] : rest };
  });
}

/** 重新建議：丟掉使用者的調整，回到系統建議 */
export function resetPlan(s: MakeupSession): MakeupSession {
  const { plan: _p, ...rest } = s;
  void _p;
  return rest;
}

// ───────────── ⑥⑦（K3 接手）：產出模型、檢核、版本碼 ─────────────

export interface OutputsState {
  outputs: MakeupOutputs;
  version: string;
  checks: ReturnType<typeof runMakeupChecks>;
}
const outCache = new WeakMap<MakeupSession, OutputsState>();

/** 產出模型與 C-1～C-15（尚未產出檔案，所以 C-14 待執行、C-15 沒有已產出檔）。K3 的儀表板直接用 */
export function outputsOf(s: MakeupSession): OutputsState {
  const hit = outCache.get(s);
  if (hit) return hit;
  const b = baseOf(s);
  const plan = planOf(s).plan;
  const outputs = buildOutputs(scheduleOf(s).schedule, b.entries, b.settings);
  const version = makeupVersion(b.roster, b.settings, plan);
  const checks = runMakeupChecks({ roster: b.roster, settings: b.settings, plan, outputs, currentVersion: version });
  const out = { outputs, version, checks };
  outCache.set(s, out);
  return out;
}

/**
 * 產生 K4 的下載檔（Word）並回讀驗算；S-8 下載頁（K3）通過閘門後呼叫。
 * 字型載入放在呼叫端（瀏覽器才有 fetch），本函式只組輸入，避免單元測試拖進網路。
 */
export async function produceFiles(s: MakeupSession, ctx: { fonts: ProduceMakeupOptions['fonts']; generatedAt: string }) {
  const { produceMakeupFiles } = await import('../../export/makeupFiles');
  const b = baseOf(s);
  const o = outputsOf(s);
  return produceMakeupFiles(
    { title: s.name, settings: b.settings, roster: b.roster, plan: planOf(s).plan, schedule: scheduleOf(s).schedule, entries: b.entries, outputs: o.outputs },
    { fonts: ctx.fonts, generatedAt: ctx.generatedAt },
  );
}

// ───────────── ③ 教室夠不夠（F-15：比最擁擠時段的同時在考人數，不比全日人次） ─────────────

export interface RoomDayCheck {
  dayId: string;
  label: string;
  seats: number;
  /** 最擁擠時段同時需要的座位：已排進去的最擁擠人數＋排不進去的人次 */
  need: number;
  /** 最擁擠的時刻（分鐘） */
  at: number;
  ok: boolean;
}
export interface RoomCheck {
  days: RoomDayCheck[];
  ok: boolean;
  /** 缺最多的那天缺幾席（ok 時 0） */
  shortage: number;
  /** 本次使用的教室數／全部教室數 */
  enabled: number;
  total: number;
  /** 還沒有名單可比 */
  empty: boolean;
}

export function roomCheckOf(s: MakeupSession): RoomCheck {
  const b = baseOf(s);
  const { schedule, peak } = scheduleOf(s);
  const dayOf = new Map(b.settings.groups.map((g) => [g.id, g.dayId]));
  const days = peak.map((pk): RoomDayCheck => {
    const lost = schedule.unplaced.filter((u) => u.groupId && dayOf.get(u.groupId) === pk.dayId).length;
    const need = pk.peak + lost;
    return { dayId: pk.dayId, label: b.settings.days.find((d) => d.id === pk.dayId)?.label ?? pk.dayId, seats: pk.seats, need, at: pk.at, ok: need <= pk.seats };
  });
  const shortage = Math.max(0, ...days.map((d) => d.need - d.seats));
  return { days, ok: shortage === 0, shortage, enabled: b.settings.rooms.length, total: s.rooms.length, empty: b.entries.length === 0 };
}
