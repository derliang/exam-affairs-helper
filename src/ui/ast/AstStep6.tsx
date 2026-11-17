import { useMemo, useState } from 'preact/hooks';
import type { ExamConfig, LabelPaper } from '../../data';
import { footerText } from '../../export/model';
import { renderPrintHtml } from '../../export/htmlRender';
import { safeName, type ExportFormat, type OutputFile } from '../../export/plan';
import type { FontData } from '../../export/docxRender';
import { roomsOverLabel } from '../rooms';
import { Alert, Badge, Button, FormatButton, Seg, StepHead } from '../components';
import { AST_STEP_BLURBS } from '../nav';
import { examEntries } from '../seating';
import type { Doc } from '../store';
import { download, downloadMany, kb, openPrintPage, wordNoticeText } from '../pages/Step6';
import { phaseOf } from '../../core/astD99/release';
import { PhaseCard, VersionCard } from './AstRelease';
import { astPlan, astSnapshotMismatch } from './model';
import { gateOf, reconcile, stampNow } from '../reconcile';
import { ReconcilePanel } from '../pages/ReconcilePanel';
import { AST_OUTPUT_ITEMS, astOutputBlockers, astOutputs, estimatePages, type AstOutputKey, type AstOutputs } from './output';

type Loaded = { fonts: FontData; has: (ch: string) => boolean };
type Tab = 'label' | 'ann' | 'reg' | 'study';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const FILE_LABEL: Record<AstOutputKey, string> = { label: '整合標籤', seat: '綜合教室座位表', ann: '班級公告', use: '每節教室用途表', reg: '每科試務清冊', study: '自習教室名單與布置標籤工作表' };
const pagesOf = (o: AstOutputs, k: AstOutputKey): number => estimatePages(o, k);

/** 把勾選的項目轉成輸出檔（Word 每項一個檔；PDF 合併成一個列印頁） */
export async function runAstExport(o: AstOutputs, keys: AstOutputKey[], format: ExportFormat, paper: LabelPaper, examName: string, fonts: () => Promise<Loaded>, onProgress?: (done: number, total: number, label: string) => void): Promise<OutputFile[]> {
  const meta = { generatedAt: new Date().toISOString(), dataVersion: o.version };
  const base = safeName(examName);
  const chosen = keys.filter((k) => pagesOf(o, k) > 0);
  if (chosen.length === 0) throw new Error('勾選的項目沒有可輸出的頁面');
  if (format === 'pdf') {
    const html = renderPrintHtml({ label: chosen.includes('label') ? o.label : [], seat: chosen.includes('seat') ? o.seat : [], table: chosen.filter((k) => k !== 'label' && k !== 'seat').flatMap((k) => o[k as 'ann' | 'use' | 'reg' | 'study']) }, meta);
    const n = chosen.reduce((a, k) => a + pagesOf(o, k), 0);
    return [{ name: `${base}-分科輸出-列印用頁面.html`, mime: 'text/html', data: html, desc: `${n} 頁（${chosen.map((k) => FILE_LABEL[k]).join('、')}），開啟後選「另存為 PDF」`, pages: n }];
  }
  const env = await fonts();
  const { renderDocx } = await import('../../export/docxRender');
  const opts = { fonts: env.fonts, ...meta };
  const out: OutputFile[] = [];
  for (const [i, k] of chosen.entries()) {
    onProgress?.(i, chosen.length, FILE_LABEL[k]);
    // 每個檔之間讓出主執行緒，畫面才不會整個卡住（大班數時每個檔要數秒）
    await new Promise<void>((r) => setTimeout(r, 0));
    const data = await renderDocx(k === 'label' ? { label: o.label } : k === 'seat' ? { seat: o.seat } : { table: o[k] }, opts);
    out.push({ name: `${base}-${FILE_LABEL[k]}${k === 'label' ? `（${paper}）` : ''}.docx`, mime: DOCX_MIME, data, desc: k === 'label' ? `${o.label.length} 張紙（每張標籤兩格寬，${paper}）` : `${pagesOf(o, k)} 頁（A4）`, pages: pagesOf(o, k) });
  }
  return out;
}

/** ⑥ 分科下載（DESIGN 10.19、D101；AST-2）：五份輸出共用同一份方案，頁尾同一個版本碼；預覽用與下載相同的頁面模型 */
export function AstStep6(p: { doc: Doc; exam: ExamConfig; onGoStep: (n: 2 | 3 | 5) => void; onChange?: (d: Doc) => void; onExams?: () => void; loadFonts?: () => Promise<Loaded> }) {
  const { doc, exam } = p;
  const [format, setFormat] = useState<ExportFormat>('word');
  const [paper, setPaper] = useState<LabelPaper>('B4');
  const [on, setOn] = useState<Record<AstOutputKey, boolean>>({ label: true, seat: true, ann: true, use: true, reg: true, study: true });
  const [withRef, setWithRef] = useState(true); // G36：含自習參考座位頁（預設勾）
  const [tab, setTab] = useState<Tab>('label');
  const [pi, setPi] = useState(0);
  const [busy, setBusy] = useState(false);
  /** 產生進度（#270：真實資料約 150 人、多檔時要一分多鐘，每個檔的字型嵌入與壓縮最花時間） */
  const [prog, setProg] = useState('');
  const [err, setErr] = useState('');
  const [results, setResults] = useState<OutputFile[] | null>(null);
  const hasList = examEntries(doc, exam).length > 0;
  const plan = useMemo(() => astPlan(doc, exam), [doc, exam]);
  const blockers = astOutputBlockers(plan, hasList, astSnapshotMismatch(exam, plan));
  const built = useMemo((): { ok: true; o: AstOutputs } | { ok: false; error: string } | undefined => {
    if (!plan || blockers.length > 0) return undefined;
    try { return { ok: true, o: astOutputs(doc, exam, plan, paper, withRef) }; } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  }, [doc, exam, plan, paper, withRef, blockers.length]);
  const outs = built?.ok ? built.o : undefined;
  const loader = p.loadFonts ?? (async () => (await import('../../export/fontLoader')).loadFonts());
  const planning = phaseOf(exam) === 'planning';
  const keys = AST_OUTPUT_ITEMS.map((i) => i.key).filter((k) => on[k]);
  const hasExamNo = examEntries(doc, exam).some((e) => e.examNo);

  const go = async (format: ExportFormat) => {
    if (!outs) return;
    setFormat(format);
    setBusy(true); setErr(''); setProg('');
    try {
      const res = await runAstExport(outs, keys, format, paper, exam.name, loader, (i, n, l) => setProg(`第 ${i + 1}／${n} 個檔：${l}`));
      for (const f of res.filter((x) => x.mime === 'text/html')) { if (!openPrintPage(f)) throw new Error('瀏覽器擋住了新視窗，請允許本網站開啟彈出視窗後再按一次。'); }
      await downloadMany(res.filter((x) => x.mime !== 'text/html'));
      setResults(res);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); setProg(''); }
  };

  // 預覽：標籤＝某間考場的一張紙；其他＝某一頁
  const pages = outs ? (tab === 'label' ? outs.label : tab === 'ann' ? outs.ann : tab === 'reg' ? outs.reg : outs.study) : [];
  const idx = Math.min(pi, Math.max(0, pages.length - 1));
  const pageName = (i: number): string => {
    const pg = pages[i]!;
    return pg.kind === 'label' ? pg.roomName.replace('　整合標籤', '') : tab === 'ann' ? (pg.subtitle ?? '').split('（')[0]! : tab === 'reg' ? `${i + 1}` : `${i + 1}`;
  };
  const html = useMemo(() => {
    if (!outs || !pages[idx]) return '';
    const meta = { generatedAt: new Date().toISOString(), dataVersion: outs.version, extraCss: `html{background:#e9ecf1;zoom:${tab === 'label' ? (paper === 'A3' ? 0.38 : 0.45) : 0.5}}body{margin:0;padding:8px}.sheet{box-sizing:border-box;margin:0 auto 8px!important;box-shadow:0 1px 4px #0003}` };
    const pg = pages[idx]!;
    return pg.kind === 'label' ? renderPrintHtml({ label: [pg] }, meta) : renderPrintHtml({ table: [pg as Extract<typeof pg, { kind: 'table' }>] }, meta);
  }, [outs, tab, idx, paper]);
  const tabs: { value: Tab; label: string }[] = [{ value: 'label', label: '標籤' }, { value: 'ann', label: '班級公告' }, { value: 'reg', label: '試務清冊' }, { value: 'study', label: '自習名單' }];
  const nFiles = keys.filter((k) => outs && pagesOf(outs, k) > 0).length;
  // G35 考前對帳：進入第 6 步與資料變動後自動重算，另有「重新對帳」；紅燈擋下載、琥珀須逐項確認
  const [recheck, setRecheck] = useState(0);
  const [ack, setAck] = useState('');
  const rec = useMemo(() => reconcile(doc, exam, outs), [doc, exam, outs, recheck]);
  const at = useMemo(() => stampNow(), [rec]);
  const gate = gateOf(rec, ack);
  const noDl = !outs || planning || keys.length === 0 || gate.why !== '';
  const noDlWhy = gate.why && outs && !planning && keys.length > 0 ? gate.why : !outs ? '還不能下載，請先處理上方的問題。' : planning ? '規劃中只能預覽，請先確認定案。' : '尚未勾選任何下載內容，請先在上方勾選。';
  const overRooms = roomsOverLabel(exam.classroomIds.map((id) => doc.settings.classrooms.find((c) => c.id === id)).filter((c): c is NonNullable<typeof c> => !!c));
  const total = keys.reduce((a, k) => a + (outs ? pagesOf(outs, k) : 0), 0);

  return (
    <section class="stack">
      <StepHead title="⑥ 下載" blurb={AST_STEP_BLURBS[5]} />
      <ReconcilePanel r={rec} gate={gate} acked={gate.warns.length > 0 && ack === gate.fingerprint} at={at} busy={busy} onRecheck={() => setRecheck((n) => n + 1)} onGo={(n) => p.onGoStep(n)} onConfirmDownload={(fp, fmt) => { setAck(fp); void go(fmt); }} />
      {blockers.map((b) => (
        <Alert key={b.text} tone="danger" action={<Button small kind="primary" onClick={() => p.onGoStep(b.step)}>{b.step === 2 ? '去 ② 考試名單' : b.step === 3 ? '去 ③ 教室' : '去 ⑤ 看方案'}</Button>}><b>還不能下載：</b>{b.text}</Alert>
      ))}
      {built && !built.ok && <Alert tone="danger"><b>這份方案的標籤排不出來</b>：{built.error}。請回 ③ 調整教室的橫排或深位。</Alert>}
      {p.onChange && !exam.archived && <PhaseCard doc={doc} exam={exam} onChange={p.onChange} />}
      {outs && planning && <Alert tone="warn"><b>規劃中：只能預覽，不能下載正式檔。</b>標籤與班級公告要用同一版，所以要先在上面「目前階段」按「確認定案」，才能下載。五份輸出共用同一份方案，頁尾印同一個版本碼 <Badge>{outs.version}</Badge>。</Alert>}
      {outs && !planning && <Alert tone="ok"><b>方案通過驗證，可以下載。</b>五份輸出共用同一份方案，頁尾印同一個版本碼 <Badge>{outs.version}</Badge>，標籤與班級公告不會混用不同版本。</Alert>}

      <div class="card stack">
        <div><h3>下載內容</h3><p class="small muted">每一類合併成一個多頁檔案。座位一律寫「排－深位」；標籤與清冊不印鐘點，也不排監考人力。{hasExamNo ? '名單有匯入應試編號，標籤、公告與清冊都會印。' : '名單沒有匯入應試編號，所以不印這一欄。'}</p></div>
        <label class="check" style="align-items:flex-start">
          <input type="checkbox" checked={withRef} onChange={(e) => { setWithRef(e.currentTarget.checked); setResults(null); }} />
          <span><b>含自習參考座位頁</b><br /><span class="small muted">不考的人（自習）也排參考座位，放在座位表檔案最後；只供檢核座位夠不夠、可照坐，不印標籤。取消則不出這些頁。</span></span>
        </label>
        <div class="stack">
          {AST_OUTPUT_ITEMS.map((i) => (
            <label key={i.key} class="check" style="align-items:flex-start">
              <input type="checkbox" checked={on[i.key]} onChange={(e) => { setOn((m) => ({ ...m, [i.key]: e.currentTarget.checked })); setResults(null); }} />
              <span><b>{i.title}</b><br /><span class="small muted">{i.sub}{outs ? `（${pagesOf(outs, i.key)} 頁）` : ''}</span></span>
            </label>
          ))}
          <div class="field" style="margin-left:30px">
            <span class="label">標籤紙張（只有標籤可選；其他固定 A4）</span>
            <div class="row"><Seg<LabelPaper> label="標籤紙張" value={paper} onChange={(v) => { setPaper(v); setResults(null); }} options={[{ value: 'B4', label: 'B4（一般，7×7）' }, { value: 'A3', label: 'A3（大尺寸，7×7）' }]} /></div>
          </div>
        </div>
        <div class="dlbtns row" style="align-items:flex-start;gap:24px;flex-wrap:wrap">
          <div class="stack" style="gap:6px">
            <FormatButton kind="word" disabled={noDl || busy} onClick={() => go('word')}>{busy ? `產生中（${prog || '準備中'}）…` : '下載 Word'}</FormatButton>
            <span class="small muted">{noDl ? noDlWhy : `將下載 ${nFiles} 個 Word 檔案，共 ${total} 頁`}</span>
          </div>
          <div class="stack" style="gap:6px">
            <FormatButton kind="pdf" disabled={noDl || busy} onClick={() => go('pdf')}>下載 PDF（開啟列印頁）</FormatButton>
            <span class="small muted">{noDl ? noDlWhy : `將開啟 1 個列印頁（共 ${total} 頁），在新視窗選「列印」→「另存為 PDF」`}</span>
          </div>
        </div>
        {overRooms.length > 0 && keys.includes('label') && <Alert tone="warn">{overRooms.map((r) => r.name).join('、')} 超過 7×7，標籤無法對應，這些教室不會輸出整合標籤；請回 ③ 縮小座位。</Alert>}
        {busy && format === 'word' && <p class="small muted" role="status">每個 Word 檔都要嵌入字型，資料多時整批可能要一到兩分鐘，請不要關閉或重新整理此頁。</p>}
        {err && <Alert tone="danger">{err}</Alert>}
        {results && (
          <div class="psec">
            <Alert tone="ok"><b>{format === 'word' ? '下載已送出' : '已開啟列印用頁面'}</b>{format === 'word' ? wordNoticeText(results.length) : '，請在新視窗選「列印」→ 目的地選「另存為 PDF」。'}</Alert>
            <div style="overflow-x:auto"><table class="t compact"><thead><tr><th>檔案</th><th>內容</th><th>大小</th>{format === 'word' && <th></th>}</tr></thead>
              <tbody>{results.map((f) => <tr key={f.name}><td><b>{f.name}</b></td><td class="muted">{f.desc}</td><td>{kb(typeof f.data === 'string' ? f.data.length : f.data.byteLength)}</td>{format === 'word' && <td><Button small onClick={() => download(f)}>再下載</Button></td>}</tr>)}</tbody></table></div>
            <p class="small muted">本次版本碼：<Badge>{outs?.version ?? ''}</Badge>（頁尾相同，產生時間 {footerText(new Date().toISOString(), outs?.version ?? '').split('　')[0]}）</p>
            {format === 'word' && <Alert tone="warn">修改 Word 文件後，請自行重新核對；系統不會驗證改後內容。</Alert>}
            {p.onExams && <div><Button kind="primary" onClick={p.onExams}>回模擬考列表</Button></div>}
          </div>
        )}
      </div>

      {outs && (
        <div class="card stack">
          <div class="row" style="justify-content:space-between">
            <div><h3>預覽</h3><p class="small muted">與下載用同一份頁面；{tab === 'label' ? `標籤：每張 2 格寬（格＝紙寬÷7、紙高÷7），這頁共 ${(pages[idx] as { cells?: unknown[] } | undefined)?.cells?.length ?? 0} 張；一頁橫向最多 3 張、縱向最多 7 張，排數超過 3 的考場會分成多張紙。` : `共 ${pages.length} 頁。`}</p></div>
            <Seg<Tab> label="預覽哪一份" value={tab} onChange={(v) => { setTab(v); setPi(0); }} options={tabs} />
          </div>
          {pages.length > 1 && <div class="row" style="flex-wrap:wrap"><Seg<string> label="預覽頁" value={String(idx)} onChange={(v) => setPi(Number(v))} options={pages.map((_, i) => ({ value: String(i), label: pageName(i) }))} /></div>}
          {html
            ? <iframe class="pvframe" title="下載預覽" sandbox="" srcdoc={html} style={`width:100%;height:${tab === 'label' ? 660 : 620}px;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--sunken)`} />
            : <Alert tone="info">這一份沒有內容：{tab === 'study' ? '所有考生都留在原班自習，不用布置自習教室。' : '沒有可預覽的頁面。'}</Alert>}
        </div>
      )}
      {p.onChange && !exam.archived && <VersionCard doc={doc} exam={exam} onChange={p.onChange} />}
    </section>
  );
}
