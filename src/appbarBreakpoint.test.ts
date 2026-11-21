import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// #585／D203：頁首導覽列約需 661px，收進「選單」的斷點必須 ≥ 700，否則 601～660px 會橫向捲動
describe('品牌列收合斷點（D203）', () => {
  it('app.css 的 .appbar 收合 @media 上限為 720px，不得退回 600', () => {
    const css = readFileSync('src/styles/app.css', 'utf8');
    const m = css.match(/@media \(max-width:(\d+)px\)\{\.appbar\{min-height:52px\}/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(700);
  });
});
