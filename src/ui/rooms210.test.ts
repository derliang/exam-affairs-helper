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
