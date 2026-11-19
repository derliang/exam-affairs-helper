import { useEffect } from 'preact/hooks';
import { missingClassRooms, syncClassRooms } from '../classRooms';
import type { Classroom, ExamConfig, RoomSeatLayout, Track } from '../../data';
import { roomDivision, studyCapacityOf } from '../../data';
import { Alert, Badge, Button, More, Seg, StepHead, Stepper } from '../components';
import { RoomList } from '../components/RoomList';
import { AST_STEP_BLURBS } from '../nav';
import { newClassRoomIds, patchRoom } from '../rooms';
import { setClassTrack, updateExam, type Doc } from '../store';
import { classColorVars } from '../colors';
import { PhaseGuard } from './AstRelease';
import { LeaveCard } from './AstLeave';
import { astCapacity, astModeOf, astPlan, astPlanPending, MODE_LABEL } from './model';
import { resetStudyCapacity, stepStudyCapacity, studyAdjust } from './roomEdit';

/** 分科教室列的額外欄：自習容量（預設＝可排座位，可手動調高；稿 v2.34 ③）。教室列本身用全站同一個 RoomList（D138） */
function StudyCap(p: { shared: Classroom; onChange: (r: Classroom) => void }) {
  const sc = studyCapacityOf(p.shared);
  const adj = studyAdjust(p.shared);
  return (
    <div class="field" style="gap:2px"><span class="small muted">自習容量（預設＝可排座位）</span>
      <div class="row" style="gap:6px">
        <Stepper label="自習容量" value={sc} min={0} max={999} onChange={(n) => p.onChange(stepStudyCapacity(p.shared, n > sc ? 1 : -1))} />
        {adj.kind === 'raised' ? <Badge tone="warn">已手動調高 +{adj.diff}</Badge> : adj.kind === 'lowered' ? <Badge>已調低 {adj.diff}</Badge> : <span class="small muted">＝可排座位</span>}
        {adj.kind !== 'default' && <Button small kind="ghost" onClick={() => p.onChange(resetStudyCapacity(p.shared))}>自習容量還原</Button>}
      </div>
    </div>
  );
}

/** ③ 教室與自習空間（分科，DESIGN 10.14、稿 v2.34）：狀態檢核、班級、綜合教室、自習可以去哪裡、班級教室與座位圖 */
export function AstStep3(p: { doc: Doc; exam: ExamConfig; onChange: (d: Doc) => void; onToRooms?: () => void; onStep?: (n: 5) => void }) {
  const { doc, exam } = p;
  // G11：本次還沒選任何教室、名單有班級，就依班級自動帶出班級教室（同一般考試的 ③）
  const lackRooms = missingClassRooms(doc, exam);
  useEffect(() => {
    if (exam.classroomIds.length === 0 && lackRooms > 0) p.onChange(syncClassRooms(doc, exam));
  }, [exam.id, exam.classroomIds.length, lackRooms]);
  const paper = doc.settings.defaultLabelPaper;
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
  const upd = (id: string, r: Classroom) => setRooms(patchRoom(all, id, () => r));
  /** 兩張卡（綜合教室、班級教室）共用的教室清單設定：同一個 RoomList（D138） */
  const listProps = {
    rooms: all, paper, onChange: setRooms, division: 'senior' as const, exams: doc.exams, classes: doc.settings.classes,
    selected: exam.classroomIds, onSelect: setIds, overrides: exam.roomOverrides, onOverride: setOv,
    inUse: (id: string) => doc.exams.some((e) => e.id !== exam.id && e.classroomIds.includes(id)),
    extra: (_r: Classroom, shared: Classroom) => <StudyCap shared={shared} onChange={(x) => upd(shared.id, x)} />,
  };
  const patchExam = (patch: Partial<ExamConfig>) => { const r = updateExam(doc, exam.id, patch); if (r.ok) p.onChange(r.doc); };
  const short = capc.study.slotsShort;
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
          {capc.hasList && (
            <div class={`chk${capc.everyone.seats < capc.everyone.people ? ' bad' : ''}`}>
              <small>全體座位（含自習者）</small><strong>{capc.everyone.seats}</strong>
              <span class="sub">全體 {capc.everyone.people} 人{capc.studyOnly > 0 ? `（其中 ${capc.studyOnly} 人不考任何科、每節自習，不排考試座位，但要有地方坐）` : ''}</span>
              <Badge tone={capc.everyone.seats < capc.everyone.people ? 'danger' : 'ok'}>{capc.everyone.seats < capc.everyone.people ? `不足 ${capc.everyone.people - capc.everyone.seats}` : '夠用'}</Badge>
            </div>
          )}
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
        </div>
        <RoomList {...listProps} only="reserve" track="none" reserveName="綜合教室" addLabel="＋ 新增綜合教室" switchLabel={() => '本次可用'} />
      </div>

      <div class="card stack">
        <div class="row" style="justify-content:space-between;align-items:flex-start">
          <div><h3>自習可以去哪裡</h3><p class="small muted">預設自習只去上面勾選的綜合教室。若綜合教室不夠，程式會在 ⑤ 提出「改用某班原班教室」的替代方案並說明影響，<b>由你核可才採用，不會自動採用</b>。你也可以直接開啟右邊的開關，讓自習不夠時自動去沒當考場的原班教室。</p></div>
          <button type="button" class="btn" aria-pressed={!!exam.astAllowOtherStudy} onClick={() => patchExam({ astAllowOtherStudy: !exam.astAllowOtherStudy })}>{exam.astAllowOtherStudy ? '已允許自習去他班原班 ✓' : '允許自習去他班原班教室'}</button>
        </div>
      </div>

      <div class="card stack">
        <div>
          <h3>固定自習教室（自習座位）</h3>
          <p class="small muted">不考的人就是自習，也會排自習座位（只用來檢核座位夠不夠、可照坐，<b>不印標籤</b>）。被指定為固定自習教室的教室<b>全程不當考場</b>，每個人整天只去同一間。沒指定＝程式自動讓同一個人各節盡量在同一間自習、同班盡量在一起。自習座位每節各自排，不必每節同一個位子。座位以每間教室的編制人數為準，不足不硬排、會列出未排入的人。</p>
        </div>
        <div class="row" style="gap:6px;flex-wrap:wrap" role="group" aria-label="固定自習教室">
          {[...reserves, ...classRooms].filter((r) => selected.has(r.id)).map((r) => {
            const on = !!exam.astFixedStudyRooms?.includes(r.id);
            return <button type="button" class="btn" key={r.id} aria-pressed={on} onClick={() => patchExam({ astFixedStudyRooms: on ? (exam.astFixedStudyRooms ?? []).filter((x) => x !== r.id) : [...(exam.astFixedStudyRooms ?? []), r.id] })}>{r.name}{on ? ' ✓ 固定自習' : ''}</button>;
          })}
          {selected.size === 0 && <p class="small muted">先在上方勾選本次可用的教室。</p>}
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
        <RoomList {...listProps} only="class" track="badge" addLabel={null} switchLabel={() => '列入本次'} />
      </div>
      </PhaseGuard>
      <LeaveCard doc={doc} exam={exam} onChange={p.onChange} />
    </section>
  );
}
