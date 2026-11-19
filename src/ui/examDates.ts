/**
 * 考試日期（#389、#352、#392；D163、D164）：純邏輯。日期存 `ExamConfig.examDates`（'YYYY-MM-DD'，第 1 天、第 2 天…）；
 * 沒填＝沒有這個欄位或空陣列，舊存檔都沒有。星期一律由日期算出，不另存。
 */
import type { ExamConfig } from '../data';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** 只留格式正確的日期（'YYYY-MM-DD' 且真有這一天） */
export function validDates(exam: Pick<ExamConfig, 'examDates'>): string[] {
  return (exam.examDates ?? []).filter((d) => isRealDate(d));
}

export function isRealDate(d: string | undefined): d is string {
  if (!d || !ISO.test(d)) return false;
  const t = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
}

/** 「一」「二」… */
export function weekdayOf(d: string): string {
  return WEEK[new Date(`${d}T00:00:00Z`).getUTCDay()]!;
}

/** 「12/14（一）」；沒有日期回空字串 */
export function shortDate(d: string | undefined): string {
  if (!isRealDate(d)) return '';
  return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}（${weekdayOf(d)}）`;
}

/** 列表用：「2026-12-14（一）～12-15（二）」；一天只寫一個；沒填回空字串 */
export function dateRangeText(exam: Pick<ExamConfig, 'examDates'>): string {
  const ds = validDates(exam);
  if (ds.length === 0) return '';
  const first = `${ds[0]}（${weekdayOf(ds[0]!)}）`;
  if (ds.length === 1) return first;
  const last = ds[ds.length - 1]!;
  return `${first}～${last.slice(5)}（${weekdayOf(last)}）`;
}

/** 最後一天（多天考試以最後一天為準）；沒填回 undefined */
export function lastDate(exam: Pick<ExamConfig, 'examDates'>): string | undefined {
  const ds = validDates(exam).sort();
  return ds[ds.length - 1];
}

/** 台北時間今天 'YYYY-MM-DD' */
export function todayTaipei(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export type ExamGroup = 'upcoming' | 'ended';

/**
 * 列表分群（D163、D164）：有日期＝最後一天早於今天才算「已經結束」，考試當天算「還沒開始」；沒日期放「還沒開始」，
 * 唯獨舊的已封存（archived，已不再提供封存）且沒日期的考試一次性歸「已經結束」；補填日期後改依日期歸群。
 */
export function examGroup(exam: ExamConfig, today: string): ExamGroup {
  const last = lastDate(exam);
  if (last) return last < today ? 'ended' : 'upcoming';
  return exam.archived ? 'ended' : 'upcoming';
}

/** 分群並排序：還沒開始＝日期近的在上、未填日期最下；已經結束＝最近結束的在上、未填日期最下；同日期依最後修改（新的在上） */
export function groupExams(exams: ExamConfig[], today: string, modified: (e: ExamConfig) => string): { upcoming: ExamConfig[]; ended: ExamConfig[] } {
  const up: ExamConfig[] = []; const end: ExamConfig[] = [];
  for (const e of exams) (examGroup(e, today) === 'ended' ? end : up).push(e);
  const cmp = (dir: 1 | -1) => (a: ExamConfig, b: ExamConfig): number => {
    const la = lastDate(a); const lb = lastDate(b);
    if (la && lb && la !== lb) return dir * la.localeCompare(lb);
    if (la && !lb) return -1;
    if (!la && lb) return 1;
    return modified(b).localeCompare(modified(a));
  };
  return { upcoming: up.sort(cmp(1)), ended: end.sort(cmp(-1)) };
}
