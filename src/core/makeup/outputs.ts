/**
 * 產出的「邏輯模型」（K4 依此排版成 Word／PDF）：點名單 O-4、班級公告 O-3、備卷清單 O-1、座位表 O-5、考程表注意事項 O-2。
 * 檢核（C-4、C-6～C-11）從這些模型重新點人，不拿排程引擎自己的計數驗自己。
 * K4 若自行產生最終模型，應傳入自己的模型給 runMakeupChecks，讓檢核點的是真正要輸出的內容。
 */
import { fmtTime } from './schedule';
import { compareStudent, type MakeupEntry } from './stats';
import type { GradeKey, MakeupSchedule, MakeupSettings, Sitting, SlotInfo } from './types';

export interface RollCallRow {
  studentId: string;
  oldClass: string;
  oldSeat: number;
  name: string;
  /** 本場要考的科目（多科生一人一欄列出全部科目，R-5） */
  subjects: string[];
  papers: string[];
  /** 卷數（多科生＝科數，C-10） */
  paperCount: number;
  /** 註：提前開考學生「HH:MM 前不得離場」（D124）；其他空字串 */
  note: string;
}

export interface RollCallSheet {
  slotId: string;
  dayId: string;
  roomId: string;
  roomName: string;
  kind: SlotInfo['kind'];
  start: number;
  end: number;
  rows: RollCallRow[];
  /** 表尾各科學生統計（卷鍵 → 人數） */
  paperTotals: Record<string, number>;
}

export interface AnnouncementRow {
  oldSeat: number;
  studentId: string;
  /** 導師存參版用；公告版不印（O-3） */
  name: string;
  subject: string;
  paper: string;
  dayId: string;
  slotId: string;
  start: number;
  end: number;
  roomId: string;
  roomName: string;
  note: string;
}

export interface Announcement {
  oldClass: string;
  rows: AnnouncementRow[];
}

export interface PaperPrepRow {
  paper: string;
  slotId: string;
  roomId: string;
  count: number;
}

export interface SeatTable {
  slotId: string;
  roomId: string;
  seats: { seat: string | null; studentId: string; oldClass: string; oldSeat: number }[];
}

export interface TimetableNote {
  studentId: string;
  text: string;
}

export interface MakeupOutputs {
  rollCalls: RollCallSheet[];
  announcements: Announcement[];
  papers: PaperPrepRow[];
  seatTables: SeatTable[];
  /** 考程表 O-2 注意事項中，提前開考學生的離場說明 */
  timetableNotes: TimetableNote[];
}

export const leaveNote = (leaveAt: number): string => `${fmtTime(leaveAt)} 前不得離場`;

/** 由排程產生全部產出模型 */
export function buildOutputs(schedule: MakeupSchedule, entries: readonly MakeupEntry[], settings: Pick<MakeupSettings, 'rooms'>): MakeupOutputs {
  const nameOf = new Map(entries.map((e) => [e.studentId, e.name]));
  const gradeOf: Record<string, GradeKey> = {};
  for (const e of entries) gradeOf[e.oldClass] = e.grade;
  const cmp = compareStudent(gradeOf);
  const slotById = new Map(schedule.slots.map((s) => [s.id, s]));
  const roomName = (id: string): string => settings.rooms.find((r) => r.id === id)?.name ?? id;

  const groups = new Map<string, Sitting[]>();
  for (const x of schedule.sittings) {
    const k = `${x.slotId}@@${x.roomId}`;
    const a = groups.get(k);
    if (a) a.push(x);
    else groups.set(k, [x]);
  }
  const rollCalls: RollCallSheet[] = [];
  const seatTables: SeatTable[] = [];
  for (const list of groups.values()) {
    const first = list[0] as Sitting;
    const s = slotById.get(first.slotId) as SlotInfo;
    const sorted = [...list].sort(cmp);
    const rows: RollCallRow[] = sorted.map((x) => ({
      studentId: x.studentId,
      oldClass: x.oldClass,
      oldSeat: x.oldSeat,
      name: nameOf.get(x.studentId) ?? '',
      subjects: [...x.subjects],
      papers: [...x.papers],
      paperCount: x.papers.length,
      note: x.leaveAt !== undefined ? leaveNote(x.leaveAt) : '',
    }));
    const paperTotals: Record<string, number> = {};
    for (const r of rows) for (const p of r.papers) paperTotals[p] = (paperTotals[p] ?? 0) + 1;
    rollCalls.push({ slotId: s.id, dayId: s.dayId, roomId: first.roomId, roomName: roomName(first.roomId), kind: s.kind, start: s.start, end: s.end, rows, paperTotals });
    seatTables.push({ slotId: s.id, roomId: first.roomId, seats: sorted.map((x) => ({ seat: x.seat, studentId: x.studentId, oldClass: x.oldClass, oldSeat: x.oldSeat })) });
  }
  const sheetOrder = (a: { slotId: string; roomId: string }, b: { slotId: string; roomId: string }): number => {
    const sa = slotById.get(a.slotId) as SlotInfo;
    const sb = slotById.get(b.slotId) as SlotInfo;
    return sa.dayId.localeCompare(sb.dayId) || sa.start - sb.start || sa.id.localeCompare(sb.id) || a.roomId.localeCompare(b.roomId);
  };
  rollCalls.sort(sheetOrder);
  seatTables.sort(sheetOrder);

  const byClass = new Map<string, AnnouncementRow[]>();
  for (const x of schedule.sittings) {
    const s = slotById.get(x.slotId) as SlotInfo;
    x.subjects.forEach((subject, i) => {
      const row: AnnouncementRow = {
        oldSeat: x.oldSeat,
        studentId: x.studentId,
        name: nameOf.get(x.studentId) ?? '',
        subject,
        paper: x.papers[i] as string,
        dayId: s.dayId,
        slotId: s.id,
        start: s.start,
        end: s.end,
        roomId: x.roomId,
        roomName: roomName(x.roomId),
        note: x.leaveAt !== undefined ? leaveNote(x.leaveAt) : '',
      };
      const a = byClass.get(x.oldClass);
      if (a) a.push(row);
      else byClass.set(x.oldClass, [row]);
    });
  }
  const announcements: Announcement[] = [...byClass.entries()]
    .map(([oldClass, rows]) => ({ oldClass, rows: rows.sort((a, b) => a.oldSeat - b.oldSeat || a.start - b.start || a.subject.localeCompare(b.subject)) }))
    .sort((a, b) => cmp({ oldClass: a.oldClass, oldSeat: 0, studentId: '' }, { oldClass: b.oldClass, oldSeat: 0, studentId: '' }));

  const paperMap = new Map<string, PaperPrepRow>();
  for (const x of schedule.sittings) {
    for (const p of x.papers) {
      const k = `${p}@@${x.slotId}@@${x.roomId}`;
      const r = paperMap.get(k) ?? { paper: p, slotId: x.slotId, roomId: x.roomId, count: 0 };
      r.count++;
      paperMap.set(k, r);
    }
  }
  const papers = [...paperMap.values()].sort((a, b) => a.paper.localeCompare(b.paper) || sheetOrder(a, b));

  const timetableNotes: TimetableNote[] = schedule.early.map((e) => ({ studentId: e.studentId, text: `學號 ${e.studentId} 提前開考，${leaveNote(e.leaveAt)}` }));

  return { rollCalls, announcements, papers, seatTables, timetableNotes };
}
