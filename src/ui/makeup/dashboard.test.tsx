import { renderToString } from 'preact-render-to-string';
import { afterEach, describe, expect, it } from 'vitest';
import { dashboardOf, fixTargets, setRun, toCheck, type RunRecord } from './dashboard';
import { readFileSync } from 'node:fs';
import { Drawer } from '../components/Drawer';
import { MakeupSummaryBar } from './pages/MkSummaryBar';
import { MkStep6 } from './pages/MkStep6';
import { MkStep7 } from './pages/MkStep7';
import { outputsOf } from './pipeline';
import { stepDone } from './steps';
import { addDay } from './session';
import { fakeSession, rooms } from './testKit';

const noop = () => undefined;
const good = () => fakeSession({ rooms: rooms(6), id: 'mk-dash' });
const bad = () => fakeSession({ rooms: rooms(1, 5), id: 'mk-dash-bad' });
const rec = (s: ReturnType<typeof good>, over: Partial<RunRecord> = {}): RunRecord => {
  const v = outputsOf(s).version;
  return { version: v, readback: [{ file: 'a.docx', total: dashboardOf(s).summary.entries, version: v }], produced: [{ file: 'a.docx', version: v }], ok: true, at: '11/20 10:00', problems: [], fileNames: ['a.docx'], ...over };
};

afterEach(() => { setRun('mk-dash', undefined); setRun('mk-dash-bad', undefined); });

describe('儀表板資料（S-7、S-10）', () => {
  it('名單排得下：遺漏 0、沒有紅燈，可下載；C-14 待下載後執行，不假裝綠燈', () => {
    const d = dashboardOf(good());
    expect(['ok', 'warn']).toContain(d.state);
    expect(d.missing).toEqual([]);
    expect(d.summary.lost).toBe(0);
    expect(d.summary.red).toBe(0);
    expect(d.checks.find((c) => c.id === 'C-14')?.status).toBe('pending');
    expect(d.summary.pending).toBe(1);
    expect(d.summary.hasRoster).toBe(true);
  });
  it('教室不夠：有遺漏、紅燈、擋下載，並指出要去哪一步修', () => {
    const d = dashboardOf(bad());
    expect(d.state).toBe('blocked');
    expect(d.missing.length).toBeGreaterThan(0);
    expect(d.summary.lost).toBe(d.missing.length);
    expect(d.gate.allowed).toBe(false);
    expect(fixTargets(d.gate).length).toBeGreaterThan(0);
  });
  it('沒有名單：state＝none，不顯示通過', () => {
    const { parse: _p, ...rest } = good();
    void _p;
    const d = dashboardOf(rest);
    expect(d.state).toBe('none');
    expect(d.summary.hasRoster).toBe(false);
    expect(stepDone(rest)[6]).toBe(false);
  });
  it('同一個場次只算一次（記憶）；產出紀錄一變才重算', () => {
    const s = good();
    expect(dashboardOf(s)).toBe(dashboardOf(s));
    setRun(s.id, rec(s));
    expect(dashboardOf(s).run).toBeDefined();
  });
  it('下載過、資料沒變：C-14 綠、C-15 綠、不過期；⑦ 算做完', () => {
    const s = good();
    setRun(s.id, rec(s));
    const d = dashboardOf(s);
    expect(d.stale).toBe(false);
    expect(d.checks.find((c) => c.id === 'C-14')?.status).toBe('green');
    expect(d.checks.find((c) => c.id === 'C-15')?.status).toBe('green');
    expect(stepDone(s)[7]).toBe(true);
  });
  it('下載後名單或設定改過：過期（C-15 琥珀），舊回讀不拿來對新資料，也不擋下載（D153）', () => {
    const s = good();
    setRun(s.id, rec(s));
    const changed = { ...s, breakMin: 25 };
    const d = dashboardOf(changed);
    expect(d.stale).toBe(true);
    expect(d.checks.find((c) => c.id === 'C-15')?.status).toBe('amber');
    expect(d.checks.find((c) => c.id === 'C-14')?.status).toBe('pending');
    expect(d.gate.allowed).toBe(true);
    expect(d.state).toBe('warn');
    expect(stepDone(changed)[7]).toBe(false);
  });
  it('回讀人次與排程不符：C-14 紅燈，擋下載（紅燈不可放行）', () => {
    const s = good();
    const v = outputsOf(s).version;
    setRun(s.id, rec(s, { ok: false, readback: [{ file: 'a.docx', total: 1, version: v }] }));
    const d = dashboardOf(s);
    expect(d.checks.find((c) => c.id === 'C-14')?.status).toBe('red');
    expect(d.state).toBe('blocked');
  });
  it('對帳列：綠→通過、琥珀→警示、紅→不通過、待執行→待下載後執行；紅燈明細可跳到修正步驟', () => {
    const d = dashboardOf(bad());
    const lights = new Map(d.checks.map((c) => [c.id, toCheck(c, noop).light]));
    expect(lights.get('C-14')).toBe('wait');
    const red = d.checks.find((c) => c.status === 'red')!;
    const ck = toCheck(red, noop);
    expect(ck.light).toBe('fail');
    expect(ck.formula).not.toBe('');
    expect(ck.issues.length).toBeGreaterThan(0);
    expect(ck.issues[0]?.go?.label).toMatch(/^[①-⑦]/);
  });
});

describe('儀表板畫面', () => {
  it('⑥ 全綠：遺漏 0 ✓、可以下載、八個區塊都在、用「不參加」不用「缺考」', () => {
    const html = renderToString(<MkStep6 s={good()} onStep={noop} />);
    expect(html).toContain('可以下載');
    expect(html).toContain('遺漏 0 ✓');
    for (const t of ['總覽', 'C-1～C-15', '考日 × 時段 × 教室', '班級 × 科目', '備卷表', '風險與警示', '版本資訊']) expect(html).toContain(t);
    expect(html).toContain('待下載後執行');
    expect(html).not.toContain('缺考');
  });
  it('⑥ 有紅燈：醒目寫「不能下載」、列出遺漏、紅燈沒有「確認放行」', () => {
    const html = renderToString(<MkStep6 s={bad()} onStep={noop} />);
    expect(html).toContain('不能下載');
    expect(html).toContain('遺漏');
    expect(html).toContain('✕');
    expect(html).not.toContain('我已確認');
  });
  it('⑥ 沒有名單：空狀態，不顯示任何通過', () => {
    const { parse: _p, ...rest } = good();
    void _p;
    const html = renderToString(<MkStep6 s={rest} onStep={noop} />);
    expect(html).toContain('還沒有名單可以檢核');
    expect(html).not.toContain('可以下載');
    expect(html).not.toContain('rc-pass');
  });
  it('⑦ 可下載：兩顆並排鈕、七項產出、不停用', () => {
    const html = renderToString(<MkStep7 s={good()} onStep={noop} />);
    expect(html).toContain('下載 Word');
    expect(html).toContain('下載 PDF（開啟列印頁）');
    for (const k of ['O-1', 'O-2', 'O-3', 'O-4', 'O-5', 'O-7']) expect(html).toContain(k);
    expect(html).toMatch(/將開啟 1 個列印頁（共 \d+ 頁）/);
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>[^<]*(<[^>]+>)*[^<]*下載 Word/);
  });
  it('⑦ 被擋下：按鈕停用，並寫明為什麼不能、怎麼修', () => {
    const html = renderToString(<MkStep7 s={bad()} onStep={noop} />);
    expect(html).toContain('不能下載');
    expect(html).toContain('到 ');
    expect(html).toMatch(/disabled/);
    expect(html).toContain('data-why');
  });
  it('S-10 摘要列：學生、人次、已排程、遺漏、不通過／警示／通過；沒名單時說尚未匯入', () => {
    const html = renderToString(<MakeupSummaryBar s={good()} onStep={noop} />);
    for (const t of ['學生', '應補考人次', '已排程', '遺漏', '不通過', '警示', '通過', '看儀表板']) expect(html).toContain(t);
    const { parse: _p, ...rest } = good();
    void _p;
    expect(renderToString(<MakeupSummaryBar s={rest} onStep={noop} />)).toContain('尚未匯入補考名單');
    expect(renderToString(<MakeupSummaryBar s={bad()} onStep={noop} />)).toContain('✕');
  });
});

describe('S-10 看儀表板用 Drawer（D176④、D188）', () => {
  it('Drawer 輸出側滑面板結構（dialog、標題、關閉鈕），摘要列不再引用 Modal', () => {
    const html = renderToString(<Drawer title="檢核與對帳儀表板" onClose={noop}><p>內容</p></Drawer>);
    expect(html).toContain('drawer-p');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('檢核與對帳儀表板');
    expect(html).toContain('關閉');
    expect(readFileSync('src/ui/makeup/pages/MkSummaryBar.tsx', 'utf8')).not.toContain('Modal');
  });
});

describe('⑥ 依考日對帳（U-8、D184）', () => {
  it('單一考日：不出現「依考日對帳」', () => {
    expect(renderToString(<MkStep6 s={good()} onStep={noop} />)).not.toContain('依考日對帳');
  });
  it('兩個考日：出現「全場次／各日」切換與合計列，差異 0 ✓', () => {
    const one = addDay(good());
    const s = { ...one, gradeDay: { ...one.gradeDay, S2: 'd2' } };
    const html = renderToString(<MkStep6 s={s} onStep={noop} />);
    expect(html).toContain('依考日對帳');
    expect(html).toContain('全場次');
    expect(html).toContain('全場次合計');
    expect(html).toContain('0 ✓');
  });
});
