/**
 * D138（使用者 2026-11-18「三種考試都加」每排深位 − ＋）：加了每排步進器之後，沒動座位時排座結果與座位表、標籤輸出完全不變。
 * ①畫出教室清單（含每排步進器）不會改資料；②排座結果、座位表、標籤的 sha256 與加步進器之前（origin/main 5f9c0fe）算出的值相同；
 * ③每排 +1 再 −1 回到原樣：教室資料相等、輸出 sha256 相同。
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { renderToString as render } from 'preact-render-to-string';
import { classroomSeats } from '../data';
import { runSeating } from '../core/run';
import { makeFixture } from '../export/fixtures';
import { buildLabelPages, buildSeatPages, type ExportInput } from '../export/model';
import { RoomList } from './components/RoomList';
import { setAllDepth, setRowCount, stepRowDepth } from './ast/roomEdit';
import { roomLimitsOf } from './rooms';

const sha = (x: unknown): string => createHash('sha256').update(JSON.stringify(x, (_k, v) => (v instanceof Map ? [...v] : v instanceof Set ? [...v] : v))).digest('hex');

function seat(f: ExportInput) {
  const r = runSeating({
    examId: f.exam.id, division: f.exam.division, classes: f.settings.classes, classrooms: f.settings.classrooms.filter((c) => c.kind === 'class').map((c, i) => ({ ...c, ...(i === 0 ? { seatCount: Math.max(c.seatCount, 20), track: 'science' as const } : { track: 'liberal' as const }) })),
    entries: f.entries, subjects: f.exam.subjects, markRules: f.exam.markRules, overrides: [], now: '2026-11-18T00:00:00Z',
  });
  if (!r.ok) throw new Error('排座失敗');
  return r.result;
}
const out = (f: ExportInput) => ({ seat: sha(buildSeatPages(f, 'all')), label: sha(buildLabelPages(f, 'all')) });

/** 在加每排步進器之前的程式（origin/main 5f9c0fe，core、export、data 本 PR 未改）算出的值 */
const GOLDEN = {
  seating: 'f4be9b39512598f246f97ec8f554c2a78b6dd4683d62da2fb8a7ed63cd97a9e8',
  seat: '9ce145f8228986159340c282c7565d16ffa06683923460b144deb29e2ecc0837',
  label: 'c6b983df0389bae8f46762b3a14d7861d78ebac4208b6ffae18fea366d165407',
};

describe('D138 每排深位步進器：沒動座位時輸出不變', () => {
  it('畫出教室清單（含每排步進器、展開前後）不會改到教室資料', () => {
    const f = makeFixture();
    const before = sha(f.settings.classrooms);
    let changed = false;
    render(<RoomList rooms={f.settings.classrooms} paper="B4" track="none" onChange={() => { changed = true; }} selected={f.exam.classroomIds} onSelect={() => { changed = true; }} />);
    expect(changed).toBe(false);
    expect(sha(f.settings.classrooms)).toBe(before);
  });
  it('排座結果、座位表、標籤的 sha256 與加步進器之前相同', () => {
    const f = makeFixture();
    const res = seat(f);
    expect(sha({ a: res.assignments, m: res.marks, d: res.detaches })).toBe(GOLDEN.seating);
    expect(out(f)).toEqual({ seat: GOLDEN.seat, label: GOLDEN.label });
  });
  it('每一排 +1 再 −1、整間橫排 +1 再 −1、整間深位 +1 再 −1：座位一樣、排座與輸出 sha256 不變', () => {
    const f = makeFixture();
    // 座位全開（沒有不排的座位）與有不排座位（disabled）兩種教室都驗
    const full = { ...f.settings.classrooms[0]!, seatCount: 20 };
    const holes = { ...f.settings.classrooms[1]!, seatCount: 18, disabled: ['2-3', '4-5'] };
    for (const room of [full, holes]) {
      const lim = { ...roomLimitsOf(room.kind), rows: roomLimitsOf(room.kind).rows };
      const trips = [
        ...Array.from({ length: room.rows }, (_, i) => stepRowDepth(stepRowDepth(room, i + 1, 1, lim), i + 1, -1, lim)),
        setRowCount(setRowCount({ ...room, rowDepths: [room.depth, ...Array(room.rows - 1).fill(room.depth)] }, room.rows + 1, lim), room.rows, lim),
        setAllDepth(setAllDepth(room, room.depth + 1, lim), room.depth, lim),
      ];
      for (const back of trips) {
        expect(classroomSeats(back)).toEqual(classroomSeats(room));
        expect(back.seatCount).toBe(room.seatCount);
        expect(back.rowDepths).toBeUndefined();
      }
      const base = { ...f, settings: { ...f.settings, classrooms: f.settings.classrooms.map((c) => (c.id === room.id ? room : c)) } };
      const tripped = { ...f, settings: { ...f.settings, classrooms: f.settings.classrooms.map((c) => (c.id === room.id ? trips[0]! : c)) } };
      const a = seat(base); const b = seat(tripped);
      expect(sha({ a: b.assignments, m: b.marks, d: b.detaches })).toBe(sha({ a: a.assignments, m: a.marks, d: a.detaches }));
      expect(out(tripped)).toEqual(out(base));
    }
  });
});
