import { useEffect, useState } from 'preact/hooks';
import type { Classroom, Division, ExamConfig, LabelPaper, RoomSeatLayout, Track } from '../../data';
import { effectiveRoom, roomDivision, seatLabel } from '../../data';
import { Alert, Badge, Button, ConfirmButton, Modal, Seg, Stepper, Switch } from './index';
import { confirmCopy, UNDO_HINT } from '../flow';
import { classColorVars } from '../colors';
import { addRoom, addRooms, clickSeat, duplicateRoom, fillDefaultTracks, isSeatActive, patchRoom, removeRoom, labelSplitNote, resize, roomCapacity, seatCap, seatLimitNote, seatLimits, setRoomDivision, setRoomTrack } from '../rooms';

/**
 * 教室清單與座位表編輯（步驟③與設定頁共用，D69②）：每間一列，點該列或「編輯座位表」就在列下展開，可收合。
 * 座位只能多不能少；點哪個座位，哪個就不排（可任意指定）；座位上限依標籤紙（D74）。
 */
export function RoomList(p: {
  rooms: Classroom[]; paper: LabelPaper; onChange: (r: Classroom[]) => void;
  /** 步驟③：勾選本次使用的教室；設定頁不傳 */
  selected?: string[]; onSelect?: (ids: string[]) => void;
  /** 這間教室是否已被某次模擬考選用（刪除確認時提醒） */
  inUse?: (id: string) => boolean;
  /** 班級資料：教室名稱與班級名稱相同時，前面的圓圈用該班的縮寫與代表色 */
  classes?: { name: string; colorIndex: number; division?: string; track?: Track }[];
  /** 步驟③ 國中部會考：沒有文理組（不顯示組別）、沒有抽離（不列預備教室）；高中部與設定頁不傳 */
  junior?: boolean;
  /** 校-33：只列這個部別的教室、新增的教室標上這個部別（國中部沒有預備教室）；不傳＝不分部別（舊用法） */
  division?: Division;
  /** 推斷舊教室部別要看的各次考試（沒標部別的舊資料才用得到） */
  exams?: Pick<ExamConfig, 'division' | 'classroomIds'>[];
  /** 到 B4 上限時提示裡的連結：去共用設定「學校與表頭」改標籤預設紙張 */
  onGoSchool?: () => void;
  /** 步驟③：本次考試專用的座位配置覆寫（#210）；有傳 onOverride 才顯示「本次調整座位」 */
  overrides?: Record<string, RoomSeatLayout> | undefined;
  onOverride?: (roomId: string, layout: RoomSeatLayout | null) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const cap = seatCap(p.paper);
  const lim = seatLimits(p.paper);
  const junior = p.junior ?? p.division === 'junior';
  const ctx = { classes: p.classes ?? [], exams: p.exams ?? [] };
  // 校-33：只列這個部別的教室；已被本次勾選、卻屬於另一部別的舊資料照樣列出，才關得掉，不會藏著影響排座
  const shown = p.rooms.filter((r) => !(junior && r.kind === 'reserve')
    && (!p.division || roomDivision(r, ctx) === p.division || !!p.selected?.includes(r.id)));
  const stamp = (x: Classroom): Classroom => (x.division || !p.division ? x : { ...x, division: roomDivision(x, ctx) });
  // 教室名稱與高中部班級同名、又還沒指定組別時，自動帶入該班的組別（溫良恭＝理組、儉勤誠＝文組）
  useEffect(() => {
    const filled = fillDefaultTracks(p.rooms, p.classes ?? []);
    if (filled !== p.rooms) p.onChange(filled);
  }, [p.rooms, p.classes]);
  const upd = (id: string, f: (r: Classroom) => Classroom) => p.onChange(patchRoom(p.rooms, id, (r) => stamp(f(r))));
  const addRow = (
    <div class="btnrow">
      <Button onClick={() => p.onChange(addRoom(p.rooms, 'class', p.division ?? 'senior', ctx))}>新增教室</Button>
      {!junior && <Button onClick={() => p.onChange(addRoom(p.rooms, 'reserve', p.division ?? 'senior', ctx))}>新增預備教室</Button>}
      <BulkAdd onAdd={(n) => p.onChange(addRooms(p.rooms, 'class', n, p.division ?? 'senior', ctx))} />
    </div>
  );
  return (
    <div class="rw">
      <p class="muted small">座位上限：每間最多 {lim.rows} 排×{lim.depth} 深位、{cap} 座；比標籤紙大時，標籤會自動分張。點「▸ 編輯座位」調整座位排列。</p>
      {addRow}
      {shown.map((shared) => {
        const on = p.selected?.includes(shared.id) ?? false;
        const hasOv = !!p.overrides?.[shared.id];
        const canOv = !!p.onOverride && on;
        // 有本次專用配置時，這一列顯示的座位數字以本次為準（列上的名稱、組別仍是共用教室的）
        const r = effectiveRoom({ roomOverrides: p.overrides }, shared);
        const examKey = `${shared.id}#exam`;
        const isOpen = open === shared.id;
        const isOvOpen = open === examKey;
        return (
          <div key={r.id} class="rw">
            <div class={`roomrow${p.selected && !on ? ' off' : ''}${isOpen ? ' on' : ''}${r.kind === 'class' && !junior ? ' hastrack' : ' notrack'}`} onClick={() => setOpen(isOpen ? null : r.id)}>
              {p.selected && p.onSelect ? (
                <Switch label={r.kind === 'class' ? '列為考場' : '列為預備'} ariaLabel={`${r.kind === 'class' ? '列為考場' : '列為預備'}：${r.name}`} checked={on}
                  onChange={(v) => p.onSelect!(v ? [...p.selected!, r.id] : p.selected!.filter((x) => x !== r.id))} />
              ) : <RoomBadge room={r} index={shown.indexOf(r)} classes={p.classes} />}
              <div class="field"><label class="small" for={`rn-${r.id}`}>{r.kind === 'class' ? '教室' : '預備教室'}</label>
                <input id={`rn-${r.id}`} class="input" value={r.name} onClick={(e) => e.stopPropagation()} onChange={(e) => upd(r.id, (x) => ({ ...x, name: e.currentTarget.value.trim() || x.name }))} /></div>
              <div class="field" onClick={(e) => e.stopPropagation()}><span class="label">橫排（左右）</span><Stepper label="橫排" value={r.rows} max={lim.rows} onChange={(n) => upd(r.id, (x) => resize(x, { rows: n }, cap, lim))} /></div>
              <div class="field" onClick={(e) => e.stopPropagation()}><span class="label">深位（前後）</span><Stepper label="深位" value={r.depth} max={lim.depth} onChange={(n) => upd(r.id, (x) => resize(x, { depth: n }, cap, lim))} /></div>
              {r.kind === 'class' && !junior && (
                <div class="field" onClick={(e) => e.stopPropagation()}><span class="label">組別（高中部必選）</span>
                  <Seg<Track> label={`${r.name}組別`} value={(r.track ?? '') as Track} options={[{ value: 'science', label: '理組' }, { value: 'liberal', label: '文組' }]}
                    onChange={(t) => upd(r.id, (x) => setRoomTrack(x, t))} />
                  {!r.track && <span class="hint">⚠ 還沒指定，高中部排座會被擋下</span>}</div>
              )}
              <div class="info">{hasOv && <Badge tone="info">本次專用</Badge>}座位 <b>{roomCapacity(r)}</b>・不排 <b>{roomCapacity(r) - r.seatCount}</b>・可排 <b>{r.seatCount}</b>{r.kind === 'reserve' ? <><br />預備教室，不計入教室座位合計</> : (!junior && r.track ? <><br />{r.track === 'science' ? '理組' : '文組'}</> : null)}</div>
              <div class="btnrow" onClick={(e) => e.stopPropagation()}>
                <Button small onClick={() => setOpen(isOpen ? null : r.id)}>{isOpen ? '▾ 收合座位' : '▸ 編輯座位'}</Button>
                <Button small onClick={() => p.onChange(duplicateRoom(p.rooms, r.id))}>複製這間教室</Button>
                {canOv && <Button small onClick={() => setOpen(isOvOpen ? null : examKey)}>{isOvOpen ? '▾ 收合本次座位' : hasOv ? '編輯本次座位' : '本次調整座位'}</Button>}
                {canOv && hasOv && <ConfirmButton small kind="default" copy={confirmCopy.restoreRoomOverride(r.name)} onConfirm={() => { p.onOverride!(r.id, null); if (isOvOpen) setOpen(null); }}>還原成共用設定</ConfirmButton>}
                {p.selected && p.onSelect
                  ? <RoomRemove name={r.name} inThis={on} inUse={!!p.inUse?.(r.id)} onThis={() => p.onSelect!(p.selected!.filter((x) => x !== r.id))} onShared={() => p.onChange(removeRoom(p.rooms, r.id))} />
                  : <ConfirmButton small copy={confirmCopy.deleteRoom(r.name, !!p.inUse?.(r.id))} onConfirm={() => p.onChange(removeRoom(p.rooms, r.id))}>刪除</ConfirmButton>}
              </div>
            </div>
            {isOpen && <SeatGrid paper={p.paper} room={shared} cap={cap} lim={lim} onClose={() => setOpen(null)} onChange={(x) => upd(r.id, () => x)} />}
            {isOvOpen && canOv && <SeatGrid paper={p.paper} room={r} cap={cap} lim={lim} steppers examOnly onClose={() => setOpen(null)} onChange={(x) => p.onOverride!(r.id, layoutOf(x))} />}
          </div>
        );
      })}
    </div>
  );
}

/**
 * 共用設定「教室清單」（稿 v2.22 校-43）：表格——名稱／類型／橫排×深位／可排座位／編輯座位表；整列可點展開座位表；
 * 只有預備教室有刪除；國中部沒有預備教室（也沒有新增預備教室鈕）。只列 division 這個部別的教室。
 */
export function RoomTable(p: {
  rooms: Classroom[]; paper: LabelPaper; division: Division; onChange: (r: Classroom[]) => void;
  inUse?: (id: string) => boolean;
  classes?: { name: string; division?: string; track?: Track }[];
  exams?: Pick<ExamConfig, 'division' | 'classroomIds'>[];
  /** 到 B4 上限時提示裡的連結：去共用設定「學校與表頭」改標籤預設紙張 */
  onGoSchool?: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const cap = seatCap(p.paper);
  const lim = seatLimits(p.paper);
  const junior = p.division === 'junior';
  const ctx = { classes: p.classes ?? [], exams: p.exams ?? [] };
  const shown = p.rooms.filter((r) => roomDivision(r, ctx) === p.division && !(junior && r.kind === 'reserve'));
  const upd = (id: string, f: (r: Classroom) => Classroom) => p.onChange(patchRoom(p.rooms, id, (r) => { const x = f(r); return x.division ? x : { ...x, division: p.division }; }));
  return (
    <div class="stack">
      <p class="muted small">座位上限：每間最多 {lim.rows} 排×{lim.depth} 深位、{cap} 座；比標籤紙大時，標籤會自動分張。點「編輯座位」調整座位排列。</p>
      <Alert tone="info"><b>所屬部別</b>決定這間教室在高中部或國中部的清單出現。舊資料讀進來時程式會依內容推斷；推斷錯了，直接在這一欄改，改完馬上換到另一個部別的清單。</Alert>
      <div class="scroll">
        <table class="t compact nw">
          <thead><tr><th>名稱</th><th>類型</th><th>所屬部別</th><th>橫排×深位</th><th>可排座位</th><th /></tr></thead>
          <tbody>
            {shown.map((r) => {
              const isOpen = open === r.id;
              const toggle = () => setOpen(isOpen ? null : r.id);
              return [
                <tr key={r.id} class={`rowtap${isOpen ? ' open' : ''}`} aria-expanded={isOpen} onClick={toggle}>
                  <td><input class="input" style="min-width:150px" value={r.name} aria-label={`教室名稱：${r.name}`} onClick={(e) => e.stopPropagation()}
                    onChange={(e) => upd(r.id, (x) => ({ ...x, name: e.currentTarget.value.trim() || x.name }))} /></td>
                  <td>{r.kind === 'reserve' ? '預備教室' : '教室'}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <select class="input" style="min-width:110px" aria-label={`${r.name} 所屬部別`} value={p.division}
                      onChange={(e) => p.onChange(patchRoom(p.rooms, r.id, (x) => setRoomDivision(x, e.currentTarget.value as Division)))}>
                      <option value="senior">高中部</option>
                      <option value="junior" disabled={r.kind === 'reserve'}>國中部</option>
                    </select>
                  </td>
                  <td class="n">{r.rows}×{r.depth}</td>
                  <td class="n">{r.seatCount}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div class="row" style="flex-wrap:nowrap">
                      <Button small {...(isOpen ? { kind: 'primary' as const } : {})} onClick={toggle}>{isOpen ? '收合座位' : '編輯座位'}</Button>
                      <Button small onClick={() => p.onChange(duplicateRoom(p.rooms, r.id))}>複製</Button>
                      <ConfirmButton small copy={confirmCopy.deleteRoom(r.name, !!p.inUse?.(r.id))} onConfirm={() => p.onChange(removeRoom(p.rooms, r.id))}>刪除</ConfirmButton>
                    </div>
                  </td>
                </tr>,
                isOpen && <tr key={`${r.id}-edit`} class="editrow"><td colSpan={6}><SeatGrid paper={p.paper} room={r} cap={cap} lim={lim} steppers onClose={() => setOpen(null)} onChange={(x) => upd(r.id, () => x)} /></td></tr>,
              ];
            })}
            {shown.length === 0 && <tr><td colSpan={6} class="muted">{junior ? '國中部還沒有教室，請按下方「新增教室」。' : '高中部還沒有教室。'}</td></tr>}
          </tbody>
        </table>
      </div>
      <div class="row">
        <Button onClick={() => p.onChange(addRoom(p.rooms, 'class', p.division, ctx))}>新增教室</Button>
        {!junior && <Button onClick={() => p.onChange(addRoom(p.rooms, 'reserve', p.division, ctx))}>新增預備教室</Button>}
        <BulkAdd onAdd={(n) => p.onChange(addRooms(p.rooms, 'class', n, p.division, ctx))} />
      </div>
    </div>
  );
}

/**
 * 步驟③的教室刪除（G12，使用者 2026-11-17 裁示）：預設只從「本次考試」移除；要連共用設定一起刪，得另按第二顆（危險色）並寫明影響。
 * 這間教室沒列入本次時，沒有「本次移除」可做，只剩從共用設定刪除。
 */
function RoomRemove(p: { name: string; inThis: boolean; inUse: boolean; onThis: () => void; onShared: () => void }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <Button small kind="danger" onClick={() => setOpen(true)}>刪除</Button>
      {open && (
        <Modal title={`刪除「${p.name}」？`} onClose={close}
          actions={<>
            <Button onClick={close}>取消</Button>
            {p.inThis && <Button kind="primary" onClick={() => { close(); p.onThis(); }}>只從本次考試移除</Button>}
            <Button kind="danger" onClick={() => { close(); p.onShared(); }}>同時從共用設定刪除</Button>
          </>}>
          <p>{p.inThis ? '「只從本次考試移除」不會動到共用教室清單與其他模擬考；之後可再用開關列回。' : '這間教室目前沒有列入本次考試，只能從共用設定刪除。'}</p>
          <p class="small muted" style="margin-top:8px">「同時從共用設定刪除」會讓所有模擬考都少這間教室{p.inUse ? '，已選用它的模擬考排座結果可能因此過期' : ''}。{UNDO_HINT}</p>
        </Modal>
      )}
    </>
  );
}

/** 一次新增 N 間教室（#205）：先選間數再按鈕；新增後可逐間改排數，或用「複製這間教室」 */
function BulkAdd(p: { onAdd: (n: number) => void }) {
  const [n, setN] = useState(6);
  return (
    <span class="row" style="flex-wrap:nowrap;gap:6px">
      <Stepper label="一次新增間數" value={n} max={20} onChange={setN} />
      <Button onClick={() => p.onAdd(n)}>一次新增 {n} 間教室</Button>
    </span>
  );
}

/** 教室列前的圓圈：名稱與某班相同＝該班縮寫＋代表色；其他班級教室＝編號；預備教室＝「備」（不再寫莫名的「班」） */
function RoomBadge(p: { room: Classroom; index: number; classes?: { name: string; colorIndex: number }[] }) {
  const cls = p.room.kind === 'class' ? p.classes?.find((c) => c.name === p.room.name) : undefined;
  if (cls) return <span class="no" aria-hidden="true" style={classColorVars(cls.colorIndex)}>{[...cls.name][0]}</span>;
  return <span class="no" aria-hidden="true">{p.room.kind === 'class' ? p.index + 1 : '備'}</span>;
}

/** 取出教室的座位配置（本次專用覆寫只存這幾個欄位） */
export const layoutOf = (r: Classroom): RoomSeatLayout => ({
  rows: r.rows, depth: r.depth, seatCount: r.seatCount,
  ...(r.disabled?.length ? { disabled: r.disabled } : {}), ...(r.rowDepths ? { rowDepths: r.rowDepths } : {}),
});

/** 座位表：講臺在下，深位 1 最靠講臺（左側只標數字），橫排標「第N排」，每格印「排-深位」（D49/D50） */
function SeatGrid(p: { room: Classroom; paper: LabelPaper; cap: number; lim: { rows: number; depth: number }; onClose: () => void; onChange: (r: Classroom) => void; /** 本次考試專用（#210）：頂端標「本次專用」 */ examOnly?: boolean; /** 設定頁表格版：橫排、深位步進器放在座位表上方（稿 v2.22「同一個編輯畫面」） */ steppers?: boolean }) {
  const { room } = p;
  const depths = Array.from({ length: room.depth }, (_, i) => room.depth - i); // 上到下：深位大→小
  const rows = Array.from({ length: room.rows }, (_, i) => i + 1);
  return (
    <div class="roomedit prev">
      <div class="row" style="justify-content:space-between"><div><h4>{p.examOnly ? <><Badge tone="info">本次專用</Badge>編輯本次座位表：</> : '編輯座位表：'}{room.name}</h4>
        <p class="small muted">橫排 {room.rows} × 深位 {room.depth} ＝ {roomCapacity(room)} 個座位，可排 {room.seatCount}、不排 {roomCapacity(room) - room.seatCount}。一間教室最多 {p.lim.rows} 排×{p.lim.depth} 深位（{p.cap} 個座位）。座位只能多、不能少；不納入預備教室。{p.examOnly ? '這裡的調整只用在這次考試，不會改動共用教室清單。' : ''}</p>
        {seatLimitNote(room) && <p class="small muted">{seatLimitNote(room)}</p>}
        {labelSplitNote(room, p.paper) && <p class="small hint">{labelSplitNote(room, p.paper)}</p>}</div>
        <Button small onClick={p.onClose}>收合</Button></div>
      {p.steppers && (
        <div class="row">
          <div class="field" style="gap:2px"><span class="small muted">橫排（左右）</span><Stepper label="橫排" value={room.rows} max={p.lim.rows} onChange={(n) => p.onChange(resize(room, { rows: n }, p.cap, p.lim))} /></div>
          <div class="field" style="gap:2px"><span class="small muted">深位（前後）</span><Stepper label="深位" value={room.depth} max={p.lim.depth} onChange={(n) => p.onChange(resize(room, { depth: n }, p.cap, p.lim))} /></div>
        </div>
      )}
      <p class="muted small">座標是「排－深位」。點座位切換「可排／不排」（不排會打斜線，例如壞掉的桌椅或走道）；不排的座位不會安排考生，人由前往後連續坐。</p>
      <div style="overflow-x:auto">
        <div style="display:grid;grid-template-columns:auto 1fr;gap:6px;align-items:center">
          <div />
          <div class="pgrid" style={{ gridTemplateColumns: `repeat(${room.rows}, max-content)` }} role="grid" aria-label={`${room.name}座位表`}>
            {depths.flatMap((d) => rows.map((rw) => {
              const pos = { row: rw, depth: d };
              const act = isSeatActive(room, pos);
              return (
                <button type="button" key={`${rw}-${d}`} class={`pc${act ? '' : ' off'}`} aria-pressed={act} title={act ? '設為不排' : '恢復可排'}
                  aria-label={`${seatLabel(pos)} ${act ? '可用' : '不排'}`} onClick={() => p.onChange(clickSeat(room, pos, p.cap))}>{seatLabel(pos)}</button>
              );
            }))}
          </div>
        </div>
        <p class="muted small" style="margin-top:6px">圖的下方是講臺：深位 1 最靠前、{room.depth} 最後面；橫排第 1～{room.rows} 排，由左到右。</p>
        <p class="small" style="margin-top:4px;text-align:center"><b>▔▔ 講臺 ▔▔</b></p>
      </div>
    </div>
  );
}
