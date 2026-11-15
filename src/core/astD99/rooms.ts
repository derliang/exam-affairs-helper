/**
 * 教室資料 → 分科新模型（D99）的規劃教室。只讀、不改存檔。
 * - 本次可用：沿用步驟③ 勾選的教室（ExamConfig.classroomIds；ast-spec-gap D-12，不另做開關）；綜合教室（kind＝reserve）可多間。
 * - 座位：classroomSeats（每排深位數可不同、跳過停用座位）。
 * - 自習容量：studyCapacityOf（沒設＝可用座位數；程式不自行調大）。
 * - 原班：班級教室與班級以名稱對應（現行資料就是這樣對的，見 helpers.roomDivision）；文理組取教室自己的 track，沒有就取班級的。
 */
import type { ClassInfo, Classroom } from '../../data/types';
import { classroomSeats, studyCapacityOf } from '../../data/helpers';
import type { PlanRoom } from './contract';

/** 去掉年級前綴（高一～高三、國一～國三、一～三年級），「高三溫」→「溫」；去完是空的就保留原名 */
export const stripGrade = (name: string): string => {
  const t = name.trim().replace(/^(?:[高國][一二三123]|[一二三123]年級?)\s*/, '');
  return t || name.trim();
};

/**
 * 班級教室 → 班級。①名稱完全相同；②沒對上的教室，去掉年級前綴後與班級名稱相同，且該班沒被別間教室認領、
 * 也沒有第二個班級同樣對得上時才採用（不猜：寧可對不上，由 ④ 的診斷告訴使用者）。
 */
export function matchHomeClasses(classrooms: readonly Classroom[], classes: readonly ClassInfo[]): Map<string, ClassInfo> {
  const out = new Map<string, ClassInfo>();
  const claimed = new Set<ClassInfo>();
  const fit = (c: Classroom, k: ClassInfo): boolean => !c.division || k.division === c.division;
  const rooms = classrooms.filter((c) => c.kind === 'class');
  for (const c of rooms) {
    const k = classes.find((x) => x.name === c.name && fit(c, x) && !claimed.has(x));
    if (k) { out.set(c.id, k); claimed.add(k); }
  }
  for (const c of rooms) {
    if (out.has(c.id)) continue;
    const key = stripGrade(c.name);
    const cand = classes.filter((x) => !claimed.has(x) && fit(c, x) && stripGrade(x.name) === key);
    if (cand.length === 1) { out.set(c.id, cand[0]!); claimed.add(cand[0]!); }
  }
  return out;
}

export function toPlanRooms(classrooms: readonly Classroom[], selectedIds: readonly string[], classes: readonly ClassInfo[]): PlanRoom[] {
  const picked = new Set(selectedIds);
  const match = matchHomeClasses(classrooms.filter((c) => picked.has(c.id)), classes);
  return classrooms
    .filter((c) => picked.has(c.id))
    .map((c) => {
      const cls = c.kind === 'class' ? match.get(c.id) : undefined;
      const track = c.kind === 'class' ? c.track ?? cls?.track : undefined;
      return {
        id: c.id,
        kind: c.kind,
        name: c.name,
        ...(cls ? { classNo: cls.no } : {}),
        seats: classroomSeats(c),
        studyCapacity: studyCapacityOf(c),
        ...(track ? { track } : {}),
      };
    });
}
