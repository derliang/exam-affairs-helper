/** #380 ⑥（D171①②）：通過列收起時只有燈號、項目、「通過」與「明細」，不留「應有／實有／差異」；不通過、警示直接展開；總帳改容器寬度表格（#480）。 */
import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import { gateOf, reconcile } from './reconcile';
import { ReconcilePanel } from './pages/ReconcilePanel';
import { examResult } from './seating';
import { gsatDoc } from './reconcileFixtures';

const noop = () => undefined;
const panel = (r: ReturnType<typeof reconcile>) => renderToString(<ReconcilePanel r={r} gate={gateOf(r)} at="11/19 10:00" onRecheck={noop} onGo={noop} />);
const rowOf = (html: string, id: string) => html.split('<div class="rc-row').find((x) => x.includes(`data-check="${id}"`)) ?? '';

describe('考前對帳卡預設收合（D171①②）', () => {
  it('全部通過：每個通過列沒有三格數字與說明，只有「明細」', () => {
    const { doc, exam } = gsatDoc();
    const html = panel(reconcile(doc, exam));
    const passRows = html.match(/data-light="pass"/g) ?? [];
    expect(passRows.length).toBeGreaterThan(0);
    expect(html).not.toContain('rc-tri');
    expect(html).not.toContain('rc-detail');
    expect(html).toContain('明細');
  });

  it('警示列直接展開（有三格與公式）；其他通過列仍收起', () => {
    const { doc, exam } = gsatDoc({ absentRoster: 3 });
    const html = panel(reconcile(doc, exam));
    const m1 = rowOf(html, 'M-1');
    expect(m1).toContain('data-light="warn"');
    expect(m1).toContain('rc-tri');
    expect(m1).toContain('檢核公式');
    expect(rowOf(html, 'M-2')).not.toContain('rc-tri');
  });

  it('不通過列直接展開', () => {
    const ok = gsatDoc();
    const res = examResult(ok.doc, ok.exam)!;
    const bad = { ...ok.doc, examFiles: { ...ok.doc.examFiles, [ok.exam.id]: { ...ok.doc.examFiles![ok.exam.id]!, result: { ...res, assignments: res.assignments.slice(1) } } } };
    const html = panel(reconcile(bad, ok.exam));
    const fails = [...html.matchAll(/data-check="([^"]+)" data-light="fail"/g)].map((x) => x[1]!);
    expect(fails.length).toBeGreaterThan(0);
    for (const id of fails) expect(rowOf(html, id)).toContain('rc-tri');
  });

  it('#480 總帳：用 rtw／rt-t 容器寬度表格，沒有 .scroll、沒有另一份 rc-cards', () => {
    const { doc, exam } = gsatDoc();
    const html = panel(reconcile(doc, exam));
    expect(html).toContain('class="rtw"');
    expect(html).toContain('rt-t');
    expect(html).not.toContain('scroll');
    expect(html).not.toContain('rc-cards');
    expect(html).toContain('data-label="座位表"');
  });
});
