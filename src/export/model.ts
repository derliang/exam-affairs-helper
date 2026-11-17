/**
 * 輸出的中介版面模型：Word 與 PDF（列印 HTML）共用同一份，確保兩種格式內容一致。
 * 純函式、不碰畫面、不讀檔；輸入是 src/data 型別。
 * 統計（D40）暫由本檔 computeStats 計算；施工B 若提供正式統計，替換此函式即可。
 */
import { subjectShort } from '../core/subjectShort';
import {
  classroomSeats,
  labelNoteLines,
  seatLabel,
  studentCode,
  type ClassInfo,
  type Classroom,
  type ExamConfig,
  type ExamEntry,
  type LabelLayout,
  type LabelPaper,
  type NoteLine,
  type SeatingResult,
  type Settings,
  type Student,
} from '../data';
import { roomStats, specialOf, type RoomStats } from '../core/stats';
import { dayName, examSubjectPeriods, slotName } from '../core/periods';
import { classColor } from './colors';

export interface ExportInput {
  settings: Settings;
  exam: ExamConfig;
  /** 學生名單（姓名來源） */
  students: Student[];
  /** 考試名單（各人考哪些科，統計用） */
  entries: ExamEntry[];
  result: SeatingResult;
  /** 座位表／標籤表頭（共用設定的範本代入本次考試；校-54）。沒給或空白＝用考試名稱（舊行為） */
  seatHeading?: string;
  labelHeading?: string;
}

/** 一個格子上要印的內容 */
export interface CellModel {
  coord: string; // 排－深位
  /** 座位位置（排、深位，從 1 起）：標籤依它排在實際位置，不是依序一格接一格 */
  seat: { row: number; depth: number };
  code: string; // 考生編號
  classLabel: string; // 班級名稱
  name: string;
  colorBg: string;
  colorLine: string;
  colorFg: string;
  /** 個別考試標示（D39/D55）：文字加底色加粗框 */
  tags: { kind: 'absent' | 'extra'; text: string }[];
  /** 同一批標示拆成「小標＋科目」，列印頁把同小標的科目合併成一個標示（例：X 數B、社會） */
  marks: { kind: 'absent' | 'extra' | 'detach'; head: string; subject: string }[];
  /**
   * 預備教室合併標籤（D94-5）：每個座位一張，各節一行、同字級，印「節次＋科目＋班座號」，不印時間與姓名。
   * 有這個欄位的格子只印座標與這幾行。
   */
  periodLines?: { head: string; text: string }[];
  /** 預備教室／綜合教室／整合標籤格（v2.36，#221 #212 #216）：每個坐這格的人一筆，版式同一般教室標籤 */
  persons?: PersonModel[];
  /** 特殊考生單字角標（v2.36，#223）：右下角；取代整格粗框與整句小牌 */
  corners?: CornerTag[];
}
/** 角標：x＝不考（黑底白字）、add＝加考／抽離考試（白底黑框）、take＝「有考」（該科不考超過一半時反標，白底黑框） */
export interface CornerTag { kind: 'x' | 'add' | 'take'; text: string }
/** 坐這格的一個人。sched 每個元素是一行時程，例「第一天 自然、數A」「第1天 時段二 物理」 */
export interface PersonModel { code: string; classLabel: string; name: string; sched: string[]; /** 只列科目的精簡版（與 sched 逐行對應、時間順序）：格子放不下完整寫法時改用 */ schedShort?: string[] }
export interface StatsModel {
  perClass: { className: string; count: number }[];
  total: number;
  perSubject: { subjectName: string; count: number }[];
  /** 統計表（列印頁用，D40）：欄＝班級，列＝本教室考生人數與各科考試人數 */
  table: { classes: string[]; rows: { label: string; per: number[]; total: number }[]; /** 第一欄表頭（預設「項目」；預備教室時段版用「時段」） */ headLabel?: string };
}
export interface SeatPageModel {
  kind: 'seat';
  title: string;
  /** 抽離考試座位表（預備教室）用柔和單色（UI-23） */
  detachStyle: boolean;
  /** 預備教室時段版（稿 v2.28）：格內每行一個時段、不印統計表、頁尾有格內說明 */
  slotMode?: boolean;
  /** 標題拆開（列印頁版面：考試名稱、教室名稱分開放） */
  examName: string;
  /** 表頭（校-54）：有值時列印頁頁首直接印它，不再拆「考試名稱＋座位表」 */
  heading?: string;
  roomName: string;
  /** 合併檔內的分區標示（G34）：預備教室頁頁首標「預備教室」；班級教室沒有 */
  tag?: string;
  /** 頁首小標籤：共幾人、不考／加考各科人數 */
  chips: string[];
  rows: number; // 排數（橫向欄）
  depth: number; // 深位數（縱向列）
  /** key = 排-深位；沒有的是空位或沒排人 */
  cells: Map<string, CellModel>;
  /** 可用座位（空位只在最後，D72） */
  usable: Set<string>;
  stats: StatsModel;
  /** 該科不考人數超過一半時改標「有考」者的說明（頁首小標籤） */
  flipNotes?: string[];
  /** 預備教室時段版：3 人以上輪流的座位，列在座位表下一頁（座位 × 天 × 科目 × 人） */
  rotation?: { heads: string[]; rows: string[][] };
}
export interface LabelPageModel {
  kind: 'label';
  title: string;
  examName: string;
  heading?: string;
  roomName: string;
  /** 合併檔內的分區標示（G34）：預備教室頁頁首標「預備教室」 */
  tag?: string;
  layout: LabelLayout;
  /** 注意事項框的行（設定頁可改）；空陣列＝不印框 */
  notes: NoteLine[];
  /** 該科不考人數超過一半時改標「有考」者的說明 */
  flipNotes?: string[];
  /** 依座位順序；沒人的位置不印格子 */
  cells: CellModel[];
  /** 本張的格子數（D113）：欄＝排、列＝深位，依教室座位表；沒給就用 layout */
  grid?: { cols: number; rows: number };
  /** 教室超出一張標籤紙時自動分張（#210）：本張左下角的座位（排、深位，預設 1、1），與「第 N／共 M 張」 */
  origin?: { row: number; depth: number };
  part?: { n: number; of: number };
}
export interface ListRow {
  subject: string;
  code: string;
  className: string;
  /** 座號（只放座號，不與班級合併；#219） */
  seatNo: string;
  name: string;
  place: string;
  purpose: string;
}
export interface ListPageModel {
  kind: 'list';
  title: string;
  /** 標題下一行（#219：第N天　時段X　科目） */
  subtitle?: string;
  rows: ListRow[];
}
/** 通用表格頁（A4）：領卷清單等共用。widths 為各欄相對寬度；空字串的格子印成空白（供手寫勾選） */
export interface TablePageModel {
  kind: 'table';
  title: string;
  subtitle?: string;
  heads: string[];
  widths: number[];
  rows: string[][];
  /** 合計列（粗體，放最後） */
  totalRow?: string[];
  /** A4 橫式（班級公告，#215） */
  landscape?: boolean;
  /** widths 的單位是字寬（em，含左右留白），不是比例；橫式表會據此縮字級（#259） */
  emWidths?: boolean;
  /** 兩層表頭的上層：每項 {text, span}；span 總和＝欄數時，第一層在 heads 之上 */
  headGroups?: { text: string; span: number }[];
  /** 各格樣式（與 rows 同形）：'exam' 粗體、'study' 灰底；沒給＝一般 */
  cellKinds?: (('exam' | 'study' | undefined)[])[];
  /** 表頭上方一行說明（頁首右側教室牌改放在 title 之後） */
  legend?: string;
}
export type PageModel = SeatPageModel | LabelPageModel | ListPageModel | TablePageModel;

/** 頁尾（D66）：台北時間產生時間＋資料版本碼 */
export function footerText(generatedAt: string, dataVersion: string): string {
  const parts = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .formatToParts(new Date(generatedAt))
    .reduce<Record<string, string>>((a, x) => {
      a[x.type] = x.value;
      return a;
    }, {});
  return `產生時間：${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}（台北）　資料版本碼：${dataVersion}`;
}

/** 紙張尺寸（mm）。座位表與名單固定 A4；標籤 B4 250×353、A3 297×420（DESIGN §六） */
export const PAPER_MM: Record<LabelPaper | 'A4', { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  B4: { w: 250, h: 353 },
  A3: { w: 297, h: 420 },
};
export const mmToTwip = (mm: number): number => Math.round((mm * 1440) / 25.4);

/** 標籤格數（D113 取代 D74／D107）：B4、A3 都是 7×7；每格＝紙寬÷7、紙高÷7。一般標籤 7 欄，整合標籤（分科）每張佔 2 欄、一頁橫向最多 3 張 */
export const LABEL_GRID_MAX = 7;
export function defaultLabelLayout(paper: LabelPaper): LabelLayout {
  return { paper, cols: LABEL_GRID_MAX, rows: LABEL_GRID_MAX };
}

/** 分科整合標籤（D113）：每張標籤 2 格寬（紙寬÷7×2），一頁橫向 3 張（佔 6 格）、縱向 7 張 */
export function wideLabelLayout(paper: LabelPaper): LabelLayout {
  return { paper, cols: 6, rows: LABEL_GRID_MAX, wide: true };
}

/** 預備教室標籤最多 7 排×8 深位（G30）：8 列時格高＝（紙高－標題頁尾）÷8，同一頁放下 */
export const RESERVE_DEPTH_MAX = 8;
export const PREP_TAG = '預備教室';

/** 標籤格尺寸（D113）：寬＝紙寬÷7，高＝紙高÷7（8 列時÷8）。標題與頁尾要佔約 22mm，滿 7 列的頁面格高只好扣掉這段（待列印實測） */
export const LABEL_PAGE_FIXED_MM = 22;
export function labelCellMm(layout: LabelLayout, gridRows = LABEL_GRID_MAX): { w: number; h: number } {
  const p = PAPER_MM[layout.paper];
  return { w: p.w / LABEL_GRID_MAX, h: gridRows >= LABEL_GRID_MAX ? (p.h - LABEL_PAGE_FIXED_MM) / gridRows : p.h / LABEL_GRID_MAX };
}

interface Ctx {
  students: Map<string, Student>;
  classes: Map<number, ClassInfo>;
  subjectName: Map<string, string>;
  entries: Map<string, ExamEntry>;
  input: ExportInput;
}
const parseCode = (code: string) => ({ classNo: Number(code.slice(0, 2)), seatNo: Number(code.slice(2)) });

function ctxOf(input: ExportInput): Ctx {
  return {
    students: new Map(input.students.map((s) => [studentCode(s.classNo, s.seatNo), s])),
    classes: new Map(input.settings.classes.map((c) => [c.no, c])),
    subjectName: new Map(input.exam.subjects.map((s) => [s.id, s.name])),
    entries: new Map(input.entries.map((e) => [studentCode(e.classNo, e.seatNo), e])),
    input,
  };
}

function makeCell(code: string, seat: { row: number; depth: number }, ctx: Ctx): CellModel {
  const st = ctx.students.get(code);
  const classNo = Number(code.slice(0, 2));
  const cls = ctx.classes.get(classNo);
  const col = classColor(cls?.colorIndex ?? classNo);
  const tags = ctx.input.result.marks
    .filter((m) => m.code === code)
    .map((m) => ({
      kind: m.mode,
      text: `${m.mode === 'absent' ? 'X 不考' : '＋ 加考'}${ctx.subjectName.get(m.subjectId) ?? ''}`,
    }));
  return {
    coord: seatLabel(seat),
    seat: { row: seat.row, depth: seat.depth },
    code,
    classLabel: cls?.name ?? String(classNo),
    // 學生名單查無此人時退用考試名單的姓名，避免印出空白格（資料來源不同步的保險）
    name: st?.name ?? ctx.entries.get(code)?.name ?? '',
    colorBg: col.bg,
    colorLine: col.line,
    colorFg: col.fg,
    tags,
    marks: ctx.input.result.marks
      .filter((m) => m.code === code)
      .map((m) => ({ kind: m.mode, head: m.mode === 'absent' ? 'X' : '＋', subject: subjectShort(ctx.subjectName.get(m.subjectId) ?? '') })),
  };
}

function usableOf(c: Classroom): Set<string> {
  return new Set(classroomSeats(c).map((s) => `${s.row}-${s.depth}`));
}

function fromRoomStats(rs: RoomStats, ctx: Ctx): StatsModel {
  return {
    total: rs.total,
    perClass: rs.perClass.map((c) => ({ className: ctx.classes.get(c.classNo)?.name ?? String(c.classNo), count: c.count })),
    perSubject: rs.perSubject.map((c) => ({ subjectName: ctx.subjectName.get(c.subjectId) ?? c.subjectId, count: c.inRoom })),
    table: (() => {
      const nos = rs.perClass.map((c) => c.classNo);
      const pick = (l: { classNo: number; count: number }[]) => nos.map((n) => l.find((x) => x.classNo === n)?.count ?? 0);
      return {
        classes: nos.map((n) => ctx.classes.get(n)?.name ?? String(n)),
        rows: [
          { label: '本教室考生人數', per: pick(rs.perClass), total: rs.total },
          ...rs.perSubject.map((s) => ({ label: ctx.subjectName.get(s.subjectId) ?? s.subjectId, per: pick(s.inRoomPerClass), total: s.inRoom })),
        ],
      };
    })(),
  };
}

/** 頁首小標籤：共幾人、各科不考、各科加考的人數（依考試科目順序） */
function chipsOf(total: number, cells: Iterable<CellModel>, subjects: { name: string }[]): string[] {
  const n = { absent: new Map<string, number>(), extra: new Map<string, number>() };
  for (const c of cells) for (const m of c.marks) if (m.kind !== 'detach') n[m.kind].set(m.subject, (n[m.kind].get(m.subject) ?? 0) + 1);
  const order = subjects.map((s) => s.name);
  const list = (k: 'absent' | 'extra', head: string) =>
    [...n[k].entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([s, c]) => `${head}${s} ${c} 人`);
  return [`共 ${total} 人`, ...list('absent', '不考'), ...list('extra', '加考')];
}


/** 角標用的單字：社會→社、英聽→英；數A／數甲這類（單字加一碼英文或甲乙丙）保留全寫，才分得出 */
export function abbrevSubject(s: string): string {
  const t = s.trim();
  if (/^[\u4e00-\u9fff][A-Za-z甲乙丙]$/.test(t)) return t;
  return t.charAt(0);
}

/**
 * 特殊考生角標（#223，使用者裁示方案 C）：不考＝「社」、加考＝「＋數」、多科連寫；
 * 某科不考人數超過該頁（有考生的格子）一半時，改標「有考」的人（「考社」），不標不考的人。
 * 直接寫進格子的 corners，回傳要印在頁首的說明（每個反標的科目一句）。
 */
export function applyCorners(cells: CellModel[], subjectOrder: readonly string[] = []): string[] {
  const real = cells.filter((c) => c.code);
  const absent = new Map<string, number>();
  for (const c of real) for (const m of c.marks) if (m.kind === 'absent') absent.set(m.subject, (absent.get(m.subject) ?? 0) + 1);
  const flipped = [...absent].filter(([, n]) => n * 2 > real.length).map(([s]) => s);
  const rank = (s: string) => { const i = subjectOrder.findIndex((x) => subjectShortEq(x, s)); return i < 0 ? 99 : i; };
  flipped.sort((a, b) => rank(a) - rank(b));
  for (const c of real) {
    const tags: CornerTag[] = [];
    const xs = c.marks.filter((m) => m.kind === 'absent' && !flipped.includes(m.subject)).map((m) => abbrevSubject(m.subject));
    if (xs.length) tags.push({ kind: 'x', text: xs.join('') });
    const adds = c.marks.filter((m) => m.kind !== 'absent').map((m) => abbrevSubject(m.subject));
    if (adds.length) tags.push({ kind: 'add', text: `＋${adds.join('')}` });
    const takes = flipped.filter((s) => !c.marks.some((m) => m.kind === 'absent' && m.subject === s)).map(abbrevSubject);
    if (takes.length) tags.push({ kind: 'take', text: `考${takes.join('')}` });
    c.corners = tags;
  }
  return flipped.map((s) => `本頁多數不考${s}，只標有考者`);
}
const subjectShortEq = (full: string, short: string): boolean => subjectShort(full) === short || full === short;

/** 格子有特殊標示（淡黃底用）：有角標的格子 */
export const isSpecial = (c: CellModel): boolean => (c.corners?.length ?? 0) > 0;

/** 人員格的一行：runs 依序畫，pt 為字級 */
export interface PersonLine { runs: { text: string; bold?: boolean }[]; pt: number; gapBefore: number; /** 估計折成幾行（預設 1）；高度已含折行 */ n?: number; /** 優先保字級的行（#212：兩人格的「班級｜姓名」） */ pri?: boolean }

/**
 * 預備教室／綜合教室／整合標籤的格內排法（v2.36）：1 人＝大字編號＋「班級｜姓名」＋時程行；
 * 2 人輪流＝每人一區；3 人以上＝只印座位，其餘列在座位表下一頁。字級在格子放得下的前提下取最大，
 * 放不下整體等比縮小（最小 6pt）。回傳每行與整塊的總高（mm），呼叫端據此垂直置中。
 */
export function personLayout(
  c: CellModel,
  w: number,
  h: number,
  o: { topPad: number; codePt: number; nameMax: number; schedMax: number; /** 整合標籤（#216）：單人多行時科目行優先放大到這個字級上限 */ schedBig?: number; /** 座位表格（窄格）：單人多時段放不下時科目併一行（#212）；標籤格不用 */ joinSched?: boolean },
): { lines: PersonLine[]; total: number } {
  const ps = c.persons ?? [];
  const PT = 0.3528;
  const fitW = (text: string, bold: boolean, max: number): number => Math.max(6, Math.min(max, Math.floor((w / Math.max(0.5, textWidthMm(text, 1, bold) / PT) / PT) * 2) / 2));
  let lines: PersonLine[] = [];
  if (ps.length >= 3) {
    lines = [
      { runs: [{ text: c.coord, bold: true }], pt: Math.min(o.codePt * 0.8, fitW(c.coord, true, o.codePt * 0.8)), gapBefore: 0 },
      { runs: [{ text: `共 ${ps.length} 人輪流` }], pt: fitW(`共 ${ps.length} 人輪流`, false, o.nameMax), gapBefore: 1.5 },
      { runs: [{ text: '見座位表下一頁' }], pt: fitW('見座位表下一頁', false, o.nameMax), gapBefore: 0.5 },
    ];
  } else if (ps.length === 2) {
    // 兩人格（#212 #220）：先排「編號＋班級姓名＋時程行」的完整版；高度放不下（深位多、格子矮）時改精簡版——
    // 拿掉編號行（班級與姓名已足夠辨識），每人的科目併成一行「科目、科目」（依時間順序），把空間留給字級，
    // 不再讓姓名縮到 4～5pt。字級仍受格寬限制，所以格寬決定姓名上限。
    const PTH = PT * 1.15;
    const natural = ps.reduce((a, p, i) => a + o.codePt * 0.5 * PTH + o.nameMax * 1.15 * PTH + p.sched.length * Math.min(o.schedMax, 7) * PTH + (i ? 1.5 : 0), 0);
    // 完整寫法的時程行在窄格（約 24mm）寫「第二天 時段二 公民與社會」只剩 5～6pt：連高度夠的時候也改精簡版，科目字才有約 7pt（#212）
    const longest = ps.flatMap((q) => q.sched).reduce((a, t) => (t.length > a.length ? t : a), '');
    const compact = !!o.joinSched && (natural > h - o.topPad - 1 || (longest && fitW(longest, true, o.schedMax) < o.schedMax)) && ps.every((q) => q.schedShort?.length === q.sched.length);
    ps.forEach((p, i) => {
      if (!compact) lines.push({ runs: [{ text: p.code, bold: true }], pt: fitW(p.code, true, o.codePt * 0.5), gapBefore: i === 0 ? 0 : 1.5 });
      lines.push({ runs: [{ text: p.classLabel, bold: true }, { text: ' | ' }, { text: p.name }], pt: namePtFit(p.classLabel, p.name, w, o.nameMax * 1.15), gapBefore: compact ? (i === 0 ? 0 : 1.2) : 0.2, pri: true });
      for (const s of compact ? [p.schedShort!.join('、')] : p.sched) lines.push({ runs: [{ text: s, bold: true }], pt: fitW(s, true, o.schedMax), gapBefore: 0.3 });
    });
  } else if (ps.length === 1) {
    const p = ps[0]!;
    const npt = namePtFit(p.classLabel, p.name, w, o.nameMax);
    if (o.schedBig && p.sched.length >= 2) {
      // #216：科目行優先。編號與姓名先縮到下限（16pt／9pt），剩下的高度給科目行；完整寫法放大後不到 10.5pt 就只列科目，再把編號姓名放回去
      const PTH = PT * 1.15;
      const availH = h - o.topPad - 1;
      const codeMin = Math.min(o.codePt, 16);
      const nameMin = Math.min(npt, 9);
      const fit = (txts: string[]): number => {
        const byH = (availH - (1.5 + txts.length) - (codeMin + nameMin) * PTH) / (txts.length * PTH);
        const byW = Math.min(...txts.map((t) => fitW(t, true, o.schedBig!))) * 0.95;
        return Math.max(4, Math.floor(Math.min(byH, byW, o.schedBig!) * 2) / 2);
      };
      const short = p.schedShort && p.schedShort.length === p.sched.length ? p.schedShort : undefined;
      const txts = short && fit(p.sched) < 10.5 ? short : p.sched;
      const spt = fit(txts);
      const rem = availH - (1.5 + txts.length) - txts.length * spt * PTH;
      const kCN = Math.min(1, Math.max(0, rem / ((o.codePt + npt) * PTH)));
      lines.push({ runs: [{ text: p.code, bold: true }], pt: Math.max(codeMin, Math.floor(o.codePt * kCN * 2) / 2), gapBefore: 0 });
      lines.push({ runs: [{ text: p.classLabel, bold: true }, { text: ' | ' }, { text: p.name }], pt: Math.max(nameMin, Math.floor(npt * kCN * 2) / 2), gapBefore: 1.5 });
      for (const s of txts) lines.push({ runs: [{ text: s, bold: true }], pt: spt, gapBefore: 1 });
    } else {
      // 單人多時段（#212）：每行一個時段放得下就照寫；放不下（編號、姓名被擠到 4～5pt）就科目併成一行「科目、科目」（依時間順序），把高度留給編號與姓名
      const PTH1 = PT * 1.15;
      const nat = o.codePt * PTH1 + npt * PTH1 + 1.5 + p.sched.reduce((a, t) => a + fitW(t, true, o.schedMax) * PTH1 + 1, 0);
      const join = !!o.joinSched && p.sched.length >= 2 && p.schedShort?.length === p.sched.length && nat > h - o.topPad - 1;
      lines.push({ runs: [{ text: p.code, bold: true }], pt: o.codePt, gapBefore: 0 });
      lines.push({ runs: [{ text: p.classLabel, bold: true }, { text: ' | ' }, { text: p.name }], pt: npt, gapBefore: 1.5 });
      for (const s of join ? [p.schedShort!.join('、')] : p.sched) lines.push({ runs: [{ text: s, bold: true }], pt: fitW(s, true, o.schedMax), gapBefore: 1 });
    }
  }
  const hOf = (pri: boolean, f: (pt: number) => number) => lines.filter((l) => !!l.pri === pri).reduce((a, l) => a + f(l.pt) * PT * 1.15, 0);
  const dims = () => ({ hN: hOf(true, (pt) => pt), hO: hOf(false, (pt) => pt), avail2: avail - lines.reduce((x, l) => x + l.gapBefore, 0) });
  // 兩人格：編號與時程行縮到 6pt 後，姓名還能保留的比例（低於 0.8 就退回整體等比縮）
  const twoPersonKN = (): number => { const d = dims(); return Math.min(1, (d.avail2 - hOf(false, (pt) => Math.min(pt, 6))) / Math.max(1, d.hN)); };
  const height = (ls: PersonLine[], k: number) => ls.reduce((a, l) => a + l.pt * k * PT * 1.15 + l.gapBefore, 0);
  const avail = h - o.topPad - 1;
  // 行間留白是固定值，不跟著縮：只讓字高部分縮到放得進去
  const gaps = lines.reduce((x, l) => x + l.gapBefore, 0);
  const k = Math.min(1, Math.max(0.2, (avail - gaps) / Math.max(1, height(lines, 1) - gaps)));
  const kN = ps.length === 2 && k < 1 ? twoPersonKN() : 1;
  if (k < 1 && ps.length === 2 && kN >= 0.8) {
    // #212：兩人格放不下時，先縮編號與時程行（最小 6pt），把空間留給「班級｜姓名」；仍放不下才一起縮
    const { hN, hO, avail2 } = dims();
    const kO = Math.min(1, Math.max(0.2, (avail2 - hN * kN) / Math.max(1, hO)));
    lines = lines.map((l) => ({ ...l, pt: Math.max(6, Math.floor(l.pt * (l.pri ? kN : kO) * 2) / 2) }));
  } else if (k < 1) lines = lines.map((l) => ({ ...l, pt: Math.max(6, Math.floor(l.pt * k * 2) / 2) }));
  // #220：6pt 下限加固定行距、加上長科目名折行（例「第三天 時段二 公民與社會」在窄格折成兩行）後，
  // 整塊仍可能比格子高，最後一行就被列高切掉一半。這裡估計每行折成幾行，放不下就連下限與行距一起再等比縮（4pt 為底），重複到放得進為止
  const txt = (l: PersonLine): string => l.runs.map((x) => x.text).join('');
  const hN = (ls: PersonLine[]): number => ls.reduce((a, l) => a + l.pt * (l.n ?? 1) * PT * 1.15 + l.gapBefore, 0);
  let total = 0;
  for (let it = 0; it < 5; it++) {
    lines = lines.map((l) => ({ ...l, n: Math.max(1, Math.ceil(textWidthMm(txt(l), l.pt, true) / (w * 0.97))) }));
    total = hN(lines);
    if (total <= avail + 0.05) break;
    const f = Math.max(0.3, avail / total);
    lines = lines.map((l) => ({ ...l, pt: Math.max(4, Math.floor(l.pt * f * 2) / 2), gapBefore: l.gapBefore * f }));
  }
  return { lines, total };
}

/**
 * 3 人以上輪流的整合標籤（#216，D108）：學生要看得到自己坐哪、哪個時段，所以每人一區「班級｜姓名」加科目（依時間順序，只列科目名），
 * 分左右兩半各排一欄，字級依空間放大或縮小（4～14pt，放不下才縮到 5pt 為底）。
 */
function multiPersonCols(ps: PersonModel[], coord: string, wHalf: number, h: number, topPad: number): { left: PersonLine[]; right: PersonLine[]; pt: number } {
  const PT = 0.3528;
  const LH = PT * 1.15;
  const w = wHalf * 0.94;
  const half = Math.ceil(ps.length / 2);
  const groups = [ps.slice(0, half), ps.slice(half)];
  const headPt = 11;
  const avail = h - topPad - 1 - headPt * LH - 0.8;
  const subjLines = (p: PersonModel, pt: number): string[] => {
    const items = p.schedShort && p.schedShort.length ? p.schedShort : p.sched;
    const out: string[] = [];
    for (const t of items) {
      const last = out[out.length - 1];
      if (last !== undefined && textWidthMm(last + '、' + t, pt, true) <= w) out[out.length - 1] = last + '、' + t;
      else out.push(t);
    }
    return out;
  };
  const heightAt = (pt: number): number =>
    Math.max(...groups.map((g) => g.reduce((a, p) => a + pt * LH + subjLines(p, pt * 0.9).length * pt * 0.9 * LH + 0.9, 0)));
  let pt = 14;
  while (pt > 5 && heightAt(pt) > avail) pt -= 0.5;
  // 姓名行寬度：最長的「班級｜姓名」也要放得下
  const nameW = (p: PersonModel, x: number) => textWidthMm(p.classLabel, x, true) + textWidthMm(' | ' + p.name, x);
  while (pt > 5 && ps.some((p) => nameW(p, pt) > w)) pt -= 0.5;
  const col = (g: PersonModel[]): PersonLine[] =>
    g.flatMap((p, i): PersonLine[] => [
      { runs: [{ text: p.classLabel, bold: true }, { text: ' | ' }, { text: p.name }], pt, gapBefore: i === 0 ? 0.8 : 0.9, pri: true },
      ...subjLines(p, pt * 0.9).map((t) => ({ runs: [{ text: t, bold: true }], pt: pt * 0.9, gapBefore: 0 })),
    ]);
  const head: PersonLine = { runs: [{ text: `座位 ${coord}`, bold: true }], pt: headPt, gapBefore: 0 };
  return { left: [head, ...col(groups[0]!)], right: col(groups[1]!), pt };
}

/**
 * 分科整合標籤兩倍寬的格內排法（稿 v2.37／D107）。wHalf＝半張（一個實體格）可用寬、h＝格高（mm）：
 * 單人：左半＝編號＋「班級｜姓名」，右半＝科目行（完整寫法放大後不到 10.5pt 就只列科目；≥5 科兩科一行）；
 * 2 人輪流：左右各一人，各自套 personLayout 單人排法；3 人以上：每人一區「班級｜姓名」加科目，分左右兩欄（multiPersonCols，D108）。
 */
export function wideLayout(
  c: CellModel,
  wHalf: number,
  h: number,
  o: { topPad: number; codePt: number; nameMax: number; subjMax: number },
): { left: PersonLine[]; right: PersonLine[] } {
  const ps = c.persons ?? [];
  const base = { topPad: o.topPad, codePt: o.codePt, nameMax: o.nameMax, schedMax: 11, schedBig: o.subjMax };
  if (ps.length >= 3) { const m = multiPersonCols(ps, c.coord, wHalf, h, o.topPad); return { left: m.left, right: m.right }; }
  if (ps.length === 2) {
    // 兩人字級一致（編號 20pt、姓名 14pt 上限），不讓只考一科的人編號特別大
    const b2 = { ...base, codePt: Math.min(o.codePt, 20), nameMax: Math.min(o.nameMax, 14) };
    return {
      left: personLayout({ ...c, persons: [ps[0]!] }, wHalf, h, b2).lines,
      right: personLayout({ ...c, persons: [ps[1]!] }, wHalf, h, b2).lines,
    };
  }
  const p = ps[0];
  if (!p) return { left: [], right: [] };
  const PT = 0.3528;
  const PTH = PT * 1.15;
  const availH = h - o.topPad - 1;
  const w = wHalf * 0.94;
  const bold = (t: string) => textWidthMm(t, 1, true);
  const subjPt = (txts: string[]): number => {
    const byH = (availH - txts.length * 0.8) / (txts.length * PTH);
    const byW = Math.min(...txts.map((t) => w / Math.max(0.2, bold(t))));
    return Math.max(4, Math.floor(Math.min(byH, byW, o.subjMax) * 2) / 2);
  };
  const short = p.schedShort && p.schedShort.length === p.sched.length ? p.schedShort : undefined;
  let txts = short && subjPt(p.sched) < 10.5 ? short : p.sched;
  if (txts === short && txts.length >= 5) txts = txts.reduce<string[]>((a, t, i) => (i % 2 ? (a[a.length - 1] += '　' + t, a) : [...a, t]), []);
  const spt = subjPt(txts);
  const right: PersonLine[] = txts.map((t, i) => ({ runs: [{ text: t, bold: true }], pt: spt, gapBefore: i ? 0.8 : 0 }));
  const fitCode = Math.max(6, Math.min(o.codePt, Math.floor((w / Math.max(0.2, bold(p.code))) * 2) / 2));
  const left: PersonLine[] = [
    { runs: [{ text: p.code, bold: true }], pt: fitCode, gapBefore: 0 },
    { runs: [{ text: p.classLabel, bold: true }, { text: ' | ' }, { text: p.name }], pt: namePtFit(p.classLabel, p.name, wHalf, o.nameMax), gapBefore: 1.5 },
  ];
  return { left, right };
}

export const SLOT_TIP = '格內每個人一區：班級座號、姓名、第幾天考什麼科目；3 人以上輪流的座位列在座位表下一頁。抽離自習不排座位，只出名單。';

/** 一個座位上的人（依最早的時段排序）：同一人各天的科目合併成「第一天 自然、數A」 */
function personsOf(cell: MergedCell, ctx: ReturnType<typeof ctxOf>): PersonModel[] {
  const byCode = new Map<string, MergedLine[]>();
  for (const l of [...cell.lines].sort((a, b) => a.period - b.period)) byCode.set(l.code, [...(byCode.get(l.code) ?? []), l]);
  return [...byCode].map(([code, ls]) => {
    const p = parseCode(code);
    const days = new Map<number | undefined, string[]>();
    for (const l of ls) { const subs = days.get(l.day) ?? []; if (!subs.includes(l.subject)) subs.push(l.subject); days.set(l.day, subs); }
    return {
      code,
      classLabel: ctx.classes.get(p.classNo)?.name ?? String(p.classNo),
      name: ctx.students.get(code)?.name ?? ctx.entries.get(code)?.name ?? '',
      sched: [...days].map(([d, subs]) => (d === undefined ? subs.join('、') : `${dayName(d)} ${subs.join('、')}`)),
      // 只列科目的精簡寫法（與 sched 逐行對應）：窄格放不下完整寫法時改用（#212）
      schedShort: [...days].map(([, subs]) => subs.join('、')),
    };
  });
}

/** 預備教室時段版的下方統計（#220）：每個時段一列（各班人數＋合計），最後一列「不重複人數」 */
function slotStats(seats: Map<string, MergedCell>, ctx: ReturnType<typeof ctxOf>): StatsModel['table'] {
  const classNos = new Set<number>();
  const byHead = new Map<string, { subjects: Set<string>; codes: Set<string> }>();
  const all = new Set<string>();
  for (const m of seats.values()) {
    for (const l of m.lines) {
      classNos.add(parseCode(l.code).classNo);
      all.add(l.code);
      const e = byHead.get(l.head) ?? { subjects: new Set<string>(), codes: new Set<string>() };
      e.subjects.add(l.subject); e.codes.add(l.code); byHead.set(l.head, e);
    }
  }
  const nos = [...classNos].sort((a, b) => a - b);
  const per = (codes: Iterable<string>) => { const arr = [...codes]; return nos.map((n) => arr.filter((c) => parseCode(c).classNo === n).length); };
  return {
    headLabel: '時段',
    classes: nos.map((n) => ctx.classes.get(n)?.name ?? String(n)),
    rows: [
      ...[...byHead].map(([h, e]) => ({ label: `${h ? `${h}　` : ''}${[...e.subjects].join('、')}`, per: per(e.codes), total: e.codes.size })),
      { label: '不重複人數', per: per(all), total: all.size },
    ],
  };
}

/** 3 人以上輪流的座位，列在座位表下一頁（座位 × 天 × 科目 × 人） */
function rotationRows(seats: Map<string, MergedCell>, ctx: ReturnType<typeof ctxOf>): { heads: string[]; rows: string[][] } | undefined {
  const rows: string[][] = [];
  for (const m of [...seats.values()].sort((a, b) => a.seat.row - b.seat.row || a.seat.depth - b.seat.depth)) {
    const ps = personsOf(m, ctx);
    if (ps.length < 3) continue;
    for (const p of ps) for (const s of p.sched) rows.push([seatLabel(m.seat), s, p.classLabel, String(parseCode(p.code).seatNo).padStart(2, '0'), p.name]);
  }
  return rows.length ? { heads: ['座位', '天與科目', '班級', '座號', '姓名'], rows } : undefined;
}
type MergedLine = { period: number; head: string; text: string; code: string; day: number | undefined; subject: string };
type MergedCell = { seat: { row: number; depth: number }; lines: MergedLine[] };
/** 預備教室「時段版」合併（D94-5、稿 v2.28）：每間預備教室、每個座位，各時段一行（天・時段／科目 班座號）；只含抽離考試 */
function reserveMerged(input: ExportInput, ctx: ReturnType<typeof ctxOf>): Map<string, Map<string, MergedCell>> {
  const periods = examSubjectPeriods(input.exam, input.settings);
  const byRoom = new Map<string, Map<string, MergedCell>>();
  for (const d of input.result.detaches) {
    if (d.purpose !== 'exam' || !d.seat) continue;
    const seats = byRoom.get(d.roomId) ?? new Map<string, MergedCell>();
    byRoom.set(d.roomId, seats);
    const k = seatLabel(d.seat);
    const cell: MergedCell = seats.get(k) ?? { seat: d.seat, lines: [] };
    seats.set(k, cell);
    const p = parseCode(d.code);
    const who = `${ctx.classes.get(p.classNo)?.name ?? p.classNo} ${String(p.seatNo).padStart(2, '0')}`;
    for (const sp of periods.get(d.subjectId) ?? [{ period: 0, label: ctx.subjectName.get(d.subjectId) ?? d.subjectId }]) {
      if (cell.lines.some((l) => l.period === sp.period && l.text.endsWith(who))) continue;
      cell.lines.push({ period: sp.period, head: sp.slot ? `${dayName(sp.day ?? 0)} ${slotName(sp.slot)}` : '', text: `${sp.label}　${who}`, code: d.code, day: sp.slot ? (sp.day ?? 0) : undefined, subject: sp.label });
    }
  }
  return byRoom;
}

/** 座位表：每間班級教室一頁；每間預備教室一頁（時段版，稿 v2.28：格內每行一個時段） */
export type Scope = 'all' | 'class' | 'reserve';

export function buildSeatPages(input: ExportInput, scope: Scope = 'all'): SeatPageModel[] {
  const ctx = ctxOf(input);
  const rooms = new Map(input.settings.classrooms.map((c) => [c.id, c]));
  const pages: SeatPageModel[] = [];
  for (const id of scope === 'reserve' ? [] : input.exam.classroomIds) {
    const room = rooms.get(id);
    if (!room) continue;
    const mine = input.result.assignments.filter((a) => a.classroomId === id);
    if (mine.length === 0 && room.kind === 'reserve') continue;
    const cells = new Map<string, CellModel>();
    for (const a of mine) cells.set(`${a.row}-${a.depth}`, makeCell(a.code, a, ctx));
    pages.push({
      kind: 'seat',
      title: `${input.exam.name}　${room.name}　座位表`,
      examName: input.exam.name,
      ...(input.seatHeading?.trim() ? { heading: input.seatHeading.trim() } : {}),
      roomName: room.name,
      ...(room.kind === 'reserve' ? { tag: PREP_TAG } : {}),
      chips: [],
      detachStyle: false,
      rows: room.rows,
      depth: room.depth,
      cells,
      usable: usableOf(room),
      stats: fromRoomStats(roomStats(id, input.result.assignments, input.entries, input.exam.subjects, input.result.detaches, specialOf(input.result)), ctx),
    });
    const pg = pages[pages.length - 1]!;
    pg.chips = chipsOf(pg.stats.total, cells.values(), input.exam.subjects);
    const notes = applyCorners([...cells.values()], input.exam.subjects.map((s) => s.name));
    if (notes.length) { pg.flipNotes = notes; pg.chips.push(...notes); }
  }
  if (scope !== 'class') {
    // 預備教室座位表（時段版，稿 v2.28）：一間預備教室一頁，格內每行一個時段；抽離自習不排座位
    const byRoom = reserveMerged(input, ctx);
    const order = [...input.exam.classroomIds, ...byRoom.keys()];
    for (const roomId of [...new Set(order)]) {
      const seats = byRoom.get(roomId);
      const room = rooms.get(roomId);
      if (!seats || !room) continue;
      const cells = new Map<string, CellModel>();
      const people = new Set<string>();
      const slots = new Set<string>();
      for (const d of input.result.detaches) if (d.purpose === 'exam' && d.seat && d.roomId === roomId) people.add(d.code);
      for (const m of seats.values()) {
        for (const l of m.lines) if (l.head) slots.add(l.head);
        cells.set(`${m.seat.row}-${m.seat.depth}`, {
          coord: seatLabel(m.seat), seat: { row: m.seat.row, depth: m.seat.depth }, code: '', classLabel: '', name: '',
          colorBg: 'FFFFFF', colorLine: '222222', colorFg: '22201B', tags: [], marks: [],
          periodLines: [...m.lines].sort((x, y) => x.period - y.period).map(({ head, text }) => ({ head, text })),
          persons: personsOf(m, ctx),
        });
      }
      pages.push({
        kind: 'seat',
        title: `${input.exam.name}　${room.name}　座位表（時段版）`,
        examName: input.exam.name,
        ...(input.seatHeading?.trim() ? { heading: input.seatHeading.trim() } : {}),
        roomName: room.name,
        tag: PREP_TAG,
        chips: [`共 ${people.size} 人`, `${slots.size} 個時段`, '抽離考試'],
        detachStyle: false,
        slotMode: true,
        rows: room.rows,
        depth: room.depth,
        cells,
        usable: usableOf(room),
        stats: { perClass: [], total: people.size, perSubject: [], table: slotStats(seats, ctx) },
        ...(() => { const r = rotationRows(seats, ctx); return r ? { rotation: r } : {}; })(),
      });
    }
  }
  return pages;
}

/**
 * 標籤依實際座位位置排（與座位表同一張圖，只是沒有講臺與統計）：欄＝排（左→右），列＝深位（最大深位在上、1 在下，0101 在左下角）。
 * 沒有座位的位置留空白格。超出標籤格數時丟錯，不默默截斷。
 */
/**
 * 教室比一張標籤紙大（#210：排、深位最多 8）時依紙張格數切成多張，每張左下角為 origin；
 * 沒座位的區塊不出張。不超出就只有一張、origin 為 1-1，與舊行為相同。
 */
export function splitLabelTiles<T extends { seat: { row: number; depth: number } }>(cells: T[], layout: { cols: number; rows: number }): { origin: { row: number; depth: number }; cells: T[] }[] {
  const maxRow = Math.max(1, ...cells.map((c) => c.seat.row));
  const maxDepth = Math.max(1, ...cells.map((c) => c.seat.depth));
  const tiles: { origin: { row: number; depth: number }; cells: T[] }[] = [];
  for (let r0 = 1; r0 <= maxRow; r0 += layout.cols) {
    for (let d0 = 1; d0 <= maxDepth; d0 += layout.rows) {
      const mine = cells.filter((c) => c.seat.row >= r0 && c.seat.row < r0 + layout.cols && c.seat.depth >= d0 && c.seat.depth < d0 + layout.rows);
      if (mine.length) tiles.push({ origin: { row: r0, depth: d0 }, cells: mine });
    }
  }
  return tiles;
}

/** 標籤頁格子陣列的大小（以「張」為單位）：有 grid 就用 grid（依座位表的排×深位），否則用 layout */
export function labelGridSize(p: LabelPageModel): { cols: number; rows: number } {
  return p.grid ?? { cols: p.layout.wide ? p.layout.cols / 2 : p.layout.cols, rows: p.layout.rows };
}

/** 標籤頁的格子陣列（由左到右、由上到下，長度 cols×rows）：依座位位置放，沒有人的位置是 undefined */
export function labelGrid(p: LabelPageModel): (CellModel | undefined)[] {
  const { cols, rows } = labelGridSize(p);
  const g: (CellModel | undefined)[] = Array.from({ length: cols * rows }, () => undefined);
  for (const c of p.cells) {
    const col = c.seat.row - (p.origin?.row ?? 1);
    const rowIdx = rows - 1 - (c.seat.depth - (p.origin?.depth ?? 1));
    if (col >= 0 && col < cols && rowIdx >= 0 && rowIdx < rows) g[rowIdx * cols + col] = c;
  }
  return g;
}

/** 教室座位超過 7×7，標籤無法對應（D113）：不輸出該教室的標籤，請使用者縮小 */
export const roomTooBigForLabel = (r: { rows: number; depth: number; kind?: 'class' | 'reserve' }): boolean => r.rows > LABEL_GRID_MAX || r.depth > (r.kind === 'reserve' ? RESERVE_DEPTH_MAX : LABEL_GRID_MAX);

/** 標籤：每間教室一張紙，位置同座位表（見 labelGrid）。超出格數丟錯 */
export function buildLabelPages(input: ExportInput, scope: Scope = 'all'): LabelPageModel[] {
  const ctx = ctxOf(input);
  const layout = input.exam.labelLayout;
  const pages: LabelPageModel[] = [];
  for (const id of scope === 'reserve' ? [] : input.exam.classroomIds) {
    const room = input.settings.classrooms.find((c) => c.id === id);
    if (!room || roomTooBigForLabel(room)) continue;
    const mine = input.result.assignments
      .filter((a) => a.classroomId === id)
      .sort((a, b) => a.row - b.row || a.depth - b.depth);
    if (mine.length === 0) continue;
    const tiles = [{ origin: { row: 1, depth: 1 }, cells: mine.map((a) => ({ seat: { row: a.row, depth: a.depth }, a })) }];
    tiles.forEach((t, i) => {
      const suffix = tiles.length > 1 ? `（第 ${i + 1}／${tiles.length} 張）` : '';
      pages.push({
        kind: 'label',
        title: `${input.exam.name}　${room.name}${suffix}`,
        examName: input.exam.name,
        ...(input.labelHeading?.trim() ? { heading: input.labelHeading.trim() } : {}),
        roomName: room.name + suffix,
        ...(room.kind === 'reserve' ? { tag: PREP_TAG } : {}),
        layout,
        grid: { cols: room.rows, rows: room.depth },
        notes: labelNoteLines(input.settings.labelNotes),
        cells: t.cells.map((x) => makeCell(x.a.code, x.a, ctx)),
      });
    });
    const lp = pages[pages.length - 1]!;
    const lnotes = applyCorners(lp.cells, input.exam.subjects.map((s) => s.name));
    if (lnotes.length) lp.flipNotes = lnotes;
  }
  if (scope !== 'class') {
    // 預備教室合併標籤（D94-5）：每間預備教室一張紙、每個座位一張標籤；同一座位各節的使用者列在同一張，每節一行
    const byRoom = reserveMerged(input, ctx);
    const order = [...input.exam.classroomIds, ...byRoom.keys()];
    for (const roomId of [...new Set(order)]) {
      const seats = byRoom.get(roomId);
      const room = input.settings.classrooms.find((c) => c.id === roomId);
      if (!seats || !room || roomTooBigForLabel(room)) continue;
      const list = [...seats.values()].sort((a, b) => a.seat.row - b.seat.row || a.seat.depth - b.seat.depth);
      const tiles = [{ origin: { row: 1, depth: 1 }, cells: list }];
      tiles.forEach((t, i) => {
      const suffix = tiles.length > 1 ? `（第 ${i + 1}／${tiles.length} 張）` : '';
      pages.push({
        kind: 'label',
        title: `${input.exam.name}　${room.name}　抽離考試${suffix}`,
        examName: input.exam.name,
        ...(input.labelHeading?.trim() ? { heading: input.labelHeading.trim() } : {}),
        roomName: `${room.name}　抽離考試${suffix}`,
        tag: PREP_TAG,
        layout,
        grid: { cols: room.rows, rows: room.depth },
        notes: labelNoteLines(input.settings.labelNotes),
        cells: t.cells.map((x) => ({
          coord: seatLabel(x.seat),
          seat: { row: x.seat.row, depth: x.seat.depth },
          code: '',
          classLabel: '',
          name: '',
          colorBg: 'FFFFFF',
          colorLine: '222222',
          colorFg: '22201B',
          tags: [],
          marks: [],
          periodLines: x.lines.sort((a, b) => a.period - b.period).map(({ head, text }) => ({ head, text })),
          persons: personsOf(x, ctx),
        })),
      });
      });
    }
  }
  return pages;
}

/** 抽離自習名單（D7）：每科一頁，只有名單與人數，不出座位表與標籤 */
export function buildStudyLists(input: ExportInput): ListPageModel[] {
  const ctx = ctxOf(input);
  const bySubject = new Map<string, ListRow[]>();
  const rooms = new Map(input.settings.classrooms.map((c) => [c.id, c]));
  for (const d of input.result.detaches) {
    if (d.purpose !== 'study') continue;
    const rows = bySubject.get(d.subjectId) ?? [];
    rows.push({
      subject: ctx.subjectName.get(d.subjectId) ?? d.subjectId,
      code: d.code,
      className: ctx.classes.get(Number(d.code.slice(0, 2)))?.name ?? '',
      seatNo: String(parseCode(d.code).seatNo).padStart(2, '0'),
      name: ctx.students.get(d.code)?.name ?? '',
      place: rooms.get(d.roomId)?.name ?? d.roomId,
      purpose: '抽離自習',
    });
    bySubject.set(d.subjectId, rows);
  }
  // #219：標題下加「第N天　時段X　科目」（沒有日期欄，不新增）
  const periods = examSubjectPeriods(input.exam, input.settings);
  const whenOf = (subId: string, name: string): string => {
    const heads = [...new Set((periods.get(subId) ?? []).filter((p) => p.slot).map((p) => `${dayName(p.day ?? 0)}　${slotName(p.slot!)}`))];
    return heads.length ? `${heads.join('、')}　${name}` : name;
  };
  return input.exam.subjects
    .filter((sub) => bySubject.has(sub.id))
    .map((sub) => ({
      kind: 'list' as const,
      title: `${input.exam.name}　抽離自習名單（${sub.name}，共 ${bySubject.get(sub.id)!.length} 人）`,
      subtitle: whenOf(sub.id, sub.name),
      rows: bySubject.get(sub.id)!.sort((a, b) => a.code.localeCompare(b.code)),
    }));
}

/** 抽離名單（A4）：抽離考試與抽離自習都列，單人特例列自填地點（D7/D26/D27） */
export function buildDetachList(input: ExportInput): ListPageModel {
  const ctx = ctxOf(input);
  const rooms = new Map(input.settings.classrooms.map((c) => [c.id, c]));
  const rows: ListRow[] = input.result.detaches.map((d) => {
    const room = rooms.get(d.roomId);
    const place = d.purpose === 'exam' && d.seat ? `${room?.name ?? d.roomId} ${seatLabel(d.seat)}` : (room?.name ?? d.roomId);
    return {
      subject: ctx.subjectName.get(d.subjectId) ?? d.subjectId,
      code: d.code,
      className: ctx.classes.get(Number(d.code.slice(0, 2)))?.name ?? '',
      seatNo: String(parseCode(d.code).seatNo).padStart(2, '0'),
      name: ctx.students.get(d.code)?.name ?? ctx.entries.get(d.code)?.name ?? '',
      place,
      purpose: d.purpose === 'exam' ? '抽離考試' : '抽離自習',
    };
  });
  const sps = specialOf(input.result);
  for (const o of input.result.overrides) {
    // 一人一列；各科用途不同時逐科寫明（#66），不讓單一用途蓋掉全部標示科目
    const mine = sps.filter((x) => x.code === o.code);
    const kinds = new Set(mine.map((x) => x.purpose));
    const purpose = kinds.size > 1
      ? mine.map((x) => `${ctx.subjectName.get(x.subjectId) ?? x.subjectId}${x.purpose === 'exam' ? '考試' : '自習'}`).join('、')
      : (mine.length ? mine[0]!.purpose : o.purpose) === 'exam' ? '單人考試' : '單人自習';
    rows.push({
      subject: '（全科）',
      code: o.code,
      className: ctx.classes.get(Number(o.code.slice(0, 2)))?.name ?? '',
      seatNo: String(parseCode(o.code).seatNo).padStart(2, '0'),
      name: ctx.students.get(o.code)?.name ?? ctx.entries.get(o.code)?.name ?? '',
      place: o.location,
      purpose,
    });
  }
  rows.sort((a, b) => a.subject.localeCompare(b.subject, 'zh-TW') || a.code.localeCompare(b.code));
  return { kind: 'list', title: `${input.exam.name}　抽離名單`, rows };
}

/** 輸出前掃描字型字集外的字（D44）。只回傳班級＋座號＋字元，不含姓名，可安全寫 log */
export function findMissingChars(input: ExportInput, has: (ch: string) => boolean): { classNo: number; seatNo: number; ch: string }[] {
  const out: { classNo: number; seatNo: number; ch: string }[] = [];
  for (const s of input.students) for (const ch of new Set(s.name)) if (!has(ch)) out.push({ classNo: s.classNo, seatNo: s.seatNo, ch });
  return out;
}

/* ---------- 座位表與標籤的版面尺寸（列印頁與 Word 共用，照設計系統稿件 #paper） ---------- */

/** 同小標的科目合併成一個標示（例：X 數B、社會），格子才不擠 */
export function groupMarks(c: CellModel): { kind: 'x' | 'add'; text: string }[] {
  const g = new Map<string, { kind: 'x' | 'add'; subs: string[] }>();
  for (const m of c.marks) {
    const e = g.get(m.head) ?? { kind: m.kind === 'absent' ? 'x' : 'add', subs: [] };
    e.subs.push(m.subject);
    g.set(m.head, e);
  }
  return [...g.entries()].map(([h, e]) => ({ kind: e.kind, text: `${h} ${e.subs.join('、')}` }));
}

/** 統計表的列：各科人數與每班完全相同的科目合併成一列（例：考國文、英文） */
export function statRows(p: SeatPageModel): { label: string; per: number[]; total: number }[] {
  if (p.slotMode) return p.stats.table.rows;
  const out: { label: string; per: number[]; total: number; subs: string[] }[] = [];
  const [first, ...rest] = p.stats.table.rows;
  if (first) out.push({ ...first, subs: [] });
  for (const r of rest) {
    const same = out.find((x) => x.subs.length > 0 && x.total === r.total && x.per.join() === r.per.join());
    if (same) same.subs.push(r.label);
    else out.push({ ...r, subs: [r.label] });
  }
  return out.map((x) => ({ label: x.subs.length ? `考${x.subs.join('、')}` : x.label, per: x.per, total: x.total }));
}

export const SEAT_PAGE = { w: 210, h: 297, padX: 15, padY: 12 };

/** 估字寬（mm）：全形 1em、英數約 0.58em、空白 0.28em */
export function textWidthMm(text: string, pt: number, bold = false): number {
  let em = 0;
  for (const ch of text) {
    if (ch === ' ') em += 0.28;
    else if (/[!-~]/.test(ch)) em += /[ij|l.,:;!']/.test(ch) ? 0.3 : 0.58;
    else em += 1;
  }
  return em * pt * 0.3528 * (bold ? 1.02 : 1);
}

/**
 * 格內「班級｜姓名」的字級（pt）：在格寬放得下的前提下取最大（#222、#218）。
 * 班級字粗體、與姓名以細線隔開（約 1.2em 的間隔）；maxPt 是上限（三字姓名才會用到），最小 minPt。
 */
export function namePtFit(classLabel: string, name: string, innerMm: number, maxPt: number, minPt = 7): number {
  const em = textWidthMm(classLabel, 1, true) / 0.3528 + textWidthMm(name, 1) / 0.3528 + 1.4;
  const fit = innerMm / (em * 0.3528);
  return Math.max(minPt, Math.min(maxPt, Math.floor(fit * 2) / 2));
}

/**
 * 座位表下方統計表的版面（#217）：第一欄放得下的字不折行；放不下的折行，列高隨行數撐開，
 * 座位格高度（seatGeometry）扣掉的也是同一個總高，整張表一定在頁面內。Word 與列印頁共用。
 */
export function statLayout(p: SeatPageModel): { cols: number[]; rowH: number[]; pt: number; total: number } {
  const innerW = SEAT_PAGE.w - 2 * SEAT_PAGE.padX;
  const rows = statRows(p);
  const n = p.stats.table.classes.length;
  const pt = 12;
  const totalW = 18;
  const classW = Math.max(12, Math.min(20, (innerW - totalW - 60) / Math.max(1, n)));
  const firstW = innerW - classW * n - totalW;
  const usable = firstW - 4;
  const lines = (label: string) => Math.max(1, Math.ceil(textWidthMm(label, pt, false) / usable));
  const lineH = pt * 0.3528 * 1.3;
  const h = (k: number) => Math.max(8, +(k * lineH + 3.4).toFixed(1));
  const rowH = [h(1), ...rows.map((r) => h(lines(r.label)))];
  return { cols: [firstW, ...Array<number>(n).fill(classW), totalW], rowH, pt, total: rowH.reduce((a, b) => a + b, 0) };
}

/** 座位表的格子尺寸（mm）與統計列。統計表列數隨科目變：先扣掉標題、小標籤、講臺、統計表、頁尾，剩下的才給座位格 */
/** 頁首小標籤列要幾列（#247）：每個標籤 12pt 粗體加內距，超過頁寬就換列 */
export function chipRowCount(chips: readonly string[]): number {
  const innerW = SEAT_PAGE.w - 2 * SEAT_PAGE.padX;
  let rows = 1;
  let used = 0;
  chips.forEach((t) => {
    const w = Math.min(innerW, textWidthMm(t, 12, true) * 1.06 + 7 + 3);
    if (used > 0 && used + 2 + w > innerW) { rows++; used = 0; }
    used += (used > 0 ? 2 : 0) + w;
  });
  return rows;
}

/**
 * 座位格尺寸。時段版（預備／綜合教室）的統計表每時段一列，時段多（例如分科 12 列）就把座位格壓到約 15mm，
 * 兩人格姓名只剩 4～5pt（#212）。座位格會因此低於 22mm 時，統計表改放下一頁（statsNext），座位圖用整頁高度（最高 32mm）。
 */
export function seatGeometry(p: SeatPageModel): { cw: number; ch: number; st: ReturnType<typeof statRows>; statsNext: boolean } {
  const innerW = SEAT_PAGE.w - 2 * SEAT_PAGE.padX;
  const cw = Math.min(p.slotMode ? 24.79 : 25, +((innerW - 6.5) / p.rows).toFixed(2));
  const st = statRows(p);
  const base = 22 + 12 + 4 + 5 + 11 + 16 + (chipRowCount(p.chips) - 1) * 8.7;
  const chOf = (fixed: number) => Math.min(p.slotMode ? 32 : 23, +((SEAT_PAGE.h - 2 * SEAT_PAGE.padY - fixed) / p.depth).toFixed(2));
  // 時段版：統計表（每時段一列）加一行格內說明（約 6mm）
  const withStats = chOf(base + (p.slotMode ? 6 + 5 + statLayout(p).total : 5 + statLayout(p).total));
  if (p.slotMode && withStats < 22) {
    const without = chOf(base + 6 + 5);
    if (without > withStats) return { cw, ch: without, st, statsNext: true };
  }
  return { cw, ch: withStats, st, statsNext: false };
}

/** 標籤格尺寸（D113）：寬＝紙寬÷7、高＝紙高÷7（滿 7 列時扣標題頁尾）；左右不留邊 */
export function labelBoxMm(layout: LabelLayout, gridRows = LABEL_GRID_MAX): { w: number; h: number; padX: number } {
  const c = labelCellMm(layout, gridRows);
  return { w: c.w, h: c.h, padX: 0 };
}

/** 格子下方剩的高度放得下注意事項時回傳字級（pt），放不下回 0（不印）。字級最多 maxPt，縮到不足 8pt 就不印 */
export function labelNotePt(layout: LabelLayout, gridRows: number, noteLines: number, maxPt: number): number {
  if (noteLines === 0) return 0;
  const left = PAPER_MM[layout.paper].h - LABEL_PAGE_FIXED_MM - gridRows * labelBoxMm(layout, gridRows).h - 6;
  const pt = Math.min(maxPt, Math.floor((left - 4) / ((noteLines + 1) * 0.3528 * 1.5)));
  return pt >= 8 ? pt : 0;
}

/** 估字寬（em）：中日韓全形 1、其他 0.55 */
const emWidth = (t: string): number => [...t].reduce((w, ch) => w + (/[\u2E80-\uFFFF]/.test(ch) ? 1 : 0.55), 0);

/**
 * 合併標籤每一行的字級（pt）：同一張標籤所有行同字級（D94-5），依格子高度與最長一行的寬度取能放下的最大值。
 * 節次小標用 0.7 倍字級。cellW、cellH 為格子內可用的寬高（mm）。
 */
export function periodLineFontPt(lines: readonly { head: string; text: string }[], cellW: number, cellH: number): number {
  if (!lines.length) return 12;
  const PT = 0.3528;
  const byH = cellH / lines.length / 1.35 / PT;
  const widest = Math.max(...lines.map((l) => emWidth(l.head) * 0.7 + 0.6 + emWidth(l.text)));
  const byW = cellW / widest / PT;
  return Math.max(6, Math.min(26, Math.floor(Math.min(byH, byW) * 2) / 2));
}

/**
 * 座位格太矮時的縮放比例（#223）：上緣座標、編號、「班級｜姓名」、角標區加起來要放得進格高，
 * 放不下就整體等比縮小（最小 0.5），回傳 k（1＝不用縮）。座位表與列印頁共用同一個算法。
 */
export function fitSeatCell(g: { h: number; topPad: number; codePt: number; markArea: number; bottomPad: number }, namePt: number): { k: number } {
  const need = g.codePt * 0.3528 + namePt * 0.3528 * 1.15 + g.markArea;
  const avail = g.h - g.topPad - g.bottomPad;
  return { k: Math.max(0.5, Math.min(1, avail / need)) };
}

/** 3 人以上輪流的座位清單頁（接在預備教室座位表之後；沒有就 undefined） */
export function rotationPage(p: SeatPageModel): TablePageModel | undefined {
  if (!p.rotation) return undefined;
  return {
    kind: 'table',
    title: `${p.heading ?? p.examName}　${p.roomName}　輪流座位`,
    subtitle: '3 人以上輪流使用的座位（標籤上只印座位）',
    heads: p.rotation.heads,
    widths: [1.2, 2.4, 1.4, 0.9, 1.6],
    rows: p.rotation.rows,
  };
}

/** 橫式公告表的列高與字級：一班一頁，依列數縮放（#215）；45 人也放得進一頁（列高最小 3.4mm、字 6.5pt） */
export function landscapeFit(nRows: number, nHead: number, needEm?: number): { rowMm: number; pt: number } {
  const avail = 210 - 17 - 30; // 橫式 A4 高度扣上下邊界、標題、說明與頁尾
  const rowMm = Math.max(2.8, Math.min(8, avail / (nRows + nHead)));
  let pt = Math.max(6, Math.min(10.5, Math.floor((rowMm / 0.3528 / 1.5) * 2) / 2));
  // 欄寬以字寬（em）給時（#259）：字級再依整頁寬度縮小，確保每格一行放得下
  if (needEm && needEm > 0) pt = Math.max(5.5, Math.min(pt, Math.floor((273 / needEm / 0.3528) * 2) / 2));
  return { rowMm, pt };
}

/** 估字寬（em）：全形 1、半形數字英文約 0.58、空白 0.28；粗體再加寬 */
export function textEm(s: string, bold = false): number {
  let em = 0;
  for (const ch of s) em += ch === ' ' ? 0.28 : /[!-~]/.test(ch) ? (/[ij|l.,:;!']/.test(ch) ? 0.3 : 0.58) : 1;
  return em * (bold ? 1.05 : 1);
}

/** 頁首右上顯示的教室名：預備教室頁在前面加「預備教室」（G34：合併檔內分得出哪幾頁是預備教室；名稱已含該字就不重複） */
export function roomShown(p: { roomName: string; tag?: string }): string {
  return p.tag && !p.roomName.includes(p.tag) ? `${p.tag}　${p.roomName}` : p.roomName;
}
