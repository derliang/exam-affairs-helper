/** H0：更名「考務小幫手」、補考佔位卡、舊備份檔與本機資料庫名稱不變；全部假資料 */
import { readFileSync } from 'node:fs';
import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import { checksum, decode, encode } from '../data';
import { AppBar } from './components/AppBar';
import { NewExam } from './pages/NewExam';
import { demoDoc } from './repository';
import { APP_NAME } from './version';

const noop = () => undefined;

describe('H0 程式名稱', () => {
  it('APP_NAME 是「考務小幫手」，品牌列與無障礙文字同步', () => {
    expect(APP_NAME).toBe('考務小幫手');
    const html = renderToString(<AppBar version="v1.25.0" items={[]} theme="system" onTheme={noop} onHome={noop} />);
    expect(html).toContain('考務小幫手，回模擬考列表');
    expect(html).not.toContain('模擬考小幫手');
  });
  it('套件名改了，但本機資料庫名稱 mock-exam-helper 不變（改了舊資料讀不到）', () => {
    const src = readFileSync('src/data/fsRepository.ts', 'utf8');
    expect(src).toContain("const DB = 'mock-exam-helper'");
  });
  it('index.html 與 manifest 用相對路徑，不寫死舊 repo 路徑', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).toContain('<title>考務小幫手</title>');
    expect(html).toContain('%BASE_URL%manifest.webmanifest');
    const m = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
    expect(m.name).toBe('考務小幫手');
    expect(m.short_name).toBe('考務小幫手');
    expect(JSON.stringify(m)).not.toContain('mock-exam-helper');
    for (const i of m.icons) expect(i.src.startsWith('/')).toBe(false);
  });
});

describe('H0 舊備份檔照常可匯入', () => {
  it('更名前產生的備份（固定字串，含 checksum）仍可 decode，內容不變', () => {
    const body = '{"v":1,"name":"舊備份假資料"}';
    const old = `{"schemaVersion":1,"checksum":"${checksum(body)}","data":${body}}`;
    const r = decode<{ v: number; name: string }>(old);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual({ v: 1, name: '舊備份假資料' });
  });
  it('目前版本編出的檔也讀得回來（往返）', () => {
    const doc = demoDoc();
    const r = decode(encode(doc));
    expect(r.ok).toBe(true);
  });
});

describe('H0 補考佔位卡', () => {
  const html = renderToString(<NewExam doc={demoDoc()} onCancel={noop} onCreate={noop} now={() => new Date('2026-09-01T02:00:00Z')} />);
  const cards = html.split('<button').filter((x) => x.includes('class="tcard"'));
  it('有四張類型卡，補考 disabled、不能選、有 aria-describedby 說明', () => {
    expect(cards.length).toBe(4);
    const mk = cards.find((c) => c.includes('<strong>補考</strong>'))!;
    expect(mk).toContain('disabled');
    expect(mk).toContain('aria-describedby="soon-note"');
    expect(mk).not.toContain('aria-pressed');
    expect(mk).toContain('高中部、國中部');
    expect(html).toContain('id="soon-note"');
    expect(html).toContain('補考即將推出，現在還不能選');
  });
  it('「即將推出」徽章只在補考卡；學測、分科、會考仍可選', () => {
    expect(html.match(/即將推出<\/span>/g)?.length).toBe(1);
    for (const t of ['學測模擬考', '分科模擬考', '會考模擬考']) {
      const c = cards.find((x) => x.includes(`<strong>${t}</strong>`))!;
      expect(c).toBeTruthy();
      expect(c).not.toContain('disabled');
      expect(c).not.toContain('即將推出');
    }
  });
});
