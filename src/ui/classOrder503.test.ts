/** #503：班級順序＝班級資料清單順序，可自訂（moveClass）；教室頁籤、班級統計欄照這個順序。用 reconcileFixtures 的假資料 */
import { describe, expect, it } from 'vitest';
import { gsatDoc } from './reconcileFixtures';
import { addClass, moveClass } from './store';
import { classOrderOf, examRooms, sortRoomsByClassOrder } from './seating';

describe('#503 班級順序', () => {
  it('moveClass 往後移一格，頭尾不動', () => {
    const { doc } = gsatDoc();
    const names = (d: typeof doc) => d.settings.classes.map((c) => c.name);
    expect(names(doc)).toEqual(['溫', '良', '恭']);
    expect(names({ ...doc, settings: { ...doc.settings, classes: moveClass(doc, 'senior', 1, 1).settings.classes } })).toEqual(['良', '溫', '恭']);
    expect(moveClass(doc, 'senior', 1, -1)).toBe(doc);
    expect(moveClass(doc, 'senior', 3, 1)).toBe(doc);
  });
  it('新增班級接在同部別最後，不重排使用者的順序', () => {
    const { doc } = gsatDoc();
    const moved = moveClass(doc, 'senior', 3, -1); // 溫、恭、良
    const r = addClass(moved, 'senior', { name: '儉' });
    expect(r.ok && r.doc.settings.classes.map((c) => c.name)).toEqual(['溫', '恭', '良', '儉']);
  });
  it('班級教室與班級序號照清單順序排，預備教室排後面', () => {
    const { doc, exam } = gsatDoc();
    const moved = moveClass(doc, 'senior', 1, 1); // 良、溫、恭
    const rooms = sortRoomsByClassOrder(moved, exam, [...examRooms(moved, exam)].reverse());
    expect(rooms.map((r) => r.name)).toEqual(['良', '溫', '恭', '預備二', '預備一']);
    const ord = classOrderOf(moved, exam);
    expect([1, 2, 3].sort((a, b) => ord(a) - ord(b))).toEqual([2, 1, 3]);
  });
});
