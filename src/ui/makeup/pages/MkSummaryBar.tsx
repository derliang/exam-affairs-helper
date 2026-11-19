/**
 * S-10 常駐摘要列：每個步驟頁最上面一條（沿用考試的 .sumbar 黏頂樣式），學生、人次、已排程、遺漏、紅／琥珀／綠計數；
 * 「看儀表板」開抽屜（沿用 Modal，不離開目前步驟），完整版在步驟 ⑥。原則：沒算完不顯示通過；算不出來視同不通過。
 */
import { useState } from 'preact/hooks';
import { Button, Modal } from '../../components';
import { dashboardOf } from '../dashboard';
import type { MakeupSession } from '../session';
import type { MakeupStepNo } from '../steps';
import { ChecksCard, GateBanner, MissCard, OverviewCard } from './MkDashParts';

export function MakeupSummaryBar(p: { s: MakeupSession; onStep: (n: MakeupStepNo) => void }) {
  const [open, setOpen] = useState(false);
  const d = dashboardOf(p.s);
  const m = d.summary;
  const go = (n: MakeupStepNo) => { setOpen(false); p.onStep(n); };
  return (
    <div class="sumbar" role="region" aria-label="補考檢核摘要" data-gate={d.state}>
      <div class="sstats">
        {!m.hasRoster
          ? <div class="sc dim"><span class="sl">學生</span><b>尚未匯入補考名單</b></div>
          : (
            <>
              <div class="sc"><span class="sl">學生</span><b>{m.students}</b></div>
              <div class="sc"><span class="sl">應補考人次</span><b>{m.entries}</b></div>
              <div class="sc"><span class="sl">已排程</span><b>{m.placed}／{m.entries}</b></div>
              {m.lost > 0 ? <div class="sc bad"><span class="sl">遺漏</span><b>✕ {m.lost}</b></div> : <div class="sc okc"><span class="sl">遺漏</span><b>0 ✓</b></div>}
              <div class={`sc${m.red > 0 ? ' bad' : ''}`}><span class="sl">不通過</span><b>{m.red > 0 ? `✕ ${m.red}` : 0}</b></div>
              <div class={`sc${m.amber > 0 ? ' warn' : ''}`}><span class="sl">警示</span><b>{m.amber > 0 ? `▲ ${m.amber}` : 0}</b></div>
              <div class="sc"><span class="sl">通過</span><b>{m.green}</b></div>
              {d.stale && <div class="sc warn"><span class="sl">狀態</span><b>已下載的檔案過期</b></div>}
            </>
          )}
        <Button small onClick={() => setOpen(true)}>看儀表板</Button>
      </div>
      {open && (
        <Modal title="檢核與對帳儀表板" onClose={() => setOpen(false)} actions={<Button kind="primary" onClick={() => go(6)}>到 ⑥ 完整版 ›</Button>}>
          <div class="stack">
            <GateBanner d={d} onStep={go} onDownload={() => go(7)} />
            <MissCard d={d} onStep={go} />
            <OverviewCard d={d} />
            <ChecksCard d={d} onStep={go} onlyIssues />
          </div>
        </Modal>
      )}
    </div>
  );
}
