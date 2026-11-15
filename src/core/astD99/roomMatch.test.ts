import { describe, expect, it } from 'vitest';
import type { ClassInfo, Classroom } from '../../data/types';
import { homeIssues } from './homeCheck';
import { toPlanRooms } from './rooms';

const cls = (no: number, name: string): ClassInfo => ({ no, name, division: 'senior', track: no <= 3 ? 'science' : 'liberal' }) as ClassInfo;
const room = (id: string, name: string): Classroom => ({ id, name, kind: 'class', rows: 7, depth: 7, seatCount: 49 }) as Classroom;
const classes = [cls(1, '溫'), cls(2, '良'), cls(3, '恭')];
const classNoOf = (rooms: Classroom[], cs = classes) => toPlanRooms(rooms, rooms.map((r) => r.id), cs).map((r) => r.classNo);

describe('#234 班級教室對應班級', () => {
  it('名稱完全相同照舊對上', () => {
    expect(classNoOf([room('a', '溫'), room('b', '良')])).toEqual([1, 2]);
  });
  it('「高三溫」對上班級「溫」（年級前綴不影響）', () => {
    expect(classNoOf([room('a', '高三溫'), room('b', '高三良'), room('c', '高三恭')])).toEqual([1, 2, 3]);
  });
  it('年級前綴不同寫法也對上：高二、三年級、國三', () => {
    expect(classNoOf([room('a', '高二溫'), room('b', '三年級良'), room('c', '國三恭')])).toEqual([1, 2, 3]);
  });
  it('不誤對：名稱不含班級、或會對到多個班級時不猜', () => {
    expect(classNoOf([room('a', '高三甲')])).toEqual([undefined]);
    const dup = [cls(1, '1'), cls(2, '11')];
    expect(classNoOf([room('a', '高三111')], dup)).toEqual([undefined]);
    // 兩間教室搶同一班：只有一間對上，另一間不重複認領
    expect(classNoOf([room('a', '高三溫'), room('b', '溫')])).toEqual([undefined, 1]);
  });
  it('精確名稱優先於前綴比對', () => {
    expect(classNoOf([room('a', '高三溫'), room('b', '溫')])).toEqual([undefined, 1]);
  });
  it('對不上時診斷寫出具體差異（教室名稱與班級名稱）', () => {
    const rooms = toPlanRooms([room('a', '高三甲')], ['a'], classes);
    const issues = homeIssues({ rooms, students: [{ classNo: 1, seatNo: 1, name: 'x', takes: {} }] }, { classNames: new Map(classes.map((c) => [c.no, c.name])) });
    expect(issues[0]!.detail).toContain('教室「高三甲」與班級「溫」名稱不同');
  });
});
