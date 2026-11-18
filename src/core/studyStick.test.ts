/**
 * 學測／會考預備教室抽離自習（WP-2、#398，D141）：
 * ①自習「盡量同一地點」：同一人跨節盡量同一間、同班盡量同處；每間收幾人不變。
 * ②自習參考座位照「座位排法」：最少深位（預設）＝人數平均分到各排；最少排數＝一排坐滿再下一排。
 * 匿名假資料。
 */
import { describe, expect, it } from 'vitest';
import type { ClassInfo, Classroom, Mark, Subject } from '../data/types';
import { allocateDetaches, periodGroups } from './detach';
import { studyReference } from './studyRef';

const cls: ClassInfo[] = [1, 2].map((no) => ({ no, name: `班${no}`, division: 'senior', track: 'science', colorIndex: no }));
const subjects: Subject[] = [{ id: 'A', name: '物理' }, { id: 'B', name: '歷史' }];
const room = (id: string, rows: number, depth: number): Classroom => ({ id, name: id, kind: 'reserve', rows, depth, seatCount: rows * depth });
const code = (c: number, n: number) => `0${c}${String(n).padStart(2, '0')}`;
const study = (subjectId: string, list: [number, number][]): Mark[] => list.map(([c, n]) => ({ code: code(c, n), subjectId, mode: 'absent' as const }));
const range = (c: number, a: number, b: number): [number, number][] => Array.from({ length: b - a + 1 }, (_, i) => [c, a + i]);

describe('WP-2 學測抽離自習「盡量同一地點」（D141）', () => {
  // A 節自習：班1 1～5、班2 1（6 人，R1 剛好坐滿）；B 節自習：班1 3～8、班2 1（7 人）
  const marks = [...study('A', [...range(1, 1, 5), [2, 1]]), ...study('B', [...range(1, 3, 8), [2, 1]])];
  const rooms = [room('R1', 2, 3), room('R2', 2, 3)];
  const r = allocateDetaches({ subjects, marks, overrides: [], reserveRooms: rooms, classes: cls });
  if (!r.ok) throw new Error(r.errors.join('；'));
  const at = (s: string, c: string) => r.detaches.find((d) => d.subjectId === s && d.code === c)?.roomId;

  it('前一節在 R1 自習的人，下一節 R1 還有空位就留在 R1（舊排法依座號切片會把班2 1 號擠到 R2）', () => {
    expect(at('A', code(2, 1))).toBe('R1');
    expect(at('B', code(2, 1))).toBe('R1');
    for (let n = 3; n <= 5; n++) expect(at('B', code(1, n))).toBe('R1');
  });
  it('每間收幾人照舊（依教室順序坐滿）；沒有前一節教室的人去同班同學最多的那間', () => {
    const inB = (id: string) => r.detaches.filter((d) => d.subjectId === 'B' && d.roomId === id).map((d) => d.code);
    expect(inB('R1')).toHaveLength(6);
    expect(inB('R2')).toEqual([code(1, 8)]);
  });
  it('第一節（沒有前一節教室）與舊排法相同：依教室順序、班級座號', () => {
    const inA = r.detaches.filter((d) => d.subjectId === 'A').map((d) => d.roomId);
    expect(inA.every((x) => x === 'R1')).toBe(true);
  });
});

describe('#398 自習參考座位照「座位排法」（D141）', () => {
  const marks = study('A', range(1, 1, 11));
  const rooms = [room('R', 7, 7)];
  const r = allocateDetaches({ subjects, marks, overrides: [], reserveRooms: rooms, classes: cls });
  if (!r.ok) throw new Error(r.errors.join('；'));
  const groups = periodGroups(subjects);
  const perRow = (layout?: 'min-depth' | 'min-rows') => {
    const ref = studyReference(groups, r.detaches, rooms, layout);
    expect(ref).toHaveLength(1);
    const m = new Map<number, number>();
    for (const s of ref[0]!.seats.values()) m.set(s.row, (m.get(s.row) ?? 0) + 1);
    return { m, seats: [...ref[0]!.seats.values()] };
  };
  it('預設（最少深位）：11 人在 7 排教室 → 7 排都有人、各排差不超過 1、深位最多 2', () => {
    const { m, seats } = perRow();
    expect(seats).toHaveLength(11);
    expect(m.size).toBe(7);
    expect(Math.max(...m.values()) - Math.min(...m.values())).toBeLessThanOrEqual(1);
    expect(Math.max(...seats.map((s) => s.depth))).toBe(2);
    expect(new Set(seats.map((s) => `${s.row}-${s.depth}`)).size).toBe(11);
  });
  it('最少排數：一排坐滿再下一排（7＋4）', () => {
    expect([...perRow('min-rows').m.entries()]).toEqual([[1, 7], [2, 4]]);
  });
  it('坐滿時兩種排法相同', () => {
    const full = study('A', range(1, 1, 6));
    const small = [room('S', 2, 3)];
    const rr = allocateDetaches({ subjects, marks: full, overrides: [], reserveRooms: small, classes: cls });
    if (!rr.ok) throw new Error(rr.errors.join('；'));
    const a = studyReference(groups, rr.detaches, small);
    const b = studyReference(groups, rr.detaches, small, 'min-rows');
    expect([...a[0]!.seats]).toEqual([...b[0]!.seats]);
  });
});
