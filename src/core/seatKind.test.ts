import { describe, expect, it } from 'vitest';
import { astSeatKindOf, legendKindsOf, RESERVE_EXAM, RESERVE_STUDY, SEAT_KIND_ORDER, SEAT_KINDS, seatKindOf, type SeatKind } from './seatKind';

/** 灰階亮度（Rec.601），黑白列印時的深淺 */
const gray = (hex: string): number => {
  const n = parseInt(hex, 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
};

describe('座位表底色分類（2026-11-23）', () => {
  it('理組：沒加考數B／社會＝一般；各加＝兩種；兩科都加＝第三種', () => {
    expect(seatKindOf('science', [])).toBe('general');
    expect(seatKindOf('science', ['math-a', 'science'])).toBe('general'); // 這兩科理組本來就考，不算加考
    expect(seatKindOf('science', ['math-b'])).toBe('sci-b');
    expect(seatKindOf('science', ['social'])).toBe('sci-soc');
    expect(seatKindOf('science', ['social', 'math-b'])).toBe('sci-both');
  });
  it('文組：沒加考數A／自然＝一般；各加＝兩種；兩科都加＝第三種', () => {
    expect(seatKindOf('liberal', [])).toBe('general');
    expect(seatKindOf('liberal', ['math-b', 'social'])).toBe('general');
    expect(seatKindOf('liberal', ['math-a'])).toBe('lib-a');
    expect(seatKindOf('liberal', ['science'])).toBe('lib-sci');
    expect(seatKindOf('liberal', ['science', 'math-a'])).toBe('lib-both');
  });
  it('沒有文理組（分科、會考、國中）一律不上色', () => {
    expect(seatKindOf(undefined, ['math-b', 'social'])).toBe('general');
  });
  it('一般考生是純白底', () => {
    expect(SEAT_KINDS.general.bg).toBe('FFFFFF');
  });
  it('圖例只列出現過的加考底色，依固定順序；沒有就空', () => {
    expect(legendKindsOf(['general', 'general'])).toEqual([]);
    expect(legendKindsOf(['lib-both', 'sci-b', 'sci-b'] as SeatKind[])).toEqual(['sci-b', 'lib-both']);
  });
  it('黑白列印分得出：同一組的三種底色與白底，灰階亮度兩兩相差 ≥ 20', () => {
    for (const set of [['general', 'sci-b', 'sci-soc', 'sci-both'], ['general', 'lib-a', 'lib-sci', 'lib-both']] as SeatKind[][]) {
      const g = set.map((k) => gray(SEAT_KINDS[k].bg));
      for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) expect(Math.abs(g[i]! - g[j]!)).toBeGreaterThanOrEqual(20);
    }
  });
  it('六種底色彼此不同，且都有圖例文字', () => {
    const bgs = SEAT_KIND_ORDER.map((k) => SEAT_KINDS[k].bg);
    expect(new Set(bgs).size).toBe(bgs.length);
    for (const k of SEAT_KIND_ORDER) expect(SEAT_KINDS[k].label.length).toBeGreaterThan(0);
  });
});

describe('分科底色與預備教室用途色（使用者 2026-11-23）', () => {
  it('理組：加考數乙／社會科（歷地公任一）／兩者；預設科目不算加考', () => {
    const base = ['math-jia', 'physics', 'chemistry', 'biology'];
    expect(astSeatKindOf('science', base)).toBe('general');
    expect(astSeatKindOf('science', [...base, 'math-yi'])).toBe('sci-b');
    expect(astSeatKindOf('science', [...base, 'geography'])).toBe('sci-soc');
    expect(astSeatKindOf('science', [...base, 'history', 'civics'])).toBe('sci-soc');
    expect(astSeatKindOf('science', [...base, 'math-yi', 'civics'])).toBe('sci-both');
  });
  it('文組：加考自然科（物化生任一）才有底色；沒有文理組不上色', () => {
    const base = ['math-yi', 'history', 'geography', 'civics'];
    expect(astSeatKindOf('liberal', base)).toBe('general');
    expect(astSeatKindOf('liberal', [...base, 'chemistry'])).toBe('lib-sci');
    expect(astSeatKindOf(undefined, [...base, 'chemistry'])).toBe('general');
  });
  it('預備教室考試淡藍與自習淺灰灰階亮度差 ≥ 15，黑白列印另有虛線框與文字', () => {
    expect(Math.abs(gray(RESERVE_EXAM.bg) - gray(RESERVE_STUDY.bg))).toBeGreaterThanOrEqual(15);
  });
});
