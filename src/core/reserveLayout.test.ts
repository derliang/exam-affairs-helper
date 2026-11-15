/** #258 學測／會考預備教室抽離座位：最少深位（預設）／最少排數。匿名假資料。 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ClassInfo, Classroom, Mark, Subject } from '../data/types';
import { allocateDetaches, type ReserveMode } from './detach';

const cls: ClassInfo[] = [1, 2, 3].map((no) => ({ no, name: `班${no}`, division: 'senior', track: 'science', colorIndex: no }));
const subjects: Subject[] = [{ id: 'A', name: '物理' }, { id: 'B', name: '歷史' }];
const room = (id: string, depth: number, rows: number): Classroom => ({ id, name: id, kind: 'reserve', rows, depth, seatCount: rows * depth });
const ex = (subjectId: string, n: number, c = 1): Mark[] => Array.from({ length: n }, (_, i) => ({ code: `0${c}${String(i + 1).padStart(2, '0')}`, subjectId, mode: 'extra' as const }));
const run = (marks: Mark[], rooms: Classroom[], mode: ReserveMode, layout?: 'min-depth' | 'min-rows') =>
  allocateDetaches({ subjects, marks, overrides: [], reserveRooms: rooms, classes: cls, mode, ...(layout ? { reserveLayout: layout } : {}) });
const seats = (r: ReturnType<typeof allocateDetaches>) => {
  if (!r.ok) throw new Error(r.errors.join('；'));
  return r.detaches.filter((d) => d.purpose === 'exam').map((d) => d.seat!);
};
const perRow = (xs: { row: number }[]) => {
  const m = new Map<number, number>();
  for (const x of xs) m.set(x.row, (m.get(x.row) ?? 0) + 1);
  return m;
};
const hash = (o: object) => createHash('sha256').update(JSON.stringify(o)).digest('hex');

describe.each(['peer', 'proctor'] as const)('預備教室座位排法（#258）：%s 模式', (mode) => {
  it('預設最少深位：17 人在 7×7 教室 → 7 排、各排 2～3 人、深位最多 3', () => {
    const s = seats(run(ex('A', 17), [room('R', 7, 7)], mode));
    expect(s).toHaveLength(17);
    const c = [...perRow(s).values()];
    expect(perRow(s).size).toBe(7);
    expect(Math.max(...c) - Math.min(...c)).toBeLessThanOrEqual(1);
    expect(Math.max(...s.map((x) => x.depth))).toBe(3);
    expect(new Set(s.map((x) => `${x.row}-${x.depth}`)).size).toBe(17);
  });
  it('最少排數：舊排法 7＋7＋3，共 3 排；與預設不同', () => {
    const s = seats(run(ex('A', 17), [room('R', 7, 7)], mode, 'min-rows'));
    expect([...perRow(s).entries()]).toEqual([[1, 7], [2, 7], [3, 3]]);
  });
  it('預設與明說 min-depth 相同', () => {
    expect(hash(run(ex('A', 17), [room('R', 7, 7)], mode))).toBe(hash(run(ex('A', 17), [room('R', 7, 7)], mode, 'min-depth')));
  });
  it('不相關情境（坐滿、單排、沒人抽離）輸出與舊排法逐位一致', () => {
    for (const [marks, rooms] of [[ex('A', 49), [room('R', 7, 7)]], [ex('A', 5), [room('R', 7, 1)]], [[] as Mark[], [room('R', 7, 7)]]] as const) {
      expect(hash(run([...marks], [...rooms], mode))).toBe(hash(run([...marks], [...rooms], mode, 'min-rows')));
    }
  });
});
