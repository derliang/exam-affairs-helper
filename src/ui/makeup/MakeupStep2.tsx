import { useState } from 'preact/hooks';
import { Alert, Badge, Button, EmptyState, Seg } from '../components';
import { readXlsx, XlsError, type Sheet } from '../../import';
import {
  findMakeupHeader, mapMakeupColumns, parseMakeupSheet, parseMakeupWorkbook, problemKindText, REQUIRED_FIELDS, SKIP_REASON_TEXT,
  type MakeupColumnMap, type MakeupField, type MakeupParseResult, type MakeupProblem, type MakeupRow, type SkipReason,
} from '../../core/makeup';
import { applyImport, diffImport, mergeParse, rosterOf, setResolution, type ImportDiff, type MakeupSession } from './model';
import type { MakeupStepProps } from './MakeupStep1';

const FIELD_TEXT: Record<MakeupField, string> = {
  studentId: '學號', newClass: '新班', newSeat: '新號', oldClass: '舊班', oldSeat: '舊號', name: '姓名',
  subjectCode: '科代碼', subjectName: '科目名稱', credit: '學分', attr: '科屬性', term: '學期', score: '分數',
};
const FIELD_ORDER = Object.keys(FIELD_TEXT) as MakeupField[];

interface Pending {
  fileName: string;
  sheets: Sheet[];
  parse: MakeupParseResult;
  /** 欄位對應失敗（缺必要欄位）時，請使用者指定 */
  mapping?: { sheet: number; header: number; columns: MakeupColumnMap };
}

/** ② 匯入名單（S-3；F-7～F-12）：教務原始匯出檔 → 欄位對應 → 匯入對帳（C-1）→ 問題列逐筆處理 */
export function MakeupStep2(p: MakeupStepProps & { now?: () => Date }) {
  const { s } = p;
  const now = p.now ?? (() => new Date());
  const [err, setErr] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const roster = rosterOf(s);

  const onFile = async (file: File) => {
    setErr('');
    try {
      const sheets = await readXlsx(await file.arrayBuffer());
      if (sheets.length === 0) { setErr('檔案裡沒有工作表'); return; }
      const parse = parseMakeupWorkbook(sheets);
      if (parse.missing.length > 0) {
        const si = Math.max(0, sheets.findIndex((x) => findMakeupHeader(x.rows) >= 0));
        const header = Math.max(0, findMakeupHeader(sheets[si]!.rows));
        setPending({ fileName: file.name, sheets, parse, mapping: { sheet: si, header, columns: mapMakeupColumns(sheets[si]!.rows[header] ?? []) } });
      } else if (s.source) setPending({ fileName: file.name, sheets, parse });
      else p.onChange(applyImport(s, file.name, parse, now()));
    } catch (e) {
      setErr(e instanceof XlsError ? e.message : `讀不了這個檔案：${e instanceof Error ? e.message : String(e)}。請確認是 .xlsx 檔`);
    }
  };

  const adopt = (parse: MakeupParseResult, fileName: string, mode: 'replace' | 'merge') => {
    const merged = mode === 'merge' && s.source ? mergeParse(s.source.parse, parse) : parse;
    p.onChange(applyImport(s, fileName, merged, now(), mode === 'merge'));
    setPending(null);
  };

  return (
    <section class="stack" aria-label="匯入名單">
      <div class="card stephead"><div><h2>② 匯入名單</h2><p class="small muted">直接匯入教務系統的原始匯出檔（.xlsx）。班級以舊班、舊號為準；科屬性 1 的科目只統計、不排考程。</p></div></div>

      <div class="card stack">
        <div class="row" style="justify-content:space-between">
          <div><b>{s.source ? s.source.fileName : '還沒有匯入名單'}</b>{s.source && <span class="small muted">　匯入時間 {s.source.importedAt.slice(0, 16).replace('T', ' ')}</span>}</div>
          <label class="btn btn-primary" style="cursor:pointer">{s.source ? '重新匯入（取代或合併）' : '選擇 Excel 檔'}
            <input type="file" accept=".xlsx" hidden aria-label="選擇補考名單 Excel 檔" onChange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (f) void onFile(f); }} />
          </label>
        </div>
        {err && <Alert tone="danger">{err}</Alert>}
      </div>

      {pending?.mapping && <MappingCard pending={pending} onPending={setPending} onCancel={() => setPending(null)}
        onApply={(parse) => { if (s.source) setPending({ ...pending, parse, mapping: undefined }); else { adopt(parse, pending.fileName, 'replace'); } }} />}
      {pending && !pending.mapping && <ReimportCard s={s} pending={pending} onAdopt={adopt} onCancel={() => setPending(null)} />}

      {!s.source && !pending && <EmptyState title="先匯入名單">補考名單一人一科一列；匯入後會對帳並列出需要處理的問題列。</EmptyState>}

      {roster && s.source && (
        <>
          <ReconcileCard s={s} />
          {s.source.parse.warnings.length > 0 && (
            <Alert tone="warn"><b>提醒（{s.source.parse.warnings.length}）：同一學號的姓名或舊班舊號前後不一致</b>
              <ul style="margin:6px 0 0 18px">{s.source.parse.warnings.slice(0, 8).map((w, i) => <li key={i}>{w}</li>)}</ul>
              {s.source.parse.warnings.length > 8 && <span class="small">…另有 {s.source.parse.warnings.length - 8} 則</span>}</Alert>
          )}
          <ProblemList s={s} onChange={p.onChange} problems={roster.unresolved} />
          <SkippedList s={s} onChange={p.onChange} />
        </>
      )}
    </section>
  );
}

function MappingCard(p: { pending: Pending; onPending: (x: Pending) => void; onCancel: () => void; onApply: (parse: MakeupParseResult) => void }) {
  const m = p.pending.mapping!;
  const rows = p.pending.sheets[m.sheet]!.rows;
  const header = rows[m.header] ?? [];
  const missing = REQUIRED_FIELDS.filter((f) => m.columns[f] === undefined);
  const set = (f: MakeupField, v: string) => {
    const columns = { ...m.columns };
    if (v === '') delete columns[f]; else columns[f] = Number(v);
    p.onPending({ ...p.pending, mapping: { ...m, columns } });
  };
  const apply = () => {
    const parse = parseMakeupSheet(rows, {}, p.pending.sheets.length > 1 ? p.pending.sheets[m.sheet]!.name : '', { header: m.header, columns: m.columns });
    p.onApply(parse);
  };
  return (
    <div class="card stack" role="group" aria-label="欄位對應">
      <div class="lab">請指定欄位</div>
      <Alert tone="warn">有欄位對不上：{missing.map((f) => FIELD_TEXT[f]).join('、') || '（已全部指定）'}。請從檔案的表頭挑出對應的欄位，下面預覽前幾列。</Alert>
      {p.pending.sheets.length > 1 && (
        <label class="field"><span class="label">工作表</span>
          <select class="input" value={m.sheet} onChange={(e) => { const si = Number(e.currentTarget.value); const h = Math.max(0, findMakeupHeader(p.pending.sheets[si]!.rows)); p.onPending({ ...p.pending, mapping: { sheet: si, header: h, columns: mapMakeupColumns(p.pending.sheets[si]!.rows[h] ?? []) } }); }}>
            {p.pending.sheets.map((x, i) => <option key={i} value={i}>{x.name}</option>)}</select></label>
      )}
      <label class="field"><span class="label">表頭在第幾列</span>
        <input class="input" type="number" min={1} style="width:100px" value={m.header + 1} onInput={(e) => { const n = Number(e.currentTarget.value); if (Number.isInteger(n) && n >= 1 && n <= rows.length) p.onPending({ ...p.pending, mapping: { ...m, header: n - 1, columns: mapMakeupColumns(rows[n - 1] ?? []) } }); }} /></label>
      <div class="newgrid">
        {FIELD_ORDER.map((f) => (
          <label class="field" key={f}><span class="label">{FIELD_TEXT[f]}{REQUIRED_FIELDS.includes(f) ? '（必要）' : ''}</span>
            <select class="input" aria-label={`${FIELD_TEXT[f]} 對應欄位`} value={m.columns[f] ?? ''} onChange={(e) => set(f, e.currentTarget.value)}>
              <option value="">（沒有這欄）</option>
              {header.map((h, i) => <option key={i} value={i}>{`第 ${i + 1} 欄：${h || '（空白）'}`}</option>)}
            </select></label>
        ))}
      </div>
      <div class="scroll"><table class="t compact nw"><thead><tr>{header.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
        <tbody>{rows.slice(m.header + 1, m.header + 6).map((r, i) => <tr key={i}>{header.map((_, j) => <td key={j}>{r[j] ?? ''}</td>)}</tr>)}</tbody></table></div>
      <div class="btnrow" style="justify-content:flex-end"><Button onClick={p.onCancel}>取消</Button><Button kind="primary" disabled={missing.length > 0} onClick={apply}>套用這個對應</Button></div>
    </div>
  );
}

/** F-11：已經有名單時再匯入，要選取代或合併，並顯示會新增／更新／移除幾列 */
function ReimportCard(p: { s: MakeupSession; pending: Pending; onAdopt: (parse: MakeupParseResult, fileName: string, mode: 'replace' | 'merge') => void; onCancel: () => void }) {
  const [mode, setMode] = useState<'replace' | 'merge'>('replace');
  const diff: ImportDiff = diffImport(p.s.source?.parse, p.pending.parse);
  const removed = mode === 'replace' ? diff.removed : 0;
  return (
    <div class="card stack" role="group" aria-label="重複匯入">
      <div class="lab">已經有名單了，這一份怎麼處理？</div>
      <Seg label="取代或合併" value={mode} onChange={setMode} options={[{ value: 'replace', label: '取代整份名單' }, { value: 'merge', label: '合併（保留舊的、加入新的）' }]} />
      <ul style="margin:0 0 0 18px">
        <li>新增 <b>{diff.added}</b> 列</li><li>更新 <b>{diff.updated}</b> 列（同學號同科目，內容不同）</li>
        <li>移除 <b>{removed}</b> 列{mode === 'merge' && diff.removed > 0 ? `（合併不移除；舊名單有 ${diff.removed} 列不在新檔裡）` : ''}</li><li>沒變 <b>{diff.unchanged}</b> 列</li>
      </ul>
      <Alert tone="warn" noIcon>名單一變，已排的考程會重新計算；你調整過的考程（⑤）會回到系統建議。{mode === 'replace' ? '問題列的處理紀錄也會重來。' : '合併時保留既有的問題列處理。'}</Alert>
      <div class="btnrow" style="justify-content:flex-end"><Button onClick={p.onCancel}>取消</Button><Button kind="primary" onClick={() => p.onAdopt(p.pending.parse, p.pending.fileName, mode)}>{mode === 'replace' ? '取代' : '合併'}</Button></div>
    </div>
  );
}

/** C-1 匯入對帳（F-9）：原始列數 ＝ 納入＋另行通知＋略過＋未處理 */
function ReconcileCard({ s }: { s: MakeupSession }) {
  const r = rosterOf(s)!;
  const sum = r.included.length + r.notified.length + r.skipped.length + r.unresolved.length;
  const ok = sum === r.rawCount && r.unresolved.length === 0;
  return (
    <div class={`card stack ${ok ? '' : 'err'}`} role="status" aria-label="匯入對帳">
      <div class="lab">匯入對帳（C-1）</div>
      <p style="font-size:18px">匯入 <b>{r.rawCount}</b> 列 ＝ 納入排程 <b>{r.included.length}</b> ＋ 另行通知 <b>{r.notified.length}</b> ＋ 略過 <b>{r.skipped.length}</b> ＋ 未處理 <b class={r.unresolved.length ? 'bad' : ''}>{r.unresolved.length}</b></p>
      {ok ? <Badge tone="ok">✓ 對得起來</Badge> : <Badge tone="danger">{r.unresolved.length > 0 ? `✕ 還有 ${r.unresolved.length} 筆問題列沒處理，不能往下排考程` : `✕ 差 ${r.rawCount - sum} 列`}</Badge>}
      <p class="small muted">納入＝排進考程的人次；另行通知＝科屬性 1，只統計不排；略過＝你處理問題列時選的，每一筆都留紀錄（見下方）。</p>
    </div>
  );
}

const FIX_FIELDS: { k: keyof Pick<MakeupRow, 'studentId' | 'name' | 'oldClass' | 'subjectName'>; label: string }[] = [
  { k: 'studentId', label: '學號' }, { k: 'name', label: '姓名' }, { k: 'oldClass', label: '舊班' }, { k: 'subjectName', label: '科目名稱' },
];

function ProblemList(p: { s: MakeupSession; problems: MakeupProblem[]; onChange: (m: MakeupSession) => void }) {
  if (p.problems.length === 0) return <Alert tone="ok">沒有需要處理的問題列。</Alert>;
  return (
    <div class="card stack" aria-label="問題列"><div class="lab">問題列（{p.problems.length}）：逐筆補上、修改或略過</div>
      {p.problems.map((x) => <ProblemRow key={x.rowId} s={p.s} problem={x} onChange={p.onChange} />)}
    </div>
  );
}

function ProblemRow(p: { s: MakeupSession; problem: MakeupProblem; onChange: (m: MakeupSession) => void }) {
  const d0 = p.problem.draft;
  const [draft, setDraft] = useState<MakeupRow>(d0);
  const [reason, setReason] = useState<SkipReason>('not-target');
  const [note, setNote] = useState('');
  const fixed = p.s.resolutions.find((r) => r.rowId === p.problem.rowId);
  void fixed;
  return (
    <div class="card stack" style="border-left:4px solid var(--danger,#c00)">
      <div class="row"><Badge tone="danger">{problemKindText(p.problem.kind)}</Badge><span class="small">第 {p.problem.srcRow} 列</span><span>{p.problem.message}</span></div>
      <div class="row">
        {FIX_FIELDS.map((f) => (
          <label class="field" key={f.k}><span class="label">{f.label}</span>
            <input class="input" style="width:140px" aria-label={`第 ${p.problem.srcRow} 列 ${f.label}`} value={String(draft[f.k] ?? '')} onInput={(e) => setDraft({ ...draft, [f.k]: e.currentTarget.value })} /></label>
        ))}
        <label class="field"><span class="label">舊號</span>
          <input class="input" style="width:80px" inputMode="numeric" aria-label={`第 ${p.problem.srcRow} 列 舊號`} value={Number.isNaN(draft.oldSeat) ? '' : String(draft.oldSeat)} onInput={(e) => { const n = Number(e.currentTarget.value); setDraft({ ...draft, oldSeat: e.currentTarget.value.trim() !== '' && Number.isInteger(n) ? n : Number.NaN }); }} /></label>
        <Button kind="primary" onClick={() => p.onChange(setResolution(p.s, { rowId: p.problem.rowId, action: 'fix', row: draft }, p.problem.rowId))}>補上／修改</Button>
      </div>
      <div class="row">
        <label class="field"><span class="label">或略過，原因</span>
          <select class="input" aria-label={`第 ${p.problem.srcRow} 列 略過原因`} value={reason} onChange={(e) => setReason(e.currentTarget.value as SkipReason)}>
            {(Object.keys(SKIP_REASON_TEXT) as SkipReason[]).map((k) => <option key={k} value={k}>{SKIP_REASON_TEXT[k]}</option>)}</select></label>
        {reason === 'other' && <label class="field"><span class="label">說明</span><input class="input" value={note} onInput={(e) => setNote(e.currentTarget.value)} /></label>}
        <Button onClick={() => p.onChange(setResolution(p.s, { rowId: p.problem.rowId, action: 'skip', reason, ...(note.trim() ? { note: note.trim() } : {}) }, p.problem.rowId))}>略過這一筆</Button>
      </div>
    </div>
  );
}

/** 略過清單：每筆都留紀錄（原因出現在對帳表，D123），可取消 */
function SkippedList(p: { s: MakeupSession; onChange: (m: MakeupSession) => void }) {
  const r = rosterOf(p.s)!;
  if (r.skipped.length === 0) return null;
  return (
    <div class="card stack" aria-label="略過紀錄"><div class="lab">已略過（{r.skipped.length}）</div>
      <div class="scroll"><table class="t compact nw"><thead><tr><th>列</th><th>學號</th><th>舊班</th><th>科目</th><th>原因</th><th /></tr></thead>
        <tbody>{r.skipped.map((k) => (
          <tr key={k.rowId}><td>{k.row.srcRow}</td><td>{k.row.studentId}</td><td>{k.row.oldClass}</td><td>{k.row.subjectName}</td>
            <td>{SKIP_REASON_TEXT[k.reason]}{k.note ? `：${k.note}` : ''}</td>
            <td><Button small onClick={() => p.onChange(setResolution(p.s, null, k.rowId))}>取消略過</Button></td></tr>
        ))}</tbody></table></div>
    </div>
  );
}
