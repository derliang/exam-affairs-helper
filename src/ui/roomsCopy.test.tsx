import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import type { Classroom } from '../data';
import { RoomList } from './components/RoomList';
import { duplicateRoom } from './rooms';

const room = (o: Partial<Classroom> = {}): Classroom => ({ id: 'room-1', name: '試場3', kind: 'class', rows: 7, depth: 7, seatCount: 48, disabled: ['7-7'], track: 'science', division: 'senior', ...o });

describe('教室複製與 B4 上限提示（#205）', () => {
  it('複製：帶過排數、深位、不排座位、組別；名稱尾數遞增；id 不重複；插在原教室後', () => {
    const rooms = [room(), room({ id: 'room-2', name: '其他' })];
    const out = duplicateRoom(rooms, 'room-1');
    expect(out.map((r) => r.name)).toEqual(['試場3', '試場4', '其他']);
    const c = out[1]!;
    expect(c).toMatchObject({ rows: 7, depth: 7, seatCount: 48, track: 'science', division: 'senior', disabled: ['7-7'] });
    expect(new Set(out.map((r) => r.id)).size).toBe(3);
    expect(c.disabled).not.toBe(rooms[0]!.disabled);
  });
  it('複製：名稱沒有尾數加 2；尾數已被用就往後找；找不到 id 原樣回傳', () => {
    expect(duplicateRoom([room({ name: '甲' })], 'room-1').map((r) => r.name)).toEqual(['甲', '甲2']);
    expect(duplicateRoom([room({ name: '試場3' }), room({ id: 'room-9', name: '試場4' })], 'room-1').map((r) => r.name)).toEqual(['試場3', '試場5', '試場4']);
    const rooms = [room()];
    expect(duplicateRoom(rooms, 'nope')).toBe(rooms);
  });
  it('畫面（#210 方案 A）：不再有「改 A3」的上限提示，預備教室有「複製這間教室」（班級教室不複製，G22）', () => {
    const html = renderToString(<RoomList rooms={[room({ kind: 'reserve', rows: 6, depth: 8, track: undefined })]} paper="B4" onChange={() => {}} onGoSchool={() => {}} />);
    expect(html).not.toContain('請改為 A3');
    expect(html).toContain('複製這間教室');
  });
});
