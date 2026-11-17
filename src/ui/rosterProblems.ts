/**
 * G10：匯入學生名單時，有問題的列要逐列問使用者（手動補上／修改內容／略過）。
 * 純函式：把「讀得很乾淨的名單」加上「使用者對每個問題列的決定」合成最後要匯入的名單。
 * 不提供「稍後處理」：每一列都有決定、而且補上的內容合法，才算處理完（ready）。
 */
import type { Student } from '../data';
import type { RosterProblem } from '../import';

export type ProblemDecision =
  | { action: 'add' | 'edit'; classNo: number; seatNo: number; name: string; schoolId?: string }
  | { action: 'skip' };

export const PROBLEM_KIND_TEXT: Record<RosterProblem['kind'], string> = {
  'no-name': '缺少姓名',
  'bad-id': '班級或座號無法辨識',
  dup: '班級與座號重複',
  'dup-school-id': '學號重複',
};

export interface Resolution {
  /** 乾淨的名單加上使用者補上／修改的列（已略過的不在內） */
  students: Student[];
  /** 還沒決定的問題列（索引對應 problems） */
  pending: number[];
  /** 已選補上／修改、但內容不合法（空白、座號格式、與其他人撞班級座號或學號）的問題列與原因 */
  invalid: Record<number, string>;
  added: number;
  skipped: number;
  /** 每一列都決定了、內容也合法，才能按「確認取代」 */
  ready: boolean;
}

const isNo = (n: number): boolean => Number.isInteger(n) && n >= 1 && n <= 99;

export function resolveProblems(base: readonly Student[], problems: readonly RosterProblem[], decisions: Readonly<Record<number, ProblemDecision>>): Resolution {
  const students = [...base];
  const taken = new Map(base.map((s) => [`${s.classNo}-${s.seatNo}`, s]));
  const ids = new Map(base.filter((s) => s.schoolId).map((s) => [s.schoolId as string, s]));
  const pending: number[] = [];
  const invalid: Record<number, string> = {};
  let added = 0;
  let skipped = 0;
  problems.forEach((_, i) => {
    const d = decisions[i];
    if (!d) { pending.push(i); return; }
    if (d.action === 'skip') { skipped++; return; }
    const name = d.name.trim();
    const sid = (d.schoolId ?? '').trim();
    if (!isNo(d.classNo)) { invalid[i] = '班級要是 1～99 的整數'; return; }
    if (!isNo(d.seatNo)) { invalid[i] = '座號要是 1～99 的整數'; return; }
    if (!name) { invalid[i] = '姓名不能空白'; return; }
    const hit = taken.get(`${d.classNo}-${d.seatNo}`);
    if (hit) { invalid[i] = `班級 ${d.classNo} 座號 ${d.seatNo} 已經有「${hit.name}」，請改座號`; return; }
    if (sid && ids.has(sid)) { invalid[i] = `學號 ${sid} 已經是「${ids.get(sid)?.name}」的，請改學號或清空`; return; }
    const s: Student = { classNo: d.classNo, seatNo: d.seatNo, name, ...(sid ? { schoolId: sid } : {}) };
    taken.set(`${s.classNo}-${s.seatNo}`, s);
    if (sid) ids.set(sid, s);
    students.push(s);
    added++;
  });
  return { students, pending, invalid, added, skipped, ready: pending.length === 0 && Object.keys(invalid).length === 0 };
}

/** 按鈕上要寫的「還差什麼」：沒決定幾列、幾列內容有誤 */
export function problemBlockers(r: Resolution): string[] {
  const out: string[] = [];
  if (r.pending.length > 0) out.push(`還有 ${r.pending.length} 列問題沒有決定`);
  const bad = Object.keys(r.invalid).length;
  if (bad > 0) out.push(`${bad} 列補上的內容還有錯`);
  return out;
}
