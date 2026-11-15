/** #264 列表依各考試自己的學年度算人數與進度，不受「作用中學年度（最後開啟的學年）」影響。全部假資料。 */
import { describe, expect, it } from 'vitest';
import { examHeadcount, examProgress } from './examList';
import { demoDoc } from './repository';
import { rosterChanged } from './rosterIO';
import { migrateRosterYear, rosterYearOf, switchRosterYear } from './rosterYears';
import { isStale } from './seating';
import { newExam, type Doc } from './store';

const today = new Date(2026, 10, 15);
/** 114 分科、115 會考（國三、全員參加，不用匯入名單）；工作資料＝115，國三名單 2 人 */
function docWith(): Doc {
  const a = newExam({ ...demoDoc(), exams: [] }, 'ast', '分科舊', today, { year: 114 });
  if (!a.ok) throw new Error(a.error);
  const b = newExam(a.doc, 'bcct', '會考新', new Date(today.getTime() + 1000), { year: 115 });
  if (!b.ok) throw new Error(b.error);
  return migrateRosterYear(b.doc);
}
/** 開啟 114 分科：工作資料換成 114（115 的名單收進 otherYears），並依規則 114 沒有國三名單 */
function asOpened114(d: Doc): Doc {
  const r = switchRosterYear(d, 114);
  if (!r.ok) throw new Error(r.error);
  return { ...r.doc, rosters: { ...r.doc.rosters, junior: [] } };
}

describe('#264 列表年度外洩', () => {
  it('作用中是 114 時，115 學年會考的人數與進度，和作用中是 115 時一樣', () => {
    const d115 = docWith();
    expect(rosterYearOf(d115)).toBe(115);
    const e115 = d115.exams.find((e) => e.name === '會考新')!;
    expect(examHeadcount(d115, e115)).toBeGreaterThan(0);
    // 把 115 的國三名單真的放進 otherYears（開 114 時 115 收進去）
    const d114 = switchRosterYear(d115, 114);
    if (!d114.ok) throw new Error(d114.error);
    const e114 = d114.doc.exams.find((e) => e.name === '會考新')!;
    expect(examHeadcount(d114.doc, e114)).toBe(examHeadcount(d115, e115));
    expect(examProgress(d114.doc, e114)).toEqual(examProgress(d115, e115));
    expect(rosterChanged(d114.doc, e114)).toBe(rosterChanged(d115, e115));
    expect(isStale(d114.doc, e114)).toBe(isStale(d115, e115));
  });
  it('作用中 114 且 114 沒有國三名單：115 會考仍不顯示「尚未匯入名單」（人數 > 0）', () => {
    const d = asOpened114(docWith());
    // asOpened114 把工作資料的國三清空；115 的名單在 otherYears
    const e = d.exams.find((x) => x.name === '會考新')!;
    expect(d.otherYears?.['115']?.rosters.junior.length).toBeGreaterThan(0);
    expect(examHeadcount(d, e)).toBe(d.otherYears!['115']!.rosters.junior.length);
  });
});
