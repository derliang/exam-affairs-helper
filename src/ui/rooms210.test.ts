// G14／D113：教室上限改成 7×7（取代 #210 的 8×8）；超過 7×7 的舊教室不自動縮，提示並停用標籤輸出
import { describe, expect, it } from 'vitest';
import type { Classroom } from '../data';
import { labelSplitNote, resize, roomsOverLabel, seatLimitNote, seatLimits } from './rooms';

const base: Classroom = { id: 'r', name: '甲', kind: 'class', rows: 5, depth: 6, seatCount: 30 };

describe('G14 教室座位上限 7×7', () => {
  for (const paper of ['B4', 'A3'] as const) {
    it(`${paper}：能編成 7 排×7 深位，編不出 8 排或 8 深位`, () => {
      const r = resize(base, { rows: 7, depth: 7 }, 49, seatLimits(paper));
      expect([r.rows, r.depth]).toEqual([7, 7]);
      expect(resize(base, { rows: 8 }, 49, seatLimits(paper))).toBe(base);
      expect(resize(base, { depth: 8 }, 49, seatLimits(paper))).toBe(base);
    });
  }
  it('舊資料 8 排的教室：允許改小，不會被自動縮', () => {
    const old: Classroom = { ...base, rows: 8, depth: 7, seatCount: 56 };
    expect(resize(old, { rows: 7 }, 49, seatLimits('B4')).rows).toBe(7);
    expect(roomsOverLabel([old, base])).toEqual([old]);
  });
});

describe('G14 提示文字', () => {
  it('超過 7×7：提示「標籤無法對應，請縮小」；沒超過沒有提示', () => {
    const r: Classroom = { ...base, rows: 8, depth: 7, seatCount: 56 };
    expect(labelSplitNote(r)).toContain('超過 7×7，標籤無法對應，請縮小');
    expect(labelSplitNote({ ...base, rows: 7, depth: 7, seatCount: 49 })).toBeNull();
  });
  it('到上限提示', () => {
    expect(seatLimitNote({ ...base, rows: 7 })).toBe('排最多 7、深位最多 7（標籤上限 7×7）。');
    expect(seatLimitNote(base)).toBeNull();
  });
});
