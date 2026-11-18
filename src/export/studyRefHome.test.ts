/**
 * D137（#400 WP-1）：拿掉 G36「學測原班整場不考者虛線參考座位」（addHomeStudyRef）。
 * 未參加、全科缺考者改成直接進排座引擎（有正式座位、走多數留班／少數抽離），輸出不再另貼虛線格。
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { makeFixture } from './fixtures';
import { buildLabelPages, buildSeatPages, type ExportInput } from './model';
import { buildParts } from './plan';

const sha = (x: unknown): string => createHash('sha256').update(JSON.stringify(x, (_k, v) => (v instanceof Map ? [...v] : v instanceof Set ? [...v] : v))).digest('hex');

/** 假資料：教室名稱＝班級名稱；溫班 7 號、8 號沒有考試名單、也沒有座位（舊版會在原班貼虛線格） */
function withStay(): ExportInput {
  const f = makeFixture();
  const gone = new Set(['0107', '0108']);
  const rooms = f.settings.classrooms.map((r) => (r.id === 'r1' ? { ...r, name: '溫' } : r));
  const entries = f.entries.filter((e) => !gone.has(`${String(e.classNo).padStart(2, '0')}${String(e.seatNo).padStart(2, '0')}`));
  const assignments = f.result.assignments.filter((a) => !gone.has(a.code));
  return { ...f, settings: { ...f.settings, classrooms: rooms }, entries, result: { ...f.result, assignments }, includeStudyRef: true };
}

describe('D137 原班不再另貼虛線參考座位（座位一律由排座引擎給）', () => {
  it('班級教室座位表只印排座結果裡的人：沒有虛線格、沒有「自習（參考座位）」小標', () => {
    const page = buildSeatPages(withStay(), 'class').find((p) => p.roomName === '溫')!;
    expect([...page.cells.values()].filter((c) => c.ref)).toEqual([]);
    expect(page.chips.some((t) => t.includes('參考座位') || t.includes('座位不足'))).toBe(false);
  });
  it('includeStudyRef＝true 與沒給相同；false 只少了預備教室的抽離自習參考頁', () => {
    const input = withStay();
    expect(sha(buildSeatPages(input, 'all'))).toBe(sha(buildSeatPages({ ...input, includeStudyRef: undefined } as ExportInput, 'all')));
    expect(sha(buildLabelPages(input, 'all'))).toBe(sha(buildLabelPages({ ...input, includeStudyRef: false }, 'all')));
    const on = buildParts(input, { format: 'word', seat: true, label: false, paper: 'B4', study: false, reserve: true, studyRef: true }).seat!;
    const off = buildParts(input, { format: 'word', seat: true, label: false, paper: 'B4', study: false, reserve: true, studyRef: false }).seat!;
    expect(on.length).toBeGreaterThan(off.length);
    expect(on.filter((p) => p.tag === undefined).map((p) => sha(p))).toEqual(off.filter((p) => p.tag === undefined).map((p) => sha(p)));
  });
  it('沒有考科的人有座位時：座位表照印（班級座號姓名），但不印標籤（D135⑤）', () => {
    const f = makeFixture();
    const a = f.result.assignments.find((x) => x.classroomId === 'r1')!;
    const entries = f.entries.map((e) => (`${String(e.classNo).padStart(2, '0')}${String(e.seatNo).padStart(2, '0')}` === a.code ? { ...e, subjectIds: [] } : e));
    const input = { ...f, entries };
    expect([...buildSeatPages(input, 'class').flatMap((p) => [...p.cells.values()])].some((c) => c.code === a.code && c.name !== '')).toBe(true);
    expect(buildLabelPages(input, 'class').flatMap((p) => p.cells).some((c) => c.code === a.code)).toBe(false);
    expect(buildLabelPages(f, 'class').flatMap((p) => p.cells).some((c) => c.code === a.code)).toBe(true);
  });
});
