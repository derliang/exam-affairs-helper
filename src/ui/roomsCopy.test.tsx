import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import type { Classroom } from '../data';
import { RoomList } from './components/RoomList';
import { atB4Ceiling, duplicateRoom } from './rooms';

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
  it('B4 到上限才提示；A3 不提示；沒到上限不提示', () => {
    expect(atB4Ceiling([room({ rows: 6, depth: 8 })], 'B4')).toBe(true);
    expect(atB4Ceiling([room({ rows: 6, depth: 5 })], 'B4')).toBe(true);
    expect(atB4Ceiling([room({ rows: 5, depth: 6 })], 'B4')).toBe(false);
    expect(atB4Ceiling([room({ rows: 7, depth: 7 })], 'A3')).toBe(false);
  });
  it('畫面：到 B4 上限顯示說明與連結按鈕，每間教室有「複製這間教室」', () => {
    const html = renderToString(<RoomList rooms={[room({ rows: 6, depth: 8 })]} paper="B4" onChange={() => {}} onGoSchool={() => {}} />);
    expect(html).toContain('目前標籤紙張是 B4，上限 48');
    expect(html).toContain('請改為 A3');
    expect(html).toContain('學校與表頭');
    expect(html).toContain('複製這間教室');
    const none = renderToString(<RoomList rooms={[room({ rows: 5, depth: 6 })]} paper="B4" onChange={() => {}} />);
    expect(none).not.toContain('請改為 A3');
  });
});
