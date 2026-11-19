/** #383、#384（D149①）：琥珀警示只提示、不擋下載、不用逐項確認；只有紅燈擋下載；畫面不再同時出現「要確認才能下載」與「可以下載」。 */
import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import { gateOf, reconcile } from './reconcile';
import { ReconcilePanel } from './pages/ReconcilePanel';
import { examResult } from './seating';
import { gsatDoc } from './reconcileFixtures';

const noop = () => undefined;
const panel = (r: ReturnType<typeof reconcile>) => renderToString(<ReconcilePanel r={r} gate={gateOf(r)} at="11/19 10:00" onRecheck={noop} onGo={noop} />);

describe('D149① 下載閘門：只有紅燈擋下載', () => {
  it('只有琥珀警示：gate 不擋（why 空字串）、畫面沒有逐項確認鈕與彈窗，也沒有「須先…才能下載」', () => {
    const { doc, exam } = gsatDoc({ absentRoster: 3 }); // 未參加 30% → M-1 琥珀
    const r = reconcile(doc, exam);
    const g = gateOf(r);
    expect(g.fails).toBe(0);
    expect(g.warns.map((w) => w.id)).toEqual(['M-1']);
    expect(g.why).toBe('');
    const html = panel(r);
    expect(html).toContain('不影響下載');
    for (const t of ['逐項確認', '才能下載', 'role="dialog"']) expect(html).not.toContain(t);
  });

  it('#384 兩條訊息不並存：沒有紅燈時畫面不會出現「還不能下載」，有紅燈時不會出現「可以直接下載」', () => {
    const { doc, exam } = gsatDoc({ absentRoster: 3 });
    const warnHtml = panel(reconcile(doc, exam));
    expect(warnHtml).toContain('可以直接下載');
    expect(warnHtml).not.toContain('還不能下載');

    const ok = gsatDoc();
    const res = examResult(ok.doc, ok.exam)!;
    const bad = { ...ok.doc, examFiles: { ...ok.doc.examFiles, [ok.exam.id]: { ...ok.doc.examFiles![ok.exam.id]!, result: { ...res, assignments: res.assignments.slice(1) } } } };
    const failHtml = panel(reconcile(bad, ok.exam));
    expect(failHtml).toContain('還不能下載');
    expect(failHtml).not.toContain('可以直接下載');
    expect(gateOf(reconcile(bad, ok.exam)).why).toMatch(/不通過.*須先修正/);
  });

  it('紅燈仍擋下載（不因這次改動放行）', () => {
    const { doc, exam } = gsatDoc();
    const res = examResult(doc, exam)!;
    const bad = { ...doc, examFiles: { ...doc.examFiles, [exam.id]: { ...doc.examFiles![exam.id]!, result: { ...res, assignments: res.assignments.slice(1) } } } };
    expect(gateOf(reconcile(bad, exam)).fails).toBeGreaterThan(0);
  });
});
