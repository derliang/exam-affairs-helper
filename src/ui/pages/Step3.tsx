import { useEffect } from 'preact/hooks';
import type { ExamConfig, RoomSeatLayout, Track } from '../../data';
import { Alert, Badge, Button, EmptyState, More, Seg, StepHead } from '../components';
import { RoomList } from '../components/RoomList';
import { PrepCard } from './PrepCard';
import { classRoomRows, missingClassRooms, syncClassRooms } from '../classRooms';
import { classCapacity, reserveCheck, reserveNeed, studyCapacity } from '../capacity';
import { StudyNeedDetail } from './StudyCapacityView';
import { newClassRoomIds, roomsMissingTrack } from '../rooms';
import { examEntries, examRooms, seatableEntries } from '../seating';
import { addedReserveIds, markRoomsBefore, takeRoomsBefore } from '../pendingNewRooms';
import { setClassTrack, updateExam, type Doc } from '../store';

/** ③ 教室設定：標題卡、狀態檢核卡（理組／文組分列＋預備教室）、班級（文理組）卡、教室與座位卡（原型 v3） */
export function Step3(p: { doc: Doc; exam: ExamConfig; onChange: (d: Doc) => void; onToRooms?: () => void; onToSchool?: () => void; onToRoster?: () => void }) {
  const { doc, exam } = p;
  // G11：進到本步驟時，本次還沒選任何教室、名單又有班級，就依班級自動帶出班級教室（已有選用的不動，使用者刪掉的不會被偷偷加回來）
  const lackRooms = missingClassRooms(doc, exam);
  const rosterCount = doc.rosters[exam.division].length;
  useEffect(() => {
    if (exam.classroomIds.length === 0 && lackRooms > 0) p.onChange(syncClassRooms(doc, exam));
  }, [exam.id, exam.classroomIds.length, lackRooms]);
  const rooms = doc.settings.classrooms;
  // #635 ②：從這裡去共用設定新增的預備教室，回來預設列入本次考試
  useEffect(() => {
    const before = takeRoomsBefore(exam.id);
    if (!before) return;
    const added = addedReserveIds(before, doc.settings.classrooms).filter((id) => !exam.classroomIds.includes(id));
    if (!added.length) return;
    const r = updateExam(doc, exam.id, { classroomIds: [...exam.classroomIds, ...added] });
    if (r.ok) p.onChange(r.doc);
  }, [exam.id]);
  const toRooms = p.onToRooms ? () => { markRoomsBefore(exam.id, doc.settings.classrooms.map((r) => r.id)); p.onToRooms!(); } : undefined;
  const senior = exam.division === 'senior';
  const { lines, noList, seats } = classCapacity(doc, exam);
  const students = seatableEntries(doc, exam).length;
  const bcct = exam.kind === 'bcct';
  const allRooms = examRooms(doc, exam);
  const reserveSeats = allRooms.filter((r) => r.kind === 'reserve').reduce((n, r) => n + r.seatCount, 0);
  const hasList = examEntries(doc, exam).length > 0;
  const missing = roomsMissingTrack(examRooms(doc, exam), exam.division);
  const reserve = reserveCheck(doc, exam);
  const need = reserveNeed(doc, exam);
  const sc = studyCapacity(doc, exam);
  const prepBad = !sc.ok;
  const roster = doc.rosters[exam.division];
  const classes = doc.settings.classes.filter((c) => c.division === exam.division);
  const noTrack = roster.length === 0 ? 0 : classes.filter((c) => !c.track).length;
  /** 新增的班級教室直接列入本次考試（TODO-15），預備教室預設不列入；其他變更不動選用狀態 */
  const setRooms = (classrooms: typeof rooms) => {
    const added = newClassRoomIds(rooms, classrooms);
    const next = { ...doc, settings: { ...doc.settings, classrooms } };
    if (!added.length) return p.onChange(next);
    const r = updateExam(next, exam.id, { classroomIds: [...exam.classroomIds, ...added] });
    p.onChange(r.ok ? r.doc : next);
  };
  const setOverride = (id: string, l: RoomSeatLayout | null) => {
    const cur = { ...(exam.roomOverrides ?? {}) };
    if (l) cur[id] = l; else delete cur[id];
    const r = updateExam(doc, exam.id, { roomOverrides: cur });
    if (r.ok) p.onChange(r.doc);
  };
  const setIds = (ids: string[]) => { const r = updateExam(doc, exam.id, { classroomIds: ids }); if (r.ok) p.onChange(r.doc); };

  return (
    <section class="stack">
      <StepHead title="③ 教室設定" />

      <div class="card stack">
        <div>
          <h3>狀態檢核</h3>
          <p class="small muted">座位只能多、不能少。</p>
          <More title="說明：空位與計算方式">多出來的空位留在最後，座位由前往後連續安排。{senior ? '高中部理組、文組各自計算，預備教室不納入；預備教室座位另計（目前 ' + reserveSeats + '）。' : ''}</More>
        </div>
        {/* 沒有考生人數時不顯示 0（D82），但座位合計仍要看得到 */}
        {noList && (bcct
          ? <Alert tone="info">共用學生名單是空的，沒有考生可檢核；教室座位合計 {seats}。</Alert>
          : <Alert tone="info"><b>尚未匯入考試名單：</b>教室座位合計 {seats}。匯入考試名單後檢核夠不夠。</Alert>)}
        {/* 稿 v2.109（D228，#672）：標題列＝名稱＋狀態膠囊同一行、中大數字、下說明（取代稿 v2.22 校-31 徽章在最下）；高中部多一格「預備教室座位」（需要／已列入） */}
        {(lines.length > 0 || (senior && hasList)) && (
          <div class="stats chkgrid">
            {lines.map((l) => {
              const extra = l.seats - l.students;
              return (
                <div key={l.label} class={`chk${l.ok ? (extra > 0 && hasList ? ' warnc' : '') : ' bad'}`}>
                  <div class="chk-h"><small>{l.label}座位</small>{hasList && <Badge tone={l.ok ? (extra > 0 ? 'warn' : 'ok') : 'danger'}>{l.ok ? (extra > 0 ? `多 ${extra}` : '剛好') : `不足 ${l.students - l.seats}`}</Badge>}</div>
                  <strong>{l.seats}</strong>
                  {hasList && <span class="sub">學生 {l.students}</span>}
                </div>
              );
            })}
            {senior && hasList && (
              <div class={`chk${prepBad ? ' bad' : ''}`}>
                <div class="chk-h"><small>預備教室座位</small><Badge tone={prepBad ? 'danger' : 'ok'}>{prepBad ? `不足 ${Math.max(1, sc.worst?.short ?? 1)}` : need.need === 0 ? '不需要' : '夠用'}</Badge></div>
                <strong>{need.avail}</strong>
                <span class="sub">需要 {need.need}・已列入 {need.on}／{need.total} 間</span>
              </div>
            )}
          </div>
        )}
        <div class="stack" style="gap:6px">
          {lines.map((l) => <p key={l.label} class={`small${l.ok ? ' muted' : ' errnote'}`}>{l.ok ? <><b>{l.label}：</b>{l.detail}</> : l.message}</p>)}
          {senior && hasList && <StudyNeedDetail sc={sc} onAdd={(ids) => setIds([...exam.classroomIds, ...ids])} {...(toRooms ? { onNewRoom: toRooms } : {})} />}
        </div>
        {missing.length > 0 && <Alert tone="danger"><b>高中部排座要先指定教室的組別。</b>「{missing.map((r) => r.name).join('、')}」還沒選理組或文組，請在下面該列的「組別」按鈕選一個（預備教室不用選）。</Alert>}
        {!senior && <Alert tone={reserve.tone}>{reserve.message}</Alert>}
      </div>

      {/* 稿 v2.31：班級與教室合成一張卡，上＝班級文理組、下＝教室清單；預備教室排座與標籤接在教室清單之後 */}
      <div class="card stack">
        <div><h3>班級</h3><p class="small muted">{senior ? '文理由班級決定，預設 01～03 理組、04～06 文組。' : ''}</p></div>
        {senior ? (
          <>
            <div class="cls-pal">
              {classes.map((c) => (
                <div class="cp" data-c={c.colorIndex} key={c.no}>
                  <strong>{c.name}</strong>
                  <span>{String(c.no).padStart(2, '0')} 班・{roster.filter((s) => s.classNo === c.no).length} 人</span>
                  <Seg<Track> label={`${c.name}班文理組`} value={(c.track ?? '') as Track} onChange={(t) => p.onChange(setClassTrack(doc, exam.division, c.no, t))}
                    options={[{ value: 'science', label: '理組' }, { value: 'liberal', label: '文組' }]} />
                </div>
              ))}
            </div>
            {classes.length === 0 && <EmptyState title="共用設定還沒有高中部的班級" />}
            {noTrack > 0 && <Alert tone="warn">有 {noTrack} 個班級還沒分理組、文組，排座會被擋下。</Alert>}
          </>
        ) : <Alert tone="info">會考不分文理組，所有班級打散到所有教室。</Alert>}
        <div class="psec">
          <div class="row" style="justify-content:space-between">
            <div>
              <h3>教室與座位</h3>
              <p class="small muted">每班的班級教室已依學生名單自動帶出，只要調整座位配置；班級教室跟名冊班級走、不能手動新增；手動新增的只有預備教室。</p>
              <More title="說明：座位表與教室來源">{senior ? '預備教室座位另計，不計入教室座位合計。' : ''}教室清單是所有模擬考共用的：修改教室會影響其他使用這間教室的模擬考；只想改這次考試的座位，請在「編輯座位」上方選「只這次考試」。</More>
            </div>
            {toRooms && <Button onClick={toRooms}>到共用設定的教室清單 ›</Button>}
          </div>
          {rosterCount === 0 && (
            <Alert tone="info" action={p.onToRoster && <Button small onClick={p.onToRoster}>到學生名單 ›</Button>}><b>還沒有學生名單：</b>匯入學生名單後，會依班級自動帶出每班的班級教室。</Alert>
          )}
          {rosterCount > 0 && lackRooms > 0 && exam.classroomIds.length > 0 && (
            <Alert tone="warn" action={<Button small kind="primary" onClick={() => p.onChange(syncClassRooms(doc, exam))}>依班級補齊教室</Button>}>有 {lackRooms} 個班級還沒有列入本次考試的班級教室：{classRoomRows(doc, exam).filter((r) => !r.inExam).map((r) => r.cls.name).join('、')}。</Alert>
          )}
          <RoomList {...(p.onToSchool ? { onGoSchool: p.onToSchool } : {})} junior={!senior} division={exam.division} exams={doc.exams} classes={doc.settings.classes} rooms={rooms} paper={doc.settings.defaultLabelPaper} onChange={setRooms} selected={exam.classroomIds} onSelect={setIds} overrides={exam.roomOverrides} onOverride={setOverride} />
        </div>
      </div>

      {senior && <PrepCard doc={doc} exam={exam} onChange={p.onChange} />}
    </section>
  );
}
