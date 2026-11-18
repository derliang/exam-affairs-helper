import { useState } from 'preact/hooks';
import { Alert, Badge, Button, EmptyState } from '../components';
import { fmtTime, roomSeats, type MakeupGroup, type SlotInfo } from '../../core/makeup';
import { derive, groupSubjects, moveSlot, placeSubject, setEarly, setPin, type MakeupSession, type Placement } from './model';
import type { MakeupStepProps } from './MakeupStep1';

const KIND_TEXT = { independent: '獨立節', final: '綜合節', early: '提前開考' } as const;

/** 科目目前放在哪：回傳 select 的 value */
function placementOf(slots: string[][], _combined: string[], subject: string): string {
  const i = slots.findIndex((x) => x.includes(subject));
  return i >= 0 ? `s${i}` : 'c';
}
const toPlacement = (v: string): Placement => (v === 'c' ? { kind: 'combined' } : v === 'n' ? { kind: 'new' } : { kind: 'slot', index: Number(v.slice(1)) });

/** ⑤ 考程編排（S-6；F-20～F-24）：系統建議的節次與教室，可調整；提前開考學生與離場時間；每次調整即時重算 */
export function MakeupStep5(p: MakeupStepProps) {
  const { s } = p;
  const d = derive(s);
  const [pinForm, setPinForm] = useState<{ gid: string; slot: string; cls: string; room: string }>({ gid: '', slot: '0', cls: '', room: '' });
  if (!d.roster || d.entries.length === 0) {
    return (
      <section class="stack" aria-label="考程編排">
        <div class="card stephead"><div><h2>⑤ 考程編排</h2></div></div>
        <EmptyState title="還沒有可排的名單">先到 ② 匯入名單並處理完問題列。</EmptyState>
      </section>
    );
  }
  const setPlan = (plan: typeof d.plan) => p.onChange({ ...s, plan });
  const rooms = new Map(s.settings.rooms.map((r) => [r.id, r]));
  const sched = d.schedule;
  const groups = s.settings.groups.filter((g) => g.grades.some((gr) => d.grades.includes(gr)));
  const dayLabel = (id: string) => s.settings.days.find((x) => x.id === id)?.label ?? id;
  const red = d.checks.filter((c) => c.status === 'red');
  const amber = d.checks.filter((c) => c.status === 'amber');

  const slotRooms = (slot: SlotInfo) => {
    const by = new Map<string, typeof sched.sittings>();
    for (const x of sched.sittings.filter((y) => y.slotId === slot.id)) by.set(x.roomId, [...(by.get(x.roomId) ?? []), x]);
    return [...by.entries()];
  };

  return (
    <section class="stack" aria-label="考程編排">
      <div class="card stephead"><div><h2>⑤ 考程編排</h2><p class="small muted">系統依各科人數建議哪些科獨立成節、哪些併入綜合節，以及每節的教室；你可以調整，調整後立刻重算。節數不固定、不綁年級。</p></div></div>

      <div class="card stack" role="status" aria-label="即時檢核摘要">
        <div class="row" style="justify-content:space-between">
          <div><b>即時檢核</b>：{red.length === 0 ? <Badge tone="ok">沒有紅燈</Badge> : <Badge tone="danger">{red.length} 項紅燈</Badge>}　{amber.length === 0 ? <Badge tone="ok">沒有警示</Badge> : <Badge tone="warn">{amber.length} 項警示</Badge>}</div>
          <Button onClick={() => p.onChange(withoutPlanOf(s))} disabled={!s.plan}>重新套用系統建議</Button>
        </div>
        {red.concat(amber).slice(0, 6).map((c) => <p class="small" key={c.id}>{c.status === 'red' ? '✕' : '▲'} {c.id} {c.title}：{c.summary}</p>)}
        <p class="small muted">完整的對帳儀表板、檢核明細與下載之後開放（步驟 ⑥⑦）。</p>
      </div>

      {sched.unplaced.length > 0 && (
        <Alert tone="danger"><b>有 {sched.unplaced.length} 人次排不進考程</b>：{sched.unplaced.slice(0, 3).map((u) => `${u.studentId} ${u.subject}（${u.reason}）`).join('；')}{sched.unplaced.length > 3 ? '…' : ''}</Alert>
      )}
      {sched.splits.length > 0 && (
        <Alert tone="warn"><b>同班同科被拆到不同教室（{sched.splits.length} 班）</b>：整班大於任何一間教室剩餘座位才會拆；可以增加教室或指定某班的教室。</Alert>
      )}

      {groups.map((g) => <GroupCard key={g.id} s={s} g={g} dayLabel={dayLabel(g.dayId)} onPlan={setPlan} />)}

      <div class="card stack"><div class="lab">時間 × 教室總覽（F-23）</div>
        {sched.slots.length === 0 ? <p class="muted">還沒有排出任何時段。</p> : (
          <div class="scroll"><table class="t compact" aria-label="考程總覽">
            <thead><tr><th>考日</th><th>群組</th><th>時段</th><th>節</th><th>科目</th><th>教室與人數（人數／座位）</th></tr></thead>
            <tbody>{sched.slots.map((sl) => {
              const g = s.settings.groups.find((x) => x.id === sl.groupId);
              return (
                <tr key={sl.id}>
                  <td>{dayLabel(sl.dayId)}</td><td>{g?.label}</td><td class="nw">{fmtTime(sl.start)}–{fmtTime(sl.end)}</td><td>{KIND_TEXT[sl.kind]}</td>
                  <td>{sl.subjects.join('、')}</td>
                  <td>{slotRooms(sl).map(([rid, xs]) => {
                    const room = rooms.get(rid); const seats = room ? roomSeats(room) : 0;
                    const classes = [...new Set(xs.map((x) => x.oldClass))].join('、');
                    return <div key={rid} class="small"><b>{room?.name ?? rid}</b> {xs.length}／{seats}（{seats ? Math.round((xs.length / seats) * 100) : 0}%）　{classes}</div>;
                  })}</td>
                </tr>
              );
            })}</tbody></table></div>
        )}
      </div>

      <div class="card stack"><div class="lab">指定某班某節的教室（F-21）</div>
        <p class="small muted">想把某一班移到另一間教室，在這裡指定；指定後仍會檢查座位是否夠。</p>
        <div class="row">
          <label class="field"><span class="label">群組</span>
            <select class="input" aria-label="群組" value={pinForm.gid} onChange={(e) => setPinForm({ ...pinForm, gid: e.currentTarget.value })}>
              <option value="">選擇群組</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}</select></label>
          <label class="field"><span class="label">節</span>
            <select class="input" aria-label="節" value={pinForm.slot} onChange={(e) => setPinForm({ ...pinForm, slot: e.currentTarget.value })}>
              {sched.slots.filter((x) => x.groupId === pinForm.gid).map((x) => <option key={x.id} value={x.index}>{fmtTime(x.start)} {KIND_TEXT[x.kind]}</option>)}</select></label>
          <label class="field"><span class="label">班級</span>
            <select class="input" aria-label="班級" value={pinForm.cls} onChange={(e) => setPinForm({ ...pinForm, cls: e.currentTarget.value })}>
              <option value="">選擇班級</option>{[...new Set(d.entries.filter((e) => s.settings.groups.find((x) => x.id === pinForm.gid)?.grades.includes(e.grade)).map((e) => e.oldClass))].map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
          <label class="field"><span class="label">教室</span>
            <select class="input" aria-label="教室" value={pinForm.room} onChange={(e) => setPinForm({ ...pinForm, room: e.currentTarget.value })}>
              <option value="">選擇教室</option>{s.settings.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}（{roomSeats(r)} 位）</option>)}</select></label>
          <Button kind="primary" disabled={!pinForm.gid || !pinForm.cls || !pinForm.room} onClick={() => setPlan(setPin(d.plan, pinForm.gid, Number(pinForm.slot), pinForm.cls, pinForm.room))}>指定</Button>
        </div>
        {(d.plan.pins ?? []).length > 0 && (
          <ul style="margin:0 0 0 18px">{(d.plan.pins ?? []).map((x, i) => (
            <li key={i}>{s.settings.groups.find((g) => g.id === x.groupId)?.label} 第 {x.slot + 1} 節：{x.oldClass} → {rooms.get(x.roomId)?.name ?? x.roomId}　<Button small onClick={() => setPlan(setPin(d.plan, x.groupId, x.slot, x.oldClass, null))}>取消指定</Button></li>
          ))}</ul>
        )}
      </div>
    </section>
  );
}

const withoutPlanOf = (s: MakeupSession): MakeupSession => { const { plan: _p, ...rest } = s; return rest; };

function GroupCard(p: { s: MakeupSession; g: MakeupGroup; dayLabel: string; onPlan: (plan: ReturnType<typeof derive>['plan']) => void }) {
  const { s, g } = p;
  const d = derive(s);
  const gp = d.plan.groups.find((x) => x.groupId === g.id);
  if (!gp) return null;
  const subjects = groupSubjects(d.entries, g);
  const count = (sub: string) => d.entries.filter((e) => g.grades.includes(e.grade) && e.subject === sub).length;
  const early = d.schedule.early.filter((e) => e.groupId === g.id);
  const multi = new Map<string, number>();
  for (const e of d.entries) if (g.grades.includes(e.grade)) multi.set(e.studentId, (multi.get(e.studentId) ?? 0) + 1);
  const candidates = [...multi.entries()].filter(([id, n]) => n >= 2 && !gp.early.includes(id)).map(([id]) => id).sort();
  const [pick, setPick] = useState('');
  const slots = gp.slots;
  return (
    <div class="card stack" aria-label={`${g.label} 考程`}>
      <div class="lab">{p.dayLabel}　{g.label}（{fmtTime(g.start)} 起，每節 {g.periodMin} 分）</div>

      <div class="scroll"><table class="t compact"><thead><tr><th>科目</th><th>人次</th><th>安排</th><th>調整</th></tr></thead>
        <tbody>{subjects.map((sub) => {
          const cur = placementOf(slots, gp.combined, sub);
          const label = cur === 'c' ? `綜合節（最後一節 ${fmtTime(lastStart(g, slots))}）` : `第 ${Number(cur.slice(1)) + 1} 節 ${fmtTime(g.start + Number(cur.slice(1)) * (g.periodMin + g.breakMin))}${Number(cur.slice(1)) === slots.length - 1 ? '（也是綜合節）' : ''}`;
          return (
            <tr key={sub}><td>{sub}</td><td>{count(sub)}</td><td>{label}</td>
              <td><select class="input" aria-label={`${g.label} ${sub} 安排`} value={cur} onChange={(e) => p.onPlan(placeSubject(d.plan, g.id, sub, toPlacement(e.currentTarget.value)))}>
                {slots.map((_, i) => <option key={i} value={`s${i}`}>第 {i + 1} 節{i === slots.length - 1 ? '（含綜合）' : ''}</option>)}
                <option value="n">新增一個獨立節</option><option value="c">綜合節</option></select></td></tr>
          );
        })}</tbody></table></div>

      {slots.length > 1 && (
        <div class="row"><span class="small muted">調整獨立節順序：</span>
          {slots.map((sl, i) => (
            <span class="row" key={i}><span class="small">第 {i + 1} 節 {sl.join('、')}</span>
              <Button small disabled={i === 0} onClick={() => p.onPlan(moveSlot(d.plan, g.id, i, -1))}>↑</Button>
              <Button small disabled={i === slots.length - 1} onClick={() => p.onPlan(moveSlot(d.plan, g.id, i, 1))}>↓</Button></span>
          ))}
        </div>
      )}

      <div class="lab" style="font-size:15px">提前開考與離場時間（R-7、R-8）</div>
      {early.length === 0 ? <p class="small muted">這一組沒有提前開考的學生。</p> : (
        <div class="scroll"><table class="t compact nw"><thead><tr><th>學號</th><th>科目</th><th>總作答</th><th>前不得離場</th><th /></tr></thead>
          <tbody>{early.map((e) => (
            <tr key={e.studentId}><td>{e.studentId}</td><td>{e.subjects.join('、')}</td>
              <td>{e.totalMin} 分{e.totalMin > s.settings.early.capMin && <Badge tone="warn">超過上限 {s.settings.early.capMin}</Badge>}</td>
              <td><b>{fmtTime(e.leaveAt)}</b></td>
              <td><Button small onClick={() => p.onPlan(setEarly(d.plan, g.id, e.studentId, false))}>改回一般節次</Button></td></tr>
          ))}</tbody></table></div>
      )}
      {candidates.length > 0 && (
        <div class="row">
          <label class="field"><span class="label">指定多科生提前開考</span>
            <select class="input" aria-label={`${g.label} 指定提前開考`} value={pick} onChange={(e) => setPick(e.currentTarget.value)}>
              <option value="">選擇學生（學號）</option>{candidates.map((id) => <option key={id} value={id}>{id}（{multi.get(id)} 科）</option>)}</select></label>
          <Button disabled={!pick} onClick={() => { p.onPlan(setEarly(d.plan, g.id, pick, true)); setPick(''); }}>指定提前開考</Button>
        </div>
      )}
      <p class="small muted">提前開考的學生在特別教室第一節就開考，離場時間＝他所有科目在同考日最後一場結束的時間（洩題管制，會印在點名單「註」欄）。</p>
    </div>
  );
}

const lastStart = (g: MakeupGroup, slots: string[][]): number => g.start + Math.max(slots.length - 1, 0) * (g.periodMin + g.breakMin);
