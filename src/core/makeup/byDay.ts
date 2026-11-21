/**
 * 多考日場次「依考日對帳」與「跨考日重複補考」警示（U-8、D184）。
 * 純函式：不改 C-1～C-15，只在全場次對帳之外，按考日再算一次「應有／實有」。
 * 同一學生同一科出現在兩個考日只當警示，不擋下載（D184②）。
 */
import type { MakeupEntry } from './stats';
import type { GradeKey, MakeupSchedule, MakeupSettings } from './types';

export interface DayReconcile {
  dayId: string;
  label: string;
  /** 應有：納入名單中，年級被編在該考日的人次 */
  expected: number;
  /** 實有：該考日各時段已入座的人次 */
  actual: number;
  diff: number;
  students: number;
  /** 該考日對不上的明細（空＝通過） */
  details: string[];
}

export interface CrossDayDup {
  studentId: string;
  subject: string;
  /** 出現在哪幾個考日（顯示用 label） */
  days: string[];
}

/** 年級 → 考日 id（沒被任何群組涵蓋的年級查不到） */
export function dayOfGrade(settings: Pick<MakeupSettings, 'groups'>): Map<GradeKey, string> {
  const m = new Map<GradeKey, string>();
  for (const g of settings.groups) for (const gr of g.grades) if (!m.has(gr)) m.set(gr, g.dayId);
  return m;
}

/** 每個考日各自對帳；只有一個考日時也照算（畫面只在多考日才顯示切換） */
export function reconcileByDay(entries: readonly MakeupEntry[], schedule: MakeupSchedule, settings: Pick<MakeupSettings, 'days' | 'groups'>): DayReconcile[] {
  const dayOf = dayOfGrade(settings);
  const slotDay = new Map(schedule.slots.map((s) => [s.id, s.dayId]));
  return settings.days.map((d) => {
    const mine = entries.filter((e) => dayOf.get(e.grade) === d.id);
    const sittings = schedule.sittings.filter((x) => slotDay.get(x.slotId) === d.id);
    const actual = sittings.reduce((n, x) => n + x.subjects.length, 0);
    const placedKeys = new Set(sittings.flatMap((x) => x.subjects.map((sub) => `${x.studentId}|${sub}`)));
    const details = mine.filter((e) => !placedKeys.has(`${e.studentId}|${e.subject}`)).map((e) => `${d.label}　${e.studentId}（${e.oldClass} ${e.oldSeat} 號）${e.subject}：沒有排進這一天的考場`);
    const mineKeys = new Set(mine.map((e) => `${e.studentId}|${e.subject}`));
    for (const x of sittings) for (const sub of x.subjects) if (!mineKeys.has(`${x.studentId}|${sub}`)) details.push(`${d.label}　${x.studentId} ${sub}：排進這一天，但不屬於這一天的年級`);
    return {
      dayId: d.id,
      label: d.label,
      expected: mine.length,
      actual,
      diff: actual - mine.length,
      students: new Set(mine.map((e) => e.studentId)).size,
      details,
    };
  });
}

/** 同一學號、同一科，被編到兩個（含）以上考日（例：名單上同學號的舊班不一致，年級落在不同考日） */
export function crossDayDuplicates(entries: readonly MakeupEntry[], settings: Pick<MakeupSettings, 'days' | 'groups'>): CrossDayDup[] {
  const dayOf = dayOfGrade(settings);
  const label = new Map(settings.days.map((d) => [d.id, d.label]));
  const seen = new Map<string, { studentId: string; subject: string; days: Set<string> }>();
  for (const e of entries) {
    const d = dayOf.get(e.grade);
    if (!d) continue;
    const k = `${e.studentId}|${e.subject}`;
    const v = seen.get(k) ?? { studentId: e.studentId, subject: e.subject, days: new Set<string>() };
    v.days.add(d);
    seen.set(k, v);
  }
  return [...seen.values()].filter((v) => v.days.size > 1).map((v) => ({ studentId: v.studentId, subject: v.subject, days: [...v.days].map((d) => label.get(d) ?? d) }));
}
