/** #502：對帳列對齊 G35 稿（v2.78）：燈號圖示｜「M-1　學生數」同一個 <b>｜燈號徽章｜明細；三格標籤用稿的字（M-1 名冊／報名＋不參加／差異） */
import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import { gateOf, reconcile } from './reconcile';
import { ReconcilePanel } from './pages/ReconcilePanel';
import { gsatDoc } from './reconcileFixtures';

const noop = () => undefined;
const panel = (r: ReturnType<typeof reconcile>) => renderToString(<ReconcilePanel r={r} gate={gateOf(r)} at="11/19 10:00" onRecheck={noop} onGo={noop} />);
const rowOf = (html: string, id: string) => html.split('<div class="rc-row').find((x) => x.includes(`data-check="${id}"`)) ?? '';

describe('#502 對帳列對齊 G35 稿', () => {
  it('每列最左有燈號圖示，項目編號與名稱在同一個 <b>', () => {
    const { doc, exam } = gsatDoc();
    const row = rowOf(panel(reconcile(doc, exam)), 'M-1');
    expect(row).toContain('class="rc-ico rc-i-pass"');
    expect(row).toContain('<b>M-1　學生數</b>');
  });
  it('展開後三格標籤用稿的字', () => {
    const { doc, exam } = gsatDoc({ absentRoster: 3 });
    const html = panel(reconcile(doc, exam));
    const m1 = rowOf(html, 'M-1');
    expect(m1).toContain('名冊');
    expect(m1).toContain('報名＋不參加');
    expect(m1).not.toContain('>應有<');
  });
});
