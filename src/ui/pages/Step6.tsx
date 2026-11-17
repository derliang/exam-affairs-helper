import { useMemo, useState } from 'preact/hooks';
import type { ExamConfig, LabelPaper } from '../../data';
import { buildPickupPages } from '../../export/pickup';
import { buildAttendancePages } from '../../export/attendance';
import { renderPrintHtml } from '../../export/htmlRender';
import { buildLabelPages, buildSeatPages } from '../../export/model';
import { defaultOptions, planFiles, preflight, runExport, type ExportFormat, type ExportOptions, type OutputFile } from '../../export/plan';
import type { FontData } from '../../export/docxRender';
import { Alert, Badge, Button, FormatButton, More, Seg, StepHead } from '../components';
import { enabledExportItems, useIsEnabled } from '../features';
import { prepareExport, relevantIssues, unappliedDiffsOf, unresolvedDiffsOf } from '../exportInput';
import { afterExport } from '../flow';
import { labelSplitNote, roomsOverLabel } from '../rooms';
import type { Doc } from '../store';
import { isStale, validationChecks } from '../seating';
import { defaultLabelLayout } from '../../export/model';
import { gateOf, reconcile, stampNow } from '../reconcile';
import { ReconcilePanel } from './ReconcilePanel';

type Loaded = { fonts: FontData; has: (ch: string) => boolean };

/** 瀏覽器下載一個檔案（存到瀏覽器的下載資料夾） */
export function download(f: OutputFile): void {
  const blob = new Blob([f.data as BlobPart], { type: f.mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = f.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** 多檔下載：Chrome 會擋短時間內連續觸發的下載，所以逐檔間隔一下；實際有沒有存下來程式無從得知（#203） */
export async function downloadMany(files: OutputFile[], gapMs = 600): Promise<void> {
  for (let i = 0; i < files.length; i++) {
    if (i > 0 && gapMs > 0) await new Promise((r) => setTimeout(r, gapMs));
    download(files[i]!);
  }
}

/** 下載後的提示文字：只說「已送出」，不宣稱檔案已存好（#203） */
export function wordNoticeText(n: number): string {
  return n > 1
    ? `已送出 ${n} 個下載要求。瀏覽器可能會詢問「是否允許下載多個檔案」，請按「允許」，再到下載資料夾確認 ${n} 個檔案都在；缺的檔可在下表按該檔的「再下載」。`
    : '已送出 1 個下載要求，請到瀏覽器的下載資料夾確認。';
}

/** PDF：開新視窗顯示列印用頁面，使用者選「另存為 PDF」（D29，不直接列印 D69） */
export function openPrintPage(f: OutputFile): boolean {
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.open();
  w.document.write(f.data as string);
  w.document.close();
  return true;
}

type PreviewKind = 'label' | 'seat' | 'pickup' | 'attendance';

/** 預覽卡（原型 vS6）：用與匯出相同的版面模型，當場產生單一教室的標籤紙／座位表／領卷清單 */
function PreviewCard(p: { prepared: Extract<ReturnType<typeof prepareExport>, { ok: true }>; paper: LabelPaper; pickupOn: boolean; attendanceOn: boolean }) {
  const [kind, setKind] = useState<PreviewKind>('label');
  const [ri, setRi] = useState(0);
  const { input } = p.prepared;
  const rooms = input.exam.classroomIds
    .map((id) => input.settings.classrooms.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => !!c)
    .sort((a, b) => Number(a.kind === 'reserve') - Number(b.kind === 'reserve'));
  const idx = Math.min(ri, Math.max(0, rooms.length - 1));
  const room = rooms[idx];
  const html = useMemo(() => {
    if (!room) return '';
    try {
    const withPaper = { ...input, exam: { ...input.exam, labelLayout: defaultLabelLayout(p.paper) } };
    const meta = { generatedAt: input.result.generatedAt, dataVersion: input.result.dataVersion, extraCss: `html{background:#e9ecf1;zoom:${kind === 'label' ? (p.paper === 'A3' ? 0.38 : 0.45) : 0.5}}body{margin:0;padding:8px}.sheet{width:${kind === 'label' ? (p.paper === 'A3' ? 297 : 250) : 210}mm;box-sizing:border-box;margin:0 auto 8px!important;box-shadow:0 1px 4px #0003}` };
    if (kind === 'label') { const pgs = buildLabelPages(withPaper, 'all').filter((x) => x.roomName === room.name || x.roomName.startsWith(`${room.name}（第`) || x.roomName.startsWith(`${room.name}　抽離考試`)); return pgs.length ? renderPrintHtml({ label: pgs }, meta) : ''; }
    if (kind === 'seat') { const pg = buildSeatPages(withPaper, 'all').find((x) => x.roomName === room.name); return pg ? renderPrintHtml({ seat: [pg] }, meta) : ''; }
    if (kind === 'attendance') { const pg = buildAttendancePages(withPaper).find((t) => t.subtitle?.startsWith(room.name)); return pg ? renderPrintHtml({ table: [pg] }, meta) : ''; }
    const pg = room.kind === 'reserve' ? undefined : buildPickupPages(withPaper).find((t) => t.subtitle?.startsWith(room.name));
    return pg ? renderPrintHtml({ table: [pg] }, meta) : '';
    } catch (e) {
      // #147：排版失敗（例如座位超出標籤格數）不能讓整頁空白，改回傳說明
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [input, kind, idx, p.paper, room]);
  const kinds: { value: PreviewKind; label: string }[] = [{ value: 'label', label: '標籤' }, { value: 'seat', label: '座位表' }, ...(p.pickupOn ? [{ value: 'pickup' as const, label: '領卷清單' }] : []), ...(p.attendanceOn ? [{ value: 'attendance' as const, label: '出缺席記錄表' }] : [])];
  const cap = kind === 'label'
    ? `${p.paper === 'A3' ? 'A3（297×420 mm）・每格約 42.4×60.0 mm' : 'B4（250×353 mm）・每格約 35.7×50.4 mm'}・每格＝紙寬÷7、紙高÷7，格子排列與該教室座位表的排×深位一致，沒有座位或沒有考生的位置不印格子。`
    : kind === 'seat' ? 'A4 座位表，每頁附該教室的考生統計；實際檔案每間教室一頁。' : kind === 'attendance' ? 'A4 出缺席記錄表，每間教室至少一頁（人多接下一頁），照座位順序，留各科打勾欄。' : 'A4 領卷清單，每間教室一頁，列出每科試卷與答案卡份數。';
  return (
    <div class="card stack" style="margin-top:12px">
      <div class="row" style="justify-content:space-between">
        <div><h3>預覽</h3><p class="small muted">{room ? room.name : '沒有教室'}</p></div>
        <div class="row"><Seg<PreviewKind> label="預覽類型" value={kind} onChange={setKind} options={kinds} /></div>
      </div>
      {rooms.length > 1 && (
        <div class="row"><Seg<string> label="預覽教室" value={String(idx)} onChange={(v) => setRi(Number(v))} options={rooms.map((r, i) => ({ value: String(i), label: r.kind === 'reserve' ? `${r.name}（預備）` : r.name }))} /></div>
      )}
      {kind === 'label' && room && labelSplitNote(room, p.paper) && <Alert tone="info">{labelSplitNote(room, p.paper)}</Alert>}
      {typeof html === 'object'
        ? <Alert tone="danger"><b>這間教室的預覽排不出來</b>：{html.error}。請回 ③ 調整教室的座位。</Alert>
        : html
        ? <iframe class="pvframe" title="下載預覽" sandbox="" srcdoc={html} style={`width:100%;height:${kind === 'label' ? 660 : 620}px;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--sunken)`} />
        : <Alert tone="info">{room?.kind === 'reserve' ? '這間預備教室沒有加考的人：抽離自習不排座位、不印標籤，只出名單。' : '這間教室沒有可預覽的內容。'}</Alert>}
      <p class="small muted">{cap}</p>
    </div>
  );
}

/** 兩顆下載鈕（Word、PDF）停用的原因（G15）；可以下載回空字串 */
export function downloadGate(o: { stale: boolean; blocked: boolean; nothing: boolean }): string {
  return o.stale ? '排座已過期，請先重新排座。' : o.nothing ? '尚未勾選任何下載內容，請先在上方勾選。' : o.blocked ? '上方還有必須處理的問題，處理後才能下載。' : '';
}

export const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** ⑥ 匯出（DESIGN 10.4、D29、D57、D69）：Word 為主、PDF 為輔；每類合併成一個多頁檔 */
export function Step6(p: {
  doc: Doc;
  exam: ExamConfig;
  /** 排座結果過期（⑤ 提供；目前匯出頁即時排座，未提供視為 false） */
  stale?: boolean;
  /** 考試名單差異未處理數（② 提供） */
  unresolvedDiffs?: number;
  unappliedDiffs?: number;
  onGoStep: (n: 2 | 3 | 5) => void;
  /** 完成後「回模擬考列表」 */
  onExams?: () => void;
  /** 測試或預覽可注入字型載入；預設延遲載入真實字型 */
  loadFonts?: () => Promise<Loaded>;
}) {
  const { exam } = p;
  const [oRaw, setO] = useState<ExportOptions>(() => defaultOptions(exam.labelLayout.paper));
  const prepared = useMemo(() => prepareExport(p.doc, exam), [p.doc, exam]);
  // G34（稿 v2.43 第 26 題）：抽離自習名單維持獨立檔案、預設不勾（取代 #284 的自動勾選）
  const o: ExportOptions = oRaw;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [extraOn, setExtraOn] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<OutputFile[] | null>(null);
  /** 最近一次下載用的格式（G15：Word、PDF 各一顆按鈕，沒有格式選擇） */
  const [doneFmt, setDoneFmt] = useState<ExportFormat>('word');
  const [fontState, setFontState] = useState<Loaded | null>(null);
  const junior = exam.division === 'junior';
  const pickupOn = useIsEnabled('pickup-list', exam.kind);
  const attendanceOn = useIsEnabled('attendance-sheet', exam.kind);
  const set = (patch: Partial<ExportOptions>) => { setO((x) => ({ ...x, ...patch })); setResults(null); };

  // 選用功能多出的匯出項（D75）：功能關閉時完全不出現
  const extras = enabledExportItems({ settings: p.doc.settings, examKind: exam.kind });
  const chosenExtras = extras.filter((x) => extraOn[x.key]);
  const extraRank = (id: string) => { const i = ['pickup-list', 'attendance-sheet', 'print-alignment'].indexOf(id); return i < 0 ? 99 : i; };
  const orderedExtras = [...extras].sort((a, b) => extraRank(a.featureId) - extraRank(b.featureId));
  const mainNone = !o.seat && !o.label && !o.study;
  const diffs = p.unresolvedDiffs ?? unresolvedDiffsOf(p.doc, exam);
  const unapplied = p.unappliedDiffs ?? unappliedDiffsOf(p.doc, exam);
  // 校-64：名單或設定在排座後改過＝過期；⑤ 沒傳進來就自己算（排座簽章＝result.dataVersion，舊資料沒有簽章視為未過期）
  const stale = p.stale ?? isStale(p.doc, exam);
  const shownErrors = prepared.ok ? [] : prepared.errors.filter((e) => !(stale && e.startsWith('排座已過期')));
  const loader = p.loadFonts ?? (async () => (await import('../../export/fontLoader')).loadFonts());

  // 字集檢查要字型字集；先用「全部通過」，載入後再重算（使用者按匯出前就會載入）
  const has = fontState?.has ?? (() => true);
  // 「至少選一項」：核心項目全不選但有勾選用文件時算有選；畫面與按下去用同一條件
  const relevant = (list: ReturnType<typeof preflight>) => relevantIssues(list, mainNone, chosenExtras.length);
  const issues = relevant(prepared.ok ? preflight(prepared.input, o, { stale, unresolvedDiffs: diffs, unappliedDiffs: unapplied }, has) : []);
  const blocked = !prepared.ok || issues.some((i) => i.level === 'block');
  const overRooms = roomsOverLabel(exam.classroomIds.map((id) => p.doc.settings.classrooms.find((c) => c.id === id)).filter((c): c is NonNullable<typeof c> => !!c));
  const files = prepared.ok && !blocked && !mainNone ? planFiles(prepared.input, o) : [];

  // G35 考前對帳：進入第 6 步與資料變動後自動重算（useMemo 依 doc、exam），另有「重新對帳」；紅燈擋下載、琥珀須逐項確認
  const [recheck, setRecheck] = useState(0);
  const [ack, setAck] = useState('');
  const rec = useMemo(() => reconcile(p.doc, exam), [p.doc, exam, recheck]);
  const at = useMemo(() => stampNow(), [rec]);
  const gate = gateOf(rec, ack);
  const noDlWhy = downloadGate({ stale, blocked, nothing: chosenExtras.length === 0 && (mainNone || (!blocked && files.length === 0)) }) || gate.why;
  const noDl = noDlWhy !== '';
  const go = async (fmt: ExportFormat) => {
    if (!prepared.ok) return;
    const oo: ExportOptions = { ...o, format: fmt };
    setBusy(true);
    setErr('');
    try {
      const env = fontState ?? (await loader());
      setFontState(env);
      // 載入字型後字集檢查可能出現新警告：有新的擋下項目就停
      const again = relevant(preflight(prepared.input, oo, { stale, unresolvedDiffs: diffs, unappliedDiffs: unapplied }, env.has));
      const hit = again.filter((i) => i.level === 'block');
      if (hit.length) { setErr(`無法下載：${hit.map((i) => i.text).join('；')}`); return; }
      const out = mainNone ? [] : await runExport(prepared.input, oo, { fonts: env.fonts });
      for (const x of chosenExtras) out.push(...(await x.run({ doc: p.doc, exam, format: fmt })));
      for (const f of out.filter((x) => x.mime === 'text/html')) {
        if (!openPrintPage(f)) throw new Error('瀏覽器擋住了新視窗，請允許本網站開啟彈出視窗後再按一次。');
      }
      await downloadMany(out.filter((x) => x.mime !== 'text/html'));
      setDoneFmt(fmt);
      setResults(out);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const ck = (key: 'seat' | 'label' | 'study' | 'reserve', title: string, sub: string) => (
    <label class="check" style="align-items:flex-start">
      <input type="checkbox" checked={o[key]} onChange={(e) => set({ [key]: e.currentTarget.checked } as Partial<ExportOptions>)} />
      <span><b>{title}</b><br /><span class="small muted">{sub}</span></span>
    </label>
  );

  return (
    <section>
      <StepHead title="⑥ 下載">下載座位表、標籤與名單；要列印請開下載的檔案。</StepHead>
      <div style="margin-top:12px"><ReconcilePanel r={rec} gate={gate} acked={gate.warns.length > 0 && ack === gate.fingerprint} at={at} busy={busy} onRecheck={() => setRecheck((n) => n + 1)} onGo={(n) => p.onGoStep(n)} onConfirmDownload={(fp, fmt) => { setAck(fp); void go(fmt); }} /></div>
      {stale && (
        <div class="stale-banner" role="status" style="margin-top:12px">
          <Badge tone="warn">過期</Badge>排座結果過期，下載已停用。
          <Button small kind="primary" onClick={() => p.onGoStep(5)}>重新排座</Button>
        </div>
      )}
      {shownErrors.length > 0 && (
        <div style="margin-top:12px"><Alert tone="danger">
          <b>還不能下載：</b>
          <ul>{shownErrors.map((e) => <li key={e}>{e}</li>)}</ul>
          <div class="row" style="margin-top:8px">
            {shownErrors.some((e) => e.startsWith('缺考試名單')) && <Button small kind="primary" onClick={() => p.onGoStep(2)}>去 ② 匯入考試名單</Button>}
            {shownErrors.some((e) => e.startsWith('缺排座結果') || e.startsWith('排座已過期') || e.startsWith('排座驗證未通過')) && <Button small kind="primary" onClick={() => p.onGoStep(5)}>回 ⑤ 排座</Button>}
            {shownErrors.some((e) => e.startsWith('缺教室')) && <Button small kind="primary" onClick={() => p.onGoStep(3)}>去 ③ 勾選教室</Button>}
          </div>
        </Alert></div>
      )}
      {issues.map((i) => (
        <div key={i.text} style="margin-top:12px">
          <Alert tone={i.level === 'block' ? 'danger' : 'warn'}
            action={i.text.includes('排座') ? <Button small kind="primary" onClick={() => p.onGoStep(5)}>回 ⑤ 排座</Button> : i.text.includes('② ') ? <Button small onClick={() => p.onGoStep(2)}>回 ② 處理</Button> : undefined}>
            {i.text}
          </Alert>
        </div>
      ))}
      {prepared.ok && !blocked && issues.length === 0 && <div style="margin-top:12px"><Alert tone="ok"><b>驗證通過：</b>{prepared.ok ? validationChecks(p.doc, exam, prepared.input.result).length : 0} 項檢查全部符合，可以下載。</Alert></div>}

      <div class="card stack" style="margin-top:12px">
        <div>
          <h3>下載內容</h3>
          <p class="small muted">座位表合併成一個檔案、標籤合併成一個檔案，不是一間教室一個檔。{junior ? '' : '預備教室排在最後、每頁頁首標「預備教室」。'}</p>
          <More title="說明：Word、PDF 與版本碼">Word 方便你編輯，每類下載一個檔；「下載 PDF」是先開啟列印用頁面，再用瀏覽器的列印另存成 PDF，適合確定不再編輯、想避免格式跑掉時使用。要列印時，請開啟下載的 Word 檔（或另存的 PDF）再列印，本程式不直接列印。頁尾印有產生時間與資料版本碼，可事後核對表是否對應現在的名單與設定。</More>
        </div>
        <div class="stack">
          {ck('seat', '座位表（A4）', '合併成一個檔案，每間教室一頁' + (junior ? '' : '（預備教室排在最後）') + '；每頁附該教室的考生統計')}
          {/* 稿 v2.22（校-47）：選用項穿插在核心項之間——座位表、領卷清單、出缺席記錄表、對位測試頁、標籤 */}
          {orderedExtras.map((x) => (
            <label key={x.key} class="check" style="align-items:flex-start">
              <input type="checkbox" checked={!!extraOn[x.key]} onChange={(e) => { setExtraOn((m) => ({ ...m, [x.key]: e.currentTarget.checked })); setResults(null); }} />
              <span><b>{x.title}</b><br /><span class="small muted">{x.sub}</span></span>
            </label>
          ))}
          {ck('label', '標籤', '合併成一個檔案，每間教室一張紙' + (junior ? '' : '（預備教室排在最後）') + '；每格＝紙寬÷7、紙高÷7，白底' + (junior ? '' : '；不考、加考、抽離的標籤用淡黃底'))}
          <div class="field" style="margin-left:30px">
            <span class="label">標籤紙張（只有標籤可選；座位表與名單固定 A4）</span>
            <div class="row"><Seg<LabelPaper> label="標籤紙張" value={o.paper} onChange={(v) => set({ paper: v })} options={[{ value: 'B4', label: 'B4（一般，7×7）' }, { value: 'A3', label: 'A3（大尺寸，7×7）' }]} /></div>
            <span class="hint">每格＝紙寬÷7、紙高÷7（B4 約 35.7×50.4 mm、A3 約 42.4×60.0 mm），格子排列與該教室座位表的排×深位一致；沒有座位或沒有考生的位置不印格子。</span>
            {o.label && overRooms.length > 0 && <Alert tone="warn">{overRooms.map((r) => r.name).join('、')} 超過 7×7，標籤無法對應，這些教室不會輸出標籤；請回 ③ 縮小座位。</Alert>}
          </div>
          {!junior && ck('study', '抽離自習名單（A4）', '合併成一個檔案，每科一頁；只有名單與人數，不出座位表與標籤')}
          {!junior && ck('reserve', '包含預備教室頁', `抽離考試的預備教室座位表（時段版）與標籤，併在上面座位表、標籤檔案的最後，每頁頁首標「預備教室」；預備教室最多 7 排×8 深位，標籤同一頁 7×8（格高隨列數調整）`)}
        </div>
        <div class="dlbtns row" style="align-items:flex-start;gap:24px;flex-wrap:wrap">
          <div class="stack" style="gap:6px">
            <FormatButton kind="word" disabled={noDl || busy} onClick={() => go('word')}>{busy ? '產生中…' : '下載 Word'}</FormatButton>
            <span class="small muted">{noDl ? noDlWhy : `將下載 ${files.length + chosenExtras.length} 個 Word 檔案`}</span>
          </div>
          <div class="stack" style="gap:6px">
            <FormatButton kind="pdf" disabled={noDl || busy} onClick={() => go('pdf')}>下載 PDF（開啟列印頁）</FormatButton>
            <span class="small muted">{noDl ? noDlWhy : `將開啟 ${(files.length ? 1 : 0) + chosenExtras.length} 個列印頁，在新視窗選「列印」→「另存為 PDF」`}</span>
          </div>
        </div>
        {err && <Alert tone="danger">{err}</Alert>}
      {results && (
        <div class="psec">
          <Alert tone="ok">
            <b>{doneFmt === 'word' ? '下載已送出' : '已開啟列印用頁面'}</b>
            {doneFmt === 'word' ? wordNoticeText(results.length) : '，請在新視窗選「列印」→ 目的地選「另存為 PDF」。'}
          </Alert>
          <div style="overflow-x:auto"><table class="t compact">
            <thead><tr><th>檔案</th><th>內容</th><th>大小</th>{doneFmt === 'word' && <th></th>}</tr></thead>
            <tbody>{results.map((f) => (
              <tr key={f.name}><td><b>{f.name}</b></td><td class="muted">{f.desc}</td><td>{kb(typeof f.data === 'string' ? f.data.length : f.data.byteLength)}</td>{doneFmt === 'word' && <td><Button small onClick={() => download(f)}>再下載</Button></td>}</tr>
            ))}</tbody>
          </table></div>
          <p class="small muted">本次文件版本：<Badge>{prepared.ok ? prepared.input.result.dataVersion : ''}</Badge>（頁尾相同）</p>
          {doneFmt === 'word' && <Alert tone="warn">修改 Word 文件後，請自行重新核對；系統不會驗證改後內容。</Alert>}
          <div>
            <h3>接下來該做什麼</h3>
            <ol class="nextlist">
              {afterExport(doneFmt, o.paper).map((i) => (
                <li key={i.text}>{i.text}{' '}
                  {i.step && <Button small onClick={() => p.onGoStep(i.step as 5)}>回 ⑤ 排座</Button>}
                  {i.nav && p.onExams && <Button small kind="primary" onClick={p.onExams}>回模擬考列表</Button>}
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
      </div>

      {prepared.ok && <PreviewCard prepared={prepared} paper={o.paper} pickupOn={pickupOn} attendanceOn={attendanceOn} />}
    </section>
  );
}
