/** #635 流程簡化：② 新增預備教室後預設列入、③ 補考帶入共用教室、⑧ 次別可填數字（⑥ 字樣在 ast/schedule.test.tsx、⑦ 警示在 reconcile.test.ts）。全部假資料。 */
import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import type { Classroom } from '../data';
import { demoDoc } from './repository';
import { NewExam } from './pages/NewExam';
import { MkStep3, sharedToImport, fromClassrooms } from './makeup/pages/MkStep3';
import { fakeSession, rooms } from './makeup/testKit';
import { addedReserveIds, markRoomsBefore, takeRoomsBefore } from './pendingNewRooms';

const room = (id: string, kind: 'class' | 'reserve' = 'reserve', division: 'senior' | 'junior' = 'senior'): Classroom => ({ id, name: id, kind, rows: 5, depth: 6, seatCount: 30, division });

describe('#635 ② 新增預備教室後預設列入', () => {
  it('離開前記下清單，回來只把新出現的預備教室列入（班級教室與舊教室不算）', () => {
    markRoomsBefore('e1', ['a', 'b']);
    const before = takeRoomsBefore('e1')!;
    expect(addedReserveIds(before, [room('a'), room('b'), room('n1'), room('n2', 'class')])).toEqual(['n1']);
    expect(takeRoomsBefore('e1')).toBeUndefined(); // 只用一次
  });
});

describe('#635 ③ 補考教室沿用共用設定', () => {
  it('只帶入還沒帶進來的高中部教室，已帶入的（id 相同）與國中部不重複', () => {
    const s = fakeSession({ rooms: rooms(2) });
    const have = s.rooms[0]!.id;
    const shared = [room(have), room('x1'), room('x2'), room('j1', 'reserve', 'junior')];
    expect(sharedToImport(shared, s.rooms).map((c) => c.id)).toEqual(['x1', 'x2']);
    expect(fromClassrooms(sharedToImport(shared, s.rooms), []).map((r) => r.use)).toEqual(['class', 'class']);
  });
  it('有可帶入的教室時顯示一顆「帶入 N 間教室」，沒有就不顯示', () => {
    const s = fakeSession({ rooms: rooms(1) });
    const html = renderToString(<MkStep3 s={s} onChange={() => undefined} shared={[room('x1'), room('x2')]} />);
    expect(html).toContain('帶入 2 間教室');
    expect(renderToString(<MkStep3 s={s} onChange={() => undefined} shared={[]} />)).not.toContain('帶入');
  });
});

describe('#635 ⑧ 新增模擬考次別可填數字', () => {
  it('次別有 − ／＋ 數字鈕（共用 Stepper），不限第一～第四次', () => {
    const html = renderToString(<NewExam doc={demoDoc()} onCancel={() => undefined} onCreate={() => undefined} />);
    expect(html).toContain('次別加一');
    expect(html).toContain('次別減一');
  });
});

describe('#635 ④ 缺姓名的列預設視為空位', () => {
  it('RowFix 可一開始就選好「確認無誤」（已決定、不必再按）', async () => {
    const { RowFix } = await import('./pages/RowFix');
    const html = renderToString(<RowFix where="第 5 列" kindText="缺少姓名" message="缺少姓名" cells={['1', '5', '']} draft={{ classNo: 1, seatNo: 5, name: '' }} confirmHint="保留為空位" initialMode="confirm" onDecide={() => undefined} />);
    expect(html).toContain('已決定：確認無誤');
    expect(html).toContain('data-rowfix="done"');
  });
});
