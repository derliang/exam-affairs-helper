/** #602、D208：補考重複匯入的「取代／合併」不預選；取代會移除已排考程時，選項上就先講幾筆 */
import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { DupModal } from './pages/MkStep2';

const diff = (removedScheduled: number) => ({ hasCurrent: true, same: 40, added: 2, updated: 1, removed: 3, removedScheduled });
const modal = (removedScheduled: number) =>
  renderToString(<DupModal d={{ parse: { rawCount: 43 } as never, fileName: 'a.xlsx', diff: diff(removedScheduled) as never }} onApply={() => {}} onClose={() => {}} />);

describe('#602 重複匯入卡', () => {
  it('一開始沒有任何選項被選取，「套用」不能按，並提示先選', () => {
    const html = modal(19);
    expect(html).not.toMatch(/type="radio"[^>]*checked/);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>套用/);
    expect(html).toContain('請先選一種處理方式');
  });
  it('取代的選項上就預告已排考程會被移除幾筆，合併寫明考程不受影響', () => {
    const html = modal(19);
    expect(html).toContain('已排進考程的 19 筆會被移除');
    expect(html).toContain('已排的考程不受影響');
  });
  it('沒有已排考程受影響時不寫移除預告', () => {
    expect(modal(0)).not.toContain('筆會被移除');
  });
});
