import { useEffect, useRef, useState } from 'preact/hooks';
import type { ExamConfig, ExamEntry, RosterDiff, RosterDiffChoice } from '../../data';
import { hasPua, puaCodes, showPua, allResolved, applyDiffs, applyGroupChoice, compareRosters, groupDiffs, manyDiffs, type DiffGroup, diffsStale, isResolved, readXlsx, XlsError, refreshDiffs, validateResolved, type Sheet } from '../../import';
import { Alert, Badge, Button, ClassChip, ConfirmButton, More, PageHead, Seg, StatsBar, StepHead } from '../components';
import { confirmCopy } from '../flow';
import { addClass, diffOptions, examYear, rosterName, syncDiffs, updateExam, type Doc } from '../store';
import { rosterYearMismatch, rosterYearOf } from '../rosterYears';
import { previewChoice } from '../step2';
import { ImportWizard, scanOptionsFor } from './ImportWizard';
import { RosterIO } from './RosterIO';

/** 差異卡標題（稿 v2.34 H-6 的 7 種情形；「班級或座號不同」「姓名不同」由兩邊內容判斷） */
export const titleOf = (d: RosterDiff): string => {
  if (d.kind === 'only-in-exam') return '考試名單有，學生名單沒有';
  if (d.kind === 'only-in-roster') return '學生名單有，考試名單沒有';
  if (d.kind === 'group-diff') return '同一人的組別不同';
  if (d.kind === 'new-class') return '考試名單有這個班級，班級資料沒有';
  return d.exam && d.roster && d.exam.classNo === d.roster.classNo && d.exam.seatNo === d.roster.seatNo ? '相同班級與座號，但姓名不同' : '同一人的班級或座號不同';
};
const CHOICE_TEXT: Record<RosterDiffChoice, string> = {
  'use-exam': '以考試名單為準', 'use-roster': '以學生名單為準', manual: '手動編輯',
  'add-class': '新增班級', 'remap-class': '改成既有班級', 'skip-class': '不匯入這班',
};
const GROUP_META: Record<DiffGroup, { title: string; desc: string }> = {
  A: { title: 'A 疑似缺字', desc: '同座號，一邊姓名是另一邊的一部分，或兩邊只差一個字（例：「王小明」↔「王小」、「王小明」↔「王曉明」）。多半是漏字、截斷或打錯字。' },
  B: { title: 'B 座號相同、姓名完全不同', desc: '座號對得上，但兩邊姓名沒有包含關係。' },
  C: { title: 'C 缺漏', desc: '只在一邊有的人（考試名單有、學生名單沒有，或相反）。' },
};
const optionsOf = (d: RosterDiff): RosterDiffChoice[] =>
  d.kind === 'new-class' ? ['add-class', 'remap-class', 'skip-class'] : d.kind === 'group-diff' ? ['use-exam', 'use-roster'] : ['use-exam', 'use-roster', 'manual'];

/**
 * ② 考試名單（D63）：匯入大考中心格式名單 → 與學生名單比對（D42/D54/D64）。
 * 總覽（狀態 alert、本次考試名單、誰會參加、各班人數／比對、學生名單快照）與獨立的逐筆比對畫面（原型 vCmp）。
 */
export function Step2(p: { doc: Doc; exam: ExamConfig; onChange: (d: Doc) => void; onToRoster: () => void }) {
  const { exam, doc } = p;
  const roster = doc.rosters[exam.division];
  const files = doc.examFiles?.[exam.id];
  const entries: ExamEntry[] | null = files?.entries ?? null;
  const diffs: RosterDiff[] = files?.diffs ?? [];
  /** 考試名單與比對結果存在 doc.examFiles，隨整份快照復原 */
  const save = (patch: Partial<NonNullable<Doc['examFiles']>[string]>, extra: Partial<Doc> = {}) =>
    p.onChange({ ...doc, ...extra, examFiles: { ...doc.examFiles, [exam.id]: { ...files, ...patch } } });
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [showCmp, setShowCmp] = useState(false);
  const [err, setErr] = useState('');
  const [applyErr, setApplyErr] = useState('');
  /** 套用後列出「以學生名單為準」而清掉考科與 X／＋ 標示的人（Q5 已知限制） */
  const [lost, setLost] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);

  const fullyAbsent = entries ? entries.filter((e) => e.subjectIds.length === 0).length : 0;
  const classNames = doc.settings.classes.filter((c) => c.division === exam.division).map((c) => c.name);
  const dopts = diffOptions(doc, exam);
  const compare = (list: ExamEntry[]) => compareRosters(roster, list, dopts);

  // 共用名單、考試名單任一改變，已存的差異就過期：重算並只沿用內容完全相同的選擇（#60）
  const stale = !!entries && diffsStale(diffs, refreshDiffs(roster, entries, diffs, dopts));
  useEffect(() => {
    if (entries && stale) save({ diffs: refreshDiffs(roster, entries, diffs, dopts) });
  }, [stale, roster, entries]);

  const onFile = async (file: File) => {
    setErr('');
    try {
      const s = await readXlsx(await file.arrayBuffer());
      if (s.length === 0) setErr('檔案裡沒有工作表');
      else setSheets(s);
    } catch (e) {
      setErr(e instanceof XlsError ? e.message : `讀不了這個檔案：${e instanceof Error ? e.message : String(e)}。請確認是 .xlsx 檔`);
    }
  };

  const adopt = (list: ExamEntry[], markMap: Record<string, string>) => {
    const settings = { ...doc.settings, markMap };
    const d = compare(list).diffs;
    save({ entries: list, diffs: d }, { settings });
    setLost([]);
    setSheets(null);
    setShowCmp(d.length > 0); // 有差異就直接進逐筆比對（原型：匯入並比對）
  };

  const setChoice = (code: string, choice: RosterDiffChoice, edited?: RosterDiff['edited'], targetClassNo?: number) =>
    save({ diffs: diffs.map((d) => (d.code === code ? { ...d, choice, edited, targetClassNo } : d)) });

  /** 全部處理完才套用：學生名單與考試名單依選擇更新（一次 onChange，可復原） */
  const apply = (): boolean => {
    if (!entries) return false;
    const groupTable = scanOptionsFor(exam, []).groupTable;
    const r = applyDiffs(roster, entries, diffs, { subjectsOfGroup: (k) => groupTable?.[k] });
    const bad = validateResolved(r, new Set([...classes.map((c) => c.no), ...r.addedClasses]));
    if (bad) { setApplyErr(bad); return false; } // 有碰撞就不寫入任何一份名單（#67）
    // 選了「新增班級」：先把班級加進班級資料（名稱先用「第NN班」，可到共用設定改），任一班加不成就整批不套用
    let next: Doc = { ...doc, rosters: { ...doc.rosters, [exam.division]: r.students } };
    for (const no of r.addedClasses) {
      const added = addClass(next, exam.division, { no });
      if (!added.ok) { setApplyErr(added.error); return false; }
      next = added.doc;
    }
    setApplyErr('');
    // 組別不同：這位若有記下個別 X／＋（C-9），套用時已疊回新組別預設，沒有被清掉，不列入警示
    const keepsMarks = (d: RosterDiff) => d.kind === 'group-diff' && !!d.exam && entries.some((e) => e.classNo === d.exam!.classNo && e.seatNo === d.exam!.seatNo && ((e.absentSubjectIds?.length ?? 0) > 0 || (e.extraSubjectIds?.length ?? 0) > 0));
    setLost(diffs.filter((d) => d.choice === 'use-roster' && (d.kind === 'only-in-exam' || d.kind === 'only-in-roster' || d.kind === 'group-diff') && !keepsMarks(d))
      .map((d) => who(d.exam ?? d.roster)));
    p.onChange({ ...next, examFiles: { ...doc.examFiles, [exam.id]: { ...files, entries: r.entries, diffs: [] } } });
    return true;
  };

  const resolved = diffs.filter(isResolved).length;
  const grouped = groupDiffs(diffs);
  /** 會考全員參加：沒匯入名單時，學生名單就是考試名單，這一步視為完成 */
  const bcctAll = exam.kind === 'bcct' && entries === null;
  const done = bcctAll ? roster.length > 0 : entries !== null && diffs.length === 0;
  const notJoin = entries ? compare(entries).notParticipating : 0;
  /** D146：不參加＝名冊有、考試名單沒有的人＋考試名單上一科都沒報的人，合併成一個人數 */
  const outCount = notJoin + fullyAbsent;
  const outWho = entries ? [...(() => { const inList = new Set(entries.map((e) => `${e.classNo}-${e.seatNo}`)); return roster.filter((s) => !inList.has(`${s.classNo}-${s.seatNo}`)); })(), ...entries.filter((e) => e.subjectIds.length === 0)] : [];
  const classes = doc.settings.classes.filter((c) => c.division === exam.division);
  /** 「恭班 45 號　張小翔」：班名＋座號＋姓名（原型寫法） */
  const who = (x?: { classNo: number; seatNo: number; name: string }) => (x ? `${classes.find((c) => c.no === x.classNo)?.name ?? x.classNo}班 ${x.seatNo} 號　${x.name}` : "—");
  const gtext = (g?: string) => (g ? `　組別 ${g}` : '');
  /** 組別照名單原樣顯示（代碼＋名稱，例「0-全科」），比對用的首字代碼只當找不到原文時的備用（C-2、C-6） */
  const sameId = (a: { classNo: number; seatNo: number }, b?: { classNo: number; seatNo: number }) => !!b && a.classNo === b.classNo && a.seatNo === b.seatNo;
  const groupOf = (side: 'exam' | 'roster', x: { classNo: number; seatNo: number }, key?: string) =>
    gtext((side === 'exam' ? (entries ?? []).find((e) => sameId(x, e))?.groupCode : roster.find((s) => sameId(x, s))?.groupCode) || key);
  const clsLabel = (no: number) => `第${String(no).padStart(2, '0')}班`;
  const perClass = classes.map((c) => ({ c, n: roster.filter((s) => s.classNo === c.no).length }));
  const filePick = (
    <input ref={input} type="file" accept=".xlsx" hidden aria-label="選擇考試名單 Excel 檔"
      onChange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (f) void onFile(f); }} />
  );

  // 名單比對：獨立的逐筆處理畫面；「先不處理」回到總覽，已選的先留著
  if (entries && diffs.length > 0 && showCmp) {
    return (
      <section class="stack" style="max-width:860px">
        <PageHead crumbs={[{ label: `「${exam.name}」② 考試名單`, onClick: () => setShowCmp(false) }]} title="名單比對" badge={exam.name} />
        <div class="card stack">
          <p>匯入「{exam.name}」考試名單後，和共用學生名單比對，找到 <b>{diffs.length}</b> 筆差異；全部處理完才能繼續排座。</p>
          <More title="說明：每一筆怎麼處理">每一筆選一種處理方式（多數是：以考試名單為準、以學生名單為準，或兩邊都不對就手動編輯）。上方 A／B／C 分組可以整組一次套用；選「以考試名單為準」會改到所有模擬考共用的名單。</More>
          <StatsBar items={[{ label: '差異', value: diffs.length }, { label: '已處理', value: resolved }, { label: '未處理', value: diffs.length - resolved, bad: diffs.length - resolved > 0 }]} />
        </div>
        {manyDiffs(diffs.length, Math.max(roster.length, entries.length)) && (
          <Alert tone="warn"><b>差異很多（{diffs.length} 筆，超過名單的 30%），名單可能不是同一個年度／學期的名冊。</b>請先確認「共用設定 → 學生名單」的年度是否對，再決定要不要整組套用。</Alert>
        )}
        {(['A', 'B', 'C'] as DiffGroup[]).map((g) => {
          const list = grouped[g];
          if (list.length === 0) return null;
          const meta = GROUP_META[g];
          const left = list.filter((d) => !isResolved(d)).length;
          const batch = (choice: 'use-exam' | 'use-roster') => save({ diffs: applyGroupChoice(diffs, g, choice) });
          const btn = (choice: 'use-exam' | 'use-roster') => {
            const text = `整組${CHOICE_TEXT[choice]}`;
            const kind = g === 'A' && choice === 'use-roster' ? 'primary' : 'default';
            return g === 'B'
              ? <ConfirmButton kind={kind} undoable copy={{ title: '整組套用？', body: `這 ${list.length} 筆姓名完全不同，可能不是同一人。確定${text}？${choice === 'use-exam' ? '這會改到所有模擬考共用的名單。' : ''}`, confirm: '確定套用' }} onConfirm={() => batch(choice)}>{text}</ConfirmButton>
              : <Button kind={kind} onClick={() => batch(choice)}>{text}</Button>;
          };
          return (
            <div class="card stack" style="gap:10px" key={`grp-${g}`}>
              <div class="row" style="gap:8px;flex-wrap:wrap"><b>{meta.title}</b><Badge tone="warn">{list.length} 筆</Badge>{g === 'A' && <Badge>建議：以學生名單為準</Badge>}{left === 0 && <Badge tone="ok">已處理</Badge>}</div>
              <div class="small muted">{meta.desc}</div>
              {g === 'B' && <Alert tone="warn"><b>可能不是同一人，名冊版本不同？</b>（座號對得上但姓名沒有任何重疊字）</Alert>}
              <details><summary class="small">展開明細（{list.length} 筆）</summary>
                <div class="scroll"><table class="t compact nw"><thead><tr><th>班級座號</th><th>考試名單</th><th>學生名單</th></tr></thead><tbody>
                  {list.map((d) => { const at = (d.exam ?? d.roster)!; return <tr key={d.code}><td>{classes.find((c) => c.no === at.classNo)?.name ?? at.classNo} {String(at.seatNo).padStart(2, '0')}</td><td>{d.exam?.name ?? '—（沒有）'}</td><td>{d.roster?.name ?? '—（沒有）'}</td></tr>; })}
                </tbody></table></div>
              </details>
              <div class="row" style="gap:8px;flex-wrap:wrap">{btn('use-exam')}{btn('use-roster')}</div>
              <div class="small muted">「以考試名單為準」<b>會改到所有模擬考共用的名單</b>。</div>
            </div>
          );
        })}
        {diffs.map((d, i) => {
          const picked = isResolved(d);
          const nc = d.kind === 'new-class';
          const members = d.members ?? [];
          const cno = members[0]?.classNo ?? 0;
          return (
            <div class="card stack" style="gap:12px" key={d.code}>
              <div class="row" style="justify-content:space-between">
                <Badge tone="warn">{`${i + 1}／${diffs.length}　${titleOf(d)}`}</Badge>
                {picked ? <Badge tone="ok">{`已選：${CHOICE_TEXT[d.choice as RosterDiffChoice]}`}</Badge> : <Badge>未處理</Badge>}
              </div>
              <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr))">
                {nc ? (
                  <>
                    <div class="fact"><b>考試名單</b>{`${clsLabel(cno)} ${members.length} 人（${members.map((m) => `${m.seatNo} 號　${m.name}`).join('、')}）`}</div>
                    <div class="fact"><b>學生名單</b>{`（班級資料沒有「${clsLabel(cno)}」）`}</div>
                  </>
                ) : (
                  <>
                    <div class="fact"><b>考試名單</b>{d.exam ? (hasPua(d.exam.name) ? who({ ...d.exam, name: showPua(d.exam.name) }) : who(d.exam)) + groupOf('exam', d.exam, d.kind === 'group-diff' ? d.groups?.exam : undefined) : '（沒有這個人）'}</div>
                    <div class="fact"><b>學生名單</b>{d.roster ? who(d.roster) + groupOf('roster', d.roster, d.kind === 'group-diff' ? d.groups?.roster : undefined) : '（沒有這個人）'}</div>
                  </>
                )}
                {d.exam && hasPua(d.exam.name) && <div class="fact"><b>提醒</b>考試名單的姓名含造字區碼位（{puaCodes(d.exam.name).join('、')}，不是標準字，印出來可能是空白）。建議選「以學生名單為準」。</div>}
              </div>
              <Seg<RosterDiffChoice> className="cmpseg" label={`第 ${i + 1} 筆處理方式`} value={(d.choice ?? '') as RosterDiffChoice}
                onChange={(v) => {
                  setEditing(v === 'manual' ? d.code : null);
                  setChoice(d.code, v, v === 'manual' ? d.edited : undefined, v === 'remap-class' ? (d.targetClassNo ?? classes[0]?.no) : undefined);
                }}
                options={optionsOf(d).map((v) => ({ value: v, label: nc && v === 'add-class' ? `新增班級「${clsLabel(cno)}」` : nc && v === 'skip-class' ? `不匯入這班（${members.length} 人）` : CHOICE_TEXT[v] }))} />
              {!nc && (
                <ul class="hint diff-preview" aria-label="選擇後的結果預告" style="margin:0;padding-left:18px">
                  {(['use-exam', 'use-roster'] as const).map((v) => (
                    <li key={v}>{d.choice === v ? <b>{CHOICE_TEXT[v]}（已選）：</b> : <>{CHOICE_TEXT[v]}：</>}{previewChoice(d, v)}</li>
                  ))}
                </ul>
              )}
              {nc && <More title="說明：新增班級會怎樣"><span class="hint">選「新增班級」會當場在班級資料多一班（名稱先用「{clsLabel(cno)}」，之後可到共用設定改），不用先離開去設定頁。</span></More>}
              {nc && d.choice === 'remap-class' && (
                <div class="field"><label>這班的人改到哪一班
                  <select class="input" value={String(d.targetClassNo ?? '')} onChange={(e) => setChoice(d.code, 'remap-class', undefined, Number(e.currentTarget.value))}>
                    {classes.map((c) => <option key={c.no} value={String(c.no)}>{c.name}（{String(c.no).padStart(2, '0')}）</option>)}
                  </select></label>
                  <span class="hint">座號照原樣帶過去；目標班級同座號已有人時，套用會擋下並指出是哪兩人。</span></div>
              )}
              {d.choice === 'manual' && (editing === d.code || !d.edited) && <Editor diff={d} classNos={classes.map((c) => c.no)} onSave={(e) => { setChoice(d.code, 'manual', e); setEditing(null); }} />}
              {d.choice === 'manual' && d.edited && editing !== d.code && <div class="hint">已改為 {who(d.edited)}　<Button small onClick={() => setEditing(d.code)}>再改</Button></div>}
            </div>
          );
        })}
        {applyErr && <Alert tone="danger"><b>沒有套用，兩份名單都維持原樣。</b>{applyErr}</Alert>}
        <div class="row" style="justify-content:flex-end">
          <Button onClick={() => setShowCmp(false)}>先不處理</Button>
          <Button kind="primary" disabled={!allResolved(diffs)} onClick={() => { if (apply()) setShowCmp(false); }}>
            {allResolved(diffs) ? `套用 ${diffs.length} 筆核對結果` : `還有 ${diffs.length - resolved} 筆沒選`}
          </Button>
        </div>
        <p class="small muted">按鈕在全部選完前停用。</p>
      </section>
    );
  }

  const puaList = entries ? entries.filter((e) => hasPua(e.name)) : [];
  const puaAlert = puaList.length > 0
    ? <Alert tone="warn"><b>{puaList.length} 位考生姓名含造字區字元</b>（{puaList.slice(0, 5).map((e) => `${e.classNo}班${e.seatNo}號 ${puaCodes(e.name).join('、')}`).join('；')}{puaList.length > 5 ? '…' : ''}）。造字區字元不是標準字，印出來可能是空白；若學生名單有標準寫法，比對時請以學生名單為準。</Alert>
    : null;
  const status = !entries && bcctAll
    ? (roster.length > 0
      ? <Alert tone="ok" action={<Button onClick={() => input.current?.click()}>仍要匯入考試名單</Button>}><b>全員參加，不需匯入。</b>會考每位同學都考，學生名單就是考試名單（共 {roster.length} 人）；只有要記錄缺考時才需要匯入。</Alert>
      : null)
    : !entries
    ? <Alert tone="warn" action={<Button kind="primary" onClick={() => input.current?.click()}>匯入本次考試名單</Button>}><b>還沒有匯入本次考試名單。</b>匯入後會和共用學生名單比對，排座前要處理完所有差異。</Alert>
    : diffs.length > 0 && resolved === diffs.length
      ? <Alert tone="info" action={<Button kind="primary" onClick={() => { void apply(); }}>套用 {diffs.length} 筆核對結果</Button>}><b>差異都選好了</b>（共 {diffs.length} 筆）：按「套用」才會更新學生名單與考試名單；也可以先<button type="button" class="linkbtn" onClick={() => setShowCmp(true)}>回頭檢查</button>。</Alert>
    : diffs.length > 0
      ? <Alert tone="warn" action={<Button kind="primary" onClick={() => setShowCmp(true)}>處理差異</Button>}><b>還有 {diffs.length - resolved} 筆差異沒處理</b>：共 {diffs.length} 筆，全部處理完才能繼續排座。</Alert>
      : <Alert tone="ok" action={<ConfirmButton kind="default" undoable copy={confirmCopy.reimportList(entries.length)} onConfirm={() => input.current?.click()}>再匯入一次</ConfirmButton>}><b>已比對：</b>考試名單與學生名單沒有未處理的差異。</Alert>;

  const sn = rosterName(exam.division);
  const reimport = entries
    ? <ConfirmButton kind="default" undoable copy={confirmCopy.reimportList(entries.length)} onConfirm={() => input.current?.click()}>再匯入一次</ConfirmButton>
    : null;
  const headBadge = !entries && bcctAll ? <Badge tone="ok">全員參加，不需匯入</Badge>
    : !entries ? <Badge tone="warn">尚未匯入</Badge>
    : diffs.length > 0 && resolved === diffs.length ? <Badge tone="info">差異 {diffs.length} 筆・已選好，待套用</Badge>
    : diffs.length > 0 ? <Badge tone="warn">差異 {diffs.length - resolved} 筆待處理</Badge>
    : <Badge tone="ok">✓ 已比對，沒有差異</Badge>;

  // G8：學生名單（共用設定那一份）與本次考試名單分成兩區；名單是空的就在這裡直接匯入，已有名單就改成「修改學生名單」
  const bcct = exam.kind === 'bcct';
  const rosterEmpty = roster.length === 0;
  const rosterCard = (
    <div class="card stack" aria-label={`${sn}（共用設定）`}>
      <div class="row" style="justify-content:space-between;gap:10px">
        <div class="row" style="gap:10px"><h3>{sn}（共用設定）</h3>{rosterEmpty ? <Badge tone="warn">尚未匯入</Badge> : <Badge tone="ok">{roster.length} 人</Badge>}</div>
        {!rosterEmpty && <Button kind="primary" onClick={p.onToRoster}>修改{sn}</Button>}
      </div>
      <div class="row" style="gap:8px">
        <span class="small muted">名單年度：{rosterYearOf(doc)} 學年</span>
        {rosterYearMismatch(doc, exam) && <Badge tone="warn">年度不符</Badge>}
      </div>
      {rosterYearMismatch(doc, exam) && (
        <Alert tone="warn">這次考試是 {examYear(exam)} 學年度，但目前的{sn}是 {rosterYearOf(doc)} 學年度的名單，比對結果可能不準。請到「共用設定 → 學生名單」切換或新增 {examYear(exam)} 學年度並匯入名單。</Alert>
      )}
      {rosterEmpty ? (
        <>
          <Alert tone="warn"><b>{sn}是空的。</b>請直接在下面匯入：名單會同時寫進「共用設定 → 學生名單」和這一步，是同一份資料，在哪邊修改都會同步。{bcct ? '會考不需要匯入考試名單，只要有學生名單就能排座。' : '建議先匯入學生名單，再匯入本次考試名單，否則比對時所有考生都會列為差異。'}</Alert>
          <div class="card stack" style="border:2px dashed var(--accent-line);background:var(--accent-soft)" aria-label="匯入學生名單">
            <b>匯入{sn}</b>
            <div class="btnrow"><RosterIO doc={doc} division={exam.division} onChange={p.onChange} variant="zone" /></div>
            <span class="small muted">匯入前會先讓你預覽；有問題的列會逐列問你怎麼處理，確認後才寫入，之後可用頁首「↶ 復原」回到匯入前。</span>
          </div>
        </>
      ) : (
        <>
          <div class="row" style="gap:10px 22px">
            <span class="label" style="margin:0">各班人數</span>
            {perClass.map(({ c, n }) => <span class="row" style="gap:6px" key={c.no}><ClassChip colorIndex={c.colorIndex}>{c.name}</ClassChip><b class="num" style="font-size:17px">{n}</b></span>)}
            {perClass.length === 0 && <span class="small muted">共用設定還沒有這個部別的班級。</span>}
            <span class="muted">合計 <b class="num">{roster.length}</b></span>
          </div>
          <p class="small muted">要新增、修改或匯入新的{sn}，請按「修改{sn}」到共用設定處理；改完按頁首路徑列的「{exam.name}」「② 考試名單」就會回到這一步。</p>
        </>
      )}
    </div>
  );

  // 會考：只有學生名單（全員參加）；要記錄缺考才需要另外匯入考試名單
  if (bcctAll) {
    return (
      <section class="stack">
        <StepHead title="② 考試名單" />
        {rosterCard}
        {!rosterEmpty && status}
        {filePick}
        {err && <Alert tone="danger">{err}</Alert>}
        {sheets && (
          <ImportWizard sheets={sheets} exam={exam} classNames={classNames} trackOf={(n) => doc.settings.classes.find((c) => c.division === exam.division && c.no === n)?.track} previous={entries ?? undefined} saved={doc.settings.markMap ?? {}}
            onCancel={() => setSheets(null)} onDone={adopt} />
        )}
      </section>
    );
  }

  // 稿 v2.22（校-60）：步驟② 學生名單、本次考試名單各一區；待處理時才多一則帶動作的提示
  return (
    <section class="stack">
      <StepHead title="② 考試名單" />
      {rosterCard}
      <div class="card stack">
        <div class="row" style="justify-content:space-between;gap:10px">
          <div class="row" style="gap:10px"><h3>本次考試名單{bcct ? '' : '（含考科、組別）'}</h3>{headBadge}</div>
          {reimport}
        </div>
        {done && !diffs.length ? null : status}
        {puaAlert}
        {lost.length > 0 && !diffs.length && (
          <Alert tone="warn" action={<Button small onClick={() => setLost([])}>知道了</Button>}>
            <b>「以學生名單為準」影響了 {lost.length} 人：</b>{lost.join('、')}。他們在考試名單上原本的考科與 X／＋ 標示已清掉（或沒有考科），請到 ④ 或個別覆寫確認。
          </Alert>
        )}
        {filePick}
        {err && <Alert tone="danger">{err}</Alert>}
        <div class="row" style="gap:12px;justify-content:space-between">
          <div class="row" style="gap:10px">
            <Badge>考試名單.xlsx</Badge>
            <span class="muted small">{entries ? `已匯入 ${entries.length} 筆` : '尚未匯入'}</span>
            {entries && diffs.length > 0 && (
              <ConfirmButton kind="default" small undoable copy={confirmCopy.reimportList(entries.length)} onConfirm={() => input.current?.click()}>重新匯入</ConfirmButton>
            )}
          </div>
        </div>
        <p class="small muted">匯入接受 .xlsx 檔；舊版 .xls 請先用 Excel 另存新檔成 .xlsx。</p>
        <p class="small muted">學生名單＝全體學生；考試名單＝每位學生報名這次考試的情況。學生名單裡有、但考試名單沒有的人，以及考試名單上一科都沒報的人，都是不參加：{exam.kind !== 'bcct'
          ? '每節都是自習生，不算考生、不印標籤，一樣進排座（考生多數則自習生抽離，反之考生抽離），座位表上列出班級、座號、姓名。'
          : '會考仍一樣排座位（頂多該座位沒人坐），座位表上列出、不印標籤。'}</p>
        {entries && exam.kind === 'gsat' && roster.length > 0 && outCount / roster.length >= 0.2 && (
          <Alert tone="warn">不參加 {outCount} 人（{Math.round((outCount / roster.length) * 100)}%）。學測通常人人報名，請確認考試名單是否漏列。</Alert>
        )}
        {outCount > 0 && (
          <Alert tone="info">
            不參加 {outCount} 人：每節都是自習生，一樣排座（不印標籤、不計領卷份數）。
            <details><summary class="small">列出是誰</summary><ul>{outWho.map((e) => <li key={`${e.classNo}-${e.seatNo}`}>{who(e).replace(/　.*$/, '')}</li>)}</ul></details>
          </Alert>
        )}
        {sheets && (
          <ImportWizard sheets={sheets} exam={exam} classNames={classNames} trackOf={(n) => doc.settings.classes.find((c) => c.division === exam.division && c.no === n)?.track} previous={entries ?? undefined} saved={doc.settings.markMap ?? {}}
            onCancel={() => setSheets(null)} onDone={adopt} />
        )}
        {entries && <div class="small muted">考生 {entries.length - fullyAbsent} 人，不參加 {outCount} 人</div>}
      </div>
    </section>
  );
}

/** 手動編輯：在該筆原地改班級、座號、姓名（D54） */
function Editor(p: { diff: RosterDiff; classNos: readonly number[]; onSave: (e: NonNullable<RosterDiff['edited']>) => void }) {
  const base = p.diff.edited ?? p.diff.exam ?? p.diff.roster ?? { classNo: 1, seatNo: 1, name: '' };
  const [c, setC] = useState(String(base.classNo));
  const [s, setS] = useState(String(base.seatNo));
  const [n, setN] = useState(base.name);
  const cn = Number(c), sn = Number(s);
  const msg = !Number.isInteger(cn) || !p.classNos.includes(cn) ? '班級不存在，請先到「班級資料」新增'
    : !Number.isInteger(sn) || sn < 1 || sn > 99 ? '座號要是 1～99 的整數' : n.trim() === '' ? '姓名不能空白' : '';
  const ok = msg === '';
  return (
    <div class="stack">
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr));align-items:start">
        <div class="field"><label>班級<input class="input" aria-label="班級" inputMode="numeric" value={c} onInput={(e) => setC(e.currentTarget.value)} /></label></div>
        <div class="field"><label>座號<input class="input" aria-label="座號" inputMode="numeric" value={s} onInput={(e) => setS(e.currentTarget.value)} /></label></div>
        <div class="field"><label>姓名<input class="input" aria-label="姓名" value={n} onInput={(e) => setN(e.currentTarget.value)} /></label></div>
      </div>
      <div class="row"><Button small kind="primary" disabled={!ok} onClick={() => p.onSave({ classNo: Number(c), seatNo: Number(s), name: n.trim() })}>確認修正</Button>
        <span class={msg ? 'field-msg' : 'hint'}>{msg || '改完就算處理好，套用時以這裡的資料為準。'}</span></div>
    </div>
  );
}
