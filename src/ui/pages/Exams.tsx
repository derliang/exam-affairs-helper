import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { ExamConfig } from '../../data';
import { Alert, Badge, Button, ConfirmModal, EmptyState, PageHead } from '../components';
import { rosterChanged } from '../rosterIO';
import { examHeadcount, examLevel, examProgress, formatModified, sortExams } from '../examList';
import { dateRangeText, groupExams, todayTaipei } from '../examDates';
import { examLabel, lastModified, examYear, type Doc } from '../store';
import { envBanner } from '../env';

/** 模擬考（DESIGN 10.x）：頁首 h1＋資料夾 chip，每列有六格進度條、學年與人數、最後修改；依最後修改由新到舊 */
/** 刪除考試前的確認（G1；#413 第 2 項、D163：標準 ConfirmModal，不輸入名稱）：單場與多場同一個視窗，寫明會刪什麼、不會動什麼 */
export function DeleteExamModal(p: { exam?: ExamConfig; exams?: ExamConfig[]; onConfirm: () => void; onClose: () => void }) {
  const list = p.exams ?? (p.exam ? [p.exam] : []);
  const one = list.length === 1;
  return (
    <ConfirmModal
      copy={{
        title: one ? `刪除「${list[0]!.name}」？` : `刪除 ${list.length} 場考試？`,
        body: one
          ? '會刪掉：這次模擬考在 App 裡的資料——考試設定、本次考試名單、名單比對結果、標示與抽離設定、座位與排座結果（分科含時程與版本紀錄）。'
          : '會刪掉：下列考試在 App 裡的資料——考試設定、本次名單、標示與抽離設定、座位與排座結果（分科含時程與版本紀錄）。',
        confirm: one ? '刪除這次模擬考' : `刪除這 ${list.length} 場`,
      }}
      onConfirm={p.onConfirm} onClose={p.onClose}>
      {!one && <ul style="margin:6px 0 0;padding-left:18px">{list.map((e) => <li key={e.id}>{e.name}</li>)}</ul>}
      <p style="margin-top:8px"><b>不會動：</b>你已經下載到電腦的 Word、PDF 等檔案，以及「共用設定」裡的學校、班級、教室與學生名單{one ? '' : '、其他考試'}。</p>
    </ConfirmModal>
  );
}

export function Exams(p: {
  doc: Doc; folder?: string;
  /** G37：開首次使用精靈（橫幅按鈕）；沒給就不顯示橫幅 */
  onEnv?: () => void;
  onOpen: (examId: string) => void; /** 直接到第 1 步並對準「考試日期與各節時間」區塊（#473、D177） */ onEditDates?: (examId: string) => void; onNew: () => void; onSettings: () => void; onChangeFolder: () => void;
  /** G16：資料夾找不到時取代列表的錯誤狀態（不顯示「還沒有模擬考」） */
  listError?: ComponentChildren;
  /** 刪除（G1）：單場或批次；沒給就不顯示刪除鈕與選取方塊 */
  onDelete?: (examId: string) => void; onDeleteMany?: (examIds: string[]) => void;
  /** 測試用：固定「今天」（'YYYY-MM-DD'） */
  today?: string;
}) {
  const [del, setDel] = useState<ExamConfig[] | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [showEnded, setShowEnded] = useState(false);
  const [envHide, setEnvHide] = useState(false);
  const banner = p.onEnv && !p.listError ? envBanner(p.doc) : 'none';
  const all = sortExams(p.doc.exams);
  // #352、D163、D164：依考試日期分「尚未完成」「已經完成」（D228 改名，原「尚未結束」「已經結束」）（取代「進行中」「已封存」；封存功能拿掉）
  const { upcoming, ended } = groupExams(all, p.today ?? todayTaipei(), lastModified);
  const canDelete = !!(p.onDelete || p.onDeleteMany);
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const toggleGroup = (g: ExamConfig[]) => setSel((s) => (g.every((e) => s.includes(e.id)) ? s.filter((x) => !g.some((e) => e.id === x)) : [...new Set([...s, ...g.map((e) => e.id)])]));
  const doDelete = (list: ExamConfig[]) => {
    const ids = list.map((e) => e.id);
    if (p.onDeleteMany) p.onDeleteMany(ids); else ids.forEach((id) => p.onDelete?.(id));
    setSel((s) => s.filter((x) => !ids.includes(x)));
  };
  const card = (e: ExamConfig) => {
    const pr = examProgress(p.doc, e);
    const dates = dateRangeText(e);
    return (
      <article class="exam" key={e.id}>
        <div>
          <h3>
            {canDelete && <input type="checkbox" aria-label={`選取 ${e.name}`} checked={sel.includes(e.id)} onChange={() => toggle(e.id)} style="margin-right:8px" />}
            {e.name}
          </h3>
          <div class="meta">
            <Badge>{examLabel(e)}</Badge>
            <span>{examYear(e)} 學年・{examLevel(e)}・{examHeadcount(p.doc, e) > 0 ? `${examHeadcount(p.doc, e)} 人` : '尚未匯入名單'}</span>
            {dates ? <span class="nb">{dates}</span> : <Badge tone="info">未填日期</Badge>}
            {rosterChanged(p.doc, e) && <Badge tone="warn">名單已更動</Badge>}
          </div>
        </div>
        <div>
          <div class="dots" aria-hidden="true">{pr.cells.map((c, i) => <i key={i} class={c} />)}</div>
          <div class="prog"><span class="nb">{pr.headline}</span><span class={`nb ${pr.tone}`}>・{pr.detail}</span></div>
          <div class="small muted" style="margin-top:4px">最後修改 <span class="nb">{formatModified(lastModified(e))}</span></div>
        </div>
        <div class="row" style="flex-wrap:wrap">
          <Button kind="primary" onClick={() => p.onOpen(e.id)}>查看／安排</Button>
          {p.onEditDates && <Button onClick={() => p.onEditDates!(e.id)}>{dates ? '修改日期 ›' : '填寫日期 ›'}</Button>}
          {canDelete && <Button kind="danger" onClick={() => setDel([e])}>刪除</Button>}
        </div>
      </article>
    );
  };
  const groupHead = (title: string, g: ExamConfig[], extra?: ComponentChildren) => (
    <div class="row" style="align-items:center;gap:12px;margin-top:20px">
      <h2 class="exam-sec" style="margin:0">{title} <Badge>{g.length} 場</Badge></h2>
      {canDelete && g.length > 0 && <label class="small" style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" checked={g.every((e) => sel.includes(e.id))} onChange={() => toggleGroup(g)} />全選</label>}
      {extra}
    </div>
  );
  return (
    <section>
      <PageHead title="模擬考" badge={p.folder && <span class="folder-chip" title="目前使用的資料夾">{p.folder}</span>}>
        <Button onClick={p.onChangeFolder}>更換資料夾</Button>
        <Button onClick={p.onSettings}>共用設定</Button>
        {/* #531、稿 v2.87：沒有任何考試時唯一的新增鈕在空白卡中央（比照 #505）；有考試時回頁首右上 */}
        {(all.length > 0 || p.listError) && <Button kind="primary" onClick={p.onNew}>新增模擬考</Button>}
      </PageHead>
      {banner !== 'none' && !(banner === 'changed' && envHide) && (
        <div style="margin-bottom:12px" data-env-banner={banner}>
          <Alert tone="warn" action={banner === 'changed'
            ? <span class="row"><Button small onClick={() => setEnvHide(true)}>知道了</Button><Button small kind="primary" onClick={p.onEnv}>查看環境設定</Button></span>
            : <Button kind="primary" onClick={p.onEnv}>{banner === 'skipped' ? '繼續首次設定' : '開始首次設定'}</Button>}>
            {banner === 'never' && <><b>我們還沒確認過環境</b>：節次表、教室、班級、標籤紙張還是程式預設，先花 <span class="nb">3 分鐘</span>看過。</>}
            {banner === 'skipped' && <><b>你先略過了首次設定</b>：環境尚未確認；新增考試時仍會請你確認。</>}
            {banner === 'changed' && <><b>共用設定在上次確認後有變動</b>：下次新增考試時會請你重新確認。</>}
          </Alert>
        </div>
      )}
      {p.listError ? p.listError : all.length === 0 ? (
        <EmptyState title="還沒有模擬考" action={<Button kind="primary" large onClick={p.onNew}>新增模擬考</Button>}>按「新增模擬考」開始。</EmptyState>
      ) : (
        <>
        {canDelete && sel.length > 0 && (
          <div class="row" role="status" style="gap:12px;align-items:center;margin-bottom:8px"><b>已選 {sel.length} 場</b>
            <Button small onClick={() => setSel([])}>取消選取</Button>
            <Button small kind="danger" onClick={() => setDel(all.filter((e) => sel.includes(e.id)))}>刪除所選</Button></div>
        )}
        {/* #670（D228）：分組只改名「尚未完成／已經完成」，仍依考試日期分（D163／D164／D217 不變，使用者 2026-11-24 裁示 A） */}
        {groupHead('尚未完成', upcoming)}
        {upcoming.length === 0 && <EmptyState title="目前沒有尚未完成的模擬考">可以新增，或到下方「已經完成」查看。</EmptyState>}
        <div class="exam-list">{upcoming.map(card)}</div>
        {ended.length > 0 && (
          <>
            {groupHead('已經完成', ended, <button type="button" class="rc-more" aria-label="已經完成的考試（點了展開或收合）" aria-expanded={showEnded} onClick={() => setShowEnded(!showEnded)}>{showEnded ? '收合 ▴' : `展開 ${ended.length} 場 ▾`}</button>)}
            {showEnded && <div class="exam-list">{ended.map(card)}</div>}
          </>
        )}
        </>
      )}
      {del && <DeleteExamModal exams={del} onClose={() => setDel(null)} onConfirm={() => doDelete(del)} />}
      <div style="margin-top:14px">
        {/* #671（D228）：讀圖必需的圖例常駐，不收合 */}
        <div class="plegend" aria-label="進度條圖例">
          <b>進度條</b>六格＝六個步驟
          <span><i class="d" />完成</span><span><i class="s" />過期</span><span><i class="c" />目前</span><span><i class="n" />不需要</span><span><i />未開始</span>
        </div>
      </div>
    </section>
  );
}
