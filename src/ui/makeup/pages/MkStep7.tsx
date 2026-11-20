/**
 * S-8 ⑦ 下載：七項產出（Word／PDF），沿用 G15 的兩顆並排按鈕。
 * 閘門（D120、D153）：紅燈（含算不出來）擋下載，按鈕停用，上方寫「為什麼不能」「怎麼修」並給直接去修的按鈕；琥珀只提示；
 * 下載時由程式回讀自己的輸出並與排程交叉驗算（C-14），回讀不符就不交付、不下載。
 */
import { useState } from 'preact/hooks';
import { Alert, Badge, Button, EmptyState, FormatButton, Seg, Switch } from '../../components';
import { MAKEUP_DOC_KINDS, type MakeupDocKind } from '../../../export/makeupFiles';
import type { OutputFile } from '../../../export/plan';
import { stampNow } from '../../reconcile';
import { download, noticeOf, openPrintPage } from '../../pages/Step6';
import { dashboardOf, runOf, setRun, type RunRecord } from '../dashboard';
import { baseOf, makeupInputOf, produceFiles } from '../pipeline';
import type { MakeupSession } from '../session';
import type { MakeupStepNo } from '../steps';
import { GateBanner } from './MkDashParts';

const KIND_TEXT: Record<MakeupDocKind, { name: string; desc: string }> = {
  'O-1': { name: 'O-1 人數統計與備卷清單', desc: '各年級各科人數，各卷在哪個時段、哪些教室、各幾份；另行通知科目人數' },
  'O-2': { name: 'O-2 考程表', desc: 'A4 橫式；時段、科目、人數、教室、離場時間、監考老師空欄' },
  'O-3': { name: 'O-3 班級公告', desc: '每班一頁；公告版只印學號、不印姓名；用舊班舊號' },
  'O-3t': { name: 'O-3 班級公告（導師存參版）', desc: '學號換成姓名，行數與公告版相同，給導師存參' },
  'O-4': { name: 'O-4 補考點名單', desc: '每考場每節一張；多科生一人一列列出全部科目；表尾各科統計' },
  'O-5': { name: 'O-5 座位表（參考）', desc: '依班級座號、座標「排－深位」，供檢核用，現場自由入座' },
  'O-7': { name: 'O-7 公假名單', desc: '給學務處：補考學生名單與日期（欄位格式暫定）' },
};

type Sel = Record<MakeupDocKind, boolean>;
const allOn = (): Sel => Object.fromEntries(MAKEUP_DOC_KINDS.map((k) => [k, true])) as Sel;

export function MkStep7(p: { s: MakeupSession; onStep: (n: MakeupStepNo) => void; /** 下載並回讀後，把對帳快照記進場次 */ onChange?: (s: MakeupSession) => void; /** 測試用：換掉字型載入 */ loadFonts?: () => Promise<{ fonts: Parameters<typeof produceFiles>[1]['fonts'] }>; /** 測試用：換掉實際下載動作 */ deliver?: (files: OutputFile[]) => void }) {
  const { s } = p;
  const [sel, setSel] = useState<Sel>(allOn());
  const [dayId, setDayId] = useState('all');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const [, bump] = useState(0);
  const d = dashboardOf(s);
  const b = baseOf(s);
  const kinds = MAKEUP_DOC_KINDS.filter((k) => sel[k]);
  const days = b.settings.days;
  const blocked = d.state === 'none' || d.state === 'blocked';
  const why = d.state === 'none' ? '還沒有補考名單。' : blocked ? `有 ${d.gate.blockers.length} 項不通過，須先修正：${d.gate.reasons.join('；')}` : kinds.length === 0 ? '還沒勾選要下載的文件。' : '';
  const run = runOf(s.id);

  const finish = (words: OutputFile[], pages: OutputFile[]) => {
    if (p.deliver) { p.deliver([...words, ...pages]); return; }
    for (const f of pages) if (!openPrintPage(f)) throw new Error('瀏覽器擋住了新視窗，請允許本網站開啟彈出視窗後再按一次。');
    words.forEach((f, i) => setTimeout(() => download(f), i * 600));
  };

  const goWord = async () => {
    setBusy(true); setErr(''); setProblems([]); setNotice('');
    try {
      const env = p.loadFonts ? await p.loadFonts() : await (await import('../../../export/fontLoader')).loadFonts();
      const at = stampNow();
      const out = await produceFiles(s, { fonts: env.fonts, generatedAt: new Date().toISOString(), kinds, ...(dayId !== 'all' ? { dayId } : {}) });
      const probs = out.verification.flatMap((v) => v.problems.map((x) => `${v.file}：${x}`));
      if (dayId === 'all') {
        const rec: RunRecord = { version: out.version, readback: out.readback, produced: out.produced, ok: out.ok, at, problems: probs, fileNames: out.files.map((f) => f.name) };
        setRun(s.id, rec);
        p.onChange?.(s);
      }
      if (!out.ok) { setProblems(probs); bump((n) => n + 1); return; }
      const files: OutputFile[] = out.files.map((f) => ({ name: f.name, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', data: f.docx, desc: KIND_TEXT[f.kind].name, pages: 0 }));
      finish(files, []);
      setNotice(noticeOf(files));
      bump((n) => n + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const goPdf = async () => {
    setBusy(true); setErr(''); setProblems([]); setNotice('');
    try {
      const { produceMakeupPrintHtml } = await import('../../../export/makeupFiles');
      const input = makeupInputOf(s);
      const pages: OutputFile[] = [];
      const probs: string[] = [];
      for (const k of kinds) {
        const r = produceMakeupPrintHtml(input, k, { generatedAt: new Date().toISOString(), ...(dayId !== 'all' ? { dayId } : {}) });
        if (!r) continue;
        probs.push(...r.verification.problems.map((x) => `${r.name}：${x}`));
        pages.push({ name: r.name, mime: 'text/html', data: r.html, desc: KIND_TEXT[k].name, pages: 0 });
      }
      if (probs.length > 0) { setProblems(probs); return; }
      finish([], pages);
      setNotice(noticeOf(pages));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  return (
    <section class="stack">
      <div class="card stephead"><div><h2>⑦ 下載</h2><p class="small muted">七項產出；下載前必須通過檢核與對帳，下載時程式會回讀自己的輸出再驗算一次。</p></div></div>
      <GateBanner d={d} onStep={p.onStep} />
      {d.stale && <Alert tone="warn"><Badge tone="warn">過期</Badge> 名單或設定在上次下載（{run?.at}）之後改過，已下載的檔案是舊版，請重新下載。</Alert>}
      {problems.length > 0 && !d.stale && (
        <Alert tone="danger"><b>檔案回讀驗算不符，已停止、沒有交付：</b>
          <ul class="plain">{problems.map((x) => <li key={x}>{x}</li>)}</ul>
        </Alert>
      )}
      {err && <Alert tone="danger">{err}</Alert>}
      {d.state === 'none' ? (
        <EmptyState title="還沒有可下載的內容" action={<Button kind="primary" onClick={() => p.onStep(2)}>到 ② 匯入名單 ›</Button>}>匯入名單並通過檢核後，才能下載。</EmptyState>
      ) : (
        <div class="card stack">
          <div class="lab">要下載的文件</div>
          {days.length > 1 && (
            <Seg<string> label="下載範圍" value={dayId} onChange={setDayId} options={[{ value: 'all', label: '全部考日' }, ...days.map((x) => ({ value: x.id, label: x.label }))]} />
          )}
          <div class="stack">
            {MAKEUP_DOC_KINDS.map((k) => (
              <div key={k} class="row sb">
                <div><b>{KIND_TEXT[k].name}</b><br /><span class="small muted">{KIND_TEXT[k].desc}</span></div>
                <Switch label="下載" ariaLabel={`下載 ${KIND_TEXT[k].name}`} checked={sel[k]} onChange={(v) => setSel({ ...sel, [k]: v })} onText="要下載" offText="不下載" />
              </div>
            ))}
          </div>
          <p class="small muted">O-6 座位標籤為選配，這一版尚未提供。檔案以 Word 為主、PDF 為輔（PDF 會開啟列印頁，請用瀏覽器「另存為 PDF」）。</p>
          <div class="row">
            <FormatButton kind="word" disabled={busy || why !== ''} onClick={() => { void goWord(); }}>下載 Word</FormatButton>
            <FormatButton kind="pdf" disabled={busy || why !== ''} onClick={() => { void goPdf(); }}>下載 PDF（開啟列印頁）</FormatButton>
          </div>
          {why !== '' && <p class="small" role="status" data-why>{blocked ? '不能下載：' : ''}{why}</p>}
          {busy && <p class="small muted" role="status">正在產生並回讀驗算…</p>}
          {notice && <Alert tone="ok">{notice}</Alert>}
          {run && !d.stale && run.ok && <p class="small muted">已通過回讀驗算（{run.at}，版本碼 {run.version}）。</p>}
        </div>
      )}
    </section>
  );
}
