import { Alert, Badge, Button, EmptyState } from '../components';
import { fmtTime, roomSeats, type MakeupRoom, type MakeupRoomUse } from '../../core/makeup';
import { derive, newRoom, roomFromShared, roomSpare, roomsPatch, withRoomShape } from './model';
import type { MakeupStepProps } from './MakeupStep1';

const USE_TEXT: Record<MakeupRoomUse, string> = { class: '一般班級教室', mixed: '混班教室', special: '特別教室（提前開考）' };
const int = (v: string, min: number, max: number): number | null => { const n = Number(v); return v.trim() !== '' && Number.isInteger(n) && n >= min && n <= max ? n : null; };

/** ③ 教室設定（S-4；F-13～F-16）：每次輸入可用教室、座位、用途；頂部檢核最擁擠時段的同時在考人數 vs 座位（F-15） */
export function MakeupStep3(p: MakeupStepProps) {
  const { s, doc } = p;
  const rooms = s.settings.rooms;
  const d = derive(s);
  const shared = doc.settings.classrooms.filter((c) => c.kind === 'class');
  const have = new Set(rooms.map((r) => r.id));
  const addable = shared.filter((c) => !have.has(`S-${c.id}`));
  const set = (id: string, f: (r: MakeupRoom) => MakeupRoom) => p.onChange(roomsPatch(s, rooms.map((r) => (r.id === id ? f(r) : r))));
  const total = rooms.reduce((n, r) => n + roomSeats(r), 0);
  return (
    <section class="stack" aria-label="教室設定">
      <div class="card stephead"><div><h2>③ 教室設定</h2><p class="small muted">這次補考可用的教室與座位。座位每一節重複使用，所以只比「最擁擠那一節」的人數。座標寫「排－深位」。</p></div></div>

      <div class="card stack" role="status" aria-label="容量檢核">
        <div class="lab">容量檢核（F-15）</div>
        {!d.roster || d.entries.length === 0
          ? <p class="small muted">還沒有名單，匯入後這裡會顯示每個考日最擁擠時段的同時在考人數與可用座位。</p>
          : d.peak.map((x) => {
            const day = s.settings.days.find((y) => y.id === x.dayId)?.label ?? x.dayId;
            return (
              <div class="row" key={x.dayId}>
                {x.ok ? <Badge tone="ok">✓ 夠</Badge> : <Badge tone="danger">✕ 不足</Badge>}
                <span>{day}：最擁擠在 <b>{fmtTime(x.at)}</b>，同時在考 <b>{x.peak}</b> 人，可用座位 <b>{x.seats}</b>{x.ok ? `（剩 ${x.seats - x.peak}）` : `（缺 ${x.peak - x.seats}，請增加教室）`}</span>
              </div>
            );
          })}
        <p class="small muted">目前共 {rooms.length} 間教室、{total} 個座位。</p>
      </div>

      {rooms.length === 0 && <EmptyState title="還沒有教室" action={<Button kind="primary" onClick={() => p.onChange(roomsPatch(s, [newRoom(s)]))}>新增教室</Button>}>補考教室每次由你輸入（也可從共用設定帶入班級教室）；下次補考會自動帶出。</EmptyState>}

      {rooms.length > 0 && (
        <div class="card stack"><div class="lab">教室清單</div>
          <div class="scroll"><table class="t compact"><thead><tr><th>名稱</th><th>橫排</th><th>深位</th><th>空位</th><th>座位數</th><th>用途</th><th /></tr></thead>
            <tbody>{rooms.map((r) => (
              <tr key={r.id}>
                <td><input class="input" style="min-width:120px" aria-label="教室名稱" value={r.name} onInput={(e) => set(r.id, (x) => ({ ...x, name: e.currentTarget.value }))} /></td>
                <td><input class="input" type="number" style="width:76px" aria-label={`${r.name} 橫排`} min={1} max={20} value={r.rows} onInput={(e) => { const n = int(e.currentTarget.value, 1, 20); if (n) set(r.id, (x) => withRoomShape(x, n, x.depth, roomSpare(x))); }} /></td>
                <td><input class="input" type="number" style="width:76px" aria-label={`${r.name} 深位`} min={1} max={20} value={r.depth} onInput={(e) => { const n = int(e.currentTarget.value, 1, 20); if (n) set(r.id, (x) => withRoomShape(x, x.rows, n, roomSpare(x))); }} /></td>
                <td><input class="input" type="number" style="width:76px" aria-label={`${r.name} 空位`} min={0} value={roomSpare(r)} onInput={(e) => { const n = int(e.currentTarget.value, 0, 399); if (n !== null) set(r.id, (x) => withRoomShape(x, x.rows, x.depth, n)); }} /></td>
                <td><b>{roomSeats(r)}</b></td>
                <td><select class="input" aria-label={`${r.name} 用途`} value={r.use} onChange={(e) => set(r.id, (x) => ({ ...x, use: e.currentTarget.value as MakeupRoomUse }))}>
                  {(Object.keys(USE_TEXT) as MakeupRoomUse[]).map((k) => <option key={k} value={k}>{USE_TEXT[k]}</option>)}</select></td>
                <td><Button small kind="danger" onClick={() => p.onChange(roomsPatch(s, rooms.filter((x) => x.id !== r.id)))}>刪除</Button></td>
              </tr>
            ))}</tbody></table></div>
          <div class="row">
            <Button onClick={() => p.onChange(roomsPatch(s, [...rooms, newRoom(s)]))}>＋ 新增教室</Button>
            <Button onClick={() => p.onChange(roomsPatch(s, [...rooms, newRoom(s, 'mixed')]))}>＋ 新增混班教室</Button>
            <Button onClick={() => p.onChange(roomsPatch(s, [...rooms, newRoom(s, 'special')]))}>＋ 新增特別教室</Button>
          </div>
        </div>
      )}

      {addable.length > 0 && (
        <div class="card stack"><div class="lab">從共用設定帶入班級教室</div>
          <p class="small muted">共用設定裡有 {addable.length} 間班級教室還沒加進這次補考（預備教室不帶）。</p>
          <div><Button onClick={() => p.onChange(roomsPatch(s, [...rooms, ...addable.map(roomFromShared)]))}>全部帶入（{addable.length} 間）</Button></div>
        </div>
      )}

      <Alert tone="info" noIcon><b>用途怎麼選：</b>一般班級教室——整班一起坐；混班教室——放不下整班時，收容零星的人（同節可有不同年級、不同科）；特別教室——提前開考的學生用。系統只在你標好的教室裡分配。</Alert>
    </section>
  );
}
