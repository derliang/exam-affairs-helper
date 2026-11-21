/**
 * 補考儀表板的各個區塊（S-7、S-10）：⑥ 完整版、抽屜版、⑦ 下載頁上方的閘門說明共用。
 * 只用既有元件與樣式（Alert、Badge、Button、StatsBar、EmptyState、CheckRow、.rtw/.rt-t 容器表格）；不自寫樣式。
 * 規則：紅燈擋下載、必須修正；琥珀只提示（D153）；待執行（C-14）不假裝綠燈；遺漏為 0 時明確顯示「0 ✓」。
 */
import { useState } from 'preact/hooks';
import { Alert, Badge, Button, EmptyState, Seg, StatsBar } from '../../components';
import { crossDayDuplicates, fmtTime, reconcileByDay, roomSeats, type SlotInfo } from '../../../core/makeup';
import { CheckRow } from '../../pages/ReconcilePanel';
import { fixTargets, stepLabel, toCheck, type Dashboard } from '../dashboard';
import { baseOf, outputsOf, scheduleOf } from '../pipeline';
import type { MakeupSession } from '../session';
import type { MakeupStepNo } from '../steps';

const CN = '一二三四五六七八九十';
export const slotName = (sl: SlotInfo): string => (sl.kind === 'early' ? '提前開考' : `時段${CN[sl.index] ?? sl.index + 1}${sl.kind === 'final' ? '（綜合節）' : ''}`);
const slotTime = (sl: SlotInfo): string => `${fmtTime(sl.start)}–${fmtTime(sl.end)}`;

type Go = (n: MakeupStepNo) => void;

/** 最上面先回答：能不能下載、有沒有遺漏（區塊 1） */
export function GateBanner(p: { d: Dashboard; onStep: Go; onDownload?: () => void }) {
  const { d } = p;
  if (d.state === 'none') {
    return <EmptyState title="還沒有名單可以檢核" action={<Button kind="primary" onClick={() => p.onStep(2)}>到 ② 匯入名單 ›</Button>}>匯入補考名單、處理完問題列並排好考程後，這裡會即時顯示每一項對帳。沒算完的不會顯示通過。</EmptyState>;
  }
  if (d.state === 'blocked') {
    return (
      <Alert tone="danger" action={<div class="row">{fixTargets(d.gate).map((t) => <Button key={t.step} small kind="primary" onClick={() => p.onStep(t.step)}>到 {stepLabel(t.step)} ›</Button>)}</div>}>
        <b>不能下載：{d.gate.blockers.length} 項不通過，必須先修正。</b>紅燈沒有「確認放行」，修正後會自動重新檢核。
        <ul class="plain">{d.gate.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
      </Alert>
    );
  }
  if (d.state === 'warn') {
    return (
      <Alert tone="warn" action={p.onDownload ? <Button small kind="primary" onClick={p.onDownload}>到 ⑦ 下載 ›</Button> : undefined}>
        <b>可以下載，另有 {d.gate.warnings.length} 項警示（僅供參考）：</b>不擋下載、不用確認。
        <ul class="plain">{d.gate.warnings.map((c) => <li key={c.id}>{c.id} {c.title}：{c.summary}</li>)}</ul>
      </Alert>
    );
  }
  return (
    <Alert tone="ok" action={p.onDownload ? <Button small kind="primary" onClick={p.onDownload}>到 ⑦ 下載 ›</Button> : undefined}>
      <b>可以下載：</b>所有對帳都通過{d.gate.blockers.length === 0 && d.checks.some((c) => c.status === 'pending') ? '（C-14 產出回讀要等下載後才能執行）' : ''}。
    </Alert>
  );
}

/** 遺漏清單（區塊 7）：預期永遠為空；為空時明確顯示 0，不為空整區紅色逐筆列出 */
export function MissCard(p: { d: Dashboard; onStep: Go }) {
  const { d } = p;
  if (!d.summary.hasRoster) return null;
  if (d.missing.length === 0) {
    return <div class="card stack" data-miss="0"><div class="lab">遺漏清單</div><Alert tone="ok"><b>遺漏 0 ✓</b>　每位補考學生的每一科都已排進考場。</Alert></div>;
  }
  return (
    <div class="card stack" data-miss={d.missing.length}>
      <div class="lab">遺漏清單</div>
      <Alert tone="danger"><b>遺漏 {d.missing.length} 筆 ✕</b>　下面的學生科目還沒有考場，不可遺漏任何一位。</Alert>
      <ul class="plain">
        {d.missing.map((m) => (
          <li key={m.text}>{m.text}　<Button small onClick={() => p.onStep(m.step)}>到 {stepLabel(m.step)} ›</Button></li>
        ))}
      </ul>
    </div>
  );
}

/** 總覽數字（區塊 1） */
export function OverviewCard(p: { d: Dashboard }) {
  const { summary: m } = p.d;
  if (!m.hasRoster) return null;
  return (
    <div class="card stack">
      <div class="lab">總覽</div>
      <StatsBar items={[
        { label: '學生', value: m.students },
        { label: '應補考人次', value: m.entries },
        { label: '另行通知人次', value: m.notifiedEntries },
        { label: '科目', value: m.subjects },
        { label: '考日', value: m.days },
        { label: '節數', value: m.slots },
        { label: '考場', value: m.rooms },
        { label: '座位總數／最擁擠使用', value: `${m.seats}／${m.seatsUsed}` },
        { label: '已排程', value: `${m.placed}／${m.entries}`, bad: m.placed !== m.entries },
        { label: '遺漏', value: m.lost > 0 ? `✕ ${m.lost}` : '0 ✓', bad: m.lost > 0 },
      ]} />
    </div>
  );
}

/** 對帳表 C-1～C-15（區塊 2）：與考前對帳共用同一列元件；紅、琥珀預設展開；onlyIssues＝抽屜版只列不通過與警示 */
export function ChecksCard(p: { d: Dashboard; onStep: Go; onlyIssues?: boolean }) {
  const { d } = p;
  if (!d.summary.hasRoster) return null;
  const rows = p.onlyIssues ? d.checks.filter((c) => c.status === 'red' || c.status === 'amber' || c.status === 'pending') : d.checks;
  const head = `${d.summary.red} 項不通過　${d.summary.amber} 項警示　${d.summary.green} 項通過${d.summary.pending > 0 ? `　${d.summary.pending} 項待下載後執行` : ''}`;
  return (
    <div class="card stack" data-checks>
      <div class="row sb"><div class="lab">檢核與對帳（C-1～C-15）</div><Badge tone={d.summary.red > 0 ? 'danger' : d.summary.amber > 0 ? 'warn' : 'ok'}>{head}</Badge></div>
      <p class="small muted">每項都寫出應有／實有／差異，差異不為 0 即不通過；任何變動都會自動重算。算不出來視同不通過。</p>
      {rows.length === 0
        ? <p class="small">沒有不通過或警示的項目。</p>
        : <div class="rc-list">{rows.map((c) => <CheckRow key={`${c.id}-${c.status}-${c.expected}-${c.actual}`} c={toCheck(c, p.onStep)} onGo={() => undefined} />)}</div>}
    </div>
  );
}

/** 考日 × 時段 × 教室（區塊 3）：每格科目、人數／座位數 */
export function SlotRoomCard(p: { s: MakeupSession }) {
  const b = baseOf(p.s);
  const { schedule } = scheduleOf(p.s);
  if (schedule.slots.length === 0) return null;
  const roomIds = [...new Set(schedule.sittings.map((x) => x.roomId))];
  const rooms = roomIds.map((id) => b.settings.rooms.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => !!r);
  const days = b.settings.days.filter((dd) => schedule.slots.some((sl) => sl.dayId === dd.id));
  return (
    <div class="card stack">
      <div class="lab">考日 × 時段 × 教室</div>
      {days.map((dd) => (
        <div key={dd.id} class="stack">
          <b>{dd.label}</b>
          <div class="rtw"><table class="t compact rt-t">
            <thead><tr><th>時段</th>{rooms.map((r) => <th key={r.id}>{r.name}（{roomSeats(r)} 座）</th>)}</tr></thead>
            <tbody>{schedule.slots.filter((sl) => sl.dayId === dd.id).map((sl) => (
              <tr key={sl.id}>
                <td class="ti" data-label="時段">{slotName(sl)}<br /><small class="muted">{slotTime(sl)}</small></td>
                {rooms.map((r) => {
                  const here = schedule.sittings.filter((x) => x.slotId === sl.id && x.roomId === r.id);
                  const seats = roomSeats(r);
                  const pct = seats > 0 ? Math.round((here.length / seats) * 100) : 0;
                  return <td key={r.id} data-label={r.name}>{here.length === 0 ? '·' : <>{[...new Set(here.flatMap((x) => x.subjects))].join('、')}<br /><small class="muted">{here.length}／{seats} 人（{pct}%）{here.length > seats ? ' ✕ 超額' : ''}</small></>}</td>;
                })}
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      ))}
    </div>
  );
}

/** 備卷表（區塊 5）：各卷在哪個時段、哪些教室、各幾份；合計＝該卷人數 */
export function PaperCard(p: { s: MakeupSession }) {
  const b = baseOf(p.s);
  const o = outputsOf(p.s);
  const { schedule } = scheduleOf(p.s);
  if (o.outputs.papers.length === 0) return null;
  const slotOf = new Map(schedule.slots.map((x) => [x.id, x]));
  const roomName = (id: string): string => b.settings.rooms.find((r) => r.id === id)?.name ?? id;
  const papers = [...new Set(o.outputs.papers.map((x) => x.paper))];
  return (
    <div class="card stack">
      <div class="lab">備卷表</div>
      <div class="rtw"><table class="t compact rt-t">
        <thead><tr><th>卷</th><th>時段</th><th>教室</th><th>份數</th></tr></thead>
        <tbody>{papers.flatMap((pp) => {
          const rows = o.outputs.papers.filter((x) => x.paper === pp);
          const sum = rows.reduce((n, x) => n + x.count, 0);
          return [
            ...rows.map((x, i) => {
              const sl = slotOf.get(x.slotId);
              return <tr key={`${pp}-${x.slotId}-${x.roomId}`}><td class="ti" data-label="卷">{i === 0 ? pp : ''}</td><td data-label="時段">{sl ? `${slotName(sl)} ${slotTime(sl)}` : x.slotId}</td><td data-label="教室">{roomName(x.roomId)}</td><td data-label="份數">{x.count}</td></tr>;
            }),
            <tr key={`${pp}-sum`}><td class="ti" data-label="卷"><b>合計</b></td><td data-label="時段" /><td data-label="教室" /><td class="tot" data-label="份數"><b>{sum}</b>{b.papers[pp] !== undefined && sum !== b.papers[pp] ? ` ✕（應為 ${b.papers[pp]}）` : ' ✓'}</td></tr>,
          ];
        })}</tbody>
      </table></div>
    </div>
  );
}

/** 風險與警示（區塊 6）：提前開考學生與最早離場時間、被拆班 */
export function RiskCard(p: { s: MakeupSession }) {
  const b = baseOf(p.s);
  const { schedule } = scheduleOf(p.s);
  const roomName = (id: string): string => b.settings.rooms.find((r) => r.id === id)?.name ?? id;
  const slotOf = new Map(schedule.slots.map((x) => [x.id, x]));
  const none = schedule.early.length === 0 && schedule.splits.length === 0;
  return (
    <div class="card stack">
      <div class="lab">風險與警示</div>
      {none && <p class="small">沒有提前開考學生，也沒有被拆班的同班同科。</p>}
      {schedule.early.length > 0 && (
        <div class="stack">
          <b>提前開考學生（{schedule.early.length} 人）</b>
          <p class="small muted">最早可離場時間＝他所有科目在全校最後一場結束的時間；印在點名單「註」欄、考程表與公告（D124）。</p>
          <div class="rtw"><table class="t compact rt-t">
            <thead><tr><th>學號</th><th>科目</th><th>總作答</th><th>最早可離場</th></tr></thead>
            <tbody>{schedule.early.map((e) => (
              <tr key={e.studentId}><td class="ti" data-label="學號">{e.studentId}</td><td data-label="科目">{e.subjects.join('・')}</td><td data-label="總作答">{e.totalMin} 分</td><td data-label="最早可離場"><b>{fmtTime(e.leaveAt)}</b></td></tr>
            ))}</tbody>
          </table></div>
        </div>
      )}
      {schedule.splits.length > 0 && (
        <div class="stack">
          <b>被拆班（{schedule.splits.length} 班）</b>
          <ul class="plain">{schedule.splits.map((x) => <li key={`${x.slotId}-${x.oldClass}`}>{x.oldClass} 在 {slotOf.get(x.slotId) ? slotName(slotOf.get(x.slotId)!) : x.slotId} 被拆到 {x.rooms.map(roomName).join('、')}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

/**
 * 依考日對帳（U-8、D184）：多考日場次才出現。「全場次／某一天」用既有 Seg 切換；
 * 同一學生同一科出現在兩個考日只當警示，不擋下載。
 */
export function DayReconcileCard(p: { s: MakeupSession }) {
  const [pick, setPick] = useState<string>('all');
  const b = baseOf(p.s);
  const { schedule } = scheduleOf(p.s);
  if (b.settings.days.length < 2) return null;
  const rows = reconcileByDay(b.entries, schedule, b.settings);
  const dups = crossDayDuplicates(b.entries, b.settings);
  const shown = pick === 'all' ? rows : rows.filter((r) => r.dayId === pick);
  const sum = (f: (r: (typeof rows)[number]) => number): number => shown.reduce((n, r) => n + f(r), 0);
  return (
    <div class="card stack" data-day-reconcile>
      <div class="lab">依考日對帳</div>
      <Seg<string> label="對帳範圍" value={pick} options={[{ value: 'all', label: '全場次' }, ...rows.map((r) => ({ value: r.dayId, label: r.label }))]} onChange={setPick} />
      {dups.length > 0 && (
        <Alert tone="warn"><b>{dups.length} 筆同一學生同一科出現在兩個考日（僅供參考，不擋下載）</b>
          <ul class="plain">{dups.map((x) => <li key={`${x.studentId}|${x.subject}`}>{x.studentId}　{x.subject}：{x.days.join('、')}</li>)}</ul>
        </Alert>
      )}
      <div class="rtw"><table class="t compact rt-t">
        <thead><tr><th>考日</th><th>學生</th><th>應有人次</th><th>實有人次</th><th>差異</th></tr></thead>
        <tbody>
          {shown.map((r) => <tr key={r.dayId}><td class="ti" data-label="考日">{r.label}</td><td data-label="學生">{r.students}</td><td data-label="應有人次">{r.expected}</td><td data-label="實有人次">{r.actual}</td><td data-label="差異">{r.diff === 0 ? '0 ✓' : `${r.diff > 0 ? '+' : ''}${r.diff} ✕`}</td></tr>)}
          {pick === 'all' && <tr><td class="ti" data-label="考日"><b>全場次合計</b></td><td data-label="學生">—</td><td data-label="應有人次"><b>{sum((r) => r.expected)}</b></td><td data-label="實有人次"><b>{sum((r) => r.actual)}</b></td><td data-label="差異"><b>{sum((r) => r.diff) === 0 ? '0 ✓' : `${sum((r) => r.diff)} ✕`}</b></td></tr>}
        </tbody>
      </table></div>
      {shown.some((r) => r.details.length > 0) && (
        <Alert tone="danger"><b>這一天有人次對不上</b>
          <ul class="plain">{shown.flatMap((r) => r.details).map((t) => <li key={t}>{t}</li>)}</ul>
        </Alert>
      )}
    </div>
  );
}

/** 版本資訊（區塊 8） */
export function VersionCard(p: { d: Dashboard }) {
  const { d } = p;
  return (
    <div class="card stack" data-version>
      <div class="lab">版本資訊</div>
      <p class="small">資料版本碼　<b>{d.version}</b></p>
      {d.run
        ? <p class="small">{d.stale ? <><Badge tone="warn">過期</Badge> 名單或設定在 {d.run.at} 的下載之後改過，已下載的檔案是舊版（版本碼 {d.run.version}），請重新下載。</> : <><Badge tone="ok">最新</Badge> {d.run.at} 已下載 {d.run.fileNames.length} 份，版本碼與目前相同。</>}</p>
        : <p class="small muted">這一版還沒有下載過。</p>}
    </div>
  );
}
