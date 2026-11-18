/**
 * 補考場次（K2）的資料模型與純函式：場次資料夾存取用的資料形狀、新增、延續上一次設定（F-6）、
 * 由名單與設定算出人次／排程／建議計畫（K1 引擎只 import、不改語意）、使用者調整計畫的運算、步驟狀態。
 * 不碰畫面、不碰檔案；畫面在 src/ui/makeup/*.tsx，存檔在 src/data/folder.ts。
 * 公開 repo：測試一律假資料。
 */
import type { Classroom, Semester } from '../../data';
import {
  buildOutputs,
  buildSchedule,
  classSubjectMatrix,
  defaultMakeupGroups,
  DEFAULT_EARLY_RULE,
  fmtTime,
  GRADE_ORDER,
  GRADE_TEXT,
  makeupEntries,
  makeupVersion,
  peakLoad,
  resolveMakeup,
  roomSeats,
  runMakeupChecks,
  suggestPlan,
  type CheckResult,
  type GradeKey,
  type GroupPlan,
  type MakeupDay,
  type MakeupEntry,
  type MakeupGroup,
  type MakeupOutputs,
  type MakeupParseResult,
  type MakeupPlan,
  type MakeupResolution,
  type MakeupRoom,
  type MakeupRoster,
  type MakeupSchedule,
  type MakeupSettings,
  type PeakLoad,
} from '../../core/makeup';
import type { Doc, Result } from '../store';

/** 補考場次：存成 makeups/<id>/makeup.json（一場一個資料夾，D2） */
export interface MakeupSession {
  id: string;
  name: string;
  /** 學年度（民國年）、學期（F-1） */
  schoolYear: number;
  semester: Semester;
  createdAt: string;
  updatedAt?: string;
  settings: MakeupSettings;
  /** F-5：座位表（預設產生，U-5）與座位標籤（預設不產生） */
  seatMap: boolean;
  labels: boolean;
  /** ② 匯入的結果（名單只存在本機資料夾，公開 repo 不收） */
  source?: { fileName: string; importedAt: string; parse: MakeupParseResult };
  /** ② 問題列的處理（補上／修改／略過，略過含原因） */
  resolutions: MakeupResolution[];
  /** ⑤ 使用者調整過的計畫；沒有＝完全採用系統建議 */
  plan?: MakeupPlan;
}

export const MAKEUP_NAME_MAX = 30;

const CN_TERM: Record<Semester, string> = { first: '第一學期', second: '第二學期' };
export const termText = (s: Semester): string => CN_TERM[s];

/** 補考預設學期：8～1 月是上學期考完的補考？——不替使用者決定，沿用「建立日期」推算：2～7 月＝第二學期，其餘＝第一學期 */
export function defaultMakeupSemester(now: Date): Semester {
  const m = now.getMonth() + 1;
  return m >= 2 && m <= 7 ? 'second' : 'first';
}

export function suggestMakeupName(doc: Doc, year: number, semester: Semester): string {
  const base = `${year} 學年${termText(semester)}補考`;
  const names = new Set([...(doc.makeups ?? []).map((m) => m.name), ...doc.exams.map((e) => e.name)]);
  if (!names.has(base)) return base;
  for (let i = 2; i < 50; i++) if (!names.has(`${base}（${i}）`)) return `${base}（${i}）`;
  return base;
}

export function checkMakeupName(doc: Doc, name: string, selfId?: string): { ok: boolean; message: string } {
  const n = name.trim();
  if (!n) return { ok: false, message: '請輸入名稱，例如「115 學年第一學期補考」。' };
  if (n.length > MAKEUP_NAME_MAX) return { ok: false, message: `名稱最多 ${MAKEUP_NAME_MAX} 字（目前 ${n.length} 字）。` };
  if ((doc.makeups ?? []).some((m) => m.id !== selfId && m.name === n) || doc.exams.some((e) => e.name === n)) return { ok: false, message: `已有「${n}」，請改用不同名稱。` };
  return { ok: true, message: '' };
}

// ───────────── 新增與延續（F-6） ─────────────

const ALL_GRADES: GradeKey[] = ['S1', 'S2', 'S3', 'J1', 'J2', 'J3'];

export function defaultMakeupSettings(): MakeupSettings {
  return { days: [{ id: 'D1', label: '考日一' }], groups: defaultMakeupGroups(ALL_GRADES, 'D1'), rooms: [], early: { ...DEFAULT_EARLY_RULE } };
}

export const sortMakeups = (l: readonly MakeupSession[]): MakeupSession[] => [...l].sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt));
export const lastMakeup = (doc: Doc): MakeupSession | undefined => sortMakeups(doc.makeups ?? [])[0];

/** 新增補考場次：教室、時長、提前開考參數等自動帶入上一次補考（F-6），名單與計畫從空白開始 */
export function newMakeup(doc: Doc, name: string, now: Date, opts: { schoolYear: number; semester: Semester }): Result<Doc> {
  const chk = checkMakeupName(doc, name);
  if (!chk.ok) return { ok: false, error: chk.message };
  const prev = lastMakeup(doc);
  const base = defaultMakeupSettings();
  const settings: MakeupSettings = prev
    ? {
        // 考日與群組結構照舊（考日日期要重填，所以標籤換成預設名稱）；時長、休息、教室、提前開考參數全部帶入
        days: prev.settings.days.map((d, i) => ({ id: d.id, label: `考日${'一二三四五六七八九十'[i] ?? i + 1}` })),
        groups: structuredClone(prev.settings.groups),
        rooms: structuredClone(prev.settings.rooms),
        early: structuredClone(prev.settings.early),
        ...(prev.settings.independentMin !== undefined ? { independentMin: prev.settings.independentMin } : {}),
      }
    : base;
  const id = freshId(doc, now);
  const s: MakeupSession = {
    id, name: name.trim(), schoolYear: opts.schoolYear, semester: opts.semester, createdAt: now.toISOString(),
    settings, seatMap: prev?.seatMap ?? true, labels: prev?.labels ?? false, resolutions: [],
  };
  return { ok: true, doc: { ...doc, makeups: [...(doc.makeups ?? []), s] } };
}

function freshId(doc: Doc, now: Date): string {
  const used = new Set((doc.makeups ?? []).map((m) => m.id));
  const stem = `makeup-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  for (let i = 1; ; i++) {
    const id = `${stem}-${i}`;
    if (!used.has(id)) return id;
  }
}

export const makeupById = (doc: Doc, id: string): MakeupSession | undefined => doc.makeups?.find((m) => m.id === id);

export function updateMakeup(doc: Doc, id: string, f: (m: MakeupSession) => MakeupSession): Doc {
  return { ...doc, makeups: (doc.makeups ?? []).map((m) => (m.id === id ? f(m) : m)) };
}

export function deleteMakeup(doc: Doc, id: string): Doc {
  return { ...doc, makeups: (doc.makeups ?? []).filter((m) => m.id !== id) };
}

/** 存檔前蓋修改時間（只有內容真的變了才蓋，與模擬考一致） */
export function stampMakeups(prev: Doc, next: Doc, now: Date): Doc {
  if (!next.makeups || next.makeups === prev.makeups) return next;
  const before = new Map((prev.makeups ?? []).map((m) => [m.id, m]));
  let changed = false;
  const makeups = next.makeups.map((m) => {
    const old = before.get(m.id);
    if (!old || old === m || m.updatedAt !== old.updatedAt) return m;
    changed = true;
    return { ...m, updatedAt: now.toISOString() };
  });
  return changed ? { ...next, makeups } : next;
}

// ───────────── ① 設定的運算 ─────────────

const dayKey = (n: number) => `D${n}`;
const letters = '一二三四五六七八九十';

export function addDay(s: MakeupSession): MakeupSession {
  let n = s.settings.days.length + 1;
  while (s.settings.days.some((d) => d.id === dayKey(n))) n++;
  const day: MakeupDay = { id: dayKey(n), label: `考日${letters[s.settings.days.length] ?? s.settings.days.length + 1}` };
  return { ...s, settings: { ...s.settings, days: [...s.settings.days, day] } };
}

/** 刪考日：它底下的群組一併併到第一個考日；計畫作廢 */
export function removeDay(s: MakeupSession, dayId: string): MakeupSession {
  if (s.settings.days.length <= 1) return s;
  const days = s.settings.days.filter((d) => d.id !== dayId);
  const to = days[0]!.id;
  const groups = s.settings.groups.map((g) => (g.dayId === dayId ? { ...g, dayId: to } : g));
  return withoutPlan({ ...s, settings: { ...s.settings, days, groups } });
}

export const setDayLabel = (s: MakeupSession, dayId: string, label: string): MakeupSession =>
  ({ ...s, settings: { ...s.settings, days: s.settings.days.map((d) => (d.id === dayId ? { ...d, label } : d)) } });

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
/** 日期（yyyy-mm-dd）→「1/23（六）」 */
export function dateLabel(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getMonth() + 1}/${d.getDate()}（${WEEK[d.getDay()]}）`;
}

export const withoutPlan = (s: MakeupSession): MakeupSession => {
  if (!s.plan) return s;
  const { plan: _plan, ...rest } = s;
  return rest;
};

export function patchGroup(s: MakeupSession, groupId: string, patch: Partial<Pick<MakeupGroup, 'dayId' | 'label' | 'start' | 'periodMin' | 'breakMin'>>): MakeupSession {
  const next = { ...s, settings: { ...s.settings, groups: s.settings.groups.map((g) => (g.id === groupId ? { ...g, ...patch } : g)) } };
  // 時間、節長不影響計畫的科目安排（排程重算即可）；換考日也只是搬到別天
  return next;
}

/** 把年級放進某群組（同一年級只屬於一個群組）；結構變了，計畫作廢 */
export function setGradeGroup(s: MakeupSession, grade: GradeKey, groupId: string | null): MakeupSession {
  const groups = s.settings.groups.map((g) => {
    const has = g.grades.includes(grade);
    if (g.id === groupId) return has ? g : { ...g, grades: [...g.grades, grade].sort((a, b) => GRADE_ORDER.indexOf(a) - GRADE_ORDER.indexOf(b)) };
    return has ? { ...g, grades: g.grades.filter((x) => x !== grade) } : g;
  });
  return withoutPlan({ ...s, settings: { ...s.settings, groups } });
}

export function addGroup(s: MakeupSession): MakeupSession {
  let n = s.settings.groups.length + 1;
  while (s.settings.groups.some((g) => g.id === `G${n}`)) n++;
  const base = s.settings.groups[0];
  const g: MakeupGroup = {
    id: `G${n}`, dayId: s.settings.days[0]!.id, label: `群組${n}`, grades: [],
    start: base?.start ?? 480, periodMin: base?.periodMin ?? 50, breakMin: base?.breakMin ?? 10,
  };
  return withoutPlan({ ...s, settings: { ...s.settings, groups: [...s.settings.groups, g] } });
}

export function removeGroup(s: MakeupSession, groupId: string): MakeupSession {
  return withoutPlan({ ...s, settings: { ...s.settings, groups: s.settings.groups.filter((g) => g.id !== groupId) } });
}

/** 「8:00」「08:00」→ 分鐘；格式不對回 null */
export function parseTime(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return null;
  const h = Number(m[1]); const mm = Number(m[2]);
  return h < 24 && mm < 60 ? h * 60 + mm : null;
}

export interface SettingsIssue { text: string }

/** ① 的問題：考日、群組、時間；有問題 ① 不算完成 */
export function settingsIssues(s: MakeupSession, gradesInRoster: readonly GradeKey[] = []): SettingsIssue[] {
  const out: SettingsIssue[] = [];
  const { days, groups } = s.settings;
  if (days.length === 0) out.push({ text: '還沒有考日' });
  for (const d of days) if (!d.label.trim()) out.push({ text: '有考日沒有填名稱或日期' });
  if (groups.length === 0) out.push({ text: '還沒有考程群組（哪些年級同一天、同一套時間考）' });
  for (const g of groups) {
    if (!days.some((d) => d.id === g.dayId)) out.push({ text: `「${g.label}」沒有對應的考日` });
    if (!(g.periodMin >= 10 && g.periodMin <= 180)) out.push({ text: `「${g.label}」每節時長要在 10～180 分鐘` });
    if (!(g.breakMin >= 0 && g.breakMin <= 60)) out.push({ text: `「${g.label}」節間休息要在 0～60 分鐘` });
  }
  for (const gr of gradesInRoster) if (!groups.some((g) => g.grades.includes(gr))) out.push({ text: `名單裡有${GRADE_TEXT[gr]}的學生，但沒有任何群組負責${GRADE_TEXT[gr]}（會排不進考程）` });
  const { early } = s.settings;
  if (!(early.capMin >= early.suggestOverMin)) out.push({ text: '提前開考的「總作答上限」要不小於「建議門檻」' });
  return out;
}

// ───────────── ② 名單 ─────────────

export function rosterOf(s: MakeupSession): MakeupRoster | null {
  return s.source ? resolveMakeup(s.source.parse, s.resolutions) : null;
}

/** F-11：重複匯入的差異（以「學號＋科目名」為鍵；只比沒問題的列） */
export interface ImportDiff { added: number; updated: number; removed: number; unchanged: number }
const rk = (r: { studentId: string; subjectName: string }) => `${r.studentId}|${r.subjectName}`;
const sig = (r: MakeupParseResult['rows'][number]) => [r.name, r.oldClass, r.oldSeat, r.attr, r.score].join('|');
export function diffImport(oldP: MakeupParseResult | undefined, next: MakeupParseResult): ImportDiff {
  const a = new Map((oldP?.rows ?? []).map((r) => [rk(r), sig(r)]));
  const b = new Map(next.rows.map((r) => [rk(r), sig(r)]));
  let added = 0; let updated = 0; let unchanged = 0;
  for (const [k, v] of b) { if (!a.has(k)) added++; else if (a.get(k) !== v) updated++; else unchanged++; }
  let removed = 0;
  for (const k of a.keys()) if (!b.has(k)) removed++;
  return { added, updated, removed, unchanged };
}

/** 合併：舊解析結果與新解析結果的列聯集（同鍵以新的為準）；列號重新編成「來源檔!」避免撞號 */
export function mergeParse(oldP: MakeupParseResult, next: MakeupParseResult): MakeupParseResult {
  const m = new Map(oldP.rows.map((r) => [rk(r), r]));
  for (const r of next.rows) m.set(rk(r), r);
  const rows = [...m.values()];
  const probs = new Map([...oldP.problems, ...next.problems].map((p) => [p.rowId, p]));
  return { ...next, rows, problems: [...probs.values()], rawCount: oldP.rawCount + next.rawCount - (oldP.rows.length + next.rows.length - rows.length) };
}

/** 套用匯入：名單變了，計畫與舊的問題列處理作廢（rowId 已對不上） */
export function applyImport(s: MakeupSession, fileName: string, parse: MakeupParseResult, now: Date, keepResolutions = false): MakeupSession {
  return withoutPlan({ ...s, source: { fileName, importedAt: now.toISOString(), parse }, resolutions: keepResolutions ? s.resolutions : [] });
}

export function setResolution(s: MakeupSession, res: MakeupResolution | null, rowId: string): MakeupSession {
  const rest = s.resolutions.filter((r) => r.rowId !== rowId);
  return withoutPlan({ ...s, resolutions: res ? [...rest, res] : rest });
}

// ───────────── ③ 教室 ─────────────

let roomSerial = 0;
export function newRoom(s: MakeupSession, use: MakeupRoom['use'] = 'class'): MakeupRoom {
  let id: string;
  do id = `R${++roomSerial}${Math.random().toString(36).slice(2, 5)}`; while (s.settings.rooms.some((r) => r.id === id));
  return { id, name: `教室${s.settings.rooms.length + 1}`, rows: 5, depth: 6, seatCount: 30, use };
}

/** 「排×深位」總格數扣掉不排的座位＝座位數；改排或深位時 seatCount 跟著算（空位只在最後，沿用 D72） */
export function withRoomShape(r: MakeupRoom, rows: number, depth: number, spare = 0): MakeupRoom {
  const cells = Math.max(1, rows) * Math.max(1, depth);
  const { disabled: _d, rowDepths: _r, ...rest } = r;
  return { ...rest, rows: Math.max(1, rows), depth: Math.max(1, depth), seatCount: Math.max(1, cells - Math.max(0, Math.min(spare, cells - 1))) };
}
export const roomSpare = (r: MakeupRoom): number => r.rows * r.depth - r.seatCount;

/** 共用教室（共用設定）→ 補考教室；預備教室不帶 */
export function roomFromShared(c: Classroom): MakeupRoom {
  return {
    id: `S-${c.id}`, name: c.name, rows: c.rows, depth: c.depth, seatCount: c.seatCount, use: 'class',
    ...(c.disabled ? { disabled: [...c.disabled] } : {}), ...(c.rowDepths ? { rowDepths: [...c.rowDepths] } : {}),
  };
}

export const roomsPatch = (s: MakeupSession, rooms: MakeupRoom[]): MakeupSession => ({ ...s, settings: { ...s.settings, rooms } });

// ───────────── 由場次算出一切（K1 引擎） ─────────────

export interface Derived {
  roster: MakeupRoster | null;
  entries: MakeupEntry[];
  /** 實際使用的計畫（使用者調整過的，補上系統建議缺的群組） */
  plan: MakeupPlan;
  suggested: MakeupPlan;
  schedule: MakeupSchedule;
  peak: PeakLoad[];
  outputs: MakeupOutputs;
  version: string;
  checks: CheckResult[];
  grades: GradeKey[];
}

/** 使用者計畫：只保留設定裡還存在的群組，缺的群組補系統建議 */
export function effectivePlan(s: MakeupSession, suggested: MakeupPlan): MakeupPlan {
  if (!s.plan) return suggested;
  const mine = new Map(s.plan.groups.map((g) => [g.groupId, g]));
  return { groups: suggested.groups.map((g) => mine.get(g.groupId) ?? g), pins: (s.plan.pins ?? []).filter((p) => s.settings.groups.some((g) => g.id === p.groupId)) };
}

const cache = new WeakMap<MakeupSession, Derived>();
export function derive(s: MakeupSession): Derived {
  const hit = cache.get(s);
  if (hit) return hit;
  const roster = rosterOf(s);
  const empty: MakeupRoster = { rawCount: 0, included: [], notified: [], skipped: [], unresolved: [], gradeOfClass: {} };
  const r = roster ?? empty;
  const entries = makeupEntries(r, s.settings.trackSplit);
  const suggested = suggestPlan(entries, s.settings);
  const plan = effectivePlan(s, suggested);
  const schedule = buildSchedule(entries, s.settings, plan);
  const peak = peakLoad(schedule, s.settings);
  const outputs = buildOutputs(schedule, entries, s.settings);
  const version = makeupVersion(r, s.settings, plan);
  const checks = runMakeupChecks({ roster: r, settings: s.settings, plan, outputs, currentVersion: version });
  const grades = [...new Set(entries.map((e) => e.grade))].sort((a, b) => GRADE_ORDER.indexOf(a) - GRADE_ORDER.indexOf(b));
  const d: Derived = { roster, entries, plan, suggested, schedule, peak, outputs, version, checks, grades };
  cache.set(s, d);
  return d;
}

// ───────────── ⑤ 計畫調整 ─────────────

export type Placement = { kind: 'combined' } | { kind: 'new' } | { kind: 'slot'; index: number };

const clonePlan = (p: MakeupPlan): MakeupPlan => ({ groups: p.groups.map((g) => ({ ...g, slots: g.slots.map((x) => [...x]), combined: [...g.combined], early: [...g.early] })), pins: [...(p.pins ?? [])] });
const editGroup = (p: MakeupPlan, groupId: string, f: (g: GroupPlan) => void): MakeupPlan => {
  const q = clonePlan(p);
  const g = q.groups.find((x) => x.groupId === groupId);
  if (g) f(g);
  return q;
};

/** F-21：把某科移到「新的獨立節」「某個既有節」或「綜合節」 */
export function placeSubject(p: MakeupPlan, groupId: string, subject: string, to: Placement): MakeupPlan {
  return editGroup(p, groupId, (g) => {
    g.slots = g.slots.map((x) => x.filter((s) => s !== subject)).filter((x) => x.length > 0);
    g.combined = g.combined.filter((s) => s !== subject);
    if (to.kind === 'combined') g.combined.push(subject);
    else if (to.kind === 'new') g.slots.splice(Math.max(0, g.slots.length - 1), 0, [subject]);
    else if (g.slots[to.index]) g.slots[to.index]!.push(subject);
    else g.slots.push([subject]);
  });
}

export function moveSlot(p: MakeupPlan, groupId: string, index: number, dir: -1 | 1): MakeupPlan {
  return editGroup(p, groupId, (g) => {
    const j = index + dir;
    if (j < 0 || j >= g.slots.length) return;
    const t = g.slots[index]!; g.slots[index] = g.slots[j]!; g.slots[j] = t;
  });
}

export function setEarly(p: MakeupPlan, groupId: string, studentId: string, on: boolean): MakeupPlan {
  return editGroup(p, groupId, (g) => { g.early = on ? (g.early.includes(studentId) ? g.early : [...g.early, studentId]) : g.early.filter((x) => x !== studentId); });
}

export function setPin(p: MakeupPlan, groupId: string, slot: number, oldClass: string, roomId: string | null): MakeupPlan {
  const q = clonePlan(p);
  q.pins = (q.pins ?? []).filter((x) => !(x.groupId === groupId && x.slot === slot && x.oldClass === oldClass));
  if (roomId) q.pins.push({ groupId, slot, oldClass, roomId });
  return q;
}

export const groupSubjects = (entries: readonly MakeupEntry[], g: MakeupGroup): string[] => [...new Set(entries.filter((e) => g.grades.includes(e.grade)).map((e) => e.subject))];

// ───────────── 步驟狀態與摘要 ─────────────

export type MakeupStep = 1 | 2 | 3 | 4 | 5;
export const MAKEUP_STEPS: { no: MakeupStep; name: string; blurb: string }[] = [
  { no: 1, name: '補考設定', blurb: '考日、年級、時長' },
  { no: 2, name: '匯入名單', blurb: '教務匯出檔、問題列' },
  { no: 3, name: '教室設定', blurb: '座位、混班、特別教室' },
  { no: 4, name: '人數統計', blurb: '班級×科目、選組' },
  { no: 5, name: '考程編排', blurb: '節次、教室、提前開考' },
];
export type MakeupStepState = 'done' | 'todo' | 'stale';

export interface MakeupIssue { step: MakeupStep; text: string; level: 'block' | 'warn' }

export interface MakeupFlow {
  states: Record<MakeupStep, MakeupStepState>;
  issues: MakeupIssue[];
  /** 摘要：人次、學生數、另行通知、考日、節數、考場數 */
  summary: { students: number; entries: number; notified: number; days: number; slots: number; rooms: number };
}

export function makeupFlow(s: MakeupSession): MakeupFlow {
  const d = derive(s);
  const issues: MakeupIssue[] = [];
  const add = (step: MakeupStep, text: string, level: MakeupIssue['level'] = 'block') => issues.push({ step, text, level });
  for (const i of settingsIssues(s, d.grades)) add(1, i.text);
  const rosterOk = !!d.roster && d.roster.unresolved.length === 0 && d.roster.rawCount > 0;
  if (!d.roster) add(2, '還沒有匯入補考名單');
  else {
    if (d.roster.rawCount === 0) add(2, '匯入的檔案裡沒有讀到任何資料列');
    if (d.roster.unresolved.length > 0) add(2, `還有 ${d.roster.unresolved.length} 筆問題列沒處理（補上、修改或略過）`);
  }
  if (s.settings.rooms.length === 0) add(3, '還沒有設定任何教室');
  for (const p of d.peak) if (!p.ok) add(3, `${s.settings.days.find((x) => x.id === p.dayId)?.label ?? p.dayId} ${fmtTime(p.at)} 同時在考 ${p.peak} 人，可用座位只有 ${p.seats}（缺 ${p.peak - p.seats}）`);
  if (s.settings.rooms.length > 0 && d.schedule.unplaced.length > 0) add(3, `教室座位不夠：有 ${d.schedule.unplaced.length} 人次排不進任何教室，缺的座位要補教室（或把用途改成可混班）`);
  if (d.schedule.unplaced.length > 0) add(5, `有 ${d.schedule.unplaced.length} 人次排不進考程（教室不夠或年級沒有群組）`);
  const red = d.checks.filter((c) => c.status === 'red' && ['C-3', 'C-5', 'C-6', 'C-7'].includes(c.id));
  for (const c of red) add(5, `${c.id} ${c.title}不通過：${c.summary}`);
  if (d.schedule.splits.length > 0) add(5, `有 ${d.schedule.splits.length} 班的同科學生被拆到不同教室（可調整，不擋）`, 'warn');
  const stepIssue = (n: MakeupStep) => issues.some((i) => i.step === n && i.level === 'block');
  const states: Record<MakeupStep, MakeupStepState> = {
    1: stepIssue(1) ? 'todo' : 'done',
    2: rosterOk ? 'done' : 'todo',
    3: stepIssue(3) ? 'todo' : 'done',
    4: rosterOk ? 'done' : 'todo',
    5: rosterOk && !stepIssue(5) && !stepIssue(3) && !stepIssue(1) ? 'done' : 'todo',
  };
  return {
    states, issues,
    summary: {
      students: new Set(d.entries.map((e) => e.studentId)).size, entries: d.entries.length,
      notified: d.roster?.notified.length ?? 0, days: s.settings.days.length,
      slots: d.schedule.slots.length, rooms: new Set(d.schedule.sittings.map((x) => `${x.slotId}|${x.roomId}`)).size,
    },
  };
}

/** S-1 列表的進度文字 */
export function makeupProgress(s: MakeupSession): { headline: string; detail: string; tone: 'amb' | 'mut'; cells: ('d' | 'c' | '')[] } {
  const f = makeupFlow(s);
  const cells: ('d' | 'c' | '')[] = MAKEUP_STEPS.map((m) => (f.states[m.no] === 'done' ? 'd' : ''));
  const cur = cells.findIndex((c) => c === '');
  if (cur > -1) cells[cur] = 'c';
  const doneN = cells.filter((c) => c === 'd').length;
  const block = f.issues.filter((i) => i.level === 'block');
  if (!s.source) return { headline: `${doneN}／5 步完成`, detail: '尚未匯入名單', tone: 'amb', cells };
  if (block.length === 0) return { headline: '①～⑤ 都完成', detail: `${f.summary.entries} 人次、${f.summary.students} 位學生；檢核與下載之後開放`, tone: 'mut', cells };
  return { headline: `${doneN}／5 步完成`, detail: `${block.length} 項待處理：${block[0]!.text}`, tone: 'amb', cells };
}

export { classSubjectMatrix, roomSeats };

// ───────────── ④ 選組拆分（F-17） ─────────────

/** 某科要不要依班級文理組拆成兩份卷；結構變了，計畫作廢 */
export function toggleSplitSubject(s: MakeupSession, subject: string, on: boolean): MakeupSession {
  const cur = s.settings.trackSplit;
  const subjects = on ? [...new Set([...(cur?.subjects ?? []), subject])] : (cur?.subjects ?? []).filter((x) => x !== subject);
  const { trackSplit: _t, ...rest } = s.settings;
  const settings: MakeupSettings = subjects.length === 0 && Object.keys(cur?.trackOfClass ?? {}).length === 0 ? rest : { ...rest, trackSplit: { subjects, trackOfClass: cur?.trackOfClass ?? {} } };
  return withoutPlan({ ...s, settings });
}

export function setClassTrackLabel(s: MakeupSession, oldClass: string, track: '文組' | '理組' | null): MakeupSession {
  const cur = s.settings.trackSplit ?? { subjects: [], trackOfClass: {} };
  const trackOfClass = { ...cur.trackOfClass };
  if (track) trackOfClass[oldClass] = track;
  else delete trackOfClass[oldClass];
  return withoutPlan({ ...s, settings: { ...s.settings, trackSplit: { subjects: [...cur.subjects], trackOfClass } } });
}
