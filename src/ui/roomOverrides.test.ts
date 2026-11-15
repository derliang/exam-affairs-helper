// #210：本次考試專用座位覆寫（不改共用教室清單）
import { describe, expect, it } from 'vitest';
import { classroomSeats, effectiveRoom, effectiveRooms, settingsForExam, type Classroom } from '../data';
import { makeFixture } from '../export/fixtures';

const room: Classroom = { id: 'r1', name: '甲', kind: 'class', rows: 6, depth: 7, seatCount: 42, track: 'science' };

describe('effectiveRoom', () => {
  it('沒有覆寫：回傳原物件（舊存檔相容）', () => {
    expect(effectiveRoom({}, room)).toBe(room);
    expect(effectiveRooms({}, [room])[0]).toBe(room);
  });
  it('覆寫只換座位配置，名稱與組別沿用共用教室', () => {
    const e = effectiveRoom({ roomOverrides: { r1: { rows: 7, depth: 8, seatCount: 38, disabled: ['7-8', '7-7'] } } }, room);
    expect([e.rows, e.depth, e.seatCount, e.name, e.track]).toEqual([7, 8, 38, '甲', 'science']);
    expect(classroomSeats(e)).toHaveLength(38);
    expect(room.rows).toBe(6); // 共用清單不動
  });
  it('覆寫沒有 disabled／rowDepths 時，不殘留共用教室的舊值', () => {
    const base = { ...room, disabled: ['1-1'], rowDepths: [7, 7, 7, 7, 7, 7] };
    const e = effectiveRoom({ roomOverrides: { r1: { rows: 2, depth: 2, seatCount: 4 } } }, base);
    expect(e.disabled).toBeUndefined();
    expect(e.rowDepths).toBeUndefined();
  });
  it('settingsForExam 只換教室清單；其他教室不動', () => {
    const f = makeFixture();
    const id = f.settings.classrooms[0]!.id;
    const exam = { ...f.exam, roomOverrides: { [id]: { rows: 8, depth: 7, seatCount: 56 } } };
    const s = settingsForExam(f.settings, exam);
    expect(s.classrooms[0]!.rows).toBe(8);
    expect(s.classrooms.slice(1)).toEqual(f.settings.classrooms.slice(1));
    expect(settingsForExam(f.settings, f.exam)).toBe(f.settings);
  });
});
