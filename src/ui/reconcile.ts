/**
 * G35 考前對帳（稿 v2.47，DESIGN 10.25）：第 6 步下載前，把帳獨立重算一遍。
 * 「獨立重算」＝不拿排座引擎自己的計數驗自己：從最後要輸出的座位表頁面、標籤頁面與排座結果原始資料重新點人；
 * 「應有」一側只取名單（名冊、考試名單、考科），「實有」一側取輸出。
 * 檢核編號 M-1～M-8（補考用 C-，不撞號）；燈號：pass 通過、warn 警示（須逐項確認）、fail 不通過（擋下載）、na 不適用。
 * 三種考試共用同一套檢核與總帳：學測（有預備教室與抽離）、會考（無抽離、無自習）、分科（D99，不考的人＝自習，算進座位容量）。
 * 鐵則（使用者 2026-11-18，D135）：每個時段，學生人數＝考試人數＋自習人數，每個人都要有去處。學測沒有「不參加」這一類：
 * 名冊有、考試名單沒有的人（含全科缺考）＝自習，直接進排座引擎（D137），跟其他人一樣從排座結果點人；沒排座＝遺漏。
 * 會考不可不參加（WP-5）：名冊每人都排座，沒考這節的人算「不參加」欄（座位在、人不來）。
 * 自習容量不另算：學測沿用 capacity.ts 的 studyCapacity，分科沿用 ast/model.ts 的 astCapacity。
 */
import type { ExamConfig } from '../data';
import { classroomSeats, settingsForExam, studentCode } from '../data';
import { dayName, examSubjectPeriods, slotName } from '../core/periods';
import { periodGroups } from '../core/detach';
import { specialOf } from '../core/stats';
import { dataVersion } from '../core/version';
import { buildLabelPages, buildSeatPages, PREP_TAG, type ExportInput } from '../export/model';
import { studyCapacity } from './capacity';
import { currentSeatingVersion, effectiveMarkRules, examClasses, examEntries, examResult, examRooms, isStale, seatableEntries } from './seating';
import { rosterFor } from './rosterYears';
import type { Doc } from './store';
import { astCapacity, astPlan, astSlots, astSnapshotMismatch, astFingerprint } from './ast/model';
import type { AstOutputs } from './ast/output';

/** wait＝待執行（只有補考 C-14：下載前沒有檔可回讀，不可假裝綠燈；DESIGN 10.27.1 第四態） */
export type Light = 'pass' | 'warn' | 'fail' | 'na' | 'wait';
export interface Issue {
  text: string;
  /** 處理路徑：到第幾步 */
  step?: 2 | 3 | 5;
  /** 補考沿用：自帶的跳轉（步驟名與動作），有的話優先於 step */
  go?: { label: string; run: () => void };
}
export interface Check {
  id: string;
  title: string;
  light: Light;
  /** 容量類（M-4、M-5）三格是「上限／使用／餘額」，其餘「應有／實有／差異」 */
  cap: boolean;
  a: number | string;
  b: number | string;
  d: number;
  summary: string;
  /** 公式只在展開明細時呈現 */
  formula: string;
  issues: Issue[];
}
export interface LedgerRow {
  key: string;
  when: string;
  subject: string;
  /** 名單範圍 ＝ 考試 ＋ 自習 ＋ 不參加 */
  scope: number;
  exam: number;
  study: number;
  absent: number;
  /** 座位表／標籤／教室加總（獨立點人）三處的人數：學測、會考（all＝true，D153）座位表與教室加總要等於名單範圍（每人一個座位），標籤等於考試人數；分科三處都等於考試人數 */
  seat: number;
  label: number;
  room: number;
  /** 座位表、教室加總以名單範圍（名冊總人數）為準（學測、會考；D149④、D153） */
  all?: boolean;
  ok: boolean;
}
export type Reconcile =
  | { state: 'no-roster' }
  | { state: 'no-result' }
  | { state: 'ready'; kind: ExamConfig['kind']; scope: { total: number; enrolled: number; absent: number }; checks: Check[]; ledger: LedgerRow[]; /** 排座結果版本；資料變動後確認作廢用 */ version: string; hasStudy: boolean; /** 總帳有沒有「不參加」這一類：學測沒有（不參加的人算自習），會考、分科有 */ hasAbsent: boolean };

export const LIGHT_TEXT: Record<Light, string> = { pass: '通過', warn: '警示', fail: '不通過', na: '不適用', wait: '待下載後執行' };
export const LIGHT_ICON: Record<Light, string> = { pass: '✓', warn: '▲', fail: '✕', na: '–', wait: '…' };

/** 琥珀建議值（稿 v2.47 待確認，照稿預設） */
export const WARN_STUDY_RATIO = 0.9;
export const WARN_ABSENT_RATIO = 0.2;

const mk = (c: Partial<Check> & Pick<Check, 'id' | 'title' | 'formula'>): Check => ({ light: 'pass', cap: false, a: 0, b: 0, d: 0, summary: '', issues: [], ...c });
const na = (id: string, title: string, why: string, formula: string): Check => mk({ id, title, light: 'na', summary: why, formula });

/** 差異類：差異不為 0 即不通過 */
const tri = (id: string, title: string, a: number | string, b: number | string, d: number, formula: string, summary: string, issues: Issue[], warn = false): Check =>
  mk({ id, title, a, b, d, formula, summary, issues, light: d !== 0 ? 'fail' : issues.length ? (warn ? 'warn' : 'fail') : 'pass' });

const pct = (n: number, m: number) => (m > 0 ? Math.round((n / m) * 100) : 0);

/** 總帳一列是否帳平：名單範圍＝考試＋自習＋不參加；座位表、教室加總＝名單範圍（all，D153）或考試人數（分科）；標籤＝考試人數；考試人數＝名單應有 */
export const ledgerWant = (r: Pick<LedgerRow, 'scope' | 'exam' | 'all'>): { seat: number; label: number; room: number } => ({ seat: r.all ? r.scope : r.exam, label: r.exam, room: r.all ? r.scope : r.exam });
const ledgerOk = (r: Omit<LedgerRow, 'ok'>, expExam: number, expStudy: number): boolean => {
  const w = ledgerWant(r);
  return r.scope === r.exam + r.study + r.absent && r.seat === w.seat && r.label === w.label && r.room === w.room && r.exam === expExam && r.study === expStudy;
};

/** 一個教室節次的占用：房間、時段、用途 */
interface Use { /** 抽離（預備、綜合）教室 */ reserve: boolean; room: string; roomName: string; slot: number; exam: number; study: number; seats: number; dup: number }

function m4(uses: Use[], slotName: (i: number) => string, cap: (u: Use) => number): Check {
  const formula = '同時段一座位一人；教室人數 ≤ 可用座位';
  const over = uses.filter((u) => u.exam > cap(u));
  const dup = uses.filter((u) => u.dup > 0);
  // 琥珀「滿座」只看抽離（預備、綜合）教室；班級教室排滿是常態，不警示（使用者 2026-11-17 裁示）
  const full = uses.filter((u) => u.reserve && u.exam > 0 && u.exam === cap(u));
  const tight = uses.filter((u) => u.exam > 0).reduce<Use | undefined>((m, u) => (!m || cap(u) - u.exam < cap(m) - m.exam ? u : m), undefined);
  const issues: Issue[] = [
    ...over.map((u) => ({ text: `${u.roomName} ${slotName(u.slot)}：${u.exam} 人，座位 ${cap(u)}，超過 ${u.exam - cap(u)} 人`, step: 3 as const })),
    ...dup.map((u) => ({ text: `${u.roomName} ${slotName(u.slot)}：有 ${u.dup} 個座位被兩人使用`, step: 5 as const })),
  ];
  const a = tight ? cap(tight) : 0;
  const b = tight?.exam ?? 0;
  if (issues.length) return mk({ id: 'M-4', title: '座位不重複、不超量', cap: true, light: 'fail', a, b, d: a - b, formula, summary: `${over.length + dup.length} 個教室節次有問題`, issues });
  if (full.length) return mk({ id: 'M-4', title: '座位不重複、不超量', cap: true, light: 'warn', a, b, d: 0, formula, summary: `沒有超量，但有 ${full.length} 個教室節次剛好滿座`, issues: full.map((u) => ({ text: `${u.roomName} ${slotName(u.slot)}：考試 ${u.exam} 人，座位 ${cap(u)}，沒有備用`, step: 3 as const })) });
  return mk({ id: 'M-4', title: '座位不重複、不超量', cap: true, a, b, d: a - b, formula, summary: tight ? `最滿：${tight.roomName} ${slotName(tight.slot)}` : '沒有使用中的教室' });
}

function m5(id: string, a: number, b: number, bad: boolean, short: string, tight: string, issues: Issue[]): Check {
  const formula = '每時段自習人數 ≤ 自習位置（與第 3、4、5 步同一個自習容量計算）';
  if (bad || issues.length) return mk({ id, title: '自習容量', cap: true, light: 'fail', a, b, d: a - b, formula, summary: short, issues });
  if (a > 0 && b / a >= WARN_STUDY_RATIO) return mk({ id, title: '自習容量', cap: true, light: 'warn', a, b, d: a - b, formula, summary: `達位置的 ${pct(b, a)}%`, issues: [{ text: `${tight}：自習 ${b} 人，自習位置 ${a}，只剩 ${a - b} 位`, step: 3 }] });
  return mk({ id, title: '自習容量', cap: true, a, b, d: a - b, formula, summary: a > 0 ? `最多同時 ${b} 人（${pct(b, a)}%）` : '沒有人需要自習位置' });
}

const m7 = (a: string, b: string, why: string): Check => mk({ id: 'M-7', title: '資料版本碼', a, b, d: a === b ? 0 : 1, light: a === b ? 'pass' : 'fail', formula: '排座結果與名單、教室、標示是同一版', summary: a === b ? '排座結果與目前資料是同一版' : '版本不同', issues: a === b ? [] : [{ text: why, step: 5 }] });

/* ---------------- 學測、會考 ---------------- */

export function reconcileStandard(doc: Doc, exam: ExamConfig): Reconcile {
  const roster = rosterFor(doc, exam)[exam.division] ?? [];
  const entries = examEntries(doc, exam);
  if (roster.length === 0 || entries.length === 0) return { state: 'no-roster' };
  const result = examResult(doc, exam);
  if (!result) return { state: 'no-result' };
  const settings = settingsForExam(doc.settings, exam);
  const rooms = examRooms(doc, exam);
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const bcct = exam.kind === 'bcct';
  const R = new Set(roster.map((s) => studentCode(s.classNo, s.seatNo)));
  // 排座名單（D137、D142）：考試名單＋名冊有、名單沒有的人，全部進排座引擎；不在這裡的名冊學生＝沒有去處（防呆，正常不會有）
  const enrolledList = seatableEntries(doc, exam);
  const enrolled = new Map(enrolledList.map((e) => [studentCode(e.classNo, e.seatNo), e]));
  const unseated = [...R].filter((c) => !enrolled.has(c));
  // 報名＝考試名單裡有排座的人（含名冊沒有的人，M-1 用來抓）；不參加＝名冊裡不是報名者的人
  const listedSeated = entries.map((e) => studentCode(e.classNo, e.seatNo)).filter((c) => enrolled.has(c));
  const listedSet = new Set(listedSeated);
  const scope = { total: R.size, enrolled: listedSeated.length, absent: [...R].filter((c) => !listedSet.has(c)).length };
  // 學測：每時段「名冊＝考試＋自習」，沒有第三類；會考沒有自習：沒考這節的人（有座位）算不參加欄
  const absentStudy = exam.kind === 'gsat';
  const ab = '不參加';

  // 輸出：座位表頁面與標籤頁面（與下載同一份頁面模型、同一份排座名單）
  const input: ExportInput = { settings, exam, students: roster, entries: seatableEntries(doc, exam), result };
  let buildErr = '';
  let sp: ReturnType<typeof buildSeatPages> = [];
  let lp: ReturnType<typeof buildLabelPages> = [];
  try { sp = buildSeatPages(input, 'all'); lp = buildLabelPages(input, 'all'); } catch (e) { buildErr = e instanceof Error ? e.message : String(e); }
  const seatHome = new Map<string, number>();
  const seatRes = new Set<string>();
  for (const p of sp) {
    if (p.slotMode) { for (const c of p.cells.values()) for (const x of c.persons ?? []) seatRes.add(x.code); }
    else if (p.tag === undefined) for (const c of p.cells.values()) { seatHome.set(c.code, (seatHome.get(c.code) ?? 0) + 1); }
  }
  const labelHome = new Set<string>();
  const labelRes = new Set<string>();
  for (const p of lp) {
    if (p.tag === PREP_TAG) { for (const c of p.cells) for (const x of c.persons ?? []) labelRes.add(x.code); }
    else for (const c of p.cells) labelHome.add(c.code);
  }

  // 輸出原始資料：座位指派、抽離、特例、標示
  const homeRoom = new Map<string, string[]>();
  for (const a of result.assignments) homeRoom.set(a.code, [...(homeRoom.get(a.code) ?? []), a.classroomId]);
  const special = specialOf(result);
  const { rules } = effectiveMarkRules(doc, exam);
  // #356：只取本部別的班級（與排座引擎、標示規則同一份 examClasses）；國中、高中班號重疊時，
  // 用全部班級建表會讓沒有組別的國中班蓋掉高中班的組別，「＋標考的」未標者就被誤算成考試
  const classTrack = new Map(examClasses(doc, exam).map((c) => [c.no, c.track]));
  const periods = examSubjectPeriods(exam, settings);
  const groups = periodGroups(exam.subjects, periods);
  const subjName = new Map(exam.subjects.map((s) => [s.id, s.name]));
  const whenOf = (g: { subjectIds: string[]; periods: number[] }): string => {
    const set = new Set<string>();
    for (const id of g.subjectIds) for (const sp2 of periods.get(id) ?? []) set.add(sp2.slot ? `${dayName(sp2.day ?? 0)} ${slotName(sp2.slot)}` : `第 ${sp2.period} 節`);
    return [...set].join('、') || `第 ${g.periods.join('、')} 節`;
  };

  type Status = { kind: 'exam' | 'study' | 'absent' | 'none'; where: 'home' | 'reserve' | 'special' | '' ; places: number; room?: string; seat?: string };
  const statusOf = (code: string, ids: ReadonlySet<string>): Status => {
    const dEx = result.detaches.filter((d) => d.code === code && d.purpose === 'exam' && ids.has(d.subjectId));
    const dSt = result.detaches.filter((d) => d.code === code && d.purpose === 'study' && ids.has(d.subjectId));
    const homes = homeRoom.get(code) ?? [];
    const places = (dEx.length ? 1 : 0) + (dSt.length ? 1 : 0) + (!dEx.length && !dSt.length ? homes.length : 0);
    if (dEx.length) return { kind: 'exam', where: 'reserve', places, room: dEx[0]!.roomId, ...(dEx[0]!.seat ? { seat: `${dEx[0]!.seat.row}-${dEx[0]!.seat.depth}` } : {}) };
    if (dSt.length) return { kind: 'study', where: 'reserve', places };
    const sp1 = special.find((s) => s.code === code && ids.has(s.subjectId));
    if (sp1 && homes.length) return { kind: sp1.purpose, where: 'special', places, room: homes[0]! };
    if (!homes.length) return { kind: 'none', where: '', places };
    const mk1 = result.marks.find((m) => m.code === code && ids.has(m.subjectId));
    const e = enrolled.get(code);
    // 會考：有座位、這節沒考的人（全科缺考、名單外）＝不參加（座位在、人不來；會考不可不參加，WP-5）
    if (bcct && e && !e.subjectIds.some((id) => ids.has(id))) return { kind: 'absent', where: 'home', places, room: homes[0]! };
    const track = e?.track ?? classTrack.get(Number(code.slice(0, 2)));
    // 沒有標示、留在原班的人：「＋標考的」科目＝不考（留班自習）
    const minority = rules.some((r) => r.track === track && ids.has(r.subjectId) && r.mode === 'mark-extra');
    // 該組這科全不考（D11 全考或全不考的科不標，所以沒有規則也沒有標示）：留在原班的人也是自習。
    // 有規則卻沒標示的（例如 X 標示漏標）不走這條，照舊算考試，真正不平仍會紅
    const allSkip = !bcct && !!e && !rules.some((r) => r.track === track && ids.has(r.subjectId)) && !e.subjectIds.some((id) => ids.has(id));
    const kind: 'exam' | 'study' = mk1 ? (mk1.mode === 'absent' ? 'study' : 'exam') : minority || allSkip ? 'study' : 'exam';
    return { kind, where: 'home', places, room: homes[0]! };
  };

  const ledger: LedgerRow[] = [];
  const uses: Use[] = [];
  const slotLabel: string[] = [];
  const issues3: Issue[] = [];
  let sumExpPlaces = 0; let sumPlaces = 0; let dupN = 0; let missN = 0;
  let sumExpExam = 0; let sumDiffExam = 0; let sumLabel = 0; let sumRoom = 0; let sumSeat = 0; let sumExam1 = 0; let sumScope = 0;
  const m2issues: Issue[] = [];
  const reserveOverlap: Issue[] = [];
  const missOnce = new Set<string>();
  let overlapN = 0;
  const roomSlotN = rooms.length * groups.length;
  const m5bad: string[] = [];
  const cap = bcct ? undefined : studyCapacity(doc, exam);

  groups.forEach((g, gi) => {
    const ids = new Set(g.subjectIds);
    const when = whenOf(g);
    slotLabel.push(when);
    const expExam = enrolledList.filter((e) => e.subjectIds.some((id) => ids.has(id))).length;
    // 學測：名冊 − 應考（不參加、全科缺考的人也是自習）；會考沒有自習
    const expStudy = bcct ? 0 : R.size - expExam;
    let exam1 = 0; let study1 = 0; let absent1 = 0; let seat = 0; let label = 0; let room = 0; let dEx = 0; let dSt = 0;
    const perRoom = new Map<string, { exam: number; study: number; seats: Map<string, number> }>();
    const bump = (rid: string, k: 'exam' | 'study', seatKey?: string) => {
      const x = perRoom.get(rid) ?? { exam: 0, study: 0, seats: new Map<string, number>() };
      x[k]++; if (seatKey) x.seats.set(seatKey, (x.seats.get(seatKey) ?? 0) + 1);
      perRoom.set(rid, x);
    };
    for (const [code] of enrolled) {
      const s = statusOf(code, ids);
      sumExpPlaces++; sumPlaces += s.places;
      // D153：每人每時段只算一個去處。座位表＝每個人一個座位（抽離考試看預備教室座位表，其餘看原班座位，自習者也有原班座位）；各教室加總＝每個人所在的一間教室
      if (s.kind !== 'none') {
        if (s.kind === 'exam' && s.where === 'reserve' ? seatRes.has(code) : (seatHome.get(code) ?? 0) > 0) seat++;
        const inRoom = s.kind === 'exam' ? !!s.room : s.kind === 'study' && s.where === 'reserve' ? result.detaches.some((d) => d.code === code && d.purpose === 'study' && ids.has(d.subjectId) && !!d.roomId) : (homeRoom.get(code)?.length ?? 0) > 0;
        if (inRoom) room++;
      }
      if (s.places > 1) { dupN += s.places - 1; issues3.push({ text: `${code.slice(0, 2)} 班 ${code.slice(2)} 號 ${when}：有 ${s.places} 個去處`, step: 5 }); }
      if (s.places === 0) { missN++; issues3.push({ text: `${code.slice(0, 2)} 班 ${code.slice(2)} 號 ${when}：沒有去處`, step: 5 }); }
      if (s.kind === 'exam') {
        exam1++;
        if (s.where === 'reserve') { dEx++; if (labelRes.has(code)) label++; } else if (labelHome.has(code)) label++;
        if (s.room) bump(s.room, 'exam', s.where === 'reserve' ? s.seat : undefined);
      } else if (s.kind === 'study') {
        study1++;
        if (s.where === 'reserve') { dSt++; if (s.room) bump(s.room, 'study'); }
      } else if (s.kind === 'absent') absent1++;
    }
    // 名冊上沒排座的人（防呆，D142 起正常不會有）：沒有去處＝遺漏，紅燈（D135④：每個學生每個時段都要有座位）
    for (const code of unseated) {
      sumExpPlaces++; missN++;
      if (!missOnce.has(code)) { missOnce.add(code); issues3.push({ text: `${code.slice(0, 2)} 班 ${code.slice(2)} 號：沒有座位（每個學生每個時段都要有座位）`, step: 2 }); }
    }
    for (const [rid, x] of perRoom) {
      const r = roomById.get(rid);
      const dup = [...x.seats.values()].filter((n) => n > 1).length;
      uses.push({ reserve: r?.kind === 'reserve', room: rid, roomName: r?.name ?? rid, slot: gi, exam: x.exam, study: x.study, seats: r ? classroomSeats(r).length : 0, dup });
    }
    // M-8：從抽離原始資料重新點每間教室這個時段的用途
    const rawUse = new Map<string, { exam: number; study: number }>();
    for (const d of result.detaches) {
      if (!ids.has(d.subjectId)) continue;
      const u = rawUse.get(d.roomId) ?? { exam: 0, study: 0 };
      u[d.purpose]++; rawUse.set(d.roomId, u);
    }
    for (const [rid, u] of rawUse) if (u.exam > 0 && u.study > 0) { overlapN++; reserveOverlap.push({ text: `${roomById.get(rid)?.name ?? rid} ${when}：同時有抽離考試 ${u.exam} 人與抽離自習 ${u.study} 人`, step: 3 }); }
    const row0 = { key: g.subjectIds.join('+'), when, subject: g.subjectIds.map((id) => subjName.get(id) ?? id).join('、'), scope: R.size, exam: exam1, study: study1, absent: absent1, seat, label, room, all: true as const };
    const ok = ledgerOk(row0, expExam, expStudy);
    ledger.push({ ...row0, ok });
    sumExpExam += expExam; sumLabel += label; sumRoom += room; sumSeat += seat; sumExam1 += exam1; sumScope += R.size;
    const dd = Math.abs(seat - R.size) + Math.abs(room - R.size) + Math.abs(label - expExam);
    sumDiffExam += dd;
    if (dd) m2issues.push({ text: `${when} ${row0.subject}：名冊 ${R.size} 人（其中應考 ${expExam}），座位表 ${seat}、各教室加總 ${room}；標籤 ${label}（應等於應考 ${expExam}）`, step: 5 });
    // 口徑一致：抽離考試、抽離自習人數與 G31 自習容量同一組數字
    const cg = cap?.groups.find((x) => x.key === row0.key);
    if (cg && (cg.examCount !== dEx || cg.studyCount !== dSt)) m5bad.push(`${when}：對帳點出抽離考試 ${dEx}、抽離自習 ${dSt}，自習容量算 ${cg.examCount}、${cg.studyCount}`);
  });

  // M-1
  const m1d = R.size - (scope.enrolled + scope.absent);
  const m1 = tri('M-1', '學生數', R.size, scope.enrolled + scope.absent, m1d, `名冊人數＝報名人數＋${ab}人數${absentStudy || exam.kind === 'ast' ? '（不參加的人是自習，座位在 M-3 檢核）' : ''}`, `名冊 ${R.size} ＝ 報名 ${scope.enrolled} ＋ ${ab} ${scope.absent}`,
    m1d !== 0 ? [{ text: `考試名單有 ${scope.enrolled + scope.absent - R.size > 0 ? '名冊沒有的人' : '重複或遺漏'}，名冊 ${R.size} 人、報名 ${scope.enrolled} 人`, step: 2 }] : []);
  if (m1.light === 'pass' && R.size > 0 && scope.absent / R.size > WARN_ABSENT_RATIO) {
    m1.light = 'warn';
    m1.issues = [{ text: `${ab} ${scope.absent} 人，超過名單範圍 ${R.size} 人的 ${Math.round(WARN_ABSENT_RATIO * 100)}%（常見於名單匯錯）`, step: 2 }];
  }
  // M-2
  const m2 = tri('M-2', '每時段人數', sumScope, sumSeat, sumDiffExam, '座位表＝各教室加總＝名冊總人數（每個學生不管考不考都佔一個座位）；標籤＝應考人數（自習者不印標籤）；每人每時段只算一個去處', `${groups.length} 個時段${sumDiffExam ? `，差異共 ${sumDiffExam} 人次` : '全部相符'}`, buildErr ? [{ text: `座位表或標籤排不出來：${buildErr}`, step: 3 }, ...m2issues] : m2issues);
  // M-3
  const m3 = tri('M-3', '每人每時段一個去處', sumExpPlaces, sumPlaces, sumPlaces - sumExpPlaces, (bcct ? '同一人同一節次只有一個座位' : '同一人同一節次只有一個去處（考試座位或自習位置；跨組、跨抽離都算；名冊上不參加的人也要有自習座位）'), `${R.size} 人 × ${groups.length} 時段；重複 ${dupN}、遺漏 ${missN}`, issues3.slice(0, 20));
  // M-4
  const m4c = m4(uses, (i) => slotLabel[i] ?? `時段 ${i + 1}`, (u) => u.seats);
  // M-5
  const worst = cap?.worst;
  const m5c = bcct || !cap ? na('M-5', '自習容量', '會考每位考生都在原班教室考，沒有自習空間', '每時段自習人數 ≤ 自習位置')
    : m5('M-5', cap.avail, worst?.seatsNeed ?? 0, !cap.ok, cap.ok ? '' : `預備教室座位不足：${cap.allocErrors[0] ?? (worst ? `${worst.when} 缺 ${worst.short} 座` : '')}`.trim(), worst ? `${worst.when} ${worst.label}` : '',
      [...(cap.ok ? [] : [{ text: cap.allocErrors[0] ?? (worst ? `${worst.when}：需要 ${worst.seatsNeed} 座，缺 ${worst.short}` : '座位不足'), step: 3 as const }]), ...m5bad.map((t) => ({ text: `口徑不一致：${t}`, step: 5 as const }))]);
  // M-6
  const m6d = Math.abs(sumSeat - sumRoom) + Math.abs(sumLabel - sumExam1);
  const m6 = tri('M-6', '檔案與畫面', sumRoom, sumSeat, m6d, (bcct ? '座位表、標籤的人數＝畫面' : '座位表、標籤、抽離名單的人數＝畫面'), `座位表 ${sp.length} 頁、標籤 ${lp.length} 頁`, m6d ? [{ text: `畫面 ${sumRoom} 人次，座位表檔 ${sumSeat}；標籤檔 ${sumLabel}（應為應考 ${sumExam1}）`, step: 5 }] : []);
  // M-7
  const cur = currentSeatingVersion(doc, exam) ?? result.dataVersion;
  const stale = isStale(doc, exam);
  const m7c = m7(stale ? cur : result.dataVersion, result.dataVersion, '名單或設定在排座之後改過，請重新排座');
  // M-8
  const m8c = bcct ? na('M-8', '教室用途不重疊', '會考每位考生都在原班教室考，教室沒有分用', '同一節次，同一間教室不可同時有兩種以上用途')
    : tri('M-8', '教室用途不重疊', 0, overlapN, overlapN, '同一節次，同一間教室不可同時有兩種以上用途（抽離考試、抽離自習、原班考試）', `${roomSlotN} 個教室節次${overlapN ? `，${overlapN} 個有兩種用途` : '，每個只有一種用途'}`, reserveOverlap);
  const checks = [m1, m2, m3, m4c, m5c, m6, m7c, m8c];
  return { state: 'ready', kind: exam.kind, scope, checks, ledger, version: result.dataVersion, hasStudy: !bcct, hasAbsent: !absentStudy };
}

/* ---------------- 分科（D99） ---------------- */

export function reconcileAst(doc: Doc, exam: ExamConfig, outs?: AstOutputs): Reconcile {
  const roster = rosterFor(doc, exam)[exam.division] ?? [];
  const entries = examEntries(doc, exam);
  if (roster.length === 0 || entries.length === 0) return { state: 'no-roster' };
  const plan = astPlan(doc, exam);
  if (!plan || plan.infeasible) return { state: 'no-result' };
  const slots = astSlots(doc, exam);
  const R = new Set(roster.map((s) => studentCode(s.classNo, s.seatNo)));
  const enrolled = new Map(entries.map((e) => [studentCode(e.classNo, e.seatNo), e]));
  // 不參加（名冊有、考試名單沒有）＝每節自習，astStudents 已把他們排進規劃（使用者 2026-11-18：「分科也是這樣」）
  const absentCodes = [...R].filter((c) => !enrolled.has(c));
  const absentN = absentCodes.length;
  const scope = { total: R.size, enrolled: entries.length, absent: absentN };
  const roomById = new Map(plan.input.rooms.map((r) => [r.id, r]));
  const rname = (id: string) => roomById.get(id)?.name ?? doc.settings.classrooms.find((r) => r.id === id)?.name ?? id;
  const subjName = new Map(exam.subjects.map((s) => [s.id, s.name]));
  const shortOf = (i: number) => `${slots[i]!.day + 1}天${slots[i]!.slot}`;
  const countLines = (pages: { cells: Map<string, { periodLines?: { head: string }[] }> | { periodLines?: { head: string }[] }[] }[], head: string) => pages.reduce((n, p) => n + [...(p.cells instanceof Map ? p.cells.values() : p.cells)].reduce((m, c) => m + (c.periodLines ?? []).filter((l) => l.head === head).length, 0), 0);

  const ledger: LedgerRow[] = [];
  const uses: Use[] = [];
  const issues3: Issue[] = [];
  const m2issues: Issue[] = [];
  const overlap: Issue[] = [];
  let sumExpPlaces = 0; let sumPlaces = 0; let dupN = 0; let missN = 0; let sumExp = 0; let sumDiff = 0; let sumLabel = 0; let sumSeat = 0; let sumRoom = 0; let overlapN = 0; let sumScope = 0; let sumExamN = 0; let sumResExam = 0; let sumResFile = 0;
  slots.forEach((s, gi) => {
    const ids = new Set(s.subjectIds);
    const exams = plan.out.exams.filter((e) => e.slotId === s.id);
    const study = plan.out.study.filter((e) => e.slotId === s.id);
    const expExam = entries.filter((e) => e.subjectIds.some((id) => ids.has(id))).length;
    const expStudy = entries.length + absentN - expExam;
    const places = new Map<string, number>();
    for (const e of exams) places.set(e.code, (places.get(e.code) ?? 0) + 1);
    for (const e of study) places.set(e.code, (places.get(e.code) ?? 0) + 1);
    for (const code of [...enrolled.keys(), ...absentCodes]) {
      const n = places.get(code) ?? 0;
      sumExpPlaces++; sumPlaces += n;
      if (n > 1) { dupN += n - 1; issues3.push({ text: `${code.slice(0, 2)} 班 ${code.slice(2)} 號 ${s.label}：有 ${n} 個去處`, step: 5 }); }
      if (n === 0) { missN++; issues3.push({ text: `${code.slice(0, 2)} 班 ${code.slice(2)} 號 ${s.label}：沒有去處（排不進自習空間）`, step: 3 }); }
    }
    const roomsHere = new Set([...exams.map((e) => e.roomId), ...study.map((e) => e.roomId)]);
    for (const rid of roomsHere) {
      const ex = exams.filter((e) => e.roomId === rid);
      const st = study.filter((e) => e.roomId === rid).length;
      const seatKeys = new Map<string, number>();
      for (const e of ex) seatKeys.set(`${e.row}-${e.depth}`, (seatKeys.get(`${e.row}-${e.depth}`) ?? 0) + 1);
      uses.push({ reserve: roomById.get(rid)?.kind === 'reserve', room: rid, roomName: rname(rid), slot: gi, exam: ex.length, study: st, seats: roomById.get(rid)?.seats.length ?? 0, dup: [...seatKeys.values()].filter((n) => n > 1).length });
      if (ex.length > 0 && st > 0) { overlapN++; overlap.push({ text: `${rname(rid)} ${s.label}：同時有考試 ${ex.length} 人與自習 ${st} 人`, step: 5 }); }
    }
    // D159（D153 延伸）：座位表＝各教室加總＝名冊全部（含不參加者；每人每時段只算一個去處），標籤＝應考人數
    const resExam = exams.filter((e) => roomById.get(e.roomId)?.kind === 'reserve').length;
    const resFile = outs ? countLines(outs.seat, shortOf(gi)) : resExam;
    const studySeated = (plan.out.studySeats ?? []).filter((x) => x.slotId === s.id).length;
    const room = exams.length + study.length;
    const seat = exams.length - resExam + resFile + studySeated;
    const label = outs ? countLines(outs.label, shortOf(gi)) : exams.length;
    const row0 = { key: s.id, when: s.label, subject: s.subjectIds.map((id) => subjName.get(id) ?? id).join('、'), scope: R.size, exam: exams.length, study: study.length, absent: 0, seat, label, room, all: true as const };
    ledger.push({ ...row0, ok: ledgerOk(row0, expExam, expStudy) });
    sumExp += expExam; sumLabel += label; sumSeat += seat; sumRoom += room; sumScope += R.size; sumExamN += exams.length; sumResExam += resExam; sumResFile += resFile;
    const dd = Math.abs(seat - R.size) + Math.abs(room - R.size) + Math.abs(label - expExam);
    sumDiff += dd;
    if (dd) m2issues.push({ text: `${s.label} ${row0.subject}：名冊 ${R.size} 人（其中應考 ${expExam}），座位表 ${seat}、各教室加總 ${room}；標籤 ${label}（應等於應考 ${expExam}）`, step: 5 });
  });
  const cp = astCapacity(doc, exam, plan);
  const m1d = R.size - (scope.enrolled + scope.absent);
  const m1 = tri('M-1', '學生數', R.size, scope.enrolled + scope.absent, m1d, '名冊人數＝報名人數＋不參加人數', `名冊 ${R.size} ＝ 報名 ${scope.enrolled} ＋ 不參加 ${scope.absent}`, m1d !== 0 ? [{ text: `名冊 ${R.size} 人、報名 ${scope.enrolled} 人，考試名單有名冊沒有的人或重複`, step: 2 }] : []);
  if (m1.light === 'pass' && R.size > 0 && scope.absent / R.size > WARN_ABSENT_RATIO) { m1.light = 'warn'; m1.issues = [{ text: `不參加 ${scope.absent} 人，超過名單範圍 ${R.size} 人的 ${Math.round(WARN_ABSENT_RATIO * 100)}%（常見於名單匯錯）`, step: 2 }]; }
  const m2 = tri('M-2', '每時段人數', sumScope, sumSeat, sumDiff, '座位表＝各教室加總＝名冊總人數（含不參加者，每個學生不管考不考都佔一個座位）；標籤＝應考人數（自習者不印標籤）；每人每時段只算一個去處', `${slots.length} 個時段${sumDiff ? `，差異共 ${sumDiff} 人次` : '全部相符'}`, m2issues);
  const m3 = tri('M-3', '每人每時段一個去處', sumExpPlaces, sumPlaces, sumPlaces - sumExpPlaces, '同一人同一節次只有一個去處（考試座位或自習位置；跨組、跨抽離都算）', `${enrolled.size + absentN} 人 × ${slots.length} 時段；重複 ${dupN}、遺漏 ${missN}`, issues3.slice(0, 20));
  const m4c = m4(uses, (i) => slots[i]?.label ?? `時段 ${i + 1}`, (u) => u.seats);
  const short = cp.study.slotsShort > 0 || plan.unplaced > 0 || cp.study.need > cp.study.capacity;
  const m5c = m5('M-5', cp.study.capacity, cp.study.need, short, `自習位置不足：自習 ${cp.study.need} 人，自習位置 ${cp.study.capacity}`, '自習最多的時段',
    short ? [{ text: `${cp.study.slotsShort} 個時段的自習位置不足${plan.unplaced ? `，${plan.unplaced} 人排不進` : ''}`, step: 3 }] : []);
  const m6d = outs ? Math.abs(sumLabel - sumExamN) + Math.abs(sumResFile - sumResExam) : 0;
  const m6 = tri('M-6', '檔案與畫面', sumExamN + sumResExam, outs ? sumLabel + sumResFile : sumExamN + sumResExam, m6d, '整合標籤的人數＝畫面應考人次；綜合教室座位表的人數＝畫面綜合教室考試人次', outs ? `標籤 ${outs.label.length} 頁、座位表 ${outs.seat.length} 頁` : '輸出尚未產生', m6d ? [{ text: `畫面應考 ${sumExamN} 人次、綜合教室考試 ${sumResExam}；標籤檔 ${sumLabel}、綜合教室座位表檔 ${sumResFile}`, step: 5 }] : []);
  const mismatch = astSnapshotMismatch(exam, plan);
  const fp = astFingerprint(exam, plan);
  const m7c = m7(fp, mismatch ? (exam.astFinalFp ?? '') : fp, mismatch ?? '');
  const m8c = tri('M-8', '教室用途不重疊', 0, overlapN, overlapN, '同一節次，同一間教室不可同時有兩種以上用途（考試、自習）', `${uses.length} 個使用中的教室節次${overlapN ? `，${overlapN} 個有兩種用途` : '，每個只有一種用途'}`, overlap);
  return { state: 'ready', kind: 'ast', scope, checks: [m1, m2, m3, m4c, m5c, m6, m7c, m8c], ledger, version: fp, hasStudy: true, hasAbsent: false };
}

export const reconcile = (doc: Doc, exam: ExamConfig, outs?: AstOutputs): Reconcile => (exam.kind === 'ast' ? reconcileAst(doc, exam, outs) : reconcileStandard(doc, exam));

/* ---------------- 下載閘門 ---------------- */

export interface Gate {
  /** 紅燈不通過數、琥珀警示數（警示只是提示，不擋下載，D149①） */
  fails: number;
  warns: Check[];
  /** 空字串＝可下載；否則是兩顆下載鈕停用的原因（只有紅燈才會有） */
  why: string;
}

/** 下載閘門（D149①，取代 D129 的逐項確認）：只有紅燈（不通過）擋下載；琥珀警示只顯示提示、不擋、不用確認 */
export function gateOf(r: Reconcile): Gate {
  if (r.state !== 'ready') return { fails: 0, warns: [], why: '' };
  const fails = r.checks.filter((c) => c.light === 'fail').length;
  const warns = r.checks.filter((c) => c.light === 'warn');
  if (fails > 0) return { fails, warns, why: `考前對帳有 ${fails} 項不通過，須先修正才能下載。` };
  return { fails, warns, why: '' };
}

/** 「11/17 14:32」（台北時間），顯示對帳重算時間 */
export function stampNow(now: Date = new Date()): string {
  const f = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
  const g = (t: string) => f.find((x) => x.type === t)?.value ?? '';
  return `${g('month')}/${g('day')} ${g('hour')}:${g('minute')}`;
}
