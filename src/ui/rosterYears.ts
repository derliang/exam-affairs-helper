/**
 * 學生名單與班級資料按「學年度」分存（#208，使用者裁示方案 A）。
 *
 * 結構（相容舊存檔，不丟資料）：
 * - `doc.rosters` 與 `doc.settings.classes` 永遠是「目前作用中學年度」的名單與班級（下稱工作資料），
 *   所以既有畫面與核心程式完全不用改，舊版資料夾原樣可讀。
 * - `doc.rosterYear`：工作資料屬於哪一個學年度。舊存檔沒有這個欄位，載入時由 migrateRosterYear
 *   補成「最近一次考試的學年度」（沒有考試就用今天推算的學年度），使用者之後可以改。
 * - `doc.otherYears`：其他學年度的名單與班級（切換學年度時互換）。
 * - 某次考試的學年度沒有自己的名單時，一律退回用工作資料（行為與分年度之前相同），不會憑空變成「全是差異」。
 */
import type { ClassInfo, Division, Student } from '../data';
import { examYear, schoolYear, type Doc, type Result } from './store';
import type { ExamConfig } from '../data';

export interface YearData {
  rosters: Record<Division, Student[]>;
  classes: ClassInfo[];
}

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
export const YEAR_MIN = 90;
export const YEAR_MAX = 200;
export const validYear = (y: number): boolean => Number.isInteger(y) && y >= YEAR_MIN && y <= YEAR_MAX;

/** 舊存檔遷移用：最近一次考試（依建立時間）的學年度；沒有考試就用今天 */
export function inferRosterYear(doc: Doc, now: Date = new Date()): number {
  const last = [...doc.exams].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return last ? examYear(last) : schoolYear(now);
}

/** 工作資料所屬學年度（沒標示就推算，不改 doc） */
export const rosterYearOf = (doc: Doc, now: Date = new Date()): number => doc.rosterYear ?? inferRosterYear(doc, now);

/** 載入後補標學年度；已標示的原物件回傳（沒有變動就不觸發存檔） */
export function migrateRosterYear(doc: Doc, now: Date = new Date()): Doc {
  return doc.rosterYear !== undefined ? doc : { ...doc, rosterYear: inferRosterYear(doc, now) };
}

/** 有名單資料的學年度（工作資料的學年度＋其他學年度），由小到大 */
export function rosterYears(doc: Doc, now: Date = new Date()): number[] {
  const set = new Set<number>([rosterYearOf(doc, now), ...Object.keys(doc.otherYears ?? {}).map(Number)]);
  return [...set].sort((a, b) => a - b);
}

const workingData = (doc: Doc): YearData => ({ rosters: doc.rosters, classes: doc.settings.classes });

/** 某學年度的名單與班級；該學年度沒有自己的資料就退回工作資料（見檔頭） */
export function yearData(doc: Doc, year: number, now: Date = new Date()): YearData {
  if (year === rosterYearOf(doc, now)) return workingData(doc);
  return doc.otherYears?.[String(year)] ?? workingData(doc);
}

/** 該次考試對應學年度的學生名單 */
export const rosterFor = (doc: Doc, exam: ExamConfig): Record<Division, Student[]> => yearData(doc, examYear(exam)).rosters;

/** 該次考試對應學年度的班級資料 */
export const classesFor = (doc: Doc, exam: ExamConfig): ClassInfo[] => yearData(doc, examYear(exam)).classes;

/** 把文件換成某學年度的樣子（只換名單與班級，其他不動），給需要「那個學年度視角」的計算用，不寫回 */
export function viewForYear(doc: Doc, year: number, now: Date = new Date()): Doc {
  const d = yearData(doc, year, now);
  return d === workingData(doc) ? doc : { ...doc, rosters: d.rosters, settings: { ...doc.settings, classes: d.classes } };
}

/** 考試學年度與工作資料的學年度不同，且該考試的學年度沒有自己的名單：② 要提示「年度不符」 */
export function rosterYearMismatch(doc: Doc, exam: ExamConfig, now: Date = new Date()): boolean {
  return examYear(exam) !== rosterYearOf(doc, now);
}

/**
 * 切換作用中的學年度：目前的工作資料收進 otherYears，目標學年度的資料換上來。
 * 目標學年度還沒有資料時：名單從空白開始，班級沿用目前這份（班級名稱、文理組、顏色通常跨年相同，之後可改）。
 */
export function switchRosterYear(doc: Doc, year: number, now: Date = new Date()): Result<Doc> {
  if (!validYear(year)) return fail('學年度要是民國年（例如 114）');
  const cur = rosterYearOf(doc, now);
  if (year === cur) return { ok: true, doc: doc.rosterYear === cur ? doc : { ...doc, rosterYear: cur } };
  const others: Record<string, YearData> = { ...(doc.otherYears ?? {}) };
  others[String(cur)] = workingData(doc);
  const target = others[String(year)] ?? { rosters: { senior: [], junior: [] }, classes: doc.settings.classes };
  delete others[String(year)];
  return {
    ok: true,
    doc: { ...doc, rosterYear: year, rosters: target.rosters, settings: { ...doc.settings, classes: target.classes }, otherYears: others },
  };
}

/** 開啟某次考試時：該考試學年度已有自己的資料才自動換過去；沒有資料就不換（避免憑空變空白名單） */
export function activateForExam(doc: Doc, exam: ExamConfig, now: Date = new Date()): Doc {
  const y = examYear(exam);
  if (y === rosterYearOf(doc, now) || !doc.otherYears?.[String(y)]) return doc;
  const r = switchRosterYear(doc, y, now);
  return r.ok ? r.doc : doc;
}

/** 改標目前這份名單所屬的學年度（匯入時標錯、舊存檔推算不對時用）；該學年度已有另一份資料就擋下，避免蓋掉 */
export function relabelRosterYear(doc: Doc, year: number, now: Date = new Date()): Result<Doc> {
  if (!validYear(year)) return fail('學年度要是民國年（例如 114）');
  if (year !== rosterYearOf(doc, now) && doc.otherYears?.[String(year)]) return fail(`${year} 學年度已經有一份名單，請先切換過去處理`);
  return { ok: true, doc: { ...doc, rosterYear: year } };
}
