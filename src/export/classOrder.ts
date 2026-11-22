/**
 * 匯出檔的班級與教室順序（#503、D208）：照共用設定「班級資料」清單的順序（使用者可用 ▲▼ 自訂），與 ⑤ 預覽同一口徑。
 * 只改「顯示與頁序」，不動排座引擎、座號、座位。班級教室（名稱＝班級名稱）依班級順序排在前面；
 * 預備、綜合等非班級教室，與找不到班級的，維持原順序排在後面（與 `sortRoomsByClassOrder` 相同）。
 */
import type { ExportInput } from './model';

/** 本次考試選用的教室 id，依班級順序排好 */
export function orderedRoomIds(input: Pick<ExportInput, 'exam' | 'settings'>): string[] {
  const idx = new Map(input.settings.classes.filter((c) => c.division === input.exam.division).map((c, i) => [c.name, i] as const));
  const byId = new Map(input.settings.classrooms.map((r) => [r.id, r] as const));
  const at = (id: string): number => {
    const r = byId.get(id);
    return r && r.kind === 'class' ? idx.get(r.name) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
  };
  return input.exam.classroomIds.map((id, i) => ({ id, i })).sort((a, b) => at(a.id) - at(b.id) || a.i - b.i).map((x) => x.id);
}
