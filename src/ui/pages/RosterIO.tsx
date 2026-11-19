import { useRef, useState } from 'preact/hooks';
import type { Division, Track } from '../../data';
import { readXlsx, writeXlsx, XlsError, type RosterProblem } from '../../import';
import { Alert, Button, ConfirmModal, FormatButton, Modal } from '../components';
import { downloadBytes, XLSX_MIME } from '../download';
import { applyImport, clearRoster, examsAffectedByClear, examsMadeStale, exportRows, importOutcome, planImport, templateRows, type UnknownClassAction } from '../rosterIO';
import { CONFIRMABLE, PROBLEM_KIND_TEXT, problemBlockers, resolveProblems, type ProblemDecision } from '../rosterProblems';
import { setClassTrack, syncDiffs, type Doc } from '../store';
import { rosterYearOf, switchRosterYear } from '../rosterYears';
import type { Student } from '../../data';
import { parseRosterWorkbook } from '../step2';
import { RowFix } from './RowFix';

const DIV_NAME: Record<Division, string> = { senior: '高中部', junior: '國中部' };

/** G9 確認視窗要求輸入的字樣 */

/**
 * 設定頁學生名單的 Excel 範本下載／匯入／下載（DESIGN 10.3，UI-09/10）。
 * variant='zone'：給模擬考第 ② 步用的醒目匯入區（只有範本與匯入，匯入寫進共用設定的同一份學生名單，G8）。
 */
export function RosterIO(p: { doc: Doc; division: Division; onChange: (d: Doc) => void; variant?: 'toolbar' | 'zone' }) {
  const zone = p.variant === 'zone';
  const input = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<{ students: Student[]; layout: string; issues: string[]; problems: RosterProblem[]; sheetName: string; tracks?: Record<number, Track> } | null>(null);
  /** G10：每個問題列的決定；沒有「稍後處理」，全部決定且內容合法才能確認 */
  const [decisions, setDecisions] = useState<Record<number, ProblemDecision>>({});
  const [fileKey, setFileKey] = useState(0);
  // 匯入的名單屬於哪個學年度（#208，稿 v2.36）：必選，預設目前頁面的學年度
  const [yearText, setYearText] = useState('');
  const year = Number(yearText);
  const yearOk = Number.isInteger(year) && year >= 90 && year <= 200;
  const switched = parsed && yearOk && year !== rosterYearOf(p.doc) ? switchRosterYear(p.doc, year) : null;
  const target: Doc = switched && switched.ok ? switched.doc : p.doc;
  const resolution = parsed ? resolveProblems(parsed.students, parsed.problems, decisions) : null;
  const plan = parsed && resolution ? { ...planImport(target, p.division, resolution.students), layout: parsed.layout, issues: parsed.issues, ...(parsed.tracks ? { tracks: parsed.tracks } : {}) } : null;
  const setPlan = (_: null) => { setParsed(null); setDecisions({}); };
  const [useTracks, setUseTracks] = useState(true);
  const [unk, setUnk] = useState<UnknownClassAction>('add');
  const [err, setErr] = useState('');
  const [tpl, setTpl] = useState(false);
  const classNames = p.doc.settings.classes.filter((c) => c.division === p.division).map((c) => c.name);

  const onFile = async (file: File) => {
    setErr('');
    try {
      const sheets = await readXlsx(await file.arrayBuffer());
      const r = parseRosterWorkbook(sheets, classNames);
      if (r.students.length === 0 && r.problems.length === 0) {
        setErr(r.issues[0]?.message ?? '檔案裡沒有讀到學生，請確認表頭有「座號」「姓名」');
        return;
      }
      setUnk('add');
      setDecisions({});
      setFileKey((k) => k + 1);
      setYearText(String(rosterYearOf(p.doc)));
      setParsed({ students: r.students, layout: r.layout, issues: r.issues.filter((i) => !i.problem).map((i) => i.message), problems: r.problems, sheetName: r.sheetName ?? '', ...(r.classTracks ? { tracks: r.classTracks } : {}) });
    } catch (e) {
      setErr(e instanceof XlsError ? e.message : `讀不了這個檔案：${e instanceof Error ? e.message : String(e)}。請確認是 .xlsx 檔`);
    }
  };

  const outcome = plan ? importOutcome(target, p.division, plan, unk) : null;
  const staleExams = plan ? examsMadeStale(target, p.division, plan, unk) : [];
  const blockers = resolution ? problemBlockers(resolution) : [];
  const confirm = () => {
    if (!plan || !outcome || outcome.count === 0 || !yearOk || !resolution?.ready) return;
    let d = applyImport(target, p.division, plan, unk);
    if (useTracks && plan.tracks && p.division === 'senior') {
      for (const [no, t] of Object.entries(plan.tracks)) d = setClassTrack(d, 'senior', Number(no), t);
    }
    p.onChange(syncDiffs(d));
    setPlan(null);
  };
  const decide = (i: number, d: ProblemDecision | null) => setDecisions((m) => { const n = { ...m }; if (d) n[i] = d; else delete n[i]; return n; });

  return (
    <>
      {!zone && <FormatButton kind="xls" onClick={() => setTpl(true)}>下載名單範本</FormatButton>}
      {zone && <Button onClick={() => setTpl(true)}>下載名單範本</Button>}
      {zone
        ? <Button kind="primary" onClick={() => input.current?.click()}>選擇學生名單檔（.xlsx）並匯入</Button>
        : <FormatButton kind="xls" onClick={() => input.current?.click()}>匯入學生名單</FormatButton>}
      {!zone && <FormatButton kind="xls" onClick={async () => downloadBytes(`${DIV_NAME[p.division]}學生名單.xlsx`, await writeXlsx(exportRows(p.doc.rosters[p.division]), '學生名單'), XLSX_MIME)}>匯出學生名單</FormatButton>}
      {!zone && <ClearRoster doc={p.doc} division={p.division} onChange={p.onChange} />}
      <span class="small muted">匯入接受 .xlsx；舊版 .xls 請先另存成 .xlsx（程式不直接讀 .xls）</span>
      <input ref={input} type="file" accept=".xlsx" hidden aria-label="選擇學生名單 Excel 檔"
        onChange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (f) void onFile(f); }} />
      {tpl && (
        <Modal title="下載名單範本" onClose={() => setTpl(false)}
          actions={<><Button onClick={() => setTpl(false)}>取消</Button><Button kind="primary" onClick={async () => { downloadBytes('學生名單範本.xlsx', await writeXlsx(templateRows(), '學生名單'), XLSX_MIME); setTpl(false); }}>下載範本</Button></>}>
          <p class="small muted">先下載範本、照格式整理學生資料，再按「匯入學生名單」放進來。檔名：學生名單範本.xlsx。</p>
          <div class="scroll"><table class="t compact nw">
            <thead><tr><th>班級</th><th>座號</th><th>姓名</th><th>學號（選填）</th></tr></thead>
            <tbody><tr><td>溫</td><td>1</td><td>王小明</td><td>1150101</td></tr><tr><td>溫</td><td>2</td><td>李小華</td><td class="muted">（沒有就留空）</td></tr></tbody>
          </table></div>
          <ul class="small muted" style="margin:0;padding-left:18px">
            <li>班級、座號、姓名一定要填；學號沒有就留空，不影響排座。</li>
            <li>考生編號由班級＋座號自動產生，不用填。</li>
            <li>{p.division === 'junior' ? '國中部範本沒有組別欄。' : '高中部的組別來自每次的考試名單，範本不用填。'}</li>
          </ul>
        </Modal>
      )}
      {err && <div style="flex-basis:100%"><Alert tone="danger">{err}</Alert></div>}
      {plan && parsed && resolution && (
        <Modal title={`匯入${DIV_NAME[p.division]}學生名單`} onClose={() => setPlan(null)}
          actions={<><Button onClick={() => setPlan(null)}>取消</Button><Button kind="primary" disabled={!yearOk || !outcome || outcome.count === 0 || !resolution.ready} onClick={confirm}>確認取代為 {outcome?.count ?? 0} 人名單</Button></>}>
          <p>讀到 <strong>{parsed.students.length}</strong> 人{parsed.problems.length > 0 ? `，另有 ${parsed.problems.length} 列有問題要你決定` : ''}；實際會匯入 <strong>{outcome?.count ?? 0}</strong> 人{outcome && outcome.skipped > 0 ? `（未匯入 ${outcome.skipped} 人）` : ''}（目前 {plan.before} 人）。確定後會<strong>取代</strong>{DIV_NAME[p.division]}整份名單；之後可用「↶ 復原」回到匯入前。</p>
          {blockers.length > 0 && <Alert tone="warn"><b>還不能確認取代：</b>{blockers.join('；')}。每一列都要決定「手動補上」「修改內容」「確認無誤」或「不匯入這列」。</Alert>}
          <div class={`field${yearOk ? '' : ' err'}`} style="max-width:260px"><label for="roster-year">這份名單屬於哪個學年度</label>
            <input id="roster-year" class="input" inputMode="numeric" value={yearText} aria-invalid={!yearOk} onInput={(e) => setYearText(e.currentTarget.value)} />
            <span class={yearOk ? 'hint' : 'field-msg'}>{!yearOk ? '請填民國年，例如 114' : year === rosterYearOf(p.doc) ? '預設是目前頁面的學年度' : `會匯入到 ${year} 學年度，不動其他學年度的名單`}</span></div>
          {staleExams.length > 0 && (
            <Alert tone="warn">
              取代共用學生名單後，<b>會使 {staleExams.length} 個已排座的模擬考過期</b>：
              <ul style="margin:6px 0 0;padding-left:18px">{staleExams.map((n) => <li key={n}>{n}</li>)}</ul>
              <div class="small muted" style="margin-top:6px">過期的模擬考要重新排座才能下載。</div>
            </Alert>
          )}
          <p class="muted small">偵測到的格式：{plan.layout === 'blocks' ? '各班並排（區塊標題）' : plan.layout === 'wide' ? '各班並排（表頭欄位）' : '一人一列'}</p>
          {plan.unknownClasses.length > 0 && (() => {
            const labels = plan.unknownClasses.map((n) => `${String(n).padStart(2, '0')} 班（${plan.unknownCounts[n] ?? 0} 人）`).join('、');
            const total = plan.unknownClasses.reduce((a, n) => a + (plan.unknownCounts[n] ?? 0), 0);
            return (
              <Alert tone="warn">
                <div>名單裡有「班級資料」沒有的班級：{labels}。請選一種處理方式：</div>
                <label class="small" style="display:block;margin-top:6px"><input type="radio" name="unk" checked={unk === 'add'} onChange={() => setUnk('add')} /> 新增這些班級（名稱先用「第NN班」，之後可到「班級資料」改名、改色），這 {total} 人照常匯入、可以排座</label>
                <label class="small" style="display:block"><input type="radio" name="unk" checked={unk === 'skip'} onChange={() => setUnk('skip')} /> 略過這些學生：這 {total} 人不會匯入名單，因此<strong>無法排座</strong>；之後要補，得先新增班級再重新匯入</label>
              </Alert>
            );
          })()}
          {outcome && outcome.count === 0 && <Alert tone="danger">這樣選會匯入 0 人，不會動到目前的名單。請改選「新增這些班級」，或先到「班級資料」新增班級。</Alert>}
          {parsed.issues.length > 0 && <Alert tone="warn">另有提醒：{parsed.issues.slice(0, 3).join('；')}{parsed.issues.length > 3 ? '…' : ''}；請核對原始檔。</Alert>}
          {parsed.problems.length > 0 && (
            <div class="stack" style="gap:4px" aria-label="有問題的列">
              <h4 style="margin:8px 0 0">有問題的列（{parsed.problems.length} 列，已決定 {parsed.problems.length - resolution.pending.length} 列）</h4>
              <p class="small muted">這些列不會被默默略過。請逐列決定：<b>手動補上（新增）</b>＝補齊缺的欄位後新增進名單；<b>修改內容</b>＝改正班級、座號、姓名或學號後加入名單；<b>確認無誤</b>＝這一列本來就是正確的，照原樣匯入（缺姓名的列＝保留為空位、不建立學生；只有「缺少姓名」「學號重複」可以）；<b>不匯入這列</b>（下方文字連結）＝這一列不匯入。全部決定完才能確認取代。</p>
              {parsed.problems.map((pr, i) => (
                <RowFix key={`${fileKey}-${i}`} where={`${parsed.sheetName ? `工作表「${parsed.sheetName}」` : ''}第 ${pr.row} 列`} kindText={PROBLEM_KIND_TEXT[pr.kind]} message={pr.message} cells={pr.cells} draft={pr.draft} withSchoolId classNames={classNames} {...(CONFIRMABLE.has(pr.kind) ? { confirmHint: pr.kind === 'no-name' ? '這一列保留為空位，不會建立學生。' : '這一列照原樣匯入，視為正確。' } : {})}
                  error={resolution.invalid[i] ?? ''} onDecide={(d) => decide(i, d === null ? null : d.mode === 'skip' ? { action: 'skip' } : d.mode === 'confirm' ? { action: 'confirm' } : { action: d.mode, ...d.value })} />
              ))}
            </div>
          )}
          {plan.tracks && p.division === 'senior' && (
            <label class="small" style="display:block;margin-top:8px">
              <input type="checkbox" checked={useTracks} onChange={(e) => setUseTracks(e.currentTarget.checked)} /> 同時更新共用班級資料的文理組，依名單的類組欄（
              {Object.entries(plan.tracks).map(([n, t]) => `${String(n).padStart(2, '0')}班${t === 'science' ? '理' : '文'}`).join('、')}
              ，其餘班級不變；所有模擬考都會套用）
            </label>
          )}
        </Modal>
      )}
    </>
  );
}

/**
 * G9：刪除目前所選部別與學年度的整份學生名單。高危險動作，與「匯出」分開（靠右、危險色），
 * 確認視窗寫明範圍、人數、受影響的模擬考，提供先匯出備份，並要求輸入確認字樣才能按。
 */
export function ClearRoster(p: { doc: Doc; division: Division; onChange: (d: Doc) => void }) {
  const [open, setOpen] = useState(false);
  const n = p.doc.rosters[p.division].length;
  const year = rosterYearOf(p.doc);
  const affected = open ? examsAffectedByClear(p.doc, p.division) : [];
  return (
    <>
      <span style="margin-left:auto" />
      <Button kind="danger" disabled={n === 0} title={n === 0 ? '名單已經是空的' : undefined} onClick={() => setOpen(true)}>刪除全部名單</Button>
      {open && (
        <ConfirmModal
          copy={{ title: `刪除全部名單：${DIV_NAME[p.division]}　${year} 學年度`, body: `會刪掉：${DIV_NAME[p.division]}　${year} 學年度的整份學生名單，共 ${n} 人。不會動：其他學年度、另一個部別的名單與班級資料。`, confirm: `刪除全部 ${n} 人` }}
          onConfirm={() => { p.onChange(syncDiffs(clearRoster(p.doc, p.division))); }} onClose={() => setOpen(false)}>
          <Alert tone="danger"><b>刪除後無法還原。</b>只有在關閉或重新整理頁面之前，才能按頁首「↶ 復原」找回；想保險請先匯出備份。</Alert>
          <div><Button onClick={async () => downloadBytes(`${DIV_NAME[p.division]}${year}學年度學生名單備份.xlsx`, await writeXlsx(exportRows(p.doc.rosters[p.division]), '學生名單'), XLSX_MIME)}>先匯出備份（下載 .xlsx）</Button></div>
          {affected.length > 0 ? (
            <Alert tone="warn">
              <b>這份名單已被 {affected.length} 個模擬考使用：</b>清空後這些考試的考生會變成 0 人，已排座的會標為「過期」。
              <ul style="margin:6px 0 0;padding-left:18px">{affected.map((a) => <li key={a.name}>{a.name}{a.willBeStale ? '（已排座，會變過期）' : ''}</li>)}</ul>
            </Alert>
          ) : <p class="small muted">目前沒有模擬考使用這份名單。</p>}
        </ConfirmModal>
      )}
    </>
  );
}
