/**
 * 補考入口的暫時開關（K2）：品牌列「補考」入口與更名由 K5 處理，K2 先用網址參數讓畫面可進入、可測，
 * 不動 MVP 既有模擬考的行為。網址加 `?makeup`（或 `#makeup`）開啟，記在這個瀏覽器；`?makeup=off` 關閉。
 * K5 整合時：把 `makeupEnabled()` 改成永遠 true（或整個移除）即可。
 */
const KEY = 'exam-helper-makeup';

export function makeupEnabled(win: { location?: { search: string; hash: string }; localStorage?: Storage } | undefined = (globalThis as unknown as { window?: { location?: { search: string; hash: string }; localStorage?: Storage } }).window): boolean {
  try {
    if (!win?.location) return false;
    const q = new URLSearchParams(win.location.search);
    if (q.get('makeup') === 'off') { win.localStorage?.removeItem(KEY); return false; }
    if (q.has('makeup') || win.location.hash.startsWith('#makeup')) { win.localStorage?.setItem(KEY, '1'); return true; }
    return win.localStorage?.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
