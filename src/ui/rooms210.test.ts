// Issue #210：真實教室 7 排×8 深位、8 排×7 深位目前無法用任一標籤紙表示（待方案核可後轉綠）
import { describe, expect, it } from 'vitest';
import type { Classroom } from '../data';
import { resize, seatLimits } from './rooms';

const base: Classroom = { id: 'r', name: '甲', kind: 'class', rows: 6, depth: 7, seatCount: 42 };

describe('#210 真實教室尺寸', () => {
  for (const paper of ['B4', 'A3'] as const) {
    it(`${paper}：能編成 7 排×8 深位`, () => {
      const r = resize(base, { rows: 7, depth: 8 }, 56, seatLimits(paper));
      expect([r.rows, r.depth]).toEqual([7, 8]);
    });
    it(`${paper}：能編成 8 排×7 深位`, () => {
      const r = resize(base, { rows: 8, depth: 7 }, 56, seatLimits(paper));
      expect([r.rows, r.depth]).toEqual([8, 7]);
    });
  }
});

import { labelSplitNote, seatLimitNote } from './rooms';
describe('#210 提示文字（稿 v2.36）', () => {
  it('超過標籤紙：說明張數；B4 另提改 A3', () => {
    const r: Classroom = { ...base, rows: 8, depth: 7, seatCount: 56 };
    expect(labelSplitNote(r, 'B4')).toBe('這間教室 56 個座位超過標籤紙 B4（48 格）。輸出標籤時會自動分成 2 張貼，或改用 A3。');
    expect(labelSplitNote({ ...base, rows: 6, depth: 8, seatCount: 48 }, 'B4')).toBeNull();
    expect(labelSplitNote(r, 'A3')).toContain('自動分成 2 張貼。');
  });
  it('到上限提示', () => {
    expect(seatLimitNote({ ...base, rows: 8 })).toBe('排最多 8、深位最多 8，座位總數最多 56。');
    expect(seatLimitNote(base)).toBeNull();
  });
});
