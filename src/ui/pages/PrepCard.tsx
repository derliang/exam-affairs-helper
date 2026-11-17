/**
 * 步驟③「預備教室排座與標籤」卡（稿 v2.22，校-56；D94-4、D94-5）：
 * 上半＝預備教室排座方式（① 同學優先〔預設〕、② 監考優先）；模式 ① 排出來同班沒有遞增時顯示警告（不擋下載）。
 * 下半＝合併標籤（範例）：每座位一張、每節一行、印節次＋科目＋班座號、不印時間。
 */
import type { ExamConfig } from '../../data';
import { ReserveLabelSample } from './LabelSample';
import { detachPreview, reserveModeOf } from '../seating';
import { updateExam, type Doc } from '../store';

export function PrepCard(p: { doc: Doc; exam: ExamConfig; onChange: (d: Doc) => void }) {
  const { doc, exam } = p;
  const m = reserveModeOf(exam);
  const paper = exam.labelLayout.paper; // G26：範例跟著標籤預設紙張
  const set = (v: 'peer' | 'proctor') => {
    const r = updateExam(doc, exam.id, { reserveSeatMode: v });
    if (r.ok) p.onChange(r.doc);
  };
  const layout = exam.reserveLayout ?? 'min-depth';
  const setLayout = (v: 'min-depth' | 'min-rows') => {
    const r = updateExam(doc, exam.id, { reserveLayout: v });
    if (r.ok) p.onChange(r.doc);
  };
  const preview = m === 'peer' ? detachPreview(doc, exam) : null;
  const warnings = preview?.ok ? preview.warnings ?? [] : [];
  return (
    <div class="card stack">
      <div><h3>預備教室排座與標籤</h3><p class="small muted">加考的同學去預備教室時，座位怎麼排，以及標籤長什麼樣子。</p></div>
      <div class="stack" style="gap:8px">
        <div><h4 class="sh">排座方式</h4><p class="small muted">兩種都可以選，預設「同學優先」。</p></div>
        <div class="pmode" role="group" aria-label="預備教室排座方式">
          <button type="button" class="opt" aria-pressed={m === 'peer'} onClick={() => set('peer')}>
            <b>① 同學優先（預設）</b>
            <span class="small muted">同一個人每一節盡量坐同一個座位；同班盡量照編號由前往後排、每排輪替，方便貼標籤。同班遞增是「盡量」，排不到時只警告、不擋下載。</span>
          </button>
          <button type="button" class="opt" aria-pressed={m === 'proctor'} onClick={() => set('proctor')}>
            <b>② 監考優先</b>
            <span class="small muted">盡量讓同班坐在一起，方便監考；同學不保證每節同一個座位。同班座號一定由小到大，不會有遞增警告。</span>
          </button>
        </div>
        <div>
          <h4 class="sh">座位排法</h4>
          <p class="small muted">預備教室沒坐滿時：<b>最少深位（預設）</b>＝人數平均分到各排，每排只坐前幾個深位；<b>最少排數</b>＝一排坐滿再坐下一排。</p>
          <div class="row" role="group" aria-label="預備教室座位排法">
            <button type="button" class={`btn${layout === 'min-depth' ? ' btn-primary' : ''}`} aria-pressed={layout === 'min-depth'} onClick={() => setLayout('min-depth')}>最少深位（預設）</button>
            <button type="button" class={`btn${layout === 'min-rows' ? ' btn-primary' : ''}`} aria-pressed={layout === 'min-rows'} onClick={() => setLayout('min-rows')}>最少排數</button>
          </div>
        </div>
        {warnings.length > 0 && (
          <div class="alert a-warn" role="status">
            <span aria-hidden="true">⚠</span>
            <div>
              <b>同班座號沒有遞增（模式 ① 才會出現，學測）：</b>
              {warnings.slice(0, 3).map((w) => <span key={w}>{w}。</span>)}
              {warnings.length > 3 && <span class="small muted">…共 {warnings.length} 項。</span>}
              這是為了讓同一個人每個時段都坐同一格，不影響下載。<span class="small muted">想要同班座號一定遞增，請改用模式 ②（監考優先）；改了之後同一個人不保證每個時段坐同一格。</span>
            </div>
            <button type="button" class="btn btn-sm" onClick={() => set('proctor')}>改用模式 ②</button>
          </div>
        )}
      </div>
      <div class="psec">
        <div class="stack">
<div><h4 class="sh">合併標籤（範例）</h4><p class="small muted">預備教室每個座位一張，版式與一般標籤相同（右上角座標、格內每人一區：班級座號、姓名、第幾天考什麼科目）。同一個座位在不同節由不同人使用時，列在同一張、只貼一次。下面是用實際輸出的程式畫出的 3 張範例（假資料，{paper}）。抽離自習不排座位、不印標籤，只出名單。</p></div>
          <ReserveLabelSample paper={paper} />
          <p class="small muted">第 2 張：同一個人（勇班 12 號）跨天坐同一格。第 3 張：兩個不同的人共用同一格。預備教室的標籤併在「標籤」檔案的最後，頁首標「預備教室」。</p>
        </div>
      </div>
    </div>
  );
}
