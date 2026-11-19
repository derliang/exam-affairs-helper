import { useEffect, useRef, useState } from 'preact/hooks';
import './featureRegister/pickup';
import './featureRegister/lookup';
import './featureRegister/attendance';
import './featureRegister/alignment';
import './featureRegister/quick';
import { Footer } from './components/Footer';
import { AppBar, type AppBarItem, type Theme } from './components/AppBar';
import { StepSide } from './pages/StepSide';
import { Alert, Badge, Button, EmptyState, PageHead, StepDock, StepNav, StepNextContext, SummaryBar, UndoGroup } from './components';

import { enabledNav, enabledStepPanels, FeatureContext } from './features';
import { flowOf, nextAction, prevStepOf } from './flow';
import { scrollPageTop, backLabel, goBack, guardNav, goTo, initialNav, pushTo, stepTitle, type NavState, type Route } from './nav';
import { Exams } from './pages/Exams';
import { NewExam, type NewExamDraft } from './pages/NewExam';
import { Init } from './pages/Init';
import { EnvWizard } from './pages/EnvWizard';
import { WIZARD_STEPS } from './env';
import { Copyright } from './pages/Copyright';
import { Privacy } from './pages/Privacy';
import { Lookup } from './pages/Lookup';
import { Settings } from './pages/Settings';
import { Step1 } from './pages/Step1';
import { Step2 } from './pages/Step2';
import { Step3 } from './pages/Step3';
import { AstStep3 } from './ast/AstStep3';
import { onAstPlanReady, setPlanDefer } from './ast/model';
import { AstStep4 } from './ast/AstStep4';
import { AstStep5 } from './ast/AstStep5';
import { Step4 } from './pages/Step4';
import { Step5 } from './pages/Step5';
import { Step6 } from './pages/Step6';
import { AstStep6 } from './ast/AstStep6';
import { ReservePage } from './pages/ReservePage';
import { createFsRepository, encode, isFsAccessSupported } from '../data';
import { downloadBytes } from './download';
import { DiscardDialog, FolderDialog, FolderListError, FolderLostAlert, type FolderMode } from './pages/FolderUi';
import { formatModified } from './examList';
import { createMemoryRepository, emptyDoc, withDefaults, type Repository } from './repository';
import { deleteExam, examLabel, setExamArchived, stampModified, type Doc } from './store';
import { activateForExam, migrateRosterYear } from './rosterYears';
import { APP_VERSION, formatVersion } from './version';
import { describeChange } from './describeChange';
import { canUndo, commit, newHistory, nextUndoLabel, undo, undoSteps, undoTo, type History } from './undo';

// 支援資料夾授權的瀏覽器用真實存檔；不支援（非 Chrome）時用記憶體實作，並在初始化頁提示
const fsSupported = isFsAccessSupported();
const fsRepo = fsSupported ? createFsRepository() : null;
const repo: Repository = fsRepo ?? createMemoryRepository();

function useTheme(): [Theme, (t: Theme) => void] {
  const [t, setT] = useState<Theme>('system');
  useEffect(() => {
    const el = document.documentElement;
    if (t === 'system') el.removeAttribute('data-theme');
    else el.setAttribute('data-theme', t);
  }, [t]);
  return [t, setT];
}

export function App() {
  const [nav, setNav] = useState<NavState>(initialNav());
  const [theme, setTheme] = useTheme();
  const [hist, setHist] = useState<History<Doc>>(() => newHistory(emptyDoc()));
  const [warning, setWarning] = useState<string | undefined>();
  // 存檔失敗要看得見（#58）：存檔佇列的狀態，錯誤時顯示警示與重試
  const [saveErr, setSaveErr] = useState<string | undefined>();
  // G16：根資料夾不見了（被刪除、改名或移動）是另一種錯誤，重試不會成功，要給「重新連結／更換／放棄」出路
  const [folderMissing, setFolderMissing] = useState(false);
  const [folderDlg, setFolderDlg] = useState<FolderMode | 'discard' | null>(null);
  const hadFolder = useRef(false);
  const [, setRestoreTick] = useState(0);
  useEffect(() => repo.onSaveStatus?.((s) => { setSaveErr(s.state === 'error' ? s.message : undefined); setFolderMissing(s.state === 'error' && !!s.missing); }), []);
  // 切回這個分頁時確認資料夾還在，不等到存檔失敗才發現
  useEffect(() => {
    const chk = () => { if (document.visibilityState !== 'hidden') void fsRepo?.checkFolder(); };
    window.addEventListener('focus', chk); document.addEventListener('visibilitychange', chk);
    return () => { window.removeEventListener('focus', chk); document.removeEventListener('visibilitychange', chk); };
  }, []);
  const retrySave = () => { void repo.retrySave?.(); };
  const openFolderDlg = (m: FolderMode | 'discard') => { hadFolder.current = repo.hasFolder(); setFolderDlg(m); };
  const downloadBackup = () => {
    const stamp = formatModified(new Date().toISOString()).replace(/\D/g, '');
    downloadBytes(`考務小幫手-備份-${stamp}.json`, new TextEncoder().encode(encode(hist.present)), 'application/json');
  };
  // 重開頁面：能靜默還原上次資料夾就直接進列表（瀏覽器要求重新授權時留在初始化頁，由使用者按鈕）
  useEffect(() => {
    void (async () => { if (fsRepo && (await fsRepo.restore())) { await load(); go({ page: 'exams' }); } else setRestoreTick((n) => n + 1); })();
  }, []);

  // 資料夾授權後載入；每次變更存檔
  // 回傳是否為全新資料夾（G37：沒有設定檔的新資料夾才自動進首次使用精靈；既有資料夾只靠列表橫幅）
  const load = async (): Promise<boolean> => {
    const raw = await repo.load();
    const d = migrateRosterYear(withDefaults(raw));
    setHist(newHistory(d));
    setWarning(fsRepo?.lastWarning());
    if (d !== raw) void repo.save(d); // 全新資料夾：把預設班級存下來
    return d !== raw && !raw.settings.env && raw.exams.length === 0;
  };
  const afterLoad = (fresh: boolean) => go(fresh ? { page: 'wizard', step: 1 } : { page: 'exams' });
  const edit = (d0: Doc) => {
    const d = stampModified(hist.present, d0, new Date());
    setHist((h) => commit(h, d, describeChange(h.present, d))); setStaleNote(undefined); void repo.save(d);
  };
  // 更換／重新連結／搬到新位置（G16、G24）完成：需要時讀入新資料夾；帶著暫存修改過去的不重讀（重讀會蓋掉畫面上的修改）
  const folderDone = async (res: { carried: boolean; reload: boolean }) => {
    setFolderDlg(null); setWarning(undefined);
    let fresh = false;
    if (res.reload) { try { fresh = await load(); } catch { setWarning('新資料夾已選定，但讀取資料失敗，請改選別的資料夾或重新整理頁面。'); } }
    if (!hadFolder.current && fsRepo?.hasFolder()) afterLoad(fresh);
  };
  // 放棄找不到資料夾裡未存的修改：丟掉暫存、回到選擇資料夾畫面（可重新連結或選別的）
  const discardPending = () => {
    fsRepo?.release();
    setHist(newHistory(emptyDoc())); setFolderMissing(false); setSaveErr(undefined); setWarning(undefined); setFolderDlg(null);
    go({ page: 'init' });
  };
  // G1：封存／還原／刪除模擬考；只動 App 內資料，不碰使用者已下載的檔案
  const archiveExam = (id: string, archived: boolean) => { const r = setExamArchived(hist.present, id, archived); if (r.ok) edit(r.doc); };
  const removeExam = (id: string) => { const r = deleteExam(hist.present, id); if (r.ok) edit(r.doc); };
  const onUndo = () => setHist((h) => { const n = undo(h); void repo.save(n.present); return n; });
  const [staleNote, setStaleNote] = useState<string | undefined>();
  const onUndoTo = (index: number) => {
    const r = undoTo(hist, index);
    setHist(r.history); void repo.save(r.history.present);
    // 比選中那步更新的動作一併退掉，標為過期（D47），讓使用者知道要重做哪些
    setStaleNote(r.dropped.length > 1 ? `已回到「${r.dropped[r.dropped.length - 1]}」之前。後面 ${r.dropped.length - 1} 步已過期，需要時請重做：${r.dropped.slice(0, -1).reverse().join('、')}。` : undefined);
  };

  // 開啟某次考試：它的學年度已有自己的名單與班級就換成那一份（只是換視角，不進復原記錄；#208）
  const openExam = (examId: string) => {
    const e = hist.present.exams.find((x) => x.id === examId);
    if (!e) return;
    const d = activateForExam(hist.present, e);
    if (d === hist.present) return;
    setHist((h) => ({ ...h, present: d })); void repo.save(d);
  };
  const go = (r: Route) => setNav((s) => goTo(s, r));
  const go2 = (r: Route, from: { route: Route; label: string }) => setNav((s) => pushTo(s, r, from));
  const lookupOn = enabledNav({ settings: hist.present.settings }).some((n) => n.route.page === 'lookup');
  const allowed = (rt: Route) => rt.page !== 'lookup' || lookupOn;
  const gnav = guardNav(nav, allowed);
  const back = () => setNav(goBack(gnav));
  const r = gnav.route;
  // 記住最近開啟的模擬考，導覽列才能在任何頁面一鍵跳到它的步驟
  const [lastExamId, setLastExamId] = useState<string | undefined>();
  // #344：新增模擬考頁的草稿；去共用設定再「← 回到」時帶回，從列表重新按「新增」、取消或建立後清掉
  const newDraft = useRef<NewExamDraft | undefined>(undefined);
  useEffect(() => { if (r.page === 'step') setLastExamId(r.examId); }, [r]);
  const lastExam = hist.present.exams.find((e) => e.id === lastExamId);
  const hasFolder = r.page !== 'init' || repo.hasFolder();
  const stepExam = r.page === 'step' ? hist.present.exams.find((e) => e.id === r.examId) : undefined;
  // #253：考試頁讀的名單年度只看「這次考試的學年度」，不受共用設定停在哪個年度頁籤影響（新建、開啟、深連結都一樣）
  const stepDoc = stepExam ? activateForExam(hist.present, stepExam) : hist.present;
  // 路徑列（稿 v2.29）：模擬考列表 › 考試名稱 › 來源步驟；最後一個連結＝返回
  const listCrumb = { label: '模擬考列表', onClick: () => go({ page: 'exams' }) };
  const retCrumbs = (): { label: string; onClick: () => void }[] => {
    const last = gnav.back[gnav.back.length - 1];
    if (!last || last.route.page === 'exams') return [];
    if (last.route.page === 'step') {
      const lr = last.route;
      return [{ label: hist.present.exams.find((e) => e.id === lr.examId)?.name ?? '模擬考', onClick: () => go({ page: 'step', examId: lr.examId, step: 1 }) }, { label: stepTitle(lr.step, hist.present.exams.find((e) => e.id === lr.examId)?.kind), onClick: back }];
    }
    return [{ label: last.label, onClick: back }];
  };
  const pathCrumbs = [listCrumb, ...retCrumbs()];
  // 預備教室與抽離（H-9）：模擬考列表 › 考試名稱 › ⑤ 排座與預覽；最後一個連結＝返回（回到 ⑤）
  const reserveCrumbs = (examId: string) => [listCrumb, { label: hist.present.exams.find((e) => e.id === examId)?.name ?? '模擬考', onClick: () => go({ page: 'step', examId, step: 1 }) }, { label: stepTitle(5, hist.present.exams.find((e) => e.id === examId)?.kind), onClick: () => go({ page: 'step', examId, step: 5 }) }];
  // 全站品牌列導覽（稿 v2.31）：資料夾設定、模擬考列表、（已開啟的選用功能頁）、選用功能、共用設定
  const inSettings = r.page === 'settings';
  // 已在共用設定時只換分頁，不再疊一筆「回到」
  const toSettings = (to: Route) => (inSettings ? setNav((s) => ({ ...s, route: to })) : go2(to, barFrom));
  const barFrom = { route: r, label: pageName(r, hist.present) };
  const barItems: AppBarItem[] = [
    { id: 'init', label: '資料夾設定', current: r.page === 'init', onClick: () => go({ page: 'init' }) },
    { id: 'exams', label: '模擬考列表', current: ['exams', 'new', 'wizard', 'step', 'reconcile', 'override', 'reserve'].includes(r.page), disabled: !hasFolder, onClick: () => go({ page: 'exams' }) },
    ...(hasFolder ? enabledNav({ settings: hist.present.settings }).map((n) => ({ id: n.id, label: n.label, current: r.page === n.route.page, onClick: () => go2(n.route, barFrom) })) : []),
    { id: 'features', label: '選用功能', current: inSettings && r.tab === 'features', disabled: !hasFolder, onClick: () => toSettings({ page: 'settings', tab: 'features' }) },
    { id: 'settings', label: '共用設定', current: inSettings && r.tab !== 'features', disabled: !hasFolder, onClick: () => toSettings({ page: 'settings', ...(lastExam && r.page === 'step' ? { division: lastExam.division } : {}) }) },
  ];
  // 「↩ 回到 ○ 步」附條（稿 wsRet）：從別的步驟按「前往處理」過來才有，來源步驟與目前不同時顯示
  const lastBack = gnav.back[gnav.back.length - 1]?.route;
  const retStep = r.page === 'step' && lastBack?.page === 'step' && lastBack.examId === r.examId && lastBack.step !== r.step ? lastBack.step : undefined;
  const undoCtl = <UndoGroup undoLabel={nextUndoLabel(hist)} onUndo={() => { setStaleNote(undefined); onUndo(); }} steps={undoSteps(hist)} onUndoTo={onUndoTo} />;

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !(t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) && canUndo(hist)) { e.preventDefault(); onUndo(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  return (
    <FeatureContext.Provider value={hist.present.settings}>
      <AppBar version={formatVersion(APP_VERSION)} theme={theme} onTheme={setTheme} onHome={() => go({ page: 'exams' })} homeDisabled={!hasFolder} items={barItems} />
      <main class="wrap">
        {stepExam && r.page === 'step' && (
          <PageHead crumbs={[listCrumb]} title={stepExam.name} badge={examLabel(stepExam)} status="已儲存到資料夾">
            {undoCtl}
            <Button onClick={() => go2({ page: 'settings', division: stepExam.division }, { route: r, label: pageName(r, hist.present) })}>共用設定</Button>
          </PageHead>
        )}
        {r.page === 'settings' && (
          <PageHead crumbs={pathCrumbs} title="共用設定" badge="資料夾層級，所有模擬考共用">
            {undoCtl}
          </PageHead>
        )}
        {staleNote && r.page !== 'init' && <div style="margin-bottom:12px"><Alert tone="warn">{staleNote}</Alert></div>}
        {r.page === 'privacy' && <Privacy {...(backLabel(gnav) ? { backLabel: backLabel(gnav)! } : {})} onBack={() => (gnav.back.length ? back() : go({ page: hasFolder ? 'exams' : 'init' }))} onCopyright={() => go2({ page: 'copyright' }, { route: r, label: pageName(r, hist.present) })} />}
        {r.page === 'copyright' && <Copyright onPrivacy={() => go2({ page: 'privacy' }, { route: r, label: pageName(r, hist.present) })} {...(backLabel(gnav) ? { backLabel: backLabel(gnav)! } : {})} onBack={() => (gnav.back.length ? back() : go({ page: hasFolder ? 'exams' : 'init' }))} />}
        {r.page === 'init' && <Init repo={repo} fsSupported={fsSupported} {...(fsRepo ? { fs: fsRepo } : {})} doc={hist.present} missing={folderMissing} onDialog={openFolderDlg} onBack={() => go({ page: 'exams' })} onRestore={fsRepo ? async () => { const ok = await fsRepo.restore(); setRestoreTick((n) => n + 1); return ok; } : undefined} onDone={async () => { afterLoad(await load()); }} />}
        {folderMissing && fsRepo && r.page !== 'init' && <div style="margin-bottom:12px"><FolderLostAlert name={fsRepo.folderName?.() ?? ''} pending={fsRepo.pendingCount()} onRelink={() => openFolderDlg('relink')} onChange={() => openFolderDlg('change')} onDiscard={() => openFolderDlg('discard')} onSettings={() => go2({ page: 'init' }, { route: r, label: pageName(r, hist.present) })} /></div>}
        {saveErr && !folderMissing && <div style="margin-bottom:12px"><Alert tone="danger" action={<Button small onClick={retrySave}>重試存檔</Button>}>最新的修改還沒有存進資料夾（{saveErr}）。請確認資料夾仍可寫入後按「重試存檔」；在存妥之前請不要關閉頁面。</Alert></div>}
        {warning && r.page !== 'init' && <div style="margin-bottom:12px"><Alert tone="warn">{warning}</Alert></div>}
        {r.page === 'exams' && <Exams doc={hist.present} folder={repo.folderName?.()} onEnv={() => go({ page: 'wizard', step: 1 })} onOpen={(examId) => { openExam(examId); go({ page: 'step', examId, step: 1 }); }} onNew={() => { newDraft.current = undefined; go({ page: 'new' }); }} onSettings={() => go2({ page: 'settings' }, { route: r, label: pageName(r, hist.present) })} onChangeFolder={() => go2({ page: 'init' }, { route: r, label: pageName(r, hist.present) })} {...(folderMissing ? { listError: <FolderListError onRelink={() => openFolderDlg('relink')} /> } : {})} onArchive={(id) => archiveExam(id, true)} onRestore={(id) => archiveExam(id, false)} onDelete={removeExam} />}
        {r.page === 'new' && <NewExam doc={hist.present} draft={newDraft.current} onDraft={(d) => { newDraft.current = d; }} onCancel={() => { newDraft.current = undefined; go({ page: 'exams' }); }} onCreate={(d, examId) => { newDraft.current = undefined; edit(d); go({ page: 'step', examId, step: 1 }); }} onEnv={edit} onGoSettings={(tab, division) => go2({ page: 'settings', tab, division }, { route: r, label: pageName(r, hist.present) })} />}
        {r.page === 'wizard' && <EnvWizard doc={hist.present} step={r.step ?? 1} onStep={(step) => { setNav((s) => ({ ...s, route: { page: 'wizard', step } })); scrollPageTop(); }} onChange={edit} onGoSettings={(tab, division) => go2({ page: 'settings', tab, division }, { route: r, label: pageName(r, hist.present) })} onFinish={() => go({ page: 'exams' })} />}
        {r.page === 'lookup' && <Lookup doc={hist.present} examId={r.examId} crumbs={pathCrumbs} onGoStep={(examId, step) => go({ page: 'step', examId, step })} onExams={() => go({ page: 'exams' })} />}
        {r.page === 'settings' && <Settings doc={hist.present} onChange={edit} tab={r.tab} onTab={(tab) => setNav((s) => (s.route.page === 'settings' ? { ...s, route: { ...s.route, tab } } : s))} {...(r.division ? { division: r.division } : {})} />}
        {r.page === 'step' && <Workspace route={r} doc={stepDoc} onToRooms={(division) => go2({ page: 'settings', tab: 'rooms', division }, { route: r, label: pageName(r, hist.present) })} onToSchool={() => go2({ page: 'settings', tab: 'school' }, { route: r, label: pageName(r, hist.present) })} onToRoster={(division) => go2({ page: 'settings', tab: 'roster', division }, { route: r, label: pageName(r, hist.present) })} onChange={edit} onStep={(step) => go({ page: 'step', examId: r.examId, step })} onFix={(step) => go2({ page: 'step', examId: r.examId, step }, { route: r, label: pageName(r, hist.present) })} onReserve={() => go({ page: 'reserve', examId: r.examId })} ret={retStep} onRet={back} onExams={() => go({ page: 'exams' })} onRestore={(id) => archiveExam(id, false)} />}
        {r.page === 'reserve' && <ReservePage doc={hist.present} examId={r.examId} crumbs={reserveCrumbs(r.examId)} onGoStep={(step) => go({ page: 'step', examId: r.examId, step })} onExams={() => go({ page: 'exams' })} />}
        {(r.page === 'reconcile' || r.page === 'override') && <section><h2>{r.page}</h2><p class="muted">施工中</p></section>}
      </main>
      {folderDlg && folderDlg !== 'discard' && fsRepo && <FolderDialog mode={folderDlg} fs={fsRepo} pending={fsRepo.pendingCount()} onBackup={downloadBackup} onClose={() => setFolderDlg(null)} onDone={(res) => void folderDone(res)} />}
      {folderDlg === 'discard' && fsRepo && <DiscardDialog pending={fsRepo.pendingCount()} lost={undoSteps(hist).slice(0, fsRepo.pendingCount()).map((u) => u.label)} onBackup={downloadBackup} onConfirm={discardPending} onClose={() => setFolderDlg(null)} />}
      <Footer onCopyright={() => r.page !== 'copyright' && go2({ page: 'copyright' }, { route: r, label: pageName(r, hist.present) })} onPrivacy={() => r.page !== 'privacy' && go2({ page: 'privacy' }, { route: r, label: pageName(r, hist.present) })} />
    </FeatureContext.Provider>
  );
}

/** 「← 回到 …」要寫清楚是哪一頁（DESIGN 10.1） */
export function pageName(r: Route, doc: Doc): string {
  switch (r.page) {
    case 'exams': return '模擬考列表';
    case 'new': return '新增模擬考';
    case 'wizard': { const n = r.step ?? 1; return n >= 6 ? '首次設定 總覽' : `首次設定 第 ${n} 步 ${WIZARD_STEPS[n - 1]?.name ?? ''}`; }
    case 'settings': return '共用設定';
    case 'init': return '資料夾設定';
    case 'lookup': return '考生查詢';
    case 'copyright': return '使用授權';
    case 'privacy': return '隱私權政策';
    case 'reserve': return `「${doc.exams.find((e) => e.id === r.examId)?.name ?? '模擬考'}」預備教室與抽離`;
    case 'step': return `「${doc.exams.find((e) => e.id === r.examId)?.name ?? '模擬考'}」${stepTitle(r.step, doc.exams.find((e) => e.id === r.examId)?.kind)}`;
    default: return '上一頁';
  }
}

function Workspace(p0: { route: Extract<Route, { page: 'step' }>; doc: Doc; onToRoster: (division: 'senior' | 'junior') => void; onToRooms: (division: 'senior' | 'junior') => void; onToSchool: () => void; onChange: (d: Doc) => void; onStep: (n: 1 | 2 | 3 | 4 | 5 | 6) => void; onFix: (n: 1 | 2 | 3 | 4 | 5 | 6) => void; onReserve: () => void; ret?: number | undefined; onRet: () => void; onExams: () => void; onRestore?: (examId: string) => void }) {
  // G1：已封存的考試只能查看與下載；所有編輯（onChange）一律不生效，畫面上的編輯區停用，要編輯先還原
  const ro = !!p0.doc.exams.find((e) => e.id === p0.route.examId)?.archived;
  const p = ro ? { ...p0, onChange: (() => undefined) as (d: Doc) => void } : p0;
  const stackRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    for (const el of Array.from(stackRef.current?.children ?? [])) {
      const keep = el.classList.contains('archived-banner') || el.classList.contains('sumbar') || el.classList.contains('wsret');
      (el as HTMLElement & { inert: boolean }).inert = ro && p0.route.step !== 6 && !keep;
    }
  });
  // #249：分科 ③ 編輯座位時，排座統計延後到停手才重算；算完在這裡重畫（其他步驟永遠同步取得精確結果）
  const [, setPlanTick] = useState(0);
  useEffect(() => {
    const off = onAstPlanReady(() => setPlanTick((n) => n + 1));
    return () => { off(); setPlanDefer(false); };
  }, []);
  // G4：換步驟（下一步按鈕、左側步驟列、待處理的「前往處理」、返回）一律回到頁面頂端；同一步內編輯不會觸發
  useEffect(() => { scrollPageTop(); }, [p.route.examId, p.route.step]);
  const exam = p.doc.exams.find((e) => e.id === p.route.examId);
  if (!exam) {
    return <section><h2>{stepTitle(p.route.step)}</h2><EmptyState title="找不到這個模擬考" action={<Button kind="primary" onClick={p.onExams}>回模擬考列表</Button>}>它可能已被刪除，或資料夾換了。</EmptyState></section>;
  }
  setPlanDefer(exam.kind === 'ast' && p.route.step === 3);
  const flow = flowOf(p.doc, exam, p.route.step);
  const step = p.route.step;
  return (
    <StepNextContext.Provider value={{ action: nextAction(flow, step), onGo: p.onStep }}>
      <div class="ws">
      <aside class="side"><StepNav steps={flow.steps} onGo={(n) => p.onStep(n as 1 | 2 | 3 | 4 | 5 | 6)} /></aside>
      <div class="stack" style="min-width:0" ref={stackRef}>
        {ro && (
          <div class="archived-banner" role="status">
            <Badge tone="info">已封存</Badge>這次考試已封存：可以查看與下載，不能編輯。要編輯請先還原。
            {p.onRestore && <Button small kind="primary" onClick={() => p.onRestore!(exam.id)}>還原</Button>}
          </div>
        )}
        {p.ret && (
          <div class="row wsret"><Button onClick={p.onRet}>↩ 回到「{exam.name}」{stepTitle(p.ret, exam.kind)}</Button><span class="small muted">你是從那一步過來處理問題的</span></div>
        )}
        <SummaryBar flow={flow} onGo={p.onFix} />
        {step === 1 ? <Step1 doc={p.doc} exam={exam} onChange={p.onChange} />
          : step === 2 ? <Step2 doc={p.doc} exam={exam} onChange={p.onChange} onToRoster={() => p.onToRoster(exam.division)} />
          : step === 3 ? (exam.kind === 'ast' ? <AstStep3 doc={p.doc} exam={exam} onChange={p.onChange} onToRooms={() => p.onToRooms(exam.division)} onStep={p.onFix} /> : <Step3 doc={p.doc} exam={exam} onChange={p.onChange} onToRooms={() => p.onToRooms(exam.division)} onToSchool={p.onToSchool} onToRoster={() => p.onToRoster(exam.division)} />)
          : step === 4 ? (exam.kind === 'ast' ? <AstStep4 doc={p.doc} exam={exam} onChange={p.onChange} onStep={p.onFix} /> : <Step4 doc={p.doc} exam={exam} onChange={p.onChange} onStep={p.onFix} />)
          : step === 5 ? (exam.kind === 'ast' ? <AstStep5 doc={p.doc} exam={exam} onChange={p.onChange} onStep={p.onFix} /> : <Step5 doc={p.doc} exam={exam} onChange={p.onChange} onStep={p.onFix} onReserve={p.onReserve} />)
          : exam.kind === 'ast' ? <AstStep6 doc={p.doc} exam={exam} onGoStep={(n) => p.onFix(n)} onChange={p.onChange} onExams={p.onExams} />
          : <Step6 doc={p.doc} exam={exam} onGoStep={(n) => p.onFix(n)} onChange={p.onChange} onExams={p.onExams} />}
        {enabledStepPanels({ settings: p.doc.settings, examKind: exam.kind }, step).map((s) => <div key={s.featureId}>{s.render({ doc: p.doc, exam, onChange: p.onChange, onStep: p.onFix })}</div>)}
      </div>
      <aside class="side side-r">
        <StepDock action={nextAction(flow, step)} current={step} prev={prevStepOf(flow, step)} onGo={p.onStep} onExams={p.onExams} />
        <StepSide step={step} doc={p.doc} exam={exam} />
      </aside>
      </div>
    </StepNextContext.Provider>
  );
}
