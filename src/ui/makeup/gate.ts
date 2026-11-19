/**
 * 補考入口的暫時開關（K2）：品牌列「補考」入口與更名由 K5 處理，K2 先用網址參數讓畫面可進入、可測，
 * 不動 MVP 既有模擬考的行為。網址加 `?makeup`（或 `#makeup`）開啟；本次開啟期間記在記憶體，
 * 不寫任何瀏覽器儲存（隱私承諾）；`?makeup=off` 關閉。
 * K5 整合時：把 `makeupEnabled()` 改成永遠 true（或整個移除）即可。
 */
let on = false;

type Win = { location?: { search: string; hash: string } };

export function makeupEnabled(win: Win | undefined = (globalThis as unknown as { window?: Win }).window, sticky = true): boolean {
  try {
    if (!win?.location) return false;
    const q = new URLSearchParams(win.location.search);
    if (q.get('makeup') === 'off') { if (sticky) on = false; return false; }
    if (q.has('makeup') || win.location.hash.startsWith('#makeup')) { if (sticky) on = true; return true; }
    return sticky ? on : false;
  } catch {
    return false;
  }
}
