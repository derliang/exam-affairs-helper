/** 分科 ⑥ 輸出（AST-2）：五份輸出的內容、彼此一致、應試編號有才印、擋下條件、畫面。全部匿名假資料。 */
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import type { Classroom, ExamConfig, ExamEntry } from '../../data';
import { demoDoc } from '../repository';
import { newExam, updateExam, type Doc } from '../store';
import { codeOf } from '../../core/astD99/contract';
import { AstStep6, runAstExport } from './AstStep6';
import { astInput, astPlan } from './model';
import { AstStep4 } from './AstStep4';
import { landscapeFit, textEm } from '../../export/model';
import { astOutputBlockers, astOutputs } from './output';

const noop = () => undefined;
const NAMES = ['溫', '良', '恭', '儉', '勤', '誠'];
const SCI = ['physics', 'chemistry', 'math-jia', 'biology'];
const LIB = ['history', 'geography', 'math-yi', 'civics'];

/** 6 個班各 per 人、6 間 7×7 班級教室、1 間綜合教室；理組班考理科、文組班考文科，座號 5 的倍數的人每科都不考其中一科（要自習） */
function fixture(per = 12, reserveSeats = 12, skipEvery = 5): { doc: Doc; exam: ExamConfig } {
  const r = newExam(demoDoc(), 'ast', '分科第一次', new Date('2026-09-01T02:00:00Z'));
  if (!r.ok) throw new Error(r.error);
  let doc = r.doc;
  let exam = doc.exams[doc.exams.length - 1]!;
  const rooms: Classroom[] = NAMES.map((n, i) => ({ id: `c${i + 1}`, name: n, kind: 'class', rows: 7, depth: 7, seatCount: 49, track: i < 3 ? 'science' : 'liberal', division: 'senior' }));
  rooms.push({ id: 'k1', name: '綜合教室一', kind: 'reserve', rows: 3, depth: 4, seatCount: reserveSeats, division: 'senior' });
  const roster = NAMES.flatMap((n, i) => Array.from({ length: per }, (_, j) => ({ classNo: i + 1, seatNo: j + 1, name: `學生${i + 1}${j + 1}` })));
  const entries: ExamEntry[] = roster.map((s) => {
    const sci = s.classNo <= 3;
    const subjectIds = (sci ? SCI : LIB).filter((_, k) => !(s.seatNo % skipEvery === 0 && k === s.seatNo % 4));
    return { classNo: s.classNo, seatNo: s.seatNo, name: s.name, subjectIds, track: sci ? 'science' : 'liberal' };
  });
  doc = { ...doc, settings: { ...doc.settings, classrooms: rooms, classes: NAMES.map((n, i) => ({ no: i + 1, name: n, division: 'senior' as const, track: i < 3 ? 'science' as const : 'liberal' as const, colorIndex: i + 1 })) }, rosters: { ...doc.rosters, senior: roster }, examFiles: { ...(doc.examFiles ?? {}), [exam.id]: { entries } } };
  const u = updateExam(doc, exam.id, { classroomIds: rooms.map((x) => x.id) });
  if (!u.ok) throw new Error(u.error);
  doc = u.doc;
  exam = doc.exams.find((e) => e.id === exam.id)!;
  return { doc, exam };
}


const noopFonts = async (): Promise<never> => { throw new Error('PDF 不需要字型'); };
const withExamNo = (doc: Doc, exam: ExamConfig): Doc => {
  const entries = doc.examFiles![exam.id]!.entries!.map((e: ExamEntry) => ({ ...e, examNo: `A${String(e.classNo)}${String(e.seatNo).padStart(2, '0')}` }));
  return { ...doc, examFiles: { ...doc.examFiles, [exam.id]: { entries } } };
};
const rosterTables = (o: ReturnType<typeof astOutputs>) => o.reg.filter((t) => t.heads.includes('到考'));

describe('分科輸出：內容', () => {
  const { doc, exam } = fixture();
  const plan = astPlan(doc, exam)!;
  const o = astOutputs(doc, exam, plan);
  it('標籤：每間有人考試的考場一張紙，一座位一張、各時段一行、印時段＋科目、不印鐘點', () => {
    const rooms = new Set(plan.out.exams.map((e) => e.roomId));
    expect(o.label).toHaveLength(rooms.size);
    const seats = new Set(plan.out.exams.map((e) => `${e.roomId}:${e.row}-${e.depth}`));
    expect(o.label.reduce((n, p) => n + p.cells.length, 0)).toBe(seats.size);
    expect(plan.out.metrics!.labels).toBe(seats.size);
    const cell = o.label[0]!.cells.find((c) => c.periodLines!.length > 1)!;
    expect(cell.periodLines![0]!.head).toMatch(/^\d天\d$/);
    // #216：同一格各人各行「第N天 時段X 科目」，標題不再解釋縮寫
    expect(cell.persons!.length).toBeGreaterThan(0);
    expect(cell.persons!.flatMap((p) => p.sched).every((s) => /^第.+天 時段.+ \S+$/.test(s))).toBe(true);
    expect(o.label.every((p) => !p.heading!.includes('＝'))).toBe(true);
    expect(JSON.stringify(o.label)).not.toMatch(/\d{1,2}:\d{2}/);
  });
  it('班級公告（#215）：A4 橫式一班一頁、兩層表頭；考＝粗體座位、自習＝灰底＋教室、不考也不自習＝—', () => {
    expect(o.ann).toHaveLength(6);
    const t = o.ann[0]!;
    expect(t.landscape).toBe(true);
    expect(t.rows).toHaveLength(12);
    expect(t.heads).toHaveLength(2 + 8);
    expect(t.headGroups!.reduce((n, g) => n + g.span, 0)).toBe(t.heads.length);
    expect(t.headGroups!.slice(1).every((g) => /^第.+天$/.test(g.text))).toBe(true);
    const cells = t.rows.flatMap((r) => r.slice(2));
    const kinds = t.cellKinds!.flatMap((r) => r.slice(2));
    expect(kinds).toHaveLength(cells.length);
    expect(cells.filter((_, i) => kinds[i] === 'exam').every((c) => /^\d+－\d+( .+)?$/.test(c))).toBe(true);
    expect(cells.some((_, i) => kinds[i] === 'exam')).toBe(true);
    expect(cells.filter((_, i) => kinds[i] === 'study').every((c) => c.startsWith('自習 ') && !/\d－\d/.test(c))).toBe(true);
    expect(cells.some((_, i) => kinds[i] === 'study')).toBe(true);
    expect(cells.filter((_, i) => kinds[i] === undefined).every((c) => c === '—')).toBe(true);
  });
  it('班級公告（#259）：欄寬以格內最長文字（含教室名稱）估算，一行放得下；字級依整頁寬度縮小', () => {
    const t = o.ann[0]!;
    expect(t.emWidths).toBe(true);
    expect(t.widths).toHaveLength(t.heads.length);
    t.heads.forEach((h, i) => {
      const need = Math.max(textEm(h, true), ...t.rows.map((r) => textEm(r[i] ?? '', true)));
      expect(t.widths[i]!).toBeGreaterThanOrEqual(need);
    });
    const fit = landscapeFit(t.rows.length, 2, t.widths.reduce((a, b) => a + b, 0));
    expect(fit.pt * 0.3528 * t.widths.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(273.5);
    // 40 人一頁：列高、字級仍不低於下限
    const big = landscapeFit(40, 2, 80);
    expect(big.rowMm).toBeGreaterThanOrEqual(2.8);
  });
  it('綜合教室排法（#258）：預設不帶旗標（最少深位）、選最少排數才帶 min-rows，且 ④ 畫面有兩個選項', () => {
    expect(astInput(doc, exam).reserveLayout).toBeUndefined();
    expect(astInput(doc, { ...exam, astReserveLayout: 'min-rows' }).reserveLayout).toBe('min-rows');
    const html = renderToString(<AstStep4 doc={doc} exam={exam} onChange={noop} onStep={noop} />);
    expect(html).toContain('最少深位（預設）');
    expect(html).toContain('最少排數');
  });
  it('一致性：標籤、清冊、公告都從同一份方案來，座位逐筆相同（§13.1 第 7 條）', () => {
    const roster = rosterTables(o).flatMap((t) => t.rows.map((r) => `${r[1]}${r[2]}|${r[0]}`));
    expect(roster).toHaveLength(plan.out.exams.length);
    const cls = (code: string) => doc.settings.classes.find((x) => x.no === Number(code.slice(0, 2)) && x.division === exam.division)?.name ?? code.slice(0, 2);
    const fromPlan = new Set(plan.out.exams.map((e) => `${cls(e.code)}${e.code.slice(2)}|${e.row}－${e.depth}`));
    for (const r of roster) expect(fromPlan.has(r)).toBe(true);
    const labelTexts = o.label.flatMap((p) => p.cells.flatMap((c) => c.periodLines!.map((l) => l.text)));
    expect(labelTexts).toHaveLength(plan.out.exams.length);
    for (const e of plan.out.exams) expect(labelTexts.some((t) => t.includes(e.code))).toBe(true);
    // 公告：全部公告裡「考」的格子數＝方案的考試數
    const annExam = o.ann.flatMap((t) => t.cellKinds!.flat()).filter((k) => k === 'exam').length;
    expect(annExam).toBe(plan.out.exams.length);
    const annStudy = o.ann.flatMap((t) => t.cellKinds!.flat()).filter((k) => k === 'study').length;
    expect(annStudy).toBe(plan.out.study.length);
  });
  it('每科試務清冊：每科一份總表、每間考場一頁名冊；名冊有到考／缺考欄、總人數對得上', () => {
    expect(o.reg.filter((t) => t.heads[0] === '考場')).toHaveLength(8);
    expect(rosterTables(o).reduce((n, t) => n + t.rows.length, 0)).toBe(plan.out.exams.length);
    const r = rosterTables(o)[0]!;
    expect(r.heads.slice(-2)).toEqual(['到考', '缺考']);
    expect(r.rows[0]!.slice(-2)).toEqual(['□', '□']);
  });
  it('教室用途表：每間教室一列、每時段一欄；附方案指標頁', () => {
    expect(o.use[0]!.rows).toHaveLength(plan.input.rooms.length);
    expect(o.use[0]!.heads).toHaveLength(2 + 8);
    expect(o.use[1]!.rows.find((r) => r[0] === '標籤張數')![1]).toBe(String(plan.out.metrics!.labels));
  });
  it('自習名單：只列離開原班的人，人數與引擎一致；另有一份布置工作表', () => {
    const lists = o.study.filter((t) => t.heads[0] === '地點');
    const n = lists.reduce((a, t) => a + t.rows.length, 0);
    const homeOf = (cl: number) => plan.input.rooms.find((r) => r.kind === 'class' && r.classNo === cl)?.id;
    const away = plan.out.study.filter((s) => homeOf(Number(s.code.slice(0, 2))) !== s.roomId).length;
    expect(n).toBe(away);
    if (n > 0) expect(o.study[o.study.length - 1]!.heads).toContain('門口標籤');
  });
  it('版本碼：同方案相同、方案變了就不同', () => {
    expect(astOutputs(doc, exam, plan).version).toBe(o.version);
    const f = fixture(10);
    expect(astOutputs(f.doc, f.exam, astPlan(f.doc, f.exam)!).version).not.toBe(o.version);
  });
});

describe('分科輸出：應試編號（選填）', () => {
  it('沒匯入：公告、清冊、標籤都沒有應試編號欄', () => {
    const { doc, exam } = fixture();
    const o = astOutputs(doc, exam, astPlan(doc, exam)!);
    expect(o.ann[0]!.heads).not.toContain('應試編號');
    expect(rosterTables(o)[0]!.heads).not.toContain('應試編號');
    expect(JSON.stringify(o.label)).not.toContain(' A1');
  });
  it('有匯入：每份都印', () => {
    const f = fixture();
    const doc = withExamNo(f.doc, f.exam);
    const o = astOutputs(doc, f.exam, astPlan(doc, f.exam)!);
    expect(o.ann[0]!.heads).toContain('應試編號');
    expect(o.ann[0]!.rows[0]![2]).toBe('A101');
    expect(rosterTables(o)[0]!.heads).toContain('應試編號');
    const code = codeOf({ classNo: 1, seatNo: 1 });
    expect(o.label.flatMap((p) => p.cells.flatMap((c) => c.periodLines!.map((l) => l.text))).some((t) => t.includes(code) && t.endsWith('A101'))).toBe(true);
  });
});

describe('分科輸出：擋下與畫面', () => {
  it('沒有名單／沒有方案／座位不夠：擋下並指向對的步驟', () => {
    expect(astOutputBlockers(undefined, false)[0]!.step).toBe(2);
    expect(astOutputBlockers(undefined, true)[0]!.step).toBe(3);
    const f = fixture(12, 12);
    const u = updateExam(f.doc, f.exam.id, { classroomIds: ['c1'] });
    if (!u.ok) throw new Error();
    const e = u.doc.exams.find((x) => x.id === f.exam.id)!;
    expect(astOutputBlockers(astPlan(u.doc, e), true)[0]!.step).toBe(3);
  });
  it('⑥ 畫面：可以下載時出現五個項目與驗證通過；不能時顯示擋下原因', () => {
    const { doc, exam } = fixture();
    // AST-3：規劃中只能預覽、不能下載（D101②）；定案後才通過
    const draft = renderToString(<AstStep6 doc={doc} exam={exam} onGoStep={noop} />);
    expect(draft).toContain('規劃中：只能預覽，不能下載正式檔');
    expect(draft).toMatch(/<button[^>]*btn-lg[^>]*disabled/);
    const fin = updateExam(doc, exam.id, { astPhase: 'final' });
    if (!fin.ok) throw new Error();
    const html = renderToString(<AstStep6 doc={fin.doc} exam={fin.doc.exams.find((x) => x.id === exam.id)!} onGoStep={noop} />);
    expect(html).not.toMatch(/<button[^>]*btn-lg[^>]*disabled/);
    for (const t of ['整合標籤', '班級公告', '每節教室用途表', '每科試務清冊', '自習教室名單與布置標籤工作表', '方案通過驗證']) expect(html).toContain(t);
    const u = updateExam(doc, exam.id, { classroomIds: [] });
    if (!u.ok) throw new Error();
    const html2 = renderToString(<AstStep6 doc={u.doc} exam={u.doc.exams.find((x) => x.id === exam.id)!} onGoStep={noop} />);
    expect(html2).toContain('還不能下載');
  });
  it('PDF 輸出：合併成一個列印頁，含版本碼，標籤白底；一項都沒勾會報錯', async () => {
    const { doc, exam } = fixture();
    const o = astOutputs(doc, exam, astPlan(doc, exam)!);
    const res = await runAstExport(o, ['label', 'ann', 'use', 'reg', 'study'], 'pdf', 'B4', exam.name, noopFonts);
    expect(res).toHaveLength(1);
    const h = res[0]!.data as string;
    expect(h).toContain(o.version);
    expect(h).toContain('班級公告');
    expect(h).not.toMatch(/background:#FBE7C6/);
    await expect(runAstExport(o, [], 'pdf', 'B4', exam.name, noopFonts)).rejects.toThrow();
  });
  it('Word 輸出：標籤一個檔、其餘每項一個檔，都是可解開的 docx', async () => {
    const { doc, exam } = fixture();
    const o = astOutputs(doc, exam, astPlan(doc, exam)!);
    const dir = new URL('../../export/fonts/', import.meta.url);
    const fonts = async () => ({ fonts: { regular: new Uint8Array(readFileSync(new URL('NotoSansTC-Regular-big5.ttf', dir))), bold: new Uint8Array(readFileSync(new URL('NotoSansTC-Bold-core.ttf', dir))) }, has: () => true });
    const res = await runAstExport(o, ['label', 'ann', 'use', 'reg', 'study'], 'word', 'B4', exam.name, fonts);
    expect(res.map((f) => f.name.replace(/^.*?-/, ''))).toEqual(['整合標籤（B4）.docx', '班級公告.docx', '每節教室用途表.docx', '每科試務清冊.docx', '自習教室名單與布置標籤工作表.docx']);
    for (const f of res) expect(Object.keys((await JSZip.loadAsync(f.data as Uint8Array)).files)).toContain('word/document.xml');
  }, 30000);
});

describe('分科輸出：頁數預估（#269）', () => {
  it('座位表的預估頁數含輪流座位清單跨頁；橫式表一頁、直式長表依列數估', async () => {
    const { estimatePages, TABLE_ROWS_PER_PAGE } = await import('./output');
    const rows = Array.from({ length: 100 }, () => ['a']);
    const o = {
      label: [], ann: [], use: [], reg: [], study: [], version: 'x',
      seat: [{ rotation: { heads: ['h'], rows } }, {}],
    } as never as import('./output').AstOutputs;
    // 第一間：1 頁座位圖＋輪流清單 100 列；第二間：1 頁
    expect(estimatePages(o, 'seat')).toBe(1 + Math.ceil(100 / TABLE_ROWS_PER_PAGE) + 1);
    const t = (landscape: boolean, n: number) => ({ landscape, rows: Array.from({ length: n }, () => ['a']) });
    const o2 = { ...o, ann: [t(true, 45), t(true, 12)], reg: [t(false, 60)] } as never as import('./output').AstOutputs;
    expect(estimatePages(o2, 'ann')).toBe(2);
    expect(estimatePages(o2, 'reg')).toBe(Math.ceil(60 / TABLE_ROWS_PER_PAGE));
  });
});

describe('分科輸出：綜合教室座位表（#220）', () => {
  const squeezed = (rows: number, depth: number) => {
    const f = fixture(12, 40);
    const classrooms = f.doc.settings.classrooms.map((r) => (r.kind === 'class' ? { ...r, rows, depth, seatCount: rows * depth } : r));
    const doc = { ...f.doc, settings: { ...f.doc.settings, classrooms } };
    return { doc, exam: f.exam };
  };
  it('班級教室夠用時沒有人在綜合教室考試：不出座位表', () => {
    const f = fixture(12, 40);
    expect(astOutputs(f.doc, f.exam, astPlan(f.doc, f.exam)!).seat).toEqual([]);
  });
  it('有人在綜合教室考試：每間一頁、格內每人一區、各時段各班人數統計＋不重複人數、與方案逐筆一致', () => {
    const { doc, exam } = squeezed(4, 4); // 班級教室縮成 4×4，座位不夠，綜合教室要當考場
    const plan = astPlan(doc, exam)!;
    const o = astOutputs(doc, exam, plan);
    const reserveIds = new Set(plan.input.rooms.filter((r) => r.kind === 'reserve').map((r) => r.id));
    const inReserve = plan.out.exams.filter((e) => reserveIds.has(e.roomId));
    expect(inReserve.length).toBeGreaterThan(0);
    expect(o.seat).toHaveLength(new Set(inReserve.map((e) => e.roomId)).size);
    const p = o.seat[0]!;
    expect(p.slotMode).toBe(true);
    expect(p.stats.table.headLabel).toBe('時段');
    const rows = p.stats.table.rows;
    expect(rows[rows.length - 1]!.label).toBe('不重複人數');
    expect(rows[rows.length - 1]!.total).toBe(p.stats.total);
    for (const row of rows) expect(row.per.reduce((a, b) => a + b, 0)).toBe(row.total);
    // 每時段一列的人數加總＝方案中在這間綜合教室的考試筆數
    expect(rows.slice(0, -1).reduce((a, r) => a + r.total, 0)).toBe(inReserve.length);
    expect([...p.cells.values()].every((c) => (c.persons?.length ?? 0) > 0)).toBe(true);
    expect(o.seat.reduce((n, pg) => n + pg.cells.size, 0)).toBe(new Set(inReserve.map((e) => `${e.roomId}:${e.row}-${e.depth}`)).size);
  });
  it('下載：Word 多一個「綜合教室座位表」檔，列印頁也含座位表與統計', async () => {
    const { doc, exam } = squeezed(4, 4);
    const o = astOutputs(doc, exam, astPlan(doc, exam)!);
    const res = await runAstExport(o, ['seat'], 'word', 'B4', '分科', async () => ({ fonts: { regular: new Uint8Array(readFileSync(new URL('../../export/fonts/NotoSansTC-Regular-big5.ttf', import.meta.url))), bold: new Uint8Array(readFileSync(new URL('../../export/fonts/NotoSansTC-Bold-core.ttf', import.meta.url))) }, has: () => true }));
    expect(res.map((f) => f.name)).toEqual(['分科-綜合教室座位表.docx']);
    const html = await runAstExport(o, ['seat'], 'pdf', 'B4', '分科', async () => { throw new Error('x'); });
    expect(String(html[0]!.data)).toContain('不重複人數');
  });
});
