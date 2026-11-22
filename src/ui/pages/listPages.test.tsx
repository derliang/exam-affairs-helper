import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import { demoDoc } from '../repository';
import { newExam } from '../store';
import { Exams } from './Exams';
import { NewExam } from './NewExam';

const noop = () => undefined;
function docWith(): ReturnType<typeof demoDoc> {
  let d = demoDoc();
  for (const [k, n] of [['gsat', '學測第一次'], ['bcct', '會考第一次']] as const) {
    const r = newExam(d, k, n, new Date(`2026-1${k === 'gsat' ? 0 : 1}-01T02:00:00Z`));
    if (!r.ok) throw new Error(r.error);
    d = r.doc;
  }
  return d;
}

describe('模擬考列表頁', () => {
  it('頁首：h1、資料夾 chip、更換資料夾、設定、新增；每列有六格進度、步數、最後修改；有圖例', () => {
    const html = renderToString(<Exams doc={docWith()} folder="範例資料夾" onOpen={noop} onNew={noop} onSettings={noop} onChangeFolder={noop} />);
    expect(html).toContain('<h1>模擬考</h1>');
    expect(html).toContain('範例資料夾');
    for (const t of ['更換資料夾', '設定', '新增模擬考', '最後修改', '步完成', '進度條圖例']) expect(html).toContain(t);
    expect(html).toContain('高中部・學測');
    expect(html).toContain('國中部・會考');
    expect(html).toMatch(/115 學年・高三・(\d+ 人|尚未匯入名單)/);
    expect((html.match(/class="dots"/g) ?? []).length).toBe(2);
    // 新到舊：會考（11 月）在學測（10 月）前面
    expect(html.indexOf('會考第一次')).toBeLessThan(html.indexOf('學測第一次'));
  });
  it('空狀態文案與原型一致', () => {
    const html = renderToString(<Exams doc={demoDoc()} onOpen={noop} onNew={noop} onSettings={noop} onChangeFolder={noop} />);
    expect(html).toContain('還沒有模擬考');
    expect(html).toContain('按「新增模擬考」開始。');
    // #531：空白時只有一顆「新增模擬考」（卡內大鈕），頁首不放
    expect((html.match(/新增模擬考<\/button>/g) ?? []).length).toBe(1);
    expect(html).toContain('btn-lg');
  });
  it('有考試時新增鈕回頁首右上，只有一顆、不是大鈕', () => {
    const html = renderToString(<Exams doc={docWith()} onOpen={noop} onNew={noop} onSettings={noop} onChangeFolder={noop} />);
    expect((html.match(/新增模擬考<\/button>/g) ?? []).length).toBe(1);
    expect(html).not.toContain('btn-lg');
  });
});

describe('新增模擬考整頁', () => {
  const html = renderToString(<NewExam doc={demoDoc()} onCancel={noop} onCreate={noop} now={() => new Date(2026, 10, 8)} />);
  it('三段式：選類型、基本資料、預設設定', () => {
    for (const t of ['1　選類型', '2　基本資料', '3　預設設定', '建立並開始', '返回路徑']) expect(html).toContain(t);
  });
  it('三張類型卡（沒有補考卡，D186），分科可選、學測已選', () => {
    expect((html.match(/class="tcard"/g) ?? []).length).toBe(3);
    expect(html).not.toContain('尚未開放');
    expect(html).toContain('已選');
  });
  it('名稱預設帶建議名稱、學期下拉、唯讀對象、學年提示', () => {
    expect(html).toContain('value="學測第一次"');
    expect(html).toContain('termcards');
    expect(html).toContain('上學期');
    expect(html).toContain('高三');
    expect(html).toContain('學年度');
    expect(html).toContain('value="115"');
    expect(html).toContain('還沒有同類型的模擬考');
  });
  it('有同類型舊考試時顯示會帶入哪一次的設定', () => {
    const html2 = renderToString(<NewExam doc={docWith()} onCancel={noop} onCreate={noop} />);
    expect(html2).toContain('會帶入「學測第一次」的設定');
    expect(html2).toContain('value="學測第二次"');
  });
});

describe('設定頁部別預設（項目 8）', () => {
  it('從國中部考試進來預設國中部，沒指定仍是高中部', async () => {
    const { Settings } = await import('./Settings');
    const pressed = (html: string, label: string) => new RegExp(`aria-pressed="true"[^>]*>${label}<`).test(html);
    const j = renderToString(<Settings doc={demoDoc()} onChange={noop} tab="roster" division="junior" />);
    expect(pressed(j, '國中部')).toBe(true);
    const s = renderToString(<Settings doc={demoDoc()} onChange={noop} tab="roster" />);
    expect(pressed(s, '高中部')).toBe(true);
  });
});

describe('#250 列表人數口徑', () => {
  it('名單含全科缺考者：預設排座（D137），列表不註明；學測在 ② 選「不排座」才註明「含全科缺考 N 人，不排座」', () => {
    const d = docWith();
    const e = d.exams.find((x) => x.kind === 'gsat')!;
    const entries = [
      { classNo: 1, seatNo: 1, name: '甲', subjectIds: ['chi'] },
      { classNo: 1, seatNo: 2, name: '乙', subjectIds: [] },
    ];
    const doc = { ...d, examFiles: { [e.id]: { entries, diffs: [] } } };
    const html = renderToString(<Exams doc={doc} onOpen={noop} onNew={noop} onSettings={noop} onChangeFolder={noop} />);
    expect(html).not.toContain('含全科缺考');
    // D142：舊存檔帶「不排座」（seatFullyAbsent: false）也一律排座，列表不再寫「不排座」
    const off = { ...doc, exams: doc.exams.map((x) => (x.id === e.id ? { ...x, seatFullyAbsent: false } : x)) };
    const html2 = renderToString(<Exams doc={off} onOpen={noop} onNew={noop} onSettings={noop} onChangeFolder={noop} />);
    expect(html2).toContain('2 人');
    expect(html2).not.toContain('不排座');
  });
});
describe('座位表圖例（稿 v2.88）：小牌與說明綁成一項', () => {
  it('每個小牌和它的說明在同一個 lg-i 裡，不再各自散在列上', async () => {
    const { ChartLegend } = await import('../components/SeatChart');
    const html = renderToString(<ChartLegend override marks />);
    expect((html.match(/class="lg-i"/g) ?? []).length).toBe(6);
    expect(html).toMatch(/class="lg-i"><span class="cell mk-x"><span class="mk">X 科目<\/span><\/span><span>這位考生不考這一科/);
  });
});

describe('共用設定表格窄寬（稿 v2.90，#553 #515）', () => {
  it('班級表容器 ≤900 換小卡（rt-wide）、名單表頭不換行（rt-mx）、「不能刪除」不拆', async () => {
    const { Settings } = await import('./Settings');
    const cls = renderToString(<Settings doc={demoDoc()} onChange={noop} tab="classes" division="senior" />);
    expect(cls).toContain('rt-t rt-wide rt-mx');
    const ros = renderToString(<Settings doc={demoDoc()} onChange={noop} tab="roster" division="senior" />);
    expect(ros).toContain('rt-t rt-wide rt-keep rt-mx');
    expect(ros).toContain('<span class="nb">未填</span>');
  });
});

describe('窄寬斷行（稿 v2.91，B 包 #554 #513 #516 #547）', () => {
  it('版權頁句號與程式碼塊綁在同一個不可拆單位；提示條多顆鈕的動作區 ≤560 換到文字下方', async () => {
    const { Copyright } = await import('./Copyright');
    expect(renderToString(<Copyright onBack={noop} />)).toContain('<span class="nb"><code>src/export/fonts/OFL.txt</code>。</span>');
    const { readFileSync } = await import('node:fs');
    const css = readFileSync('src/styles/app.css', 'utf8');
    expect(css).toContain('.alert>.btn,.alert>.row{grid-column:2;justify-self:start}');
    expect(css).toContain('.rc-tri{display:grid;grid-template-columns:repeat(auto-fit,minmax(96px,1fr))');
    expect(css).toContain('.alert>div{min-width:0;overflow-wrap:anywhere}'); // #564
  });
});
