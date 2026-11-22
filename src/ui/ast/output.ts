/**
 * 分科 ⑥ 輸出（AST-2；DESIGN 10.19、D99 三-7～9、D101）：整合標籤、班級公告、每節教室用途表、
 * 每科試務清冊、自習教室名單與布置標籤工作表。全部從同一份方案（AstPlan）產出頁面模型，
 * 交給既有的 Word／PDF 轉譯（TablePageModel、LabelPageModel）。純函式，不碰畫面。
 * 規則：標籤白底、不印鐘點；班座號＋姓名，名單有匯入「應試編號」才印；座位一律「排－深位」；
 * 考試時段列教室與座位，自習時段只列教室；不排監考人力、不列請假者。
 */
import type { ExamConfig, LabelPaper } from '../../data';
import { subjectShort } from '../../core/subjectShort';
import { dataVersion } from '../../core/version';
import { STUDY_LEGEND, roomTooBigForLabel, seatGeometry, splitLabelTiles, textEm, wideLabelLayout, type LabelPageModel, type TablePageModel, type CellModel, type PersonModel, type SeatPageModel } from '../../export/model';
import { dateTag, dayTag } from '../../export/dayLabel';
import { examEntries } from '../seating';
import type { Doc } from '../store';
import { astSlots, awayStudy, usageCell, type AstPlan, type AstSlot } from './model';
import { codeOf, homeRoomIds } from '../../core/astD99/contract';

export type AstOutputKey = 'label' | 'seat' | 'ann' | 'use' | 'reg' | 'study';

export interface AstOutputItem { key: AstOutputKey; title: string; sub: string }
export const AST_OUTPUT_ITEMS: AstOutputItem[] = [
  { key: 'label', title: '整合標籤（合併標籤）', sub: '每個座位一張、每張兩格寬：左半編號與姓名、右半科目（放不下只列科目）；名單有應試編號才印；考場比一張紙大就分張' },
  { key: 'seat', title: '綜合教室座位表', sub: '每間綜合教室一頁（A4）：座位圖格內每人一區，下方各時段各班人數統計（每時段一列＋不重複人數）；3 人以上輪流的教室改一個時段一張' },
  { key: 'ann', title: '班級公告', sub: 'A4 橫式、一班一頁貼在班上；考試＝粗體座位（教室同本班就省略），自習＝灰底＋教室' },
  { key: 'use', title: '每節教室用途表', sub: '哪間教室哪個時段是考場或自習，附方案指標' },
  { key: 'reg', title: '每科試務清冊', sub: '每科：考場總表，加每間考場一頁簽到名冊' },
  { key: 'study', title: '自習教室名單與布置標籤工作表', sub: '每時段一份自習名單，加一份布置工作表' },
];

export interface AstOutputs {
  label: LabelPageModel[];
  /** 綜合教室座位表（#220）：沒有用綜合教室考試就是空陣列 */
  seat: SeatPageModel[];
  ann: TablePageModel[];
  use: TablePageModel[];
  reg: TablePageModel[];
  study: TablePageModel[];
  /** 版本碼：由方案內容算出，所有檔案頁尾相同 */
  version: string;
}

import { tableModelPages } from '../../export/pageEstimate';
export { TABLE_FIRST_PAGE_ROWS, TABLE_ROWS_PER_PAGE, tablePages } from '../../export/pageEstimate';

const statsNextOf = (p: SeatPageModel): boolean => { try { return seatGeometry(p, { topMm: 2.8 }).statsNext; } catch { return false; } };

/**
 * 某一類輸出實際會印出幾頁（#269）：標籤一張紙一頁；座位表＝每頁一張（3 人以上輪流的教室一個時段一張，D204）；
 * 其他表格 A4 橫式一頁，直式依列數估頁（原本一個表一律算 1 頁，輪流清單 13 頁卻只算 3 頁）
 */
export function estimatePages(o: AstOutputs, k: 'label' | 'seat' | 'ann' | 'use' | 'reg' | 'study'): number {
  const tbl = tableModelPages;
  if (k === 'label') return o.label.length;
  // 座位格被壓太矮時各班人數統計表會換到下一頁（statsNext，D170），要多算一頁（#632）
  if (k === 'seat') return o.seat.reduce((n, p) => n + 1 + (statsNextOf(p) ? 1 : 0), 0);
  return o[k].reduce((n, t) => n + tbl(t), 0);
}

/** 「1天2」＝第 1 天時段二，標籤上的短標 */
export const slotShort = (s: AstSlot): string => `${s.day + 1}天${s.slot}`;

const seatText = (row: number, depth: number): string => `${row}－${depth}`;

interface Ctx {
  doc: Doc;
  exam: ExamConfig;
  plan: AstPlan;
  slots: AstSlot[];
  roomName: Map<string, string>;
  className: (n: number) => string;
  /** #503、D208：班級順序＝共用設定「班級資料」清單順序（可自訂）；不在清單的排最後 */
  rank: (n: number) => number;
  subjectName: Map<string, string>;
  nameOf: Map<string, string>;
  examNoOf: Map<string, string>;
  hasExamNo: boolean;
}

function ctxOf(doc: Doc, exam: ExamConfig, plan: AstPlan): Ctx {
  const slots = astSlots(doc, exam);
  const classes = new Map(doc.settings.classes.filter((c) => c.division === exam.division).map((c) => [c.no, c.name]));
  const order = new Map([...classes.keys()].map((n, i) => [n, i] as const));
  const entries = examEntries(doc, exam);
  const examNoOf = new Map<string, string>();
  for (const e of entries) if (e.examNo) examNoOf.set(codeOf(e), e.examNo);
  return {
    doc, exam, plan, slots,
    roomName: new Map(doc.settings.classrooms.map((r) => [r.id, r.name])),
    className: (n) => classes.get(n) ?? String(n).padStart(2, '0'),
    rank: (n) => order.get(n) ?? Number.MAX_SAFE_INTEGER,
    subjectName: new Map(exam.subjects.map((s) => [s.id, subjectShort(s.name)])),
    nameOf: new Map(plan.input.students.map((s) => [codeOf(s), s.name])),
    examNoOf,
    hasExamNo: examNoOf.size > 0,
  };
}

const rn = (c: Ctx, id: string): string => c.roomName.get(id) ?? id;
const sub = (c: Ctx, id: string): string => c.subjectName.get(id) ?? id;
const slotHead = (c: Ctx, s: AstSlot): string => `${s.label} ${s.subjectIds.map((i) => sub(c, i)).join('、')}`;

// ───── ① 整合標籤 ─────

/** 坐這個座位的人（#216）：各行「第N天 時段X 科目」 */
function personsOfSeat(c: Ctx, list: { slot: number; code: string; subjectId: string }[]): PersonModel[] {
  const byCode = new Map<string, typeof list>();
  for (const x of [...list].sort((a, b) => a.slot - b.slot)) byCode.set(x.code, [...(byCode.get(x.code) ?? []), x]);
  return [...byCode].map(([code, xs]) => ({
    code,
    classLabel: c.className(Number(code.slice(0, 2))),
    name: c.nameOf.get(code) ?? '',
    sched: [...xs.map((x) => `${c.slots[x.slot]!.label} ${sub(c, x.subjectId)}`), ...(c.examNoOf.get(code) ? [`應試 ${c.examNoOf.get(code)}`] : [])],
    // 只列科目的精簡寫法（#220 殘留、#216）：與 sched 逐行對應
    schedShort: [...xs.map((x) => sub(c, x.subjectId)), ...(c.examNoOf.get(code) ? [`應試 ${c.examNoOf.get(code)}`] : [])],
  }));
}

function labelPages(c: Ctx, paper: LabelPaper): LabelPageModel[] {
  const layout = wideLabelLayout(paper); // 兩倍寬（稿 v2.37／D107）：一張標籤佔橫向兩格
  const slotIdx = new Map(c.slots.map((s, i) => [s.id, i]));
  const bySeat = new Map<string, Map<string, { slot: number; slotId: string; code: string; subjectId: string; row: number; depth: number }[]>>();
  for (const e of c.plan.out.exams) {
    const rm = bySeat.get(e.roomId) ?? new Map();
    const k = `${e.row}-${e.depth}`;
    rm.set(k, [...(rm.get(k) ?? []), { slot: slotIdx.get(e.slotId) ?? 0, slotId: e.slotId, code: e.code, subjectId: e.subjectId, row: e.row, depth: e.depth }]);
    bySeat.set(e.roomId, rm);
  }
  const order = c.plan.input.rooms.map((r) => r.id).filter((id) => bySeat.has(id));
  return order.flatMap((id): LabelPageModel[] => {
    const rm0 = c.plan.input.rooms.find((r) => r.id === id);
    const maxRow = Math.max(1, ...(rm0?.seats ?? []).map((x) => x.row));
    const maxDepth = Math.max(1, ...(rm0?.seats ?? []).map((x) => x.depth));
    if (roomTooBigForLabel({ rows: maxRow, depth: maxDepth })) return []; // 橫排或深位超過 8，標籤無法對應（D113、D154），不輸出
    const seats = [...bySeat.get(id)!.values()].sort((a, b) => a[0]!.row - b[0]!.row || a[0]!.depth - b[0]!.depth);
    const cells: CellModel[] = seats.map((list) => {
      const first = list[0]!;
      return {
        coord: seatText(first.row, first.depth),
        seat: { row: first.row, depth: first.depth },
        code: '', classLabel: '', name: '',
        colorBg: 'FFFFFF', colorLine: '222222', colorFg: '22201B',
        tags: [], marks: [],
        persons: personsOfSeat(c, list),
        periodLines: [...list].sort((a, b) => a.slot - b.slot).map((x) => ({
          head: slotShort(c.slots[x.slot]!),
          text: `${sub(c, x.subjectId)} ${x.code} ${c.nameOf.get(x.code) ?? ''}${c.examNoOf.get(x.code) ? ` ${c.examNoOf.get(x.code)}` : ''}`.trim(),
        })),
      };
    });
    // 兩倍寬（D113）：一頁橫向最多 3 張、縱向 7 張，排數超過 3 就分頁，每張標「第 N／共 M 張」；格子依座位表的排×深位
    const tiles = splitLabelTiles(cells, { cols: layout.cols / 2, rows: layout.rows });
    return tiles.map((t, i): LabelPageModel => {
      const suffix = tiles.length > 1 ? `（第 ${i + 1}／${tiles.length} 張）` : '';
      return {
        kind: 'label', ...(c.doc.settings.schoolName?.trim() ? { school: c.doc.settings.schoolName.trim() } : {}), title: `${c.exam.name}　${rn(c, id)}　整合標籤${suffix}`, examName: c.exam.name, heading: `${c.exam.name}　整合標籤`, roomName: `${rn(c, id)}　整合標籤${suffix}`, layout, notes: [], cells: t.cells,
        grid: { cols: Math.min(layout.cols / 2, maxRow - t.origin.row + 1), rows: Math.min(layout.rows, maxDepth - t.origin.depth + 1) },
        ...(tiles.length > 1 ? { origin: t.origin, part: { n: i + 1, of: tiles.length } } : {}),
      };
    });
  });
}

// ───── 綜合教室座位表（#220）─────

/** 綜合教室座位表：每間「有人在那裡考試」的綜合教室一頁，格內每人一區（同整合標籤），下方每時段一列的各班人數統計＋不重複人數 */
function seatPages(c: Ctx): SeatPageModel[] {
  const slotIdx = new Map(c.slots.map((s, i) => [s.id, i]));
  const byRoom = new Map<string, Map<string, { slot: number; slotId: string; code: string; subjectId: string; row: number; depth: number }[]>>();
  for (const e of c.plan.out.exams) {
    const rm = byRoom.get(e.roomId) ?? new Map();
    const k = `${e.row}-${e.depth}`;
    rm.set(k, [...(rm.get(k) ?? []), { slot: slotIdx.get(e.slotId) ?? 0, slotId: e.slotId, code: e.code, subjectId: e.subjectId, row: e.row, depth: e.depth }]);
    byRoom.set(e.roomId, rm);
  }
  const pages: SeatPageModel[] = [];
  for (const room of c.plan.input.rooms) {
    const seats = byRoom.get(room.id);
    if (room.kind !== 'reserve' || !seats) continue;
    type SeatItem = { slot: number; slotId: string; code: string; subjectId: string; row: number; depth: number };
    // #579（D204）：有任何座位 3 人以上輪流且不只一個時段 → 一個時段一張座位表，不再翻下一頁對照
    const rotating = [...seats.values()].some((list) => personsOfSeat(c, list).length >= 3);
    const usedSlots = c.slots.filter((s) => [...seats.values()].some((l) => l.some((x) => x.slotId === s.id)));
    const parts: { slotId?: string; head?: string; seats: Map<string, SeatItem[]> }[] =
      rotating && usedSlots.length >= 2
        ? usedSlots.map((s) => ({
            slotId: s.id,
            head: slotHead(c, s),
            seats: new Map([...seats].flatMap(([k, l]) => { const ls = l.filter((x) => x.slotId === s.id); return ls.length ? [[k, ls] as [string, SeatItem[]]] : []; })),
          }))
        : [{ seats }];
    for (const part of parts) {
      const here = part.seats;
      const cells = new Map<string, CellModel>();
      const everyone = new Set<string>();
      for (const [k, list] of [...here].sort((x, y) => x[1][0]!.row - y[1][0]!.row || x[1][0]!.depth - y[1][0]!.depth)) {
        const first = list[0]!;
        const persons = personsOfSeat(c, list);
        persons.forEach((p) => everyone.add(p.code));
        cells.set(k, {
          coord: seatText(first.row, first.depth), seat: { row: first.row, depth: first.depth },
          code: '', classLabel: '', name: '', colorBg: 'FFFFFF', colorLine: '222222', colorFg: '22201B', tags: [], marks: [],
          periodLines: [...list].sort((x, y) => x.slot - y.slot).map((x) => ({ head: slotShort(c.slots[x.slot]!), text: `${sub(c, x.subjectId)} ${x.code} ${c.nameOf.get(x.code) ?? ''}`.trim() })),
          persons,
        });
      }
      // 統計：每個時段一列（各班人數＋合計），最後「不重複人數」
      const classNos = [...new Set([...here.values()].flat().map((x) => Number(x.code.slice(0, 2))))].sort((x, y) => c.rank(x) - c.rank(y) || x - y);
      const per = (codes: Iterable<string>) => { const a = [...codes]; return classNos.map((n) => a.filter((x) => Number(x.slice(0, 2)) === n).length); };
      // #581：比照學測統計表（D170／D174）：日期（有填才有）｜第幾天｜時段｜科目｜各班｜總計，逐「日期＋時段＋科目」一列，同天同時段由 statMerge 垂直合併
      const dates = c.exam.examDates;
      const hasDate = c.slots.some((s) => !!dateTag(dates?.[s.day]));
      const rows: { label: string; foot?: boolean; lead?: string[]; per: number[]; total: number }[] = c.slots.flatMap((s) => {
        const inSlot = [...here.values()].flat().filter((x) => x.slotId === s.id);
        return s.subjectIds.flatMap((sid) => {
          const codes = new Set(inSlot.filter((x) => x.subjectId === sid).map((x) => x.code));
          if (!codes.size) return [];
          const lead = [dayTag(s.day), s.label.split(' ').pop()!, sub(c, sid)];
          return [{ label: sub(c, sid), lead: hasDate ? [dateTag(dates?.[s.day]), ...lead] : lead, per: per(codes), total: codes.size }];
        });
      });
      rows.push({ label: '使用人數（不重複）', lead: ['使用人數（不重複）'], foot: true, per: per(everyone), total: everyone.size });
      pages.push({
        kind: 'seat', ...(c.doc.settings.schoolName?.trim() ? { school: c.doc.settings.schoolName.trim() } : {}), title: `${c.exam.name}　${rn(c, room.id)}${part.head ? `　${part.head}` : ''}　座位表`, examName: c.exam.name, roomName: part.head ? `${rn(c, room.id)}　${part.head}` : rn(c, room.id),
        chips: [...(part.head ? [part.head] : []), `共 ${everyone.size} 人`, ...(part.head ? [] : [`${new Set(rows.filter((r) => !r.foot).map((r) => r.lead!.slice(0, -1).join('|'))).size} 個時段`]), '綜合教室'],
        detachStyle: false, slotMode: true,
        rows: Math.max(...room.seats.map((x) => x.row)), depth: Math.max(...room.seats.map((x) => x.depth)),
        cells, usable: new Set(room.seats.map((x) => `${x.row}-${x.depth}`)),
        stats: { perClass: [], total: everyone.size, perSubject: [], table: { leadHeads: hasDate ? ['日期', '第幾天', '時段', '科目'] : ['第幾天', '時段', '科目'], classes: classNos.map((n) => c.className(n)), rows } },
      });
    }
  }
  return pages;
}

/**
 * 自習座位頁（G36、DESIGN 10.26）：每個時段、每間有人自習的教室一頁；只出座位表、不印標籤。
 * WP-2（D141）：座位每個時段各自排（engine.studySeats 帶 slotId），不再全日固定、不保留去考試的人的座位。
 * 格內一律寫班級、座號、姓名；座位放不下的人不硬排，列在頁首小標籤「座位不足」。
 */
function studyRefPages(c: Ctx): SeatPageModel[] {
  const out = c.plan.out;
  const key = (slotId: string, roomId: string) => `${slotId}|${roomId}`;
  const seatsOf = new Map<string, { code: string; row: number; depth: number }[]>();
  for (const x of out.studySeats ?? []) seatsOf.set(key(x.slotId, x.roomId), [...(seatsOf.get(key(x.slotId, x.roomId)) ?? []), x]);
  const unseated = new Map<string, string[]>();
  for (const x of out.studyUnseated ?? []) unseated.set(key(x.slotId, x.roomId), [...(unseated.get(key(x.slotId, x.roomId)) ?? []), x.code]);
  const pages: SeatPageModel[] = [];
  for (const room of c.plan.input.rooms) {
    for (const s of c.slots) {
      const here = new Set(out.study.filter((x) => x.slotId === s.id && x.roomId === room.id).map((x) => x.code));
      if (here.size === 0) continue;
      const cells = new Map<string, CellModel>();
      const per = new Map<number, number>();
      for (const x of seatsOf.get(key(s.id, room.id)) ?? []) {
        const no = Number(x.code.slice(0, 2));
        per.set(no, (per.get(no) ?? 0) + 1);
        cells.set(`${x.row}-${x.depth}`, {
          coord: seatText(x.row, x.depth), seat: { row: x.row, depth: x.depth }, code: x.code, classLabel: c.className(no), name: c.nameOf.get(x.code) ?? '',
          colorBg: 'FFFFFF', colorLine: '222222', colorFg: '22201B', tags: [], marks: [], ref: true,
          corners: [{ kind: 'add', text: '自習' }],
        });
      }
      const nos = [...per.keys()].sort((p, q) => c.rank(p) - c.rank(q) || p - q);
      const miss = unseated.get(key(s.id, room.id)) ?? [];
      pages.push({
        kind: 'seat', ...(c.doc.settings.schoolName?.trim() ? { school: c.doc.settings.schoolName.trim() } : {}), title: `${c.exam.name}　${rn(c, room.id)}　自習座位（非考試座位）`, examName: c.exam.name, roomName: `${rn(c, room.id)}　自習座位`,
        chips: ['自習座位，非考試座位', STUDY_LEGEND, `自習 ${here.size} 人`, slotHead(c, s),
          ...(miss.length ? [`座位不足：缺 ${miss.length} 座，未排入 ${miss.map((m) => `${c.className(Number(m.slice(0, 2)))}${m.slice(2)}`).join('、')}`] : [])],
        detachStyle: false,
        rows: Math.max(...room.seats.map((p) => p.row)), depth: Math.max(...room.seats.map((p) => p.depth)),
        cells, usable: new Set(room.seats.map((p) => `${p.row}-${p.depth}`)),
        stats: { perClass: nos.map((n) => ({ className: c.className(n), count: per.get(n)! })), total: here.size, perSubject: [], table: { classes: nos.map((n) => c.className(n)), rows: [{ label: '自習人數', per: nos.map((n) => per.get(n)!), total: here.size }] } },
      });
    }
  }
  return pages;
}

// ───── ② 班級公告 ─────

function announcePages(c: Ctx): TablePageModel[] {
  const examAt = new Map(c.plan.out.exams.map((e) => [`${e.slotId}|${e.code}`, e]));
  const studyAt = new Map(c.plan.out.study.map((s) => [`${s.slotId}|${s.code}`, s]));
  const classes = [...new Set(c.plan.input.students.map((s) => s.classNo))].sort((a, b) => c.rank(a) - c.rank(b) || a - b);
  const home = homeRoomIds(c.plan.input.rooms);
  const lead = ['座號', '姓名', ...(c.hasExamNo ? ['應試編號'] : [])];
  // 兩層表頭（#215）：上層「第N天」、下層「時段X 科目」，不折行
  const dayOf = (s: AstSlot): string => s.label.split(' ')[0] ?? s.label;
  const headGroups: { text: string; span: number }[] = [{ text: '', span: lead.length }];
  for (const s of c.slots) {
    const last = headGroups[headGroups.length - 1]!;
    if (headGroups.length > 1 && last.text === dayOf(s)) last.span++;
    else headGroups.push({ text: dayOf(s), span: 1 });
  }
  const heads = [...lead, ...c.slots.map((s) => `${s.label.slice(dayOf(s).length).trim()} ${s.subjectIds.map((i) => sub(c, i)).join('、')}`)];
  // 欄寬（em）：取表頭與所有格子的最大字寬，教室名稱不折行不截字（#259）
  const colEm: number[] = heads.map((h) => textEm(h, true));
  return classes.map((cl): TablePageModel => {
    const students = c.plan.input.students.filter((s) => s.classNo === cl).sort((a, b) => a.seatNo - b.seatNo);
    const kinds: ('exam' | 'study' | undefined)[][] = [];
    const rows = students.map((s) => {
      const code = codeOf(s);
      const k: ('exam' | 'study' | undefined)[] = lead.map(() => undefined);
      const cells = c.slots.map((sl) => {
        const e = examAt.get(`${sl.id}|${code}`);
        if (e) {
          k.push('exam');
          const seat = seatText(e.row, e.depth);
          return e.roomId === home.get(cl) ? seat : `${seat} ${rn(c, e.roomId)}`;
        }
        const st = studyAt.get(`${sl.id}|${code}`);
        if (st) { k.push('study'); return `自習 ${rn(c, st.roomId)}`; }
        k.push(undefined);
        return '—';
      });
      kinds.push(k);
      return [String(s.seatNo), s.name, ...(c.hasExamNo ? [c.examNoOf.get(code) ?? ''] : []), ...cells];
    });
    const widths = colEm.map((w, i) => Math.max(w, ...rows.map((r) => textEm(r[i] ?? '', true))) + 1.2);
    return {
      kind: 'table', landscape: true, emWidths: true, title: `${c.exam.name}　班級公告　${c.className(cl)}班`,
      subtitle: `共 ${rows.length} 人`,
      legend: '粗體＝考試座位（排－深位；沒寫教室就是在本班教室）　灰底＝自習（寫教室）　—＝不考也不自習',
      heads, headGroups, widths, rows, cellKinds: kinds,
    };
  });
}

// ───── ③ 每節教室用途表（含方案指標） ─────

const CELL_TEXT: Record<string, string> = { exam: '考試', study: '自習', borrow: '借用自習', pending: '待核可', home: '原班', none: '—' };

function usagePages(c: Ctx): TablePageModel[] {
  const rooms = c.plan.input.rooms;
  const rows = rooms.map((r) => [rn(c, r.id), r.kind === 'class' ? '班級教室' : '綜合教室', ...c.slots.map((s) => {
    const u = usageCell(c.plan, s, r);
    return u.count > 0 ? `${CELL_TEXT[u.kind]} ${u.count} 人` : (CELL_TEXT[u.kind] ?? '—');
  })]);
  const pages: TablePageModel[] = [{
    kind: 'table', title: `${c.exam.name}　每節教室用途表`,
    subtitle: '考試＝這節是考場；自習＝接收離開原班的自習者；借用自習＝經核可借他班原班教室；原班＝同學留在原班；—＝沒用到',
    heads: ['教室', '類型', ...c.slots.map((s) => slotHead(c, s))], widths: [1.6, 1.1, ...c.slots.map(() => 1.5)], rows,
  }];
  const m = c.plan.out.metrics;
  if (m) {
    pages.push({
      kind: 'table', title: `${c.exam.name}　方案指標`, subtitle: '這一版方案的代價與試務複雜度（供存檔核對；不參與排座）',
      heads: ['指標', '數值'], widths: [3, 1],
      rows: [
        ['用到的教室總數', String(m.roomsTotal)], ['考場教室數／自習教室數', `${m.examRooms}／${m.studyRooms}`],
        ['被抽離的原班非應考者人次', String(m.displaced)], ['離開原班人次', String(m.leaveHome)],
        ['跨節換教室次數', String(m.roomChanges)], ['跨科換座位次數', String(m.seatChanges)], ['需跨教室學生數', String(m.crossRoomStudents)],
        ['各考場人數最大落差', String(m.balanceGap)], ['混科教室數／同排混科排數', `${m.mixedRooms}／${m.mixedRows}`],
        ['標籤張數', String(m.labels)], ['同一座位最多幾個人用過', String(m.maxSeatUsers)], ['發卷區段數', String(m.dispatchSegments)],
      ],
    });
  }
  return pages;
}

// ───── ④ 每科試務清冊 ─────

function registerPages(c: Ctx): TablePageModel[] {
  const out: TablePageModel[] = [];
  const seatsOf = new Map(c.plan.input.rooms.map((r) => [r.id, r.seats.length]));
  for (const s of c.slots) {
    for (const subjectId of s.subjectIds) {
      const here = c.plan.out.exams.filter((e) => e.slotId === s.id && e.subjectId === subjectId);
      if (here.length === 0) continue;
      const rooms = [...new Set(here.map((e) => e.roomId))];
      const head = `${c.exam.name}　${sub(c, subjectId)}　試務清冊`;
      const where = `${s.label}`;
      const mixedIn = (roomId: string) => c.plan.out.mixedRows.filter((m) => m.slotId === s.id && m.roomId === roomId).length;
      out.push({
        kind: 'table', title: head, subtitle: `${where}　考場總表　應考 ${here.length} 人`,
        heads: ['考場', '座位數', '應考人數', '來自班級', '簽到名冊頁數', '備註'], widths: [1.6, 0.9, 1, 2.4, 1.1, 1.8],
        rows: rooms.map((id) => {
          const list = here.filter((e) => e.roomId === id);
          const from = new Map<number, number>();
          for (const e of list) from.set(Number(e.code.slice(0, 2)), (from.get(Number(e.code.slice(0, 2))) ?? 0) + 1);
          const mx = mixedIn(id);
          return [rn(c, id), String(seatsOf.get(id) ?? ''), String(list.length), [...from].sort((a, b) => c.rank(a[0]) - c.rank(b[0]) || a[0] - b[0]).map(([cl, n]) => `${c.className(cl)} ${n} 人`).join('、'), '1', mx > 0 ? `同排混科 ${mx} 排，依座位分區發卷` : ''];
        }),
      });
      for (const id of rooms) {
        const list = here.filter((e) => e.roomId === id).sort((a, b) => a.row - b.row || a.depth - b.depth);
        out.push({
          kind: 'table', title: head, subtitle: `${where}　${rn(c, id)}　簽到名冊　應考 ${list.length} 人${mixedIn(id) > 0 ? '　注意：同排混科，依座位分區發卷' : ''}`,
          heads: ['座位', '班級', '座號', '姓名', ...(c.hasExamNo ? ['應試編號'] : []), '到考', '缺考'], widths: [1, 1, 0.8, 1.6, ...(c.hasExamNo ? [1.5] : []), 0.8, 0.8],
          rows: list.map((e) => [seatText(e.row, e.depth), c.className(Number(e.code.slice(0, 2))), e.code.slice(2), c.nameOf.get(e.code) ?? '', ...(c.hasExamNo ? [c.examNoOf.get(e.code) ?? ''] : []), '□', '□']),
        });
      }
    }
  }
  return out;
}

// ───── ⑤ 自習教室名單與布置標籤工作表 ─────

function studyPages(c: Ctx): TablePageModel[] {
  const out: TablePageModel[] = [];
  const work: string[][] = [];
  const cap = new Map(c.plan.input.rooms.map((r) => [r.id, r.studyCapacity]));
  for (const s of c.slots) {
    const away = awayStudy(c.plan, s.id);
    if (away.length === 0) continue;
    const rooms = [...new Set(away.map((a) => a.roomId))];
    out.push({
      kind: 'table', title: `${c.exam.name}　自習教室名單`, subtitle: `${s.label}${s.subjectIds.map((i) => sub(c, i)).join('、')}　自習 ${away.length} 人、${rooms.length} 間教室`,
      heads: ['地點', '班級', '座號', '姓名', ...(c.hasExamNo ? ['應試編號'] : [])], widths: [1.8, 1.1, 0.9, 1.6, ...(c.hasExamNo ? [1.4] : [])],
      rows: [...away].sort((a, b) => rooms.indexOf(a.roomId) - rooms.indexOf(b.roomId) || c.rank(Number(a.code.slice(0, 2))) - c.rank(Number(b.code.slice(0, 2))) || a.code.localeCompare(b.code)).map((a) => [rn(c, a.roomId), c.className(Number(a.code.slice(0, 2))), a.code.slice(2), c.nameOf.get(a.code) ?? '', ...(c.hasExamNo ? [c.examNoOf.get(a.code) ?? ''] : [])]),
    });
    for (const id of rooms) work.push([`${slotShort(s)} ${s.subjectIds.map((i) => sub(c, i)).join('、')}`, rn(c, id), `${away.filter((a) => a.roomId === id).length}／${cap.get(id) ?? 0}`, '□ 已貼', '□ 已布置', '']);
  }
  if (work.length > 0) {
    out.push({
      kind: 'table', title: `${c.exam.name}　自習教室布置標籤工作表`, subtitle: '給總務與導師前一天布置；人數／容量＝當節自習人數／教室自習容量',
      heads: ['時段', '教室', '人數／容量', '門口標籤', '座位布置', '負責人'], widths: [1.8, 1.6, 1.1, 1, 1, 1.2], rows: work,
    });
  }
  return out;
}

/** 由同一份方案產出所有輸出頁面（標籤紙張可選；B4 6×8、A3 7×7，座位超過格數時 labelPages 會丟例外，由畫面接住） */
export function astOutputs(doc: Doc, exam: ExamConfig, plan: AstPlan, paper: LabelPaper = 'B4', withStudyRef = false): AstOutputs {
  const c = ctxOf(doc, exam, plan);
  return {
    label: labelPages(c, paper), seat: [...seatPages(c), ...(withStudyRef ? studyRefPages(c) : [])], ann: announcePages(c), use: usagePages(c), reg: registerPages(c), study: studyPages(c),
    version: dataVersion({ i: plan.input, o: plan.out, n: [...c.examNoOf] }),
  };
}

/** 能不能出檔：方案要有、可行、沒有待核可／排不進／驗證不通過。回傳擋下的原因與要回哪一步 */
export function astOutputBlockers(plan: AstPlan | undefined, hasList: boolean, mismatch?: string): { text: string; step: 2 | 3 | 5 }[] {
  if (mismatch) return [{ text: mismatch, step: 5 }];
  if (!hasList) return [{ text: '還沒有考試名單，請先到 ② 匯入。', step: 2 }];
  if (!plan) return [{ text: '還沒有可排的方案：請先到 ③ 勾選教室。', step: 3 }];
  if (plan.infeasible) return [{ text: '座位不夠，排不出方案：請先到 ③ 補座位。', step: 3 }];
  const b: { text: string; step: 2 | 3 | 5 }[] = [];
  if (plan.pending.length > 0) b.push({ text: `還有 ${plan.pending.length} 個時段的替代方案待核可，請先到 ⑤ 核可。`, step: 5 });
  if (plan.unplaced > 0 && plan.pending.length === 0) b.push({ text: `有 ${plan.unplaced} 人排不進自習空間：請到 ③ 調整自習空間。`, step: 3 });
  if (plan.conflicts.length > 0) b.push({ text: `鎖定有 ${plan.conflicts.length} 項衝突，請到 ⑤ 處理（程式不會自己解除鎖定）。`, step: 5 });
  if (plan.errors.length > 0 && plan.pending.length === 0 && plan.unplaced === 0) b.push({ text: `硬性限制驗證有 ${plan.errors.length} 項不通過，請到 ⑤ 看詳情。`, step: 5 });
  return b;
}
