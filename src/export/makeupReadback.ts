/**
 * 補考下載檔的回讀驗算（K4，F-26、C-14）：不看排程引擎的內部資料，直接把剛產生的 .docx（或列印用 HTML）
 * 打開、讀出表格文字，重新點人次、各卷人數、版本碼，再交給 C-14 與排程交叉驗算。
 * 認表靠表頭第一格（見 makeupPages.ts 開頭的約定）。
 */
import JSZip from 'jszip';
import { paperKey, type GradeKey, type ReadbackSummary } from '../core/makeup';

export type MakeupDocKind = 'O-1' | 'O-2' | 'O-3' | 'O-3t' | 'O-4' | 'O-5' | 'O-7';

export interface RawTables {
  /** 每個表格一個陣列：列 → 格（純文字） */
  tables: string[][][];
  /** 頁尾文字（docx 的 footer*.xml；html 的 <footer>） */
  footers: string[];
  /** 全文（含表格外的標題、注意事項） */
  text: string;
}

const decode = (s: string): string => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const clean = (s: string): string => decode(s).replace(/[\s　]+/g, ' ').trim();

/** 讀 .docx 的表格與頁尾 */
export async function readDocxTables(bytes: Uint8Array): Promise<RawTables> {
  const z = await JSZip.loadAsync(bytes);
  const doc = await z.file('word/document.xml')!.async('string');
  const text = (xml: string): string => [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');
  const tables = (doc.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) ?? []).map((t) =>
    (t.match(/<w:tr[\s>][\s\S]*?<\/w:tr>/g) ?? []).map((r) => (r.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? []).map((c) => clean(text(c)))),
  );
  const footers: string[] = [];
  for (const name of Object.keys(z.files).filter((n) => /^word\/footer\d*\.xml$/.test(n))) footers.push(clean(text(await z.file(name)!.async('string'))));
  return { tables, footers, text: clean(text(doc)) };
}

/** 讀列印用 HTML 的表格與頁尾（PDF 路徑的回讀） */
export function readHtmlTables(html: string): RawTables {
  const strip = (s: string): string => clean(s.replace(/<[^>]+>/g, ''));
  const tables = (html.match(/<table[\s\S]*?<\/table>/g) ?? []).map((t) =>
    (t.match(/<tr[\s>][\s\S]*?<\/tr>/g) ?? []).map((r) => (r.match(/<t[dh][\s>][\s\S]*?<\/t[dh]>/g) ?? []).map(strip)),
  );
  const footers = [...(html.match(/<footer>[\s\S]*?<\/footer>/g) ?? []), ...(html.match(/<div class="pp-foot"[^>]*>[\s\S]*?<\/div>/g) ?? [])].map(strip);
  return { tables, footers, text: strip(html.replace(/<style[\s\S]*?<\/style>/g, '')) };
}

export interface ReadbackDetail extends ReadbackSummary {
  kind: MakeupDocKind;
  /** 回讀點出的各卷人次可與統計列互相核對 */
  problems: string[];
  /** 考程表等：檔上印出的「HH:MM 前不得離場」時間 */
  leaveTimes: string[];
  /** 頁尾「總人次 N」 */
  footerTotal?: number;
}

const num = (s: string | undefined): number => (s !== undefined && /^\d+$/.test(s) ? Number(s) : NaN);
const isHead = (row: string[] | undefined, first: string): boolean => !!row && row[0] === first;

function paperOf(cls: string, subject: string, gradeOfClass: Record<string, GradeKey>): string {
  const g = gradeOfClass[cls];
  return g ? paperKey(g, subject) : `${cls} ${subject}`;
}
const add = (m: Record<string, number>, k: string, n: number): void => {
  m[k] = (m[k] ?? 0) + n;
};

/** 從一份檔的表格重新點人次。kind 決定怎麼讀。 */
export function summarizeTables(file: string, kind: MakeupDocKind, raw: RawTables, gradeOfClass: Record<string, GradeKey>, studentIds?: ReadonlySet<string>): ReadbackDetail {
  const problems: string[] = [];
  let total = 0;
  const byPaper: Record<string, number> = {};
  const leaves = new Set<string>();
  const body = (first: string): string[][][] => raw.tables.filter((t) => isHead(t[0], first)).map((t) => t.slice(1));
  const need = (n: number, what: string): void => {
    if (n === 0) problems.push(`${file}：找不到${what}表格`);
  };

  if (kind === 'O-1') {
    const ts = body('卷別');
    need(ts.length, '備卷');
    for (const t of ts) for (const r of t) {
      if (r[0] === '合計') continue;
      const n = num(r[4]);
      if (Number.isNaN(n)) { problems.push(`${file}：份數不是數字（${r.join('|')}）`); continue; }
      total += n;
      add(byPaper, r[0]!, n);
    }
  } else if (kind === 'O-2') {
    // D220（#646）：O-2 是兩張表；人次只點第二張「補考監考表」（表頭第一格「監考時段」），各格「卷別(人數)」，第一欄是列名不算
    const ts = body('監考時段');
    need(ts.length, '監考');
    for (const t of ts) for (const r of t) for (const c of r.slice(1)) {
      for (const m of c.matchAll(/\((\d+)\)/g)) total += Number(m[1]);
      for (const m of c.matchAll(/(\d{2}:\d{2}) 前不得離場/g)) leaves.add(m[1]!);
    }
    for (const m of raw.text.matchAll(/(\d{2}:\d{2}) 前不得離場/g)) leaves.add(m[1]!);
  } else if (kind === 'O-3' || kind === 'O-3t') {
    const ts = body('舊班');
    need(ts.length, '公告');
    for (const t of ts) for (const r of t) {
      if (!r[2]) { problems.push(`${file}：公告有一列沒有${kind === 'O-3' ? '學號' : '姓名'}`); continue; }
      total++;
      add(byPaper, paperOf(r[0]!, r[3]!, gradeOfClass), 1);
      for (const m of (r[6] ?? '').matchAll(/(\d{2}:\d{2}) 前不得離場/g)) leaves.add(m[1]!);
    }
  } else if (kind === 'O-4') {
    const ts = raw.tables.filter((t) => isHead(t[0], '學號') && t[0]![1] === '舊班').map((t) => t.slice(1));
    need(ts.length, '點名單');
    for (const t of ts) {
      const stat: Record<string, number> = {};
      const mine: Record<string, number> = {};
      // 點名單分左右兩組並排（每組 7 欄）：兩組都讀，空白組略過
      for (const r of t.flatMap((row) => (row.length > 7 ? [row.slice(0, 7), row.slice(7, 14)] : [row])).filter((row) => (row[0] ?? '') !== '')) {
        if (r[0] === '統計') { stat[r[4]!] = num(r[5]); continue; }
        const n = num(r[5]);
        const subs = (r[4] ?? '').split('、').filter(Boolean);
        if (Number.isNaN(n) || n !== subs.length) problems.push(`${file}：學號 ${r[0]} 卷數 ${r[5]} 與科目數 ${subs.length} 不符`);
        total += subs.length;
        for (const s of subs) { add(byPaper, paperOf(r[1]!, s, gradeOfClass), 1); add(mine, paperOf(r[1]!, s, gradeOfClass), 1); }
        for (const m of (r[6] ?? '').matchAll(/(\d{2}:\d{2}) 前不得離場/g)) leaves.add(m[1]!);
      }
      for (const k of new Set([...Object.keys(stat), ...Object.keys(mine)])) {
        if ((stat[k] ?? 0) !== (mine[k] ?? 0)) problems.push(`${file}：表尾統計 ${k} ${stat[k] ?? 0} 與名單點出的 ${mine[k] ?? 0} 不符`);
      }
    }
  } else if (kind === 'O-5') {
    // D220（#644）：O-5 是格狀座位圖，沒有表頭可認；數「學號出現幾次」（每個座位格寫一次學號）
    const text = raw.text;
    for (const id of studentIds ?? []) {
      let n = 0;
      for (let at = text.indexOf(id); at >= 0; at = text.indexOf(id, at + id.length)) n++;
      total += n;
      if (n === 0) problems.push(`${file}：學號 ${id} 沒有座位（座位圖上找不到）`);
    }
  } else {
    const ts = body('序號');
    need(ts.length, '公假');
    for (const t of ts) for (const r of t) {
      const n = num(r[5]);
      const subs = (r[4] ?? '').split('、').filter(Boolean);
      if (Number.isNaN(n)) { problems.push(`${file}：科數不是數字（${r.join('|')}）`); continue; }
      total += n;
      // 公假名單合併同科（重複科目只列一次）時，科數仍以排程為準；這裡只確認不少於列出的科目
      if (subs.length > n) problems.push(`${file}：學號 ${r[1]} 列出 ${subs.length} 科，科數只寫 ${n}`);
    }
  }

  const ft = raw.footers.join(' ');
  const version = /資料版本碼：([^\s]+)/.exec(ft)?.[1];
  const ftTotal = /總人次\s*(\d+)/.exec(ft)?.[1];
  const hasPaper = kind === 'O-1' || kind === 'O-3' || kind === 'O-3t' || kind === 'O-4';
  return { file, kind, total, ...(hasPaper ? { byPaper } : {}), ...(version ? { version } : {}), problems, leaveTimes: [...leaves].sort(), ...(ftTotal ? { footerTotal: Number(ftTotal) } : {}) };
}
