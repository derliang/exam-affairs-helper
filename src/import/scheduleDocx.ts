/**
 * 匯入現成的考程表（Word .docx）（使用者 2026-11-23）：讀出每天的日期與每個考試時段的開始時間，套進第 1 步的「考試日期與各節時間」。
 * 格式（學校的「時間科目表」）：一張表，第一列是「日期」＋每天（或每組）一欄，例「07月29日(星期三)」；其後每個時段成對兩列——
 * 「時間」列（發卷與說明、測驗起訖與分鐘數）與「科目」列；自習、休息列只有一段時間、不算考試時段；備註列略過。
 * 純邏輯，只靠 JSZip 解 docx，不依賴瀏覽器 DOM。
 */
import JSZip from 'jszip';
import type { DayTimes, PeriodTable } from '../data';
import { DEFAULT_BREAK, setBreak, setFirst, setManual, slotTimes, toMin } from '../core/examTimes';

export interface SchedSlot { subject: string; start: string; end: string; minutes: number }
export interface SchedDay {
  /** 表頭原文，例「07月29日(星期三)」「04月09日(星期四)文組」 */
  header: string;
  month?: number;
  day?: number;
  /** 一二三四五六日 */
  weekday?: string;
  /** 同一天分組別時的組別（文組、理組） */
  group?: string;
  slots: SchedSlot[];
}
export interface ParsedSchedule { days: SchedDay[] }

const WEEK = '日一二三四五六';
const unesc = (s: string): string => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const paras = (tc: string): string[] =>
  (tc.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []).map((p) => unesc((p.match(/<w:t(?: [^>]*)?>[^<]*<\/w:t>/g) ?? []).map((t) => t.replace(/<[^>]*>/g, '')).join('')).trim()).filter(Boolean);
const pad = (h: string, m: string): string => `${h.padStart(2, '0')}:${m}`;
const RANGE = /(\d{1,2}):(\d{2})\s*[-–~～]\s*(\d{1,2}):(\d{2})/;

/** 時間格 → 考試時段起訖；沒有「測驗」那一段（自習、休息、活動）回 undefined。發卷那一行不算 */
function examRange(lines: string[]): { start: string; end: string } | undefined {
  const cand = lines.filter((l) => RANGE.test(l) && !/發卷/.test(l) && /測驗|分/.test(l));
  const l = cand.find((x) => /測驗/.test(x)) ?? cand[cand.length - 1];
  const m = l?.match(RANGE);
  if (!m) return undefined;
  const start = pad(m[1]!, m[2]!);
  const end = pad(m[3]!, m[4]!);
  return toMin(end) > toMin(start) ? { start, end } : undefined;
}

export async function parseScheduleDocx(bytes: ArrayBuffer | Uint8Array): Promise<ParsedSchedule> {
  const zip = await JSZip.loadAsync(bytes);
  const f = zip.file('word/document.xml');
  if (!f) throw new Error('這不是 Word 檔（.docx）');
  const xml = await f.async('string');
  const rows = (xml.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) ?? []).map((tr) => (tr.match(/<w:tc[ >][\s\S]*?<\/w:tc>/g) ?? []).map(paras));
  const head = rows.findIndex((r) => r[0]?.some((t) => t.includes('日期')));
  if (head < 0) throw new Error('找不到考程表：表格第一列要有「日期」，每天一欄');
  const days: SchedDay[] = rows[head]!.slice(1).map((c) => {
    const header = c.join('').trim();
    const m = header.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(?:[（(]\s*星期\s*([一二三四五六日])\s*[）)])?\s*(.*)$/);
    return { header, ...(m ? { month: Number(m[1]), day: Number(m[2]), ...(m[3] ? { weekday: m[3] } : {}), ...(m[4]?.trim() ? { group: m[4].trim() } : {}) } : {}), slots: [] };
  });
  let times: string[][] | undefined;
  for (const r of rows.slice(head + 1)) {
    const label = (r[1]?.[0] ?? '').trim();
    if (label === '時間') { times = r.slice(2); continue; }
    if (label !== '科目' || !times) continue;
    r.slice(2).forEach((c, i) => {
      const range = examRange(times![i] ?? []);
      const subject = (c[0] ?? '').trim();
      if (range && subject && days[i]) days[i]!.slots.push({ subject, start: range.start, end: range.end, minutes: toMin(range.end) - toMin(range.start) });
    });
    times = undefined;
  }
  const live = days.filter((d) => d.slots.length > 0 || d.month !== undefined);
  if (live.every((d) => d.slots.length === 0)) throw new Error('表格裡沒有找到考試時段（要有「測驗」起訖時間與科目）');
  return { days: live };
}

/** 年份只用月日與星期推：候選年裡星期全對的第一個；都不對（或沒星期）用第一個候選 */
export function pickYear(days: readonly SchedDay[], candidates: readonly number[]): number {
  const dated = days.filter((d) => d.month !== undefined && d.day !== undefined && d.weekday);
  return candidates.find((y) => dated.length > 0 && dated.every((d) => WEEK[new Date(Date.UTC(y, d.month! - 1, d.day!)).getUTCDay()] === d.weekday)) ?? candidates[0]!;
}

export interface ScheduleApply {
  /** 套進第 1 步的日期（第 1 天、第 2 天…）；表裡沒有日期就沒有這一項 */
  examDates?: string[];
  dayTimes?: DayTimes[];
  /** 給使用者看的結果摘要（每天一行）與要注意的地方 */
  lines: string[];
  notes: string[];
}

/** 把讀到的考程表對到這場考試的節次表：日期、每天第一節開始、其餘時段接不上的標手動 */
export function applySchedule(parsed: ParsedSchedule, table: PeriodTable, yearCandidates: readonly number[]): ScheduleApply {
  const notes: string[] = [];
  // 同一天分組別（文組／理組）只取第一欄
  const seen = new Set<string>();
  const cols = parsed.days.filter((d) => {
    if (d.month === undefined) return true;
    const k = `${d.month}/${d.day}`;
    if (seen.has(k)) { notes.push(`${d.month}/${d.day} 有多欄（${d.group ?? d.header}），這裡只取第一欄。`); return false; }
    seen.add(k);
    return true;
  });
  if (cols.length > table.days.length) notes.push(`考程表有 ${cols.length} 天，這場考試只有 ${table.days.length} 天，多的天數沒有套用。`);
  const use = cols.slice(0, table.days.length);
  const year = pickYear(use, yearCandidates);
  const dated = use.length > 0 && use.every((d) => d.month !== undefined);
  const examDates = dated ? use.map((d) => `${year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`) : undefined;
  if (examDates && use.some((d) => d.weekday && WEEK[new Date(`${examDates[use.indexOf(d)]}T00:00:00Z`).getUTCDay()] !== d.weekday)) notes.push('考程表上的星期與推算的年份對不起來，請確認日期。');
  let dt: DayTimes[] | undefined;
  const lines: string[] = [];
  use.forEach((d, day) => {
    const mine = slotTimes(table, dt).filter((t) => t.day === day);
    const n = Math.min(mine.length, d.slots.length);
    if (d.slots.length !== mine.length) notes.push(`第 ${day + 1} 天考程表有 ${d.slots.length} 個考試時段，節次表有 ${mine.length} 個，先套用前 ${n} 個，請確認。`);
    if (n === 0) return;
    dt = setBreak(setFirst(dt, day, d.slots[0]!.start), day, DEFAULT_BREAK);
    for (let k = 1; k < n; k++) {
      const chained = slotTimes(table, dt).find((t) => t.day === day && t.slot === mine[k]!.slot)?.start;
      if (chained !== d.slots[k]!.start) dt = setManual(dt, day, mine[k]!.slot, d.slots[k]!.start);
    }
    d.slots.slice(0, n).forEach((s, k) => {
      const m = mine[k]!.minutes;
      if (m && m !== s.minutes) notes.push(`第 ${day + 1} 天 ${s.subject}：考程表 ${s.minutes} 分，節次表 ${m} 分（結束時間以節次表為準）。`);
    });
    lines.push(`第 ${day + 1} 天${examDates ? `　${examDates[day]!.slice(5).replace('-', '/')}` : ''}：${d.slots.slice(0, n).map((s) => `${s.subject} ${s.start}`).join('、')}`);
  });
  return { ...(examDates ? { examDates } : {}), ...(dt ? { dayTimes: dt } : {}), lines, notes };
}
