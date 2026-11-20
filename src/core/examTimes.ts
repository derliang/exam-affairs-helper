/**
 * 每場考試各自的各節時間（#389、D177；稿 v2.79 方案 B）：純邏輯。
 * 規則：某天某時段的開始 ＝ 手動填的；否則若這天填了「第一節開始」就從前一時段結束＋休息接上；
 * 否則沿用共用節次表那一節的選填開始時間；都沒有就沒有時間。結束 ＝ 開始 ＋ 該時段各科時長的最大值。
 * 只用在顯示，不影響排座。
 */
import type { DayTimes, PeriodTable } from '../data';
import { numberRows } from './periods';

export const DEFAULT_BREAK = 10;
export const LATE_MIN = 18 * 60;

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const isTime = (s: string | undefined): s is string => !!s && HHMM.test(s);
export const toMin = (s: string): number => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
export const fmtMin = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export type TimeSource = 'manual' | 'chain' | 'shared' | 'none';
export interface SlotTime {
  day: number;
  /** 當天時段（1 起） */
  slot: number;
  start?: string;
  startMin?: number;
  /** 結束超過 24:00 時沒有 end（格式錯，見 timeIssues） */
  end?: string;
  endMin?: number;
  source: TimeSource;
  minutes?: number;
}

export interface TimeIssue {
  kind: 'overlap' | 'format' | 'late' | 'overnight';
  day: number;
  slot: number;
  text: string;
}

/** 一場考試每個時段的時間；dayTimes 沒填的天／時段沿用共用節次表 */
export function slotTimes(table: PeriodTable, dayTimes?: readonly DayTimes[]): SlotTime[] {
  const rows = numberRows(table);
  const out: SlotTime[] = [];
  for (let day = 0; day < table.days.length; day++) {
    const dt = dayTimes?.[day];
    const slots = [...new Set(rows.filter((r) => r.day === day).map((r) => r.slot))];
    let prevEnd: number | undefined;
    for (const slot of slots) {
      const mine = rows.filter((r) => r.day === day && r.slot === slot);
      const mins = mine.map((r) => r.minutes).filter((m): m is number => typeof m === 'number' && m > 0);
      const minutes = mins.length ? Math.max(...mins) : undefined;
      const manual = dt?.manual?.[String(slot)];
      let start: number | undefined;
      let source: TimeSource = 'none';
      if (isTime(manual)) { start = toMin(manual); source = 'manual'; }
      else if (isTime(dt?.first)) {
        if (slot === slots[0]) start = toMin(dt.first);
        else if (prevEnd !== undefined) start = prevEnd + (dt.breakMin ?? DEFAULT_BREAK);
        if (start !== undefined) source = 'chain';
      }
      if (start === undefined) {
        const sh = mine.find((r) => isTime(r.start))?.start;
        if (isTime(sh)) { start = toMin(sh); source = 'shared'; }
      }
      const endMin = start !== undefined && minutes !== undefined ? start + minutes : undefined;
      prevEnd = endMin ?? start;
      out.push({
        day, slot, source,
        ...(minutes !== undefined ? { minutes } : {}),
        ...(start !== undefined ? { start: fmtMin(start % 1440), startMin: start } : {}),
        ...(endMin !== undefined ? { endMin, ...(endMin <= 1440 ? { end: fmtMin(endMin % 1440) } : {}) } : {}),
      });
    }
  }
  return out;
}

/** 「08:30–09:40」；沒有開始時間回空字串，沒有結束只寫「08:30 起」 */
export function rangeText(t: SlotTime | undefined): string {
  if (!t?.start) return '';
  return t.end ? `${t.start}–${t.end}` : `${t.start} 起`;
}

/** 某天（0 起）某時段（1 起）的時間文字（輸出用）；沒設定、共用表也沒填就是空字串 */
export function slotRange(table: PeriodTable, dayTimes: readonly DayTimes[] | undefined, day: number, slot: number): string {
  return rangeText(slotTimes(table, dayTimes).find((x) => x.day === day && x.slot === slot));
}

/** 防呆：格式錯、與前一時段重疊、跨午夜（紅，不能下載）；結束晚於 18:00（琥珀，只提醒） */
export function timeIssues(table: PeriodTable, dayTimes?: readonly DayTimes[]): TimeIssue[] {
  const issues: TimeIssue[] = [];
  dayTimes?.forEach((dt, day) => {
    const bad = [dt.first, ...Object.values(dt.manual ?? {})].some((v) => v !== undefined && v !== '' && !isTime(v));
    if (bad) issues.push({ kind: 'format', day, slot: 0, text: '請填 24 小時制「時:分」，例如 08:30 或 13:00。' });
  });
  let prev: SlotTime | undefined;
  for (const t of slotTimes(table, dayTimes)) {
    if (prev && prev.day !== t.day) prev = undefined;
    if (prev?.endMin !== undefined && t.startMin !== undefined && t.startMin < prev.endMin) {
      issues.push({ kind: 'overlap', day: t.day, slot: t.slot, text: `時段${t.slot}（${t.start}）開始，但前一個時段要到 ${fmtMin(prev.endMin % 1440)} 才結束。` });
    }
    if (t.endMin !== undefined && t.endMin > 1440) issues.push({ kind: 'overnight', day: t.day, slot: t.slot, text: `時段${t.slot}結束會超過 24:00，請提早開始或縮短休息。` });
    else if (t.endMin !== undefined && t.endMin > LATE_MIN && t.source !== 'shared') issues.push({ kind: 'late', day: t.day, slot: t.slot, text: `時段${t.slot}結束於 ${t.end}，比一般考試日晚。` });
    prev = t;
  }
  return issues;
}

/** 有紅字（格式、重疊、跨午夜）就不能下載；琥珀 late 不擋 */
export const hasBlockingTimeIssue = (issues: readonly TimeIssue[]): boolean => issues.some((i) => i.kind !== 'late');

// ───────── 編輯（回傳新的 dayTimes；全空就回 undefined，讓存檔沒有欄位） ─────────
const clean = (a: DayTimes[]): DayTimes[] | undefined => {
  const out = a.map((d) => {
    const r: DayTimes = {};
    if (d.first) r.first = d.first;
    if (d.breakMin !== undefined && d.breakMin !== DEFAULT_BREAK) r.breakMin = d.breakMin;
    if (d.manual && Object.keys(d.manual).length) r.manual = d.manual;
    return r;
  });
  while (out.length && !Object.keys(out[out.length - 1]!).length) out.pop();
  return out.length ? out : undefined;
};
const at = (a: readonly DayTimes[] | undefined, day: number): DayTimes[] => {
  const c = [...(a ?? [])];
  while (c.length <= day) c.push({});
  return c.map((d) => ({ ...d, ...(d.manual ? { manual: { ...d.manual } } : {}) }));
};
export function setFirst(a: readonly DayTimes[] | undefined, day: number, v: string): DayTimes[] | undefined {
  const c = at(a, day); c[day]!.first = v.trim(); return clean(c);
}
export function setBreak(a: readonly DayTimes[] | undefined, day: number, min: number): DayTimes[] | undefined {
  const c = at(a, day); c[day]!.breakMin = Math.max(0, Math.min(120, Math.round(min))); return clean(c);
}
/** 手動改某時段；空字串＝取消手動 */
export function setManual(a: readonly DayTimes[] | undefined, day: number, slot: number, v: string): DayTimes[] | undefined {
  const c = at(a, day);
  const m = { ...(c[day]!.manual ?? {}) };
  if (v.trim()) m[String(slot)] = v.trim(); else delete m[String(slot)];
  c[day]!.manual = m;
  return clean(c);
}
