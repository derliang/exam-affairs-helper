import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { ExamConfig } from '../../data';
import { Badge, Button, EmptyState, Modal, More, PageHead } from '../components';
import { rosterChanged } from '../rosterIO';
import { examFullyAbsent, examHeadcount, examLevel, examProgress, formatModified, sortExams } from '../examList';
import { examLabel, lastModified, examYear, type Doc } from '../store';

/** 模擬考列表（DESIGN 10.x）：頁首 h1＋資料夾 chip，每列有六格進度條、學年與人數、最後修改；依最後修改由新到舊 */
/** 刪除考試前的確認（G1）：寫明會刪什麼、不會動什麼，並要輸入考試名稱才能刪 */
export const deleteNameMatches = (examName: string, typed: string): boolean => typed.trim() === examName;

export function DeleteExamModal(p: { exam: ExamConfig; onConfirm: () => void; onClose: () => void }) {
  const [typed, setTyped] = useState('');
  const ok = deleteNameMatches(p.exam.name, typed);
  return (
    <Modal title={`刪除「${p.exam.name}」？`} onClose={p.onClose} actions={<><Button onClick={p.onClose}>取消</Button><button type="button" class="btn btn-danger" disabled={!ok} onClick={() => { p.onClose(); p.onConfirm(); }}>刪除這次模擬考</button></>}>
      <p><b>會刪掉：</b>這次模擬考在 App 裡的資料——考試設定、本次考試名單、名單比對結果、標示與抽離設定、座位與排座結果（分科含時程與版本紀錄）。刪除後無法從列表找回，只有這次開啟 App 期間還能用上方「↶ 復原」。</p>
      <p style="margin-top:8px"><b>不會動：</b>你已經下載到電腦的 Word、PDF 等檔案，以及「共用設定」裡的學校、班級、教室與學生名單。</p>
      <p style="margin-top:8px">如果只是暫時不用，建議改用「封存」，之後還能查看與還原。</p>
      <label class="field" style="margin-top:12px"><span class="label">請輸入考試名稱「{p.exam.name}」確認刪除</span>
        <input type="text" value={typed} aria-label="輸入考試名稱確認刪除" onInput={(e) => setTyped(e.currentTarget.value)} />
      </label>
    </Modal>
  );
}

export function Exams(p: {
  doc: Doc; folder?: string; onOpen: (examId: string) => void; onNew: () => void; onSettings: () => void; onChangeFolder: () => void;
  /** 封存、還原、刪除（G1）；沒給就不顯示該按鈕 */
  /** G16：資料夾找不到時取代列表的錯誤狀態（不顯示「還沒有模擬考」） */
  listError?: ComponentChildren;
  onArchive?: (examId: string) => void; onRestore?: (examId: string) => void; onDelete?: (examId: string) => void;
}) {
  const [del, setDel] = useState<ExamConfig | null>(null);
  const all = sortExams(p.doc.exams);
  const exams = all.filter((e) => !e.archived);
  const archived = all.filter((e) => e.archived);
  const card = (e: ExamConfig) => {
    const pr = examProgress(p.doc, e);
    const arch = !!e.archived;
    return (
      <article class={`exam${arch ? ' exam-arch' : ''}`} key={e.id}>
        <div>
          <h3>{e.name}</h3>
          <div class="meta">
            <Badge>{examLabel(e)}</Badge>
            <span>{examYear(e)} 學年・{examLevel(e)}・{examHeadcount(p.doc, e) > 0 ? `${examHeadcount(p.doc, e)} 人${examFullyAbsent(p.doc, e) > 0 ? `（含全科缺考 ${examFullyAbsent(p.doc, e)} 人，不排座）` : ''}` : '尚未匯入名單'}</span>
            {arch && <Badge tone="info">已封存</Badge>}
            {rosterChanged(p.doc, e) && <Badge tone="warn">名單已更動</Badge>}
          </div>
        </div>
        <div>
          <div class="dots" aria-hidden="true">{pr.cells.map((c, i) => <i key={i} class={c} />)}</div>
          <div class="prog">{pr.headline}<span class={pr.tone}>・{pr.detail}</span></div>
          <div class="small muted" style="margin-top:4px">最後修改 {formatModified(lastModified(e))}</div>
        </div>
        <div class="row" style="flex-wrap:wrap">
          <Button kind="primary" onClick={() => p.onOpen(e.id)}>{arch ? '查看／下載' : '查看／安排'}</Button>
          {arch ? p.onRestore && <Button onClick={() => p.onRestore!(e.id)}>還原</Button> : p.onArchive && <Button onClick={() => p.onArchive!(e.id)}>封存</Button>}
          {p.onDelete && <Button kind="danger" onClick={() => setDel(e)}>刪除</Button>}
        </div>
      </article>
    );
  };
  return (
    <section>
      <PageHead title="模擬考" badge={p.folder && <span class="folder-chip" title="目前使用的資料夾">{p.folder}</span>}>
        <Button onClick={p.onChangeFolder}>更換資料夾</Button>
        <Button onClick={p.onSettings}>共用設定</Button>
        <Button kind="primary" onClick={p.onNew}>新增模擬考</Button>
      </PageHead>
      {p.listError ? p.listError : all.length === 0 ? (
        <EmptyState title="還沒有模擬考" action={<Button kind="primary" onClick={p.onNew}>新增模擬考</Button>}>按「新增模擬考」開始。</EmptyState>
      ) : (
        <>
        <h2 class="exam-sec">進行中<span class="muted small">（{exams.length}）</span></h2>
        {exams.length === 0 && <p class="muted small">目前沒有進行中的模擬考；可以新增，或到下方「已封存」還原。</p>}
        <div class="exam-list">
          {exams.map(card)}
        </div>
        {archived.length > 0 && (
          <>
            <h2 class="exam-sec" style="margin-top:20px">已封存<span class="muted small">（{archived.length}）</span></h2>
            <p class="muted small">封存的考試只能查看與下載，不能編輯；要編輯請先按「還原」。</p>
            <div class="exam-list">{archived.map(card)}</div>
          </>
        )}
        </>
      )}
      {del && <DeleteExamModal exam={del} onClose={() => setDel(null)} onConfirm={() => p.onDelete?.(del.id)} />}
      <div style="margin-top:14px">
        <More title="說明：進度條怎麼看">
          <div class="plegend" aria-label="進度條圖例">
            六格＝六個步驟
            <span><i class="d" />完成</span><span><i class="s" />過期</span><span><i class="c" />目前</span><span><i class="n" />不需要</span><span><i />未開始</span>
          </div>
        </More>
      </div>
    </section>
  );
}
