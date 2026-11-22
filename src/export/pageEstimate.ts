/**
 * 預估實際會印幾頁（#269、#632）。只用在下載前的預告，寧可多估不要少估。
 * 一個 TablePageModel 不等於一頁：直式長表會接到下一頁，所以不能用「模型個數」當頁數（補考預告 97 頁、實際 212 頁）。
 */
import type { TablePageModel } from './model';

/**
 * A4 直式表格每頁放幾列（列高 9mm 起跳，扣邊界、標題與表頭；表頭每頁重複）。
 * 2026-11-18 用 Word 與 Chrome 列印實測（#269）：第一頁有標題與說明約 21～22 列，之後每頁約 23～24 列
 * （以前一律算 26 列，輪流清單 338 列估 14 頁、實際 15 頁）。取保守值，寧可多估不要少估。
 */
export const TABLE_FIRST_PAGE_ROWS = 21;
export const TABLE_ROWS_PER_PAGE = 23;
/** 橫式表單頁最多容納的列數（列高最小 2.8mm；見 model.landscapeFit） */
const LANDSCAPE_MAX_ROWS = 58;

/** 直式長表 n 列會印幾頁 */
export const tablePages = (n: number): number => (n <= TABLE_FIRST_PAGE_ROWS ? 1 : 1 + Math.ceil((n - TABLE_FIRST_PAGE_ROWS) / TABLE_ROWS_PER_PAGE));

/** 一個表格模型實際印幾頁：橫式（班級公告）一班一頁、超過列數上限才換頁；直式依列數估頁 */
export function tableModelPages(t: Pick<TablePageModel, 'landscape' | 'rows' | 'heads' | 'headGroups' | 'totalRow'>): number {
  const rows = t.rows.length + (t.totalRow ? 1 : 0);
  if (t.landscape) {
    const cap = Math.max(1, LANDSCAPE_MAX_ROWS - 1 - (t.headGroups ? 1 : 0));
    return Math.max(1, Math.ceil(rows / cap));
  }
  return tablePages(rows);
}
