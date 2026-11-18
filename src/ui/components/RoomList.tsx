import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { Classroom, Division, ExamConfig, LabelPaper, RoomSeatLayout, Track } from '../../data';
import { effectiveRoom, roomDivision, rowDepthOf, seatLabel, seatSlotCount } from '../../data';
import { Alert, Badge, Button, ConfirmButton, EmptyState, Modal, Seg, Stepper, Switch } from './index';
import { confirmCopy, UNDO_HINT } from '../flow';
import { classColorVars } from '../colors';
import { addRoom, clickSeat, duplicateRoom, fillDefaultTracks, isSeatActive, patchRoom, removeRoom, labelSplitNote, resize, roomLimitsOf, seatLimitNote, setRoomDivision, setRoomTrack } from '../rooms';
import { rowDepthsOf, setAllDepth, setRowCount, stepRowDepth, toggleSeat } from '../ast/roomEdit';

/** G22：班級教室＝名冊班級（跟名冊走、不能手動新增或刪除）；沒有對應班級的班級教室是「名冊已沒有這個班」的舊教室 */
export const isOrphanClassRoom = (r: Classroom, classes?: { name: string }[]): boolean =>
  r.kind === 'class' && !!classes && !classes.some((c) => c.name === r.name);

/** 「N 排×M 深位」；每排深位不同時寫出各排（D138） */
const shapeText = (r: Classroom) => {
  const d = rowDepthsOf(r);
  return Math.min(...d) === Math.max(...d) ? null : `每排深位：${d.join('、')}`;
};

/** G21：座位配置小縮圖（講臺在下，深位 1 在最下列；不排的格子淡掉；該排沒有的深位留空）。純示意，不可點 */
function SeatThumb(p: { room: Classroom }) {
  const { room } = p;
  const depths = Array.from({ length: room.depth }, (_, i) => room.depth - i);
  const rows = Array.from({ length: room.rows }, (_, i) => i + 1);
  return (
    <span class="seatthumb" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${room.rows}, 5px)` }}>
      {depths.flatMap((d) => rows.map((rw) => <i key={`${rw}-${d}`} class={d > rowDepthOf(room, rw) ? 'none' : isSeatActive(room, { row: rw, depth: d }) ? '' : 'off'} />))}
    </span>
  );
}

/** 「＋」停用原因：到上限時寫在欄位下方（G21） */
const limitReason = (r: Classroom, key: 'rows' | 'depth'): string | null => {
  const l = roomLimitsOf(r.kind);
  return r[key] >= l[key] ? `${key === 'rows' ? '橫排' : '深位'}已達上限 ${l[key]}` : null;
};

/**
 * 教室清單（全站同一個元件；稿 v2.61、DESIGN 10.31、D138）：考試 ③（學測、會考、分科）、共用設定教室清單、首次設定精靈步驟 4 都用它。
 * 一間一列（可換行，不橫向捲動）：〔考試才有〕列入開關＋名稱｜座位縮圖與排×深位｜座位統計｜〔選用〕組別、額外欄｜「編輯座位」「刪除」；
 * 點整列或「編輯座位」就地展開座位編輯區（一次一間），考試頁上方可選套用範圍（只這次考試／共用設定）。
 * G22：班級教室跟名冊班級走，不能新增、不能刪；只能新增預備教室。座位上限：班級教室 7×7、預備教室 7 排×8 深位（G30）。
 */
export function RoomList(p: {
  rooms: Classroom[]; paper: LabelPaper; onChange: (r: Classroom[]) => void;
  /** 考試 ③：勾選本次使用的教室（有傳才顯示「列為考場」開關）；共用設定、精靈不傳 */
  selected?: string[]; onSelect?: (ids: string[]) => void;
  /** 這間教室是否已被某次模擬考選用（刪除確認時提醒） */
  inUse?: (id: string) => boolean;
  /** 班級資料：教室名稱與班級名稱相同時，前面的圓圈用該班的縮寫與代表色 */
  classes?: { name: string; colorIndex?: number; division?: string; track?: Track }[];
  /** 國中部：沒有文理組、沒有預備教室 */
  junior?: boolean;
  /** 校-33：只列這個部別的教室、新增的教室標上這個部別（國中部沒有預備教室） */
  division?: Division;
  /** 推斷舊教室部別要看的各次考試（沒標部別的舊資料才用得到） */
  exams?: Pick<ExamConfig, 'division' | 'classroomIds'>[];
  /** 到 B4 上限時提示裡的連結：去共用設定「學校與表頭」改標籤預設紙張 */
  onGoSchool?: () => void;
  /** 考試 ③：本次考試專用的座位配置覆寫（#210）；有傳 onOverride 才能選「只這次考試」 */
  overrides?: Record<string, RoomSeatLayout> | undefined;
  onOverride?: (roomId: string, layout: RoomSeatLayout | null) => void;
  /** 只列班級教室或只列預備教室（分科 ③ 分兩張卡） */
  only?: Classroom['kind'];
  /** 組別：seg＝可選理組／文組（學測 ③）；badge＝唯讀小牌（分科，教室跟班級走）；none＝不顯示。預設：國中部 none、其他 seg */
  track?: 'seg' | 'badge' | 'none';
  /** 列入開關的字樣（預設 列為考場／列為預備） */
  switchLabel?: (r: Classroom) => string;
  /** 預備教室的稱呼（分科叫綜合教室） */
  reserveName?: string;
  /** 每列的額外欄（分科自習容量、共用設定所屬部別、精靈學生人數）；room＝本次生效的教室，shared＝共用清單原樣 */
  extra?: (room: Classroom, shared: Classroom) => ComponentChildren;
  /** 表尾新增鈕；null＝不顯示（預設「＋ 新增預備教室」，國中部不顯示） */
  addLabel?: string | null;
}) {
  const [open, setOpen] = useState<string | null>(null);
  /** 編輯座位的套用範圍（G25）：預設共用設定；這間已有本次專用配置就從「只這次考試」開始 */
  const [scope, setScope] = useState<'exam' | 'shared'>('shared');
  const junior = p.junior ?? p.division === 'junior';
  const trackMode = p.track ?? (junior ? 'none' : 'seg');
  const reserveName = p.reserveName ?? '預備教室';
  const ctx = { classes: p.classes ?? [], exams: p.exams ?? [] };
  const classesOfDiv = p.classes?.filter((c) => !p.division || c.division === p.division);
  // 校-33：只列這個部別的教室；已被本次勾選、卻屬於另一部別的舊資料照樣列出，才關得掉，不會藏著影響排座
  const shown = p.rooms.filter((r) => !(junior && r.kind === 'reserve') && (!p.only || r.kind === p.only)
    && (!p.division || roomDivision(r, ctx) === p.division || !!p.selected?.includes(r.id)));
  const stamp = (x: Classroom): Classroom => (x.division || !p.division ? x : { ...x, division: roomDivision(x, ctx) });
  // 教室名稱與高中部班級同名、又還沒指定組別時，自動帶入該班的組別（溫良恭＝理組、儉勤誠＝文組）；只在可選組別的清單做
  useEffect(() => {
    if (trackMode !== 'seg') return;
    const filled = fillDefaultTracks(p.rooms, p.classes ?? []);
    if (filled !== p.rooms) p.onChange(filled);
  }, [p.rooms, p.classes]);
  const upd = (id: string, f: (r: Classroom) => Classroom) => p.onChange(patchRoom(p.rooms, id, (r) => stamp(f(r))));
  const openEditor = (id: string, hasOv: boolean, canOv: boolean) => {
    if (open === id) return setOpen(null);
    setScope(canOv && hasOv ? 'exam' : 'shared');
    setOpen(id);
  };
  const addLabel = p.addLabel === undefined ? (junior ? null : '＋ 新增預備教室') : p.addLabel;
  return (
    <div class="rw">
      <p class="muted small">座位上限：班級教室最多 7 排×7 深位（49 座）；{reserveName}最多 7 排×8 深位（56 座）。點整列或「編輯座位」調整座位排列，每一排的深位可以不同。</p>
      <div class="roomlist">
        {shown.map((shared, idx) => {
          const on = p.selected?.includes(shared.id) ?? false;
          const hasOv = !!p.overrides?.[shared.id];
          const canOv = !!p.onOverride && on;
          // 有本次專用配置時，這一列顯示的座位數字以本次為準（列上的名稱、組別仍是共用教室的）
          const r = effectiveRoom({ roomOverrides: p.overrides }, shared);
          const isOpen = open === shared.id;
          const orphan = isOrphanClassRoom(r, classesOfDiv);
          const isReserve = r.kind === 'reserve';
          const swLabel = p.switchLabel?.(r) ?? (isReserve ? '列為預備' : '列為考場');
          const lim = roomLimitsOf(r.kind);
          const examScope = isOpen && scope === 'exam' && canOv;
          const editing = examScope ? r : shared;
          const reasons = isOpen ? [limitReason(editing, 'rows'), limitReason(editing, 'depth')].filter(Boolean) : [];
          const slots = seatSlotCount(r);
          const shape = shapeText(r);
          const trackOf = r.track ?? p.classes?.find((c) => c.name === r.name)?.track;
          const stop = (e: Event) => e.stopPropagation();
          return (
            <div key={shared.id} class="rw">
              <div class={`roomrow${isOpen ? ' on' : ''}${p.selected && !on ? ' off' : ''}`} aria-expanded={isOpen} onClick={() => openEditor(shared.id, hasOv, canOv)}>
                <div class="swf" onClick={stop}>
                  {p.selected && p.onSelect ? (
                    <Switch label={swLabel} ariaLabel={`${swLabel}：${r.name}`} checked={on}
                      onChange={(v) => p.onSelect!(v ? [...p.selected!, r.id] : p.selected!.filter((x) => x !== r.id))} />
                  ) : <RoomBadge room={r} index={idx} classes={p.classes} />}
                </div>
                <div class="field"><label class="small" for={`rn-${r.id}`}>{isReserve ? reserveName : '教室'}</label>
                  <input id={`rn-${r.id}`} class="input" value={r.name} onClick={stop} onChange={(e) => upd(r.id, (x) => ({ ...x, name: e.currentTarget.value.trim() || x.name }))} />
                  {orphan && <span class="hint">名冊已沒有這個班</span>}</div>
                <div class="row roomcfg"><SeatThumb room={r} /><span><b>{r.rows}</b> 排×<b>{r.depth}</b> 深位{hasOv && <> <Badge tone="info">本次專用</Badge></>}{shape && <><br /><span class="small muted">{shape}</span></>}</span></div>
                <div class="info">座位 <b>{slots}</b>・不排 <b>{slots - r.seatCount}</b>・可排 <b>{r.seatCount}</b>{isReserve ? <><br />{reserveName}，不計入教室座位合計</> : null}</div>
                {trackMode === 'seg' && r.kind === 'class' && (
                  <div onClick={stop}>
                    <Seg<Track> label={`${r.name}組別`} value={(r.track ?? '') as Track} options={[{ value: 'science', label: '理組' }, { value: 'liberal', label: '文組' }]}
                      onChange={(t) => upd(r.id, (x) => setRoomTrack(x, t))} />
                    {!r.track && <span class="hint">⚠ 還沒指定，高中部排座會被擋下</span>}
                  </div>
                )}
                {trackMode === 'badge' && trackOf && <Badge>{trackOf === 'science' ? '理組教室' : '文組教室'}</Badge>}
                {p.extra && <div onClick={stop}>{p.extra(r, shared)}</div>}
                <div class="btnrow" onClick={stop}>
                  <Button small {...(isOpen ? { kind: 'primary' as const } : {})} onClick={() => openEditor(shared.id, hasOv, canOv)}>{isOpen ? '收合座位 ▴' : '編輯座位 ▾'}</Button>
                  {(isReserve || orphan) && (p.selected && p.onSelect
                    ? <RoomRemove name={r.name} inThis={on} inUse={!!p.inUse?.(r.id)} onThis={() => p.onSelect!(p.selected!.filter((x) => x !== r.id))} onShared={() => p.onChange(removeRoom(p.rooms, r.id))} />
                    : <ConfirmButton small copy={confirmCopy.deleteRoom(r.name, !!p.inUse?.(r.id))} onConfirm={() => p.onChange(removeRoom(p.rooms, r.id))}>刪除</ConfirmButton>)}
                  {isReserve && (
                    <details class="moremenu"><summary aria-label={`${r.name} 更多操作`}>⋯</summary>
                      <div class="menu stack" style="gap:6px">
                        <Button small onClick={() => p.onChange(duplicateRoom(p.rooms, r.id))}>複製這間教室</Button>
                      </div>
                    </details>
                  )}
                </div>
              </div>
              {isOpen && (
                <div class="editpane">
                  {canOv ? (
                    <div class="stack" style="gap:6px;margin-bottom:8px">
                      <div class="row"><span class="label">套用範圍</span>
                        <Seg<'exam' | 'shared'> label={`${r.name}套用範圍`} value={scope} options={[{ value: 'exam', label: '只這次考試' }, { value: 'shared', label: '共用設定（所有考試）' }]} onChange={setScope} /></div>
                      <p class="small muted">{examScope ? '只改這次考試：共用設定的教室不變，其他考試不受影響。' : '改共用設定：用到這間教室的所有考試都會跟著變。'}</p>
                      {hasOv && (
                        <div><ConfirmButton small kind="default" copy={confirmCopy.restoreRoomOverride(r.name)} onConfirm={() => { p.onOverride!(r.id, null); setScope('shared'); }}>還原成共用設定</ConfirmButton></div>
                      )}
                    </div>
                  ) : null}
                  <SeatGrid paper={p.paper} room={editing} lim={lim} cap={lim.cap} {...(examScope ? { examOnly: true } : {})} onClose={() => setOpen(null)}
                    onChange={(x) => (examScope ? p.onOverride!(r.id, layoutOf(x)) : upd(r.id, () => x))} />
                  {reasons.length > 0 && <p class="small hint">{reasons.join('；')}。</p>}
                </div>
              )}
            </div>
          );
        })}
        {shown.length === 0 && (p.only === 'reserve'
          ? <EmptyState title={`還沒有${reserveName}`}>有人要抽離或自習、需要另外的教室時，按下方「{addLabel ?? '新增'}」。</EmptyState>
          : <EmptyState title="還沒有教室">班級教室依名冊的班級自動帶出：還沒匯入學生名單請先匯入；已匯入就按上方「依名冊帶出班級教室」。</EmptyState>)}
      </div>
      {addLabel && (
        <div class="btnrow">
          <Button onClick={() => p.onChange(addRoom(p.rooms, 'reserve', p.division ?? 'senior', ctx))}>{addLabel}</Button>
          <span class="small muted">班級教室跟著名冊班級走，不能手動新增；手動新增的都是{reserveName}（抽離用，座位另計）。</span>
        </div>
      )}
    </div>
  );
}

/**
 * 共用設定「教室清單」：與考試 ③ 同一個教室清單元件（D138），沒有列入開關（共用設定沒有「這次考試用不用」）；
 * 多一欄「所屬部別」。只列 division 這個部別的教室；只有預備教室與名冊已沒有的班級教室能刪；國中部沒有預備教室。
 */
export function RoomTable(p: {
  rooms: Classroom[]; paper: LabelPaper; division: Division; onChange: (r: Classroom[]) => void;
  inUse?: (id: string) => boolean;
  classes?: { name: string; colorIndex?: number; division?: string; track?: Track }[];
  exams?: Pick<ExamConfig, 'division' | 'classroomIds'>[];
  /** 到 B4 上限時提示裡的連結：去共用設定「學校與表頭」改標籤預設紙張 */
  onGoSchool?: () => void;
}) {
  return (
    <div class="stack">
      <Alert tone="info"><b>所屬部別</b>決定這間教室在高中部或國中部的清單出現。舊資料讀進來時程式會依內容推斷；推斷錯了，直接在這一欄改，改完馬上換到另一個部別的清單。</Alert>
      <RoomList rooms={p.rooms} paper={p.paper} division={p.division} onChange={p.onChange} track="none"
        {...(p.inUse ? { inUse: p.inUse } : {})} {...(p.classes ? { classes: p.classes } : {})} {...(p.exams ? { exams: p.exams } : {})} {...(p.onGoSchool ? { onGoSchool: p.onGoSchool } : {})}
        extra={(r) => (
          <div class="field"><label class="small" for={`rd-${r.id}`}>所屬部別</label>
            <select id={`rd-${r.id}`} class="input" aria-label={`${r.name} 所屬部別`} value={p.division}
              onChange={(e) => p.onChange(patchRoom(p.rooms, r.id, (x) => setRoomDivision(x, e.currentTarget.value as Division)))}>
              <option value="senior">高中部</option>
              <option value="junior" disabled={r.kind === 'reserve'}>國中部</option>
            </select></div>
        )} />
    </div>
  );
}

/**
 * 考試 ③ 的教室刪除（G12，使用者 2026-11-17 裁示）：預設只從「本次考試」移除；確認視窗內勾選「同時從共用設定刪除」（預設不勾）才連共用清單一起刪，並警告影響。
 * 這間教室沒列入本次時，沒有「本次移除」可做，只剩從共用設定刪除。
 */
function RoomRemove(p: { name: string; inThis: boolean; inUse: boolean; onThis: () => void; onShared: () => void }) {
  const [open, setOpen] = useState(false);
  // 沒列入本次時沒有「本次移除」可做，只能從共用設定刪除（此時勾選固定成立）
  const [alsoShared, setAlsoShared] = useState(false);
  const shared = alsoShared || !p.inThis;
  const close = () => { setOpen(false); setAlsoShared(false); };
  return (
    <>
      <Button small kind="danger" onClick={() => setOpen(true)}>刪除</Button>
      {open && (
        <Modal title={`刪除「${p.name}」？`} onClose={close}
          actions={<><Button onClick={close}>取消</Button><Button kind="danger" onClick={() => { close(); if (shared) p.onShared(); else p.onThis(); }}>{shared ? '刪除（含共用設定）' : '從本次考試移除'}</Button></>}>
          <p>{p.inThis ? '預設只從「本次考試」移除這間教室，不動共用教室清單，也不影響其他模擬考；之後可用開關再列回。' : '這間教室目前沒有列入本次考試，只能從共用設定刪除。'}</p>
          {p.inThis && (
            <label class="chk" style="display:flex;gap:8px;align-items:flex-start;margin-top:10px">
              <input type="checkbox" checked={alsoShared} onChange={(e) => setAlsoShared(e.currentTarget.checked)} />
              <span>同時從共用設定刪除（<b>會影響其他考試</b>）</span>
            </label>
          )}
          {shared && <Alert tone="warn">共用設定刪除後，所有模擬考都會少這間教室{p.inUse || p.inThis ? '；已選用它的模擬考排座結果可能因此過期' : ''}。</Alert>}
          <p class="small muted" style="margin-top:8px">{UNDO_HINT}</p>
        </Modal>
      )}
    </>
  );
}

/** 教室列前的圓圈：名稱與某班相同＝該班縮寫＋代表色；其他班級教室＝編號；預備教室＝「備」（不再寫莫名的「班」） */
function RoomBadge(p: { room: Classroom; index: number; classes?: { name: string; colorIndex?: number }[] }) {
  const cls = p.room.kind === 'class' ? p.classes?.find((c) => c.name === p.room.name) : undefined;
  if (cls && cls.colorIndex !== undefined) return <span class="no" aria-hidden="true" style={classColorVars(cls.colorIndex)}>{[...cls.name][0]}</span>;
  return <span class="no" aria-hidden="true">{p.room.kind === 'class' ? p.index + 1 : '備'}</span>;
}

/** 取出教室的座位配置（本次專用覆寫只存這幾個欄位） */
export const layoutOf = (r: Classroom): RoomSeatLayout => ({
  rows: r.rows, depth: r.depth, seatCount: r.seatCount,
  ...(r.disabled?.length ? { disabled: r.disabled } : {}), ...(r.rowDepths ? { rowDepths: r.rowDepths } : {}),
});

/**
 * 座位表編輯（三種考試、共用設定、精靈共用；D49/D50、D138）：講臺在下，深位 1 最靠講臺；橫排標「第N排」，每格印「排-深位」。
 * 整間的橫排、深位步進器＋每一排各自的深位步進器（每排深位可不同，使用者 2026-11-18「三種考試都加」）；點座位切換可排／不排。
 * 每排深位都一樣時沿用原本的 resize／clickSeat（資料與以前完全相同）；不一樣時改用 roomEdit 的每排函式。
 */
function SeatGrid(p: { room: Classroom; paper: LabelPaper; cap: number; lim: { rows: number; depth: number }; onClose: () => void; onChange: (r: Classroom) => void; /** 本次考試專用（#210）：頂端標「本次專用」 */ examOnly?: boolean }) {
  const { room } = p;
  const varied = !!room.rowDepths;
  const per = rowDepthsOf(room);
  const slots = seatSlotCount(room);
  const depths = Array.from({ length: room.depth }, (_, i) => room.depth - i); // 上到下：深位大→小
  const rows = Array.from({ length: room.rows }, (_, i) => i + 1);
  const limits = { rows: p.lim.rows, depth: p.lim.depth, cap: p.cap };
  const setRows = (n: number) => p.onChange(varied ? setRowCount(room, n, limits) : resize(room, { rows: n }, p.cap, p.lim));
  const setDepth = (n: number) => p.onChange(varied ? setAllDepth(room, n, limits) : resize(room, { depth: n }, p.cap, p.lim));
  const click = (row: number, depth: number) => p.onChange(varied ? toggleSeat(room, row, depth, p.cap) : clickSeat(room, { row, depth }, p.cap));
  return (
    <div class="roomedit prev">
      <div class="row" style="justify-content:space-between"><div><h4>{p.examOnly ? <><Badge tone="info">本次專用</Badge>調整本次座位表：</> : '編輯座位表：'}{room.name}</h4>
        <p class="small muted">橫排 {room.rows} × 深位 {varied ? `每排不同（${per.join('、')}）` : room.depth} ＝ {slots} 個座位，可排 {room.seatCount}、不排 {slots - room.seatCount}。這類教室最多 {p.lim.rows} 排×{p.lim.depth} 深位（{p.cap} 個座位）。{p.examOnly ? '這裡的調整只用在這次考試，不會改動共用教室清單。' : ''}</p>
        {seatLimitNote(room) && <p class="small muted">{seatLimitNote(room)}</p>}
        {labelSplitNote(room, p.paper) && <p class="small hint">{labelSplitNote(room, p.paper)}</p>}</div>
        <Button small onClick={p.onClose}>收合</Button></div>
      <div class="row">
        <div class="field" style="gap:2px"><span class="small muted">橫排（左右）</span><Stepper label="橫排" value={room.rows} max={p.lim.rows} onChange={setRows} /></div>
        <div class="field" style="gap:2px"><span class="small muted">深位（前後，整間）</span><Stepper label="深位" value={room.depth} max={p.lim.depth} onChange={setDepth} /></div>
      </div>
      <div class="stack" style="gap:4px">
        <span class="small muted">每一排的深位（可以不同；例如最後一排少一個位子）</span>
        <div class="row rowdepths" role="group" aria-label={`${room.name}每排深位`}>
          {per.map((d, i) => (
            <div class="field" style="gap:2px" key={i}><span class="small muted">第{i + 1}排</span>
              <Stepper label={`第${i + 1}排深位`} value={d} max={p.lim.depth} onChange={(n) => p.onChange(stepRowDepth(room, i + 1, n > d ? 1 : -1, limits))} /></div>
          ))}
        </div>
      </div>
      <p class="muted small">座標是「排－深位」。點座位切換「可排／不排」（不排會打斜線，例如壞掉的桌椅或走道）；不排的座位不會安排考生，人由前往後連續坐。該排沒有的深位畫成淡斜線、不能點。</p>
      <div class="pgrid" style={{ gridTemplateColumns: `repeat(${room.rows}, minmax(0, 52px))` }} role="grid" aria-label={`${room.name}座位表`}>
        {depths.flatMap((d) => rows.map((rw) => {
          if (d > rowDepthOf(room, rw)) return <span key={`${rw}-${d}`} class="pc none" aria-hidden="true" />;
          const pos = { row: rw, depth: d };
          const act = isSeatActive(room, pos);
          return (
            <button type="button" key={`${rw}-${d}`} class={`pc${act ? '' : ' off'}`} aria-pressed={act} title={act ? '設為不排' : '恢復可排'}
              aria-label={`${seatLabel(pos)} ${act ? '可用' : '不排'}`} onClick={() => click(rw, d)}>{seatLabel(pos)}</button>
          );
        }))}
      </div>
      <p class="muted small">圖的下方是講臺：深位 1 最靠前、{room.depth} 最後面；橫排第 1～{room.rows} 排，由左到右。</p>
      <p class="small" style="text-align:center"><b>▔▔ 講臺 ▔▔</b></p>
    </div>
  );
}
