import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import { demoDoc } from './repository';
import { activateForExam, migrateRosterYear, rosterYearOf, switchRosterYear } from './rosterYears';
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

describe('#253 共用設定停在較早年度頁籤，考試頁仍讀考試自己的學年度', () => {
  it('停在 114 頁籤（工作資料換成 114）後，開 115 學年考試：名單年度 115、沒有年度不符', () => {
    const d = docWith(); // 工作資料＝115
    const tab = switchRosterYear(d, 114);
    if (!tab.ok) throw new Error(tab.error);
    const cur = tab.doc.exams.find((e) => e.name === '學測新')!;
    const wrong = renderToString(<Step2 doc={tab.doc} exam={cur} onChange={noop} onToRoster={noop} />);
    expect(wrong).toContain('年度不符'); // 不經過進入考試頁的切換，就是回報的錯誤畫面
    const shown = activateForExam(tab.doc, cur);
    expect(rosterYearOf(shown)).toBe(115);
    const html = renderToString(<Step2 doc={shown} exam={cur} onChange={noop} onToRoster={noop} />);
    expect(html).toContain('名單年度：115 學年');
    expect(html).not.toContain('年度不符');
  });
});
