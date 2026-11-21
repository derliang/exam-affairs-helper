/**
 * 匯出檔的「第 N 天 M/D（週）」寫法（D147④、DESIGN §10.33）：不含年份；沒有日期就只寫「第 N 天」，不出現空括號。
 * 各天的 ISO 日期（YYYY-MM-DD，依天別順序）來自 exam.examDates（#389），沒填就不給。
 */
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

/** day 從 0 起；date 是 ISO 日期（可省略）。 */
export function dayTag(day: number, date?: string): string {
  const base = `第 ${day + 1} 天`;
  const m = date ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(date) : null;
  if (!m) return base;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return `${base} ${+m[2]!}/${+m[3]!}（${WEEK[d.getUTCDay()]}）`;
}

/** 整份的日期範圍：一天只寫當天，多天寫「第 1 天 …～第 2 天 …」；沒有天別資訊回空字串。 */
export function dayRangeText(days: Iterable<number>, dates?: readonly string[]): string {
  const ds = [...new Set(days)].sort((a, b) => a - b);
  if (ds.length === 0) return '';
  const one = (d: number) => dayTag(d, dates?.[d]);
  return ds.length === 1 ? one(ds[0]!) : `${one(ds[0]!)}～${one(ds[ds.length - 1]!)}`;
}

/** 統計表「日期」欄（D170）：11/17（二）；沒有日期或格式不對回空字串。 */
export function dateTag(date?: string): string {
  const m = date ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(date) : null;
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return `${+m[2]!}/${+m[3]!}（${WEEK[d.getUTCDay()]}）`;
}
