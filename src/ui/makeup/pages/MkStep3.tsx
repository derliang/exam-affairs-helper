/**
 * S-4 ③ 教室設定：教室清單（用全站同一個 RoomList，D138／CLAUDE.md〈UI 一律用設計系統與共用元件〉）、
 * 類型（一般／特別；混班由系統自動挑，D180）、本次使用開關、狀態檢核（F-15：最擁擠時段的同時在考人數 vs 可用座位）。
 * 座位上限沿用 D160：橫排、深位各 ≤8、總座位 ≤56（稿寫 7×7 是舊的 G14，已被 D160 取代）。
 */
import { Alert, Badge, Button, Seg, Switch } from '../../components';
import { RoomList } from '../../components/RoomList';
import type { Classroom } from '../../../data';
import { fmtTime, type MakeupRoom, type MakeupRoomUse } from '../../../core/makeup';
import { roomCheckOf } from '../pipeline';
import type { MakeupSession } from '../session';

export const USE_TEXT: Record<MakeupRoomUse, string> = { class: '一般', mixed: '一般', special: '特別' };
const USE_HINT: Record<MakeupRoomUse, string> = {
  class: '同班同科盡量同一間；放不下整班時，系統會自動把整班搬到還有空位的教室（混班），不用自己標記。',
  mixed: '',
  special: '提前開考的學生在這裡第一節就開考，單獨管理離場。',
};

/** 補考教室 ↔ 全站教室清單元件的 Classroom（教室一律當同一種，用途另存在補考教室上） */
export const toClassroom = (r: MakeupRoom): Classroom => ({
  id: r.id, name: r.name, kind: 'reserve', rows: r.rows, depth: r.depth, seatCount: r.seatCount, division: 'senior',
  ...(r.disabled?.length ? { disabled: r.disabled } : {}), ...(r.rowDepths ? { rowDepths: r.rowDepths } : {}),
});

export function fromClassrooms(list: Classroom[], prev: MakeupRoom[]): MakeupRoom[] {
  return list.map((c): MakeupRoom => {
    const old = prev.find((r) => r.id === c.id);
    return {
      id: c.id, name: c.name, rows: c.rows, depth: c.depth, seatCount: c.seatCount, use: old?.use ?? 'class',
      ...(c.disabled?.length ? { disabled: c.disabled } : {}), ...(c.rowDepths ? { rowDepths: c.rowDepths } : {}),
    };
  });
}

export function newRoom(rooms: readonly MakeupRoom[]): MakeupRoom {
  let n = rooms.length + 1;
  while (rooms.some((r) => r.id === `room-${n}`)) n++;
  return { id: `room-${n}`, name: `教室${rooms.length + 1}`, rows: 5, depth: 6, seatCount: 30, use: 'class' };
}

/** #635 ③：共用設定裡還沒帶進這場補考的教室（高中部或不分部；已帶入的以 id 判斷） */
export const sharedToImport = (shared: readonly Classroom[], rooms: readonly MakeupRoom[]): Classroom[] => {
  const have = new Set(rooms.map((r) => r.id));
  return shared.filter((c) => c.division !== 'junior' && !have.has(c.id));
};

export function MkStep3(p: { s: MakeupSession; onChange: (s: MakeupSession) => void; shared?: readonly Classroom[] }) {
  const { s } = p;
  const chk = roomCheckOf(s);
  const setRooms = (rooms: MakeupRoom[]) => {
    // 教室變了：使用者調整過的指定教室（pins）由 alignPlan 對齊；考程本身不必作廢
    const ids = new Set(rooms.map((r) => r.id));
    p.onChange({ ...s, rooms, roomOff: s.roomOff.filter((id) => ids.has(id)) });
  };
  const todo = sharedToImport(p.shared ?? [], s.rooms);
  const importShared = () => setRooms([...s.rooms, ...fromClassrooms(todo, [])]);
  const setUse = (id: string, use: MakeupRoomUse) => setRooms(s.rooms.map((r) => (r.id === id ? { ...r, use } : r)));
  const toggle = (id: string, on: boolean) => p.onChange({ ...s, roomOff: on ? s.roomOff.filter((x) => x !== id) : [...new Set([...s.roomOff, id])] });
  const worst = chk.days.find((d) => d.need - d.seats === chk.shortage && !d.ok);
  return (
    <section class="stack">
      <div class="card stephead"><div><h2>③ 教室設定</h2><p class="small muted">這次可以用哪些教室？每次由你輸入，系統記在本機，下次自動帶出。</p></div></div>

      <div class="card stack">
        <div class="lab">狀態檢核</div>
        {chk.enabled === 0
          ? <Alert tone="danger"><b>還沒有可用的教室</b>：請在下面新增，或打開「本次使用」。沒有教室就排不了考程。</Alert>
          : chk.empty
            ? <Alert tone="info"><b>還沒有名單可以比對</b>：匯入名單後，這裡會拿最擁擠時段的同時在考人數比可用座位。目前啟用 {chk.enabled} 間、座位 {chk.days[0]?.seats ?? 0} 席。</Alert>
            : chk.ok
              ? <Alert tone="ok"><b>座位夠用</b>：最擁擠的時段（{chk.days.reduce((a, d) => (d.need >= a.need ? d : a)).label}）需要 {Math.max(...chk.days.map((d) => d.need))} 席，目前啟用 {chk.days[0]?.seats ?? 0} 席。</Alert>
              : <Alert tone="danger"><b>座位不夠：最擁擠的時段缺 {chk.shortage} 席</b>。{worst ? `${worst.label}（約 ${fmtTime(worst.at)}）同時需要 ${worst.need} 席，目前啟用的教室只有 ${worst.seats} 席。` : ''}請開啟更多教室，或把座位加大。</Alert>}
        <p class="small muted">座位每個時段都重複使用，所以比的是「最擁擠時段同時在考的人數」，不是全日人次（D123）。</p>
        {chk.days.length > 0 && (
          <div class="rtw"><table class="t compact rt-t">
            <thead><tr><th>考日</th><th>可用座位</th><th>需求（最擁擠時段）</th><th>狀態</th></tr></thead>
            <tbody>
              {chk.days.map((d) => (
                <tr key={d.dayId} class={d.ok ? '' : 'bad'}>
                  <td class="ti" data-label="考日">{d.label}</td><td data-label="可用座位">{d.seats}</td><td data-label="需求（最擁擠時段）">{d.need}</td>
                  <td data-label="狀態">{d.ok ? <Badge tone="ok">✓ 夠用</Badge> : <Badge tone="danger">✕ 缺 {d.need - d.seats} 席</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        <p class="small muted">啟用教室 {chk.enabled}　共 {chk.total} 間</p>
      </div>

      <div class="card stack">
        <div class="lab">教室清單</div>
        <p class="small muted">混班教室由系統自動挑，你只要設定哪些是特別教室（提前開考用）。</p>
        {todo.length > 0 && (
          <Alert tone="info" action={<Button small kind="primary" onClick={importShared}>帶入 {todo.length} 間教室</Button>}>
            共用設定的教室清單裡有 {todo.length} 間教室還沒帶進這場補考（座位圖照共用設定），不必一間間新增。帶入後可再調整座位、開關「本次使用」。
          </Alert>
        )}
        <RoomList flat rooms={s.rooms.map(toClassroom)} paper="B4" division="senior" track="none" reserveName="教室" addLabel="＋ 新增教室"
          onAdd={() => setRooms([...s.rooms, newRoom(s.rooms)])}
          onChange={(list) => setRooms(fromClassrooms(list, s.rooms))}
          extra={(r) => {
            const room = s.rooms.find((x) => x.id === r.id);
            if (!room) return null;
            return (
              <div class="stack" style="gap:6px">
                <Switch label="本次使用" ariaLabel={`本次使用：${room.name}`} checked={!s.roomOff.includes(room.id)} onText="使用" offText="未使用" onChange={(v) => toggle(room.id, v)} />
                <Seg<MakeupRoomUse> label={`${room.name}類型`} value={room.use} options={(['class', 'special'] as const).map((u) => ({ value: u, label: USE_TEXT[u] }))} onChange={(u) => setUse(room.id, u)} />
              </div>
            );
          }} />
      </div>

      <div class="card stack">
        <div class="lab">兩種類型</div>
        <ul class="small stack" style="gap:6px;padding-left:18px;margin:0">
          {(['class', 'special'] as const).map((u) => <li key={u}><b>{USE_TEXT[u]}教室</b>　{USE_HINT[u]}</li>)}
        </ul>
      </div>
    </section>
  );
}
