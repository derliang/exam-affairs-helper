/**
 * 匯出規劃（純函式）：依使用者勾選決定產生哪些檔案、各幾頁，匯出前檢查，並實際產生內容。
 * 畫面層（Step6）只呼叫這裡；檔案下載與開新視窗由畫面層做。
 */
import type { LabelPaper } from '../data';
import {
  buildLabelPages,
  buildSeatPages,
  buildStudyLists,
  defaultLabelLayout,
  findMissingChars,
  type ExportInput,
  type LabelPageModel,
  type ListPageModel,
  type SeatPageModel,
} from './model';
import type { FontData } from './docxRender';
import { hasPua } from '../import/pua';
import { renderPrintHtml } from './htmlRender';

export type ExportFormat = 'word' | 'pdf';
export interface ExportOptions {
  format: ExportFormat;
  /** 座位表（每間班級教室一頁，A4） */
  seat: boolean;
  /** 標籤（每間教室一張紙） */
  label: boolean;
  paper: LabelPaper;
  /** 抽離自習名單（每科一頁，A4）；國中部沒有 */
  study: boolean;
  /** 座位表、標籤檔是否含預備教室頁（併在最後，頁首標「預備教室」；G34） */
  reserve: boolean;
  /** G32：含自習參考座位頁（預設勾）：抽離自習的參考頁；取消則不出。標籤不受影響（原班虛線參考格已拿掉，D137） */
  studyRef?: boolean;
}

export const defaultOptions = (paper: LabelPaper = 'B4'): ExportOptions => ({
  format: 'word',
  seat: true,
  label: true,
  paper,
  study: false, // 稿 v2.7：抽離自習名單預設不勾（校-45）
  reserve: true,
  studyRef: true,
});

export interface PlannedFile {
  key: 'seat' | 'label' | 'study';
  name: string;
  desc: string;
  pages: number;
}

interface Parts {
  seat?: SeatPageModel[];
  label?: LabelPageModel[];
  study?: ListPageModel[];
}

/** 檔名不能含的字元換成底線 */
export const safeName = (s: string): string => s.replace(/[\\/:*?"<>|]/g, '_').trim() || '模擬考';

/** 預備教室頁（有 tag）排在班級教室之後（G34、稿 v2.43 第 27 題）；不含預備教室時拿掉 */
export function placeReserveLast<T extends { tag?: string }>(pages: T[], includeReserve: boolean): T[] {
  const cls = pages.filter((x) => !x.tag);
  return includeReserve ? [...cls, ...pages.filter((x) => x.tag)] : cls;
}

/**
 * 把勾選轉成版面模型；標籤紙張依選項覆蓋考試設定的格數（D74）。
 * G34：座位表一個檔、標籤一個檔，預備教室頁併在各自檔案的最後、頁首標「預備教室」；抽離自習名單獨立、預設不勾。
 */
export function buildParts(input: ExportInput, o: ExportOptions): Parts {
  const withPaper: ExportInput = { ...input, includeStudyRef: o.studyRef !== false, exam: { ...input.exam, labelLayout: defaultLabelLayout(o.paper) } };
  const parts: Parts = {};
  if (o.seat) {
    const pg = placeReserveLast([...buildSeatPages(withPaper, 'class'), ...buildSeatPages(withPaper, 'reserve')], o.reserve);
    if (pg.length) parts.seat = pg;
  }
  if (o.label) {
    const pg = placeReserveLast([...buildLabelPages(withPaper, 'class'), ...buildLabelPages(withPaper, 'reserve')], o.reserve);
    if (pg.length) parts.label = pg;
  }
  if (o.study) {
    const l = buildStudyLists(withPaper);
    if (l.length) parts.study = l;
  }
  return parts;
}

const roomCount = (pages: { tag?: string }[]) => ({ cls: pages.filter((x) => !x.tag).length, res: pages.filter((x) => x.tag).length });
const split = (pages: { tag?: string }[], unit: string, tail = '') => {
  const c = roomCount(pages);
  return `${pages.length} ${unit}（${c.cls} 間班級教室${c.res ? `＋${c.res} 間預備教室，排在最後` : ''}${tail}）`;
};

export function planFiles(input: ExportInput, o: ExportOptions): PlannedFile[] {
  const parts = buildParts(input, o);
  const ext = o.format === 'word' ? 'docx' : 'pdf';
  const base = safeName(input.exam.name);
  const out: PlannedFile[] = [];
  if (parts.seat) out.push({ key: 'seat', name: `${base}-座位表.${ext}`, desc: split(parts.seat, '頁', '，A4'), pages: parts.seat.length });
  if (parts.label) out.push({ key: 'label', name: `${base}-標籤（${o.paper}）.${ext}`, desc: split(parts.label, '張紙', `，${o.paper}`), pages: parts.label.length });
  if (parts.study) out.push({ key: 'study', name: `${base}-抽離自習名單.${ext}`, desc: `${parts.study.length} 頁（每科一頁，A4）`, pages: parts.study.length });
  return out;
}

export type IssueLevel = 'block' | 'warn';
export interface Issue {
  level: IssueLevel;
  text: string;
}
export interface PreflightState {
  /** 排座結果過期（名單或設定改了，D22） */
  stale?: boolean;
  /** 考試名單與學生名單尚未處理的差異數（D42） */
  unresolvedDiffs?: number;
  /** 差異已選好處理方式、但還沒按 ② 的「套用」的筆數（#242：名單還沒更新，不能下載） */
  unappliedDiffs?: number;
}

/**
 * 匯出前檢查：擋下的（block）不能匯出；警告（warn）可匯出但要讓使用者知道。
 * hasChar：字型字集檢查（D44）；回報只含班級＋座號＋字元，不含姓名。
 */
export function preflight(input: ExportInput, o: ExportOptions, st: PreflightState, hasChar: (ch: string) => boolean): Issue[] {
  const issues: Issue[] = [];
  if (st.stale) issues.push({ level: 'block', text: '需要重新排座：名單或設定在排座之後改過，舊座位表上的座位可能已經不對。請回 ⑤ 重新排座，再回來下載。' });
  if ((st.unresolvedDiffs ?? 0) > 0) issues.push({ level: 'block', text: `② 還有 ${st.unresolvedDiffs} 筆考試名單與學生名單的差異沒處理（例如新增、缺少或資料不同的考生）。請回 ② 逐筆選擇處理方式，處理完再下載。` });
  else if ((st.unappliedDiffs ?? 0) > 0) issues.push({ level: 'block', text: `② 的 ${st.unappliedDiffs} 筆差異已選好處理方式，但還沒按「套用 ${st.unappliedDiffs} 筆核對結果」，名單還沒更新。請先回 ② 按「套用」，再回來下載。` });
  if (!o.seat && !o.label && !o.study) issues.push({ level: 'block', text: '還沒勾選要下載的內容：請在下方至少勾選座位表、標籤或抽離自習名單其中一項。' });
  try {
    buildParts(input, o);
  } catch (e) {
    issues.push({ level: 'block', text: e instanceof Error ? e.message : String(e) });
  }
  if (o.format === 'word') {
    const miss = findMissingChars(input, hasChar);
    if (miss.length) {
      const shown = miss.slice(0, 8).map((m) => `${String(m.classNo).padStart(2, '0')}${String(m.seatNo).padStart(2, '0')} 的${hasPua(m.ch) ? `造字區碼位 U+${m.ch.charCodeAt(0).toString(16).toUpperCase()}` : `「${m.ch}」`}`).join('、');
      issues.push({
        level: 'warn',
        text: `${miss.length} 個罕用字不在內嵌字型內（${shown}${miss.length > 8 ? '…' : ''}）。仍可下載，但 Word 會改用該電腦的字型顯示這些字；下載後請開檔確認，必要時手動改字型。`,
      });
    }
  }
  return issues;
}

export interface OutputFile {
  name: string;
  mime: string;
  /** Word 為位元組；PDF（列印用 HTML）為字串 */
  data: Uint8Array | string;
  desc: string;
  pages: number;
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * 產生檔案。Word：每類一個 .docx（D69）。PDF：瀏覽器列印成 PDF（D29），
 * 所有勾選內容合併成一個「列印用頁面」，各頁紙張大小由 @page 決定，開啟後選「另存為 PDF」。
 */
export async function runExport(
  input: ExportInput,
  o: ExportOptions,
  env: { fonts: FontData; boldMode?: 'separate-family' | 'embed-bold' },
): Promise<OutputFile[]> {
  const parts = buildParts(input, o);
  const plan = planFiles(input, o);
  const meta = { generatedAt: input.result.generatedAt, dataVersion: input.result.dataVersion };
  if (plan.length === 0) throw new Error('沒有可輸出的頁面');
  if (o.format === 'pdf') {
    const html = renderPrintHtml(
      {
        seat: parts.seat,
        label: parts.label,
        list: parts.study,
      },
      meta,
    );
    return [
      {
        name: `${safeName(input.exam.name)}-列印用頁面.html`,
        mime: 'text/html',
        data: html,
        desc: `${plan.reduce((a, f) => a + f.pages, 0)} 頁（${plan.map((f) => f.name.replace(/^.*?-/, '').replace(/\.pdf$/, '')).join('、')}），開啟後選「另存為 PDF」`,
        pages: plan.reduce((a, f) => a + f.pages, 0),
      },
    ];
  }
  // docx 套件較大：只在真的匯出 Word 時才載入
  const { renderDocx } = await import('./docxRender');
  const opts = { fonts: env.fonts, ...meta, boldMode: env.boldMode };
  const out: OutputFile[] = [];
  for (const f of plan) {
    const pages =
      f.key === 'seat' ? { seat: parts.seat }
      : f.key === 'label' ? { label: parts.label }
      : { list: parts.study };
    out.push({ name: f.name, mime: DOCX_MIME, data: await renderDocx(pages, opts), desc: f.desc, pages: f.pages });
  }
  return out;
}
