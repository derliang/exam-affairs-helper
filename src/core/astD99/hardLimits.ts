import { codeOf, type PlanInput, type PlanOutput } from './contract';

/**
 * ⑤ 硬性限制檢查（DESIGN 10.14）的三個計數，由方案輸出直接數。
 * D221（補充 D219）：「原班應考標 X」模式（home-exam）下，本班同學在本班原班教室的 X 座位（輸出為 study）
 * 不算「同教室考試又自習」（D219 取代 D135⑥，只限本模式）；他班或綜合教室的自習混入考場仍算違規。
 */
export function countHardLimits(input: PlanInput, out: PlanOutput): { seatOver: number; capOver: number; both: number } {
  const byCode = new Map(input.students.map((s) => [codeOf(s), s]));
  let seatOver = 0; let capOver = 0; let both = 0;
  for (const s of input.slots) {
    for (const r of input.rooms) {
      const ex = out.exams.filter((e) => e.slotId === s.id && e.roomId === r.id).length;
      const study = out.study.filter((e) => e.slotId === s.id && e.roomId === r.id);
      const st = study.length;
      // 只有原班教室裡的本班同學（X 座位）可與考生同室
      const mixing = input.mode === 'home-exam' && r.kind === 'class'
        ? study.filter((e) => byCode.get(e.code)?.classNo !== r.classNo).length
        : st;
      if (ex > r.seats.length) seatOver++;
      if (st > r.studyCapacity) capOver++;
      if (ex > 0 && mixing > 0) both++;
    }
  }
  return { seatOver, capOver, both };
}
