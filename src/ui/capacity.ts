/** 步驟③ 狀態檢核（原型「狀態檢核」卡）：高中部理組／文組各算一次、預備教室容量另算（D6、D69） */
import type { ExamConfig, Track } from '../data';
import { applyMarks } from '../core';
import { isListeningSubject } from '../core/marks';
import { studentCode } from '../data';
import { periodGroups } from '../core/detach';
import { dayName, examSubjectPeriods, slotName } from '../core/periods';
import { roomsOfDivision } from './rooms';
import { detachPreview, effectiveMarkRules, examClasses, examEntries, examOverrides, examRooms, seatableEntries } from './seating';
import type { Doc } from './store';

export interface CapacityLine { label: string; seats: number; students: number; ok: boolean; /** 通過時標籤之後的說明 */ detail: string; message: string }

export const TRACK_NAME: Record<Track, string> = { science: '理組', liberal: '文組' };

const line = (label: string, seats: number, students: number): CapacityLine => {
  const ok = seats >= students;
  const extra = seats - students;
  const detail = `教室座位 ${seats}，考生 ${students}${extra > 0 ? `，多 ${extra} 個空位，空位留在最後面（由前往後連續排，中間不空位）。` : '，剛好排滿。'}`;
  const message = ok
    ? `${label}：${detail}`
    : `無法排座：${label}教室座位 ${seats}，考生 ${students}。座位不能比考生少，請增加 ${students - seats} 個座位。`;
  return { label, seats, students, ok, detail, message };
};

/** 班級教室的容量檢核：國中部合計一條；高中部理組、文組各一條，沒指定組別的教室另計 */
export function classCapacity(doc: Doc, exam: ExamConfig): { lines: CapacityLine[]; untracked: number; /** 還沒匯入本次考試名單：沒有考生人數可比，不顯示 0（D82） */ noList: boolean; /** 班級教室座位合計（沒名單也算得出來） */ seats: number } {
  const rooms = examRooms(doc, exam).filter((r) => r.kind === 'class');
  const roster = seatableEntries(doc, exam);
  const seats = rooms.reduce((n, r) => n + r.seatCount, 0);
  if (examEntries(doc, exam).length === 0) return { lines: [], untracked: rooms.filter((r) => !r.track).length, noList: true, seats };
  if (exam.division === 'junior') {
    return { lines: [line('全體', seats, roster.length)], untracked: 0, noList: false, seats };
  }
  const trackOfClass = new Map(doc.settings.classes.filter((c) => c.division === exam.division).map((c) => [c.no, c.track]));
  const lines: CapacityLine[] = [];
  for (const t of ['science', 'liberal'] as Track[]) {
    lines.push(line(TRACK_NAME[t], rooms.filter((r) => r.track === t).reduce((n, r) => n + r.seatCount, 0), roster.filter((s) => (s.track ?? trackOfClass.get(s.classNo)) === t).length));
  }
  return { lines, untracked: rooms.filter((r) => !r.track).length, noList: false, seats };
}

export type ReserveCheck = { tone: 'ok' | 'warn' | 'info'; message: string; /** 不含「預備教室座位不足：」前綴的內文，供已自帶標題的版面使用（#204） */ detail?: string };

/** 預備教室容量：沿用抽離分配的結果（不夠會回報是哪一科） */
export function reserveCheck(doc: Doc, exam: ExamConfig): ReserveCheck {
  if (exam.kind === 'bcct') return { tone: 'info', message: '會考沒有抽離，不需要預備教室。' };
  const r = detachPreview(doc, exam);
  if (r.ok) return { tone: 'ok', message: '預備教室容量夠用（同一節各科的抽離人數加總再比容量）：每一節的抽離考試與自習都排得下。' };
  const detail = `${r.errors[0] ?? ''}。請增加預備教室。`;
  return { tone: 'warn', message: `預備教室座位不足：${detail}`, detail };
}

export interface ReserveNeed {
  /** 需要的座位：同一時段（一組同時進行的節次）抽離考試加抽離自習的人數，取最多的一組 */
  need: number;
  /** 最多的那一組：科目名稱、抽離考試人數、抽離自習人數 */
  who: string; exam: number; study: number;
  /** 已列為預備的教室座位合計、已列入間數、教室總間數 */
  avail: number; on: number; total: number;
}

/** 步驟③ 預備教室格（稿 H-4）：需要／已列入。與第 4、5 步同一套「自習容量」計算（studyCapacity），有手動覆寫（單人特例）的人不進預備教室，不計入 */
export function reserveNeed(doc: Doc, exam: ExamConfig): ReserveNeed {
  const sc = studyGroupsOf(doc, exam);
  const w = worstOf(sc.groups).worst;
  return { need: w?.seatsNeed ?? 0, who: w?.label ?? '', exam: w?.examCount ?? 0, study: w?.studyCount ?? 0, avail: sc.avail, on: sc.used.length, total: sc.reserveAll.length };
}

/* ---------- 單一「自習容量」計算（G29、G31、G27；第 3、4、5 步共用，D27 修訂） ---------- */

export interface StudyGroupRow {
  key: string;
  /** 這一組節次的科目名稱 */
  label: string;
  periods: number[];
  /** 時段文字，例「第一天 時段二」；沒有時段資料時寫「第 N 節」 */
  when: string;
  /** 抽離考試（要預備教室座位）、抽離自習（預備教室，參考座位）人數 */
  examCount: number;
  studyCount: number;
  /** 不考、留在原班教室自習的人數（依班級）：標「少數」的另一邊 */
  stay: number;
  stayByClass: { classNo: number; count: number }[];
  /** 抽離考試與抽離自習必須各用整間教室（D27）：依預備教室順序各自取到夠的間數 */
  examRooms: number;
  studyRooms: number;
  /** 至少需要的座位（考試＋自習，兩者分間排） */
  seatsNeed: number;
  /** 已列入的預備教室座位合計 */
  avail: number;
  ok: boolean;
  /** 不足的座位數（含整間分配後的缺口），ok 時為 0 */
  short: number;
  /** 不足時：哪一部分放不下 */
  failPart?: 'exam' | 'study';
}
export interface StudyCapacity {
  /** 會考沒有抽離；分科（D99）另有自己的容量計算，不走這裡 */
  applicable: boolean;
  groups: StudyGroupRow[];
  /** 預備教室：已列入間數、共幾間、座位合計 */
  on: number; total: number; avail: number;
  /** 最多的一組（夠用時取需求最大者；不足時取第一個放不下的） */
  worst: StudyGroupRow | undefined;
  ok: boolean;
  /** 還要再列入幾間預備教室才夠（用共用設定裡尚未列入的預備教室依序加）；沒辦法就是 undefined，要新增預備教室 */
  addRooms: number | undefined;
  /** 上面「再列入」的教室 id（依序），沒辦法補足時為空 */
  addRoomIds: string[];
  /** 實際逐科分配（第 4 步）報的錯誤；分析上夠、實際分配卻有問題時才有 */
  allocErrors: string[];
  /** 原班教室座位是否夠（所有考生含不考的都要有座位，D5） */
  homeOk: boolean;
}

/** 從第 start 間起，依序整間取教室到座位夠 need；回 [取了幾間, 取到的座位合計, 下一間的位置]，不夠回 null */
function takeWhole(seats: readonly number[], start: number, need: number): [number, number, number] | null {
  if (need <= 0) return [0, 0, start];
  let cap = 0; let i = start;
  while (cap < need && i < seats.length) cap += seats[i++]!;
  return cap >= need ? [i - start, cap, i] : null;
}

/** 以一組預備教室座位數算每一組節次的需求（純函式，測試用） */
export function allocateWhole(seats: readonly number[], exam: number, study: number): { ok: boolean; examRooms: number; studyRooms: number; short: number; failPart?: 'exam' | 'study' } {
  const total = seats.reduce((a, b) => a + b, 0);
  const e = takeWhole(seats, 0, exam);
  if (!e) return { ok: false, examRooms: seats.length, studyRooms: 0, short: exam + study - total, failPart: 'exam' };
  const s = takeWhole(seats, e[2], study);
  if (!s) return { ok: false, examRooms: e[0], studyRooms: seats.length - e[2], short: study - (total - e[1]), failPart: 'study' };
  return { ok: true, examRooms: e[0], studyRooms: s[0], short: 0 };
}

/** 各組節次的自習容量（不含實際逐科分配的檢查）；reserveNeed 與 studyCapacity 共用 */
function studyGroupsOf(doc: Doc, exam: ExamConfig) {
  const reserveAll = roomsOfDivision(doc.settings.classrooms, exam.division, { classes: doc.settings.classes, exams: doc.exams }).filter((r) => r.kind === 'reserve');
  const used = examRooms(doc, exam).filter((r) => r.kind === 'reserve');
  const avail = used.reduce((n, r) => n + r.seatCount, 0);
  if (exam.kind === 'bcct' || exam.kind === 'ast') return { applicable: false, groups: [] as StudyGroupRow[], used, reserveAll, avail, spare: [] as number[], roomSeats: [] as number[], spareIds: [] as string[] };
  const { rules } = effectiveMarkRules(doc, exam);
  const entries = seatableEntries(doc, exam);
  const marks = applyMarks(entries, examClasses(doc, exam), exam.subjects, rules);
  const overrides = new Set(examOverrides(doc, exam).map((o) => o.code));
  const name = new Map(exam.subjects.map((s) => [s.id, s.name]));
  const listening = new Set(exam.subjects.filter(isListeningSubject).map((s) => s.id));
  const roomSeats = used.map((r) => r.seatCount);
  const spareRooms = reserveAll.filter((r) => !used.some((u) => u.id === r.id));
  const spare = spareRooms.map((r) => r.seatCount);
  const groups: StudyGroupRow[] = [];
  const periodMap = examSubjectPeriods(exam, doc.settings);
  for (const g of periodGroups(exam.subjects, periodMap)) {
    const whenSet = new Set<string>();
    for (const id of g.subjectIds) for (const sp of periodMap.get(id) ?? []) whenSet.add(sp.slot ? `${dayName(sp.day ?? 0)} ${slotName(sp.slot)}` : `第 ${sp.period} 節`);
    const ex = new Set<string>(); const st = new Set<string>(); const nonTake = new Map<string, number>();
    for (const m of marks) {
      if (!g.subjectIds.includes(m.subjectId) || overrides.has(m.code)) continue;
      (m.mode === 'extra' ? ex : st).add(m.code);
    }
    for (const e of entries) {
      const code = studentCode(e.classNo, e.seatNo);
      if (ex.has(code) || st.has(code) || overrides.has(code)) continue;
      if (g.subjectIds.some((id) => !listening.has(id) && !e.subjectIds.includes(id))) nonTake.set(code, e.classNo);
    }
    const byClass = new Map<number, number>();
    for (const c of nonTake.values()) byClass.set(c, (byClass.get(c) ?? 0) + 1);
    const a = allocateWhole(roomSeats, ex.size, st.size);
    const n = new Set([...ex, ...st]).size;
    groups.push({
      key: g.subjectIds.join('+'), label: g.subjectIds.filter((id) => marks.some((m) => m.subjectId === id && !overrides.has(m.code)) || entries.some((e) => !e.subjectIds.includes(id))).map((id) => name.get(id) ?? id).join('、') || g.subjectIds.map((id) => name.get(id) ?? id).join('、'),
      periods: g.periods, when: [...whenSet].join('、') || `第 ${g.periods.join('、')} 節`, examCount: ex.size, studyCount: st.size, stay: nonTake.size,
      stayByClass: [...byClass].sort((x, y) => x[0] - y[0]).map(([classNo, count]) => ({ classNo, count })),
      examRooms: a.examRooms, studyRooms: a.studyRooms, seatsNeed: n, avail, ok: a.ok, short: Math.max(0, a.short), ...(a.failPart ? { failPart: a.failPart } : {}),
    });
  }
  return { applicable: true, groups, used, reserveAll, avail, spare, roomSeats, spareIds: spareRooms.map((r) => r.id) };
}
const worstOf = (groups: StudyGroupRow[]) => {
  const active = groups.filter((g) => g.examCount + g.studyCount > 0);
  const bad = active.find((g) => !g.ok);
  return { active, bad, worst: bad ?? active.reduce<StudyGroupRow | undefined>((m, g) => (!m || g.seatsNeed > m.seatsNeed ? g : m), undefined) };
};

export function studyCapacity(doc: Doc, exam: ExamConfig): StudyCapacity {
  const { applicable, groups, used, reserveAll, avail, spare, roomSeats, spareIds } = studyGroupsOf(doc, exam);
  if (!applicable) return { applicable: false, groups: [], ok: true, on: used.length, total: reserveAll.length, avail, worst: undefined, addRooms: undefined, addRoomIds: [], allocErrors: [], homeOk: true };
  const cc = classCapacity(doc, exam);
  const homeOk = cc.noList || cc.lines.every((l) => l.ok);
  const { active, bad, worst } = worstOf(groups);
  const preview = detachPreview(doc, exam);
  const allocErrors = !bad && !preview.ok ? preview.errors : [];
  const ok = !bad && allocErrors.length === 0;
  // 再列入幾間：用還沒列入的預備教室依序加，直到每一組都夠
  let addRooms: number | undefined;
  if (!ok) {
    for (let k = 1; k <= spare.length; k++) {
      const seats = [...roomSeats, ...spare.slice(0, k)];
      if (active.every((g) => allocateWhole(seats, g.examCount, g.studyCount).ok)) { addRooms = k; break; }
    }
  }
  return { applicable: true, groups, ok, worst, on: used.length, total: reserveAll.length, avail, addRooms, addRoomIds: addRooms ? spareIds.slice(0, addRooms) : [], allocErrors, homeOk };
}
