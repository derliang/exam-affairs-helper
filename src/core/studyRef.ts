/**
 * 抽離自習「參考座位」（G32，修訂 D7）：抽離自習的人原本只出名單、不給座位。
 * 現在在預備教室也幫他們排一份參考座位：用途是檢核座位夠不夠、監考老師要求按座位坐時可以照坐；
 * 不是考試座位，不出標籤。沿用考試的排座規則（同班座號遞增、每排輪替），並盡量沿用同一人的考試座位。
 * 只依 allocateDetaches 已分好的自習教室（Detach.roomId）排，不改變分配結果。
 */
import type { Classroom, Detach, StudentCode } from '../data/types';
import { classroomSeats, parseStudentCode, seatLabel } from '../data/helpers';
import { shapeLastRoom, type PeriodGroup, type ReserveLayout } from './detach';
import { seatGroup } from './seating';

export interface StudyRefRoom {
  /** 第幾組節次（對應 periodGroups 的順序） */
  group: number;
  roomId: string;
  subjectIds: string[];
  /** code → 座位；同一人同組節次若有多科自習只排一次 */
  seats: Map<StudentCode, { row: number; depth: number }>;
  /** 座位排不下的人（正常不會發生：分配時已用座位數切好） */
  unseated: StudentCode[];
}

const cmp = (a: string, b: string) => {
  const x = parseStudentCode(a); const y = parseStudentCode(b);
  return !x || !y ? (a < b ? -1 : a > b ? 1 : 0) : x.classNo - y.classNo || x.seatNo - y.seatNo;
};

/**
 * layout：預備教室座位排法（#258、#398）；沒給＝最少深位（人數平均分到各排，每排只坐前幾個深位），與抽離考試同一個設定。
 * 不需要每節同一個座位（WP-2）：每組節次各自排。
 */
export function studyReference(groups: readonly PeriodGroup[], detaches: readonly Detach[], reserveRooms: readonly Classroom[], layout?: ReserveLayout): StudyRefRoom[] {
  const roomById = new Map(reserveRooms.map((r) => [r.id, r]));
  const groupOf = new Map<string, number>();
  groups.forEach((g, gi) => g.subjectIds.forEach((id) => groupOf.set(id, gi)));
  // 同一人的考試座位（任一科任一節），沿用優先
  const examSeat = new Map<string, { roomId: string; row: number; depth: number }>();
  for (const d of detaches) if (d.purpose === 'exam' && d.seat && !examSeat.has(`${d.code}`)) examSeat.set(d.code, { roomId: d.roomId, row: d.seat.row, depth: d.seat.depth });
  const out: StudyRefRoom[] = [];
  groups.forEach((_, gi) => {
    const byRoom = new Map<string, { codes: Set<string>; subjects: Set<string> }>();
    for (const d of detaches) {
      if (d.purpose !== 'study' || groupOf.get(d.subjectId) !== gi) continue;
      const e = byRoom.get(d.roomId) ?? { codes: new Set<string>(), subjects: new Set<string>() };
      byRoom.set(d.roomId, e);
      e.codes.add(d.code);
      e.subjects.add(d.subjectId);
    }
    for (const [roomId, e] of byRoom) {
      const room = roomById.get(roomId);
      if (!room) continue;
      const codes = [...e.codes].sort(cmp);
      const seats = new Map<string, { row: number; depth: number }>();
      const usable = new Set(classroomSeats(room).map((s) => seatLabel(s)));
      // 1. 同一人在同一間預備教室有考試座位：沿用
      for (const c of codes) {
        const s = examSeat.get(c);
        if (!s || s.roomId !== roomId) continue;
        const k = seatLabel(s);
        if (usable.has(k)) { seats.set(c, { row: s.row, depth: s.depth }); usable.delete(k); }
      }
      // 2. 其餘的人沿用考試排座規則排進剩下的座位（把已用座位停用後交給排座引擎）
      const rest = codes.filter((c) => !seats.has(c));
      const unseated: StudentCode[] = [];
      if (rest.length) {
        const taken = new Set(classroomSeats(room).map((s) => seatLabel(s)).filter((k) => !usable.has(k)));
        const disabled = [...(room.disabled ?? [])];
        for (const s of classroomSeats(room)) if (taken.has(seatLabel(s))) disabled.push(`${s.row}-${s.depth}`);
        const shaped = shapeLastRoom([{ ...room, disabled, seatCount: usable.size }], Math.min(rest.length, usable.size), layout)[0]!;
        const r = seatGroup([shaped], rest.slice(0, usable.size));
        if (r.ok) for (const a of r.assignments) seats.set(a.code, { row: a.row, depth: a.depth });
        unseated.push(...rest.slice(usable.size));
      }
      out.push({ group: gi, roomId, subjectIds: [...e.subjects], seats, unseated });
    }
  });
  return out;
}
