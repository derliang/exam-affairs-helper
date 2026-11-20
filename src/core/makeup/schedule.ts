/**
 * 補考排程引擎（F-20～F-24、R-1～R-12）：節次建議、教室分配、座位、提前開考與離場時間。
 * 純函式；同樣輸入一定得到同樣結果。
 *
 * 節次模型：每個考程群組（同考日、同一套時間的年級）有 N 個時段，前 N-1 個是獨立節，
 * 最後一個是綜合節（kind='final'）：最後一個獨立科與所有併入綜合的科目同一時段、同一間教室（R-11），
 * 綜合節內學生各科自由作答（R-4 例外），到時段結束才離場。
 * 提前開考（kind='early'）：科目太多的多科生在特別教室、群組開始時間就開考，全部科目自由作答；
 * 最早可離場＝他所有科目在全校（同考日）最後一場結束時間（R-7、D117）。
 */
import { classroomSeats, seatLabel } from '../../data/helpers';
import type { Classroom } from '../../data/types';
import { GRADE_TEXT, divisionOf } from './importRows';
import { compareClass, compareStudent, subjectsByStudent, type MakeupEntry } from './stats';
import type {
  EarlyInfo,
  EarlyStartRule,
  GradeKey,
  GroupPlan,
  MakeupGroup,
  MakeupPlan,
  MakeupRoom,
  MakeupSchedule,
  MakeupSettings,
  Sitting,
  SlotInfo,
  Unplaced,
} from './types';

/** U-2 暫定（稿 v2.52）：各科加總超過 150 分建議提前開考；總作答上限 210 分 */
export const DEFAULT_EARLY_RULE: EarlyStartRule = { suggestOverMin: 150, capMin: 210 };
/** 科目人數達此值才建議成為獨立節（我方提案，使用者可調） */
export const DEFAULT_INDEPENDENT_MIN = 10;
/** F-3 預設：高中 50 分、初中 45 分、休息 10 分、8:00 開始 */
export const DEFAULT_PERIOD_MIN = { senior: 50, junior: 45 } as const;
export const DEFAULT_BREAK_MIN = 10;
export const DEFAULT_START = 8 * 60;

/** 分鐘 → 「HH:MM」 */
export const fmtTime = (min: number): string => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** 預設群組：同一考日，高中一組、初中一組（只建有出現的部別） */
export function defaultMakeupGroups(grades: readonly GradeKey[], dayId: string): MakeupGroup[] {
  const out: MakeupGroup[] = [];
  for (const division of ['senior', 'junior'] as const) {
    const gs = [...new Set(grades.filter((g) => divisionOf(g) === division))].sort();
    if (gs.length === 0) continue;
    out.push({
      id: `${dayId}-${division}`,
      dayId,
      label: division === 'senior' ? '高中' : '初中',
      grades: gs,
      start: DEFAULT_START,
      periodMin: DEFAULT_PERIOD_MIN[division],
      breakMin: DEFAULT_BREAK_MIN,
    });
  }
  return out;
}

export const groupOfGrade = (groups: readonly MakeupGroup[], g: GradeKey): MakeupGroup | undefined => groups.find((x) => x.grades.includes(g));

/** 某科在該群組的考試分鐘（U-2：可逐科設定，沒設＝該群組每節分鐘） */
export const subjectMinutes = (rule: EarlyStartRule, group: Pick<MakeupGroup, 'periodMin'>, subject: string): number =>
  rule.subjectMin?.[subject] ?? group.periodMin;

const collator = new Intl.Collator('zh-Hant', { numeric: true });

/**
 * F-20 系統建議：
 * ① 各科加總分鐘「超過」early.suggestOverMin 的多科生 → 提前開考；
 * ② 其餘學生中人數達 independentMin 的科目，依人數多到少各占一個獨立節；
 * ③ 其他科目併入綜合節（與最後一個獨立科同時段）。
 */
export function suggestPlan(entries: readonly MakeupEntry[], settings: MakeupSettings): MakeupPlan {
  const min = settings.independentMin ?? DEFAULT_INDEPENDENT_MIN;
  const groups: GroupPlan[] = [];
  for (const g of settings.groups) {
    const es = entries.filter((e) => g.grades.includes(e.grade));
    const byStu = subjectsByStudent(es);
    const early: string[] = [];
    for (const [id, list] of byStu) {
      if (list.length < 2) continue;
      const total = list.reduce((n, e) => n + subjectMinutes(settings.early, g, e.subject), 0);
      if (total > settings.early.suggestOverMin) early.push(id);
    }
    early.sort((a, b) => collator.compare(a, b));
    const earlySet = new Set(early);
    const count = new Map<string, number>();
    for (const e of es) if (!earlySet.has(e.studentId)) count.set(e.subject, (count.get(e.subject) ?? 0) + 1);
    const ranked = [...count.entries()].sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0]));
    const independent = ranked.filter(([, n]) => n >= min).map(([s]) => s);
    const combined = ranked.filter(([, n]) => n < min).map(([s]) => s);
    // 只出現在提前開考學生身上的科目，也列進綜合（使用者把人移出提前開考時才有地方去）
    for (const e of es) if (!count.has(e.subject) && !combined.includes(e.subject) && !independent.includes(e.subject)) combined.push(e.subject);
    groups.push({ groupId: g.id, slots: independent.map((s) => [s]), combined, early });
  }
  return { groups, pins: [] };
}

/** 群組的一般時段（不含提前開考）：時間只由節數決定 */
function groupSlots(g: MakeupGroup, gp: GroupPlan | undefined, hasNormal: boolean): SlotInfo[] {
  if (!hasNormal) return [];
  const indep = gp?.slots.filter((s) => s.length > 0) ?? [];
  const n = Math.max(indep.length, 1);
  const out: SlotInfo[] = [];
  for (let i = 0; i < n; i++) {
    const start = g.start + i * (g.periodMin + g.breakMin);
    out.push({
      id: `${g.id}#${i}`,
      groupId: g.id,
      dayId: g.dayId,
      index: i,
      kind: i === n - 1 ? 'final' : 'independent',
      start,
      end: start + g.periodMin,
      subjects: [],
    });
  }
  return out;
}

/** 科目 → 時段索引；計畫沒列到的科目放最後一節（綜合），不讓任何人次掉出排程 */
function subjectSlotIndex(gp: GroupPlan | undefined, slotCount: number): (subject: string) => number {
  const map = new Map<string, number>();
  const indep = gp?.slots.filter((s) => s.length > 0) ?? [];
  indep.forEach((subs, i) => subs.forEach((s) => map.has(s) || map.set(s, i)));
  return (s) => map.get(s) ?? slotCount - 1;
}

interface Unit {
  oldClass: string;
  students: { e: MakeupEntry; subjects: MakeupEntry[] }[];
}

interface RoomUse {
  roomId: string;
  dayId: string;
  start: number;
  end: number;
  slotId: string;
}

const asClassroom = (r: MakeupRoom): Classroom => ({
  id: r.id,
  name: r.name,
  kind: 'class',
  rows: r.rows,
  depth: r.depth,
  seatCount: r.seatCount,
  ...(r.disabled ? { disabled: r.disabled } : {}),
  ...(r.rowDepths ? { rowDepths: r.rowDepths } : {}),
});

/** 教室可用的座位數（依座位排列實際排得出的座位，不超過 seatCount） */
export const roomSeats = (r: MakeupRoom): number => classroomSeats(asClassroom(r)).length;

// D180（U-4）：混班教室由系統自動挑，不再要求使用者標記。舊存檔的 'mixed' 與 'class' 一樣當一般教室；只有「特別」教室另外排在最後。
const USE_ORDER: Record<MakeupRoom['use'], number> = { class: 0, mixed: 0, special: 1 };

/** 某時段實際當作混班使用的教室：同一時段收了兩個（含）以上原班的一般教室（系統自動判斷；特別教室不算）。 */
export function mixedRoomsOf(schedule: Pick<MakeupSchedule, 'sittings'>, rooms: readonly MakeupRoom[]): { slotId: string; roomId: string; classes: string[] }[] {
  const special = new Set(rooms.filter((r) => r.use === 'special').map((r) => r.id));
  const by = new Map<string, Set<string>>();
  for (const s of schedule.sittings) {
    if (special.has(s.roomId)) continue;
    const k = `${s.slotId}|${s.roomId}`;
    const set = by.get(k);
    if (set) set.add(s.oldClass);
    else by.set(k, new Set([s.oldClass]));
  }
  return [...by].filter(([, set]) => set.size >= 2).map(([k, set]) => { const [slotId, roomId] = k.split('|') as [string, string]; return { slotId, roomId, classes: [...set].sort(collator.compare) }; });
}

/**
 * 依計畫產生排程。
 * 教室分配（R-9、R-10、D116）：一個時段內，同班的學生是一個單位，依班級順序放進第一間放得下的一般教室；
 * 一般教室放不下就整班搬到還有空位的別間（系統自動挑混班教室，D180），再不行才用特別教室；整班大到任何一間都放不下時才拆班（記在 splits，C-13 會提示）；
 * 教室全滿就列為 unplaced（C-2／C-3 會紅燈）。同一間教室在重疊時間只給一個時段使用。
 * 提前開考學生優先放特別教室（其次混班、一般）。
 */
export function buildSchedule(entries: readonly MakeupEntry[], settings: MakeupSettings, plan: MakeupPlan): MakeupSchedule {
  const gradeOf: Record<string, GradeKey> = {};
  for (const e of entries) gradeOf[e.oldClass] = e.grade;
  const byClass = compareClass(gradeOf);
  const byStudent = compareStudent(gradeOf);
  const planOf = new Map(plan.groups.map((p) => [p.groupId, p]));
  const unplaced: Unplaced[] = [];
  const slots: SlotInfo[] = [];

  // ① 每群組的人次分流：提前開考 / 一般時段
  interface GroupWork {
    g: MakeupGroup;
    normal: SlotInfo[];
    slotOf: (s: string) => number;
    early: Map<string, MakeupEntry[]>;
    normalEntries: MakeupEntry[];
  }
  const works: GroupWork[] = [];
  const assigned = new Set<string>();
  for (const g of settings.groups) {
    const gp = planOf.get(g.id);
    const es = entries.filter((e) => g.grades.includes(e.grade) && !assigned.has(e.grade));
    const earlyIds = new Set(gp?.early ?? []);
    const early = new Map<string, MakeupEntry[]>();
    const normalEntries: MakeupEntry[] = [];
    for (const e of es) {
      if (earlyIds.has(e.studentId)) {
        const a = early.get(e.studentId);
        if (a) a.push(e);
        else early.set(e.studentId, [e]);
      } else normalEntries.push(e);
    }
    const normal = groupSlots(g, gp, normalEntries.length > 0);
    const slotOf = subjectSlotIndex(gp, normal.length);
    for (const e of normalEntries) {
      const s = normal[slotOf(e.subject)] as SlotInfo;
      if (!s.subjects.includes(e.subject)) s.subjects.push(e.subject);
    }
    for (const s of normal) s.subjects.sort((a, b) => collator.compare(a, b));
    slots.push(...normal);
    works.push({ g, normal, slotOf, early, normalEntries });
    g.grades.forEach((x) => assigned.add(x));
  }
  for (const e of entries) {
    if (!settings.groups.some((g) => g.grades.includes(e.grade))) {
      unplaced.push({ studentId: e.studentId, subject: e.subject, groupId: null, reason: `${GRADE_TEXT[e.grade]}沒有指定考日與時間` });
    }
  }

  // ② 每科在同考日最後一場的結束時間（離場時間用）
  const lastEnd = new Map<string, number>();
  for (const s of slots) for (const sub of s.subjects) {
    const k = `${s.dayId}|${sub}`;
    lastEnd.set(k, Math.max(lastEnd.get(k) ?? 0, s.end));
  }

  // ③ 提前開考時段與離場時間
  const earlyInfos: EarlyInfo[] = [];
  const earlySlots = new Map<string, SlotInfo>();
  for (const w of works) {
    if (w.early.size === 0) continue;
    let end = w.g.start;
    const subs = new Set<string>();
    for (const [id, list] of w.early) {
      const totalMin = list.reduce((n, e) => n + subjectMinutes(settings.early, w.g, e.subject), 0);
      const ends = list.map((e) => lastEnd.get(`${w.g.dayId}|${e.subject}`)).filter((x): x is number => x !== undefined);
      const leaveAt = ends.length ? Math.max(...ends) : w.g.start + totalMin;
      earlyInfos.push({ studentId: id, groupId: w.g.id, subjects: list.map((e) => e.subject).sort((a, b) => collator.compare(a, b)), totalMin, leaveAt });
      end = Math.max(end, leaveAt, w.g.start + totalMin);
      list.forEach((e) => subs.add(e.subject));
    }
    const s: SlotInfo = { id: `${w.g.id}#early`, groupId: w.g.id, dayId: w.g.dayId, index: -1, kind: 'early', start: w.g.start, end, subjects: [...subs].sort((a, b) => collator.compare(a, b)) };
    earlySlots.set(w.g.id, s);
    slots.push(s);
  }
  const leaveOf = new Map(earlyInfos.map((x) => [x.studentId, x.leaveAt]));

  // ④ 教室分配：每考日依「提前開考 → 各群組各時段（時間先後）」處理
  const uses: RoomUse[] = [];
  const sittings: Sitting[] = [];
  const splits: MakeupSchedule['splits'] = [];
  const roomById = new Map(settings.rooms.map((r) => [r.id, r]));
  const pins = plan.pins ?? [];

  const free = (room: MakeupRoom, s: SlotInfo): boolean =>
    !uses.some((u) => u.roomId === room.id && u.dayId === s.dayId && u.slotId !== s.id && u.start < s.end && s.start < u.end);

  const place = (s: SlotInfo, g: MakeupGroup, units: Unit[], preferSpecial: boolean): void => {
    const allowed = (g.roomIds ?? settings.rooms.map((r) => r.id)).map((id) => roomById.get(id)).filter((r): r is MakeupRoom => !!r);
    const order = (r: MakeupRoom): number => (preferSpecial ? (r.use === 'special' ? 0 : 1) : USE_ORDER[r.use]);
    const rooms = allowed
      .map((r, i) => ({ r, i }))
      .sort((a, b) => order(a.r) - order(b.r) || a.i - b.i)
      .map((x) => x.r)
      .filter((r) => free(r, s));
    const left = new Map(rooms.map((r) => [r.id, roomSeats(r)]));
    const inRoom = new Map<string, Unit['students']>();
    const put = (roomId: string, studs: Unit['students']): void => {
      const a = inRoom.get(roomId);
      if (a) a.push(...studs);
      else inRoom.set(roomId, [...studs]);
      left.set(roomId, (left.get(roomId) ?? 0) - studs.length);
    };
    const rest: Unit[] = [];
    for (const u of units) {
      const pin = pins.find((p) => p.groupId === g.id && p.slot === s.index && p.oldClass === u.oldClass && roomById.has(p.roomId));
      if (pin) {
        if (!left.has(pin.roomId)) left.set(pin.roomId, roomSeats(roomById.get(pin.roomId) as MakeupRoom));
        put(pin.roomId, u.students);
      } else rest.push(u);
    }
    for (const u of rest) {
      const n = u.students.length;
      const tiers = preferSpecial ? [rooms] : [rooms.filter((r) => r.use !== 'special'), rooms.filter((r) => r.use === 'special')];
      let target: MakeupRoom | undefined;
      for (const tier of tiers) {
        target = tier.find((r) => (left.get(r.id) ?? 0) >= n);
        if (target) break;
      }
      if (target) {
        put(target.id, u.students);
        continue;
      }
      // 整班超過任何一間剩餘座位：最後手段才拆班（依教室順序填）
      let i = 0;
      const used: string[] = [];
      for (const r of rooms) {
        const k = Math.min(left.get(r.id) ?? 0, n - i);
        if (k <= 0) continue;
        put(r.id, u.students.slice(i, i + k));
        used.push(r.id);
        i += k;
        if (i >= n) break;
      }
      if (used.length > 1) splits.push({ slotId: s.id, oldClass: u.oldClass, rooms: used });
      for (const st of u.students.slice(i)) {
        for (const e of st.subjects) unplaced.push({ studentId: e.studentId, subject: e.subject, groupId: g.id, reason: '教室座位不足，排不進任何考場' });
      }
    }
    for (const [roomId, studs] of inRoom) {
      const room = roomById.get(roomId) as MakeupRoom;
      uses.push({ roomId, dayId: s.dayId, start: s.start, end: s.end, slotId: s.id });
      const seats = classroomSeats(asClassroom(room));
      [...studs]
        .sort((a, b) => byStudent(a.e, b.e))
        .forEach((st, k) => {
          const pos = seats[k];
          const subjects = st.subjects.map((x) => x.subject);
          const leaveAt = s.kind === 'early' ? leaveOf.get(st.e.studentId) : undefined;
          sittings.push({
            studentId: st.e.studentId,
            oldClass: st.e.oldClass,
            oldSeat: st.e.oldSeat,
            grade: st.e.grade,
            slotId: s.id,
            roomId,
            subjects,
            papers: st.subjects.map((x) => x.paper),
            seat: pos ? seatLabel(pos) : null,
            ...(leaveAt !== undefined ? { leaveAt } : {}),
          });
        });
    }
  };

  const unitsOf = (es: readonly MakeupEntry[]): Unit[] => {
    const byStu = subjectsByStudent(es);
    const byCls = new Map<string, Unit>();
    for (const list of byStu.values()) {
      const e = list[0] as MakeupEntry;
      const u = byCls.get(e.oldClass) ?? { oldClass: e.oldClass, students: [] };
      u.students.push({ e, subjects: list });
      byCls.set(e.oldClass, u);
    }
    return [...byCls.values()].sort((a, b) => byClass(a.oldClass, b.oldClass));
  };

  const days = [...new Set(settings.groups.map((g) => g.dayId))];
  for (const day of days) {
    const ws = works.filter((w) => w.g.dayId === day);
    for (const w of ws) {
      const s = earlySlots.get(w.g.id);
      if (s) place(s, w.g, unitsOf([...w.early.values()].flat()), true);
    }
    const queue = ws.flatMap((w) => w.normal.map((s) => ({ w, s }))).sort((a, b) => a.s.start - b.s.start || a.s.id.localeCompare(b.s.id));
    for (const { w, s } of queue) {
      const es = w.normalEntries.filter((e) => w.slotOf(e.subject) === s.index);
      place(s, w.g, unitsOf(es), false);
    }
  }

  return { slots, sittings, early: earlyInfos.sort((a, b) => collator.compare(a.studentId, b.studentId)), unplaced, splits };
}

export interface PeakLoad {
  dayId: string;
  /** 最擁擠時刻（分鐘）與同時在考人數 */
  at: number;
  peak: number;
  /** 本考日可用座位總數（同一座位每時段重複使用，F-15 修訂） */
  seats: number;
  ok: boolean;
}

/** F-15：各考日最擁擠時段的同時在考人數，與可用座位比較 */
export function peakLoad(schedule: Pick<MakeupSchedule, 'slots' | 'sittings'>, settings: Pick<MakeupSettings, 'rooms' | 'groups' | 'days'>): PeakLoad[] {
  const slotById = new Map(schedule.slots.map((s) => [s.id, s]));
  const out: PeakLoad[] = [];
  const dayIds = [...new Set([...settings.days.map((d) => d.id), ...schedule.slots.map((s) => s.dayId)])];
  for (const dayId of dayIds) {
    const ss = schedule.slots.filter((s) => s.dayId === dayId);
    const roomIds = new Set(settings.groups.filter((g) => g.dayId === dayId).flatMap((g) => g.roomIds ?? settings.rooms.map((r) => r.id)));
    const seats = settings.rooms.filter((r) => roomIds.has(r.id)).reduce((n, r) => n + roomSeats(r), 0);
    let peak = 0;
    let at = ss[0]?.start ?? 0;
    for (const t of [...new Set(ss.map((s) => s.start))].sort((a, b) => a - b)) {
      const n = schedule.sittings.filter((x) => {
        const s = slotById.get(x.slotId);
        return s && s.dayId === dayId && s.start <= t && t < s.end;
      }).length;
      if (n > peak) {
        peak = n;
        at = t;
      }
    }
    out.push({ dayId, at, peak, seats, ok: peak <= seats });
  }
  return out;
}
