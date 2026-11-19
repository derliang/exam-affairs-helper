// D149②／D154：教室上限改成橫排、深位各 ≤ 8 且總座位 ≤ 56（取代 G14／D113 的 7×7）；超過的舊教室不自動縮，提示並停用標籤輸出
import { describe, expect, it } from 'vitest';
import type { Classroom } from '../data';
import { labelSplitNote, resize, roomsOverLabel, seatLimitNote, seatLimits, stepMax } from './rooms';

const base: Classroom = { id: 'r', name: '甲', kind: 'class', rows: 5, depth: 6, seatCount: 30 };

describe('D154 教室座位上限 8 且 ≤ 56', () => {
  for (const paper of ['B4', 'A3'] as const) {
    it(`${paper}：能編成 7×8、8×7，編不出 9 排、9 深位，也編不出 8×8（64 座）`, () => {
      const a = resize(base, { rows: 7, depth: 8 }, 56, seatLimits(paper));
      expect([a.rows, a.depth, a.seatCount]).toEqual([7, 8, 56]);
      const b = resize(base, { rows: 8, depth: 7 }, 56, seatLimits(paper));
      expect([b.rows, b.depth, b.seatCount]).toEqual([8, 7, 56]);
      expect(resize(base, { rows: 9 }, 56, seatLimits(paper))).toBe(base);
      expect(resize(base, { depth: 9 }, 56, seatLimits(paper))).toBe(base);
      expect(resize(a, { rows: 8 }, 56, seatLimits(paper))).toBe(a); // 7×8 再加一排＝64，被總數擋下
    });
  }
  it('stepMax：另一邊已大時，這邊最多加到總座位 56；到單邊上限 8 為止', () => {
    expect(stepMax({ rows: 5, depth: 6 }, 'rows')).toBe(8);
    expect(stepMax({ rows: 7, depth: 8 }, 'rows')).toBe(7);
    expect(stepMax({ rows: 7, depth: 8 }, 'depth')).toBe(8);
    expect(stepMax({ rows: 8, depth: 7 }, 'depth')).toBe(7);
    expect(stepMax({ rows: 8, depth: 6 }, 'depth')).toBe(7);
    expect(stepMax({ rows: 9, depth: 7 }, 'rows')).toBe(9); // 舊資料本來就超過：不再加大
  });
  it('舊資料 9 排的教室：允許改小，不會被自動縮；標籤停用', () => {
    const old: Classroom = { ...base, rows: 9, depth: 6, seatCount: 54 };
    expect(resize(old, { rows: 8 }, 56, seatLimits('B4')).rows).toBe(8);
    expect(roomsOverLabel([old, base])).toEqual([old]);
  });
});

describe('D154 提示文字', () => {
  it('超過 8：提示「標籤無法對應，請縮小」；超過總座位 56 提示縮小；沒超過沒有提示', () => {
    const r: Classroom = { ...base, rows: 9, depth: 6, seatCount: 54 };
    expect(labelSplitNote(r)).toContain('超過 8×8，標籤無法對應，請縮小');
    expect(labelSplitNote({ ...base, rows: 8, depth: 8, seatCount: 64 })).toContain('超過總座位上限 56');
    expect(labelSplitNote({ ...base, rows: 8, depth: 7, seatCount: 56 })).toBeNull();
    expect(labelSplitNote({ ...base, kind: 'reserve', rows: 7, depth: 8, seatCount: 56 })).toBeNull();
  });
  it('到上限提示', () => {
    expect(seatLimitNote({ ...base, rows: 8 })).toBe('橫排最多 8、深位最多 8，總座位最多 56（8×7、7×8 可以，8×8 不行）。');
    expect(seatLimitNote(base)).toBeNull();
  });
});
