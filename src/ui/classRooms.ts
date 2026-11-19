/**
 * G11：依學生名單的班級自動帶出「班級教室」當預設考場（純邏輯，不碰 DOM）。
 * - 班級教室＝名稱與班級名稱相同的教室（教室清單裡的圓圈也是這樣認班級，見 RoomList 的 RoomBadge）。
 * - 共用設定已有同名教室就沿用（座位配置不動）；沒有才新增，並寫進共用教室清單，學生名單與教室只存一份。
 * - 座位預設：最接近正方、單邊 ≤ 7、座位數不少於班級人數（38～42 人 → 6 排 × 7 深位）。
 */
import type { Classroom, ClassInfo, ExamConfig } from '../data';
import { roomDivision } from '../data';
import { updateExam, type Doc } from './store';

/** 單邊上限（G14 預告改為 7×7；這裡先用同一個值當預設，不影響使用者手動設定的上限） */
export const DEFAULT_SIDE_MAX = 7;

/** n 人的預設座位：座位數最少且不少於 n（單邊 ≤ 7），同樣大小選最接近正方，再選排數 ≤ 深位；超過 49 人就 7×7；沒有人數時用 6×7 */
export function defaultSeatGrid(n: number): { rows: number; depth: number } {
  if (!(n > 0)) return { rows: 6, depth: 7 };
  let best: { rows: number; depth: number } | undefined;
  for (let rows = 1; rows <= DEFAULT_SIDE_MAX; rows++) {
    for (let depth = rows; depth <= DEFAULT_SIDE_MAX; depth++) {
      if (rows * depth < n) continue;
      const area = rows * depth;
      if (!best || area < best.rows * best.depth || (area === best.rows * best.depth && depth - rows < best.depth - best.rows)) best = { rows, depth };
    }
  }
  return best ?? { rows: DEFAULT_SIDE_MAX, depth: DEFAULT_SIDE_MAX };
}

/** skipped＝班級教室標了「不排座」（D159）且這次考試沒勾選：不算缺教室，也不自動補進本次考試；③ 勾選了就以勾選為準（inExam） */
export interface ClassRoomRow { cls: ClassInfo; students: number; room?: Classroom; inExam: boolean; skipped: boolean }

/** 這次考試部別每個「有學生的班級」對應的班級教室（沒有就沒有 room） */
export function classRoomRows(doc: Doc, exam: ExamConfig): ClassRoomRow[] {
  const roster = doc.rosters[exam.division];
  const ctx = { classes: doc.settings.classes, exams: doc.exams };
  const rooms = doc.settings.classrooms.filter((r) => r.kind === 'class' && roomDivision(r, ctx) === exam.division);
  return doc.settings.classes
    .filter((c) => c.division === exam.division)
    .map((cls) => ({ cls, students: roster.filter((s) => s.classNo === cls.no).length }))
    .filter((r) => r.students > 0)
    .map((r) => {
      const room = rooms.find((x) => x.name === r.cls.name);
      const inExam = !!room && exam.classroomIds.includes(room.id);
      return { ...r, ...(room ? { room } : {}), inExam, skipped: !!room?.noSeat && !inExam };
    });
}

/** 名單有學生、但還沒有班級教室（或沒列入本次考試）的班級數 */
export const missingClassRooms = (doc: Doc, exam: ExamConfig): number => classRoomRows(doc, exam).filter((r) => !r.inExam && !r.skipped).length;

/**
 * 補齊班級教室：沒有就新增進共用教室清單、都列入本次考試。已列入的不動；本次考試已選的其他教室（預備、特殊教室）保留。
 * 沒有任何要補的就回傳原 doc（不產生多餘的修改）。
 */
export function syncClassRooms(doc: Doc, exam: ExamConfig): Doc {
  const rows = classRoomRows(doc, exam).filter((r) => !r.inExam && !r.skipped);
  if (!rows.length) return doc;
  let rooms = doc.settings.classrooms;
  const add: string[] = [];
  let n = rooms.length + 1;
  for (const r of rows) {
    if (r.room) { add.push(r.room.id); continue; }
    while (rooms.some((x) => x.id === `room-${n}`)) n++;
    const g = defaultSeatGrid(r.students);
    const room: Classroom = {
      id: `room-${n}`, name: r.cls.name, kind: 'class', rows: g.rows, depth: g.depth, seatCount: g.rows * g.depth, division: exam.division,
      ...(exam.division === 'senior' && r.cls.track ? { track: r.cls.track } : {}),
    };
    rooms = [...rooms, room];
    add.push(room.id);
  }
  const next: Doc = { ...doc, settings: { ...doc.settings, classrooms: rooms } };
  const u = updateExam(next, exam.id, { classroomIds: [...exam.classroomIds, ...add] });
  return u.ok ? u.doc : next;
}
