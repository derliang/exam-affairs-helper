import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import { SeatStack, STACK_MAX_WIDTH, type StackCell } from './SeatChart';

/** D230（#667，稿 v2.111）：窄寬逐排堆疊座位圖。假資料，不含真實姓名。 */
const cells: StackCell[] = [
  { row: 1, depth: 1, kind: 'seat', code: '3001', className: '測試一班', name: '測試生甲', marks: [] },
  { row: 1, depth: 2, kind: 'seat', code: '3002', className: '測試一班', name: '測試生乙', marks: ['X 化學'], x: true, seatKind: 'sci-both' },
  { row: 2, depth: 1, kind: 'seat', code: '3103', className: '測試二班', name: '測試生丙', marks: [], dim: true, locked: true },
  { row: 2, depth: 2, kind: 'empty', note: '空位' },
];

describe('逐排堆疊座位圖（D230）', () => {
  const html = renderToString(<SeatStack title="測試教室 A" sub="假資料" rows={2} depth={2} cells={cells} />);

  it('門檻是容器 560px', () => {
    expect(STACK_MAX_WIDTH).toBe(560);
  });
  it('有「第N排」列標、深位 1～N 軸與講臺', () => {
    expect(html).toContain('第1排');
    expect(html).toContain('第2排');
    expect(html).toContain('深位→');
    expect(html).toContain('講　台');
    expect(html).toContain('style="--d:2;"');
  });
  it('格內只印 2 碼座號，姓名不印在格內、改由 aria-label 與點選卡提供', () => {
    expect(html).toMatch(/<button[^>]*class="sq-c"[^>]*>01<\/button>/);
    expect(html).not.toMatch(/>測試生甲</);
    expect(html).toContain('第1排深位1，測試一班 座號 01 測試生甲');
    expect(html).toContain('點一格看詳細資料');
  });
  it('X 標示、底色分類、淡化與鎖定都帶到格上；空位不是按鈕', () => {
    expect(html).toMatch(/class="sq-c x"[^>]*data-k="sci-both"/);
    expect(html).toContain('sq-c dim lk');
    expect(html).toContain('class="sq-c empty"');
    expect((html.match(/<button/g) ?? []).length).toBe(3);
  });
});
