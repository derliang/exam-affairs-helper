import { useState } from 'preact/hooks';
import type { FsRepository } from '../../data';
import { Alert, More, PageHead } from '../components';
import type { Repository } from '../repository';
import type { Doc } from '../store';
import { FolderCard, RestoreMissing, type FolderMode } from './FolderUi';

/** 初始化：選資料夾 ＋ 拖拉資料夾（UI-03）。標題列不借用進度條樣式（UI-01/02） */
/**
 * 資料夾設定頁（G24）：已選資料夾時顯示「目前資料夾」卡片（狀態、最後存檔、更換／重新連結／搬到新位置）；
 * 還沒選（或啟動時上次的資料夾找不到，G16）時顯示選擇資料夾與白話說明。
 */
export function Init(p: { repo: Repository; fsSupported: boolean; fs?: FsRepository; doc?: Doc; missing?: boolean; onDialog?: (m: FolderMode) => void; onBack?: () => void; onRestore?: () => Promise<boolean>; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [err, setErr] = useState('');

  const run = async (f: () => Promise<boolean | void>) => {
    setBusy(true); setErr('');
    try {
      const r = await f();
      // 使用者按了取消或沒授權寫入：資料夾沒有生效
      if (r === false || !p.repo.hasFolder()) setErr('無法存取資料夾。請確認選的是資料夾（不是檔案）並允許讀寫，或改用「選擇資料夾」。');
      else p.onDone();
    } catch (e) {
      // 使用者取消選擇視窗不算錯誤
      if (!(e instanceof DOMException && e.name === 'AbortError')) setErr('無法開啟資料夾。請重新選擇，或改用拖曳。');
    } finally { setBusy(false); }
  };

  // 不支援資料夾授權（iPhone／iPad 所有瀏覽器、Safari、Firefox）時不得進入「選好資料夾了」的假狀態（D140）
  const pick = () => p.fsSupported && !busy && run(() => p.repo.chooseFolder());
  if (p.fs && p.doc && p.repo.hasFolder() && p.onDialog) {
    const d = p.doc;
    return (
      <section>
        <PageHead {...(p.onBack ? { crumbs: [{ label: '模擬考列表', onClick: p.onBack }] } : {})} title="資料夾設定" />
        <div class="stack" style="max-width:860px">
          <FolderCard name={p.fs.folderName?.() ?? ''} missing={!!p.missing} pending={p.fs.pendingCount()} lastSaved={p.fs.lastSavedAt()} exams={d.exams.length} rosters={[d.rosters.senior, d.rosters.junior].filter((r) => r.length > 0).length} onRelink={() => p.onDialog!('relink')} onChange={() => p.onDialog!('change')} onMove={() => p.onDialog!('move')} />
        </div>
      </section>
    );
  }
  const lost = p.fs?.restoreProblem();
  return (
    <div class="center-card">
      <div class="row">
        <div class="logo" aria-hidden="true">
          <svg viewBox="0 0 34 34" fill="none">
            <rect x="2" y="2" width="8.5" height="8.5" rx="2" fill="currentColor" opacity=".55" /><rect x="12.75" y="2" width="8.5" height="8.5" rx="2" fill="currentColor" opacity=".55" /><rect x="23.5" y="2" width="8.5" height="8.5" rx="2" fill="currentColor" />
            <rect x="2" y="12.75" width="8.5" height="8.5" rx="2" fill="currentColor" opacity=".55" /><rect x="12.75" y="12.75" width="8.5" height="8.5" rx="2" fill="currentColor" /><rect x="23.5" y="12.75" width="8.5" height="8.5" rx="2" fill="currentColor" opacity=".55" />
            <rect x="2" y="23.5" width="8.5" height="8.5" rx="2" fill="currentColor" /><rect x="12.75" y="23.5" width="8.5" height="8.5" rx="2" fill="currentColor" opacity=".55" /><rect x="23.5" y="23.5" width="8.5" height="8.5" rx="2" fill="currentColor" opacity=".55" />
          </svg>
        </div>
        <div><h1>考務小幫手</h1><p class="muted">安排模擬考座位、製作標籤與抽離名單</p></div>
      </div>
      {!p.fsSupported ? <Unsupported /> : <>
      {lost && p.onDialog && <RestoreMissing name={lost.name} busy={busy} onRelink={() => p.onDialog!('relink')} onOther={pick} />}
      <div class="card stack">
        <h2 style="font-size:18px">選擇資料儲存資料夾</h2>
        <p class="muted">學生名單與座位結果只存在你的電腦，本網站不會把它們上傳到網路。請選一個你找得到的資料夾。</p>
        <More title="說明：雲端硬碟與授權">若這個資料夾由雲端硬碟同步，同步軟體仍可能把檔案上傳。下次開啟時會先嘗試沿用這個資料夾，瀏覽器可能要你重新授權。</More>
        <div
          class={`dropzone${over ? ' over' : ''}`} tabIndex={0} role="button"
          aria-label="將資料夾拖曳至此，或按一下選擇資料夾"
          onClick={pick}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && pick()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer && !busy) { const items = e.dataTransfer.items; run(() => p.repo.adoptDropped(items)); } }}
        >
          <strong>將資料夾拖曳至此</strong>
          <span class="small">放開後依瀏覽器提示授權；也可點此選擇資料夾。</span>
        </div>
        <div class="row">
          <span class="small muted">或者</span>
          <button type="button" class="btn btn-primary btn-lg" disabled={busy || !p.fsSupported} onClick={pick}>選擇資料夾</button>
          {p.onRestore && <button type="button" class="btn btn-lg" disabled={busy} onClick={() => run(() => p.onRestore!())}>使用上次資料夾</button>}
          <span class="small muted">限使用 <a href="https://www.google.com/intl/zh-TW/chrome/" target="_blank" rel="noopener noreferrer">Chrome</a> 瀏覽器</span>
        </div>
        {err && <Alert tone="danger">{err}</Alert>}
      </div>
      <Alert tone="info">每次模擬考會建立獨立資料夾，避免覆蓋其他考試資料。</Alert>
      </>}
    </div>
  );
}

/**
 * 不支援的瀏覽器（稿 v2.65、D140；使用者 2026-11-19 決定 iPhone 不支援、只提示用電腦）：
 * 不畫拖曳區與「選擇資料夾」鈕，沒有任何會選資料夾的地方，只說明這個瀏覽器不能用、請改用電腦的 Chrome 或 Edge。
 */
function Unsupported() {
  const site = typeof location === 'undefined' ? '' : location.host + location.pathname;
  return (
    <div class="card stack">
      <h2 style="font-size:18px">這個瀏覽器無法使用考務小幫手</h2>
      <Alert tone="danger"><b>iPhone、iPad 無法使用。</b>考務小幫手要把學生名單與座位結果存進你電腦上的資料夾，iPhone、iPad 上的所有瀏覽器（包括 Chrome），以及電腦上的 Safari、Firefox 都做不到。</Alert>
      <p>請改用電腦（Windows 或 Mac）上的 <a href="https://www.google.com/intl/zh-TW/chrome/" target="_blank" rel="noopener noreferrer">Chrome</a> 或 Edge 開啟本網站{site ? <>：<b>{site}</b></> : '。'}</p>
      <p class="small muted">學生名單與座位結果只存在你的電腦，本網站不會把它們上傳到網路。</p>
    </div>
  );
}
