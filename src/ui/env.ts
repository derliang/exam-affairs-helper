/**
 * G37 環境確認（稿 v2.50，DESIGN 10.28）：純邏輯，不碰 DOM。
 * 「環境已確認」＝在資料夾設定檔（settings.env）存一份確認當時的快照與時間；之後比對目前設定與快照。
 * 燈號語意與 G35、補考統一：綠＝通過、琥珀＝須按「確認使用」（沒確認過／與上次確認不同）、紅＝缺必要設定（不可確認）。
 * 每一列各存一份快照，所以確認「學測」不會順便放行「國三」的變動。
 */
import type { Classroom, Division, EnvRow, EnvState, ExamKind, ScheduleKey } from '../data';
import { roomDivision } from '../data';
import { isDefaultSchedule, numberRows, SCHEDULE_KEYS, scheduleKeyOf, scheduleOf } from '../core/periods';
import { defaultSeatGrid } from './classRooms';
import { schoolYear, type Doc } from './store';

export type EnvTone = 'ok' | 'warn' | 'bad';
export type EnvState3 = 'confirmed' | 'never' | 'changed' | 'blocked';

export interface EnvLine {
  /** 快照鍵：sched:<ScheduleKey>、classes:<部別>、rooms:<部別>、school */
  key: string;
  label: string;
  text: string;
  sig: string;
  /** bad＝缺必要設定；warn＝沒確認過或與上次確認不同；ok＝與確認時相同 */
  tone: EnvTone;
  /** 紅燈原因（tone 為 bad 才有） */
  problem?: string;
  /** 琥珀時：上次確認的內容 */
  before?: string;
  /** 不擋建立的提醒（#343：某班人數超過班級教室上限，但同組座位總數夠） */
  note?: string;
}
export interface EnvChange { label: string; before: string; after: string }
export interface EnvReport {
  lines: EnvLine[];
  state: EnvState3;
  tone: EnvTone;
  problems: string[];
  changes: EnvChange[];
  confirmedAt?: string;
}

export const DIV_LABEL: Record<Division, string> = { senior: '高三', junior: '國三' };
export const kindDivision = (kind: ExamKind): Division => (kind === 'bcct' ? 'junior' : 'senior');
const labelOf = (key: ScheduleKey): string => SCHEDULE_KEYS.find((x) => x.key === key)!.label;

function schedLine(doc: Doc, key: ScheduleKey): Omit<EnvLine, 'tone'> {
  const t = scheduleOf(doc.settings, key);
  const rows = numberRows(t);
  const slots = rows.filter((r) => !r.samePrev).length || rows.length;
  const def = isDefaultSchedule(t, key);
  return {
    key: `sched:${key}`, label: '節次表',
    text: `${labelOf(key)}・${def ? '內建預設排列' : '排列已修改'}・${t.days.length} 天、${slots} 個時段`,
    sig: JSON.stringify(t.days.map((d) => d.map((x) => [x.subjectId ?? x.name, !!x.samePrev, x.start ?? '']))),
  };
}

const studentsOf = (doc: Doc, division: Division, classNo: number): number => doc.rosters[division].filter((s) => s.classNo === classNo).length;

const TRACK_LABEL: Record<string, string> = { science: '理組', liberal: '文組', none: '未設組別' };

/**
 * 教室與座位的檢查口徑（#343）：
 * - 學測、會考（seatExam）是把同組（高中部依文理組、國中部全體）的學生合起來排進同組的班級教室，
 *   所以只有「同組學生總數 > 同組班級教室座位總數」才是真的排不下（紅燈，擋建立）。
 * - 分科依各科報名人數排考場（班級教室＋預備教室），只有「部別學生總數 > 全部教室座位」才擋。
 * - 單一班級人數超過自己教室座位（例如 50 人、班級教室上限 56 座）只是提醒，不擋：多出的人會坐到同組其他教室的空位。
 * kind 省略（首次設定精靈）時用學測、會考的口徑。
 */
function classLines(doc: Doc, division: Division, kind?: ExamKind): EnvLine[] {
  const name = DIV_LABEL[division];
  const withStu = doc.settings.classes.filter((c) => c.division === division).map((c) => ({ c, n: studentsOf(doc, division, c.no) })).filter((x) => x.n > 0);
  const total = withStu.reduce((s, x) => s + x.n, 0);
  const classes: EnvLine = withStu.length
    ? { key: `classes:${division}`, label: '班級與人數', text: `${name} ${withStu.length} 班、${total} 人`, sig: JSON.stringify(withStu.map((x) => [x.c.name, x.n])), tone: 'ok' }
    : { key: `classes:${division}`, label: '班級與人數', text: `${name}還沒有學生名單`, sig: 'empty', tone: 'bad', problem: `${name}學生名單是空的，沒有班級可排` };
  const ctx = { classes: doc.settings.classes, exams: doc.exams };
  const rooms = doc.settings.classrooms.filter((r) => roomDivision(r, ctx) === division);
  if (!withStu.length) {
    return [classes, { key: `rooms:${division}`, label: '教室與座位', text: '還沒有學生名單，所以沒有班級教室可帶入', sig: 'empty', tone: 'bad', problem: '還沒有學生名單，所以沒有班級教室可帶入' }];
  }
  // 沒有班級教室的班級，之後會依人數自動帶出預設座位（G11），所以用「將會有的座位」算，確認後自動補教室也不會讓快照變動
  let seats = 0;
  const sig: unknown[] = [];
  const over: string[] = [];
  const groups = new Map<string, { n: number; s: number }>();
  for (const x of withStu) {
    const room: Classroom | undefined = rooms.find((r) => r.kind === 'class' && r.name === x.c.name);
    // 標了「不排座」的班級教室不算座位（D161）；這個班的學生會排進同組其他班級教室，所以也不報「座位比人數少」
    const s = room?.noSeat ? 0 : room ? room.seatCount : (() => { const g = defaultSeatGrid(x.n); return g.rows * g.depth; })();
    seats += s; sig.push(room?.noSeat ? [x.c.name, 'noSeat'] : [x.c.name, s]);
    if (s < x.n && !room?.noSeat) over.push(`「${x.c.name}」${x.n} 人、教室座位 ${s}`);
    const gk = division === 'junior' ? 'all' : (x.c.track ?? 'none');
    const g = groups.get(gk) ?? { n: 0, s: 0 };
    groups.set(gk, { n: g.n + x.n, s: g.s + s });
  }
  const reserve = division === 'senior' ? rooms.filter((r) => r.kind === 'reserve') : [];
  for (const r of reserve) sig.push(['reserve', r.name, r.seatCount]);
  let short: string | undefined;
  if (kind === 'ast') {
    const all = seats + reserve.reduce((a, r) => a + r.seatCount, 0);
    if (total > all) short = `${name}學生 ${total} 人，教室座位共 ${all} 個，還差 ${total - all} 個；請到教室清單新增預備教室`;
  } else {
    for (const [gk, g] of groups) {
      if (g.n <= g.s) continue;
      const who = division === 'junior' ? name : `${name}${TRACK_LABEL[gk] ?? gk}`;
      short = `${who}學生 ${g.n} 人，班級教室座位共 ${g.s} 個，還差 ${g.n - g.s} 個；請到教室清單加大班級教室座位（每間橫排、深位各最多 8，總座位 56）`;
      break;
    }
  }
  const note = !short && over.length
    ? `${over.join('、')}，座位比人數少（班級教室最多 56 座）。${kind === 'ast' ? '分科依各科報名人數排考場，不受影響。' : '排座時多出的人會坐到同組其他班級教室的空位，不影響建立；要讓同班坐在一起，可到教室清單調整座位或新增預備教室。'}`
    : undefined;
  const text = `班級教室 ${withStu.length} 間・座位 ${seats}${division === 'senior' ? `・預備教室 ${reserve.length} 間` : ''}`;
  const roomLine: EnvLine = { key: `rooms:${division}`, label: '教室與座位', text, sig: JSON.stringify(sig), tone: short ? 'bad' : 'ok', ...(short ? { problem: short } : {}), ...(note ? { note } : {}) };
  return [classes, roomLine];
}

/** #343：名冊有學生、但共用教室清單還沒有對應班級教室的班級名稱 */
export function classesWithoutRoom(doc: Doc, division: Division): string[] {
  const ctx = { classes: doc.settings.classes, exams: doc.exams };
  return doc.settings.classes
    .filter((c) => c.division === division && studentsOf(doc, division, c.no) > 0)
    .filter((c) => !doc.settings.classrooms.some((r) => r.kind === 'class' && r.name === c.name && roomDivision(r, ctx) === division))
    .map((c) => c.name);
}

function schoolLine(doc: Doc): EnvLine {
  const s = doc.settings;
  const blank = !s.schoolName.trim();
  return {
    key: 'school', label: '學校與標籤紙張',
    text: `${blank ? '（學校名稱空白）' : s.schoolName}・標籤 ${s.defaultLabelPaper}`,
    sig: JSON.stringify([s.schoolName, s.defaultLabelPaper, s.seatHeader ?? '', s.labelHeader ?? '']),
    tone: blank ? 'bad' : 'ok', ...(blank ? { problem: '學校名稱空白，座位表與標籤表頭沒有字' } : {}),
  };
}

/** 一場考試要確認的環境列（學測、分科、會考內容不同，見稿 §四） */
export function envLinesFor(doc: Doc, kind: ExamKind, round?: number): EnvLine[] {
  const raw: EnvLine[] = [
    { ...schedLine(doc, scheduleKeyOf(kind, round)), tone: 'ok' },
    ...classLines(doc, kindDivision(kind), kind),
    schoolLine(doc),
  ];
  return raw;
}

/** 與確認時的快照比對，算出每列燈號與整體狀態 */
export function envReport(doc: Doc, kind: ExamKind, round?: number): EnvReport {
  const snap = doc.settings.env?.rows ?? {};
  const lines = envLinesFor(doc, kind, round).map((l): EnvLine => {
    if (l.tone === 'bad') return l;
    const was = snap[l.key];
    if (!was) return { ...l, tone: 'warn' };
    if (was.sig !== l.sig) return { ...l, tone: 'warn', before: was.text };
    return l;
  });
  const problems = lines.filter((l) => l.tone === 'bad').map((l) => l.problem!);
  const changes: EnvChange[] = lines.filter((l) => l.before !== undefined).map((l) => ({ label: l.label, before: l.before!, after: l.before === l.text ? `${l.text}（內容有變）` : l.text }));
  const never = lines.some((l) => l.tone === 'warn' && l.before === undefined);
  const state: EnvState3 = problems.length ? 'blocked' : never ? 'never' : changes.length ? 'changed' : 'confirmed';
  const tone: EnvTone = state === 'blocked' ? 'bad' : state === 'confirmed' ? 'ok' : 'warn';
  const at = doc.settings.env?.confirmedAt;
  return { lines, state, tone, problems, changes, ...(at ? { confirmedAt: at } : {}) };
}

const withEnv = (doc: Doc, env: EnvState): Doc => ({ ...doc, settings: { ...doc.settings, env } });

/** 「確認使用」：把這場考試用到的列存成快照；有紅燈不可確認 */
export function confirmEnv(doc: Doc, kind: ExamKind, round: number | undefined, now: Date): Doc {
  const rep = envReport(doc, kind, round);
  if (rep.state === 'blocked') return doc;
  const env = doc.settings.env ?? {};
  const rows = { ...(env.rows ?? {}) };
  for (const l of rep.lines) rows[l.key] = { text: l.text, sig: l.sig } satisfies EnvRow;
  const { skipped: _s, ...rest } = env;
  return withEnv(doc, { ...rest, rows, confirmedAt: now.toISOString() });
}

// ───────── 首次使用精靈（G37）

export type WizardStep = 1 | 2 | 3 | 4 | 5;
export const WIZARD_STEPS: { no: WizardStep; name: string; blurb: string }[] = [
  { no: 1, name: '學年度與部別', blurb: '用哪一年、哪個部' },
  { no: 2, name: '班級與學生名單', blurb: '有哪些班、哪些學生' },
  { no: 3, name: '節次與時長', blurb: '每科考多久、順序' },
  { no: 4, name: '教室', blurb: '班級教室與座位' },
  { no: 5, name: '學校表頭與標籤紙張', blurb: '印在紙上的字與尺寸' },
];

export type WizardDivision = 'senior' | 'junior' | 'both';
export const wizardDivision = (doc: Doc): WizardDivision => doc.settings.env?.division ?? 'senior';
export const wizardDivisions = (doc: Doc): Division[] => { const d = wizardDivision(doc); return d === 'both' ? ['senior', 'junior'] : [d]; };
export const wizardYear = (doc: Doc, now: Date): number => doc.settings.env?.year ?? schoolYear(now);
export const wizardSeen = (doc: Doc): number[] => doc.settings.env?.seen ?? [];

/** 這個步驟用到哪幾列快照（總覽完成時存起來） */
export function stepLines(doc: Doc, step: WizardStep): EnvLine[] {
  const divs = wizardDivisions(doc);
  if (step === 2) return divs.flatMap((d) => classLines(doc, d).slice(0, 1));
  if (step === 3) return SCHEDULE_KEYS.map((x) => ({ ...schedLine(doc, x.key), tone: 'ok' as EnvTone }));
  if (step === 4) return divs.flatMap((d) => classLines(doc, d).slice(1));
  if (step === 5) return [schoolLine(doc)];
  return [];
}

/** 這步現在能不能「確認」：缺名單、座位不足、學校名稱空白是紅燈。步驟 2 沒名單改走「稍後匯入」 */
export const stepProblems = (doc: Doc, step: WizardStep): string[] => stepLines(doc, step).filter((l) => l.tone === 'bad').map((l) => l.problem!);

export type StepMark = 'done' | 'default' | 'todo' | 'later';
/** 總覽用：步驟是「已確認」「用預設（已看過）」「沒看過」或「待補」 */
export function stepMark(doc: Doc, step: WizardStep): StepMark {
  const seen = wizardSeen(doc).includes(step);
  if (!seen) return 'todo';
  if (stepProblems(doc, step).length) return 'later';
  return 'done';
}

export function markSeen(doc: Doc, step: WizardStep): Doc {
  const env = doc.settings.env ?? {};
  const seen = Array.from(new Set([...(env.seen ?? []), step])).sort();
  const { skipped: _s, ...rest } = env;
  return withEnv(doc, { ...rest, seen });
}

export function setWizardChoice(doc: Doc, p: { year?: number; division?: WizardDivision }): Doc {
  return withEnv(doc, { ...(doc.settings.env ?? {}), ...(p.year !== undefined ? { year: p.year } : {}), ...(p.division ? { division: p.division } : {}) });
}

export function skipWizard(doc: Doc): Doc {
  return withEnv(doc, { ...(doc.settings.env ?? {}), skipped: true });
}

/** 步驟 4「確認」：依名單把沒有班級教室的班級補上預設教室（同名沿用，座位配置不動；與 G11 同規則） */
export function ensureClassRooms(doc: Doc, division: Division): Doc {
  const ctx = { classes: doc.settings.classes, exams: doc.exams };
  let rooms = doc.settings.classrooms;
  let n = rooms.length + 1;
  for (const c of doc.settings.classes.filter((x) => x.division === division)) {
    const cnt = studentsOf(doc, division, c.no);
    if (!cnt || rooms.some((r) => r.kind === 'class' && r.name === c.name && roomDivision(r, ctx) === division)) continue;
    while (rooms.some((x) => x.id === `room-${n}`)) n++;
    const g = defaultSeatGrid(cnt);
    rooms = [...rooms, { id: `room-${n}`, name: c.name, kind: 'class', rows: g.rows, depth: g.depth, seatCount: g.rows * g.depth, division, ...(division === 'senior' && c.track ? { track: c.track } : {}) }];
  }
  return rooms === doc.settings.classrooms ? doc : { ...doc, settings: { ...doc.settings, classrooms: rooms } };
}

/** 總覽「完成設定」：看過且沒有紅燈的步驟存成快照（沒看過的不算確認）；全部看過且全綠＝環境已確認 */
export function finishWizard(doc: Doc, now: Date): Doc {
  const env = doc.settings.env ?? {};
  const rows = { ...(env.rows ?? {}) };
  let any = false;
  for (const s of WIZARD_STEPS) {
    if (!wizardSeen(doc).includes(s.no) || stepProblems(doc, s.no).length) continue;
    for (const l of stepLines(doc, s.no)) { rows[l.key] = { text: l.text, sig: l.sig }; any = true; }
  }
  const { skipped: _s, ...rest } = env;
  return withEnv(doc, { ...rest, rows, ...(any ? { confirmedAt: now.toISOString() } : {}) });
}

export const wizardComplete = (doc: Doc): boolean => WIZARD_STEPS.every((s) => stepMark(doc, s.no) === 'done');

/** 列表頁橫幅：none＝不顯示；never＝還沒確認過；skipped＝先略過了精靈；changed＝確認後設定有變動 */
export type BannerKind = 'none' | 'never' | 'skipped' | 'changed';
export function envBanner(doc: Doc): BannerKind {
  const env = doc.settings.env;
  if (!env?.confirmedAt) return env?.skipped ? 'skipped' : 'never';
  // 已確認過：只在「目前設定與確認快照不同」時提示（比對四份節次表與兩個部別中有快照的列）
  const rows = env.rows ?? {};
  const cur = new Map<string, EnvLine>();
  for (const x of SCHEDULE_KEYS) { const l = schedLine(doc, x.key); cur.set(l.key, { ...l, tone: 'ok' }); }
  for (const d of ['senior', 'junior'] as Division[]) for (const l of classLines(doc, d)) cur.set(l.key, l);
  cur.set('school', schoolLine(doc));
  for (const [k, was] of Object.entries(rows)) { const l = cur.get(k); if (l && l.sig !== was.sig) return 'changed'; }
  return 'none';
}
