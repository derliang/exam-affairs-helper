/**
 * ② 匯入名單的純邏輯（K2）：欄位對應畫面要的資料、重複匯入的差異（F-11）、取代／合併、問題列處理。
 * 解析與問題列判斷本身在核心（src/core/makeup/importRows.ts）；這裡只管「場次」層級的操作。
 */
import {
  REQUIRED_FIELDS,
  findMakeupHeader,
  mapMakeupColumns,
  parseMakeupSheet,
  parseMakeupWorkbook,
  type MakeupColumnMap,
  type MakeupField,
  type MakeupParseResult,
  type MakeupResolution,
  type MakeupRow,
} from '../../core/makeup';
import type { MakeupSession } from './session';

/** 欄位對應畫面（稿 S-3）的欄位順序與說明；必要欄位少了就無法排程 */
export const MAPPING_FIELDS: { field: MakeupField; label: string; hint: string }[] = [
  { field: 'studentId', label: '學號', hint: '認人與對帳用' },
  { field: 'oldClass', label: '舊班', hint: '班級以舊班、舊號為準（D122）' },
  { field: 'oldSeat', label: '舊號', hint: '' },
  { field: 'newClass', label: '新班', hint: '只留存參考' },
  { field: 'newSeat', label: '新號', hint: '只留存參考' },
  { field: 'name', label: '姓名', hint: '導師存參版與點名單用' },
  { field: 'subjectCode', label: '科代碼', hint: '可不對應' },
  { field: 'subjectName', label: '科目', hint: '' },
  { field: 'credit', label: '學分', hint: '可不對應' },
  { field: 'attr', label: '科屬性', hint: '1＝另行通知，只統計不排考程（暫定 U-1）' },
  { field: 'term', label: '學期', hint: '可不對應' },
  { field: 'score', label: '分數', hint: '可不對應' },
];
export const isRequiredField = (f: MakeupField): boolean => REQUIRED_FIELDS.includes(f);

export interface SheetPick {
  index: number;
  name: string;
  rows: string[][];
  /** 表頭列（0 起）；找不到 -1 */
  header: number;
  columns: MakeupColumnMap;
}

/** 讀進來的檔案 → 每張工作表的自動表頭與欄位對應；挑「辨識欄位最多」的一張給畫面預設 */
export function pickSheets(sheets: readonly { name: string; rows: string[][] }[]): { picks: SheetPick[]; main: number } {
  const picks = sheets.map((s, index) => {
    const header = findMakeupHeader(s.rows);
    return { index, name: s.name, rows: s.rows, header, columns: header >= 0 ? mapMakeupColumns(s.rows[header] ?? []) : {} };
  });
  let main = 0;
  let best = -1;
  for (const p of picks) {
    const score = Object.keys(p.columns).length;
    if (score > best) { best = score; main = p.index; }
  }
  return { picks, main };
}

/** 空檔：沒有任何非空的儲存格 */
export const isEmptyBook = (sheets: readonly { rows: string[][] }[]): boolean =>
  sheets.every((s) => s.rows.every((r) => r.every((c) => !c || !c.trim())));

const sameMap = (a: MakeupColumnMap, b: MakeupColumnMap): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * 依畫面確認的對應解析：使用者沒改對應就整本一起解析（多工作表、跨表判重）；
 * 改了對應就只解析所選那張工作表（手動表頭＋對應）。
 */
export function parseWithMapping(sheets: readonly { name: string; rows: string[][] }[], pick: SheetPick, columns: MakeupColumnMap, header: number): MakeupParseResult {
  if (header === pick.header && sameMap(columns, pick.columns)) return parseMakeupWorkbook(sheets);
  return parseMakeupSheet(pick.rows, {}, '', { header, columns });
}

// ───────────── F-11 重複匯入 ─────────────

export const rowKey = (r: Pick<MakeupRow, 'studentId' | 'subjectName'>): string => `${r.studentId}|${r.subjectName}`;

const allRows = (p: MakeupParseResult): MakeupRow[] => [...p.rows, ...p.problems.map((x) => x.draft)];
const sameContent = (a: MakeupRow, b: MakeupRow): boolean =>
  a.name === b.name && a.oldClass === b.oldClass && a.oldSeat === b.oldSeat && a.score === b.score && a.attr === b.attr;

export interface ImportDiff {
  /** 新檔與目前名單相同的列數（鍵與內容都一樣） */
  same: number;
  /** 新檔多出來的列 */
  added: number;
  /** 兩邊都有但內容不同（分數、班級、姓名…） */
  updated: number;
  /** 目前有、新檔沒有 */
  removed: number;
  /** 被移除的列中，已排進考程的人次（取代後 ⑥ 會立刻重新檢核；可能出現遺漏） */
  removedScheduled: number;
  /** 目前名單是否有內容（沒有就不必問取代或合併） */
  hasCurrent: boolean;
}

export function diffImport(current: MakeupParseResult | undefined, next: MakeupParseResult, scheduledKeys: ReadonlySet<string>): ImportDiff {
  const cur = new Map((current ? allRows(current) : []).map((r) => [rowKey(r), r]));
  const nxt = new Map(allRows(next).map((r) => [rowKey(r), r]));
  let same = 0;
  let updated = 0;
  let added = 0;
  for (const [k, r] of nxt) {
    const c = cur.get(k);
    if (!c) added++;
    else if (sameContent(c, r)) same++;
    else updated++;
  }
  let removed = 0;
  let removedScheduled = 0;
  for (const k of cur.keys()) {
    if (nxt.has(k)) continue;
    removed++;
    if (scheduledKeys.has(k)) removedScheduled++;
  }
  return { same, added, updated, removed, removedScheduled, hasCurrent: cur.size > 0 };
}

const stampSource = (s: MakeupSession, fileName: string, now: Date): MakeupSession => ({ ...s, source: { fileName, importedAt: now.toISOString() } });

/** 取代：整份換掉；先前的問題列處理與略過紀錄跟著作廢（列號對不上新檔）；已排好的考程保留但會被對齊 */
export function replaceImport(s: MakeupSession, parse: MakeupParseResult, fileName: string, now: Date): MakeupSession {
  return stampSource({ ...s, parse, resolutions: [] }, fileName, now);
}

/** 合併：保留目前的，只加入新檔多出來的列（新列的列號加前綴避免撞號） */
export function mergeImport(s: MakeupSession, parse: MakeupParseResult, fileName: string, now: Date): MakeupSession {
  const cur = s.parse;
  if (!cur) return replaceImport(s, parse, fileName, now);
  const have = new Set(allRows(cur).map(rowKey));
  const tag = `m${now.getTime().toString(36)}:`;
  const re = <T extends MakeupRow>(r: T): T => ({ ...r, rowId: `${tag}${r.rowId}` });
  const rows = parse.rows.filter((r) => !have.has(rowKey(r))).map(re);
  const problems = parse.problems.filter((p) => !have.has(rowKey(p.draft))).map((p) => ({ ...p, rowId: `${tag}${p.rowId}`, draft: re(p.draft) }));
  const merged: MakeupParseResult = {
    ...cur,
    rawCount: cur.rawCount + rows.length + problems.length,
    rows: [...cur.rows, ...rows],
    problems: [...cur.problems, ...problems],
    warnings: [...cur.warnings, ...parse.warnings],
  };
  return stampSource({ ...s, parse: merged }, fileName, now);
}

/** 多檔匯入（#506、D184）：新檔與目前名單「同學號同科」重疊的鍵（內容相同也算，要問使用者，不靜默略過） */
export function overlapKeys(current: MakeupParseResult | undefined, next: MakeupParseResult): string[] {
  if (!current) return [];
  const have = new Set(allRows(current).map(rowKey));
  return [...new Set(allRows(next).map(rowKey))].filter((k) => have.has(k));
}

/**
 * 依使用者逐筆的決定合併：不重疊的新列直接加入；重疊的鍵在 useNew 裡就改用新檔那一列（目前那列連同它的處理紀錄拿掉），否則保留目前的。
 * 新列的列號加前綴避免撞號。
 */
export function mergeImportWith(s: MakeupSession, parse: MakeupParseResult, fileName: string, now: Date, useNew: ReadonlySet<string>): MakeupSession {
  const cur = s.parse;
  if (!cur) return replaceImport(s, parse, fileName, now);
  const have = new Set(allRows(cur).map(rowKey));
  const tag = `m${now.getTime().toString(36)}:`;
  const re = <T extends MakeupRow>(r: T): T => ({ ...r, rowId: `${tag}${r.rowId}` });
  const take = (k: string): boolean => !have.has(k) || useNew.has(k);
  const dropped = new Set<string>([...cur.rows.filter((r) => useNew.has(rowKey(r))).map((r) => r.rowId), ...cur.problems.filter((x) => useNew.has(rowKey(x.draft))).map((x) => x.rowId)]);
  const curRows = cur.rows.filter((r) => !dropped.has(r.rowId));
  const curProblems = cur.problems.filter((x) => !dropped.has(x.rowId));
  const rows = parse.rows.filter((r) => take(rowKey(r))).map(re);
  const problems = parse.problems.filter((x) => take(rowKey(x.draft))).map((x) => ({ ...x, rowId: `${tag}${x.rowId}`, draft: re(x.draft) }));
  const merged: MakeupParseResult = {
    ...cur,
    rawCount: cur.rawCount - dropped.size + rows.length + problems.length,
    rows: [...curRows, ...rows],
    problems: [...curProblems, ...problems],
    warnings: [...cur.warnings, ...parse.warnings],
  };
  return stampSource({ ...s, parse: merged, resolutions: s.resolutions.filter((r) => !dropped.has(r.rowId)) }, fileName, now);
}

/** 重疊鍵對應的目前列與新列（畫面逐筆詢問用） */
export function overlapRows(current: MakeupParseResult, next: MakeupParseResult, keys: readonly string[]): { key: string; cur: MakeupRow; nxt: MakeupRow }[] {
  const c = new Map(allRows(current).map((r) => [rowKey(r), r]));
  const n = new Map(allRows(next).map((r) => [rowKey(r), r]));
  return keys.flatMap((key) => { const a = c.get(key); const b = n.get(key); return a && b ? [{ key, cur: a, nxt: b }] : []; });
}

// ───────────── 問題列處理（F-10） ─────────────

export function setResolution(s: MakeupSession, res: MakeupResolution): MakeupSession {
  return { ...s, resolutions: [...s.resolutions.filter((r) => r.rowId !== res.rowId), res] };
}
export const clearResolution = (s: MakeupSession, rowId: string): MakeupSession => ({ ...s, resolutions: s.resolutions.filter((r) => r.rowId !== rowId) });
