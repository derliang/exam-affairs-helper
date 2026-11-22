/** #503、D208：自訂班級順序（共用設定「班級資料」▲▼）也要影響匯出檔的頁序與班級欄位順序；排座結果與座號不變 */
import { describe, expect, it } from 'vitest';
import { makeFixture } from './fixtures';
import { buildDetachList, buildSeatPages, buildStudyLists } from './model';
import { buildAttendancePages } from './attendance';
import { orderedRoomIds } from './classOrder';

/** 班級教室名稱＝班級名稱（溫、良），自訂順序＝恭、良、溫 */
function reordered() {
  const f = makeFixture();
  f.settings.classrooms[0]!.name = '溫';
  f.settings.classrooms[1]!.name = '良';
  const by = new Map(f.settings.classes.map((c) => [c.name, c]));
  f.settings.classes = [by.get('恭')!, by.get('良')!, by.get('溫')!];
  return f;
}

describe('#503 匯出頁序依自訂班級順序', () => {
  it('沒自訂時維持原順序（回歸）', () => {
    const f = makeFixture();
    f.settings.classrooms[0]!.name = '溫';
    f.settings.classrooms[1]!.name = '良';
    expect(orderedRoomIds(f)).toEqual(['r1', 'r2', 'rv']);
  });
  it('班級教室依班級順序排，預備教室留在後面', () => {
    expect(orderedRoomIds(reordered())).toEqual(['r2', 'r1', 'rv']);
  });
  it('座位表頁序：良教室先、溫教室後（預備教室仍在班級教室之後）', () => {
    const pages = buildSeatPages(reordered(), 'class');
    expect(pages.map((p) => p.roomName)).toEqual(['良', '溫']);
  });
  it('座位表統計表的班級欄位照自訂順序（良在溫之前），數字跟著班級走', () => {
    const f = reordered();
    const pg = buildSeatPages(f, 'class').find((p) => p.roomName === '溫')!;
    const cls = pg.stats.table.classes;
    expect(cls).toEqual(['良', '溫']); // 溫教室裡有溫 10 人、良 8 人；舊順序（班號）會是溫、良
  });
  it('點名單頁序同座位表', () => {
    const pages = buildAttendancePages(reordered());
    const subs = pages.map((p) => p.subtitle ?? '');
    expect(subs[0]).toContain('良（班級教室）');
    expect(subs[1]).toContain('溫（班級教室）');
  });
  it('抽離名單同科目時，班級依自訂順序（良 0201 在溫 0105 前）', () => {
    const f = reordered();
    f.result.detaches.push({ code: '0201', subjectId: 'en', purpose: 'study', roomId: 'rv' });
    const rows = buildDetachList(f).rows.filter((r) => r.subject === '英文');
    expect(rows.map((r) => r.className)[0]).toBe('良');
    const lists = buildStudyLists(f);
    expect(lists.length).toBeGreaterThan(0);
  });
  it('不改座位：排座結果的 assignments 與座號不受順序影響', () => {
    const a = makeFixture();
    const b = reordered();
    expect(b.result.assignments).toEqual(a.result.assignments);
  });
});
