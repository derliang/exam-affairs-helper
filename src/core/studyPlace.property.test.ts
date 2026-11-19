/**
 * G32 ②（D141、D144）：學測抽離自習「各節盡量同一地點」的性質測試（隨機匿名假資料）。
 * 對照組＝舊排法（每組節次各自依教室順序、班級座號切片填進預備教室）。新排法必須：
 * ①每組節次各間收的人數與舊排法相同（容量、對帳、教室用途不受影響）；
 * ②同一人跨節換自習教室的人次不多於舊排法，且確實有案例變少；
 * ③只有一組節次有自習時，與舊排法逐位相同。
 */
import { describe, expect, it } from 'vitest';
import type { ClassInfo, Classroom, Mark, Subject } from '../data/types';
import { allocateDetaches } from './detach';

const cls: ClassInfo[] = [1, 2, 3, 4].map((no) => ({ no, name: `班${no}`, division: 'senior', track: 'science', colorIndex: no }));
const subjects: Subject[] = ['A', 'B', 'C', 'D'].map((id) => ({ id, name: `科${id}` }));
const room = (id: string, rows: number, depth: number): Classroom => ({ id, name: id, kind: 'reserve', rows, depth, seatCount: rows * depth });
const code = (c: number, n: number) => `0${c}${String(n).padStart(2, '0')}`;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** 一個隨機案例：4 班各 8 人、4 科各自一節，每人每科 30% 機率不考（抽離自習）；3 間預備教室 */
function scenario(seed: number) {
  const r = rng(seed);
  const rooms = [room('R1', 2 + Math.floor(r() * 3), 3), room('R2', 2 + Math.floor(r() * 3), 3), room('R3', 3, 3)];
  const marks: Mark[] = [];
  for (const k of cls) for (let n = 1; n <= 8; n++) for (const s of subjects) if (r() < 0.3) marks.push({ code: code(k.no, n), subjectId: s.id, mode: 'absent' });
  return { rooms, marks };
}

type Plan = Map<string, string>; // `${subjectId}|${code}` → roomId

function run(rooms: Classroom[], marks: Mark[]) {
  const res = allocateDetaches({ subjects, marks, overrides: [], reserveRooms: rooms, classes: cls });
  if (!res.ok) return null;
  const now: Plan = new Map(res.detaches.filter((d) => d.purpose === 'study').map((d) => [`${d.subjectId}|${d.code}`, d.roomId]));
  // 舊排法：同一組教室、依教室順序與班級座號切片
  const old: Plan = new Map();
  for (const s of subjects) {
    const codes = [...now.keys()].filter((k) => k.startsWith(`${s.id}|`)).map((k) => k.slice(2)).sort();
    const used = rooms.filter((x) => codes.some((c) => now.get(`${s.id}|${c}`) === x.id));
    let i = 0;
    for (const x of used) for (const c of codes.slice(i, (i += x.seatCount))) old.set(`${s.id}|${c}`, x.id);
  }
  return { now, old };
}
const perRoom = (m: Plan) => {
  const c = new Map<string, number>();
  for (const [k, v] of m) c.set(`${k.split('|')[0]}|${v}`, (c.get(`${k.split('|')[0]}|${v}`) ?? 0) + 1);
  return [...c].sort();
};
const moves = (m: Plan) => {
  const rooms = new Map<string, Set<string>>();
  for (const [k, v] of m) { const c = k.split('|')[1]!; rooms.set(c, (rooms.get(c) ?? new Set()).add(v)); }
  let n = 0;
  for (const s of rooms.values()) n += s.size - 1;
  return n;
};

describe('G32 ② 學測抽離自習「盡量同一地點」（D141、D144，性質測試）', () => {
  it('隨機 300 案例：各間人數與舊排法相同；換教室人次不多於舊排法，整體明顯減少', () => {
    let better = 0; let sumNew = 0; let sumOld = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const { rooms, marks } = scenario(seed);
      const r = run(rooms, marks);
      if (!r) continue;
      expect(perRoom(r.now), `seed=${seed}`).toEqual(perRoom(r.old));
      expect(moves(r.now), `seed=${seed}`).toBeLessThanOrEqual(moves(r.old));
      if (moves(r.now) < moves(r.old)) better++;
      sumNew += moves(r.now); sumOld += moves(r.old);
    }
    expect(better).toBeGreaterThan(100);
    expect(sumNew * 2).toBeLessThan(sumOld); // 換教室人次至少減半（實測約 38%）
  });

  it('只有一組節次有自習：與舊排法逐位相同', () => {
    const rooms = [room('R1', 2, 3), room('R2', 3, 3)];
    const marks: Mark[] = [];
    for (const k of cls) for (let n = 1; n <= 3; n++) marks.push({ code: code(k.no, n), subjectId: 'B', mode: 'absent' });
    const r = run(rooms, marks)!;
    expect([...r.now].sort()).toEqual([...r.old].sort());
  });
});
