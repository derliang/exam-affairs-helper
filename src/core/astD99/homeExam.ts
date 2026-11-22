/**
 * 分科第三種排法「原班應考、不考者留原班標 X」（D219，#636）。純函式、可重現。
 *
 * 人工手排的作法：有人要考試的班，整班留在原班教室——應考者坐考試座位，不考的人留在原班、只在座位標 X；沒有人離開原班。
 * 本模式照這個作法排，並明確取代 D135⑥「同一間教室不可同時有人考試與自習」的限制（只限本模式、只限原班教室裡的本班同學，見 D219）。
 *
 * 每個時段、每個班：
 *  ①「留原班」條件：班上有人應考、有原班教室、原班座位數 ≥ 全班人數、教室文理組與應考者組別不衝突。
 *    符合：應考者在原班教室照 D73 排考試座位；全班其餘的人（不考者）在同一間教室的剩餘座位，座位標 X
 *    （輸出成 study ＋ studySeats，不印標籤；教室用途為 exam）。
 *  ② 不符合的班：應考者（離開原班）到綜合教室考試（照一般規則排座），不考者照一般規則自習（原班沒人考試就留原班）。
 *  ③ 班上沒有人應考的班：全班留原班自習（與其他模式相同）。
 * 綜合教室座位不夠放 ② 的應考者時回報無解；自習放不下的人列為 unplaced（沿用既有處理，不硬排）。
 * 此模式不使用「固定自習教室」與「自習盡量同一地點」（沒有抽離自習可固定；②③ 的自習每時段各自排）。
 */
import { balanceRows } from '../../data/helpers';
import { codeOf, computeMetrics, type ExamPlacement, type PlanInput, type PlanOutput, type StudyPlacement, type StudySeat } from './contract';
import { layoutRoom, toRoom, type Room, type Stu } from './engine';

export function planHomeExam(input: PlanInput): PlanOutput {
  const sorted = [...input.students].sort((a, b) => a.classNo - b.classNo || a.seatNo - b.seatNo);
  const stus: Stu[] = sorted.map((s, idx) => ({ idx, code: codeOf(s), classNo: s.classNo, seatNo: s.seatNo, track: s.track }));
  const ranked = input.rooms
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const ka = a.r.kind === 'class' ? 0 : 1;
      const kb = b.r.kind === 'class' ? 0 : 1;
      return ka - kb || (a.r.kind === 'class' ? (a.r.classNo ?? 1e9) - (b.r.classNo ?? 1e9) : 0) || a.i - b.i;
    });
  const rooms: Room[] = ranked.map(({ r }, idx) => toRoom(r, idx));
  const home = new Map<number, Room>();
  for (const r of rooms) if (r.kind === 'class' && r.classNo !== undefined && !home.has(r.classNo)) home.set(r.classNo, r);
  const classSize = new Map<number, number>();
  for (const st of stus) classSize.set(st.classNo, (classSize.get(st.classNo) ?? 0) + 1);
  const approvedBy = (slotId: string): Set<string> => new Set((input.approvals ?? []).filter((a) => a.slotId === slotId).map((a) => a.roomId));
  const shape = (room: Room, n: number): Pick<Room, 'rows'> => (room.kind !== 'reserve' || input.reserveLayout === 'min-rows' ? room : { rows: balanceRows(room.rows, n) });

  const usage: Record<string, Record<string, 'exam' | 'study'>> = {};
  const exams: ExamPlacement[] = [];
  const study: StudyPlacement[] = [];
  const studySeats: StudySeat[] = [];
  const studyUnseated: { slotId: string; roomId: string; code: string }[] = [];
  const mixedRows: { slotId: string; roomId: string; row: number }[] = [];
  const unplaced: { slotId: string; code: string }[] = [];
  const infeasible = { usage: {}, exams: [], study: [], mixedRows: [], proposals: [], infeasible: true as const };

  for (const slot of input.slots) {
    const order = new Map(slot.subjectIds.map((id, i) => [id, i]));
    const u: Record<string, 'exam' | 'study'> = {};
    usage[slot.id] = u;
    const takes = (st: Stu): string | undefined => sorted[st.idx]!.takes[slot.id];
    const examinees = new Map<number, Stu[]>();
    for (const st of stus) if (takes(st)) examinees.set(st.classNo, [...(examinees.get(st.classNo) ?? []), st]);
    const orderedSubjects = (list: Stu[]): { subject: string; students: Stu[] }[] => {
      const m = new Map<string, Stu[]>();
      for (const st of list) m.set(takes(st)!, [...(m.get(takes(st)!) ?? []), st]);
      return [...m.entries()].sort((a, b) => (order.get(a[0]) ?? 99) - (order.get(b[0]) ?? 99) || (a[0] < b[0] ? -1 : 1)).map(([subject, students]) => ({ subject, students }));
    };
    const putExam = (room: Room, placed: { st: Stu; subject: string; row: number; depth: number }[], lay: number[]): void => {
      for (const x of placed) exams.push({ slotId: slot.id, code: x.st.code, subjectId: x.subject, roomId: room.id, row: x.row, depth: x.depth });
      for (const row of lay) mixedRows.push({ slotId: slot.id, roomId: room.id, row });
      u[room.id] = 'exam';
    };

    // ① 留原班的班：應考者考試座位＋不考者 X 座位
    const hosted = new Set<number>();
    const xSet = new Set<string>();
    for (const [c, list] of examinees) {
      const h = home.get(c);
      if (!h || h.seats.length < (classSize.get(c) ?? 0)) continue;
      if (h.track && list.some((st) => st.track && st.track !== h.track)) continue;
      hosted.add(c);
      const lay = layoutRoom(h, orderedSubjects(list));
      putExam(h, lay.placed, lay.mixedRows);
      const taken = new Set(lay.placed.map((x) => `${x.row}-${x.depth}`));
      const free = h.seats.filter((s) => !taken.has(`${s.row}-${s.depth}`));
      const stay = stus.filter((st) => st.classNo === c && !takes(st));
      stay.forEach((st, i) => {
        study.push({ slotId: slot.id, code: st.code, roomId: h.id });
        xSet.add(st.code);
        const seat = free[i];
        if (seat) studySeats.push({ slotId: slot.id, roomId: h.id, code: st.code, row: seat.row, depth: seat.depth });
        else studyUnseated.push({ slotId: slot.id, roomId: h.id, code: st.code });
      });
    }

    // ② 不能留原班的班的應考者：到綜合教室考試
    const away = stus.filter((st) => takes(st) && !hosted.has(st.classNo));
    const reserves = rooms.filter((r) => r.kind === 'reserve' && r.seats.length > 0).sort((a, b) => b.seats.length - a.seats.length || a.rank - b.rank);
    const examReserve: Room[] = [];
    if (away.length) {
      let cap = 0;
      for (const r of reserves) {
        if (cap >= away.length) break;
        examReserve.push(r);
        cap += r.seats.length;
      }
      if (cap < away.length) return infeasible;
      // 依科目大小排、逐間排滿；每間用 layoutRoom 排座位
      const subs = orderedSubjects(away).sort((a, b) => b.students.length - a.students.length || (order.get(a.subject) ?? 99) - (order.get(b.subject) ?? 99));
      const per = new Map<number, { subject: string; students: Stu[] }[]>();
      let ri = 0;
      let left = examReserve[0]!.seats.length;
      for (const sb of subs) {
        let rest = sb.students;
        while (rest.length) {
          while (left === 0) { ri++; left = examReserve[ri]!.seats.length; }
          const take = rest.slice(0, left);
          per.set(ri, [...(per.get(ri) ?? []), { subject: sb.subject, students: take }]);
          left -= take.length;
          rest = rest.slice(take.length);
        }
      }
      for (const [i, groups] of per) {
        const room = examReserve[i]!;
        const n = groups.reduce((a, g) => a + g.students.length, 0);
        const lay = layoutRoom(shape(room, n), groups.sort((a, b) => (order.get(a.subject) ?? 99) - (order.get(b.subject) ?? 99)));
        putExam(room, lay.placed, lay.mixedRows);
      }
    }

    // ③ 其餘的人（班上沒人應考、或不能留原班的班的不考者）：原班沒有人考試就留原班，否則去沒當考場的綜合教室
    const examRoomSet = new Set(Object.keys(u));
    const load = new Map<string, number>();
    const pending: Stu[] = [];
    const place = (st: Stu, r: Room): void => {
      study.push({ slotId: slot.id, code: st.code, roomId: r.id });
      u[r.id] = 'study';
      load.set(r.id, (load.get(r.id) ?? 0) + 1);
    };
    for (const st of stus) {
      if (takes(st) || hosted.has(st.classNo)) continue;
      const h = home.get(st.classNo);
      if (h && !examRoomSet.has(h.id) && (load.get(h.id) ?? 0) < h.studyCap) place(st, h);
      else pending.push(st);
    }
    const appr = approvedBy(slot.id);
    const spares = [
      ...rooms.filter((r) => r.kind === 'reserve' && !examRoomSet.has(r.id)).sort((a, b) => b.studyCap - a.studyCap || a.rank - b.rank),
      ...rooms.filter((r) => r.kind === 'class' && !examRoomSet.has(r.id) && (input.allowOtherClassStudy || appr.has(r.id))),
    ];
    for (const st of pending) {
      const r = spares.find((x) => (load.get(x.id) ?? 0) < x.studyCap);
      if (r) place(st, r);
      else unplaced.push({ slotId: slot.id, code: st.code });
    }
    // 非 X 座位的自習參考座位（每間教室各自排；留原班的 X 座位已在 ① 排好）
    const byRoom = new Map<string, Stu[]>();
    for (const sp of study) if (sp.slotId === slot.id && !xSet.has(sp.code)) {
      const st = stus.find((x) => x.code === sp.code)!;
      byRoom.set(sp.roomId, [...(byRoom.get(sp.roomId) ?? []), st]);
    }
    for (const [rid, list] of byRoom) {
      const room = rooms.find((r) => r.id === rid)!;
      const fit = list.slice(0, Math.min(room.seats.length, room.studyCap));
      const lay = layoutRoom(shape(room, fit.length), [{ subject: 'study', students: fit }]);
      for (const x of lay.placed) studySeats.push({ slotId: slot.id, roomId: rid, code: x.st.code, row: x.row, depth: x.depth });
      for (const st of list.slice(fit.length)) studyUnseated.push({ slotId: slot.id, roomId: rid, code: st.code });
    }
  }
  const out: PlanOutput = {
    usage, exams, study, mixedRows, proposals: [],
    ...(unplaced.length ? { unplaced } : {}),
    ...(studySeats.length ? { studySeats } : {}),
    ...(studyUnseated.length ? { studyUnseated } : {}),
  };
  return { ...out, metrics: computeMetrics(input, out) };
}
