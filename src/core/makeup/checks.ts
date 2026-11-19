/**
 * 補考檢核與對帳 C-1～C-15（規格第六章、D120）與下載閘門。
 *
 * 獨立重算：本模組**不讀排程引擎的結果**（MakeupSchedule），只用兩側資料——
 * 「應有」取自名單（MakeupRoster）與設定；「實有」取自最終產出模型（MakeupOutputs：點名單、公告、備卷、座位表、考程表註記），
 * 從輸出重新點人。任何一項算不出來（例外）一律視同不通過（紅）。
 *
 * 燈號（與 G35 一致）：green 通過、amber 警示（只提示，不擋下載，D153）、red 不通過（必須修正、不可放行）、pending 待執行（只有 C-14：還沒有檔可讀）。
 */
import { leaveNote, type MakeupOutputs, type RollCallSheet } from './outputs';
import { roomSeats, subjectMinutes } from './schedule';
import { entryKey, makeupEntries, type MakeupEntry } from './stats';
import { classroomSeats, seatLabel } from '../../data/helpers';
import { SKIP_REASON_TEXT, type CheckDetail, type CheckResult, type CheckStatus, type MakeupPlan, type MakeupRoster, type MakeupSettings } from './types';

/** 下載後回讀自己輸出檔得到的數字（K4 提供，C-14） */
export interface ReadbackSummary {
  file: string;
  /** 回讀點出的總人次 */
  total: number;
  /** 回讀點出的各卷人次（有就比） */
  byPaper?: Record<string, number>;
  /** 檔案上印的版本碼 */
  version?: string;
}

/** 已產出的檔（C-15） */
export interface ProducedFile {
  file: string;
  version: string;
}

export interface MakeupCheckInput {
  roster: MakeupRoster;
  settings: MakeupSettings;
  plan: MakeupPlan;
  /** 要檢核的最終產出模型 */
  outputs: MakeupOutputs;
  readback?: readonly ReadbackSummary[];
  produced?: readonly ProducedFile[];
  /** 目前的資料版本碼（makeupVersion） */
  currentVersion?: string;
}

const TITLES: Record<CheckResult['id'], string> = {
  'C-1': '匯入對帳',
  'C-2': '學生對帳',
  'C-3': '人次對帳',
  'C-4': '科目人數對帳',
  'C-5': '教室容量',
  'C-6': '座位對帳',
  'C-7': '時間衝突',
  'C-8': '班級公告對帳',
  'C-9': '點名單對帳',
  'C-10': '備卷對帳',
  'C-11': '洩題風險（離場時間）',
  'C-12': '提前開考上限',
  'C-13': '同班同科同室',
  'C-14': '產出回讀',
  'C-15': '過期檢查',
};

/** 下載閘門：這些項目紅燈（或算不出來）就禁止下載 */
export const BLOCKING_IDS: readonly CheckResult['id'][] = ['C-1', 'C-2', 'C-3', 'C-4', 'C-5', 'C-6', 'C-7', 'C-8', 'C-9', 'C-10', 'C-14'];
/** 這些項目是「警示」類：琥珀時只提示、不擋下載、不用確認（D153，與 D149① 一致） */
export const CONFIRM_IDS: readonly CheckResult['id'][] = ['C-11', 'C-12', 'C-13', 'C-15'];

type Id = CheckResult['id'];
const res = (id: Id, status: CheckStatus, expected: number, actual: number, summary: string, details: CheckDetail[] = []): CheckResult => ({
  id,
  title: TITLES[id],
  status,
  expected,
  actual,
  diff: actual - expected,
  summary,
  details,
});
/** 差異類：差異不為 0 或有明細即紅 */
const strict = (id: Id, expected: number, actual: number, details: CheckDetail[], ok: string, bad: string): CheckResult =>
  res(id, actual !== expected || details.length > 0 ? 'red' : 'green', expected, actual, actual !== expected || details.length > 0 ? bad : ok, details);

const fail = (id: Id, err: unknown): CheckResult =>
  res(id, 'red', 0, 0, `算不出來，視同不通過：${err instanceof Error ? err.message : String(err)}`, []);

const count = <K>(m: Map<K, number>, k: K, n = 1): void => {
  m.set(k, (m.get(k) ?? 0) + n);
};

interface Ctx {
  input: MakeupCheckInput;
  entries: MakeupEntry[];
  /** 名單上所有學號（納入＋另行通知） */
  allIds: Set<string>;
  includedIds: Set<string>;
  entryKeys: Set<string>;
  sheets: RollCallSheet[];
}

function c1({ input: { roster } }: Ctx): CheckResult {
  const actual = roster.included.length + roster.notified.length + roster.skipped.length;
  const details: CheckDetail[] = roster.unresolved.map((p) => ({ text: `未處理的問題列：${p.message}` }));
  const status: CheckStatus = actual !== roster.rawCount || roster.unresolved.length > 0 ? 'red' : 'green';
  const skippedInfo: CheckDetail[] = roster.skipped.map((s) => ({
    text: `略過第 ${s.row.srcRow} 列${s.row.sheet ? `（${s.row.sheet}）` : ''}：學號 ${s.row.studentId}「${s.row.subjectName}」，原因：${SKIP_REASON_TEXT[s.reason]}${s.note ? `（${s.note}）` : ''}`,
    studentId: s.row.studentId,
    subject: s.row.subjectName,
  }));
  const summary = `匯入 ${roster.rawCount} 列；納入 ${roster.included.length}＋另行通知 ${roster.notified.length}＋略過 ${roster.skipped.length}＝${actual}${roster.unresolved.length ? `；尚有 ${roster.unresolved.length} 筆問題列未處理` : ''}`;
  return res('C-1', status, roster.rawCount, actual, summary, [...details, ...skippedInfo]);
}

function c2(ctx: Ctx): CheckResult {
  const scheduled = new Set(ctx.sheets.flatMap((s) => s.rows.map((r) => r.studentId)));
  const notifiedOnly = [...ctx.allIds].filter((id) => !ctx.includedIds.has(id));
  const details: CheckDetail[] = [];
  for (const id of ctx.includedIds) if (!scheduled.has(id)) details.push({ text: `學號 ${id} 沒有被安排任何考場`, studentId: id });
  for (const id of scheduled) if (!ctx.includedIds.has(id)) details.push({ text: `學號 ${id} 在點名單上，但不在納入名單`, studentId: id });
  const actual = [...scheduled].filter((id) => ctx.includedIds.has(id)).length + notifiedOnly.length;
  return strict('C-2', ctx.allIds.size, actual, details, `不重複學號 ${ctx.allIds.size}＝已安排 ${actual - notifiedOnly.length}＋全為另行通知 ${notifiedOnly.length}`, `有 ${details.length} 位學生對不上`);
}

function c3(ctx: Ctx): CheckResult {
  const seen = new Map<string, number>();
  for (const s of ctx.sheets) for (const r of s.rows) for (const sub of r.subjects) count(seen, entryKey(r.studentId, sub));
  const details: CheckDetail[] = [];
  for (const e of ctx.entries) {
    const n = seen.get(entryKey(e.studentId, e.subject)) ?? 0;
    if (n === 0) details.push({ text: `漏排：學號 ${e.studentId}（${e.oldClass} ${e.oldSeat} 號）${e.subject}`, studentId: e.studentId, subject: e.subject, oldClass: e.oldClass });
    else if (n > 1) details.push({ text: `重複排：學號 ${e.studentId} ${e.subject} 被排了 ${n} 次`, studentId: e.studentId, subject: e.subject });
  }
  for (const k of seen.keys()) {
    if (!ctx.entryKeys.has(k)) {
      const [id, sub] = k.split('|') as [string, string];
      details.push({ text: `多排：學號 ${id} ${sub} 不在納入名單`, studentId: id, subject: sub });
    }
  }
  const actual = [...seen.values()].reduce((a, b) => a + b, 0);
  return strict('C-3', ctx.entries.length, actual, details, `納入人次 ${ctx.entries.length}＝已排程 ${actual}，逐筆恰有一個考場`, `有 ${details.length} 筆人次對不上`);
}

function c4(ctx: Ctx): CheckResult {
  const { outputs } = ctx.input;
  const stat = new Map<string, number>();
  for (const e of ctx.entries) count(stat, e.paper);
  const rooms = new Map<string, number>();
  for (const s of ctx.sheets) for (const [p, n] of Object.entries(s.paperTotals)) count(rooms, p, n);
  const rows = new Map<string, number>();
  for (const s of ctx.sheets) for (const r of s.rows) for (const p of r.papers) count(rows, p);
  const prep = new Map<string, number>();
  for (const p of outputs.papers) count(prep, p.paper, p.count);
  const details: CheckDetail[] = [];
  for (const p of new Set([...stat.keys(), ...rooms.keys(), ...rows.keys(), ...prep.keys()])) {
    const a = stat.get(p) ?? 0;
    const b = rooms.get(p) ?? 0;
    const c = rows.get(p) ?? 0;
    const d = prep.get(p) ?? 0;
    if (a !== b || a !== c || a !== d) details.push({ text: `${p}：統計 ${a}、各考場加總 ${b}、點名單 ${c}、備卷 ${d}`, subject: p });
  }
  const actual = [...rows.values()].reduce((x, y) => x + y, 0);
  return strict('C-4', ctx.entries.length, actual, details, `${stat.size} 份卷，統計＝考場加總＝點名單＝備卷`, `有 ${details.length} 份卷的人數對不上`);
}

function c5(ctx: Ctx): CheckResult {
  const { settings } = ctx.input;
  const details: CheckDetail[] = [];
  let over = 0;
  for (const s of ctx.sheets) {
    const room = settings.rooms.find((r) => r.id === s.roomId);
    if (!room) {
      details.push({ text: `${s.roomName}：教室設定中找不到這間教室`, roomId: s.roomId, slotId: s.slotId });
      over += s.rows.length;
      continue;
    }
    const cap = roomSeats(room);
    if (s.rows.length > cap) {
      over += s.rows.length - cap;
      details.push({ text: `${room.name} ${s.slotId}：${s.rows.length} 人，座位 ${cap}，超額 ${s.rows.length - cap} 人`, roomId: room.id, slotId: s.slotId });
    }
  }
  // 同一間教室在同考日重疊時間被兩個時段使用
  for (let i = 0; i < ctx.sheets.length; i++) {
    for (let j = i + 1; j < ctx.sheets.length; j++) {
      const a = ctx.sheets[i] as RollCallSheet;
      const b = ctx.sheets[j] as RollCallSheet;
      if (a.roomId === b.roomId && a.dayId === b.dayId && a.slotId !== b.slotId && a.start < b.end && b.start < a.end) {
        over += Math.min(a.rows.length, b.rows.length);
        details.push({ text: `${a.roomName} 同時被 ${a.slotId} 與 ${b.slotId} 使用（時間重疊）`, roomId: a.roomId, slotId: b.slotId });
      }
    }
  }
  return strict('C-5', 0, over, details, `${ctx.sheets.length} 個考場時段，人數都不超過座位`, `有 ${details.length} 個考場超額或衝突`);
}

function c6(ctx: Ctx): CheckResult {
  const { settings, outputs } = ctx.input;
  const expected = ctx.sheets.reduce((n, s) => n + s.rows.length, 0);
  const details: CheckDetail[] = [];
  let actual = 0;
  const tables = new Map(outputs.seatTables.map((t) => [`${t.slotId}@@${t.roomId}`, t]));
  for (const s of ctx.sheets) {
    const t = tables.get(`${s.slotId}@@${s.roomId}`);
    const room = settings.rooms.find((r) => r.id === s.roomId);
    const valid = new Set(room ? classroomSeats({ ...room, kind: 'class' }).map(seatLabel) : []);
    const used = new Set<string>();
    const seated = new Set<string>();
    for (const x of t?.seats ?? []) {
      if (x.seat === null) {
        details.push({ text: `${s.roomName} ${s.slotId}：學號 ${x.studentId} 沒有座位`, studentId: x.studentId, slotId: s.slotId, roomId: s.roomId });
        continue;
      }
      if (!valid.has(x.seat)) details.push({ text: `${s.roomName} ${s.slotId}：座位 ${x.seat} 不在教室座位中`, studentId: x.studentId, slotId: s.slotId, roomId: s.roomId });
      if (used.has(x.seat)) details.push({ text: `${s.roomName} ${s.slotId}：座位 ${x.seat} 重複`, studentId: x.studentId, slotId: s.slotId, roomId: s.roomId });
      if (seated.has(x.studentId)) details.push({ text: `${s.roomName} ${s.slotId}：學號 ${x.studentId} 有兩個座位`, studentId: x.studentId, slotId: s.slotId, roomId: s.roomId });
      used.add(x.seat);
      seated.add(x.studentId);
      actual++;
    }
    for (const r of s.rows) {
      if (!seated.has(r.studentId)) details.push({ text: `${s.roomName} ${s.slotId}：學號 ${r.studentId} 在點名單上但座位表沒有`, studentId: r.studentId, slotId: s.slotId, roomId: s.roomId });
    }
    const onSheet = new Set(s.rows.map((r) => r.studentId));
    for (const id of seated) if (!onSheet.has(id)) details.push({ text: `${s.roomName} ${s.slotId}：學號 ${id} 在座位表上但點名單沒有`, studentId: id, slotId: s.slotId, roomId: s.roomId });
  }
  const sheetKeys = new Set(ctx.sheets.map((s) => `${s.slotId}@@${s.roomId}`));
  for (const t of outputs.seatTables) {
    if (!sheetKeys.has(`${t.slotId}@@${t.roomId}`) && t.seats.length) {
      details.push({ text: `座位表 ${t.roomId} ${t.slotId} 沒有對應的點名單`, slotId: t.slotId, roomId: t.roomId });
      actual += t.seats.length;
    }
  }
  return strict('C-6', expected, actual, details, `有考試的學生時段 ${expected}＝已排座位 ${actual}，無重複、無空缺`, `有 ${details.length} 個座位問題`);
}

function c7(ctx: Ctx): CheckResult {
  const per = new Map<string, { s: RollCallSheet; subjects: string[] }[]>();
  const details: CheckDetail[] = [];
  for (const s of ctx.sheets) {
    for (const r of s.rows) {
      const a = per.get(r.studentId) ?? [];
      a.push({ s, subjects: r.subjects });
      per.set(r.studentId, a);
      if (s.kind === 'independent' && r.subjects.length > 1) {
        details.push({ text: `學號 ${r.studentId} 在獨立節 ${s.slotId} 同時有 ${r.subjects.join('、')}`, studentId: r.studentId, slotId: s.slotId });
      }
    }
  }
  for (const [id, list] of per) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = (list[i] as { s: RollCallSheet }).s;
        const b = (list[j] as { s: RollCallSheet }).s;
        if (a.dayId === b.dayId && a.start < b.end && b.start < a.end) {
          details.push({ text: `學號 ${id} 在 ${a.slotId}（${a.roomName}）與 ${b.slotId}（${b.roomName}）時間重疊`, studentId: id, slotId: b.slotId });
        }
      }
    }
  }
  return strict('C-7', 0, details.length, details, '沒有學生同一時段有兩個獨立科', `有 ${details.length} 個時間衝突`);
}

function c8(ctx: Ctx): CheckResult {
  const { outputs } = ctx.input;
  const expectByClass = new Map<string, number>();
  for (const e of ctx.entries) count(expectByClass, e.oldClass);
  const where = new Map<string, string>();
  for (const s of ctx.sheets) for (const r of s.rows) for (const sub of r.subjects) where.set(entryKey(r.studentId, sub), `${s.slotId}@@${s.roomId}`);
  const details: CheckDetail[] = [];
  let actual = 0;
  const seenClass = new Set<string>();
  for (const a of outputs.announcements) {
    seenClass.add(a.oldClass);
    actual += a.rows.length;
    const exp = expectByClass.get(a.oldClass) ?? 0;
    if (a.rows.length !== exp) details.push({ text: `${a.oldClass}：公告 ${a.rows.length} 列，應有 ${exp}`, oldClass: a.oldClass });
    for (const r of a.rows) {
      const k = entryKey(r.studentId, r.subject);
      if (!ctx.entryKeys.has(k)) details.push({ text: `${a.oldClass}：學號 ${r.studentId} ${r.subject} 不在納入名單`, studentId: r.studentId, subject: r.subject, oldClass: a.oldClass });
      else if (where.get(k) !== `${r.slotId}@@${r.roomId}`) {
        details.push({ text: `${a.oldClass}：學號 ${r.studentId} ${r.subject} 的時間或地點與點名單不同`, studentId: r.studentId, subject: r.subject, oldClass: a.oldClass });
      }
    }
  }
  for (const [cls, n] of expectByClass) if (!seenClass.has(cls)) details.push({ text: `${cls}：缺少班級公告（應有 ${n} 列）`, oldClass: cls });
  return strict('C-8', ctx.entries.length, actual, details, `${outputs.announcements.length} 班公告共 ${actual} 列＝納入人次`, `有 ${details.length} 處公告對不上`);
}

function c9(ctx: Ctx): CheckResult {
  const details: CheckDetail[] = [];
  let actual = 0;
  for (const s of ctx.sheets) {
    for (const r of s.rows) {
      actual += r.subjects.length;
      if (!ctx.allIds.has(r.studentId)) details.push({ text: `${s.roomName} ${s.slotId}：學號 ${r.studentId} 不在名單`, studentId: r.studentId, slotId: s.slotId });
    }
  }
  return strict('C-9', ctx.entries.length, actual, details, `${ctx.sheets.length} 張點名單共 ${actual} 人次＝納入人次`, '點名單人次或學號對不上');
}

function c10(ctx: Ctx): CheckResult {
  const { outputs } = ctx.input;
  const details: CheckDetail[] = [];
  const stat = new Map<string, number>();
  for (const e of ctx.entries) count(stat, e.paper);
  const prepTotal = new Map<string, number>();
  const prepCell = new Map<string, number>();
  for (const p of outputs.papers) {
    count(prepTotal, p.paper, p.count);
    count(prepCell, `${p.paper}@@${p.slotId}@@${p.roomId}`, p.count);
  }
  for (const p of new Set([...stat.keys(), ...prepTotal.keys()])) {
    const a = stat.get(p) ?? 0;
    const b = prepTotal.get(p) ?? 0;
    if (a !== b) details.push({ text: `${p}：備卷 ${b} 份，應有 ${a} 份`, subject: p });
  }
  const sheetCell = new Map<string, number>();
  for (const s of ctx.sheets) {
    for (const r of s.rows) {
      if (r.paperCount !== r.subjects.length || r.papers.length !== r.subjects.length) {
        details.push({ text: `學號 ${r.studentId}（${s.roomName}）卷數 ${r.paperCount}，科數 ${r.subjects.length}`, studentId: r.studentId, slotId: s.slotId });
      }
      for (const p of r.papers) count(sheetCell, `${p}@@${s.slotId}@@${s.roomId}`);
    }
  }
  for (const k of new Set([...sheetCell.keys(), ...prepCell.keys()])) {
    const a = sheetCell.get(k) ?? 0;
    const b = prepCell.get(k) ?? 0;
    if (a !== b) {
      const [paper, slotId, roomId] = k.split('@@') as [string, string, string];
      details.push({ text: `${paper} 在 ${roomId} ${slotId}：備卷 ${b} 份，點名單 ${a} 人`, subject: paper, slotId, roomId });
    }
  }
  const actual = [...prepTotal.values()].reduce((x, y) => x + y, 0);
  return strict('C-10', ctx.entries.length, actual, details, `備卷 ${actual} 份＝各科人數加總；多科生卷數＝科數`, `有 ${details.length} 處備卷對不上`);
}

/** 提前開考學生（計畫指定且在納入名單） */
const earlyIds = (ctx: Ctx): string[] => [...new Set(ctx.input.plan.groups.flatMap((g) => g.early))].filter((id) => ctx.includedIds.has(id)).sort();

function c11(ctx: Ctx): CheckResult {
  const { outputs } = ctx.input;
  const ids = earlyIds(ctx);
  if (ids.length === 0) return res('C-11', 'green', 0, 0, '沒有提前開考學生');
  const details: CheckDetail[] = [];
  let ok = 0;
  let broken = false;
  for (const id of ids) {
    const mine = ctx.sheets.filter((s) => s.kind === 'early' && s.rows.some((r) => r.studentId === id));
    const row = mine[0]?.rows.find((r) => r.studentId === id);
    if (!row || !mine[0]) {
      broken = true;
      details.push({ text: `學號 ${id} 列為提前開考，但沒有提前開考的點名單`, studentId: id });
      continue;
    }
    // 獨立重算：他所有科目在同考日一般時段（點名單）最後一場的結束時間
    const day = mine[0].dayId;
    const ends = ctx.sheets.filter((s) => s.kind !== 'early' && s.dayId === day && s.rows.some((r) => r.subjects.some((x) => row.subjects.includes(x)))).map((s) => s.end);
    const total = ctx.entries.filter((e) => e.studentId === id).length;
    const g = ctx.input.settings.groups.find((x) => x.id === ctx.input.plan.groups.find((p) => p.early.includes(id))?.groupId);
    const own = g ? g.start + ctx.entries.filter((e) => e.studentId === id).reduce((n, e) => n + subjectMinutes(ctx.input.settings.early, g, e.subject), 0) : NaN;
    const leave = ends.length ? Math.max(...ends) : own;
    if (!Number.isFinite(leave) || total === 0) {
      broken = true;
      details.push({ text: `學號 ${id} 的最早離場時間算不出來`, studentId: id });
      continue;
    }
    const note = leaveNote(leave);
    const missing: string[] = [];
    if (row.note !== note) missing.push(`點名單「註」欄（應為「${note}」，印的是「${row.note || '空白'}」）`);
    if (!outputs.timetableNotes.some((n) => n.studentId === id && n.text.includes(note))) missing.push('考程表注意事項');
    const ann = outputs.announcements.flatMap((a) => a.rows).filter((r) => r.studentId === id);
    if (ann.length === 0 || ann.some((r) => r.note !== note)) missing.push('班級公告');
    if (missing.length) {
      broken = true;
      details.push({ text: `學號 ${id}：${note}，未正確印在${missing.join('、')}`, studentId: id });
    } else {
      ok++;
      details.push({ text: `學號 ${id}（${row.oldClass} ${row.oldSeat} 號）提前開考，${note}`, studentId: id });
    }
  }
  // 規格：C-11 不通過為「警示」；但離場時間算錯或沒印，屬於產出錯誤，算不出來視同不通過
  return res('C-11', broken ? 'red' : 'amber', ids.length, ok, broken ? '有提前開考學生的離場時間算錯或沒印' : `${ids.length} 位提前開考學生的離場時間已計算並印出，請確認`, details);
}

function c12(ctx: Ctx): CheckResult {
  const { settings, plan } = ctx.input;
  const ids = earlyIds(ctx);
  if (ids.length === 0) return res('C-12', 'green', 0, 0, '沒有提前開考學生');
  const details: CheckDetail[] = [];
  let ok = 0;
  for (const id of ids) {
    const g = settings.groups.find((x) => x.id === plan.groups.find((p) => p.early.includes(id))?.groupId);
    if (!g) {
      details.push({ text: `學號 ${id} 的考程群組找不到`, studentId: id });
      continue;
    }
    const total = ctx.entries.filter((e) => e.studentId === id).reduce((n, e) => n + subjectMinutes(settings.early, g, e.subject), 0);
    if (total > settings.early.capMin) details.push({ text: `學號 ${id} 總作答 ${total} 分，超過上限 ${settings.early.capMin} 分`, studentId: id });
    else ok++;
  }
  return res('C-12', details.length ? 'amber' : 'green', ids.length, ok, details.length ? `${details.length} 位超過上限 ${settings.early.capMin} 分` : `都不超過上限 ${settings.early.capMin} 分`, details);
}

function c13(ctx: Ctx): CheckResult {
  const rooms = new Map<string, Set<string>>();
  const names = new Map<string, string>();
  for (const s of ctx.sheets) {
    if (s.kind === 'early') continue; // D123：提前開考的學生不算被拆班
    names.set(s.roomId, s.roomName);
    for (const r of s.rows) {
      for (const sub of r.subjects) {
        const k = `${s.slotId}@@${r.oldClass}@@${sub}`;
        const set = rooms.get(k) ?? new Set<string>();
        set.add(s.roomId);
        rooms.set(k, set);
      }
    }
  }
  const details: CheckDetail[] = [];
  for (const [k, set] of rooms) {
    if (set.size < 2) continue;
    const [slotId, oldClass, sub] = k.split('@@') as [string, string, string];
    details.push({ text: `${oldClass} ${sub}（${slotId}）分在 ${[...set].map((id) => names.get(id) ?? id).join('、')}`, oldClass, subject: sub, slotId });
  }
  const classes = new Set(details.map((d) => d.oldClass));
  return res('C-13', details.length ? 'amber' : 'green', 0, classes.size, details.length ? `${classes.size} 個班有同科被拆到不同教室` : '同班同科都在同一間教室', details);
}

function c14(ctx: Ctx): CheckResult {
  const rb = ctx.input.readback;
  const expected = ctx.entries.length;
  if (!rb || rb.length === 0) return res('C-14', 'pending', expected, 0, '還沒有產出檔可回讀（下載時執行）');
  const stat = new Map<string, number>();
  for (const e of ctx.entries) count(stat, e.paper);
  const details: CheckDetail[] = [];
  for (const f of rb) {
    if (f.total !== expected) details.push({ text: `${f.file}：回讀 ${f.total} 人次，排程 ${expected} 人次` });
    if (f.byPaper) {
      for (const p of new Set([...stat.keys(), ...Object.keys(f.byPaper)])) {
        if ((f.byPaper[p] ?? 0) !== (stat.get(p) ?? 0)) details.push({ text: `${f.file}：${p} 回讀 ${f.byPaper[p] ?? 0}，應有 ${stat.get(p) ?? 0}`, subject: p });
      }
    }
    if (ctx.input.currentVersion && f.version && f.version !== ctx.input.currentVersion) {
      details.push({ text: `${f.file}：版本碼 ${f.version} 與目前 ${ctx.input.currentVersion} 不同` });
    }
  }
  const ok = rb.length - new Set(details.map((d) => d.text.split('：')[0])).size;
  return res('C-14', details.length ? 'red' : 'green', rb.length, ok, details.length ? `${details.length} 處回讀與排程不一致` : `${rb.length} 份檔回讀總數與排程一致`, details);
}

function c15(ctx: Ctx): CheckResult {
  const files = ctx.input.produced ?? [];
  const cur = ctx.input.currentVersion;
  if (files.length === 0) return res('C-15', 'green', 0, 0, '尚未產出任何檔');
  if (!cur) return res('C-15', 'red', files.length, 0, '算不出來，視同不通過：沒有目前的版本碼');
  const stale = files.filter((f) => f.version !== cur);
  return res(
    'C-15',
    stale.length ? 'amber' : 'green',
    files.length,
    files.length - stale.length,
    stale.length ? `${stale.length} 份已產出的檔已過期，請重新下載` : '已產出的檔都是最新版本',
    stale.map((f) => ({ text: `${f.file}（版本 ${f.version}）已過期` })),
  );
}

const CHECKS: [Id, (ctx: Ctx) => CheckResult][] = [
  ['C-1', c1],
  ['C-2', c2],
  ['C-3', c3],
  ['C-4', c4],
  ['C-5', c5],
  ['C-6', c6],
  ['C-7', c7],
  ['C-8', c8],
  ['C-9', c9],
  ['C-10', c10],
  ['C-11', c11],
  ['C-12', c12],
  ['C-13', c13],
  ['C-14', c14],
  ['C-15', c15],
];

/** 跑全部 C-1～C-15；每項獨立，一項算不出來不影響其他項 */
export function runMakeupChecks(input: MakeupCheckInput): CheckResult[] {
  let ctx: Ctx;
  try {
    const entries = makeupEntries(input.roster, input.settings.trackSplit);
    ctx = {
      input,
      entries,
      allIds: new Set([...input.roster.included, ...input.roster.notified].map((r) => r.studentId)),
      includedIds: new Set(input.roster.included.map((r) => r.studentId)),
      entryKeys: new Set(entries.map((e) => entryKey(e.studentId, e.subject))),
      sheets: input.outputs.rollCalls,
    };
  } catch (err) {
    return CHECKS.map(([id]) => fail(id, err));
  }
  return CHECKS.map(([id, fn]) => {
    try {
      return fn(ctx);
    } catch (err) {
      return fail(id, err);
    }
  });
}

export interface DownloadGate {
  allowed: boolean;
  /** 紅燈（或算不出來）擋下的項目：必須修正，不可放行 */
  blockers: CheckResult[];
  /** 琥珀但還沒確認的項目 */
  /** 琥珀警示：只提示，不擋下載（D153） */
  warnings: CheckResult[];
  /** 中文說明，可直接顯示 */
  reasons: string[];
}

/**
 * 下載閘門（規格 6.2，D153 修訂）：C-1～C-10、C-14 紅燈禁止下載；C-11～C-13、C-15 琥珀只提示（warnings），不擋、不用確認。
 * 任何一項紅燈都不可放行（與 G35 一致）；C-14 待執行不擋（回讀在產出後才跑，K4 回讀不符要另外擋交付）；
 * 其他項目若是待執行（算不出來）視同不通過。缺項也視同不通過。
 */
export function downloadGate(checks: readonly CheckResult[]): DownloadGate {
  const byId = new Map(checks.map((c) => [c.id, c]));
  const blockers: CheckResult[] = [];
  const warnings: CheckResult[] = [];
  const reasons: string[] = [];
  for (const id of Object.keys(TITLES) as Id[]) {
    const c = byId.get(id);
    if (!c) {
      const missing = res(id, 'red', 0, 0, '沒有檢核結果，視同不通過');
      blockers.push(missing);
      reasons.push(`${id} ${TITLES[id]}：沒有檢核結果`);
      continue;
    }
    if (c.status === 'red' || (c.status === 'pending' && id !== 'C-14')) {
      blockers.push(c);
      reasons.push(`${id} ${c.title}：${c.summary}`);
    } else if (c.status === 'amber') {
      warnings.push(c);
    }
  }
  return { allowed: blockers.length === 0, blockers, warnings, reasons };
}

