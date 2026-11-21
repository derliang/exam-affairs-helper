/** S-7 ⑥ 檢核與對帳儀表板（完整版）：區塊順序依稿——閘門 → 遺漏與總覽 → 對帳表 → 考日×時段×教室 → 班級×科目 → 備卷 → 風險 → 版本 */
import { EmptyState } from '../../components';
import { dashboardOf } from '../dashboard';
import { baseOf } from '../pipeline';
import type { MakeupSession } from '../session';
import type { MakeupStepNo } from '../steps';
import { ChecksCard, DayReconcileCard, GateBanner, MissCard, OverviewCard, PaperCard, RiskCard, SlotRoomCard, VersionCard } from './MkDashParts';
import { Matrix } from './MkStep4';

export function MkStep6(p: { s: MakeupSession; onStep: (n: MakeupStepNo) => void }) {
  const d = dashboardOf(p.s);
  const b = baseOf(p.s);
  return (
    <section class="stack">
      <div class="card stephead"><div><h2>⑥ 檢核與對帳</h2><p class="small muted">所有安排都獨立重算、逐項對帳；絕不可遺漏任何一位補考學生。有紅燈就不能下載。</p></div></div>
      <GateBanner d={d} onStep={p.onStep} onDownload={() => p.onStep(7)} />
      {d.state === 'none' ? null : (
        <>
          <MissCard d={d} onStep={p.onStep} />
          <OverviewCard d={d} />
          <ChecksCard d={d} onStep={p.onStep} />
          <DayReconcileCard s={p.s} />
          <SlotRoomCard s={p.s} />
          {b.matrices.length === 0 ? <EmptyState title="沒有班級 × 科目資料">匯入名單後才會有。</EmptyState> : b.matrices.map((m) => <Matrix key={m.division} m={m} />)}
          <PaperCard s={p.s} />
          <RiskCard s={p.s} />
          <VersionCard d={d} />
        </>
      )}
    </section>
  );
}
