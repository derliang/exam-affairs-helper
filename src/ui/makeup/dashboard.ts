/**
 * ⑥ 檢核與對帳儀表板、⑦ 下載閘門、全域摘要列（S-7、S-8、S-10）的資料層（K3）。
 * 純函式：畫面只讀這裡算好的東西；檢核本身在 core/makeup/checks.ts（K1，獨立重算），這裡只把結果整理成畫面要的樣子。
 *
 * 規則：紅燈（含算不出來）擋下載、必須修正、不可放行；琥珀只提示、不擋、不用確認（D153，取代規格 6.2 的「須確認」）；
 * 待執行（只有 C-14）不假裝綠燈，也不擋（回讀在產出後才跑，回讀不符由產出步驟擋交付）。
 */
import {
  downloadGate,
  roomSeats,
  runMakeupChecks,
  type CheckResult,
  type DownloadGate,
  type ProducedFile,
  type ReadbackSummary,
} from '../../core/makeup';
import type { Check, Light } from '../reconcile';
import { rowWhere } from './importOps';
import { baseOf, outputsOf, planOf, scheduleOf } from './pipeline';
import type { MakeupSession, ReconcileSnapshot } from './session';
import type { MakeupStepNo } from './steps';

/** 最近一次「產出檔案並回讀」的結果（只留在記憶體，不存檔：檔案是下載到使用者電腦的，這裡只記版本與回讀數字，供 C-14、C-15） */
export interface RunRecord {
  version: string;
  readback: ReadbackSummary[];
  produced: ProducedFile[];
  /** 回讀全部相符 */
  ok: boolean;
  /** 台北時間「11/17 14:32」 */
  at: string;
  /** 回讀不符的說明（ok＝false 才有） */
  problems: string[];
  fileNames: string[];
}

const runs = new Map<string, RunRecord>();
export const runOf = (id: string): RunRecord | undefined => runs.get(id);
export const setRun = (id: string, r: RunRecord | undefined): void => { if (r) runs.set(id, r); else runs.delete(id); };

export type GateState = 'none' | 'ok' | 'warn' | 'blocked';

export interface Summary {
  hasRoster: boolean;
  students: number;
  /** 應補考人次（納入排程） */
  entries: number;
  /** 另行通知人次（只統計，R-6） */
  notifiedEntries: number;
  subjects: number;
  days: number;
  slots: number;
  /** 實際有人考的考場數、全部可用座位、最擁擠時段同時使用的座位 */
  rooms: number;
  seats: number;
  seatsUsed: number;
  placed: number;
  /** 遺漏人次（排不進去＋還沒處理的問題列）；預期永遠 0 */
  lost: number;
  red: number;
  amber: number;
  green: number;
  pending: number;
}

export interface MissItem { text: string; step: MakeupStepNo }

export interface Dashboard {
  summary: Summary;
  checks: CheckResult[];
  gate: DownloadGate;
  state: GateState;
  missing: MissItem[];
  version: string;
  /** 已產出過、但名單或設定在那之後改過（C-15） */
  stale: boolean;
  run: RunRecord | undefined;
}

const emptySummary = (): Summary => ({ hasRoster: false, students: 0, entries: 0, notifiedEntries: 0, subjects: 0, days: 0, slots: 0, rooms: 0, seats: 0, seatsUsed: 0, placed: 0, lost: 0, red: 0, amber: 0, green: 0, pending: 0 });

const cache = new WeakMap<MakeupSession, { run: RunRecord | undefined; d: Dashboard }>();

/** 儀表板需要的全部資料。以場次物件與最近一次產出紀錄為鍵記憶（沒動就不重算） */
export function dashboardOf(s: MakeupSession, run: RunRecord | undefined = runOf(s.id)): Dashboard {
  const hit = cache.get(s);
  if (hit && hit.run === run) return hit.d;
  const d = compute(s, run);
  cache.set(s, { run, d });
  return d;
}

function compute(s: MakeupSession, run: RunRecord | undefined): Dashboard {
  const b = baseOf(s);
  const o = outputsOf(s);
  const hasRoster = b.roster.included.length + b.roster.notified.length > 0;
  const stale = !!run && run.version !== o.version;
  // 過期的回讀數字不能拿來對現在的資料（會假紅）；過期只由 C-15 提示
  const checks = runMakeupChecks({
    roster: b.roster,
    settings: b.settings,
    plan: planOf(s).plan,
    outputs: o.outputs,
    currentVersion: o.version,
    ...(run ? { produced: run.produced } : {}),
    ...(run && !stale ? { readback: run.readback } : {}),
  });
  const gate = downloadGate(checks);
  const { schedule, peak } = scheduleOf(s);

  const missing: MissItem[] = [
    ...b.roster.unresolved.map((u) => ({ text: `匯入${rowWhere(s.parse, u.draft)}還沒處理：${u.message}`, step: 2 as MakeupStepNo })),
    ...schedule.unplaced.map((u) => ({ text: `${u.studentId}　${u.subject}：${u.reason}`, step: 5 as MakeupStepNo })),
  ];

  const sittingSubjects = schedule.sittings.reduce((n, x) => n + x.subjects.length, 0);
  const seatsOf = (ids: Set<string>): number => b.settings.rooms.filter((r) => ids.has(r.id)).reduce((n, r) => n + roomSeats(r), 0);
  const allRooms = new Set(b.settings.rooms.map((r) => r.id));
  const count = (st: CheckResult['status']): number => checks.filter((c) => c.status === st).length;
  const summary: Summary = hasRoster
    ? {
        hasRoster,
        students: new Set([...b.roster.included, ...b.roster.notified].map((r) => r.studentId)).size,
        entries: b.entries.length,
        notifiedEntries: b.roster.notified.length,
        subjects: new Set(b.entries.map((e) => e.subject)).size,
        days: new Set(schedule.slots.map((x) => x.dayId)).size,
        slots: schedule.slots.length,
        rooms: new Set(schedule.sittings.map((x) => x.roomId)).size,
        seats: seatsOf(allRooms),
        seatsUsed: Math.max(0, ...peak.map((p) => p.peak)),
        placed: sittingSubjects,
        lost: missing.length,
        red: count('red'),
        amber: count('amber'),
        green: count('green'),
        pending: count('pending'),
      }
    : emptySummary();

  const state: GateState = !hasRoster ? 'none' : !gate.allowed ? 'blocked' : gate.warnings.length > 0 ? 'warn' : 'ok';
  return { summary, checks, gate, state, missing, version: o.version, stale, run };
}

// ───────────── 把 C 項目轉成對帳列（與考前對帳 G35 共用 CheckRow） ─────────────

const FORMULA: Record<CheckResult['id'], string> = {
  'C-1': '匯入列數 ＝ 納入 ＋ 另行通知 ＋ 略過（略過有紀錄）；沒處理的問題列要為 0',
  'C-2': '名單不重複學號數 ＝ 已安排學生數 ＋ 全為另行通知的學生數',
  'C-3': '納入人次 ＝ 已排程人次，每筆學生＋科目恰有一個考場',
  'C-4': '各科：統計人數 ＝ 各考場該科人數加總 ＝ 點名單該科列數 ＝ 備卷份數',
  'C-5': '每個考場每個時段：人數 ≤ 座位數',
  'C-6': '有考試的學生時段數 ＝ 已排座位數；座位無重複、無空缺',
  'C-7': '同一學生同一時段只有一個獨立科（綜合節、提前開考除外）',
  'C-8': '每班公告列數 ＝ 該班納入人次；全校加總 ＝ 納入人次',
  'C-9': '點名單人次 ＝ 納入人次；多科生一人一列、列出全部科目與卷數',
  'C-10': '備卷份數 ＝ 各卷人數，且份數落在實際考場',
  'C-11': '提前開考學生的離場時間重算相符，且印在點名單註欄、考程表與公告',
  'C-12': '提前開考學生的總作答時間 ≤ 設定上限',
  'C-13': '被拆到不同教室的同班同科班數（提前開考不算）',
  'C-14': '每份下載檔回讀後的總人次與各卷人數 ＝ 排程',
  'C-15': '已產出檔的版本碼 ＝ 目前資料的版本碼',
};

const LIGHT_OF: Record<CheckResult['status'], Light> = { green: 'pass', amber: 'warn', red: 'fail', pending: 'wait' };

/** 這個項目有問題時，使用者該去哪一步修 */
const FIX_STEP: Record<CheckResult['id'], MakeupStepNo> = {
  'C-1': 2, 'C-2': 5, 'C-3': 5, 'C-4': 5, 'C-5': 3, 'C-6': 3, 'C-7': 5, 'C-8': 5, 'C-9': 5, 'C-10': 5, 'C-11': 5, 'C-12': 5, 'C-13': 3, 'C-14': 7, 'C-15': 7,
};
const STEP_LABEL: Record<MakeupStepNo, string> = { 1: '① 補考設定', 2: '② 匯入名單', 3: '③ 教室設定', 4: '④ 人數統計', 5: '⑤ 考程編排', 6: '⑥ 檢核與對帳', 7: '⑦ 下載' };
export const stepLabel = (n: MakeupStepNo): string => STEP_LABEL[n];

/** 轉成與考前對帳同一種 Check（應有／實有／差異、明細、前往修正）；go 是「到某一步」的動作 */
export function toCheck(c: CheckResult, go: (n: MakeupStepNo) => void): Check {
  const step = FIX_STEP[c.id];
  return {
    id: c.id,
    title: c.title,
    light: LIGHT_OF[c.status],
    cap: false,
    a: c.expected,
    b: c.actual,
    d: c.diff,
    summary: c.summary,
    formula: FORMULA[c.id],
    issues: c.status === 'green' || c.status === 'pending' ? [] : c.details.map((x) => ({ text: x.text, go: { label: STEP_LABEL[step], run: () => go(step) } })),
  };
}

/** 閘門被擋時「怎麼修」：每個紅燈項目對應到要去的那一步，同一步只列一次 */
export function fixTargets(gate: DownloadGate): { step: MakeupStepNo; ids: string[] }[] {
  const by = new Map<MakeupStepNo, string[]>();
  for (const c of gate.blockers) by.set(FIX_STEP[c.id], [...(by.get(FIX_STEP[c.id]) ?? []), c.id]);
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([step, ids]) => ({ step, ids }));
}

/** 摘要列與步驟列用：⑥ 是否「做完」＝沒有紅燈（琥珀不影響）；⑦ ＝本版已產出且回讀全過 */
export function dashboardDone(s: MakeupSession): { six: boolean; seven: boolean } {
  const d = dashboardOf(s);
  return { six: d.state === 'ok' || d.state === 'warn', seven: !!d.run && d.run.ok && !d.stale };
}

// ───────────── 對帳快照存檔（規格 6.1：對帳結果隨補考場次存檔，留下查核軌跡） ─────────────

/** 目前的檢核結果整理成快照；`at` 由呼叫端給（測試可固定） */
export function snapshotOf(s: MakeupSession, at: string, run: RunRecord | undefined = runOf(s.id)): ReconcileSnapshot {
  const d = dashboardOf(s, run);
  return {
    at,
    version: d.version,
    gate: d.state,
    rows: d.checks.map((c) => ({ id: c.id, title: c.title, status: c.status, expected: c.expected, actual: c.actual, diff: c.diff })),
  };
}

/**
 * 把快照記到場次上。檢核結果與上一份相同（只有時間不同）就原樣回傳，避免每次點擊都多一筆存檔與復原記錄。
 * 還沒有名單的場次不記。
 */
export function withSnapshot(s: MakeupSession, at: string = new Date().toISOString(), run: RunRecord | undefined = runOf(s.id)): MakeupSession {
  const snap = snapshotOf(s, at, run);
  if (snap.gate === 'none' && !s.snapshot) return s;
  const prev = s.snapshot;
  if (prev && prev.version === snap.version && prev.gate === snap.gate && JSON.stringify(prev.rows) === JSON.stringify(snap.rows)) return s;
  return { ...s, snapshot: snap };
}
