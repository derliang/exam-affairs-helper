import { subjectShort } from '../../core/subjectShort';
import type { ExamConfig } from '../../data';
import { Alert } from '../components';
import { MarkLabelSample, ReserveLabelSample, sampleCellMm } from './LabelSample';
import { markRows } from '../seating';
import { examLabel, examYear, type Doc } from '../store';
import { mathSplit } from '../subjects';

/** 右側欄（原型 v1side／v4side）：只有 ① 與 ④ 有，其餘步驟沒有右側欄（原型 stepView） */
export function hasSide(step: number, kind?: string): boolean { return step === 1 || step === 3 || (step === 4 && kind !== 'ast'); }

export function StepSide(p: { step: number; doc: Doc; exam: ExamConfig }) {
  return p.step === 1 ? <Side1 {...p} /> : p.step === 3 ? <Side3 {...p} /> : p.step === 4 ? <Side4 {...p} /> : null;
}

/** ① 本次摘要、這一步會影響 */
function Side1(p: { exam: ExamConfig }) {
  const { exam } = p;
  const term = exam.semester === 'second' ? '下' : '上';
  const stale = exam.kind === 'gsat' && exam.subjects.some((x) => x.id === 'math') === mathSplit(exam.round);
  return (
    <>
      <div class="card stack">
        <div class="lab">本次摘要</div>
        <div class="stats side-stats">
          <div><small>考科</small><strong>{exam.subjects.length}</strong></div>
          <div><small>學期</small><strong>{term}學期</strong></div>
        </div>
        <p class="small muted">{examLabel(exam)}・{examYear(exam)} 學年・{exam.division === 'senior' ? '高三' : '國三'}</p>
      </div>
      <div class="card stack">
        <div class="lab">這一步會影響</div>
        <p class="small muted">② 考試名單比對的科目欄<br />④ 組別對照表的科目<br />⑥ 下載檔案的標題與科目</p>
        {stale && <Alert tone="warn">次別改了，④ 已標為過期。</Alert>}
      </div>
    </>
  );
}

/** ③ 合併標籤（範例）：與 ④ 的「範例標示」同一種做法——範例一律放右側欄，不放在頁面最下方（稿 v2.107、D226）。只有高中部學測／會考有預備教室合併標籤 */
function Side3(p: { exam: ExamConfig }) {
  if (p.exam.kind === 'ast' || p.exam.division !== 'senior') return null;
  return (
    <div class="card stack">
      <div class="lab">合併標籤（範例）</div>
      <p class="small muted">預備教室每個座位一張，同一座位不同節由不同人使用時合在同一張、只貼一次；用實際輸出的程式畫的（假資料，{p.exam.labelLayout.paper}）。</p>
      <ReserveLabelSample paper={p.exam.labelLayout.paper} />
      <p class="small muted">第 2 張：同一個人跨天坐同一格。第 3 張：兩個不同的人共用同一格。併在「標籤」檔案最後，頁首標「預備教室」；抽離自習不排座位、不印標籤，只出名單。</p>
    </div>
  );
}

const PAPER_NOTE = `B4 每格約 ${sampleCellMm('B4', 6).w.toFixed(1)}×${sampleCellMm('B4', 6).h.toFixed(1)} mm、A3 約 ${sampleCellMm('A3', 6).w.toFixed(1)}×${sampleCellMm('A3', 6).h.toFixed(1)} mm`;

/** ④ 待處理、範例標示（B4 小標籤與 A3 大標籤，依實際尺寸等比例） */
function Side4(p: { doc: Doc; exam: ExamConfig }) {
  const { doc, exam } = p;
  if (exam.kind === 'bcct') {
    return <div class="card stack"><div class="lab">說明</div><p class="small muted">會考沒有選考，這一步顯示「不需要」。</p></div>;
  }
  const rows = markRows(doc, exam);
  const undecided = rows.filter((r) => r.state === 'undecided').length;
  const sample = rows.find((r) => r.mode === 'mark-absent' || r.mode === 'mark-extra');
  const markTag = sample ? { kind: (sample.mode === 'mark-absent' ? 'x' : 'add') as 'x' | 'add', text: subjectShort(sample.subjectName) } : undefined;
  return (
    <>
      <div class="card stack">
        <div class="lab">待處理</div>
        {undecided
          ? <Alert tone="warn">有 {undecided} 項接近一半的科目要選。</Alert>
          : <Alert tone="ok">沒有要選的項目。</Alert>}
      </div>
      <div class="card stack">
        <div class="lab">範例標示</div>
        {(['B4', 'A3'] as const).map((pp) => <MarkLabelSample key={pp} paper={pp} mark={markTag} />)}
        <p class="small muted">範例是用實際輸出的程式畫的（假資料）。標籤最多 8 排×8 深位（總座位 56），格子大小隨紙張不同，四周留列印邊距（{PAPER_NOTE}；深位多時格子稍矮，注意事項一定印在同一頁），格子排列與該教室的座位表一致，沒有座位的地方不印格子，所以 5 排×6 深位的教室整頁只有 30 格。有標示的考生，標示印在格子右下角（✕＝這科不考、＋＝加考這科）。</p>
      </div>
    </>
  );
}
