/**
 * S-3 ② 匯入名單：拖放區 → 欄位對應 → 匯入對帳（C-1）→ 問題列逐筆處理（F-10）→ 略過紀錄 → 重複匯入取代／合併（F-11）。
 * 解析與判斷在核心（src/core/makeup/importRows.ts）；這裡只有畫面狀態。檔案只在本機讀取，不上傳。
 */
import { useRef, useState } from 'preact/hooks';
import { Alert, Badge, Button, EmptyState, Modal, More, StatsBar } from '../../components';
import { readXlsx, readFiles, groupByKey, resolveConflicts, xlsxReadErrorText, type ConflictChoice, type FileRead } from '../../../import';
import { ConflictList, FileResults, filesOfDrop, filesOfInput } from '../../pages/FileResults';
import {
  SKIP_REASON_TEXT,
  problemKindText,
  type MakeupColumnMap,
  type MakeupField,
  type MakeupParseResult,
  type MakeupProblem,
  type MakeupRow,
  type SkipReason,
} from '../../../core/makeup';
import { MAPPING_FIELDS, clearResolution, diffImport, isEmptyBook, isRequiredField, mergeImport, mergeImportWith, overlapKeys, overlapRows, parseWithMapping, pickSheets, replaceImport, rowKey, rowWhere, setResolution, type ImportDiff, type SheetPick } from '../importOps';
import { baseOf } from '../pipeline';
import type { MakeupSession } from '../session';

interface Draft { fileName: string; sheets: { name: string; rows: string[][] }[]; picks: SheetPick[]; sel: number; header: number; columns: MakeupColumnMap }
interface Pending { parse: MakeupParseResult; fileName: string; diff: ImportDiff }
/** 多檔匯入（#506、D187）：一批檔案依序過欄位對應；新檔與目前名單同學號同科重疊時逐筆問 */
interface Batch { files: { name: string; sheets: { name: string; rows: string[][] }[] }[]; i: number }
interface MergeAsk { parse: MakeupParseResult; fileName: string; keys: string[] }

const cellOf = (r: string[] | undefined, i: number | undefined): string => (i === undefined ? '' : (r?.[i] ?? '').trim());

export function MkStep2(p: { s: MakeupSession; onChange: (s: MakeupSession) => void; now?: Date }) {
  const { s } = p;
  const b = baseOf(s);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [err, setErr] = useState<{ title: string; text: string } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [fileResults, setFileResults] = useState<FileRead<unknown>[]>([]);
  const [ask, setAsk] = useState<MergeAsk | null>(null);
  const [choices, setChoices] = useState<Record<string, ConflictChoice>>({});
  const now = () => p.now ?? new Date();

  const draftOf = (name: string, sheets: { name: string; rows: string[][] }[]): Draft => {
    const { picks, main } = pickSheets(sheets);
    const pk = picks[main]!;
    return { fileName: name, sheets, picks, sel: main, header: pk.header, columns: pk.columns };
  };
  /** 一次選多個檔案：逐檔讀取，壞檔只影響它自己；讀得進來的依序進欄位對應 */
  const onFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setErr(null);
    const reads = await readFiles(files, async (file) => {
      if (/\.xls$/i.test(file.name)) throw new Error('這是舊版 .xls 檔，請用 Excel 開啟後「另存新檔」成 .xlsx，再匯入。');
      let sheets;
      try { sheets = await readXlsx(await file.arrayBuffer()); } catch (e) {
        throw new Error(xlsxReadErrorText(e));
      }
      if (sheets.length === 0 || isEmptyBook(sheets)) throw new Error('檔案是空的，沒有任何資料列。');
      return sheets;
    });
    setFileResults(reads);
    const good = reads.flatMap((r) => (r.ok ? [{ name: r.name, sheets: r.value }] : []));
    if (good.length === 0) return;
    setBatch({ files: good, i: 0 });
    setDraft(draftOf(good[0]!.name, good[0]!.sheets));
  };
  /** 這一檔處理完：還有下一檔就換下一檔，否則收尾 */
  const nextFile = () => {
    if (batch && batch.i + 1 < batch.files.length) {
      const f = batch.files[batch.i + 1]!;
      setBatch({ ...batch, i: batch.i + 1 });
      setDraft(draftOf(f.name, f.sheets));
      return;
    }
    setDraft(null); setBatch(null); setFileResults([]);
  };
  const abortBatch = () => { setDraft(null); setErr(null); setBatch(null); setFileResults([]); setAsk(null); setChoices({}); setPending(null); };
  /** 合併：沒有重疊就直接併；有重疊（內容相同也算）逐筆問，不靜默略過 */
  const startMerge = (parse: MakeupParseResult, fileName: string) => {
    const keys = overlapKeys(s.parse, parse);
    if (keys.length === 0) { p.onChange(mergeImport(s, parse, fileName, now())); nextFile(); return; }
    setChoices({}); setAsk({ parse, fileName, keys });
  };
  const askRows = ask && s.parse ? overlapRows(s.parse, ask.parse, ask.keys) : [];
  const askGroups = groupByKey([{ file: '目前的名單', items: askRows.map((x) => ({ key: x.key, row: x.cur })) }, { file: ask?.fileName ?? '', items: askRows.map((x) => ({ key: x.key, row: x.nxt })) }], (x) => x.key);
  const askRes = ask ? resolveConflicts(askGroups.unique, askGroups.conflicts, choices) : null;

  const confirmMapping = () => {
    if (!draft) return;
    const pk = draft.picks[draft.sel]!;
    const parse = parseWithMapping(draft.sheets, pk, draft.columns, draft.header);
    if (parse.missing.length > 0) {
      const labels = parse.missing.map((f) => MAPPING_FIELDS.find((m) => m.field === f)?.label ?? f).join('、');
      setErr({ title: `找不到「${labels}」欄`, text: '沒有學號就無法認人、也無法對帳。請確認這是教務系統的「不及格名單」匯出檔，或在下面的欄位對應手動指定。' });
      return;
    }
    setErr(null);
    if (parse.rawCount === 0) { setErr({ title: '檔案是空的', text: '表頭以下沒有任何資料列。' }); return; }
    const scheduled = new Set(b.roster.included.map(rowKey));
    const diff = diffImport(s.parse, parse, scheduled);
    const later = !!batch && batch.i > 0;
    if (diff.hasCurrent && later) { startMerge(parse, draft.fileName); return; }
    if (diff.hasCurrent) { setPending({ parse, fileName: draft.fileName, diff }); return; }
    p.onChange(replaceImport(s, parse, draft.fileName, now()));
    nextFile();
  };

  const apply = (mode: 'replace' | 'merge') => {
    if (!pending) return;
    const { parse, fileName } = pending;
    setPending(null);
    if (mode === 'merge') { startMerge(parse, fileName); return; }
    p.onChange(replaceImport(s, parse, fileName, now()));
    nextFile();
  };
  const applyAsk = () => {
    if (!ask || !askRes?.ready) return;
    const useNew = new Set(askGroups.conflicts.filter((c) => choices[c.key] === 1).map((c) => c.key));
    p.onChange(mergeImportWith(s, ask.parse, ask.fileName, now(), useNew));
    setAsk(null); setChoices({});
    nextFile();
  };

  const r = b.roster;
  const total = r.included.length + r.notified.length + r.skipped.length + r.unresolved.length;
  const balanced = !!s.parse && total === r.rawCount;
  const ok = balanced && r.unresolved.length === 0;

  const picker = (
    <>
      <div class={`dropzone${over ? ' over' : ''}`} tabIndex={0} role="button" aria-label="選擇補考名單檔案"
        onClick={() => input.current?.click()} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click(); } }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void onFiles(filesOfDrop(e)); }}>
        <strong>把教務系統匯出的不及格名單拖到這裡，或選擇檔案（可一次多個）</strong>
        <span class="small">支援 .xlsx；.xls 請先另存為 .xlsx。一人一科一列、班級以舊班舊號為準。</span>
        <span class="small muted">這份檔案只在你的電腦上讀取，不會上傳。</span>
      </div>
      <input ref={input} type="file" accept=".xlsx,.xls" multiple hidden aria-label="選擇補考名單檔案（可多選）" onChange={(e) => { const fs = filesOfInput(e.currentTarget); e.currentTarget.value = ''; void onFiles(fs); }} />
    </>
  );

  return (
    <section class="stack">
      <div class="card stephead"><div><h2>② 匯入名單</h2><p class="small muted">匯入教務系統的不及格名單。每一列都要有去處：納入、另行通知，或有紀錄的略過。</p></div></div>
      {err && <Alert tone="danger"><b>{err.title}</b>：{err.text}</Alert>}
      {batch && batch.files.length > 1 && <Alert tone="info">一次匯入 {batch.files.length} 個檔案，目前是第 {batch.i + 1} 個：<b>{batch.files[batch.i]?.name}</b>。每個檔案各自確認欄位對應；與目前名單同一位學生同一科重複的列會逐筆問你。每個檔案確認後就寫入名單；按「換檔案」只放棄還沒確認的檔案，已確認的會保留（要退回可按頁首「↶ 復原」）。</Alert>}
      <FileResults results={fileResults} hideSingleOk />

      {draft ? <MappingCard d={draft} onChange={setDraft} onConfirm={confirmMapping} onCancel={abortBatch} />
        : !s.parse ? (
          <>
            {picker}
            <Alert tone="info">還沒有名單：右側摘要、③ 以後的統計都先留空，不顯示 0。</Alert>
          </>
        ) : (
          <>
            <div class="card stack">
              <div class="row" style="justify-content:space-between">
                <div><div class="lab">{s.source?.fileName ?? '補考名單'}</div><p class="small muted">{r.rawCount} 列・{Object.keys(s.parse.columns).length} 欄對應{s.parse.warnings.length === 0 && r.unresolved.length === 0 ? '・無異常' : r.unresolved.length > 0 ? `・${r.unresolved.length} 筆問題列待處理` : ''}</p></div>
                <Button onClick={() => input.current?.click()}>換檔案</Button>
                <input ref={input} type="file" accept=".xlsx,.xls" multiple hidden aria-label="選擇補考名單檔案（可多選）" onChange={(e) => { const fs = filesOfInput(e.currentTarget); e.currentTarget.value = ''; void onFiles(fs); }} />
              </div>
              <Alert tone={ok ? 'ok' : 'danger'}>
                <b>{ok ? '✓ 匯入對帳：對上了（差異 0）' : r.unresolved.length > 0 ? `✕ 匯入對帳：還有 ${r.unresolved.length} 筆沒處理，對不上不通過` : '✕ 匯入對帳：列數對不上'}</b>　C-1
              </Alert>
              <StatsBar items={[
                { label: '匯入列數', value: r.rawCount },
                { label: '＝納入排程', value: r.included.length },
                { label: '＋另行通知（科屬性 1）', value: r.notified.length },
                { label: '＋略過（有紀錄）', value: r.skipped.length },
                { label: '＋未處理', value: r.unresolved.length, bad: r.unresolved.length > 0 },
              ]} />
              <p class="small muted">{ok ? `所有列都有去處。略過的 ${r.skipped.length} 筆記在下方「略過紀錄」，也會出現在 ⑥ 的對帳表。` : '未處理的問題列歸零，才能進下一步；你可以逐筆補上、修改或略過。'}</p>
            </div>
            {s.parse.warnings.length > 0 && (
              <Alert tone="warn"><b>同學號但資料不一致（F-12）</b>：{s.parse.warnings.length} 項，請確認是同一位學生。
                <ul class="small">{s.parse.warnings.slice(0, 5).map((w) => <li key={w}>{w}</li>)}</ul>{s.parse.warnings.length > 5 && <span class="small muted">其餘 {s.parse.warnings.length - 5} 項略</span>}</Alert>
            )}
            {r.unresolved.length > 0 && (
              <div class="card stack">
                <div class="lab">問題列　{r.unresolved.length} 筆待處理</div>
                {r.unresolved.map((prob) => <ProblemCard key={prob.rowId} prob={prob} parse={s.parse} onFix={(row) => p.onChange(setResolution(s, { rowId: prob.rowId, action: 'fix', row }))}
                  onSkip={(reason, note) => p.onChange(setResolution(s, { rowId: prob.rowId, action: 'skip', reason, ...(note ? { note } : {}) }))} />)}
              </div>
            )}
            <SkipLog s={s} onUndo={(id) => p.onChange(clearResolution(s, id))} />
            <RosterPreview s={s} onSkip={(row, reason, note) => p.onChange(setResolution(s, { rowId: row.rowId, action: 'skip', reason, ...(note ? { note } : {}) }))} />
            <Alert tone="warn"><b>暫定 U-1</b>「科屬性＝1 即不筆試」只在 106-1 檔看過；先照 D114 處理，施工前再用更多匯出檔核對。</Alert>
          </>
        )}

      {pending && <DupModal d={pending} onApply={apply} onClose={abortBatch} />}
      {ask && askRes && (
        <Modal title="不同檔案出現同一位學生同一科" onClose={abortBatch}
          actions={<><Button onClick={abortBatch}>取消匯入</Button><Button kind="primary" disabled={!askRes.ready} onClick={applyAsk}>確認合併</Button></>}>
          <ConflictList allowSkip={false} conflicts={askGroups.conflicts} choices={choices}
            onChoose={(k, c) => setChoices((m) => { const n = { ...m }; if (c === null) delete n[k]; else n[k] = c; return n; })}
            describe={(x) => `${x.row.name}　${x.row.subjectName}　${x.row.oldClass}-${x.row.oldSeat}　分數 ${x.row.score || '—'}`}
            titleOf={(k) => k.replace('|', '　')} />
          {!askRes.ready && <Alert tone="warn"><b>還不能確認：</b>還有 {askRes.pending.length} 筆沒有決定。</Alert>}
        </Modal>
      )}
    </section>
  );
}

// ───────────── 欄位對應 ─────────────

function MappingCard(p: { d: Draft; onChange: (d: Draft) => void; onConfirm: () => void; onCancel: () => void }) {
  const { d } = p;
  const pk = d.picks[d.sel]!;
  const head = pk.rows[d.header] ?? [];
  const mapped = Object.keys(d.columns).length;
  const setCol = (f: MakeupField, v: string) => {
    const c = { ...d.columns };
    if (v === '') delete c[f]; else c[f] = Number(v);
    p.onChange({ ...d, columns: c });
  };
  const first = pk.rows.slice(d.header + 1).filter((r) => r.some((c) => c && c.trim())).slice(0, 4);
  return (
    <div class="card stack">
      <div class="row" style="justify-content:space-between">
        <div><div class="lab">{d.fileName}</div><p class="small muted">{pk.rows.length} 列・{head.length} 欄・中文正常</p></div>
        <Button onClick={p.onCancel}>換檔案</Button>
      </div>
      {d.picks.length > 1 && (
        <div class="field"><label for="mk2-sheet">工作表</label>
          <select id="mk2-sheet" class="input" value={String(d.sel)} onChange={(e) => { const i = Number(e.currentTarget.value); const q = d.picks[i]!; p.onChange({ ...d, sel: i, header: q.header, columns: q.columns }); }}>
            {d.picks.map((q) => <option key={q.index} value={String(q.index)}>{q.name || `工作表 ${q.index + 1}`}</option>)}
          </select>
          <span class="hint">沒改對應時，所有工作表一起匯入（高一、高二分頁也行）。</span></div>
      )}
      <div><div class="lab">欄位對應</div><p class="small muted">已自動對應 {mapped} 欄。班級一律用「舊班、舊號」，新班、新號只留存參考。</p></div>
      <div class="grid2" style="display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr))">
        {MAPPING_FIELDS.map((m) => {
          const col = d.columns[m.field];
          return (
            <div class={`field${col === undefined && isRequiredField(m.field) ? ' err' : ''}`} key={m.field}>
              <label for={`mk2-f-${m.field}`}>{m.label}{isRequiredField(m.field) ? ' *' : ''}</label>
              <select id={`mk2-f-${m.field}`} class="input" value={col === undefined ? '' : String(col)} onChange={(e) => setCol(m.field, e.currentTarget.value)}>
                <option value="">（找不到）請指定{isRequiredField(m.field) ? '' : '（可不對應）'}</option>
                {head.map((h, i) => <option key={i} value={String(i)}>{(h ?? '').trim() || `第 ${i + 1} 欄`}</option>)}
              </select>
              <span class={col === undefined && isRequiredField(m.field) ? 'field-msg' : 'hint'}>
                {col === undefined ? (isRequiredField(m.field) ? '必要欄位，請指定' : '未對應') : `已對應　例：${cellOf(first[0], col) || '—'}`}{m.hint && col !== undefined ? `　${m.hint}` : ''}
              </span>
            </div>
          );
        })}
      </div>
      <div><div class="lab">預覽前 {first.length} 列</div></div>
      <div class="rtw"><table class="t compact rt-t">
        <thead><tr><th>學號</th><th>舊班</th><th>舊號</th><th>姓名</th><th>科目</th><th>科屬性</th><th>分數</th></tr></thead>
        <tbody>
          {first.map((r, i) => (
            <tr key={i}>
              <td class="ti" data-label="學號">{cellOf(r, d.columns.studentId)}</td><td data-label="舊班">{cellOf(r, d.columns.oldClass)}</td><td data-label="舊號">{cellOf(r, d.columns.oldSeat)}</td>
              <td data-label="姓名">{cellOf(r, d.columns.name)}</td><td data-label="科目">{cellOf(r, d.columns.subjectName)}</td><td data-label="科屬性">{cellOf(r, d.columns.attr) || '—'}</td><td data-label="分數">{cellOf(r, d.columns.score) || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <div class="row"><Button kind="primary" onClick={p.onConfirm}>確認對應並匯入 ›</Button></div>
    </div>
  );
}

// ───────────── 問題列（F-10） ─────────────

const REASONS = Object.keys(SKIP_REASON_TEXT) as SkipReason[];

function SkipForm(p: { onSkip: (reason: SkipReason, note?: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState<SkipReason>('transferred');
  const [note, setNote] = useState('');
  return (
    <div class="row" style="align-items:flex-end">
      <div class="field"><label class="small">略過原因</label>
        <select class="input" aria-label="略過原因" value={reason} onChange={(e) => setReason(e.currentTarget.value as SkipReason)}>
          {REASONS.map((r) => <option key={r} value={r}>{SKIP_REASON_TEXT[r]}</option>)}
        </select></div>
      {reason === 'other' && <div class="field"><label class="small">說明</label><input class="input" aria-label="略過說明" value={note} onInput={(e) => setNote(e.currentTarget.value)} /></div>}
      <Button kind="primary" disabled={reason === 'other' && !note.trim()} onClick={() => p.onSkip(reason, reason === 'other' ? note.trim() : undefined)}>確認略過</Button>
      <Button onClick={p.onCancel}>取消</Button>
    </div>
  );
}

function ProblemCard(p: { prob: MakeupProblem; parse: MakeupParseResult | undefined; onFix: (row: MakeupRow) => void; onSkip: (reason: SkipReason, note?: string) => void }) {
  const { prob } = p;
  const d = prob.draft;
  const [mode, setMode] = useState<'none' | 'edit' | 'skip'>('none');
  const [f, setF] = useState({ studentId: d.studentId, oldClass: d.oldClass, oldSeat: Number.isFinite(d.oldSeat) ? String(d.oldSeat) : '', name: d.name, subjectName: d.subjectName, attr: d.attr });
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });
  const save = () => p.onFix({ ...d, studentId: f.studentId.trim(), oldClass: f.oldClass.trim(), oldSeat: f.oldSeat.trim() === '' ? Number.NaN : Number(f.oldSeat), name: f.name.trim(), subjectName: f.subjectName.trim(), attr: f.attr.trim() });
  const noName = prob.kind === 'no-name';
  return (
    <div class="psec stack">
      <div class="row"><b>{rowWhere(p.parse, prob.draft)}　{problemKindText(prob.kind)}</b><Badge tone="danger">待處理</Badge></div>
      <p class="small muted">{prob.message}</p>
      <div class="rtw"><table class="t compact rt-t">
        <thead><tr><th>學號</th><th>舊班－舊號</th><th>姓名</th><th>科目</th><th>科屬性</th></tr></thead>
        <tbody><tr>
          <td class="ti" data-label="學號">{d.studentId || '（空白）'}</td>
          <td data-label="舊班－舊號">{d.oldClass || '（空白）'}－{Number.isFinite(d.oldSeat) ? d.oldSeat : '（空白）'}</td>
          <td data-label="姓名">{d.name || '（空白）'}</td><td data-label="科目">{d.subjectName || '（空白）'}</td><td data-label="科屬性">{d.attr || '0'}</td>
        </tr></tbody>
      </table></div>
      {mode === 'edit' && (
        <div class="stack">
          <div class="row" style="align-items:flex-end">
            <div class="field"><label class="small">學號</label><input class="input" aria-label="學號" value={f.studentId} onInput={(e) => set('studentId', e.currentTarget.value)} /></div>
            <div class="field"><label class="small">舊班</label><input class="input" aria-label="舊班" value={f.oldClass} onInput={(e) => set('oldClass', e.currentTarget.value)} /></div>
            <div class="field"><label class="small">舊號</label><input class="input" aria-label="舊號" inputMode="numeric" value={f.oldSeat} onInput={(e) => set('oldSeat', e.currentTarget.value)} /></div>
            <div class="field"><label class="small">姓名</label><input class="input" aria-label="姓名" value={f.name} onInput={(e) => set('name', e.currentTarget.value)} /></div>
            <div class="field"><label class="small">科目</label><input class="input" aria-label="科目" value={f.subjectName} onInput={(e) => set('subjectName', e.currentTarget.value)} /></div>
            <div class="field"><label class="small">科屬性</label><input class="input" aria-label="科屬性" value={f.attr} onInput={(e) => set('attr', e.currentTarget.value)} /></div>
          </div>
          <div class="row"><Button kind="primary" onClick={save}>儲存修改</Button><Button onClick={() => setMode('none')}>取消</Button></div>
        </div>
      )}
      {mode === 'skip' && <SkipForm onSkip={p.onSkip} onCancel={() => setMode('none')} />}
      {mode === 'none' && <div class="row"><Button onClick={() => setMode('edit')}>{noName ? '手動補上姓名' : '修改內容'}</Button><Button onClick={() => setMode('skip')}>略過這列</Button></div>}
    </div>
  );
}

// ───────────── 略過紀錄 ─────────────

function SkipLog(p: { s: MakeupSession; onUndo: (rowId: string) => void }) {
  const sk = baseOf(p.s).roster.skipped;
  if (sk.length === 0) return null;
  return (
    <div class="card stack">
      <div class="lab">略過紀錄　{sk.length} 筆</div>
      <p class="small muted">略過不是丟掉：每一筆都留在這裡，也會列在 ⑥ 對帳表，隨補考場次存檔。</p>
      <div class="rtw"><table class="t compact rt-t">
        <thead><tr><th>列</th><th>學號</th><th>科目</th><th>原因</th><th /></tr></thead>
        <tbody>
          {sk.map((x) => (
            <tr key={x.rowId}>
              <td class="ti" data-label="列">{x.row.srcRow}</td><td data-label="學號">{x.row.studentId}</td><td data-label="科目">{x.row.subjectName || '—'}</td>
              <td data-label="原因">{SKIP_REASON_TEXT[x.reason]}{x.note ? `（${x.note}）` : ''}</td>
              <td class="act"><Button small onClick={() => p.onUndo(x.rowId)}>撤銷略過</Button></td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}

// ───────────── 已納入名單（可略過沒有問題的列，例：非補考對象） ─────────────

function RosterPreview(p: { s: MakeupSession; onSkip: (row: MakeupRow, reason: SkipReason, note?: string) => void }) {
  const r = baseOf(p.s).roster;
  const [q, setQ] = useState('');
  const [all, setAll] = useState(false);
  const [skipId, setSkipId] = useState<string | null>(null);
  const rows = [...r.included, ...r.notified];
  const hit = q.trim() ? rows.filter((x) => x.studentId.includes(q.trim()) || x.oldClass.includes(q.trim()) || x.name.includes(q.trim())) : rows;
  const shown = all ? hit : hit.slice(0, 10);
  if (rows.length === 0) return <EmptyState title="還沒有納入的名單">問題列處理完或匯入後，這裡會列出納入與另行通知的學生。</EmptyState>;
  return (
    <More title={`看名單（納入與另行通知 ${rows.length} 列）：可略過不需要補考的列`}>
      <div class="stack">
        <div class="field"><label for="mk2-q">搜尋學號、班級或姓名</label><input id="mk2-q" class="input" value={q} onInput={(e) => setQ(e.currentTarget.value)} /></div>
        <div class="rtw"><table class="t compact rt-t">
          <thead><tr><th>學號</th><th>舊班－舊號</th><th>姓名</th><th>科目</th><th>屬性</th><th /></tr></thead>
          <tbody>
            {shown.map((x) => (
              <tr key={x.rowId}>
                <td class="ti" data-label="學號">{x.studentId}</td><td data-label="舊班－舊號">{x.oldClass}－{x.oldSeat}</td><td data-label="姓名">{x.name}</td><td data-label="科目">{x.subjectName}</td>
                <td data-label="屬性">{r.notified.includes(x) ? '另行通知' : '納入'}</td>
                <td class="act">{skipId === x.rowId ? <SkipForm onSkip={(re, n) => { p.onSkip(x, re, n); setSkipId(null); }} onCancel={() => setSkipId(null)} /> : <Button small onClick={() => setSkipId(x.rowId)}>略過</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {!all && hit.length > 10 && <Button onClick={() => setAll(true)}>顯示全部 {hit.length} 筆 ▾</Button>}
      </div>
    </More>
  );
}

// ───────────── 重複匯入（F-11） ─────────────

function DupModal(p: { d: Pending; onApply: (m: 'replace' | 'merge') => void; onClose: () => void }) {
  const [mode, setMode] = useState<'replace' | 'merge'>('replace');
  const { diff } = p.d;
  return (
    <Modal title="這份名單看起來已經匯入過" onClose={p.onClose} actions={<><Button onClick={p.onClose}>取消</Button><Button kind="primary" onClick={() => p.onApply(mode)}>套用</Button></>}>
      <div class="stack">
        <p>新檔（{p.d.fileName}）有 {p.d.parse.rawCount} 列，其中 {diff.same} 列與目前的名單相同。請選擇怎麼處理：</p>
        <label class="chk" style="display:flex;gap:8px"><input type="radio" name="mk2-dup" checked={mode === 'replace'} onChange={() => setMode('replace')} /><span><b>取代</b>：用新檔整份換掉目前名單。已排的考程會重新檢核；先前的問題列處理與略過紀錄會清掉，需要重做。</span></label>
        <label class="chk" style="display:flex;gap:8px"><input type="radio" name="mk2-dup" checked={mode === 'merge'} onChange={() => setMode('merge')} /><span><b>合併</b>：保留目前的，只加入新檔多出來的列。</span></label>
        <div class="stats side-stats">
          <div><small>{mode === 'replace' ? '會新增' : '會新增（新檔多出的列）'}</small><strong>{diff.added}</strong></div>
          {mode === 'replace' && <div><small>會更新（分數或班級不同）</small><strong>{diff.updated}</strong></div>}
          {mode === 'replace' && <div><small>會移除（新檔沒有）</small><strong>{diff.removed}</strong></div>}
        </div>
        {mode === 'replace' && diff.removedScheduled > 0 && <Alert tone="warn"><b>受影響：已排進考程的 {diff.removedScheduled} 筆會被移除</b>。套用後 ⑥ 會立刻重新檢核；如果因此出現遺漏，儀表板會變紅並列出來。</Alert>}
      </div>
    </Modal>
  );
}
