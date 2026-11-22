/**
 * #635 ②：從考試 ③ 去共用設定「新增預備教室」，回來後新增的教室預設「列入」本次考試。
 * 離開前記下當時的教室清單（只在記憶體，換頁不會清掉、重新整理就消失），回到 ③ 時把新出現的預備教室列入。
 */
const snap = new Map<string, string[]>();

export const markRoomsBefore = (examId: string, roomIds: string[]): void => { snap.set(examId, roomIds); };

/** 取出這次考試離開前的快照並清掉；沒有快照＝undefined */
export function takeRoomsBefore(examId: string): string[] | undefined {
  const s = snap.get(examId);
  snap.delete(examId);
  return s;
}

/** 快照之後新增的預備教室 id */
export const addedReserveIds = (before: string[], rooms: { id: string; kind: string }[]): string[] => {
  const had = new Set(before);
  return rooms.filter((r) => !had.has(r.id) && r.kind === 'reserve').map((r) => r.id);
};
