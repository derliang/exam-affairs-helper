/**
 * 補考名單匯入（F-7～F-12、C-1 的資料來源）。
 * 輸入沿用專案現有名單匯入做法：`readXlsx`（src/import/xlsx.ts）讀出的 `string[][]`，本模組只做純解析。
 * 原始匯出檔欄位：學號、新班、新號、舊班、舊號、姓名、科代碼、科目名稱、科學分、科屬性、科學期、分數（一人一科一列）。
 */
import { normalizeCell } from '../../import/columns';
import type {
  GradeKey,
  MakeupColumnMap,
  MakeupField,
  MakeupImportOptions,
  MakeupParseResult,
  MakeupProblem,
  MakeupProblemKind,
  MakeupResolution,
  MakeupRoster,
  MakeupRow,
  SkippedRow,
} from './types';

/** U-1 暫定：科屬性＝1 為「另行通知」（D114）。核對更多匯出檔後改這裡 */
export const DEFAULT_NOTIFY_ATTRS: readonly string[] = ['1'];

const SYNONYMS: [MakeupField, RegExp][] = [
  ['studentId', /^(學號|學生學號|學籍號碼)$/],
  ['newClass', /^(新班|新班級|新班別)$/],
  ['newSeat', /^(新號|新座號)$/],
  ['oldClass', /^(舊班|舊班級|舊班別|原班|原班級|班級|班別)$/],
  ['oldSeat', /^(舊號|舊座號|原座號|原號|座號)$/],
  ['name', /^(姓名|學生姓名)$/],
  ['subjectCode', /^(科代碼|科目代碼|課程代碼|科目代號)$/],
  ['subjectName', /^(科目名稱|科目|科名|課程名稱|科目名)$/],
  ['credit', /^(科學分|學分|學分數)$/],
  ['attr', /^(科屬性|屬性|科目屬性)$/],
  ['term', /^(科學期|學期)$/],
  ['score', /^(分數|成績|學期成績|原始成績)$/],
];

/** 少了就無法排程的欄位 */
export const REQUIRED_FIELDS: readonly MakeupField[] = ['studentId', 'oldClass', 'oldSeat', 'name', 'subjectName'];

export function makeupFieldOf(header: string): MakeupField | null {
  const h = normalizeCell(header);
  for (const [f, re] of SYNONYMS) if (re.test(h)) return f;
  return null;
}

/** 表頭對應：同一欄位出現多次取第一個；「舊班」優先於「班級」 */
export function mapMakeupColumns(header: readonly string[]): MakeupColumnMap {
  const map: MakeupColumnMap = {};
  header.forEach((h, i) => {
    const f = makeupFieldOf(h);
    if (!f) return;
    const n = normalizeCell(h);
    // 「班級」「座號」只在沒有明確的舊班／舊號時才當舊班舊號
    const weak = (f === 'oldClass' && /^(班級|班別)$/.test(n)) || (f === 'oldSeat' && n === '座號');
    if (map[f] === undefined) map[f] = i;
    else if (!weak) {
      const prev = normalizeCell(header[map[f] as number] ?? '');
      const prevWeak = /^(班級|班別|座號)$/.test(prev);
      if (prevWeak) map[f] = i;
    }
  });
  return map;
}

/** 找表頭列：前 limit 列中同時有「學號」與「科目名稱」、辨識欄位最多的一列；找不到回 -1 */
export function findMakeupHeader(rows: readonly (readonly string[])[], limit = 40): number {
  let best = -1;
  let bestScore = 0;
  rows.slice(0, limit).forEach((r, i) => {
    const m = mapMakeupColumns(r);
    if (m.studentId === undefined || m.subjectName === undefined) return;
    const score = Object.keys(m).length;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}

const CN_NUM: Record<string, number> = { 一: 1, 二: 2, 三: 3, '1': 1, '2': 2, '3': 3 };

/**
 * 舊班 → 年級（預設規則）：
 * - 文字：「初／國」＝初中、「高」＝高中，後接一二三或 123，例「高一溫」「初二」「國3忠」
 * - 三位數班號：1xx～3xx＝高一～高三、7xx～9xx＝初一～初三（例 101、305、702）
 * 都不符回 null（列為「舊班舊號對不上」問題列，請使用者修改或由畫面傳入 gradeOf）。
 */
export function gradeOfClass(oldClass: string): GradeKey | null {
  const c = normalizeCell(oldClass);
  const m = /^([初國高])([一二三123])/.exec(c);
  if (m) {
    const n = CN_NUM[m[2] as string] as 1 | 2 | 3;
    return `${m[1] === '高' ? 'S' : 'J'}${n}` as GradeKey;
  }
  const d = /^(\d)\d{2}$/.exec(c);
  if (d) {
    const f = Number(d[1]);
    if (f >= 1 && f <= 3) return `S${f}` as GradeKey;
    if (f >= 7 && f <= 9) return `J${f - 6}` as GradeKey;
  }
  return null;
}

export const GRADE_TEXT: Record<GradeKey, string> = { J1: '初一', J2: '初二', J3: '初三', S1: '高一', S2: '高二', S3: '高三' };
export const GRADE_ORDER: readonly GradeKey[] = ['J1', 'J2', 'J3', 'S1', 'S2', 'S3'];
export const divisionOf = (g: GradeKey): 'junior' | 'senior' => (g.startsWith('J') ? 'junior' : 'senior');

function parseSeat(cell: string): number | null {
  const c = normalizeCell(cell);
  if (!/^\d{1,2}$/.test(c)) return null;
  const n = Number(c);
  return n > 0 ? n : null;
}

const cell = (r: readonly string[], i: number | undefined): string => (i === undefined ? '' : (r[i] ?? '').trim());

/** 同一學號同一科的鍵（以正規化後的科目名稱判斷） */
const dupKey = (row: Pick<MakeupRow, 'studentId' | 'subjectName'>): string =>
  `${normalizeCell(row.studentId)}|${normalizeCell(row.subjectName)}`;

const PROBLEM_TEXT: Record<MakeupProblemKind, string> = {
  'no-name': '沒有姓名',
  'no-id': '沒有學號',
  'bad-class': '舊班舊號對不上',
  dup: '同學號同科重複',
  'unknown-subject': '科目不認識',
};

interface Ctx {
  opts: MakeupImportOptions;
  /** dupKey → 第一筆 rowId */
  seen: Map<string, string>;
  /** 舊班|舊號 → 學號 */
  seatOwner: Map<string, string>;
}

const gradeFn = (opts: MakeupImportOptions) => opts.gradeOf ?? gradeOfClass;

/** 檢查一列；沒問題回 null，並把它登記進 ctx（之後的重複會被抓） */
function checkRow(row: MakeupRow, ctx: Ctx): { kind: MakeupProblemKind; message: string } | null {
  const at = `第 ${row.srcRow} 列${row.sheet ? `（${row.sheet}）` : ''}`;
  if (!row.studentId) return { kind: 'no-id', message: `${at}沒有學號` };
  if (!row.name) return { kind: 'no-name', message: `${at}學號 ${row.studentId} 沒有姓名` };
  const grade = row.oldClass ? gradeFn(ctx.opts)(row.oldClass) : null;
  if (!row.oldClass || !Number.isInteger(row.oldSeat) || row.oldSeat <= 0 || !grade) {
    const why = !row.oldClass ? '沒有舊班' : !grade ? `舊班「${row.oldClass}」無法判斷年級` : '舊號無法辨識';
    return { kind: 'bad-class', message: `${at}學號 ${row.studentId}：${why}` };
  }
  const seatKey = `${normalizeCell(row.oldClass)}|${row.oldSeat}`;
  const owner = ctx.seatOwner.get(seatKey);
  if (owner !== undefined && owner !== normalizeCell(row.studentId)) {
    return { kind: 'bad-class', message: `${at}舊班 ${row.oldClass} 舊號 ${row.oldSeat} 已屬於學號 ${owner}，與學號 ${row.studentId} 對不上` };
  }
  const subj = normalizeCell(row.subjectName);
  if (!subj || (ctx.opts.knownSubjects && !ctx.opts.knownSubjects.some((k) => normalizeCell(k) === subj))) {
    return { kind: 'unknown-subject', message: `${at}學號 ${row.studentId}：科目「${row.subjectName || '（空白）'}」不認識` };
  }
  const k = dupKey(row);
  const first = ctx.seen.get(k);
  if (first !== undefined) return { kind: 'dup', message: `${at}學號 ${row.studentId} 的「${row.subjectName}」重複（第一筆在 ${first}）` };
  ctx.seen.set(k, `第 ${row.srcRow} 列${row.sheet ? `（${row.sheet}）` : ''}`);
  ctx.seatOwner.set(seatKey, normalizeCell(row.studentId));
  return null;
}

/** 解析一張工作表（尚未處理問題列） */
export function parseMakeupSheet(
  rows: readonly (readonly string[])[],
  opts: MakeupImportOptions = {},
  sheet = '',
  /** 使用者手動指定的表頭列（0 起）與欄位對應（F-8：對應不到的欄位請使用者指定） */
  manual?: { header: number; columns: MakeupColumnMap },
): MakeupParseResult {
  const header = manual ? manual.header : findMakeupHeader(rows);
  const col = manual ? manual.columns : header >= 0 ? mapMakeupColumns(rows[header] ?? []) : {};
  const missing = REQUIRED_FIELDS.filter((f) => col[f] === undefined);
  const start = header + 1;
  const dataRows: { r: readonly string[]; i: number }[] = [];
  if (missing.length === 0) {
    for (let i = Math.max(0, start); i < rows.length; i++) {
      const r = rows[i] ?? [];
      if (r.every((c) => !c || !c.trim())) continue;
      dataRows.push({ r, i });
    }
  }
  const ctx: Ctx = { opts, seen: new Map(), seatOwner: new Map() };
  const out: MakeupRow[] = [];
  const problems: MakeupProblem[] = [];
  for (const { r, i } of dataRows) {
    const row = toRow(r, col, i + 1, sheet);
    const p = checkRow(row, ctx);
    if (p) problems.push({ rowId: row.rowId, srcRow: row.srcRow, kind: p.kind, message: p.message, cells: r.map((c) => c.trim()).filter(Boolean), draft: row });
    else out.push(row);
  }
  return { header, columns: col, missing, rawCount: dataRows.length, rows: out, problems, warnings: consistencyWarnings(out) };
}

function toRow(r: readonly string[], col: MakeupColumnMap, srcRow: number, sheet: string): MakeupRow {
  const oldSeat = parseSeat(cell(r, col.oldSeat));
  return {
    rowId: sheet ? `${sheet}!${srcRow}` : String(srcRow),
    sheet,
    srcRow,
    studentId: normalizeCell(cell(r, col.studentId)),
    name: cell(r, col.name),
    oldClass: normalizeCell(cell(r, col.oldClass)),
    oldSeat: oldSeat ?? Number.NaN,
    newClass: normalizeCell(cell(r, col.newClass)),
    newSeat: parseSeat(cell(r, col.newSeat)),
    subjectCode: normalizeCell(cell(r, col.subjectCode)),
    subjectName: normalizeCell(cell(r, col.subjectName)),
    credit: cell(r, col.credit),
    attr: normalizeCell(cell(r, col.attr)),
    term: cell(r, col.term),
    score: cell(r, col.score),
  };
}

/** F-12：同學號但姓名或舊班舊號不一致 */
function consistencyWarnings(rows: readonly MakeupRow[]): string[] {
  const first = new Map<string, MakeupRow>();
  const out: string[] = [];
  for (const r of rows) {
    const f = first.get(r.studentId);
    if (!f) {
      first.set(r.studentId, r);
      continue;
    }
    if (f.name !== r.name) out.push(`學號 ${r.studentId}：第 ${r.srcRow} 列的姓名與第 ${f.srcRow} 列不同`);
    if (f.oldClass !== r.oldClass || f.oldSeat !== r.oldSeat) {
      out.push(`學號 ${r.studentId}：第 ${r.srcRow} 列的舊班舊號（${r.oldClass}-${r.oldSeat}）與第 ${f.srcRow} 列（${f.oldClass}-${f.oldSeat}）不同`);
    }
  }
  return out;
}

/**
 * 多工作表（高一、高二分頁）一起解析：各表各自找表頭，問題與重複跨表一起判斷。
 * 每列 rowId 為「工作表名!列號」。
 */
export function parseMakeupWorkbook(sheets: readonly { name: string; rows: string[][] }[], opts: MakeupImportOptions = {}): MakeupParseResult {
  const parsed = sheets
    .map((s) => ({ s, p: parseMakeupSheet(s.rows, opts, sheets.length > 1 ? s.name : '') }))
    .filter(({ p }) => p.header >= 0 || p.rawCount > 0);
  if (parsed.length === 0) {
    return { header: -1, columns: {}, missing: [...REQUIRED_FIELDS], rawCount: 0, rows: [], problems: [], warnings: [] };
  }
  const usable = parsed.filter(({ p }) => p.missing.length === 0);
  if (usable.length === 0) return (parsed[0] as { p: MakeupParseResult }).p;
  // 跨表重新檢查一次（重複、舊班舊號衝突要跨表抓）
  const ctx: Ctx = { opts, seen: new Map(), seatOwner: new Map() };
  const rows: MakeupRow[] = [];
  const problems: MakeupProblem[] = [];
  for (const { p } of usable) {
    const all = [...p.rows.map((r) => ({ r, prob: undefined as MakeupProblem | undefined })), ...p.problems.map((x) => ({ r: x.draft, prob: x }))].sort(
      (a, b) => a.r.srcRow - b.r.srcRow,
    );
    for (const { r, prob } of all) {
      if (prob) {
        problems.push(prob);
        continue;
      }
      const c = checkRow(r, ctx);
      if (c) problems.push({ rowId: r.rowId, srcRow: r.srcRow, kind: c.kind, message: c.message, cells: [], draft: r });
      else rows.push(r);
    }
  }
  const first = (usable[0] as { p: MakeupParseResult }).p;
  return {
    header: first.header,
    columns: first.columns,
    missing: [],
    rawCount: usable.reduce((n, { p }) => n + p.rawCount, 0),
    rows,
    problems,
    warnings: consistencyWarnings(rows),
  };
}

/** 依科屬性判斷是否「另行通知」（R-6；U-1 參數化） */
export const isNotified = (row: Pick<MakeupRow, 'attr'>, notifyAttrs: readonly string[] = DEFAULT_NOTIFY_ATTRS): boolean =>
  notifyAttrs.includes(normalizeCell(row.attr));

/**
 * 套用問題列的處理（F-10），得到排程用的名單。
 * - fix：用使用者給的整列取代，**重新檢查**；仍有問題就留在 unresolved
 * - skip：記入 skipped（含原因）；也可略過沒有問題的列（例：非補考對象）
 * - 沒處理的問題列留在 unresolved（C-1 紅燈）
 */
export function resolveMakeup(parse: MakeupParseResult, resolutions: readonly MakeupResolution[] = [], opts: MakeupImportOptions = {}): MakeupRoster {
  const byId = new Map(resolutions.map((r) => [r.rowId, r]));
  const notifyAttrs = opts.notifyAttrs ?? DEFAULT_NOTIFY_ATTRS;
  const ctx: Ctx = { opts, seen: new Map(), seatOwner: new Map() };
  const skipped: SkippedRow[] = [];
  const kept: MakeupRow[] = [];
  const unresolved: MakeupProblem[] = [];
  const skip = (row: MakeupRow, res: Extract<MakeupResolution, { action: 'skip' }>) =>
    skipped.push({ rowId: row.rowId, reason: res.reason, ...(res.note ? { note: res.note } : {}), row });

  // 先放沒問題的列（保持原順序），再放處理過的問題列
  for (const row of parse.rows) {
    const res = byId.get(row.rowId);
    if (res?.action === 'skip') {
      skip(row, res);
      continue;
    }
    const fixed = res?.action === 'fix' ? { ...res.row, rowId: row.rowId, sheet: row.sheet, srcRow: row.srcRow } : row;
    const p = checkRow(fixed, ctx);
    if (p) unresolved.push({ rowId: row.rowId, srcRow: row.srcRow, kind: p.kind, message: p.message, cells: [], draft: fixed });
    else kept.push(fixed);
  }
  for (const prob of parse.problems) {
    const res = byId.get(prob.rowId);
    if (res?.action === 'skip') {
      skip(prob.draft, res);
      continue;
    }
    if (res?.action !== 'fix') {
      unresolved.push(prob);
      continue;
    }
    const fixed: MakeupRow = { ...res.row, rowId: prob.rowId, sheet: prob.draft.sheet, srcRow: prob.srcRow };
    const p = checkRow(fixed, ctx);
    if (p) unresolved.push({ ...prob, kind: p.kind, message: `${PROBLEM_TEXT[p.kind]}（修改後仍有問題）：${p.message}`, draft: fixed });
    else kept.push(fixed);
  }
  const gradeOf = gradeFn(opts);
  const gradeOfClassMap: Record<string, GradeKey> = {};
  for (const r of kept) {
    const g = gradeOf(r.oldClass);
    if (g) gradeOfClassMap[r.oldClass] = g;
  }
  return {
    rawCount: parse.rawCount,
    included: kept.filter((r) => !isNotified(r, notifyAttrs)),
    notified: kept.filter((r) => isNotified(r, notifyAttrs)),
    skipped,
    unresolved,
    gradeOfClass: gradeOfClassMap,
  };
}

export const problemKindText = (k: MakeupProblemKind): string => PROBLEM_TEXT[k];
