/** G36：學測原班教室「整場不考」的人也排參考座位（虛線格、不印標籤）；有／沒有自習都不能動到考試座位與標籤 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { makeFixture } from './fixtures';
import { buildLabelPages, buildSeatPages, type ExportInput } from './model';
import { buildParts } from './plan';

const sha = (x: unknown): string => createHash('sha256').update(JSON.stringify(x, (_k, v) => (v instanceof Map ? [...v] : v instanceof Set ? [...v] : v))).digest('hex');

/** 假資料：教室名稱＝班級名稱；溫班 10 人，7 號、8 號整場不考（沒有名單、沒有考試座位） */
function withStay(): ExportInput {
  const f = makeFixture();
  const gone = new Set(['0107', '0108']);
  const rooms = f.settings.classrooms.map((r) => (r.id === 'r1' ? { ...r, name: '溫' } : r));
  const entries = f.entries.filter((e) => !gone.has(`${String(e.classNo).padStart(2, '0')}${String(e.seatNo).padStart(2, '0')}`));
  const assignments = f.result.assignments.filter((a) => !gone.has(a.code));
  return { ...f, settings: { ...f.settings, classrooms: rooms }, entries, result: { ...f.result, assignments }, includeStudyRef: true };
}

describe('G36 學測原班自習參考座位', () => {
  it('整場不考的人排在考試座位之後的剩餘座位，格內寫班級座號姓名、虛線參考格、不佔考試座位', () => {
    const input = withStay();
    const page = buildSeatPages(input, 'class').find((p) => p.roomName === '溫')!;
    const refs = [...page.cells.values()].filter((c) => c.ref);
    expect(refs.map((c) => c.code)).toEqual(['0107', '0108']);
    for (const c of refs) { expect(c.classLabel).toBe('溫'); expect(c.name).not.toBe(''); expect(c.corners).toEqual([{ kind: 'add', text: '自習' }]); }
    const exam = input.result.assignments.filter((a) => a.classroomId === 'r1');
    for (const a of exam) expect(page.cells.get(`${a.row}-${a.depth}`)?.ref).toBeUndefined(); // 考試座位不受影響
    expect(refs.every((c) => !exam.some((a) => a.row === c.seat.row && a.depth === c.seat.depth))).toBe(true);
    expect(page.chips).toContain('自習（參考座位）2 人');
    expect(page.stats.table.rows.at(-1)).toMatchObject({ label: '自習參考座位（不印標籤）', total: 2 });
  });
  it('不印標籤：標籤頁與沒有參考座位時完全相同', () => {
    const input = withStay();
    expect(sha(buildLabelPages(input, 'all'))).toBe(sha(buildLabelPages({ ...input, includeStudyRef: false }, 'all')));
  });
  it('取消勾選（includeStudyRef=false）：原班虛線格與抽離自習參考頁都不出', () => {
    const on = buildParts(withStay(), { format: 'word', seat: true, label: false, paper: 'B4', study: false, reserve: true, studyRef: true }).seat!;
    const off = buildParts(withStay(), { format: 'word', seat: true, label: false, paper: 'B4', study: false, reserve: true, studyRef: false }).seat!;
    expect(on.some((p) => [...p.cells.values()].some((c) => c.ref))).toBe(true);
    expect(off.some((p) => [...p.cells.values()].some((c) => c.ref))).toBe(false);
    expect(on.length).toBeGreaterThan(off.length); // 少了預備教室的抽離自習參考頁
  });
  it('沒有人需要自習：輸出與舊版逐位相同（sha256）；會考不套用', () => {
    const f = makeFixture();
    expect(sha(buildSeatPages({ ...f, includeStudyRef: true }, 'class'))).toBe(sha(buildSeatPages(f, 'class')));
    const input = withStay();
    const bcct = { ...input, exam: { ...input.exam, kind: 'bcct' as const } };
    expect(sha(buildSeatPages(bcct, 'class'))).toBe(sha(buildSeatPages({ ...bcct, includeStudyRef: undefined } as ExportInput, 'class')));
  });
  it('座位不足不硬排：只排得下的人，其餘列為未排入', () => {
    const input = withStay();
    // 溫班教室只開 9 席：考試座位 18 人佔用的前 9 席以外已沒有剩餘（考試座位先排、不受影響）
    const f = withStay();
    const exam = f.result.assignments.filter((a) => a.classroomId === 'r1').length;
    const rooms = f.settings.classrooms.map((r) => (r.id === 'r1' ? { ...r, seatCount: exam + 1, disabled: ['2-3'] } : r));
    const page = buildSeatPages({ ...input, settings: { ...f.settings, classrooms: rooms } }, 'class').find((p) => p.roomName === '溫')!;
    expect([...page.cells.values()].filter((c) => c.ref).map((c) => c.code)).toEqual(['0107']);
    expect(page.chips).toContain('座位不足：缺 1 座，未排入 08 號');
  });
});
