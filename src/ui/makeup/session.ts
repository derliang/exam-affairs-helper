/**
 * 補考場次（K2）：一個場次＝一個資料夾（D2、D113）的全部設定與匯入結果。純資料與純函式，不碰畫面。
 * 存放：`makeup/<id>/session.json`（folder.ts）。核心引擎（src/core/makeup，K1）只吃 settings／roster，
 * 本檔負責把「使用者填的設定」換成引擎要的 MakeupSettings，以及場次的建立、沿用上次（F-6）、檢查（F-1～F-3）。
 * 公開 repo：不得放真實學生資料，測試一律用假名單。
 */
import {
  DEFAULT_BREAK_MIN,
  DEFAULT_EARLY_RULE,
  DEFAULT_PERIOD_MIN,
  DEFAULT_START,
  GRADE_ORDER,
  GRADE_TEXT,
  defaultMakeupGroups,
  type EarlyStartRule,
  type GradeKey,
  type MakeupDay,
  type MakeupGroup,
  type MakeupParseResult,
  type MakeupPlan,
  type MakeupResolution,
  type MakeupRoom,
  type MakeupRow,
  type MakeupSettings,
  type TrackSplit,
} from '../../core/makeup';
import { isRealDate, shortDate } from '../examDates';
import type { Doc } from '../store';

export type MakeupSemester = 'first' | 'second' | 'summer';
export const SEMESTER_TEXT: Record<MakeupSemester, string> = { first: '第一學期', second: '第二學期', summer: '暑假' };

/** 一個考日（F-2、F-3）：日期選填但要在 ① 填好；開始時間用分鐘數（8:00＝480） */
export interface MakeupDayDef {
  id: string;
  /** 'YYYY-MM-DD'；沒填＝空字串 */
  date: string;
  start: number;
}

export interface MakeupSession {
  id: string;
  name: string;
  /** 學年度（民國年，F-1） */
  year: number;
  semester: MakeupSemester;
  createdAt: string;
  modifiedAt: string;
  /** F-2：可設多個考日，每個年級指定在哪一天 */
  days: MakeupDayDef[];
  gradeDay: Partial<Record<GradeKey, string>>;
  /** F-3：高中 50 分、初中 45 分、休息 10 分，皆可改 */
  periodMin: { senior: number; junior: number };
  breakMin: number;
  /** F-4、U-2：提前開考的判斷與上限 */
  early: EarlyStartRule;
  /** 科目人數達此值才建議成為獨立節（K1 的 independentMin；沒設用預設） */
  independentMin?: number;
  /** F-17 選組拆分：指定科目依學生班級的文理組拆成兩份卷、各自統計；沒設＝不拆 */
  trackSplit?: TrackSplit;
  /** F-5、U-5：座位表預設產生、標籤預設不產生 */
  options: { seatChart: boolean; labels: boolean };
  /** ② 匯入：來源檔名與時間；parse 是解析結果（含問題列），resolutions 是逐筆處理 */
  source?: { fileName: string; importedAt: string };
  parse?: MakeupParseResult;
  resolutions: MakeupResolution[];
  /** ③ 教室：全部教室與「本次不用」的教室 id（不用的不進排程） */
  rooms: MakeupRoom[];
  roomOff: string[];
  /** ⑤ 使用者調整過的考程；沒有＝每次都用系統建議（名單變動會跟著重排） */
  plan?: MakeupPlan;
  /** 沿用自哪一個場次（F-6），只作紀錄 */
  carriedFrom?: string;
  /** 規格 6.1：最近一次檢核的 C 項目數字與時間，隨場次存檔（查核軌跡）；每次變更與每次下載後重記 */
  snapshot?: ReconcileSnapshot;
}

/** 對帳快照：一次檢核的 C-1～C-15 結果（只存數字與狀態，不含學生資料） */
export interface ReconcileSnapshot {
  /** 檢核時間，ISO */
  at: string;
  /** 當時的資料版本碼 */
  version: string;
  /** 閘門：none 沒名單、ok、warn（有警示）、blocked（有紅燈） */
  gate: 'none' | 'ok' | 'warn' | 'blocked';
  rows: { id: string; title: string; status: 'green' | 'amber' | 'red' | 'pending'; expected: number; actual: number; diff: number }[];
}

export const makeupsOf = (doc: Pick<Doc, 'makeups'>): MakeupSession[] => doc.makeups ?? [];
export const findMakeup = (doc: Pick<Doc, 'makeups'>, id: string): MakeupSession | undefined => makeupsOf(doc).find((s) => s.id === id);

// ───────────── 建立與沿用（F-1、F-6） ─────────────

/** 學年度依日期推算（民國年）：8 月起算新學年；1～7 月屬上一學年（承 D51） */
export function schoolYearOf(now: Date): number {
  const y = now.getFullYear() - 1911;
  return now.getMonth() >= 7 ? y : y - 1;
}

/** 學期依日期推算：8～1 月上學期、2～6 月下學期、7 月暑假（補考多在期末、暑假舉行；使用者可改） */
export function semesterOf(now: Date): MakeupSemester {
  const m = now.getMonth() + 1;
  return m >= 2 && m <= 6 ? 'second' : m === 7 || m === 8 ? 'summer' : 'first';
}

export function defaultMakeupName(year: number, semester: MakeupSemester): string {
  return `${year} 學年${semester === 'summer' ? '暑假' : SEMESTER_TEXT[semester]}補考`;
}

const stamp = (n: Date) => n.toISOString();

/** 場次代碼：成為資料夾名稱（assertSafeId 只准字母數字底線連字號與中文） */
export function newMakeupId(existing: readonly string[], now: Date): string {
  const base = `mk-${now.getTime().toString(36)}`;
  let id = base;
  for (let n = 2; existing.includes(id); n++) id = `${base}-${n}`;
  return id;
}

export function newMakeupSession(o: { id: string; name: string; year: number; semester: MakeupSemester; now: Date; prev?: MakeupSession | undefined }): MakeupSession {
  const gradeDay: Partial<Record<GradeKey, string>> = {};
  for (const g of GRADE_ORDER) gradeDay[g] = 'd1';
  const base: MakeupSession = {
    id: o.id,
    name: o.name.trim() || defaultMakeupName(o.year, o.semester),
    year: o.year,
    semester: o.semester,
    createdAt: stamp(o.now),
    modifiedAt: stamp(o.now),
    days: [{ id: 'd1', date: '', start: DEFAULT_START }],
    gradeDay,
    periodMin: { ...DEFAULT_PERIOD_MIN },
    breakMin: DEFAULT_BREAK_MIN,
    early: { ...DEFAULT_EARLY_RULE },
    options: { seatChart: true, labels: false },
    resolutions: [],
    rooms: [],
    roomOff: [],
  };
  if (!o.prev) return base;
  // F-6：帶入上一次補考的教室、座位與每節時長；日期、考日對應與名單不帶
  const p = o.prev;
  return {
    ...base,
    periodMin: { ...p.periodMin },
    breakMin: p.breakMin,
    early: { ...p.early },
    ...(p.independentMin !== undefined ? { independentMin: p.independentMin } : {}),
    options: { ...p.options },
    rooms: structuredClone(p.rooms),
    roomOff: [...p.roomOff],
    carriedFrom: p.id,
  };
}

/** 沿用來源：最近建立的、有設過教室的場次 */
export function carrySourceOf(doc: Pick<Doc, 'makeups'>): MakeupSession | undefined {
  return [...makeupsOf(doc)].filter((s) => s.rooms.length > 0).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

// ───────────── Doc 上的變更（純函式，交給 App 的 edit 做復原與存檔） ─────────────

export const addMakeup = (doc: Doc, s: MakeupSession): Doc => ({ ...doc, makeups: [...makeupsOf(doc), s] });
export const deleteMakeup = (doc: Doc, id: string): Doc => ({ ...doc, makeups: makeupsOf(doc).filter((s) => s.id !== id) });

/** 更新一個場次；modifiedAt 一併更新（列表的「最後更新」）。沒變就回原物件 */
export function updateMakeup(doc: Doc, id: string, f: (s: MakeupSession) => MakeupSession, now: Date = new Date()): Doc {
  let hit = false;
  const next = makeupsOf(doc).map((s) => {
    if (s.id !== id) return s;
    const n = f(s);
    if (n === s) return s;
    hit = true;
    return { ...n, modifiedAt: stamp(now) };
  });
  return hit ? { ...doc, makeups: next } : doc;
}

// ───────────── 設定 → 核心引擎的設定 ─────────────

export function dayLabel(d: MakeupDayDef, index: number): string {
  return shortDate(d.date) || `考日 ${index + 1}`;
}

const groupLabel = (g: MakeupGroup): string => {
  const sen = g.id.endsWith('-senior');
  if (g.grades.length >= 3) return sen ? '高中' : '初中';
  return g.grades.map((x) => GRADE_TEXT[x]).join('、');
};

/** 場次設定 → K1 的 MakeupSettings（只含「本次使用」的教室） */
export function settingsOf(s: MakeupSession): MakeupSettings {
  const days: MakeupDay[] = s.days.map((d, i) => ({ id: d.id, label: dayLabel(d, i) }));
  const groups: MakeupGroup[] = [];
  for (const d of s.days) {
    const grades = GRADE_ORDER.filter((g) => s.gradeDay[g] === d.id);
    for (const g of defaultMakeupGroups(grades, d.id)) {
      groups.push({ ...g, label: groupLabel(g), start: d.start, periodMin: g.id.endsWith('-senior') ? s.periodMin.senior : s.periodMin.junior, breakMin: s.breakMin });
    }
  }
  return {
    days,
    groups,
    rooms: s.rooms.filter((r) => !s.roomOff.includes(r.id)),
    early: s.early,
    ...(s.trackSplit && s.trackSplit.subjects.length > 0 ? { trackSplit: s.trackSplit } : {}),
    ...(s.independentMin !== undefined ? { independentMin: s.independentMin } : {}),
  };
}

// ───────────── ① 設定的檢查（F-2、F-3、F-4；稿 S-2 的兩種錯誤） ─────────────

export interface SettingIssue {
  kind: 'day-past' | 'day-empty' | 'grade-unassigned' | 'time-bad';
  /** 要標在哪個考日（dayId）或年級 */
  dayId?: string;
  grade?: GradeKey;
  text: string;
}

/** presentGrades：名單裡實際出現的年級；今天由呼叫端傳入（純函式不取現在時間） */
export function settingIssues(s: MakeupSession, today: string, presentGrades: readonly GradeKey[]): SettingIssue[] {
  const out: SettingIssue[] = [];
  for (const d of s.days) {
    if (d.date && isRealDate(d.date) && d.date < today) out.push({ kind: 'day-past', dayId: d.id, text: '這個日期已經過了，請確認學期與日期' });
    if (!d.date) out.push({ kind: 'day-empty', dayId: d.id, text: '還沒填日期（公告與考程表需要日期）' });
    if (!Number.isFinite(d.start) || d.start < 0 || d.start >= 24 * 60) out.push({ kind: 'time-bad', dayId: d.id, text: '開始時間不正確' });
  }
  for (const g of presentGrades) {
    const day = s.gradeDay[g];
    if (!day || !s.days.some((d) => d.id === day)) {
      out.push({ kind: 'grade-unassigned', grade: g, text: `${GRADE_TEXT[g]}還沒有指定考日。名單裡有${GRADE_TEXT[g]}學生時，這會讓他們沒被排進任何考日。` });
    }
  }
  return out;
}

/** 新增一個考日：id 不重複；預設沿用第一個考日的開始時間 */
export function addDay(s: MakeupSession): MakeupSession {
  let n = s.days.length + 1;
  while (s.days.some((d) => d.id === `d${n}`)) n++;
  return { ...s, days: [...s.days, { id: `d${n}`, date: '', start: s.days[0]?.start ?? DEFAULT_START }] };
}

/** 移除考日：這一天的年級改回第一個考日（不讓年級懸空）；至少留一個考日 */
export function removeDay(s: MakeupSession, id: string): MakeupSession {
  if (s.days.length <= 1) return s;
  const days = s.days.filter((d) => d.id !== id);
  const gradeDay: Partial<Record<GradeKey, string>> = {};
  for (const g of GRADE_ORDER) gradeDay[g] = s.gradeDay[g] === id ? days[0]!.id : s.gradeDay[g]!;
  const { plan: _drop, ...rest } = s; // 群組變了，使用者調整過的考程作廢，回到系統建議
  void _drop;
  return { ...rest, days, gradeDay };
}

// ───────────── 讀檔還原：JSON 沒有 NaN／undefined，要補回來 ─────────────

const reviveRow = (r: MakeupRow): MakeupRow => ({ ...r, oldSeat: r.oldSeat ?? Number.NaN, newSeat: r.newSeat ?? null });

/** 存成 JSON 再讀回來，問題列草稿裡的 NaN 會變 null：還原成引擎預期的樣子 */
export function reviveSession(s: MakeupSession): MakeupSession {
  const parse = s.parse
    ? { ...s.parse, rows: s.parse.rows.map(reviveRow), problems: s.parse.problems.map((p) => ({ ...p, draft: reviveRow(p.draft) })) }
    : undefined;
  const { parse: _p, ...rest } = s;
  void _p;
  return {
    ...rest,
    ...(parse ? { parse } : {}),
    resolutions: (s.resolutions ?? []).map((r) => (r.action === 'fix' ? { ...r, row: reviveRow(r.row) } : r)),
    roomOff: s.roomOff ?? [],
    rooms: s.rooms ?? [],
  };
}
