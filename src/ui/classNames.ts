import type { ClassInfo, Division } from '../data';

/**
 * 匯入解析、對帳與列修正用的「班名表」：**索引 = 班級編號 − 1**（`parseClassNo`、`classLabel` 等都這樣換算）。
 * 不能直接用「班級資料清單」的順序：清單順序是使用者用 ▲▼ 自訂的顯示順序（#503／D208），
 * 一改順序，班名就會對到別班（#612）。這裡一律依 `no` 排，缺的編號補空字串。
 */
export function classNamesByNo(classes: readonly ClassInfo[], division: Division): string[] {
  const mine = classes.filter((c) => c.division === division);
  const out: string[] = [];
  for (const c of mine) out[c.no - 1] = c.name;
  return Array.from(out, (n) => n ?? '');
}
