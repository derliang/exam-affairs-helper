/**
 * 補考下載檔產生與回讀驗算（K4，O-1～O-5、O-7；F-25～F-27、C-14）。
 *
 * 用法（K3 下載閘門通過後呼叫）：
 *   const out = await produceMakeupFiles({ title, settings, roster, plan, schedule, entries, outputs }, { fonts, generatedAt });
 *   // out.files：每份 { kind, name, docx }；out.readback：交給 runMakeupChecks 的 C-14；out.produced：C-15 用
 *   // out.verification：回讀與排程的逐項比對（含不是 C-14 的檢查：離場時間、表尾統計、座位）；ok=false 不得交付
 * 「依考日」：給 dayId 只產生那一天的檔（檔名帶日期）；此時 readback 為空陣列（C-14 只比全場次），
 *   各檔仍有 verification（與該考日的排程比對）。
 */
import {
  buildOutputs,
  fmtTime,
  makeupVersion,
  type MakeupOutputs,
  type MakeupPlan,
  type MakeupRoster,
  type MakeupSchedule,
  type MakeupSettings,
  type ProducedFile,
  type ReadbackSummary,
} from '../core/makeup';
import type { MakeupEntry } from '../core/makeup';
import { renderDocx, type BoldMode, type FontData } from './docxRender';
import { renderPrintHtml, type HtmlOptions } from './htmlRender';
import type { TablePageModel } from './model';
import {
  buildAnnouncementPages,
  buildLeaveListPages,
  buildPrepPages,
  buildRollCallPages,
  buildSeatTablePages,
  buildTimetablePages,
  type MakeupPaperInput,
} from './makeupPages';
import { readDocxTables, readHtmlTables, summarizeTables, type MakeupDocKind, type RawTables } from './makeupReadback';

export type { MakeupDocKind } from './makeupReadback';

export const MAKEUP_DOC_KINDS: readonly MakeupDocKind[] = ['O-1', 'O-2', 'O-3', 'O-3t', 'O-4', 'O-5', 'O-7'];
const FILE_LABEL: Record<MakeupDocKind, string> = {
  'O-1': 'O-1 備卷清單',
  'O-2': 'O-2 考程表',
  'O-3': 'O-3 班級公告',
  'O-3t': 'O-3 班級公告（導師存參版）',
  'O-4': 'O-4 點名單',
  'O-5': 'O-5 座位表',
  'O-7': 'O-7 公假名單',
};

export interface ProduceMakeupInput {
  /** 例「115 學年第一學期補考」 */
  title: string;
  settings: MakeupSettings;
  roster: MakeupRoster;
  plan: MakeupPlan;
  schedule: MakeupSchedule;
  entries: readonly MakeupEntry[];
  /** 全場次的產出模型（與下載閘門檢核的是同一份）；沒給就由 schedule 重建 */
  outputs?: MakeupOutputs;
}

export interface ProduceMakeupOptions {
  fonts: FontData;
  /** ISO 時間（頁尾台北時間） */
  generatedAt: string;
  boldMode?: BoldMode;
  /** 只產生這些文件；預設全部（O-6 標籤不在此，見完工記錄） */
  kinds?: readonly MakeupDocKind[];
  /** 只產生某一考日（多考日「依考日」下載） */
  dayId?: string;
}

export interface MakeupFileOut {
  kind: MakeupDocKind;
  name: string;
  docx: Uint8Array;
}

export interface FileVerification {
  file: string;
  kind: MakeupDocKind;
  /** 排程應有的人次（O-5 為座位數） */
  expected: number;
  /** 回讀點出的 */
  actual: number;
  ok: boolean;
  problems: string[];
}

export interface ProduceMakeupResult {
  version: string;
  /** 本批檔的總人次（頁尾「總人次」） */
  total: number;
  files: MakeupFileOut[];
  readback: ReadbackSummary[];
  produced: ProducedFile[];
  verification: FileVerification[];
  ok: boolean;
}

/** 只留某一考日的排程（時段、入座、提前開考） */
export function scheduleOfDay(schedule: MakeupSchedule, dayId: string): MakeupSchedule {
  const slots = schedule.slots.filter((s) => s.dayId === dayId);
  const ids = new Set(slots.map((s) => s.id));
  const groups = new Set(slots.map((s) => s.groupId));
  return {
    ...schedule,
    slots,
    sittings: schedule.sittings.filter((x) => ids.has(x.slotId)),
    early: schedule.early.filter((e) => groups.has(e.groupId)),
    unplaced: schedule.unplaced,
    splits: schedule.splits.filter((x) => ids.has(x.slotId)),
  };
}

function pagesOf(kind: MakeupDocKind, p: MakeupPaperInput): TablePageModel[] {
  switch (kind) {
    case 'O-1': return buildPrepPages(p);
    case 'O-2': return buildTimetablePages(p);
    case 'O-3': return buildAnnouncementPages(p, 'public');
    case 'O-3t': return buildAnnouncementPages(p, 'teacher');
    case 'O-4': return buildRollCallPages(p);
    case 'O-5': return buildSeatTablePages(p);
    case 'O-7': return buildLeaveListPages(p);
  }
}

interface Scoped {
  paper: MakeupPaperInput;
  total: number;
  seats: number;
  byPaper: Record<string, number>;
  leave: string[];
  version: string;
  suffix: string;
}

function scope(input: ProduceMakeupInput, dayId?: string): Scoped {
  const schedule = dayId ? scheduleOfDay(input.schedule, dayId) : input.schedule;
  const outputs = dayId ? buildOutputs(schedule, input.entries, input.settings) : (input.outputs ?? buildOutputs(schedule, input.entries, input.settings));
  const byPaper: Record<string, number> = {};
  let total = 0;
  for (const x of schedule.sittings) for (const p of x.papers) { byPaper[p] = (byPaper[p] ?? 0) + 1; total++; }
  const day = dayId ? input.settings.days.find((d) => d.id === dayId)?.label ?? dayId : '';
  return {
    paper: { title: day ? `${input.title}　${day}` : input.title, settings: input.settings, roster: input.roster, schedule, outputs },
    total,
    seats: schedule.sittings.length,
    byPaper,
    leave: [...new Set(schedule.early.map((e) => fmtTime(e.leaveAt)))].sort(),
    version: makeupVersion(input.roster, input.settings, input.plan),
    suffix: day ? `-${day.replace(/[\\/:*?"<>|（）() ]/g, '')}` : '',
  };
}

function verify(file: string, kind: MakeupDocKind, raw: RawTables, input: ProduceMakeupInput, sc: Scoped): { rb: ReadbackSummary; v: FileVerification } {
  const d = summarizeTables(file, kind, raw, input.roster.gradeOfClass);
  const problems = [...d.problems];
  const expected = kind === 'O-5' ? sc.seats : sc.total;
  if (d.total !== expected) problems.push(`${file}：回讀 ${d.total}，排程應有 ${expected}`);
  if (d.byPaper) {
    for (const k of new Set([...Object.keys(d.byPaper), ...Object.keys(sc.byPaper)])) {
      if ((d.byPaper[k] ?? 0) !== (sc.byPaper[k] ?? 0)) problems.push(`${file}：${k} 回讀 ${d.byPaper[k] ?? 0}，應有 ${sc.byPaper[k] ?? 0}`);
    }
  }
  if (d.version !== sc.version) problems.push(`${file}：頁尾版本碼 ${d.version ?? '（沒有）'}，應為 ${sc.version}`);
  if (d.footerTotal !== sc.total) problems.push(`${file}：頁尾總人次 ${d.footerTotal ?? '（沒有）'}，應為 ${sc.total}`);
  if (kind === 'O-2' && d.leaveTimes.join() !== sc.leave.join()) problems.push(`${file}：離場時間 ${d.leaveTimes.join('、') || '（沒印）'}，應為 ${sc.leave.join('、') || '（無）'}`);
  if (kind !== 'O-2') for (const t of d.leaveTimes) if (!sc.leave.includes(t)) problems.push(`${file}：印了排程沒有的離場時間 ${t}`);
  return {
    rb: { file, total: d.total, ...(d.byPaper ? { byPaper: d.byPaper } : {}), ...(d.version ? { version: d.version } : {}) },
    v: { file, kind, expected, actual: d.total, ok: problems.length === 0, problems },
  };
}

const dataVersionOf = (sc: Scoped): string => `${sc.version}　總人次 ${sc.total}`;

/** 產生 Word 檔並回讀驗算 */
export async function produceMakeupFiles(input: ProduceMakeupInput, opts: ProduceMakeupOptions): Promise<ProduceMakeupResult> {
  const sc = scope(input, opts.dayId);
  const files: MakeupFileOut[] = [];
  const readback: ReadbackSummary[] = [];
  const verification: FileVerification[] = [];
  for (const kind of opts.kinds ?? MAKEUP_DOC_KINDS) {
    const pages = pagesOf(kind, sc.paper);
    if (pages.length === 0) continue;
    const name = `補考-${FILE_LABEL[kind]}${sc.suffix}.docx`;
    const docx = await renderDocx({ table: pages }, { fonts: opts.fonts, generatedAt: opts.generatedAt, dataVersion: dataVersionOf(sc), boldMode: opts.boldMode });
    const { rb, v } = verify(name, kind, await readDocxTables(docx), input, sc);
    files.push({ kind, name, docx });
    verification.push(v);
    // C-14 比的是全場次人次；O-5 是座位數、不是人次，依考日的檔也不比
    if (!opts.dayId && kind !== 'O-5') readback.push(rb);
  }
  return { version: sc.version, total: sc.total, files, readback, produced: files.map((f) => ({ file: f.name, version: sc.version })), verification, ok: verification.every((v) => v.ok) };
}

/** 列印用 HTML（PDF：瀏覽器列印成 PDF）。同樣回讀自己的輸出並驗算 */
export function produceMakeupPrintHtml(
  input: ProduceMakeupInput,
  kind: MakeupDocKind,
  opts: Pick<HtmlOptions, 'generatedAt' | 'extraCss'> & { dayId?: string },
): { name: string; html: string; verification: FileVerification } | null {
  const sc = scope(input, opts.dayId);
  const pages = pagesOf(kind, sc.paper);
  if (pages.length === 0) return null;
  const name = `補考-${FILE_LABEL[kind]}${sc.suffix}.pdf`;
  const html = renderPrintHtml({ table: pages }, { generatedAt: opts.generatedAt, dataVersion: dataVersionOf(sc), extraCss: opts.extraCss });
  return { name, html, verification: verify(name, kind, readHtmlTables(html), input, sc).v };
}

/** 把勾選的多份文件併成「單一列印頁」（#592、D206，比照分科 ⑥）；每份仍各自回讀驗算，頁數＝各份頁數相加 */
export function produceMakeupMergedPrintHtml(
  input: ProduceMakeupInput,
  kinds: readonly MakeupDocKind[],
  opts: Pick<HtmlOptions, 'generatedAt' | 'extraCss'> & { dayId?: string },
): { name: string; html: string; pages: number; kinds: MakeupDocKind[]; problems: string[] } | null {
  const sc = scope(input, opts.dayId);
  const tables: TablePageModel[] = [];
  const used: MakeupDocKind[] = [];
  const problems: string[] = [];
  for (const k of kinds) {
    const pages = pagesOf(k, sc.paper);
    if (pages.length === 0) continue;
    const r = produceMakeupPrintHtml(input, k, opts);
    if (r) problems.push(...r.verification.problems.map((x) => `${r.name}：${x}`));
    tables.push(...pages);
    used.push(k);
  }
  if (tables.length === 0) return null;
  const html = renderPrintHtml({ table: tables }, { generatedAt: opts.generatedAt, dataVersion: dataVersionOf(sc), extraCss: opts.extraCss });
  return { name: `補考-列印用頁面${sc.suffix}.html`, html, pages: tables.length, kinds: used, problems };
}

/** ⑦ 按鈕旁預告用：勾選文件的列印頁數合計 */
export function countMakeupPrintPages(input: ProduceMakeupInput, kinds: readonly MakeupDocKind[], dayId?: string): number {
  const sc = scope(input, dayId);
  return kinds.reduce((a, k) => a + pagesOf(k, sc.paper).length, 0);
}
