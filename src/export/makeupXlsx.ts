/**
 * O-4 補考點名單 Excel 版（D227、稿 v2.108、DESIGN §10.66）：版式照學校 107 暑假補考點名單的「點名單」工作表。
 * 一個工作表「點名單」；每考場每時段一個區塊（一頁 A4 直式）：
 *   第 1～3 列表頭：監考老師（留空手寫）／監考地點／時段（左），科目，人數／注意事項（右）；
 *   第 4 列欄名：學號、舊班、舊號、姓名、科目、註 ×2 組（名單先填滿左組再右組）；
 *   之後每列一人，一組最多 30 列（一頁 60 人），超過就接下一個區塊（表頭重印）。
 * 不放「卷數」欄、不放表尾統計列（使用者範例沒有）；人數放表頭「科目，人數」：一卷寫卷名，多卷寫「卷別(人數)」；
 * 提前開考的「HH:MM 前不得離場」寫在註欄。頁尾印產生時間與資料版本碼（回讀驗算 makeupReadback.readXlsxTables 讀它）。
 * 樣式數值（字級、欄寬、列高、框線、邊界）由設計員定案，見 DESIGN §10.66；改這裡要一起改那裡。
 */
import JSZip from 'jszip';
import type { MakeupPaperInput } from './makeupPages';
import { slotName, slotTime } from './makeupPages';
import { footerText } from './model';

/** 樣式數值（DESIGN §10.66；照範例檔，註欄由 5.43 加寬到 10 放得下「HH:MM 前不得離場」） */
export const ROLL_XLSX = {
  font: '微軟正黑體',
  /** 一組六欄的欄寬（Excel 字元寬）：學號、舊班、舊號、姓名、科目、註 */
  widths: [8.14, 10, 6.86, 10, 10, 10],
  headRowHt: 28.35,
  dataRowHt: 21.2,
  /** 科目或註欄需要兩行時的列高 */
  dataRowHt2: 36,
  rowsPerGroup: 30,
  size: { label: 14, teacher: 18, notice: 12, head: 14, id: 10, data: 12, footer: 9 },
  /** 邊界（英吋）：左右 0.6 cm、上下 1.4 cm（照範例），頁尾 0.5 cm */
  margins: { left: 0.236, right: 0.236, top: 0.551, bottom: 0.551, header: 0, footer: 0.2 },
} as const;

export const ROLL_HEAD6 = ['學號', '舊班', '舊號', '姓名', '科目', '註'] as const;
export const ROLL_NOTICE = '請確實核對身份證明，如未攜帶者請註明。';

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const col = (i: number): string => {
  let n = i + 1;
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
};
const pad2 = (n: number): string => String(n).padStart(2, '0');

// ───── 樣式表（字型、框線、格式組合自動去重） ─────
type Edge = 'none' | 'thin' | 'medium';
interface Xf { font: number; border: number; h: 'left' | 'center' | 'right'; wrap?: boolean }
class Styles {
  fonts: string[] = [];
  borders: string[] = [];
  xfs: string[] = [];
  font(sz: number, bold = false): number {
    const x = `<font>${bold ? '<b/>' : ''}<sz val="${sz}"/><name val="${ROLL_XLSX.font}"/><family val="2"/><charset val="136"/></font>`;
    const i = this.fonts.indexOf(x);
    return i >= 0 ? i : this.fonts.push(x) - 1;
  }
  border(l: Edge, r: Edge, t: Edge, b: Edge): number {
    const e = (tag: string, v: Edge): string => (v === 'none' ? `<${tag}/>` : `<${tag} style="${v}"><color auto="1"/></${tag}>`);
    const x = `<border>${e('left', l)}${e('right', r)}${e('top', t)}${e('bottom', b)}<diagonal/></border>`;
    const i = this.borders.indexOf(x);
    return i >= 0 ? i : this.borders.push(x) - 1;
  }
  xf(x: Xf): number {
    const s = `<xf numFmtId="49" fontId="${x.font}" fillId="0" borderId="${x.border}" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="${x.h}" vertical="center"${x.wrap ? ' wrapText="1"' : ''}/></xf>`;
    const i = this.xfs.indexOf(s);
    return i >= 0 ? i : this.xfs.push(s) - 1;
  }
  constructor() {
    this.font(ROLL_XLSX.size.data);
    this.border('none', 'none', 'none', 'none');
    this.xf({ font: 0, border: 0, h: 'left' });
  }
  xml(): string {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="${this.fonts.length}">${this.fonts.join('')}</fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="${this.borders.length}">${this.borders.join('')}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${this.xfs.length}">${this.xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  }
}

interface Cell { v: string; s: number }
interface Row { cells: (Cell | undefined)[]; ht: number }

/** 點名單區塊（給產生與測試用）：表頭三列的值與名單 */
export interface RollBlock {
  room: string;
  time: string;
  papers: string;
  count: string;
  notice: string;
  /** 每列：左組六格＋右組六格 */
  rows: string[][];
}

export function rollCallBlocks(i: MakeupPaperInput): RollBlock[] {
  const slots = new Map(i.schedule.slots.map((s) => [s.id, s]));
  const dayLabel = (id: string): string => i.settings.days.find((d) => d.id === id)?.label ?? id;
  const blocks: RollBlock[] = [];
  const perPage = ROLL_XLSX.rowsPerGroup * 2;
  for (const sheet of i.outputs.rollCalls) {
    const s = slots.get(sheet.slotId)!;
    const totals = Object.entries(sheet.paperTotals).sort(([a], [b]) => a.localeCompare(b));
    const papers = totals.length === 1 ? totals[0]![0] : totals.map(([k, n]) => `${k}(${n})`).join('、');
    const early = sheet.rows.some((r) => r.note);
    const notice = ROLL_NOTICE + (early ? '註欄有離場時間者請勿提前放行。' : '') + (sheet.rows.some((r) => r.subjects.length > 1) ? '多科生各科考卷合為一份。' : '');
    const people = sheet.rows.map((r) => [r.studentId, r.oldClass, pad2(r.oldSeat), r.name, r.subjects.join('、'), r.note]);
    for (let at = 0; at < Math.max(1, people.length); at += perPage) {
      const chunk = people.slice(at, at + perPage);
      const per = Math.max(1, Math.ceil(chunk.length / 2));
      const blank = ['', '', '', '', '', ''];
      blocks.push({
        room: sheet.roomName,
        time: `${dayLabel(s.dayId)} ${slotName(s)} ${slotTime(s)}`,
        papers,
        count: `${sheet.rows.length}人`,
        notice,
        rows: Array.from({ length: per }, (_, k) => [...(chunk[k] ?? blank), ...(chunk[k + per] ?? blank)]),
      });
    }
  }
  return blocks;
}

/** 字串在 Excel 欄寬 w 裡要幾行（中日韓字約 2.2 字元寬，其他約 1.1） */
const linesIn = (s: string, w: number): number => Math.ceil([...s].reduce((a, ch) => a + (/[⺀-￿]/.test(ch) ? 2.2 : 1.1), 0) / Math.max(1, w - 0.6)) || 1;

export async function renderRollCallXlsx(i: MakeupPaperInput, opts: { generatedAt: string; dataVersion: string }): Promise<Uint8Array> {
  const st = new Styles();
  const Z = ROLL_XLSX.size;
  const label = st.xf({ font: st.font(Z.label), border: 0, h: 'right' });
  const value = st.xf({ font: st.font(Z.label), border: 0, h: 'left' });
  const center = st.xf({ font: st.font(Z.label), border: 0, h: 'center' });
  const teacher = st.xf({ font: st.font(Z.teacher, true), border: 0, h: 'left' });
  const notice = st.xf({ font: st.font(Z.notice, true), border: 0, h: 'left', wrap: true });
  // 每組外框粗線（medium）、組內細線（thin）；欄名列上粗下細；最後一列下粗
  const edge = (c: number): [Edge, Edge] => [c % 6 === 0 ? 'medium' : 'thin', c % 6 === 5 ? 'medium' : 'thin'];
  const headXf = (c: number): number => st.xf({ font: st.font(Z.head), border: st.border(...edge(c), 'medium', 'thin'), h: 'center' });
  const dataXf = (c: number, last: boolean): number => st.xf({ font: st.font(c % 6 === 0 ? Z.id : Z.data), border: st.border(...edge(c), 'thin', last ? 'medium' : 'thin'), h: 'center', wrap: c % 6 >= 4 });

  const rows: Row[] = [];
  const merges: string[] = [];
  const breaks: number[] = [];
  const cell = (v: string, s: number): Cell => ({ v, s });
  for (const b of rollCallBlocks(i)) {
    if (rows.length) { rows.push({ cells: [], ht: ROLL_XLSX.dataRowHt }); breaks.push(rows.length); }
    const r0 = rows.length + 1;
    rows.push({ ht: ROLL_XLSX.headRowHt, cells: [cell('監考老師：', label), , cell('', teacher), , , cell('科目，人數', center), , cell(b.papers, value)] });
    rows.push({ ht: ROLL_XLSX.headRowHt, cells: [cell('監考地點：', label), , cell(b.room, value), , , , , cell(b.count, value)] });
    rows.push({ ht: Math.max(ROLL_XLSX.headRowHt, linesIn(b.notice, 50) * 18), cells: [cell('時段：', label), , cell(b.time, value), , , cell('注意事項：', label), , cell(b.notice, notice)] });
    for (let k = 0; k < 3; k++) merges.push(`A${r0 + k}:B${r0 + k}`, `C${r0 + k}:E${r0 + k}`);
    merges.push(`F${r0}:G${r0 + 1}`, `H${r0}:L${r0}`, `H${r0 + 1}:L${r0 + 1}`, `F${r0 + 2}:G${r0 + 2}`, `H${r0 + 2}:L${r0 + 2}`);
    rows.push({ ht: ROLL_XLSX.headRowHt, cells: [...ROLL_HEAD6, ...ROLL_HEAD6].map((h, c) => cell(h, headXf(c))) });
    b.rows.forEach((r, k) => {
      const last = k === b.rows.length - 1;
      const two = r.some((v, c) => c % 6 >= 4 && linesIn(v, ROLL_XLSX.widths[c % 6]!) > 1);
      rows.push({ ht: two ? ROLL_XLSX.dataRowHt2 : ROLL_XLSX.dataRowHt, cells: r.map((v, c) => cell(v, dataXf(c, last))) });
    });
  }

  const sheetRows = rows
    .map((r, ri) => `<row r="${ri + 1}" ht="${r.ht}" customHeight="1">${r.cells.map((c, ci) => (c ? `<c r="${col(ci)}${ri + 1}" s="${c.s}"${c.v === '' ? '' : ` t="inlineStr"><is><t xml:space="preserve">${esc(c.v)}</t></is></c>`}${c.v === '' ? '/>' : ''}` : '')).join('')}</row>`)
    .join('');
  const cols = Array.from({ length: 12 }, (_, c) => `<col min="${c + 1}" max="${c + 1}" width="${ROLL_XLSX.widths[c % 6]}" customWidth="1"/>`).join('');
  const m = ROLL_XLSX.margins;
  const foot = `&L&"${ROLL_XLSX.font},標準"&${Z.footer}${footerText(opts.generatedAt, opts.dataVersion).replace(/&/g, '&&')}&R&${Z.footer}第 &P 頁／共 &N 頁`;
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView workbookViewId="0" view="pageLayout"/></sheetViews><sheetFormatPr defaultRowHeight="15.75"/><cols>${cols}</cols><sheetData>${sheetRows}</sheetData>${merges.length ? `<mergeCells count="${merges.length}">${merges.map((x) => `<mergeCell ref="${x}"/>`).join('')}</mergeCells>` : ''}<printOptions horizontalCentered="1"/><pageMargins left="${m.left}" right="${m.right}" top="${m.top}" bottom="${m.bottom}" header="${m.header}" footer="${m.footer}"/><pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/><headerFooter><oddFooter>${esc(foot)}</oddFooter></headerFooter>${breaks.length ? `<rowBreaks count="${breaks.length}" manualBreakCount="${breaks.length}">${breaks.map((r) => `<brk id="${r}" max="16383" man="1"/>`).join('')}</rowBreaks>` : ''}</worksheet>`;

  const z = new JSZip();
  z.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>');
  z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  z.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="點名單" sheetId="1" r:id="rId1"/></sheets></workbook>');
  z.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  z.file('xl/styles.xml', st.xml());
  z.file('xl/worksheets/sheet1.xml', sheet);
  return z.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
