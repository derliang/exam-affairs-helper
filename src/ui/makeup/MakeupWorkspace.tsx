import { useEffect } from 'preact/hooks';
import { Button, EmptyState, StepNav, type StepState } from '../components';
import type { Doc } from '../store';
import { derive, makeupById, makeupFlow, MAKEUP_STEPS, termText, updateMakeup, type MakeupSession, type MakeupStep } from './model';
import { MakeupStep1 } from './MakeupStep1';
import { MakeupStep2 } from './MakeupStep2';
import { MakeupStep3 } from './MakeupStep3';
import { MakeupStep4 } from './MakeupStep4';
import { MakeupStep5 } from './MakeupStep5';

export interface MakeupWorkspaceProps {
  doc: Doc; makeupId: string; step: MakeupStep;
  onChange: (d: Doc) => void; onStep: (n: MakeupStep) => void; onExams: () => void;
  now?: () => Date;
}

/** 補考場次工作區（K2）：左側步驟列、上方摘要列、中間步驟內容、右側上一步／下一步；⑥ 儀表板與 ⑦ 下載之後開放 */
export function MakeupWorkspace(p: MakeupWorkspaceProps) {
  const s = makeupById(p.doc, p.makeupId);
  useEffect(() => { (globalThis as { window?: { scrollTo?: (x: number, y: number) => void } }).window?.scrollTo?.(0, 0); }, [p.makeupId, p.step]);
  if (!s) {
    return <section><h2>補考</h2><EmptyState title="找不到這個補考場次" action={<Button kind="primary" onClick={p.onExams}>回模擬考列表</Button>}>它可能已被刪除，或資料夾換了。</EmptyState></section>;
  }
  const flow = makeupFlow(s);
  const on = (m: MakeupSession) => p.onChange(updateMakeup(p.doc, s.id, () => m));
  const steps = MAKEUP_STEPS.map((m) => ({
    no: m.no, name: m.name, blurb: m.blurb,
    state: (m.no === p.step ? 'cur' : flow.states[m.no] === 'done' ? 'done' : 'todo') as StepState,
  }));
  const common = { doc: p.doc, s, onChange: on };
  const prev = p.step > 1 ? MAKEUP_STEPS[p.step - 2]! : undefined;
  const next = p.step < 5 ? MAKEUP_STEPS[p.step]! : undefined;
  const sm = flow.summary;
  const block = flow.issues.filter((i) => i.level === 'block');
  return (
    <div class="ws">
      <aside class="side"><StepNav steps={steps} onGo={(n) => p.onStep(n as MakeupStep)} /></aside>
      <div class="stack" style="min-width:0">
        <div class={`sumbar${flow.issues.length ? ' has-iss' : ''}`} role="region" aria-label="本次補考摘要">
          <div class="sstats">
            <div class={`sc${sm.entries ? '' : ' dim'}`}><span class="sl">應補考人次</span><b>{sm.entries || '—'}</b></div>
            <div class="sc"><span class="sl">學生</span><b>{sm.students}</b></div>
            <div class="sc"><span class="sl">另行通知</span><b>{sm.notified}</b></div>
            <div class="sc"><span class="sl">考日</span><b>{sm.days}</b></div>
            <div class="sc"><span class="sl">節</span><b>{sm.slots}</b></div>
            <div class="sc"><span class="sl">考場</span><b>{sm.rooms}</b></div>
            {block.length === 0 ? <div class="sc okc"><span class="sl">待處理</span><b>0</b><em>✓ 沒有待處理的事</em></div> : <div class="sc warn"><span class="sl">待處理</span><b>{block.length}</b></div>}
          </div>
          {flow.issues.length > 0 && (
            <div class="slist">
              {flow.issues.map((i, k) => (
                <button type="button" key={k} class={`si${i.level === 'warn' ? ' todo' : ''}`} onClick={() => p.onStep(i.step)}>
                  <span class="sstep">{'①②③④⑤'[i.step - 1]} {MAKEUP_STEPS[i.step - 1]!.name}</span>
                  <span class="sti">{i.text}</span>
                  <span class="sgo">前往 ›</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {p.step === 1 ? <MakeupStep1 {...common} />
          : p.step === 2 ? <MakeupStep2 {...common} {...(p.now ? { now: p.now } : {})} />
          : p.step === 3 ? <MakeupStep3 {...common} />
          : p.step === 4 ? <MakeupStep4 {...common} />
          : <MakeupStep5 {...common} />}
        {p.step === 5 && <p class="small muted">⑥ 檢核與對帳儀表板、⑦ 下載會在之後的版本開放；目前可以先完成 ①～⑤ 的設定與考程。版本碼 {derive(s).version}</p>}
      </div>
      <aside class="side side-r">
        <div class="stepdock" role="region" aria-label="步驟操作">
          <div class="dock-nav">
            <div class="dock-cell dock-prev">{prev && <><Button onClick={() => p.onStep(prev.no)}>‹ 上一步</Button><span class="dock-sub">{prev.name}</span></>}</div>
            <div class="dock-cell dock-next">{next
              ? <><Button kind="primary" onClick={() => p.onStep(next.no)}>下一步 ›</Button><span class="dock-sub">{next.name}</span></>
              : <><Button kind="primary" onClick={p.onExams}>完成 ✓</Button><span class="dock-sub">回列表</span></>}</div>
          </div>
        </div>
        <div class="card stack small" aria-label="場次資訊">
          <b>{s.name}</b>
          <span class="muted">{s.schoolYear} 學年{termText(s.semester)}</span>
        </div>
      </aside>
    </div>
  );
}
