/**
 * D140（使用者 2026-11-19：iPhone 不支援，只提示用電腦；稿 v2.65）：
 * 瀏覽器沒有 showDirectoryPicker（iPhone／iPad 所有瀏覽器、Safari、Firefox）時，初始畫面不可有任何能「選資料夾」的地方，
 * 所以不會進入「選好資料夾了」的假狀態（以前拖曳區仍可點，進入記憶體存放，重新整理資料全沒）。
 */
import { describe, expect, it } from 'vitest';
import { renderToString as render } from 'preact-render-to-string';
import { Init } from './pages/Init';
import { createMemoryRepository } from './repository';

const noop = () => {};

describe('D140 不支援資料夾授權的瀏覽器：只提示用電腦，不能進入假狀態', () => {
  it('沒有拖曳區、沒有「選擇資料夾」鈕、沒有任何可點的按鈕或可聚焦區域', () => {
    const repo = createMemoryRepository();
    const html = render(<Init repo={repo} fsSupported={false} onDone={noop} />);
    expect(html).not.toContain('dropzone');
    expect(html).not.toContain('將資料夾拖曳至此');
    expect(html).not.toContain('選擇資料夾');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('role="button"');
    expect(html).not.toContain('tabindex');
    expect(repo.hasFolder()).toBe(false);
  });
  it('明確寫出 iPhone／iPad 不能用、桌機 Safari／Firefox 也不行，請改用電腦的 Chrome 或 Edge（危險色提示條）', () => {
    const html = render(<Init repo={createMemoryRepository()} fsSupported={false} onDone={noop} />);
    expect(html).toContain('這個瀏覽器無法使用考務小幫手');
    expect(html).toContain('class="alert a-err"');
    expect(html).toContain('iPhone、iPad 無法使用。');
    expect(html).toContain('Safari、Firefox');
    expect(html).toMatch(/電腦（Windows 或 Mac）上的 <a [^>]*>Chrome<\/a> 或 Edge/);
    // 同一件事不講兩次：舊的「請用 Chrome 開啟」紅條拿掉
    expect(html).not.toContain('目前瀏覽器無法儲存資料');
  });
  it('支援的瀏覽器（Chrome、Edge）畫面不變：拖曳區、選擇資料夾鈕、資訊提示條都在，沒有不支援提示', () => {
    const html = render(<Init repo={createMemoryRepository()} fsSupported onDone={noop} />);
    expect(html).toContain('class="dropzone');
    expect(html).toContain('>選擇資料夾</button>');
    expect(html).toContain('每次模擬考會建立獨立資料夾');
    expect(html).not.toContain('這個瀏覽器無法使用考務小幫手');
  });
});
