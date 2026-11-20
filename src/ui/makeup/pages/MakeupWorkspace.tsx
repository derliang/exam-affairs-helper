/** 補考場次的七步驟工作區：左步驟列、中間各步畫面、右側摘要。⑥ 儀表板、⑦ 下載與每頁最上面的常駐摘要列由 K3 接手 */
import { useEffect } from 'preact/hooks';
import { Button, StepNav } from '../../components';
import { scrollPageTop } from '../../nav';
import { withSnapshot } from '../dashboard';
import { baseOf, outputsOf, scheduleOf } from '../pipeline';
import type { MakeupSession } from '../session';
import { MAKEUP_STEP_NAMES, makeupStepTitle, stepStates, type MakeupStepNo } from '../steps';
import { MkStep1 } from './MkStep1';
import { MkStep2 } from './MkStep2';
import { MkStep3 } from './MkStep3';
import { MkStep4 } from './MkStep4';
import { MkStep5 } from './MkStep5';
import { MkStep6 } from './MkStep6';
import { MkStep7 } from './MkStep7';
import { MakeupSummaryBar } from './MkSummaryBar';

/** 右側摘要：學生、應補考人次、已排程、遺漏（稿 S-10 摘要列的最小版；完整儀表板是 K3） */
export function MakeupSummary(p: { s: MakeupSession }) {
  const b = baseOf(p.s);
  const has = b.roster.included.length + b.roster.notified.length > 0;
  if (!has) {
    return <div class="card stack"><div class="lab">本場摘要</div><p class="small muted">尚未匯入補考名單。匯入後這裡會即時顯示學生數、人次與對帳結果。</p></div>;
  }
  const { schedule } = scheduleOf(p.s);
  const students = new Set([...b.roster.included, ...b.roster.notified].map((r) => r.studentId)).size;
  const placed = schedule.sittings.reduce((n, x) => n + x.subjects.length, 0);
  const lost = schedule.unplaced.length;
  return (
    <div class="card stack">
      <div class="lab">本場摘要</div>
      <div class="stats side-stats">
        <div><small>學生</small><strong>{students}</strong></div>
        <div><small>應補考人次</small><strong>{b.entries.length}</strong></div>
        <div><small>已排程</small><strong>{placed}／{b.entries.length}</strong></div>
        <div class={lost > 0 || b.roster.unresolved.length > 0 ? 'bad' : ''}><small>遺漏</small><strong>{lost + b.roster.unresolved.length > 0 ? `✕ ${lost + b.roster.unresolved.length}` : '0 ✓'}</strong></div>
      </div>
      <p class="small muted">資料版本碼　{outputsOf(p.s).version}</p>
    </div>
  );
}

export function MakeupWorkspace(p: {
  s: MakeupSession; step: MakeupStepNo; onChange: (s: MakeupSession) => void; onStep: (n: MakeupStepNo) => void; onList: () => void;
}) {
  const { s, step } = p;
  // 規格 6.1：每次變更都把當下的對帳結果一起存進場次（結果沒變就不多記一筆）
  const change = (n: MakeupSession) => p.onChange(withSnapshot(n));
  useEffect(() => { scrollPageTop(); }, [s.id, step]);
  const prev = step > 1 ? ((step - 1) as MakeupStepNo) : undefined;
  const next = step < 7 ? ((step + 1) as MakeupStepNo) : undefined;
  return (
    <div class="ws">
      <aside class="side"><StepNav steps={stepStates(s, step)} onGo={(n) => p.onStep(n as MakeupStepNo)} /></aside>
      <div class="stack" style="min-width:0">
        <MakeupSummaryBar s={s} onStep={p.onStep} />
        {step === 1 ? <MkStep1 s={s} onChange={change} />
          : step === 2 ? <MkStep2 s={s} onChange={change} />
          : step === 3 ? <MkStep3 s={s} onChange={change} />
          : step === 4 ? <MkStep4 s={s} onChange={change} />
          : step === 5 ? <MkStep5 s={s} onChange={change} onStep={p.onStep} />
          : step === 6 ? <MkStep6 s={s} onStep={p.onStep} />
          : <MkStep7 s={s} onStep={p.onStep} onChange={change} />}
        <div class="row" style="justify-content:space-between">
          {prev ? <Button onClick={() => p.onStep(prev)}>‹ 上一步<small class="muted">　{MAKEUP_STEP_NAMES[prev - 1]}</small></Button> : <Button onClick={p.onList}>‹ 補考列表</Button>}
          {next ? <Button kind="primary" onClick={() => p.onStep(next)}>下一步 ›<small>　{MAKEUP_STEP_NAMES[next - 1]}</small></Button> : <span />}
        </div>
      </div>
      <aside class="side side-r"><MakeupSummary s={s} /></aside>
    </div>
  );
}
