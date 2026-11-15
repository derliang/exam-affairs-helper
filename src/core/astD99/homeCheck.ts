/**
 * 原班教室對應檢查（Issue #199）：S-03「沒考試的學生盡量留在原班」要有「原班教室」才做得到。
 * 班級教室與班級以名稱對應（rooms.ts）；對不上、或原班教室的自習容量比班上參加人數小，
 * 該班學生就沒辦法（全部）留在原班，兩種模式也就沒有差別。這裡只診斷、不改排座。
 */
import type { PlanInput } from './contract';

export interface HomeIssue {
  classNo: number;
  /** 這班的參加人數 */
  students: number;
  /** none＝找不到對應的班級教室；small＝原班教室自習容量比參加人數小 */
  kind: 'none' | 'small';
  /** 原班教室自習容量（none 時為 0） */
  cap: number;
}

export function homeIssues(input: Pick<PlanInput, 'rooms' | 'students'>): HomeIssue[] {
  const home = new Map<number, number>();
  for (const r of input.rooms) if (r.kind === 'class' && r.classNo !== undefined && !home.has(r.classNo)) home.set(r.classNo, r.studyCapacity);
  const count = new Map<number, number>();
  for (const s of input.students) count.set(s.classNo, (count.get(s.classNo) ?? 0) + 1);
  const out: HomeIssue[] = [];
  for (const [classNo, students] of [...count].sort((a, b) => a[0] - b[0])) {
    const cap = home.get(classNo);
    if (cap === undefined) out.push({ classNo, students, kind: 'none', cap: 0 });
    else if (cap < students) out.push({ classNo, students, kind: 'small', cap });
  }
  return out;
}
