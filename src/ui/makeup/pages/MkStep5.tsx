/**
 * S-6 ⑤ 考程編排：系統建議、時段（列）×教室（欄）總覽、調整（升為獨立節／降為綜合、指定提前開考、指定某班的教室）、
 * 提前開考學生與最早離場時間（F-20～F-24、R-1～R-12）。每次調整即時重算，結果貼在畫面上（摘要列＋遺漏提示）。
 * 引擎在 src/core/makeup/schedule.ts（K1）；本檔只有畫面與「調整」的呼叫（pipeline.ts）。
 */
import { useState } from 'preact/hooks';
import { Alert, Badge, Button, ConfirmButton, EmptyState, More } from '../../components';
import { fmtTime, roomSeats, type EarlyInfo, type MakeupGroup, type SlotInfo, type Sitting } from '../../../core/makeup';
import { baseOf, pinRoom, planOf, resetPlan, scheduleOf, setEarly, setSubjectRole } from '../pipeline';
import type { MakeupSession } from '../session';
import type { MakeupStepNo } from '../steps';

const CN = '一二三四五六七八九十';
const slotName = (sl: SlotInfo): string => (sl.kind === 'early' ? '提前開考' : `時段${CN[sl.index] ?? sl.index + 1}${sl.kind === 'final' ? '（綜合節）' : ''}`);
const timeText = (sl: SlotInfo): string => `${fmtTime(sl.start)}–${fmtTime(sl.end)}`;

export function MkStep5(p: { s: MakeupSession; onChange: (s: MakeupSession) => void; onStep: (n: MakeupStepNo) => void }) {
  const { s } = p;
  const b = baseOf(s);
  const pl = planOf(s);
  const { schedule } = scheduleOf(s);
  if (b.entries.length === 0) {
    return (
      <section class="stack">
        <div class="card stephead"><div><h2>⑤ 考程編排</h2><p class="small muted">系統建議節次與教室，你可以調整。</p></div></div>
        <EmptyState title="還沒有可排的名單" action={<Button kind="primary" onClick={() => p.onStep(2)}>去 ② 匯入名單</Button>}>匯入並處理完問題列後，系統會依各科人數與教室容量建議節次與教室。</EmptyState>
      </section>
    );
  }
  const placed = schedule.sittings.reduce((n, x) => n + x.subjects.length, 0);
  const lost = schedule.unplaced.length;
  const earlyN = schedule.early.length;
  return (
    <section class="stack">
      <div class="card stephead"><div><h2>⑤ 考程編排</h2><p class="small muted">系統建議節次與教室，你可以調整；每次調整即時重算全部檢核。</p></div></div>

      <div class="card stack">
        <div class="row" style="justify-content:space-between">
          <div><div class="lab">{pl.edited ? '目前用的是你調整過的考程' : '系統建議'}</div>
            <p class="small muted">{pl.edited ? '名單變動時，你調整過的考程不會自動重排；想重新來過按「重新建議」。' : '人數多的科目獨立成節，其餘併入最後一節（綜合節，考完為止）；各科加總超過上限的多科生建議提前開考。'}</p></div>
          {pl.edited
            ? <ConfirmButton kind="accent-outline" copy={{ title: '重新建議？', body: '你調整過的節次、提前開考學生與指定教室會被丟掉，改回系統依目前名單與教室的建議。', confirm: '重新建議' }} onConfirm={() => p.onChange(resetPlan(s))}>重新建議</ConfirmButton>
            : <Badge tone="info">未調整</Badge>}
        </div>
        <div class="stats">
          <div><small>應排人次</small><strong>{b.entries.length}</strong></div>
          <div><small>已排程</small><strong>{placed}／{b.entries.length}</strong></div>
          <div class={lost > 0 ? 'bad' : ''}><small>遺漏</small><strong>{lost > 0 ? `✕ ${lost}` : '0 ✓'}</strong></div>
          <div><small>提前開考</small><strong>{earlyN}</strong></div>
          <div class={schedule.splits.length > 0 ? 'bad' : ''}><small>被拆班</small><strong>{schedule.splits.length}</strong></div>
        </div>
      </div>

      {lost > 0 && (
        <div class="card stack" style="border-color:var(--danger-line);background:var(--danger-soft)">
          <Alert tone="danger" action={<Button small onClick={() => p.onStep(3)}>去 ③ 加教室</Button>}><b>有 {lost} 筆人次排不進去（遺漏）</b>：教室座位不夠或年級沒指定考日。下面是前 8 筆：</Alert>
          <ul class="small">{schedule.unplaced.slice(0, 8).map((u) => <li key={`${u.studentId}${u.subject}`}>學號 {u.studentId}　{u.subject}　{u.reason}</li>)}</ul>
        </div>
      )}
      {schedule.splits.length > 0 && (
        <Alert tone="warn"><b>有 {schedule.splits.length} 個班被拆到不同教室（C-13）</b>：整班比任何一間教室都大。可到 ③ 把教室加大，或標一間混班教室。
          <ul class="small">{schedule.splits.slice(0, 5).map((x) => <li key={`${x.slotId}${x.oldClass}`}>{x.oldClass}（{x.rooms.join('、')}）</li>)}</ul></Alert>
      )}

      {b.settings.groups.map((g) => <GroupCard key={g.id} s={s} g={g} onChange={p.onChange} />)}
      <p class="small muted">紅框＝超額、虛線底＝綜合節、粗框＝提前開考；使用率＝人數 ÷ 座位數。</p>
    </section>
  );
}

function GroupCard(p: { s: MakeupSession; g: MakeupGroup; onChange: (s: MakeupSession) => void }) {
  const { s, g } = p;
  const b = baseOf(s);
  const gp = planOf(s).plan.groups.find((x) => x.groupId === g.id);
  const { schedule } = scheduleOf(s);
  const day = b.settings.days.find((d) => d.id === g.dayId)?.label ?? g.dayId;
  const es = b.entries.filter((e) => g.grades.includes(e.grade));
  if (es.length === 0 || !gp) return null;
  const slots = schedule.slots.filter((sl) => sl.groupId === g.id);
  const sit = schedule.sittings.filter((x) => slots.some((sl) => sl.id === x.slotId));
  const roomIds = [...new Set(sit.map((x) => x.roomId))];
  const rooms = b.settings.rooms.filter((r) => roomIds.includes(r.id));
  const counts = new Map<string, number>();
  for (const e of es) counts.set(e.subject, (counts.get(e.subject) ?? 0) + 1);
  const independent = new Set(gp.slots.flat());
  const earlyInfos = schedule.early.filter((x) => x.groupId === g.id);
  return (
    <div class="card stack">
      <div class="row" style="justify-content:space-between"><div class="lab">{day}・{g.label}　{fmtTime(g.start)} 開始・每節 {g.periodMin} 分</div><Badge>{es.length} 人次</Badge></div>

      <div class="psec stack">
        <h3>科目怎麼排</h3>
        <p class="small muted">獨立節＝該科單獨一個時段；綜合節＝併在最後一節，考完為止。把人數多的科升為獨立節、人數少的併進綜合節。</p>
        <div class="rtw"><table class="t compact rt-t rt-a">
          <thead><tr><th>科目</th><th>人次</th><th>安排</th></tr></thead>
          <tbody>
            {[...counts.entries()].sort((a, c) => c[1] - a[1]).map(([subj, n]) => (
              <tr key={subj}>
                <td class="ti" data-label="科目"><b>{subj}</b></td><td data-label="人次">{n}</td>
                <td data-label="安排">
                  <select class="input" aria-label={`${g.label}${subj}安排`} value={independent.has(subj) ? 'independent' : 'combined'}
                    onChange={(e) => p.onChange(setSubjectRole(s, g.id, subj, e.currentTarget.value as 'independent' | 'combined'))}>
                    <option value="independent">獨立節</option>
                    <option value="combined">綜合節</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>

      <div class="psec stack">
        <h3>時段 × 教室總覽</h3>
        <div class="rtw"><table class="t compact rt-t rt-mx">
          <thead><tr><th>時段</th>{rooms.map((r) => <th key={r.id}>{r.name}<br /><span class="small muted">{roomSeats(r)} 座</span></th>)}</tr></thead>
          <tbody>
            {slots.map((sl) => (
              <tr key={sl.id} class={sl.kind === 'final' ? 'gap' : ''}>
                <td class="ti" data-label="時段">{slotName(sl)}<br /><span class="small muted">{timeText(sl)}</span></td>
                {rooms.map((r) => <Cell key={r.id} sl={sl} room={r.name} seats={roomSeats(r)} list={sit.filter((x) => x.slotId === sl.id && x.roomId === r.id)} />)}
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>

      <EarlySection s={s} g={g} infos={earlyInfos} onChange={p.onChange} />
      <PinSection s={s} g={g} slots={slots} sit={sit} onChange={p.onChange} />
      {slots.some((x) => x.kind === 'final') && <p class="small muted">綜合節學生一律到該時段結束（{fmtTime(slots.find((x) => x.kind === 'final')!.end)}）才離場。</p>}
    </div>
  );
}

function Cell(p: { sl: SlotInfo; room: string; seats: number; list: Sitting[] }) {
  const n = p.list.length;
  if (n === 0) return <td data-label={p.room}>—</td>;
  const bySubj = new Map<string, number>();
  for (const x of p.list) for (const sub of x.subjects) bySubj.set(sub, (bySubj.get(sub) ?? 0) + 1);
  const over = n > p.seats;
  return (
    <td data-label={p.room} class={over ? 'bad' : ''}>
      {[...bySubj.entries()].map(([k, c]) => <div key={k}>{k}　{c} 人次</div>)}
      <div class="small muted">{n} 人／{p.seats} 座　{Math.round((n / p.seats) * 100)}%{over ? '　✕ 超額' : ''}</div>
    </td>
  );
}

function EarlySection(p: { s: MakeupSession; g: MakeupGroup; infos: EarlyInfo[]; onChange: (s: MakeupSession) => void }) {
  const { s, g, infos } = p;
  const b = baseOf(s);
  const [pick, setPick] = useState('');
  // 可以加入提前開考的：這個群組裡、有兩科以上、還沒提前的學生
  const per = new Map<string, number>();
  for (const e of b.entries.filter((x) => g.grades.includes(x.grade))) per.set(e.studentId, (per.get(e.studentId) ?? 0) + 1);
  const early = new Set(infos.map((x) => x.studentId));
  const cand = [...per.entries()].filter(([id, n]) => n >= 2 && !early.has(id)).map(([id]) => id).sort();
  if (infos.length === 0 && cand.length === 0) return null;
  return (
    <div class="psec stack">
      <h3>提前開考學生與離場時間</h3>
      <p class="small muted">各科加總超過 {s.early.suggestOverMin} 分的多科生，建議第一節就在特別教室開考，不等到下午。最早離場時間＝他所有科目在全校最後一場結束的時間（洩題管制，D117）；會印在點名單「註」欄、考程表與班級公告。</p>
      {infos.length > 0 && (
        <div class="rtw"><table class="t compact rt-t">
          <thead><tr><th>學號</th><th>科目</th><th>總作答</th><th>最早離場</th><th /></tr></thead>
          <tbody>
            {infos.map((x) => (
              <tr key={x.studentId}>
                <td class="ti" data-label="學號">{x.studentId}</td><td data-label="科目">{x.subjects.join('、')}</td>
                <td data-label="總作答">{x.totalMin} 分{x.totalMin > s.early.capMin ? <> <Badge tone="warn">! 超過上限 {s.early.capMin}</Badge></> : ''}</td>
                <td data-label="最早離場"><b>{fmtTime(x.leaveAt)}</b> 前不得離場</td>
                <td class="act"><Button small onClick={() => p.onChange(setEarly(s, g.id, x.studentId, false))}>取消提前</Button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {cand.length > 0 && (
        <div class="row" style="align-items:flex-end">
          <div class="field"><label class="small" for={`mk5-early-${g.id}`}>指定提前開考（多科生）</label>
            <select id={`mk5-early-${g.id}`} class="input" value={pick} onChange={(e) => setPick(e.currentTarget.value)}>
              <option value="">選一位學生</option>
              {cand.map((id) => <option key={id} value={id}>{id}（{per.get(id)} 科）</option>)}
            </select></div>
          <Button disabled={!pick} onClick={() => { p.onChange(setEarly(s, g.id, pick, true)); setPick(''); }}>加入提前開考</Button>
        </div>
      )}
    </div>
  );
}

/** 指定某班在某時段的教室（換教室、移動某班）；「自動」＝由系統分配 */
function PinSection(p: { s: MakeupSession; g: MakeupGroup; slots: SlotInfo[]; sit: Sitting[]; onChange: (s: MakeupSession) => void }) {
  const { s, g } = p;
  const b = baseOf(s);
  const plan = planOf(s).plan;
  const rows: { sl: SlotInfo; cls: string; n: number; roomId: string }[] = [];
  for (const sl of p.slots) {
    const by = new Map<string, Sitting[]>();
    for (const x of p.sit.filter((y) => y.slotId === sl.id)) by.set(x.oldClass, [...(by.get(x.oldClass) ?? []), x]);
    for (const [cls, list] of [...by.entries()].sort()) rows.push({ sl, cls, n: list.length, roomId: list[0]!.roomId });
  }
  const pinOf = (sl: SlotInfo, cls: string) => plan.pins?.find((x) => x.groupId === g.id && x.slot === sl.index && x.oldClass === cls)?.roomId ?? '';
  const usable = b.settings.rooms.filter((r) => !g.roomIds || g.roomIds.includes(r.id));
  if (rows.length === 0) return null;
  return (
    <More title="調整教室（移動某班）：指定某班在某時段用哪一間">
      <div class="rtw"><table class="t compact rt-t">
        <thead><tr><th>時段</th><th>班級</th><th>人數</th><th>教室</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.sl.id}${r.cls}`}>
              <td class="ti" data-label="時段">{slotName(r.sl)}　{timeText(r.sl)}</td><td data-label="班級">{r.cls}</td><td data-label="人數">{r.n}</td>
              <td data-label="教室">
                <select class="input" aria-label={`${r.cls}${slotName(r.sl)}教室`} value={pinOf(r.sl, r.cls)}
                  onChange={(e) => p.onChange(pinRoom(s, { groupId: g.id, slot: r.sl.index, oldClass: r.cls, roomId: e.currentTarget.value }))}>
                  <option value="">自動（現在：{b.settings.rooms.find((x) => x.id === r.roomId)?.name ?? r.roomId}）</option>
                  {usable.map((room) => <option key={room.id} value={room.id}>{room.name}（{roomSeats(room)} 座）</option>)}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </More>
  );
}
