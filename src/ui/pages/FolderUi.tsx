/**
 * 資料夾找不到的出路與資料夾設定頁的操作（G16、G24；稿 v2.43 §10.24）。
 * 文字只用資料夾「名稱」（瀏覽器拿不到真實路徑）；「更換」＝改用另一份資料，「重新連結」＝找回原本那份，
 * 「搬到新位置」＝把目前這份複製到空資料夾後改用；三者都不會刪除任何資料夾。
 */
import { useRef, useState } from 'preact/hooks';
import type { FolderPick, FsRepository } from '../../data';
import { Alert, Badge, Button, Modal, More } from '../components';
import { formatModified } from '../examList';

export type FolderMode = 'relink' | 'change' | 'move';
export interface SwitchResult { carried: boolean; reload: boolean }

/** 更換資料夾時，暫存的修改怎麼處理：blocked＝所選資料夾讀不了；none＝沒有暫存；carry-or-discard＝空資料夾可帶過去；discard-only＝只能放棄（不合併，G16 第 4 題） */
export function changeOptions(pick: FolderPick, pending: number): 'blocked' | 'none' | 'carry-or-discard' | 'discard-only' {
  if (pick.problem) return 'blocked';
  if (pending === 0) return 'none';
  return pick.kind === 'empty' ? 'carry-or-discard' : 'discard-only';
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

/** 使用者看得懂的名稱：「資料夾名」 */
const q = (n: string) => `「${n}」`;

// ───── 警告與列表錯誤狀態 ─────

/** 找不到資料夾的警告（取代紅、黃兩條）：白話原因、N 項修改未存、三個出路、技術細節收合 */
export function FolderLostAlert(p: { name: string; pending: number; detail?: string; onRelink: () => void; onChange: () => void; onDiscard: () => void; onSettings?: () => void }) {
  return (
    <Alert tone="danger" action={<div class="folder-acts"><Button small kind="primary" onClick={p.onRelink}>重新連結</Button><Button small onClick={p.onChange}>更換資料夾</Button>{p.pending > 0 && <Button small kind="danger" onClick={p.onDiscard}>放棄未存的修改…</Button>}</div>}>
      <b>找不到資料夾{q(p.name)}</b>
      <div>可能被刪除、改名或移到別處了。{p.pending > 0 ? <><b>有 {p.pending} 項修改還沒存進去</b>，仍暫存在這個分頁，請先不要關閉頁面。</> : '目前沒有未存的修改。'}</div>
      {p.onSettings && <div class="small"><button type="button" class="linkbtn" onClick={p.onSettings}>前往資料夾設定</button></div>}
      <More title="技術細節">瀏覽器回報：NotFoundError（找不到檔案或資料夾）{p.detail ? `；${p.detail}` : ''}</More>
    </Alert>
  );
}

/** 模擬考列表區的錯誤狀態：讀不到資料夾，所以不顯示「還沒有模擬考」 */
export function FolderListError(p: { onRelink: () => void }) {
  return (
    <div class="empty folder-lost-empty" role="alert">
      <strong>讀不到資料夾，所以無法顯示模擬考</strong>
      <p class="muted">這不代表資料被刪掉了。請先用上面的「重新連結」找回資料夾。</p>
      <div class="row" style="justify-content:center"><Button kind="primary" onClick={p.onRelink}>重新連結</Button></div>
    </div>
  );
}

/** 啟動時「使用上次資料夾」找不到：在初始化頁講清楚原因 */
export function RestoreMissing(p: { name: string; onRelink: () => void; onOther: () => void; busy?: boolean }) {
  return (
    <div class="card stack folder-lost-card" role="alert">
      <h2 style="font-size:20px">找不到上次使用的資料夾</h2>
      <div class="folder-chip" title="上次使用的資料夾">{p.name}</div>
      <p>它可能被刪除、改名或移到別處了。你的資料沒有消失，只是這個網頁找不到它。</p>
      <div class="row">
        <Button kind="primary" disabled={!!p.busy} onClick={p.onRelink}>重新連結（選回原本那個資料夾）</Button>
        <Button disabled={!!p.busy} onClick={p.onOther}>選另一個資料夾</Button>
      </div>
      <p class="small muted">選另一個資料夾＝改用另一份資料，不會帶舊資料過去。</p>
    </div>
  );
}

// ───── 放棄未存的修改（二次確認） ─────

export function DiscardDialog(p: { pending: number; lost: string[]; onBackup: () => void; onConfirm: () => void; onClose: () => void }) {
  const [backup, setBackup] = useState(true);
  return (
    <Modal title="放棄未存的修改？" onClose={p.onClose} actions={<><Button onClick={p.onClose}>取消</Button><Button kind="danger" onClick={() => { if (backup) p.onBackup(); p.onConfirm(); }}>放棄這 {p.pending} 項修改</Button></>}>
      <p><b>會丟掉：</b>{p.lost.length > 0 ? `${p.lost.map((l) => `「${l}」`).join('、')}${p.pending > p.lost.length ? ' 等' : ''}共 ${p.pending} 項` : `這個分頁裡 ${p.pending} 項還沒存進資料夾的修改`}。已經存進資料夾的內容不受影響。</p>
      <p class="small muted" style="margin-top:6px">放棄後會回到「選擇資料夾」畫面，可以重新連結原資料夾，或選另一個資料夾。</p>
      <label class="fileopt"><input type="checkbox" checked={backup} onChange={(e) => setBackup(e.currentTarget.checked)} aria-label="先把暫存內容下載成備份檔" />
        <span><b>先把暫存內容下載成備份檔</b><span class="small muted" style="display:block">存成 1 個檔案放在「下載」，留作備份（建議勾選）。</span></span></label>
    </Modal>
  );
}

// ───── 三個動作的對話 ─────

export function FolderDialog(p: {
  mode: FolderMode; fs: FsRepository; pending: number;
  /** 下載備份檔（內容是目前畫面上的完整資料） */
  onBackup: () => void; onClose: () => void; onDone: (r: SwitchResult) => void;
}) {
  const [pick, setPick] = useState<FolderPick | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [choice, setChoice] = useState<'carry' | 'discard'>('carry');
  const [backup, setBackup] = useState(true);
  const [prog, setProg] = useState<{ done: number; total: number; phase: 'copy' | 'verify' } | null>(null);
  const [moved, setMoved] = useState<{ files: number; to: string } | null>(null);
  const abort = useRef({ aborted: false });
  const oldName = useRef(p.fs.folderName?.() ?? '');
  const title = p.mode === 'relink' ? '重新連結：選回原本的資料夾' : p.mode === 'change' ? '更換資料夾' : '搬到新位置';

  const choose = async () => {
    setErr(''); setBusy(true);
    try {
      const r = await p.fs.pickFolder();
      if (!r) setErr('沒有取得這個資料夾的讀寫授權，資料夾沒有切換。請再選一次並允許讀寫。');
      else { setPick(r); setChoice('carry'); }
    } catch (e) {
      if (!isAbort(e)) setErr('無法開啟這個資料夾，請改選別的資料夾。');
    } finally { setBusy(false); }
  };

  const opts = pick ? changeOptions(pick, p.pending) : 'none';
  const usable = (() => {
    if (!pick || pick.problem) return false;
    if (p.mode === 'relink') return pick.kind === 'app';
    if (p.mode === 'move') return pick.kind === 'empty';
    return true;
  })();

  const confirm = async () => {
    if (!pick || !usable) return;
    setBusy(true); setErr('');
    try {
      if (p.mode === 'move') {
        abort.current = { aborted: false };
        const r = await p.fs.moveTo(pick, (done, total, phase) => setProg({ done, total, phase }), abort.current);
        setMoved({ files: r.files, to: pick.name });
        return;
      }
      // 重新連結：暫存的修改接著存回這份資料；更換：依選項帶到空資料夾，或（備份後）放棄
      const carry = p.mode === 'relink' ? p.pending > 0 : opts === 'carry-or-discard' && choice === 'carry';
      if (!carry && p.pending > 0 && backup && p.mode === 'change') p.onBackup();
      const r = await p.fs.adoptPick(pick, { pending: carry ? 'carry' : 'discard' });
      p.onDone({ carried: r.carried, reload: !r.carried });
    } catch (e) {
      setErr(e instanceof Error ? e.message : '無法使用這個資料夾，沒有切換。');
      setProg(null);
    } finally { setBusy(false); }
  };

  // 搬好了
  if (moved) {
    return (
      <Modal title="搬好了" onClose={() => p.onDone({ carried: false, reload: false })} actions={<Button kind="primary" onClick={() => p.onDone({ carried: false, reload: false })}>完成</Button>}>
        <Alert tone="ok">已改用新資料夾{q(moved.to)}。{moved.files} 個檔案都已逐檔核對一致。</Alert>
        <p style="margin-top:8px">舊資料夾{oldName.current ? q(oldName.current) : ''}<b>沒有被刪除</b>。確認新資料夾沒問題後，可以自己到檔案總管決定要不要刪。</p>
      </Modal>
    );
  }
  // 複製中
  if (p.mode === 'move' && busy && prog) {
    const pct = prog.total ? Math.round((prog.done / prog.total) * 100) : 0;
    return (
      <Modal title="搬到新位置：複製中" onClose={() => undefined} actions={<Button onClick={() => { abort.current.aborted = true; }}>取消（保留原狀）</Button>}>
        <p>{prog.phase === 'copy' ? '已複製' : '已核對'} {prog.done}／{prog.total} 個檔案{prog.phase === 'verify' ? '' : '，之後會逐檔核對'}。<b>請不要關閉頁面。</b></p>
        <div class="progbar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><i style={`width:${pct}%`} /></div>
        <p class="small muted">複製期間舊資料夾不會被改動，也不會被刪除。</p>
      </Modal>
    );
  }

  const confirmLabel = p.mode === 'relink' ? '使用這個資料夾' : p.mode === 'move' ? '開始複製' : '改用這個資料夾';
  return (
    <Modal title={title} onClose={() => !busy && p.onClose()} actions={<>
      <Button disabled={busy} onClick={p.onClose}>取消</Button>
      {pick && <Button disabled={busy} onClick={() => void choose()}>重新選擇</Button>}
      {pick ? <Button kind="primary" disabled={busy || !usable} onClick={() => void confirm()}>{confirmLabel}</Button> : <Button kind="primary" disabled={busy} onClick={() => void choose()}>選擇資料夾</Button>}
    </>}>
      {!pick && <Intro mode={p.mode} />}
      {pick && (
        <>
          <div class="folder-chip" title="你選的資料夾">{pick.name}</div>
          {pick.problem && <Alert tone="danger">這個資料夾看起來是本 App 的資料，但讀不了：{pick.problem}。版本可能比現在這版新，或檔案損壞，不能使用。</Alert>}
          {!pick.problem && p.mode === 'relink' && (pick.kind === 'app'
            ? <><Alert tone="ok">看起來是你的資料。找到 {pick.exams} 場模擬考、學生名單 {pick.rosters} 份，版本相容。</Alert>{p.pending > 0 && <p style="margin-top:8px">使用後，<b>{p.pending} 項暫存的修改</b>會接著存進這個資料夾。</p>}</>
            : <Alert tone="danger">這不像本 App 的資料夾（找不到 settings.json 與 exams 資料夾）。要找回原本那份，請選它搬去或改名後的那個資料夾；要改用空資料夾或別份資料，請用「更換資料夾」。</Alert>)}
          {!pick.problem && p.mode === 'move' && (pick.kind === 'empty'
            ? <p>會把目前這份資料整份複製到這個<b>空的</b>資料夾，逐檔核對一致後才改用它；舊資料夾保留不動、不會被刪。</p>
            : <Alert tone="danger">「搬到新位置」只接受<b>空的</b>資料夾，避免蓋掉任何東西。請先到檔案總管建一個空資料夾再選它。</Alert>)}
          {!pick.problem && p.mode === 'change' && <ChangeReview pick={pick} pending={p.pending} opts={opts} choice={choice} setChoice={setChoice} backup={backup} setBackup={setBackup} />}
        </>
      )}
      {err && <div style="margin-top:8px"><Alert tone="danger">{err}</Alert></div>}
    </Modal>
  );
}

function Intro(p: { mode: FolderMode }) {
  if (p.mode === 'relink') return <p>資料夾被搬走或改名了？請選回它，資料原封不動，之後照常使用。程式會先檢查所選資料夾像不像本 App 的資料夾。</p>;
  if (p.mode === 'move') return <p>請先在檔案總管建一個<b>空的</b>新資料夾（例如在雲端硬碟裡），再按「選擇資料夾」選它。程式會整份複製過去、逐檔核對後才改用，舊資料夾保留不動。</p>;
  return <p>更換＝<b>改用另一份資料</b>。不會把目前的資料帶過去，目前的資料夾也不會被動到；新資料夾是空的就從空白開始。</p>;
}

function ChangeReview(p: { pick: FolderPick; pending: number; opts: ReturnType<typeof changeOptions>; choice: 'carry' | 'discard'; setChoice: (c: 'carry' | 'discard') => void; backup: boolean; setBackup: (b: boolean) => void }) {
  const { pick, pending, opts } = p;
  const kindNote = pick.kind === 'empty'
    ? <p>這個資料夾是空的，會從<b>空白</b>開始，看起來會像「模擬考不見了」。舊資料夾沒有動，隨時可以「重新連結」回去。</p>
    : pick.kind === 'app'
      ? <p><b>另一份資料</b>，有 {pick.exams} 場模擬考。更換＝改用另一份資料，舊資料夾的內容不會被帶過來。</p>
      : <Alert tone="warn">這個資料夾裡已有其他檔案，不是本 App 的資料。仍可使用，程式只會在裡面新增自己的檔案。</Alert>;
  return (
    <>
      {kindNote}
      {pending > 0 && (
        <div class="stack" style="margin-top:10px" role="group" aria-label={`這 ${pending} 項暫存的修改怎麼辦`}>
          <b>這 {pending} 項暫存的修改怎麼辦？</b>
          {opts === 'carry-or-discard' && (
            <label class="fileopt"><input type="radio" name="pend" checked={p.choice === 'carry'} onChange={() => p.setChoice('carry')} />
              <span><b>把暫存的 {pending} 項修改存進新資料夾</b><span class="small muted" style="display:block">放在新資料夾裡，不會寫回舊資料夾。</span></span></label>
          )}
          <label class="fileopt"><input type="radio" name="pend" checked={opts === 'discard-only' || p.choice === 'discard'} onChange={() => p.setChoice('discard')} />
            <span><b>放棄暫存的修改</b><span class="small muted" style="display:block">{opts === 'discard-only' ? '新資料夾已有自己的資料，暫存的修改不能存進去，避免混在一起。已存進舊資料夾的內容不受影響。' : '已存進舊資料夾的內容不受影響。'}</span></span></label>
          {(opts === 'discard-only' || p.choice === 'discard') && (
            <label class="fileopt"><input type="checkbox" checked={p.backup} onChange={(e) => p.setBackup(e.currentTarget.checked)} aria-label="先把暫存內容下載成備份檔" />
              <span><b>先把暫存內容下載成備份檔</b><span class="small muted" style="display:block">存成 1 個檔案放在「下載」，留作備份（建議勾選）。</span></span></label>
          )}
        </div>
      )}
    </>
  );
}

// ───── 資料夾設定頁的「目前資料夾」卡片 ─────

export function FolderCard(p: { name: string; missing: boolean; pending: number; lastSaved?: Date | undefined; exams: number; rosters: number; onRelink: () => void; onChange: () => void; onMove: () => void }) {
  return (
    <div class="card stack folder-card">
      <div class="row sb" style="align-items:center">
        <h2 style="font-size:18px">目前資料夾</h2>
        {p.missing ? <Badge tone="danger">⚠ 找不到</Badge> : <Badge tone="ok">● 正常</Badge>}
      </div>
      <div class="folder-chip" title="目前使用的資料夾">{p.name}</div>
      {p.missing
        ? <Alert tone="danger"><b>找不到這個資料夾。</b>它可能被刪除、改名或移到別處了。瀏覽器只記得資料夾的名稱，看不到完整位置。{p.pending > 0 && <> <b>有 {p.pending} 項修改</b>還留在這個分頁，沒存進資料夾；在處理好之前請不要關閉頁面。</>}</Alert>
        : <dl class="folder-facts"><dt>最後存檔</dt><dd>{p.lastSaved ? `${formatModified(p.lastSaved.toISOString())}（台北）` : '本次開啟後還沒有存檔'}</dd><dt>內容</dt><dd>{p.exams} 場模擬考、學生名單 {p.rosters} 份</dd></dl>}
      <div class="folder-actions">
        <div class="folder-act"><Button kind={p.missing ? 'primary' : 'default'} onClick={p.onRelink}>重新連結</Button><b>找回原本那份。</b><span class="small muted">{p.missing ? '資料夾被搬走或改名了？選回它，資料原封不動，暫存的修改會接著存進去。' : '資料夾被搬走或改名了？選回它，資料原封不動，之後照常使用。'}</span></div>
        <div class="folder-act"><Button onClick={p.onChange}>更換資料夾</Button><b>改用另一份資料。</b><span class="small muted">不會把目前的資料帶過去，目前的資料夾也不會被動到。新資料夾是空的就從空白開始。</span></div>
        <div class="folder-act"><Button disabled={p.missing} onClick={p.onMove}>搬到新位置</Button><b>把目前這份帶到別處。</b><span class="small muted">複製到一個<b>空的</b>資料夾，逐檔核對後改用新的；舊資料夾保留不刪。{p.missing && ' 目前資料夾找不到，沒有東西可以複製：請先「重新連結」。'}</span></div>
      </div>
      <p class="small muted">三種操作都不會刪除任何資料夾。學測、分科、會考共用同一個資料夾。</p>
    </div>
  );
}
