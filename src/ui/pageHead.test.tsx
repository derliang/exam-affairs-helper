/** 稿 v2.29 各頁共用單一頁首、校-08 步驟條文字（全部假資料） */
import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import { PageHead, StepNav } from './components';

const noop = () => {};
describe('共用頁首', () => {
  it('有路徑：路徑列只列來源頁；標題卡右側「已儲存／復原／共用設定」成組', () => {
    const html = renderToString(<PageHead crumbs={[{ label: '模擬考', onClick: noop }]} title="甲考試" badge="學測第一次" status="已儲存到資料夾"><button>共用設定</button></PageHead>);
    expect(html).toContain('class="crumbs"');
    expect(html).toContain('>模擬考</button>');
    // G2：路徑末尾不再重複目前頁名稱，名稱只出現在 h1
    expect(html).not.toContain('aria-current="page"');
    expect(html.split('甲考試').length - 1).toBe(1);
    expect(html).toContain('<h1>甲考試</h1>');
    expect(html).toContain('ph-cap');
    expect(html).toContain('已儲存到資料夾');
    expect(html).toContain('共用設定');
  });
  it('根頁沒有路徑列；沒有的項目整段拿掉', () => {
    const html = renderToString(<PageHead title="模擬考" />);
    expect(html).not.toContain('crumbs');
    expect(html).not.toContain('ph-tools');
    expect(html).toContain('pghd noc');
  });
});

describe('步驟條文字（校-08）', () => {
  it('第 N／6 步　已完成 K 步', () => {
    const steps = [1, 2, 3, 4, 5, 6].map((no) => ({ no, name: `s${no}`, state: (no === 1 ? 'done' : no === 2 ? 'cur' : 'todo') as 'done' | 'cur' | 'todo' }));
    const html = renderToString(<StepNav steps={steps} onGo={noop} />);
    expect(html).toContain('第 2／6 步');
    expect(html).toContain('已完成 1 步');
  });
  it('#634（D217，修訂 #362）：已完成步數＝側欄打勾數，停在第 1 步而第 2 步已打勾就是 1 步', () => {
    const steps = [1, 2, 3, 4, 5, 6].map((no) => ({ no, name: `s${no}`, state: (no === 1 ? 'cur' : no === 2 ? 'done' : 'todo') as 'done' | 'cur' | 'todo' }));
    const html = renderToString(<StepNav steps={steps} onGo={noop} />);
    expect(html).toContain('第 1／6 步');
    expect(html).toContain('已完成 1 步');
  });
});

describe('#634 步驟計數口徑（D217）', () => {
  it('「不需要」的步驟不算進總數，目前步驟序號也不計它（與列表 N／M 步完成同口徑）', () => {
    const steps = [1, 2, 3, 4, 5, 6].map((no) => ({ no, name: `s${no}`, state: (no === 4 ? 'skip' : no < 5 ? 'done' : no === 5 ? 'cur' : 'todo') as 'done' | 'cur' | 'todo' | 'skip' }));
    const html = renderToString(<StepNav steps={steps} onGo={noop} />);
    expect(html).toContain('第 4／5 步');
    expect(html).toContain('已完成 3 步');
  });
});

describe('#634 回到哪裡要寫具體名稱（D217）', () => {
  it('pageName：共用設定寫到分頁名；名單比對、個別覆寫、補考頁都有名稱，不再是「上一頁」', async () => {
    const { pageName } = await import('./App');
    const doc = { exams: [{ id: 'e1', name: '甲考' }] } as never;
    expect(pageName({ page: 'settings', tab: 'features' }, doc)).toBe('共用設定「選用功能」');
    expect(pageName({ page: 'settings' }, doc)).toBe('共用設定');
    expect(pageName({ page: 'reconcile', examId: 'e1' }, doc)).toBe('「甲考」名單比對');
    expect(pageName({ page: 'override', examId: 'e1' }, doc)).toBe('「甲考」個別覆寫');
    expect(pageName({ page: 'makeup' }, doc)).toBe('補考場次列表');
  });
});
