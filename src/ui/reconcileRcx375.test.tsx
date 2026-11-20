/** D176（稿 v2.78 §10.44.1）：總帳核對值 ✕ 的格子加 class rc-x（✕ 紅字粗體）；核對相符的格子不加。 */
import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import { gateOf, reconcile } from './reconcile';
import { ReconcilePanel } from './pages/ReconcilePanel';
import { gsatDoc } from './reconcileFixtures';

const noop = () => undefined;
const panel = (r: ReturnType<typeof reconcile>) => renderToString(<ReconcilePanel r={r} gate={gateOf(r)} at="11/19 10:00" onRecheck={noop} onGo={noop} />);

describe('總帳 ✕ 格子（D176）', () => {
  it('全部相符：沒有 rc-x', () => {
    const { doc, exam } = gsatDoc();
    expect(panel(reconcile(doc, exam))).not.toContain('rc-x');
  });
  it('座位表數字對不上：只有「座位表」格與「帳」格加 rc-x', () => {
    const { doc, exam } = gsatDoc();
    const r = reconcile(doc, exam);
    if (r.state !== 'ready') throw new Error('fixture 應有名冊');
    const l = r.ledger[0]!;
    r.ledger[0] = { ...l, seat: l.seat + 1, ok: false };
    const html = panel(r);
    expect(html).toMatch(/data-label="座位表" class="rc-x"/);
    expect(html).toMatch(/data-label="帳" class="rc-x"/);
    expect(html).not.toMatch(/data-label="標籤" class="rc-x"/);
    expect(html).not.toMatch(/data-label="教室加總" class="rc-x"/);
  });
});
