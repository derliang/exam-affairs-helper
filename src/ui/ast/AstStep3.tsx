import { useEffect, useState } from 'preact/hooks';
import { missingClassRooms, syncClassRooms } from '../classRooms';
import type { Classroom, ExamConfig, LabelPaper, RoomSeatLayout, Track } from '../../data';
import { effectiveRoom, rowDepthOf, roomDivision, studyCapacityOf } from '../../data';
import { Alert, Badge, Button, ConfirmButton, More, Seg, StepHead } from '../components';
import { confirmCopy } from '../flow';
import { layoutOf } from '../components/RoomList';
import { AST_STEP_BLURBS } from '../nav';
import { addRoom, labelSplitNote, newClassRoomIds, patchRoom, roomLimitsOf, seatCap, seatLimitNote, seatLimits } from '../rooms';
import { setClassTrack, updateExam, type Doc } from '../store';
import { classColorVars } from '../colors';
import { PhaseGuard } from './AstRelease';
import { LeaveCard } from './AstLeave';
import { astCapacity, astModeOf, astPlan, astPlanPending, MODE_LABEL } from './model';
import { isSeatOff, resetStudyCapacity, rowDepthsOf, stepRowDepth, stepStudyCapacity, studyAdjust, toggleSeat } from './roomEdit';

/** 座位圖編輯器：每排一個 −／＋（深位數可不同）、點座位停用／恢復（稿 v2.34 ③） */
function SeatEditor(p: { room: Classroom; cap: number; maxDepth: number; onChange: (r: Classroom) => void; paper: LabelPaper; examOnly?: boolean }) {
  const { room } = p;
  const depths = rowDepthsOf(room);
  const mx = Math.max(...depths);
  const cols = `repeat(${depths.length},minmax(54px,1fr))`;
  const cells: preact.JSX.Element[] = [];
  for (let d = mx; d >= 1; d--) {
    for (let c = 1; c <= depths.length; c++) {
      if (d > rowDepthOf(room, c)) { cells.push(<span key={`${c}-${d}`} class="sq none" aria-hidden="true" />); continue; }
      const off = isSeatOff(room, c, d);
      cells.push(
        <button key={`${c}-${d}`} type="button" class={`sq${off ? ' off' : ''}`} aria-pressed={!off}
          aria-label={`第${c}排第${d}個，${off ? '已停用，點一下恢復' : '可排，點一下停用'}`} onClick={() => p.onChange(toggleSeat(room, c, d, p.cap))}>{off ? '停' : `${c}-${d}`}</button>,
      );
    }
  }
  return (
    <div class="aed">
      {p.examOnly && <div><Badge tone="info">本次專用</Badge> <span class="small muted">編輯本次座位圖：這裡的調整只用在這次考試，不會改動共用教室清單。</span></div>}
      <div class="small muted">每一排的深位數可以不同（用 − ＋ 調整）；點座位可停用或恢復，停用的座位不排人。沒有座位的地方（該排深位比較少）也畫成斜線。座位上限：最多 {p.cap} 個座位、每排最多 {p.maxDepth} 個深位；超過 7×7 的舊教室標籤無法對應，請縮小。{seatLimitNote(room) ? seatLimitNote(room) : ''}</div>
      {labelSplitNote(room, p.paper) && <div class="small hint">{labelSplitNote(room, p.paper)}</div>}
      <div class="aedgrid" style={{ gridTemplateColumns: cols }}>
        {depths.map((d, i) => (
          <div class="aedcol" key={i}>
            <span class="small muted">第{i + 1}排</span>
            <div class="stepper">
              <button type="button" class="icon-btn" aria-label={`第${i + 1}排深位減一`} disabled={d <= 1} onClick={() => p.onChange(stepRowDepth(room, i + 1, -1, { depth: p.maxDepth, cap: p.cap }))}>−</button>
              <output>{d}</output>
              <button type="button" class="icon-btn" aria-label={`第${i + 1}排深位加一`} disabled={d >= p.maxDepth} onClick={() => p.onChange(stepRowDepth(room, i + 1, 1, { depth: p.maxDepth, cap: p.cap }))}>＋</button>
            </div>
          </div>
        ))}
      </div>
      <div class="aedseat" style={{ gridTemplateColumns: cols }}>{cells}</div>
      <p class="small muted" style="text-align:center"><b>▔▔ 講臺（深位 1 靠講臺）▔▔</b></p>
    </div>
  );
}

function RoomRow(p: {
  room: Classroom; badge: preact.JSX.Element; open: boolean; onToggleOpen: () => void; onChange: (r: Classroom) => void; cap: number; maxDepth: number;
  on: boolean; onSwitch: (v: boolean) => void; switchLabel: string; trackBadge?: string;
  paper: LabelPaper;
  /** 本次考試專用座位配置（#210）：room＝本次實際生效的教室；shared＝共用教室清單裡的原樣；ov 沒傳＝不提供本次調整 */
  shared: Classroom;
  ov?: { has: boolean; open: boolean; onToggle: () => void; onChange: (l: RoomSeatLayout) => void; onRestore: () => void };
}) {
  const { room: r } = p;
  const depths = rowDepthsOf(r);
  const slots = depths.reduce((n, d) => n + d, 0);
  const sc = studyCapacityOf(r);
  const adj = studyAdjust(r);
  const same = Math.min(...depths) === Math.max(...depths);
  return (
    <div class="rw">
      <div class={`roomrow astrow${p.on ? '' : ' off'}`}>
        <div class="row" style="flex-wrap:nowrap;gap:8px">{p.badge}<b>{r.name}</b>{p.ov?.has && <Badge tone="info">本次專用</Badge>}</div>
        <div>
          <button type="button" class="btn btn-sm" aria-pressed={p.on} aria-label={`${p.switchLabel}：${r.name}`} onClick={() => p.onSwitch(!p.on)}>{p.on ? `${p.switchLabel} ✓` : `${p.switchLabel.replace('可用', '不用').replace('列入', '不列入')}`}</button>
          {p.trackBadge && <span class="badge" style="margin-left:6px">{p.trackBadge}</span>}
        </div>
        <div class="info">座位 <b>{slots}</b>・停用 <b>{slots - r.seatCount}</b>・可排 <b>{r.seatCount}</b><br />
          <span class="small muted">{depths.length} 排，深位 {same ? `每排 ${depths[0]}` : `每排不同（${depths.join('、')}）`}</span></div>
        <div class="field" style="gap:2px"><span class="small muted">自習容量（預設＝可排座位）</span>
          <div class="stepper">
            <button type="button" class="icon-btn" aria-label="自習容量減一" disabled={sc <= 0} onClick={() => p.onChange(stepStudyCapacity(p.shared, -1))}>−</button>
            <output>{sc}</output>
            <button type="button" class="icon-btn" aria-label="自習容量加一" onClick={() => p.onChange(stepStudyCapacity(p.shared, 1))}>＋</button>
          </div>
          {adj.kind === 'raised' ? <span class="badge b-warn">已手動調高 +{adj.diff}</span> : adj.kind === 'lowered' ? <span class="badge">已調低 {adj.diff}</span> : <span class="small muted">＝可排座位</span>}
        </div>
        <div class="row" style="flex-wrap:nowrap">
          <Button small {...(p.open ? { kind: 'primary' as const } : {})} onClick={p.onToggleOpen}>{p.open ? '收合座位圖' : '編輯座位圖'}</Button>
          {p.ov && p.on && <Button small onClick={p.ov.onToggle}>{p.ov.open ? '收合本次座位' : p.ov.has ? '調整本次座位' : '調整本次座位'}</Button>}
          {p.ov?.has && p.on && <ConfirmButton small kind="default" copy={confirmCopy.restoreRoomOverride(r.name)} onConfirm={p.ov.onRestore}>還原成共用設定</ConfirmButton>}
          {adj.kind !== 'default' && <Button small kind="ghost" onClick={() => p.onChange(resetStudyCapacity(p.shared))}>自習容量還原</Button>}
        </div>
      </div>
      {p.open && <SeatEditor room={p.shared} paper={p.paper} cap={p.cap} maxDepth={p.maxDepth} onChange={p.onChange} />}
      {p.ov?.open && p.on && <SeatEditor room={r} paper={p.paper} examOnly cap={p.cap} maxDepth={p.maxDepth} onChange={(x) => p.ov!.onChange(layoutOf(x))} />}
    </div>
  );
}

/** ③ 教室與自習空間（分科，DESIGN 10.14、稿 v2.34）：狀態檢核、班級、綜合教室、自習可以去哪裡、班級教室與座位圖 */
export function AstStep3(p: { doc: Doc; exam: ExamConfig; onChange: (d: Doc) => void; onToRooms?: () => void; onStep?: (n: 5) => void }) {
  const { doc, exam } = p;
  const [open, setOpen] = useState<string | null>(null);
  // G11：本次還沒選任何教室、名單有班級，就依班級自動帶出班級教室（同一般考試的 ③）
  const lackRooms = missingClassRooms(doc, exam);
  useEffect(() => {
    if (exam.classroomIds.length === 0 && lackRooms > 0) p.onChange(syncClassRooms(doc, exam));
  }, [exam.id, exam.classroomIds.length, lackRooms]);
  const paper = doc.settings.defaultLabelPaper;
  const cap = seatCap(paper);
  const lim = seatLimits(paper);
  const ctx = { classes: doc.settings.classes, exams: doc.exams };
  const all = doc.settings.classrooms;
  const inDiv = (r: Classroom) => roomDivision(r, ctx) === 'senior';
  const classRooms = all.filter((r) => r.kind === 'class' && inDiv(r));
  const reserves = all.filter((r) => r.kind === 'reserve' && inDiv(r));
  const classes = doc.settings.classes.filter((c) => c.division === 'senior');
  const roster = doc.rosters.senior ?? [];
  const plan = astPlan(doc, exam);
  const capc = astCapacity(doc, exam, plan);
  const selected = new Set(exam.classroomIds);
  const noTrack = roster.length === 0 ? 0 : classes.filter((c) => !c.track).length;
  const setRooms = (classrooms: Classroom[]) => {
    const added = newClassRoomIds(all, classrooms);
    const next = { ...doc, settings: { ...doc.settings, classrooms } };
    if (!added.length) return p.onChange(next);
    const r = updateExam(next, exam.id, { classroomIds: [...exam.classroomIds, ...added] });
    p.onChange(r.ok ? r.doc : next);
  };
  const setIds = (ids: string[]) => { const r = updateExam(doc, exam.id, { classroomIds: ids }); if (r.ok) p.onChange(r.doc); };
  const setOv = (id: string, l: RoomSeatLayout | null) => {
    const cur = { ...(exam.roomOverrides ?? {}) };
    if (l) cur[id] = l; else delete cur[id];
    patchExam({ roomOverrides: cur });
  };
  const ovOf = (r: Classroom) => ({
    has: !!exam.roomOverrides?.[r.id], open: open === `${r.id}#exam`,
    onToggle: () => setOpen(open === `${r.id}#exam` ? null : `${r.id}#exam`),
    onChange: (l: RoomSeatLayout) => setOv(r.id, l),
    onRestore: () => { setOv(r.id, null); if (open === `${r.id}#exam`) setOpen(null); },
  });
  const upd = (id: string, r: Classroom) => setRooms(patchRoom(all, id, () => r));
  const toggleId = (id: string, v: boolean) => setIds(v ? [...exam.classroomIds, id] : exam.classroomIds.filter((x) => x !== id));
  const patchExam = (patch: Partial<ExamConfig>) => { const r = updateExam(doc, exam.id, patch); if (r.ok) p.onChange(r.doc); };
  const short = capc.study.slotsShort;
  const byName = new Map(classes.map((c) => [c.name, c]));
  const check = (label: string, have: number, need: number) => {
    const bad = capc.hasList && have < need;
    return (
      <div class={`chk${bad ? ' bad' : ''}`}>
        <small>{label}</small><strong>{have}</strong>
        {capc.hasList && <span class="sub">最多一個時段考生 {need}</span>}
        {capc.hasList && <Badge tone={bad ? 'danger' : 'ok'}>{bad ? `不足 ${need - have}` : '夠用'}</Badge>}
      </div>
    );
  };

  return (
    <section class="stack">
      <StepHead title="③ 教室與自習空間" blurb={AST_STEP_BLURBS[2]} />
      <PhaseGuard exam={exam}>

      <div class="card stack">
        <div>
          <h3>狀態檢核</h3>
          <p class="small muted">分科<b>每個時段各自排</b>：每個時段只排當時要考的人，教室每個時段可以換用途（考場或自習），同一時段同一間教室只能擇一。這裡檢查座位與自習空間夠不夠；精確的每個時段用途在 ⑤。</p>
        </div>
        {astPlanPending() && <p class="small muted" role="status">自習空間統計更新中…（停止編輯後自動更新）</p>}
        {!capc.hasList && <Alert tone="info"><b>尚未匯入考試名單：</b>匯入後才能檢核座位與自習空間夠不夠。</Alert>}
        <div class="stats chkgrid">
          {check('理組考場座位', capc.science.seats, capc.science.need)}
          {check('文組考場座位', capc.liberal.seats, capc.liberal.need)}
          <div class={`chk${capc.hasList && short > 0 ? ' warnc' : ''}`}>
            <small>綜合教室自習容量</small><strong>{capc.study.capacity}</strong>
            {capc.hasList && <span class="sub">最多一個時段自習 {capc.study.need}（{MODE_LABEL[astModeOf(exam)]}）・已勾 {capc.study.on}／{capc.study.total} 間</span>}
            {capc.hasList && <Badge tone={short > 0 ? 'warn' : 'ok'}>{short > 0 ? `有 ${short} 個時段放不下` : '夠用'}</Badge>}
          </div>
        </div>
        {capc.hasList && short > 0 && (
          <Alert tone="warn" action={p.onStep ? <Button small onClick={() => p.onStep!(5)}>到 ⑤ 看替代方案</Button> : undefined}>
            <b>有 {short} 個時段的綜合教室自習容量不夠。</b>可以在下面調高自習容量、勾選更多綜合教室，或開啟「允許自習去他班原班教室」；也可以到 ⑤ 看程式提的替代方案。
          </Alert>
        )}
      </div>

      <div class="card stack">
        <div><h3>班級</h3><p class="small muted">教室的文理組＝班級的文理組；理組班教室只排理組考生、文組班教室只排文組考生（保留 D93、D95）。</p></div>
        <div class="cls-pal">
          {classes.map((c) => (
            <div class="cp" style={classColorVars(c.colorIndex)} data-c={c.colorIndex} key={c.no}>
              <strong>{c.name}</strong>
              <span>{String(c.no).padStart(2, '0')} 班・{roster.filter((s) => s.classNo === c.no).length} 人</span>
              <Seg<Track> label={`${c.name}班文理組`} value={(c.track ?? '') as Track} onChange={(t) => p.onChange(setClassTrack(doc, 'senior', c.no, t))}
                options={[{ value: 'science', label: '理組' }, { value: 'liberal', label: '文組' }]} />
            </div>
          ))}
        </div>
        {classes.length === 0 && <p class="small muted">共用設定還沒有高中部的班級。</p>}
        {noTrack > 0 && <Alert tone="warn">有 {noTrack} 個班級還沒分理組、文組，排座會被擋下。</Alert>}
      </div>

      <div class="card stack">
        <div class="row" style="justify-content:space-between">
          <div><h3>綜合教室（＝預備教室）</h3><p class="small muted">被徵用成考場的原班，不考的同學<b>預設只送綜合教室</b>自習。綜合教室可以有<b>多間，每次可能不同</b>：勾選本次可用的，並確認各自的座位與自習容量。</p></div>
          <Button onClick={() => setRooms(addRoom(all, 'reserve', 'senior', ctx))}>新增綜合教室</Button>
        </div>
        <div class="roomlist stack" style="gap:8px">
          {reserves.map((r) => (
            <RoomRow key={r.id} room={effectiveRoom(exam, r)} shared={r} paper={paper} ov={ovOf(r)} badge={<span class="no rbadge" aria-hidden="true">綜</span>} open={open === r.id} onToggleOpen={() => setOpen(open === r.id ? null : r.id)}
              onChange={(x) => upd(r.id, x)} cap={roomLimitsOf('reserve').cap} maxDepth={roomLimitsOf('reserve').depth} on={selected.has(r.id)} onSwitch={(v) => toggleId(r.id, v)} switchLabel="本次可用" />
          ))}
          {reserves.length === 0 && <p class="small muted">還沒有綜合教室。分科有人被徵用原班、不考的人要有地方自習時，請新增並勾選。</p>}
        </div>
      </div>

      <div class="card stack">
        <div class="row" style="justify-content:space-between;align-items:flex-start">
          <div><h3>自習可以去哪裡</h3><p class="small muted">預設自習只去上面勾選的綜合教室。若綜合教室不夠，程式會在 ⑤ 提出「改用某班原班教室」的替代方案並說明影響，<b>由你核可才採用，不會自動採用</b>。你也可以直接開啟右邊的開關，讓自習不夠時自動去沒當考場的原班教室。</p></div>
          <button type="button" class="btn" aria-pressed={!!exam.astAllowOtherStudy} onClick={() => patchExam({ astAllowOtherStudy: !exam.astAllowOtherStudy })}>{exam.astAllowOtherStudy ? '已允許自習去他班原班 ✓' : '允許自習去他班原班教室'}</button>
        </div>
      </div>

      <div class="card stack">
        <div class="row" style="justify-content:space-between">
          <div>
            <h3>教室與座位圖</h3>
            <p class="small muted">座位圖可以每排深位數不同、可停用個別座位；要留空就停用座位，不另做「隔排、隔位」規則。<b>自習容量預設等於可排座位</b>，可以手動調高，程式不會自己調大。座位上限：每間最多 7 排×7 深位、49 座（與標籤 7×7 一致）。</p>
            <More title="說明：教室清單與勾選">教室清單是所有模擬考共用的：修改座位圖與自習容量會影響其他使用這間教室的模擬考。「列入本次」沿用原有的勾選，沒列入的教室不會被排考試或自習。</More>
          </div>
          {p.onToRooms && <Button onClick={p.onToRooms}>到共用設定看教室清單</Button>}
        </div>
        <div class="roomlist stack" style="gap:8px">
          {classRooms.map((r) => {
            const c = byName.get(r.name);
            const track = r.track ?? c?.track;
            return (
              <RoomRow key={r.id} room={effectiveRoom(exam, r)} shared={r} paper={paper} ov={ovOf(r)}
                badge={c ? <span class="no rbadge" aria-hidden="true" style={classColorVars(c.colorIndex)}>{[...c.name][0]}</span> : <span class="no rbadge" aria-hidden="true">班</span>}
                open={open === r.id} onToggleOpen={() => setOpen(open === r.id ? null : r.id)} onChange={(x) => upd(r.id, x)} cap={cap} maxDepth={lim.depth}
                on={selected.has(r.id)} onSwitch={(v) => toggleId(r.id, v)} switchLabel="列入本次" {...(track ? { trackBadge: track === 'science' ? '理組教室' : '文組教室' } : {})} />
            );
          })}
          {classRooms.length === 0 && <p class="small muted">高中部還沒有教室，請到共用設定新增。</p>}
        </div>
      </div>
      </PhaseGuard>
      <LeaveCard doc={doc} exam={exam} onChange={p.onChange} />
    </section>
  );
}
