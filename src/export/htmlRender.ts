/**
 * PDF 輸出（D29：PDF 為輔）：產生列印用 HTML，由瀏覽器「列印成 PDF」。
 * 內容與 Word 共用 model.ts 的版面模型。紙張用 @page 具名頁面（Chrome 支援）：座位表、名單 A4，標籤 B4 或 A3。
 * 座位表與標籤的樣式照設計系統成品頁「座位表與標籤」稿件（docs/design/mockups/設計系統.html #paper）：
 * 改這裡的版面要同步改稿件，反之亦然。
 */
import { roomShown, footerText, isSpecial, LABEL_EDGE_MM, LABEL_FOOTER_MM, labelBoxMm, labelGrid, labelGridSize, labelNotePt, landscapeFit, namePtFit, PAPER_MM, periodLineFontPt, personLayout, rotationPage, wideLayout, type PersonLine, SEAT_PAGE, seatGeometry, statLayout, SLOT_TIP, type CellModel, type LabelPageModel, type ListPageModel, type SeatPageModel, type TablePageModel } from './model';

export interface HtmlOptions {
  generatedAt: string;
  dataVersion: string;
  /** 標籤頁邊界 mm，與 Word 一致 */
  labelMarginMm?: number;
  /** 額外 CSS（例如 @font-face）。字型由呼叫端提供，避免本檔讀檔 */
  extraCss?: string;
}

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const DETACH = { bg: '#E6EBF7', fg: '#274690' };
const mm = (n: number): string => `${+n.toFixed(2)}mm`;

/** 右下角單字角標（#223）：不考＝黑底白字，加考／有考＝白底黑框 */
function cornersHtml(c: CellModel): string {
  const t = c.corners ?? [];
  return t.length ? `<span class="pp-cn">${t.map((k) => `<span class="pp-mk ${k.kind === 'x' ? 'x' : 'add'}">${esc(k.text)}</span>`).join('')}</span>` : '';
}

/** 兩倍寬整合標籤（稿 v2.37／D107）：一張佔兩格；單人左半編號姓名、右半科目；2 人左右各一人；3 人以上合併一格。排法同 Word（model.wideLayout） */
function wideHtml(c: CellModel | undefined, w: number, h: number, b4: boolean): string {
  const size = `width:${mm(w * 2)};height:${mm(h)}`;
  if (!c) return `<div class="pp-c pp-bl" style="${size};grid-column:span 2"></div>`;
  const lay = wideLayout(c, w - 1.5, h, { topPad: 5, codePt: b4 ? 33 : 31, nameMax: 18, subjMax: b4 ? 20 : 16 });
  const spans = (ls: PersonLine[]): string => ls.map((l) => `<span class="pp-pr" style="font-size:${l.pt}pt;margin-top:${mm(l.gapBefore)}">${l.runs.map((r) => (r.bold ? `<b>${esc(r.text)}</b>` : esc(r.text))).join('')}</span>`).join('');
  const co = `<i class="pp-co">${esc(c.coord)}</i>`;
  const n = c.persons?.length ?? 0;
  const two = n === 2;
  const multi = n >= 3; // 3 人以上：每人一區、靠上排（D108）
  const cls = (right: boolean) => `pp-wh${multi ? ' pp-wl pp-wt' : right && !two ? ' pp-wl' : ''}`;
  return `<div class="pp-c pp-wd" style="${size};grid-column:span 2;background:#fff">${co}<div class="${cls(false)}">${spans(lay.left)}</div><div class="${cls(true)}"${two || multi ? ' style="border-left:.2mm solid #C8C2AE"' : ''}>${spans(lay.right)}</div></div>`;
}

/** 一格：座位表用班級色（抽離考試用柔和單色），標籤用白底，有標示的標籤格用淺黃 */
function cellHtml(c: CellModel | undefined, w: number, h: number, mode: 'seat' | 'detach' | 'label', b4 = true): string {
  const size = `width:${mm(w)};height:${mm(h)}`;
  if (!c) return `<div class="pp-c ${mode === 'label' ? 'pp-bl' : 'pp-e'}" style="${size}"></div>`;
  if (c.persons) {
    // 預備教室／綜合教室／整合標籤（v2.36）：版式同一般標籤，格內每人一區；排法同 Word（model.personLayout）
    const g = mode === 'label' ? { topPad: 5, codePt: b4 ? 33 : 31, nameMax: 18, schedMax: 11 } : { topPad: 4.5, codePt: 19, nameMax: 10.5, schedMax: 7, joinSched: true };
    const { lines } = personLayout(c, w - (mode === 'label' ? 2 : 1.3), h, g);
    const ls = lines.map((l) => `<span class="pp-pr" style="font-size:${l.pt}pt;margin-top:${mm(l.gapBefore)}">${l.runs.map((r) => (r.bold ? `<b>${esc(r.text)}</b>` : esc(r.text))).join('')}</span>`).join('');
    return `<div class="pp-c pp-pe" style="${size};background:#fff"><i class="pp-co">${esc(c.coord)}</i><span class="pp-prs">${ls}</span></div>`;
  }
  if (c.periodLines) {
    // 預備教室合併標籤（D94-5）：每節一行、同字級，印節次＋科目＋班座號
    const pt = periodLineFontPt(c.periodLines, w - 3, h - 5);
    const ls = c.periodLines.map((l) => `<span class="pp-pll" style="font-size:${pt}pt"><small style="font-size:${+(pt * 0.7).toFixed(1)}pt">${esc(l.head)}</small>${esc(l.text)}</span>`).join('');
    return `<div class="pp-c pp-pl" style="${size};background:#fff"><i class="pp-co">${esc(c.coord)}</i><span class="pp-pls">${ls}</span></div>`;
  }
  const marked = isSpecial(c);
  const bg = mode === 'label' ? (marked ? '#FFE08A' : '#fff') : mode === 'detach' ? DETACH.bg : `#${c.colorBg}`;
  const em = mode === 'label' ? '#22201B' : mode === 'detach' ? DETACH.fg : `#${c.colorFg}`;
  // 標籤上沒有標示的格子不留標示區、整塊垂直置中、字取最大（#218）；其餘字級在格寬內取最大（#222）
  const free = mode === 'label';
  const npt = namePtFit(c.classLabel, c.name, w - (mode === 'label' ? 2.2 : 1.4), mode === 'label' ? 18 : 12);
  return `<div class="pp-c${free ? ' fr' : ''}${c.ref ? ' pp-ref' : ''}" style="${size};background:${bg}"><i class="pp-co">${esc(c.coord)}</i><b class="pp-no">${esc(c.code)}</b><span class="pp-nm" style="font-size:${npt}pt"><em style="color:${em}">${esc(c.classLabel)}</em><span>${esc(c.name)}</span></span>${cornersHtml(c)}</div>`;
}

function seatHtml(p: SeatPageModel, o: HtmlOptions): string {
  const { cw, ch, st, statsNext } = seatGeometry(p);
  const mode = p.detachStyle ? 'detach' : 'seat';
  let cells = '';
  for (let d = p.depth; d >= 1; d--) for (let r = 1; r <= p.rows; r++) cells += cellHtml(p.cells.get(`${r}-${d}`), cw, ch, mode);
  const ay = Array.from({ length: p.depth }, (_, i) => `<span>${p.depth - i}</span>`).join('');
  const ax = Array.from({ length: p.rows }, (_, i) => `<span>第${i + 1}排</span>`).join('');
  const chips = p.chips.map((t, i) => `<span class="pp-chip${i === 0 ? ' s' : ''}">${esc(t)}</span>`).join('');
  const sl = statLayout(p);
  const colg = `<colgroup>${sl.cols.map((w) => `<col style="width:${mm(w)}">`).join('')}</colgroup>`;
  const stHtml = `<table class="pp-st">${colg}<thead><tr><th>${esc(p.stats.table.headLabel ?? '項目')}</th>${p.stats.table.classes.map((c) => `<th>${esc(c)}</th>`).join('')}<th>合計</th></tr></thead><tbody>${st
    .map((r) => `<tr><td>${esc(r.label)}</td>${r.per.map((n) => `<td>${n}</td>`).join('')}<td class="t">${r.total}</td></tr>`)
    .join('')}</tbody></table>`;
  return `<section class="sheet pp pp-seat" style="page:a4full;width:${SEAT_PAGE.w}mm;height:${SEAT_PAGE.h - 0.5}mm;padding:${SEAT_PAGE.padY}mm ${SEAT_PAGE.padX}mm">
<div class="pp-hd"><div><div class="pp-h1">${esc(p.heading ?? p.examName)}</div>${p.heading ? '' : '<div class="pp-h2">座位表</div>'}</div><span class="pp-room">${esc(roomShown(p))}</span></div>
<div class="pp-chips">${chips}</div>
<div class="pp-wrapg" style="margin-top:4mm"><div class="pp-ay" style="grid-template-rows:repeat(${p.depth},${mm(ch)})">${ay}</div><div><div class="pp-grid" style="grid-template-columns:repeat(${p.rows},${mm(cw)})">${cells}</div><div class="pp-ax" style="grid-template-columns:repeat(${p.rows},${mm(cw)})">${ax}</div></div></div>
<div class="pp-bottom"><span class="l">${p.slotMode ? `已使用 ${p.cells.size} 格` : `共 ${p.stats.total} 人`}</span><span class="pp-pod">講臺</span><span></span></div>
${p.slotMode ? `<div class="pp-sltip">${esc(SLOT_TIP)}</div>` : ''}${statsNext ? '' : stHtml}
<div class="pp-foot">${esc(footerText(o.generatedAt, o.dataVersion))}</div></section>${statsNext ? `<section class="sheet pp pp-seat" style="page:a4full;width:${SEAT_PAGE.w}mm;height:${SEAT_PAGE.h - 0.5}mm;padding:${SEAT_PAGE.padY}mm ${SEAT_PAGE.padX}mm"><div class="pp-hd"><div><div class="pp-h1">${esc(p.heading ?? p.examName)}</div><div class="pp-h2">各班人數統計</div></div><span class="pp-room">${esc(roomShown(p))}</span></div><div style="margin-top:6mm">${stHtml}</div><div class="pp-foot">${esc(footerText(o.generatedAt, o.dataVersion))}</div></section>` : ''}`;
}

function labelHtml(p: LabelPageModel, o: HtmlOptions): string {
  const margin = o.labelMarginMm ?? LABEL_EDGE_MM;
  const { layout } = p;
  const paper = PAPER_MM[layout.paper];
  // 稿件：格高最多 35mm，格子下方才留得出注意事項與頁尾（Word 版待下一步對齊後再共用）
  const gs = labelGridSize(p);
  const cell = labelBoxMm(layout, gs.rows, p.notes.length);
  const cells = labelGrid(p)
    .map((m) => (layout.wide ? wideHtml(m, cell.w, cell.h, layout.paper === 'B4') : cellHtml(m, cell.w, cell.h, 'label', layout.paper === 'B4')))
    .join('');
  const padX = cell.padX;
  const notePt = labelNotePt(layout, gs.rows, p.notes.length);
  const noteHtml = notePt
    ? `<div class="pp-note" style="margin-top:3mm;font-size:${notePt}pt;line-height:1.5;padding:2mm 4mm"><h4 style="font-size:${notePt + 1}pt;margin-bottom:1mm">注意事項：</h4>${p.notes.map((l) => `<div>${l.map((s) => (s.bold ? `<b>${esc(s.text)}</b>` : esc(s.text))).join('')}</div>`).join('')}</div>`
    : '';
  const cls = layout.paper.toLowerCase();
  return `<section class="sheet pp pp-lab ${cls}" style="page:${cls};width:${paper.w}mm;height:${paper.h - 0.5}mm;padding:${margin}mm ${mm(padX)}">
<div class="pp-hd" style="margin-bottom:3mm"><div><div class="pp-h1">${esc((p.heading ?? `${p.examName}　標籤`) + (p.flipNotes?.length ? `　（${p.flipNotes.join('；')}）` : ''))}</div></div><span class="pp-room" style="font-size:12pt;padding:1mm 4mm">${esc(roomShown(p))}</span></div>
<div class="pp-grid" style="grid-template-columns:repeat(${gs.cols * (layout.wide ? 2 : 1)},${mm(cell.w)})">${cells}</div>
${noteHtml}
<div class="pp-foot" style="bottom:${LABEL_FOOTER_MM}mm">${esc(footerText(o.generatedAt, o.dataVersion))}</div></section>`;
}

function listHtml(p: ListPageModel, o: HtmlOptions): string {
  const rows = p.rows.map((r) => `<tr><td>${esc(r.subject)}</td><td>${esc(r.className)}</td><td>${esc(r.seatNo)}</td><td>${esc(r.name)}</td><td>${esc(r.place)}</td><td>${esc(r.purpose)}</td></tr>`).join('');
  return `<section class="sheet a4" style="page:a4"><h1>${esc(p.title)}</h1>${p.subtitle ? `<p class="sub"><b>${esc(p.subtitle)}</b></p>` : ''}<table class="list"><thead><tr><th>科目</th><th>班級</th><th>座號</th><th>姓名</th><th>去處（教室／座位）</th><th>用途</th></tr></thead><tbody>${rows}</tbody></table>
<footer>${esc(footerText(o.generatedAt, o.dataVersion))}</footer></section>`;
}

function tableHtml(p: TablePageModel, o: HtmlOptions): string {
  const sum = p.widths.reduce((a, b) => a + b, 0);
  const tr = (cells: string[], tag: 'td' | 'th', cls = '') =>
    `<tr${cls}>${cells.map((c, i) => `<${tag} style="width:${(((p.widths[i] ?? 1) * 100) / sum).toFixed(1)}%">${esc(c)}</${tag}>`).join('')}</tr>`;
  const land = !!p.landscape;
  const lf = landscapeFit(p.rows.length + (p.totalRow ? 1 : 0), p.headGroups ? 2 : 1, p.emWidths ? sum : undefined);
  const fit = land ? lf.rowMm : 9;
  const kcls = (ri: number, ci: number) => (p.cellKinds?.[ri]?.[ci] ? ` class="k-${p.cellKinds[ri]![ci]}"` : '');
  const rows = p.rows.map((r, ri) => `<tr>${r.map((c, ci) => `<td${kcls(ri, ci)} style="width:${(((p.widths[ci] ?? 1) * 100) / sum).toFixed(1)}%">${esc(c)}</td>`).join('')}</tr>`).join('') + (p.totalRow ? tr(p.totalRow, 'td', ' class="total"') : '');
  const grp = p.headGroups ? `<tr>${p.headGroups.map((g) => `<th colspan="${g.span}" class="g">${esc(g.text)}</th>`).join('')}</tr>` : '';
  return `<section class="sheet a4${land ? ' land' : ''}" style="page:${land ? 'a4l' : 'a4'}${land ? `;--rh:${+fit.toFixed(2)}mm;--rp:${lf.pt}pt` : ''}"><h1>${esc(land && p.subtitle ? `${p.title}　${p.subtitle}` : p.title)}</h1>${p.subtitle && !land ? `<p class="sub">${esc(p.subtitle)}</p>` : ''}${p.legend ? `<p class="lg">${esc(p.legend)}</p>` : ''}<table class="list tbl"><thead>${grp}${tr(p.heads, 'th')}</thead><tbody>${rows}</tbody></table>
<footer>${esc(footerText(o.generatedAt, o.dataVersion))}</footer></section>`;
}

const CSS = `
@page a4 { size: 210mm 297mm; margin: 12mm }
@page a4full { size: 210mm 297mm; margin: 0 }
@page a4l { size: 297mm 210mm; margin: 8mm 12mm 9mm }
@page b4 { size: ${PAPER_MM.B4.w}mm ${PAPER_MM.B4.h}mm; margin: 0 }
@page a3 { size: ${PAPER_MM.A3.w}mm ${PAPER_MM.A3.h}mm; margin: 0 }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact }
body { margin: 0; font-family: 'Noto Sans TC', 'Microsoft JhengHei', sans-serif; color: #111 }
.sheet { break-after: page; position: relative; box-sizing: border-box }
.sheet.a4 h1 { font-size: 16pt; text-align: center; margin: 0 0 4mm }
table.list { border-collapse: collapse; width: 100% }
table.list th, table.list td { border: 1px solid #808080; padding: 1mm 2mm; text-align: left; font-size: 10.5pt }
table.list th { background: #eee }
table.tbl td { height: 9mm }
table.tbl tr.total td { font-weight: 700; background: #f4f4f4 }
.sheet.land table.tbl th, .sheet.land table.tbl td { height: var(--rh); padding: 0 1.5mm; font-size: var(--rp); text-align: center; vertical-align: middle }
.sheet.land h1 { font-size: 14pt; margin: 0 0 .8mm }
.sheet.land p.lg { font-size: 8pt; margin: 0 0 1.5mm }
.sheet.land { break-after: auto; min-height: 190mm }
.sheet.land + .sheet.land { break-before: page }
.sheet.land footer { position: absolute; right: 0; bottom: 0; margin: 0; line-height: 1 }
.sheet.land table.tbl th.g { background: #e2e2e2 }
table.tbl td.k-exam { font-weight: 700 }
table.tbl td.k-study { background: #d9d9d9 }
table.tbl td.k-multi { background: #fff4c2; font-weight: 700 }
.sheet.a4 p.lg { font-size: 9.5pt; color: #6b6657; text-align: center; margin: -2mm 0 3mm }
.sheet.a4 p.sub { font-size: 12pt; text-align: center; margin: 0 0 4mm }
footer { font-size: 8pt; color: #555; text-align: right; margin-top: 3mm }

/* 座位表與標籤（稿件：設計系統成品頁 #paper） */
.pp { --ink:#22201B; --navy:#1F3A5F; --gray:#6B6657; --cut:#8E8670; background:#fff; color:var(--ink); overflow:hidden }
.pp *{box-sizing:border-box}
.pp .pp-hd{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:.8mm solid var(--navy);padding-bottom:3mm}
.pp .pp-h1{color:var(--navy);font-weight:700;font-size:15pt;letter-spacing:.04em}
.pp .pp-h2{font-family:'Noto Serif TC','PMingLiU',serif;font-weight:700;font-size:28pt;line-height:1.1;margin-top:1mm}
.pp .pp-room{display:block;background:var(--navy);color:#fff;border-radius:1.2mm;padding:1.6mm 6mm;font-weight:700;font-size:16pt}
.pp .pp-chips{display:flex;gap:2mm;flex-wrap:wrap;margin:3.5mm 0 0}
.pp .pp-chip{border:.3mm solid var(--navy);color:var(--navy);border-radius:5mm;padding:.6mm 3.5mm;font-size:12pt;font-weight:700}
.pp .pp-chip.s{background:var(--navy);color:#fff}
.pp .pp-grid{display:grid;border-top:.35mm solid var(--cut);border-left:.35mm solid var(--cut);width:max-content}
.pp.pp-seat .pp-grid{border:.7mm solid var(--ink)}
.pp .pp-c{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.4mm;border-right:.35mm solid var(--cut);border-bottom:.35mm solid var(--cut);text-align:center}
.pp.pp-seat .pp-c{border-right-width:.3mm;border-bottom-width:.3mm}
.pp .pp-co{position:absolute;right:1.1mm;top:.8mm;font-style:normal;font-weight:700;color:#4A463A;font-size:6.5pt;line-height:1;font-variant-numeric:tabular-nums}
.pp .pp-pls{display:grid;gap:.6mm;justify-items:start;width:100%;padding:3.5mm 1.5mm 0}
.pp .pp-pll{font-weight:800;line-height:1.3;white-space:nowrap;color:#22201B}
.pp .pp-pll small{font-weight:700;margin-right:1.6mm}
.pp .pp-no{font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:.02em;line-height:1}
.pp .pp-nm{font-weight:500;line-height:1.15;white-space:nowrap}
.pp .pp-nm em{font-style:normal;font-weight:700;margin-right:1.2mm;padding-right:1.2mm;border-right:.3mm solid currentColor}
.pp .pp-nm span{color:var(--ink)}
.pp .pp-mk{display:block;font-weight:700;line-height:1.25;padding:0 1.4mm;border-radius:.6mm;white-space:nowrap}
.pp .pp-mk.x{background:var(--ink);color:#fff;border:.3mm solid var(--ink)}
.pp .pp-mk.add{background:#fff;color:var(--ink);border:.45mm double var(--ink)}
.pp .pp-cn{position:absolute;right:1mm;bottom:.8mm;display:flex;gap:.6mm}
.pp .pp-cn .pp-mk{display:block;font-size:8pt;padding:0 .9mm}
.pp.pp-lab .pp-cn .pp-mk{font-size:11pt}
.pp .pp-c.pp-pe,.pp.pp-lab .pp-c.pp-pe,.pp.pp-seat .pp-c.pp-pe{display:flex;flex-direction:column;justify-content:center;padding:0}
.pp .pp-prs{display:flex;flex-direction:column;align-items:center;width:100%;padding:0 1mm}
.pp .pp-pr{white-space:nowrap;line-height:1.15}
.pp.pp-lab .pp-c.pp-wd{display:flex!important;flex-direction:row!important;align-items:stretch;justify-content:flex-start;padding:5mm 0 0;gap:0;overflow:hidden}
.pp.pp-lab .pp-wd .pp-wh{flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden}
.pp.pp-lab .pp-wd .pp-wh.pp-wl{align-items:flex-start;padding-left:1.5mm}
.pp.pp-lab .pp-wd .pp-wh.pp-wt{justify-content:flex-start;padding-top:0}
.pp .pp-pr b{font-weight:700}
.pp .pp-c.pp-bl{border:none;background:none}
.pp .pp-c.pp-ref{outline:.5mm dashed var(--ink);outline-offset:-.8mm}
.pp .pp-e{background:repeating-linear-gradient(135deg,#F1EDE0 0 1.2mm,#E2DCC8 1.2mm 2.4mm)}
.pp.pp-lab .pp-c{display:grid;grid-template-rows:1fr auto 9mm;justify-items:center;align-items:center;gap:0;padding:5mm 1mm .8mm}
.pp.pp-lab .pp-no{align-self:end;margin-bottom:2.6mm;font-size:31pt}.pp.pp-lab .pp-nm{font-size:15pt}.pp.pp-lab .pp-mk{font-size:12pt}.pp.pp-lab .pp-co{font-size:9pt}
.pp.pp-lab.b4 .pp-no{font-size:33pt}
.pp.pp-lab .pp-c.fr{display:flex;flex-direction:column;justify-content:center;gap:2.6mm;padding:0 1mm}.pp.pp-lab .pp-c.fr .pp-no{margin:0}
.pp.pp-seat .pp-c{display:grid;grid-template-rows:1fr auto 5.2mm;justify-items:center;align-items:center;gap:0;padding:4.5mm .5mm .8mm}
.pp.pp-seat .pp-no{font-size:19pt}.pp.pp-seat .pp-nm{font-size:8.5pt}.pp.pp-seat .pp-mk{font-size:7.5pt}
.pp .pp-note{margin-top:8mm;font-size:20pt;line-height:1.75;border:.3mm solid var(--cut);border-left:2.4mm solid var(--navy);border-radius:1.5mm;padding:5mm 9mm;background:#FBF8EE;width:max-content;max-width:100%}
.pp .pp-note h4{margin:0 0 2mm;color:var(--navy);font-size:22pt}
.pp .pp-note b{font-weight:700}
.pp.b4 .pp-note{margin-top:5mm;font-size:13pt;padding:3mm 6mm;border-left-width:1.8mm}.pp.b4 .pp-note h4{font-size:14pt;margin-bottom:1mm}
.pp .pp-foot{position:absolute;left:0;right:0;bottom:6mm;text-align:center;font-size:9.5pt;color:var(--gray)}
.pp .pp-bottom{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;margin-top:3mm}
.pp .pp-bottom .l{font-size:9pt}
.pp .pp-pod{border:.5mm solid var(--ink);padding:1.2mm 12mm;font-weight:700;font-size:13pt;letter-spacing:.6em;padding-left:calc(12mm + .6em)}
.pp .pp-ax{display:grid;font-size:7pt;font-weight:700;color:var(--gray);text-align:center;margin-top:.8mm}
.pp .pp-wrapg{display:grid;grid-template-columns:5mm auto;justify-content:center;gap:0 1.5mm}
.pp .pp-ay{display:grid;font-size:7pt;font-weight:700;color:var(--gray);align-items:center;justify-items:end}
.pp .pp-sltip{margin-top:5mm;font-size:11pt;color:#4A463A;line-height:1.5}
.pp .pp-st{width:100%;table-layout:fixed;border-collapse:collapse;font-size:12pt;margin-top:5mm}
.pp .pp-st th,.pp .pp-st td{border:.3mm solid var(--cut);padding:.8mm 2mm;text-align:center}
.pp .pp-st th{background:#F3EEDD;font-weight:700}
.pp .pp-st td:first-child{text-align:left}
.pp .pp-st td.t{font-weight:700}
`;

export type HtmlPages = { seat?: SeatPageModel[]; label?: LabelPageModel[]; list?: ListPageModel | ListPageModel[]; table?: TablePageModel[] };

export function renderPrintHtml(pages: HtmlPages, o: HtmlOptions): string {
  const body = [
    ...(pages.seat ?? []).flatMap((p) => { const r = rotationPage(p); return [seatHtml(p, o), ...(r ? [tableHtml(r, o)] : [])]; }),
    ...(pages.label ?? []).map((p) => labelHtml(p, o)),
    ...[pages.list ?? []].flat().map((l) => listHtml(l, o)),
    ...(pages.table ?? []).map((t) => tableHtml(t, o)),
  ];
  if (body.length === 0) throw new Error('沒有可輸出的頁面');
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>考務小幫手輸出</title><style>${CSS}${o.extraCss ?? ''}</style></head><body>${body.join('\n')}</body></html>`;
}
