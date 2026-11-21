/**
 * 一次匯入多個檔案（Issue #506、D187）的共用純邏輯。全站 5 處匯入共用：
 * ① 逐檔讀取、單檔壞檔不影響其他檔（readFiles）；
 * ② 跨檔（或同檔內）同一個「鍵」出現多次＝衝突，不可靜默略過或覆蓋，一律由使用者逐筆決定（groupByKey／resolveConflicts）；
 * ③ 學生名冊的合併把跨檔衝突轉成 G10 的「問題列」，沿用逐列修改／手動新增／確認無誤／不匯入（mergeRosterFiles）。
 * 這裡不碰畫面；畫面見 src/ui/pages/FileResults.tsx。
 */
import type { Student } from '../data';
import { originOf, type RosterProblem, type RosterResult } from './roster';

// ───────────── ① 逐檔讀取 ─────────────

export type FileRead<T> = { name: string; ok: true; value: T } | { name: string; ok: false; error: string };

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** 依選取順序逐檔讀取；任何一檔丟出錯誤都只記在那一檔，其他檔照常讀 */
export async function readFiles<F extends { name: string }, T>(files: readonly F[], read: (f: F) => Promise<T>): Promise<FileRead<T>[]> {
  const out: FileRead<T>[] = [];
  for (const f of files) {
    try {
      out.push({ name: f.name, ok: true, value: await read(f) });
    } catch (e) {
      out.push({ name: f.name, ok: false, error: errText(e) });
    }
  }
  return out;
}

/** 讀得進來的檔案（保留順序） */
export const okFiles = <T>(rs: readonly FileRead<T>[]): { name: string; value: T }[] =>
  rs.flatMap((r) => (r.ok ? [{ name: r.name, value: r.value }] : []));

/** 同一次選了同名檔案：回傳重複的檔名（只用來提醒，內容是否重複仍由衝突詢問處理） */
export const duplicateFileNames = (names: readonly string[]): string[] => {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const n of names) { if (seen.has(n)) dup.add(n); seen.add(n); }
  return [...dup];
};

// ───────────── ② 鍵值衝突（考試名單、補考列、版本、座位共用） ─────────────

export interface Candidate<T> { file: string; item: T; /** 全部檔案依序的流水號，決定合併後的順序 */ seq: number }
export interface Conflict<T> { key: string; candidates: Candidate<T>[] }
/** 選擇：保留第幾個候選（0 起），或 'skip'＝這一筆誰都不匯入 */
export type ConflictChoice = number | 'skip';

/** 把所有檔案的項目依鍵分組：只出現一次的直接進 unique；同鍵出現 2 次以上（跨檔或同檔內）進 conflicts */
export function groupByKey<T>(parts: readonly { file: string; items: readonly T[] }[], keyOf: (t: T) => string): { unique: Candidate<T>[]; conflicts: Conflict<T>[] } {
  const by = new Map<string, Candidate<T>[]>();
  let seq = 0;
  for (const p of parts) for (const item of p.items) {
    const k = keyOf(item);
    const list = by.get(k);
    const c = { file: p.file, item, seq: seq++ };
    if (list) list.push(c); else by.set(k, [c]);
  }
  const unique: Candidate<T>[] = [];
  const conflicts: Conflict<T>[] = [];
  for (const [key, list] of by) { if (list.length === 1) unique.push(list[0] as Candidate<T>); else conflicts.push({ key, candidates: list }); }
  return { unique, conflicts };
}

export interface Resolved<T> {
  items: T[];
  /** 還沒決定的衝突鍵（沒有「稍後處理」：全部決定才算完成） */
  pending: string[];
  /** 決定「誰都不匯入」的筆數 */
  skipped: number;
  ready: boolean;
}

/** 依使用者的逐筆決定產出最後清單；沒決定的衝突不會悄悄選一個 */
export function resolveConflicts<T>(unique: readonly Candidate<T>[], conflicts: readonly Conflict<T>[], choices: Readonly<Record<string, ConflictChoice>>): Resolved<T> {
  const kept: Candidate<T>[] = [...unique];
  const pending: string[] = [];
  let skipped = 0;
  for (const c of conflicts) {
    const d = choices[c.key];
    if (d === undefined) { pending.push(c.key); continue; }
    if (d === 'skip') { skipped++; continue; }
    const hit = c.candidates[d];
    if (hit) kept.push(hit); else pending.push(c.key);
  }
  kept.sort((a, b) => a.seq - b.seq);
  return { items: kept.map((k) => k.item), pending, skipped, ready: pending.length === 0 };
}

// ───────────── ③ 學生名冊多檔合併（跨檔衝突轉成 G10 問題列） ─────────────

export interface RosterPart { file: string; result: RosterResult }

const who = (s: { classNo: number; seatNo: number; name: string }): string => `${String(s.classNo).padStart(2, '0')} 班 ${s.seatNo} 號「${s.name}」`;

/**
 * 依選取順序合併多個檔案各自解析出的名冊。
 * 後面的檔案裡，與前面已收下的學生「班級＋座號相同」或「學號相同」者，不會被默默略過或覆蓋：
 * 轉成問題列（dup／dup-school-id），訊息指出與哪個檔案的哪一列重複，交給使用者逐列決定。
 * 每個問題列都帶上檔名與工作表，畫面才指得出是哪個檔案的哪一列。
 */
export function mergeRosterFiles(parts: readonly RosterPart[]): RosterResult & { perFile: { file: string; students: number; problems: number }[] } {
  const students: Student[] = [];
  const problems: RosterProblem[] = [];
  const issues: RosterResult['issues'] = [];
  const seat = new Map<string, { s: Student; file: string }>();
  const sid = new Map<string, { s: Student; file: string }>();
  const classTracks: NonNullable<RosterResult['classTracks']> = {};
  const multi = parts.length > 1;
  const perFile: { file: string; students: number; problems: number }[] = [];
  for (const { file, result } of parts) {
    const sheet = result.sheetName ?? '';
    let kept = 0;
    let probs = 0;
    for (const s of result.students) {
      const o = originOf(s);
      const hit = seat.get(`${s.classNo}-${s.seatNo}`);
      const idHit = s.schoolId ? sid.get(s.schoolId) : undefined;
      const prev = hit ?? idHit;
      if (prev && prev.file !== file) {
        const byId = !hit && !!idHit;
        problems.push({
          row: o?.row ?? 0, kind: byId ? 'dup-school-id' : 'dup',
          message: byId ? `學號 ${s.schoolId} 與檔案「${prev.file}」的 ${who(prev.s)} 相同` : `班級與座號與檔案「${prev.file}」的 ${who(prev.s)} 重複`,
          cells: (o?.cells ?? []).map((c) => c.trim()).filter(Boolean),
          draft: { classNo: s.classNo, seatNo: s.seatNo, name: s.name, ...(s.schoolId ? { schoolId: s.schoolId } : {}) },
          file, sheet,
        });
        probs++;
        continue;
      }
      students.push(s);
      kept++;
      if (!hit) seat.set(`${s.classNo}-${s.seatNo}`, { s, file });
      if (s.schoolId && !idHit) sid.set(s.schoolId, { s, file });
    }
    for (const pr of result.problems) { problems.push({ ...pr, file: pr.file ?? file, sheet: pr.sheet ?? sheet }); probs++; }
    for (const i of result.issues) if (!i.problem) issues.push({ ...i, message: multi ? `「${file}」${i.message}` : i.message });
    for (const [no, t] of Object.entries(result.classTracks ?? {})) {
      const n = Number(no);
      if (classTracks[n] && classTracks[n] !== t) issues.push({ row: 0, message: `班級 ${n} 的文理組在「${file}」與先前的檔案不同，以先讀到的為準` });
      else classTracks[n] = t;
    }
    perFile.push({ file, students: kept, problems: probs });
  }
  const first = parts[0]?.result;
  return {
    students, problems, issues,
    layout: first?.layout ?? 'unknown',
    sheetName: first?.sheetName ?? '',
    ...(Object.keys(classTracks).length > 0 ? { classTracks } : {}),
    perFile,
  };
}
