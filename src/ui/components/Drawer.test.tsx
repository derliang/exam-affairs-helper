/** Drawer（稿 v2.81、DESIGN §10.44.3）：專案沒有 DOM 測試環境，這裡測輸出結構與樣式規範；開關與焦點行為在瀏覽器實測 */
import { readFileSync } from 'node:fs';
import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import { Drawer } from './Drawer';

const css = readFileSync('src/styles/app.css', 'utf8');

describe('Drawer 側滑面板', () => {
  const html = renderToString(<Drawer title="補考儀表板" onClose={() => {}}><p>內容</p></Drawer>);
  it('有 dialog 角色、modal、標題與內容', () => {
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="補考儀表板"');
    expect(html).toContain('內容');
  });
  it('標題列有用既有 Button 的關閉鈕，並有遮罩層', () => {
    expect(html).toContain('class="btn btn-sm"');
    expect(html).toContain('關閉');
    expect(html).toContain('class="dscrim"');
  });
  it('樣式符合規範：寬 min(420px,92vw)、<768px 底部面板、把手 44×5、減少動態、只用 token', () => {
    const block = css.slice(css.indexOf('稿 v2.81 Drawer'));
    expect(block).toContain('width:min(420px,92vw)');
    expect(block).toContain('max-width:767px');
    expect(block).toContain('max-height:85vh');
    expect(block).toContain('width:44px;height:5px');
    expect(block).toContain('prefers-reduced-motion');
    expect(block).toContain('overflow-x:hidden');
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });
});
