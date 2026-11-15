import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import { demoDoc } from './repository';
import { migrateRosterYear, switchRosterYear } from './rosterYears';
import { newExam, type Doc } from './store';
import { Settings } from './pages/Settings';
import { Step2 } from './pages/Step2';

const noop = () => undefined;
const today = new Date(2026, 10, 15);
function docWith(): Doc {
  const a = newExam({ ...demoDoc(), exams: [] }, 'gsat', '分科舊', today, { year: 114 });
  if (!a.ok) throw new Error(a.error);
  const b = newExam(a.doc, 'gsat', '學測新', new Date(today.getTime() + 1000), { year: 115 });
  if (!b.ok) throw new Error(b.error);
  return migrateRosterYear(b.doc);
}

describe('#208 畫面（稿 v2.36）', () => {
  it('共用設定學生名單頁最上方有學年度分段鈕與新增學年度', () => {
    const d = docWith();
    const r = switchRosterYear(d, 114);
    if (!r.ok) throw new Error(r.error);
    const html = renderToString(<Settings doc={r.doc} onChange={noop} tab="roster" />);
    expect(html).toContain('aria-label="學年度"');
    expect(html).toContain('114 學年');
    expect(html).toContain('115 學年');
    expect(html).toContain('新增學年度');
    expect(html.indexOf('學年度')).toBeLessThan(html.indexOf('部別'));
  });
  it('② 顯示名單年度；考試學年度與名單年度不同時顯示「年度不符」', () => {
    const d = docWith(); // 名單年度 115
    const old = d.exams.find((e) => e.name === '分科舊')!;
    const cur = d.exams.find((e) => e.name === '學測新')!;
    const h1 = renderToString(<Step2 doc={d} exam={old} onChange={noop} onToRoster={noop} />);
    expect(h1).toContain('名單年度：115 學年');
    expect(h1).toContain('年度不符');
    expect(h1).toContain('114 學年度');
    const h2 = renderToString(<Step2 doc={d} exam={cur} onChange={noop} onToRoster={noop} />);
    expect(h2).toContain('名單年度：115 學年');
    expect(h2).not.toContain('年度不符');
  });
});
